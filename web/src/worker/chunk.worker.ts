/**
 * 区块 Worker 的**入口 / bootstrap**。
 *
 * 它只做一件事：等主线程把方块表发过来 → 装上 → 再 `import()` 真正的实现
 * （`chunk.worker.impl.ts`，地形生成 + 网格化）。
 *
 * ## 为什么需要这一层
 *
 * app 形态（`SPECS_STUB=1`）下方块表不进主包，是运行时由原生解封后注入的。
 * 而 Worker 是**独立的模块实例**，模块求值那一刻注册表还是空的——`items.ts` 顶层那段
 * "按方块 id 注册物品"的循环会读 `blockDef(id).id`，直接抛
 * `Cannot read properties of undefined (reading 'id')`，于是 Worker 一条结果都回不来，
 * 表现是**永远停在 "Generating world…"**（区块数恒为 0，且页面不报错）。
 *
 * 主线程没这个问题，因为 `boot.ts` 先 `await ensureHostCore()` 才动态 `import()` 游戏主包。
 * 这里用的是同一个办法：**先装表，再引入依赖注册表的模块**。所以 impl 不能
 * 静态 import，只能用 `import()`。
 *
 * Web 形态下表已经在包里，主线程发 `{ core: null }`，这一层只做一次动态 import。
 */

import { decodeBlockTable } from '../core/registry/blockTableCodec.ts';
import { installBlockTable } from '../core/registry/blocks.ts';
import type { WorkerRequest } from './chunk.worker.impl.ts';

// 类型在这里转出去，其他模块继续从 `chunk.worker.ts` 引入即可（`export type` 会被擦除，
// 不会把 impl 拉进静态依赖图）
export type {
  GenerateRequest,
  GenerateResponse,
  MeshChunkPayload,
  MeshRequest,
  MeshResponse,
  GeometryPayload,
} from './chunk.worker.impl.ts';

/** 避免依赖 WebWorker lib（会与 DOM lib 冲突），只声明用到的接口 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest | InitMessage>) => void): void;
}

interface InitMessage {
  type: 'init';
  /** 原始方块表字节；`null` = 表已经在包里（Web 形态），不需要装 */
  core: ArrayBuffer | null;
}

const ctx = self as unknown as WorkerScope;

let handle: ((req: WorkerRequest) => void) | null = null;
let ready: Promise<void> | null = null;
/** 实现还没加载完就到达的请求：按到达顺序排队，加载完按序补发 */
const queued: WorkerRequest[] = [];

function bootstrap(core: ArrayBuffer | null): Promise<void> {
  if (ready !== null) return ready;
  ready = (async () => {
    if (core !== null) {
      installBlockTable(decodeBlockTable(core));
    }
    const module = await import('./chunk.worker.impl.ts');
    handle = module.handleRequest;
    for (const request of queued) handle(request);
    queued.length = 0;
  })();
  return ready;
}

ctx.addEventListener('message', (event) => {
  const data = event.data;

  if ((data as InitMessage).type === 'init') {
    void bootstrap((data as InitMessage).core);
    return;
  }

  const request = data as WorkerRequest;
  if (handle === null) {
    queued.push(request);
    return;
  }
  handle(request);
});

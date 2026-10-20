/**
 * v2 core smoke：不依赖 DOM / 小游戏运行时。
 *
 * 验证：
 *   main 的 World + chunk.worker 纯处理函数
 *   + 平台的 main-thread Worker 形状
 *   → 能生成区块。
 *
 * 这是 v2 的第一道“core 没被搬坏”的门禁。
 */

import { World } from '../../src/core/world/World.ts';
import type { WorkerLike, WorkerMessageEvent } from '../../src/core/worker/WorkerLike.ts';
import { handleWorkerRequest, type WorkerRequest } from '../../src/worker/chunk.worker.ts';

class MainThreadWorkerStub implements WorkerLike {
  private readonly listeners = new Set<(event: WorkerMessageEvent) => void>();

  postMessage(message: unknown): void {
    setTimeout(() => {
      const { response } = handleWorkerRequest(message as WorkerRequest);
      for (const listener of this.listeners) listener({ data: response });
    }, 0);
  }

  addEventListener(_type: 'message', listener: (event: WorkerMessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: WorkerMessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.listeners.clear();
  }
}

(globalThis as unknown as { Worker: typeof MainThreadWorkerStub }).Worker = MainThreadWorkerStub;

const world = new World(0x5eed, 'default', 1);
let loaded = 0;
world.events = {
  onChunkLoaded: () => {
    loaded++;
  },
};

world.update(0, 0, 1);

const deadline = Date.now() + 10_000;
while (loaded === 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

if (loaded === 0) {
  console.error('FAIL: no chunk loaded');
  process.exit(1);
}

const surface = world.getSurfaceBlockY(0, 0);
if (surface === null) {
  console.error('FAIL: no surface at 0,0');
  process.exit(1);
}

console.log(`PASS: chunks=${world.chunks.size} loaded=${loaded} surfaceY=${surface}`);

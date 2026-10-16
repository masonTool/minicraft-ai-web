/**
 * 启动耗时台账（N8 的判据，批次 103）
 *
 * 由来：N8 留了四条"仍可做"的启动优化（预热 worker 池 / 非关键工作推后 /
 * 图集分帧或缓存 / 启动期网格化预算 3 → 6），**一条都没法验证** ——
 * 这个项目里没有任何地方量过"开个新世界要多久"（`tools/perf-acceptance.js`
 * 只管自适应视距）。于是照 N9 那套**先建判据**：把两个玩家真正等得着的阶段量出来，
 * 之后每做一条优化都能拿出数字。
 *
 * 两个数字（也就是仅有的两个"玩家在等"的时刻）：
 *   · `boot`     —— 页面开始脚本 → **主菜单能点**（首次访问的一次性成本）
 *   · `playable` —— 点了"创建并进入" → **第一块地形画出来**（加载遮罩撤掉）
 *
 * ⚠️ 时钟是**注入**的（`now`），所以它可以离线断言 —— 与 `StartupRamp` 是同一套写法。
 * ⚠️ 阶段名是对外读数（验收脚本与文档都按名字取），**改名要同步三处**：
 *    这里、`tools/startup-acceptance.js`、`TASKS.md` 的 N8。
 * ⚠️ 这个模块只在主线程用（依赖 `performance`），**不要 import 进 worker**。
 */

/** 阶段名（按发生顺序） */
export const STARTUP_PHASES = {
  /** boot() 开始（脚本求值之后） */
  bootBegin: 'boot:begin',
  /** WebGL 预检通过、准备生成图集 */
  bootGl: 'boot:gl',
  /** 图集画完（程序化生成所有贴图） */
  bootAtlas: 'boot:atlas',
  /** 主菜单可点（玩家可以点"创建并进入"了） */
  bootMenu: 'boot:menu',
  /** 玩家点了"创建并进入" */
  worldBegin: 'world:begin',
  /** 存档库打开（`SaveGame.open` 返回） */
  worldSave: 'world:save',
  /** `App` 构造完（渲染器 / 图集上传 / worker 池都建好了） */
  worldConstructed: 'world:constructed',
  /** **第一块地形画出来了**（加载遮罩撤掉）—— 这里的 `playable` 终点 */
  worldPlayable: 'world:playable',
  /** 渐进视距涨到设定值（后台仍在补区块，玩家已经能玩了） */
  worldRampFull: 'world:rampFull',
} as const;

export type StartupPhaseName = (typeof STARTUP_PHASES)[keyof typeof STARTUP_PHASES];

export interface StartupMark {
  name: string;
  /** 相对台账起点的毫秒数 */
  at: number;
}

export class StartupTrace {
  private readonly marksList: StartupMark[] = [];
  private readonly origin: number;

  /**
   * @param now 毫秒时钟（主线程传 `() => performance.now()`；测试传假时钟）
   */
  constructor(private readonly now: () => number) {
    this.origin = now();
  }

  /** 打一个点。同一个名字可以重复打（只记第一次，免得重入把数字弄脏） */
  mark(name: string): number {
    const existing = this.at(name);
    if (existing !== null) return existing;
    const at = this.now() - this.origin;
    this.marksList.push({ name, at });
    return at;
  }

  /** 某个阶段的时间戳（相对起点，毫秒）；没打过点返回 null */
  at(name: string): number | null {
    return this.marksList.find((m) => m.name === name)?.at ?? null;
  }

  /** 两个阶段之间用了多久；任一端没打点返回 null */
  between(from: string, to: string): number | null {
    const a = this.at(from);
    const b = this.at(to);
    if (a === null || b === null) return null;
    return Math.round((b - a) * 10) / 10;
  }

  /** **首次访问的等待**：页面开始脚本 → 主菜单能点 */
  get bootMs(): number | null {
    return this.between(STARTUP_PHASES.bootBegin, STARTUP_PHASES.bootMenu);
  }

  /** **进入世界的等待**：点"创建并进入" → 第一块地形画出来 */
  get playableMs(): number | null {
    return this.between(STARTUP_PHASES.worldBegin, STARTUP_PHASES.worldPlayable);
  }

  /** 按发生顺序的全部点（给验收脚本与调试面板读） */
  get marks(): readonly StartupMark[] {
    return this.marksList;
  }

  /** 一行摘要（日志与验收输出用） */
  summary(): string {
    const boot = this.bootMs;
    const playable = this.playableMs;
    return (
      `boot ${boot === null ? '—' : `${boot}ms`} · playable ${playable === null ? '—' : `${playable}ms`}` +
      ` · ${this.marksList.map((m) => `${m.name}=${Math.round(m.at)}`).join(' ')}`
    );
  }
}

/**
 * 页面那一份（一次启动只有一个启动过程）。
 *
 * ⚠️ 放在 `game/` 而不是 `core/`：它依赖 `performance`（浏览器全局），
 * 而 `core/` 里的模块会被 worker 直接引用。
 */
export const startupTrace = new StartupTrace(() => performance.now());

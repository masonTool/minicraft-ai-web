/**
 * 光照引擎（对齐原版规则）
 *
 * 两种光：
 *  - 天光（skylight）  ：从世界顶部竖直往下，穿透明方块不衰减（"直射天光"保持 15），
 *                       横向/向上每格衰减 1（或按方块 lightOpacity 衰减）。
 *  - 方块光（blocklight）：由发光方块发出，任何方向每格衰减 1。
 *
 * 做法：列扫描初始化 → 播种 BFS → 扩散。队列跨区块共享，所以光能自然流过区块边界；
 * 新区块点亮时会把已点亮邻居的接壤边界重新入队，让邻区的光横向流进来。
 * BFS 可按预算分帧执行，避免一次性阻塞主线程。
 */

import { blockDef, emitLightWithState } from '../registry/blocks.ts';
import { Chunk, SECTION_COUNT, SECTION_HEIGHT, WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

/** 光照引擎需要的世界访问能力（由 World 实现，接口化以避免循环依赖） */
export interface LightAccessor {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  isLoaded(worldX: number, worldZ: number): boolean;
  getChunk(cx: number, cz: number): Chunk | undefined;
  getSkyLight(worldX: number, worldY: number, worldZ: number): number;
  setSkyLight(worldX: number, worldY: number, worldZ: number, value: number): void;
  getBlockLight(worldX: number, worldY: number, worldZ: number): number;
  setBlockLight(worldX: number, worldY: number, worldZ: number, value: number): void;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 四个水平方向 + 对应的边界列偏移 */
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 格坐标打包成一个整数（批次 238，`unlight` 的"重新扩散"去重键）。
 *
 * 为什么必须去重：一块被移除的格子会把**它四周每一个比它亮的邻居**都登记成 reAdd，
 * 而同一个亮格子往往同时挨着 4~6 个被移除的格子 —— 不去重时同一格会被压进去好几次。
 * 真机日志里 `readded` 每 5 秒 40~50 万格，其中相当一部分是这种重复。
 *
 * 位宽：竖直 9 位（-64..319 → 0..383）、水平各 20 位（同一处改动波及的范围远小于 100 万格），
 * 合计 49 位，稳稳落在 `Number.MAX_SAFE_INTEGER` 之内；水平方向 100 万格以外的碰撞
 * 在同一次 BFS 里不可能出现（步数上限 6 万）。
 */
function cellKey(x: number, y: number, z: number): number {
  return ((y + 64) * 0x100000 + (x & 0xfffff)) * 0x100000 + (z & 0xfffff);
}

/**
 * 队列消费后回收空间的阈值：**剩下的元素少于这么多时**才丢掉已消费的前缀。
 *
 * ⚠️ 批次 217：原来的判据是 `head > 24576`（元素数 = 8192 格），它只看"消费了多少"，
 * 不看"还剩多少"。队列一旦涨到几百万格，就变成**每 2~3 帧把几十 MB 的数组 slice 一次**：
 * 真机日志（792×360，光照队列 820 万格）里 `chunks` 段 74ms/帧、堆 1GB、12fps 全是它。
 * 现在按"剩余量"判断：拷贝量 ≤ 12k 个数字，而且一整轮队列只发生一次（均摊 O(1)/格）。
 */
const COMPACT_TAIL = 3 * 4096;

/**
 * **增量任务**的队列上限（格，批次 238）。
 *
 * 为什么要有上限：真机日志（792×360 / Adreno 829）里队列从 2 万格一路涨到 **308 万格**，
 * `readded` 每 5 秒还在灌 50 万格，最后 `spread()` 的 `Array.push` 抛
 * `RangeError: Invalid array length` —— 而主循环是"帧末才排下一帧"的写法，
 * 一抛就把整个渲染循环打死（画面定格、DOM 还能点），只能强退重进。
 *
 * 队列无界就是那颗地雷的土壤，所以给它一个硬上限：
 * **宁可光照暂时不准，也不能拖死主循环。**
 *
 * ⚠️ 区块播种（`self` / `border`）**不受这个上限约束**：那是"加载一个新区块"的确定性工作量，
 * 有界、且一定会被消费完（批次 103 的启动预算就是靠它把"能玩"从 16s 压到 1s）。
 * 受约束的是 `change` / `readded` / `spread` 三条"改方块引发的增量任务"——失控的只会是它们。
 */
export const MAX_PENDING_CELLS = 300_000;

/**
 * 一次增量移除 BFS 的步数上限（格，批次 238）。
 *
 * `onBlockChanged` 每次都要从改动点做一次"清掉下游光"的 BFS。开阔地形/水体里
 * 这片连通区域可以很大（真机里一次改动平均要动上百格），极端情况下能走几十万格，
 * 光这一项就把一帧吃穿。超了就放弃"精确移除"，剩下的交给 reAdd 的边界回填
 * （光会从边界一层层渗回去，结果是"偏暗几帧"而不是"卡死"）。
 */
export const MAX_UNLIGHT_STEPS = 60_000;

/** 入队来源：`self` / `border` 是区块播种，其余是"改方块引发的增量任务" */
export type LightPushKind = 'self' | 'border' | 'change' | 'readded' | 'spread';

/** 队列"谁在灌"的累计计数（批次 217/238，诊断用） */
export interface LightPushStats {
  /** 新区块播种 */
  self: number;
  /** 邻区边界列 */
  border: number;
  /** 改方块引发的自发光/回填 */
  change: number;
  /** 移除 BFS 之后重新扩散的边界格 */
  readded: number;
  /**
   * `spread()` 自己再扩散压进去的（批次 238 新增）。
   *
   * 以前这一路**完全没统计**：日志里看到的 `readded` 只是"种子"，
   * 种子扩散出去又会压进新格，那条链才是队列真正的增量。
   */
  spread: number;
  /** 因为超过队列上限被丢弃的增量任务数 */
  dropped: number;
  /** 因为超过 BFS 步数上限被放弃的移除 BFS 次数 */
  overflow: number;
}

/** 离线测试要把上限调小来验证"超限就丢"，所以留一个覆盖口（默认值就是上面两个常量） */
export interface LightEngineOptions {
  maxPendingCells?: number;
  maxUnlightSteps?: number;
}

export class LightEngine {
  private skyQueue: number[] = [];
  private blockQueue: number[] = [];
  private skyHead = 0;
  private blockHead = 0;
  private readonly maxPendingCells: number;
  private readonly maxUnlightSteps: number;

  private readonly pushes: LightPushStats = {
    self: 0,
    border: 0,
    change: 0,
    readded: 0,
    spread: 0,
    dropped: 0,
    overflow: 0,
  };

  get pushStats(): Readonly<LightPushStats> {
    return this.pushes;
  }

  constructor(
    private readonly world: LightAccessor,
    options: LightEngineOptions = {},
  ) {
    this.maxPendingCells = options.maxPendingCells ?? MAX_PENDING_CELLS;
    this.maxUnlightSteps = options.maxUnlightSteps ?? MAX_UNLIGHT_STEPS;
  }

  get hasWork(): boolean {
    return this.skyHead < this.skyQueue.length || this.blockHead < this.blockQueue.length;
  }

  /** 该维度是否有天光（下界为 false） */
  private skyEnabled = true;

  setSkyEnabled(value: boolean): void {
    this.skyEnabled = value;
  }

  get pendingCells(): number {
    return (this.skyQueue.length - this.skyHead) / 3 + (this.blockQueue.length - this.blockHead) / 3;
  }

  /**
   * **所有入队的唯一出口**（批次 238）。
   *
   * 之前散着 6 处 `queue.push`，上限只能贴在每一处上，漏一处就等于没有；
   * 现在统一走这里，顺带把"谁在灌"的计数也收在一处。
   *
   * 三条增量路径（`change` / `readded` / `spread`）在超过上限时直接丢弃并计 `dropped`；
   * 区块播种（`self` / `border`）不受限，理由见 `MAX_PENDING_CELLS`。
   */
  private enqueue(isSky: boolean, x: number, y: number, z: number, kind: LightPushKind): boolean {
    const seeding = kind === 'self' || kind === 'border';
    if (!seeding && this.pendingCells >= this.maxPendingCells) {
      this.pushes.dropped++;
      return false;
    }
    if (isSky) this.skyQueue.push(x, y, z);
    else this.blockQueue.push(x, y, z);
    this.pushes[kind]++;
    return true;
  }

  /** 对光照有意义的 Y 区间：从最低非空 section 的底，到最高非空 section 之上那一节的顶 */
  private static verticalRange(chunk: Chunk): [number, number] {
    let minSection = SECTION_COUNT;
    let maxSection = -1;
    for (let s = 0; s < SECTION_COUNT; s++) {
      if (chunk.sectionCounts[s]! > 0) {
        if (s < minSection) minSection = s;
        if (s > maxSection) maxSection = s;
      }
    }
    if (maxSection < 0) return [WORLD_MAX_Y - 1, WORLD_MAX_Y - 1];
    return [
      Math.max(WORLD_MIN_Y, Chunk.sectionMinY(minSection)),
      Math.min(WORLD_MAX_Y - 1, Chunk.sectionMinY(maxSection) + SECTION_HEIGHT * 2 - 1),
    ];
  }

  /**
   * 初始化一个区块的光照，并播种需要扩散的格子。
   * 相邻区块若已点亮，其接壤边界会一并重新入队，保证跨区块的光照连续。
   */
  initChunk(chunk: Chunk): void {
    const [minY, maxY] = LightEngine.verticalRange(chunk);

    // 下界没有天光：整片维度只有方块光（荧光石、岩浆），必须跳过天光播种，
    // 否则洞顶之上的"开放天空"会被写满 15 级并顺着洞口漏进洞窟。
    if (this.skyEnabled) this.fillSkyColumns(chunk, maxY);
    this.seedSelf(chunk, minY, maxY);

    for (const [dx, dz] of HORIZONTAL) {
      const neighbor = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (neighbor?.lit) this.seedBorder(neighbor, -dx, -dz);
    }

    chunk.lit = true;
  }

  /**
   * 初始化天光。
   *
   * ⚠️ 高于 maxY 的格子必须也要写满级天光。
   * 曾经的实现只算到 maxY（理由是"那里的格子恒为空气、网格化读不到"），
   * 结果玩家一旦飞到地形之上搭建，那些格子读到的天光是 0，
   * 整片建筑与平台就会永远漆黑——这是实测踩到的 bug。
   */
  private fillSkyColumns(chunk: Chunk, maxY: number): void {
    // 地形之上的开放天空：整片区域都是空气，直接给满级
    for (let y = maxY + 1; y < WORLD_MAX_Y; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setSkyLight(x, y, z, 15);
      }
    }

    // 从区块内容顶部往下逐列推天光
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let level = 15;
        for (let y = maxY; y >= WORLD_MIN_Y; y--) {
          const opacity = blockDef(chunk.get(x, y, z)).lightOpacity;
          if (opacity >= 15) level = 0;
          else level = Math.max(0, level - opacity);
          chunk.setSkyLight(x, y, z, level);
          if (level === 0) break;
        }
      }
    }
  }

  /**
   * 该格的天光是否"还需要往外扩散"——即某个邻居比它暗。
   *
   * 这一步是性能关键：早先的实现把**每个天光 > 1 的格子**都塞进队列，
   * 而开阔天空下整列空气都是 15，一个区块就能塞进 8 万多条无用任务。
   * 地形变高之后（y 可达 244）这个数字还会再涨，队列根本来不及消费，
   * 而网格化又必须等光照队列排空——于是整个世界的网格都生成不出来（实测 489 个区块全部卡住）。
   *
   * 只播种"光会流出去"的边界格子后，平坦开阔的区域一条都不会入队。
   */
  private static needsSpread(chunk: Chunk, x: number, y: number, z: number, level: number): boolean {
    const threshold = level - 1;
    if (x > 0 && chunk.getSkyLight(x - 1, y, z) < threshold) return true;
    if (x < 15 && chunk.getSkyLight(x + 1, y, z) < threshold) return true;
    if (z > 0 && chunk.getSkyLight(x, y, z - 1) < threshold) return true;
    if (z < 15 && chunk.getSkyLight(x, y, z + 1) < threshold) return true;
    if (y > WORLD_MIN_Y && chunk.getSkyLight(x, y - 1, z) < threshold) return true;
    if (y < WORLD_MAX_Y - 1 && chunk.getSkyLight(x, y + 1, z) < threshold) return true;
    return false;
  }

  /** 播种本区块：光会往更暗处扩散的格子 + 发光方块 */
  private seedSelf(chunk: Chunk, minY: number, maxY: number): void {
    const originX = chunk.cx * 16;
    const originZ = chunk.cz * 16;

    for (let y = minY; y <= maxY; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const sky = chunk.getSkyLight(x, y, z);
          if (sky > 1 && LightEngine.needsSpread(chunk, x, y, z, sky)) {
            this.enqueue(true, originX + x, y, originZ + z, 'self');
          }
          const id = chunk.get(x, y, z);
          if (id !== 0) {
            // 发光等级按**状态**取：红石灯亮的时候才发光（灭的时候 0）
            const emit = emitLightWithState(id, chunk.getState(x, y, z));
            if (emit > 0) {
              chunk.setBlockLight(x, y, z, emit);
              this.enqueue(false, originX + x, y, originZ + z, 'self');
            }
          }
        }
      }
    }
  }

  /**
   * 把 neighbor 朝向 (dirX, dirZ) 那一侧的边界列重新入队。
   * 用于新区块加载后，让邻区已有的光横向流进新区块。
   */
  private seedBorder(neighbor: Chunk, dirX: number, dirZ: number): void {
    const [minY, maxY] = LightEngine.verticalRange(neighbor);
    const originX = neighbor.cx * 16;
    const originZ = neighbor.cz * 16;

    // 取出朝向本区块的那一列（x 或 z 固定为 0 或 15）
    const fixedX = dirX === 1 ? 15 : 0;
    const fixedZ = dirZ === 1 ? 15 : 0;

    for (let y = minY; y <= maxY; y++) {
      for (let t = 0; t < 16; t++) {
        const x = dirX !== 0 ? fixedX : t;
        const z = dirZ !== 0 ? fixedZ : t;
        // 只有"邻区这一格比新区块贴边那格更亮"时，光才可能真的流过去（批次 217）。
        // 以前是**无条件**把整列都塞进队列：高地形下一列能有 300+ 行 × 16 列，
        // 一个区块加载就往队列里灌四五千条无用任务，而手机每帧预算只有 4000 步 ——
        // 队列只涨不消，真机日志里涨到 820 万格、`chunks` 段 74ms/帧、12fps。
        const sky = neighbor.getSkyLight(x, y, z);
        if (sky > 1) {
          const across = this.world.getSkyLight(originX + x + dirX, y, originZ + z + dirZ);
          // `sky - 1` 是它能给出的最高值：连这个都不比对面亮，扩散必然什么都不写
          if (sky - 1 > across) {
            this.enqueue(true, originX + x, y, originZ + z, 'border');
          }
        }
        const block = neighbor.getBlockLight(x, y, z);
        if (block > 1) {
          const across = this.world.getBlockLight(originX + x + dirX, y, originZ + z + dirZ);
          if (block - 1 > across) {
            this.enqueue(false, originX + x, y, originZ + z, 'border');
          }
        }
      }
    }
  }

  /** 处理光照队列；返回是否仍有剩余工作 */
  process(budget: number): boolean {
    let steps = 0;
    while (steps < budget && this.spreadOnce(true)) steps++;
    while (steps < budget && this.spreadOnce(false)) steps++;
    this.compact();
    return this.hasWork;
  }

  private spreadOnce(isSky: boolean): boolean {
    const queue = isSky ? this.skyQueue : this.blockQueue;
    const head = isSky ? this.skyHead : this.blockHead;
    if (head >= queue.length) return false;

    const x = queue[head]!;
    const y = queue[head + 1]!;
    const z = queue[head + 2]!;
    if (isSky) this.skyHead += 3;
    else this.blockHead += 3;

    const level = isSky ? this.world.getSkyLight(x, y, z) : this.world.getBlockLight(x, y, z);
    if (level > 1) this.spread(level, x, y, z, isSky);
    return true;
  }

  private spread(level: number, x: number, y: number, z: number, isSky: boolean): void {
    // 队列满了就**一格都不写**（批次 238）：写了却排不进队列，光会停在半路，
    // 结果是一片"看起来像漏光的花斑"；保持原值等它慢慢排空反而更干净。
    if (this.pendingCells >= this.maxPendingCells) return;

    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
      if (!this.world.isLoaded(nx, nz)) continue;

      const opacity = blockDef(this.world.getBlock(nx, ny, nz)).lightOpacity;
      if (opacity >= 15) continue;

      let target = level - Math.max(1, opacity);
      // 竖直向下的直射天光不衰减
      if (isSky && dy === -1 && level === 15 && opacity === 0) target = 15;
      if (target <= 0) continue;

      // 先入队再写：入队被上限拒绝时**不写**，避免"写了一半、扩散不出去"的花斑
      if (isSky) {
        if (target > this.world.getSkyLight(nx, ny, nz) && this.enqueue(true, nx, ny, nz, 'spread')) {
          this.world.setSkyLight(nx, ny, nz, target);
        }
      } else if (target > this.world.getBlockLight(nx, ny, nz) && this.enqueue(false, nx, ny, nz, 'spread')) {
        this.world.setBlockLight(nx, ny, nz, target);
      }
    }
  }

  /**
   * 某个方块发生变化后的增量光照更新。
   *
   * 相比"整块重算"，这里做的是局部修正：
   *  1. 用"光照移除 BFS"清掉该点及其下游依赖它的光（否则放上方块后光会从缝隙漏过去）；
   *  2. 若该点现在透光，重新从上方与四周汇聚光照；
   *  3. 把 6 个邻居重新入队，让它们重新扩散。
   * 队列由 process() 分帧消费，因此这里只做登记，不会阻塞。
   */
  onBlockChanged(worldX: number, worldY: number, worldZ: number): void {
    this.unlight(worldX, worldY, worldZ, true);
    this.unlight(worldX, worldY, worldZ, false);

    const def = blockDef(this.world.getBlock(worldX, worldY, worldZ));
    const opacity = def.lightOpacity;

    // ---- 方块光：自发光方块直接播种。
    // ⚠️ 这一步不能放在"透光"判断里面：荧石、南瓜灯这类方块是**不透光但自发光**的，
    // 若跟着 opacity<15 一起跳过，运行时放下荧石就不会亮（区块生成走的是另一条路径，所以不易察觉）。
    if (def.light > 0) {
      this.world.setBlockLight(worldX, worldY, worldZ, def.light);
      this.enqueue(false, worldX, worldY, worldZ, 'change');
    } else if (opacity < 15) {
      let block = 0;
      for (const [dx, dy, dz] of DIRS) {
        const nx = worldX + dx;
        const ny = worldY + dy;
        const nz = worldZ + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;
        const neighbor = this.world.getBlockLight(nx, ny, nz) - Math.max(1, opacity);
        if (neighbor > block) block = neighbor;
      }
      if (block > 0) {
        this.world.setBlockLight(worldX, worldY, worldZ, block);
        this.enqueue(false, worldX, worldY, worldZ, 'change');
      }
    }

    // ---- 天光：只有透光方块才可能存有天光
    if (opacity < 15) {
      const above = worldY + 1 >= WORLD_MAX_Y ? 15 : this.world.getSkyLight(worldX, worldY + 1, worldZ);
      let sky = 0;
      if (opacity === 0 && above === 15) sky = 15;
      else if (above > 0) sky = Math.max(0, above - Math.max(1, opacity));

      for (const [dx, dy, dz] of DIRS) {
        const nx = worldX + dx;
        const ny = worldY + dy;
        const nz = worldZ + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;
        const neighbor = this.world.getSkyLight(nx, ny, nz);
        if (neighbor <= sky) continue;
        const candidate = neighbor - Math.max(1, opacity);
        if (candidate > sky) sky = candidate;
      }

      if (sky > 0) {
        this.world.setSkyLight(worldX, worldY, worldZ, sky);
        this.enqueue(true, worldX, worldY, worldZ, 'change');
      }
    }

    // ---- 邻居重新扩散：它们可能因为新增遮挡而需要变暗
    for (const [dx, dy, dz] of DIRS) {
      const nx = worldX + dx;
      const ny = worldY + dy;
      const nz = worldZ + dz;
      if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
      if (!this.world.isLoaded(nx, nz)) continue;
      if (this.world.getSkyLight(nx, ny, nz) > 1) this.enqueue(true, nx, ny, nz, 'change');
      if (this.world.getBlockLight(nx, ny, nz) > 0) this.enqueue(false, nx, ny, nz, 'change');
    }
  }

  /**
   * 光照移除 BFS：从 (worldX, worldY, worldZ) 开始，清掉所有"光来自这里"的格子。
   * 遇到比当前链更亮（说明是独立光源）的格子时，把它记到 reAdd 重新扩散。
   */
  private unlight(worldX: number, worldY: number, worldZ: number, isSky: boolean): void {
    const get = isSky
      ? (x: number, y: number, z: number) => this.world.getSkyLight(x, y, z)
      : (x: number, y: number, z: number) => this.world.getBlockLight(x, y, z);
    const set = isSky
      ? (x: number, y: number, z: number, v: number) => this.world.setSkyLight(x, y, z, v)
      : (x: number, y: number, z: number, v: number) => this.world.setBlockLight(x, y, z, v);

    const startLevel = get(worldX, worldY, worldZ);
    set(worldX, worldY, worldZ, 0);
    if (startLevel === 0) return;

    const removal: number[] = [worldX, worldY, worldZ, startLevel];
    const reAdd: number[] = [];
    // 同一格会被四周多个"被移除"的邻居各登记一次，不去重的话 readded 能翻 4~6 倍（批次 238）
    const seen = new Set<number>();
    let steps = 0;

    while (removal.length > 0) {
      // 步数上限（批次 238）：见 `MAX_UNLIGHT_STEPS`。放弃的只是"精确移除"，
      // 已经收进 reAdd 的边界格会把光重新渗回去，所以结果是"偏暗一阵"而不是"卡死"。
      if (++steps > this.maxUnlightSteps) {
        this.pushes.overflow++;
        break;
      }

      const level = removal.pop()!;
      const z = removal.pop()!;
      const y = removal.pop()!;
      const x = removal.pop()!;

      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
        if (!this.world.isLoaded(nx, nz)) continue;

        const neighborLevel = get(nx, ny, nz);
        if (neighborLevel === 0) continue;

        // 天光竖直向下时水平保持 15，所以这里允许"相等"也算继承
        const inherited = isSky && dy === -1 && level === 15 ? 15 : level - 1;
        if (neighborLevel <= inherited) {
          set(nx, ny, nz, 0);
          removal.push(nx, ny, nz, neighborLevel);
        } else {
          const key = cellKey(nx, ny, nz);
          if (seen.has(key)) continue;
          seen.add(key);
          reAdd.push(nx, ny, nz);
        }
      }
    }

    for (let i = 0; i < reAdd.length; i += 3) {
      this.enqueue(isSky, reAdd[i]!, reAdd[i + 1]!, reAdd[i + 2]!, 'readded');
    }
  }

  /** 回收已消费的队列头部，避免数组无限增长 */
  private compact(): void {
    // 只在"队列快见底"时回收前缀（见 `COMPACT_TAIL`）：这样拷贝量恒定、
    // 且一整轮队列只搬一次。队列很长的中途**不搬**——那时搬一次就是几十 MB。
    if (this.skyQueue.length - this.skyHead <= COMPACT_TAIL && this.skyHead > 0) {
      this.skyQueue = this.skyHead >= this.skyQueue.length ? [] : this.skyQueue.slice(this.skyHead);
      this.skyHead = 0;
    }
    if (this.blockQueue.length - this.blockHead <= COMPACT_TAIL && this.blockHead > 0) {
      this.blockQueue = this.blockHead >= this.blockQueue.length ? [] : this.blockQueue.slice(this.blockHead);
      this.blockHead = 0;
    }
  }

  reset(): void {
    this.skyQueue = [];
    this.blockQueue = [];
    this.skyHead = 0;
    this.blockHead = 0;
  }
}

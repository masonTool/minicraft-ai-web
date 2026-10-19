/**
 * 流体流动（B8）
 *
 * 模型（对齐原版的关键点，其余做了合理简化）：
 *  - 每个流体方块的状态字节里存 **液面等级**：0 = 水源，1~7 越流越薄；
 *    最高位是"下落"标记（上方是同一液体，这一格是瀑布的一节）
 *  - 流动优先**向下**：下方能进就往下方流（下落的水不衰减，一直保持 0 级）
 *  - 否则向四个水平方向扩散，等级 +1；水的最大扩散距离 7 格，岩浆 3 格
 *  - **无限水源**：一个流动的水格只要有两个及以上相邻水源，就自己变成水源
 *  - **干涸**：流动的液体如果既没有上方来水、也没有更"厚"的水平邻居，就消失
 *  - 水与岩浆相遇：水源遇岩浆流 → 黑曜石；流动水遇岩浆 → 圆石（原版的经典规则）
 *  - 更新节奏靠**计划刻**（水 5 tick、岩浆 25 tick 一次），不是每 tick 都算
 *
 * 不依赖具体世界：`FluidWorld` 只要求读写方块/状态 + 计划刻回调，因此能离线测。
 */

import { Block, blockDef } from '../registry/blocks.ts';
import {
  fluidLevel,
  isFallingFluid,
  withFallingFluid,
  withFluidLevel,
} from '../registry/blockState.ts';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  SECTION_COUNT,
  SECTION_HEIGHT,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
} from './Chunk.ts';

export const WATER = Block.WATER;
export const LAVA = Block.LAVA;

/** 水的最大水平扩散距离（格） */
export const WATER_SPREAD = 7;
/** 岩浆的最大水平扩散距离（原版主世界是 3 格） */
export const LAVA_SPREAD = 3;

/** 水的流动刻间隔（tick） */
export const WATER_DELAY = 5;
/** 岩浆的流动刻间隔（原版 30，这里略快以便观察） */
export const LAVA_DELAY = 25;

export interface FluidWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  /** 写入流体（含等级状态） */
  setFluid(x: number, y: number, z: number, id: number, state: number): boolean;
  /** 排入计划刻队列 */
  schedule(x: number, y: number, z: number, delayTicks: number): void;
  /**
   * 该 XZ 所在的区块是否已加载（可选）。
   *
   * 区块加载时扫"贴着空气的流体"会查到边界外：未加载区块的 `getBlock` 返回空气，
   * 不挡住的话会把"世界边缘"当成空气，排出一堆注定写不进去的流动刻。
   */
  isLoaded?(worldX: number, worldZ: number): boolean;
}

export function isFluid(id: number): boolean {
  return id === WATER || id === LAVA;
}

/** 液体的最大扩散距离 */
export function spreadDistance(id: number): number {
  return id === LAVA ? LAVA_SPREAD : WATER_SPREAD;
}

/** 流动刻间隔 */
export function flowDelay(id: number): number {
  return id === LAVA ? LAVA_DELAY : WATER_DELAY;
}

/**
 * 这一格能不能被液体占据（空气，或者可被冲掉的非固体方块，如草与花）。
 *
 * 两类**冲不掉**的非固体方块：水里的植物（海带/海草，批次 50——它们本来就长在水里，
 * 被水当成"可替换方块"覆盖掉就成了一放下去就消失）与传送门方块（K8）。
 */
export function canFlowInto(world: FluidWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id === Block.AIR) return true;
  if (isFluid(id)) return false;
  // 传送门（K8）冲不掉：原版水也进不了门方块，否则一条水流就能把一座门冲散
  if (id === Block.NETHER_PORTAL) return false;
  const def = blockDef(id);
  // 水里的植物（批次 50：海带与海草）冲不掉：它们**就是长在水里的**，
  // 而它们是"非固体"，照着下面的规则会被旁边的水当成可替换方块直接覆盖掉——
  // 表现是"海带刚放下去就没了"，而放置逻辑与掉落全都正常。
  if (def.waterPlant) return false;
  return !def.solid;
}

/** 四邻里有几个同种液体的水源 */
function countAdjacentSources(world: FluidWorld, x: number, y: number, z: number, id: number): number {
  let count = 0;
  for (const [dx, dz] of HORIZONTAL) {
    if (world.getBlock(x + dx, y, z + dz) !== id) continue;
    const state = world.getState(x + dx, y, z + dz);
    if (fluidLevel(state) === 0) count++;
  }
  return count;
}

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 这一格流体**现在应该是什么状态**（液面等级 + 下落位）。
 * @returns 状态字节；`null` = 已经失去来源，应当干涸
 *
 * 为什么要"重算"而不是只往空处写：液面其实是"离源头几步"的缓存。
 * 新放一个水源、或者打通一条更短的路之后，**已经在场的水**也得重新算——
 * 否则它会停在旧等级（比如 5 级），只能再走两格，旁边的空位永远填不上。
 *
 * ⚠️ 只允许**变薄**（`best < 当前等级`）：同级/更厚的邻居不是供源。
 * 否则一条断了源的细流会拿旁边的同级格子当供源，一级一级涨上去、永远干不了。
 */
function desiredFluidState(
  world: FluidWorld,
  x: number,
  y: number,
  z: number,
  id: number,
  state: number,
  source: boolean,
): number | null {
  const level = fluidLevel(state);

  // 水源永远是水源（放下去就不会自己没）
  if (source) return state;

  // 上方是同一液体：这一节是瀑布（下落不衰减）
  if (world.getBlock(x, y + 1, z) === id) return withFallingFluid(0, true);

  // 无限水源：两个相邻水源让流动水变成水源
  if (
    id === WATER &&
    world.getBlock(x, y - 1, z) !== WATER &&
    countAdjacentSources(world, x, y, z, id) >= 2
  ) {
    return 0;
  }

  // 水平邻居里**最厚**的那一格决定我：比它多一级
  let best = Number.POSITIVE_INFINITY;
  for (const [dx, dz] of HORIZONTAL) {
    const nx = x + dx;
    const nz = z + dz;
    if (world.getBlock(nx, y, nz) !== id) continue;
    const neighbour = fluidLevel(world.getState(nx, y, nz));
    if (neighbour < best) best = neighbour;
  }
  if (!(best < level)) return null; // 没有更厚的供源 = 已经断源
  const next = best + 1;
  if (next > spreadDistance(id)) return null;
  return withFluidLevel(0, next);
}

/**
 * 方块变化后唤醒流体：**这一格自己**（如果它就是液体）以及四周的液体。
 *
 * ⚠️ 必须包含"自己"：刚放下的那一格水四周还是空气，只唤醒邻居的话
 * 谁都不会被排进计划刻，水就永远是那一格（实测踩过）。
 */
export function wakeFluidAt(world: FluidWorld, x: number, y: number, z: number): number {
  let woken = wakeFluidNeighbours(world, x, y, z);
  const id = world.getBlock(x, y, z);
  if (isFluid(id)) {
    world.schedule(x, y, z, flowDelay(id));
    woken++;
  }
  return woken;
}

/** 唤醒一个位置周围的液体（放/破方块之后调用） */
export function wakeFluidNeighbours(world: FluidWorld, x: number, y: number, z: number): number {
  let woken = 0;
  for (const [dx, dy, dz] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    const id = world.getBlock(nx, ny, nz);
    if (!isFluid(id)) continue;
    world.schedule(nx, ny, nz, flowDelay(id));
    woken++;
  }
  return woken;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 只依赖区块里已有的方块数组；测试可以用普通数组当替身 */
export interface FluidScanChunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: ArrayLike<number>;
  /** 每个 16 高 section 的非空气方块数（用来跳过大片空气） */
  readonly sectionCounts: ArrayLike<number>;
}

/**
 * 区块加载时**补排**计划刻（批次 281）。
 *
 * 地形生成（海洋、地下含水层、岩浆湖）只写方块、不会给它们排计划刻；
 * 于是水/岩浆即使贴着空气（海边、洞穴口、含水层顶）也不会自己流，
 * 必须等玩家在旁边挖一格、`wakeFluidsAround` 把它叫醒。
 *
 * 这里扫一遍区块里**贴着空气的流体**并把它们排进计划刻。只排"暴露"的那一层：
 * 海洋中间那些四面都是水的格子不会进队列，否则一加载区块就会有几千个空转刻。
 *
 * @returns 排进队列的格数（验收/诊断用）
 */
export function scheduleExposedFluids(world: FluidWorld, chunk: FluidScanChunk): number {
  if (chunk.sectionCounts.length < SECTION_COUNT) return 0;
  const baseX = chunk.cx * CHUNK_SIZE_X;
  const baseZ = chunk.cz * CHUNK_SIZE_Z;
  const blocks = chunk.blocks;
  let scheduled = 0;

  for (let section = 0; section < SECTION_COUNT; section++) {
    // 整段都是空气的跳过：绝大多数 section 在加载时都是空的
    if ((chunk.sectionCounts[section] ?? 0) === 0) continue;
    const sectionBase = section * SECTION_HEIGHT;
    for (let ly = 0; ly < SECTION_HEIGHT; ly++) {
      const worldY = WORLD_MIN_Y + sectionBase + ly;
      // 一个 section 里按 y → z → x 连续排；这里把行首下标提到循环外
      const rowBase = (sectionBase + ly) * CHUNK_SIZE_Z * CHUNK_SIZE_X;
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        const index = rowBase + z * CHUNK_SIZE_X;
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const id = blocks[index + x]!;
          if (id !== WATER && id !== LAVA) continue;
          if (!touchesAir(world, chunk, baseX + x, worldY, baseZ + z, x, z)) continue;
          world.schedule(baseX + x, worldY, baseZ + z, flowDelay(id));
          scheduled++;
        }
      }
    }
  }
  return scheduled;
}

/**
 * 这一格流体**下方或四邻**有没有空气（上方不算：水不会往上流）。
 *
 * 只排"流得动"的格子：海洋表面每个水块上方都是空气，但下方/四周都是水，
 * 排进去只会空转；一个区块几百个水面块一起进队列，很容易把 `TickScheduler`
 * 的 4096 容量挤爆，真正该流的边缘反而排不进去。
 *
 * 区块**内部**直接读方块数组（一次数组访问，比 `world.getBlock` 的坐标换算便宜很多）；
 * 边界外才问世界——未加载的邻居当成"不是空气"，避免把世界边缘当洞口。
 */
function touchesAir(
  world: FluidWorld,
  chunk: FluidScanChunk,
  worldX: number,
  worldY: number,
  worldZ: number,
  localX: number,
  localZ: number,
): boolean {
  for (const [dx, dy, dz] of NEIGHBOURS) {
    // 水/岩浆只往下和水平流；上方是空气不代表它会动
    if (dy > 0) continue;
    const nx = localX + dx;
    const nz = localZ + dz;
    const ny = worldY + dy;
    if (ny < WORLD_MIN_Y || ny >= WORLD_MAX_Y) continue;
    if (nx >= 0 && nx < CHUNK_SIZE_X && nz >= 0 && nz < CHUNK_SIZE_Z) {
      const index = ((ny - WORLD_MIN_Y) * CHUNK_SIZE_Z + nz) * CHUNK_SIZE_X + nx;
      if (chunk.blocks[index] === Block.AIR) return true;
      continue;
    }
    // 出了本区块：未加载的邻居不算空气
    if (world.isLoaded && !world.isLoaded(worldX + dx, worldZ + dz)) continue;
    if (world.getBlock(worldX + dx, ny, worldZ + dz) === Block.AIR) return true;
  }
  return false;
}

/**
 * 一次流动刻：处理 (x,y,z) 这一格液体。
 * @returns 是否改动了世界
 */
export function fluidTick(world: FluidWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (!isFluid(id)) return false;

  const state = world.getState(x, y, z);
  const source = fluidLevel(state) === 0 && !isFallingFluid(state);
  let changed = false;

  // ---- 0) 水与岩浆相遇：生成石头类方块（放在最前面，避免两边互相流）
  const reaction = fluidReaction(world, x, y, z, id, source);
  if (reaction !== null) {
    world.setFluid(x, y, z, reaction, 0);
    wakeFluidNeighbours(world, x, y, z);
    return true;
  }

  // ---- 1) 先重算自己（新水源 / 新通路 / 上游断了）
  //
  // ⚠️ 这一步必须**在"向下流"之前**：原来的顺序里，失去源头的瀑布会先走下面那条
  // `return`，永远到不了干涸判定 —— 表现是源头拔掉了、水还在一直往下灌。
  const want = desiredFluidState(world, x, y, z, id, state, source);
  if (want === null) {
    world.setFluid(x, y, z, Block.AIR, 0);
    wakeFluidNeighbours(world, x, y, z);
    return true;
  }
  if (want !== state) {
    world.setFluid(x, y, z, id, want);
    // 液面变了：自己下一 tick 按新等级继续流，邻居也可能因此重排
    world.schedule(x, y, z, flowDelay(id));
    wakeFluidNeighbours(world, x, y, z);
    return true;
  }

  // ---- 2) 优先向下：下方能进就往下灌（下落液体不衰减）
  if (canFlowInto(world, x, y - 1, z)) {
    world.setFluid(x, y - 1, z, id, withFallingFluid(withFluidLevel(0, 0), true));
    world.schedule(x, y - 1, z, flowDelay(id));
    return true;
  }

  // ---- 3) 水平扩散
  const maxSpread = spreadDistance(id);
  const nextLevel = fluidLevel(state) + 1;
  if (nextLevel <= maxSpread) {
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx;
      const nz = z + dz;
      if (!canFlowInto(world, nx, y, nz)) continue;
      world.setFluid(nx, y, nz, id, nextLevel);
      world.schedule(nx, y, nz, flowDelay(id));
      // 新写的一格可能给旁边那条旧水流提供了一条更短的路：只叫醒**明显比自己厚**的
      // 邻居。不能用 `wakeFluidNeighbours`——那会把整片海洋每 5 tick 都排进计划刻，
      // 变成"水永远在重算"。
      for (const [ndx, ndz] of HORIZONTAL) {
        const bx = nx + ndx;
        const bz = nz + ndz;
        if (world.getBlock(bx, y, bz) !== id) continue;
        if (fluidLevel(world.getState(bx, y, bz)) > nextLevel) {
          world.schedule(bx, y, bz, flowDelay(id));
        }
      }
      changed = true;
    }
  }

  return changed;
}

/**
 * 水与岩浆相遇的产物。
 * @returns 要变成的方块 id；没有反应返回 null
 */
function fluidReaction(
  world: FluidWorld,
  x: number,
  y: number,
  z: number,
  id: number,
  source: boolean,
): number | null {
  const other = id === WATER ? LAVA : WATER;
  // 只检查四邻与上方：原版岩浆碰到水就凝固
  let touching = false;
  for (const [dx, dy, dz] of NEIGHBOURS) {
    if (world.getBlock(x + dx, y + dy, z + dz) !== other) continue;
    touching = true;
    break;
  }
  if (!touching) return null;

  if (id === LAVA) {
    // 原版规则：**岩浆源**遇水变黑曜石，流动的岩浆遇水只变圆石
    return source ? Block.OBSIDIAN : Block.COBBLESTONE;
  }
  // 水遇到岩浆：水消失（岩浆那边会变成石头类方块）
  return Block.AIR;
}

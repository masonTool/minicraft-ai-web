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

import { Block, blockDef, canBeWaterlogged } from '../registry/blocks.ts';
import {
  fluidLevel,
  isFallingFluid,
  isWaterlogged,
  withFallingFluid,
  withWaterlogged,
  withFluidLevel,
} from '../registry/blockState.ts';
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
 * 这一格是不是**水的一员**（批次 621 / Q18）。
 *
 * 三种情况算：
 *  - 真的是一格水（`Block.WATER`）；
 *  - 方块本身不能含水 → 不算（整格方块、雪层）；
 *  - **含水方块**（半砖/楼梯/栅栏…的 bit7 置位）→ 算，而且算作**水源**。
 *
 * 为什么含水的台阶要算水源：原版把台阶倒满水之后，它就是一格"实心 + 水"的方块，
 * 旁边的水看到的是一个 0 级的供源，水会从它那里继续往低处流。如果这里只认
 * `Block.WATER`，那么"往台阶上倒水"就成了一条死路 —— 水灌满台阶就停住，
 * 旁边的坑永远填不上，而这正是 Q18 要修的行为。
 *
 * `canBeWaterlogged` 那道判断不是多余：状态字节的 bit7 是**族内复用**的
 * （旗帜的图案、雪层的层数都占高位），万一某族的 bit7 被当别的用，
 * 不查白名单就会把"图案编号 128 的旗帜"当成水源。
 */
export function isWaterAt(world: FluidWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id === WATER) return true;
  if (!canBeWaterlogged(id)) return false;
  return isWaterlogged(world.getState(x, y, z));
}

/**
 * 这一格算不算**0 级供源**（含水源与含水方块）。
 *
 * ⚠️ 与 `isWaterAt` 分开是必须的：`isWaterAt` 回答的是"这里有没有水"（流动水也算），
 * 而供源判据要的是"厚不厚"——**流动的水不是供源**。
 * 第一版直接把 `isWaterAt` 塞进 `countAdjacentSources`，结果流动的水被当成水源，
 * 断源的细流靠同级邻居自己续命、永远干不了，`test:tick` 当场红了两条。
 */
function isWaterSourceAt(world: FluidWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id === WATER) {
    const state = world.getState(x, y, z);
    return fluidLevel(state) === 0 && !isFallingFluid(state);
  }
  if (!canBeWaterlogged(id)) return false;
  // 含水方块恒为"满"：原版的水浸只有 0/1，没有等级概念
  return isWaterlogged(world.getState(x, y, z));
}

/**
 * 这一格能不能被**灌成含水**（批次 621 / Q18）。
 *
 * 原版里"往台阶旁边流水"有两种结果：台阶被**填满水**（保留台阶、bit7 置位），
 * 而不是被水覆盖掉。所以这里要单独一个判据 —— `canFlowInto` 只会说"能不能整个换成液体"。
 *
 * 三个条件缺一不可：
 *  - 必须支持含水（`canBeWaterlogged`）；
 *  - 现在**还没有**含水（已经含水的不用再灌）；
 *  - 是水在灌（岩浆不能把台阶变成"含岩浆的台阶"，本项目没有这个概念）。
 */
export function canFillWaterlogged(world: FluidWorld, x: number, y: number, z: number, id: number): boolean {
  if (id !== WATER) return false;
  const target = world.getBlock(x, y, z);
  if (!canBeWaterlogged(target)) return false;
  return !isWaterlogged(world.getState(x, y, z));
}

/**
 * 把一格灌成含水：**保留方块本身**，只把 bit7 置起来。
 *
 * 用 `setFluid` 而不是另加一个 `setBlock` 到 `FluidWorld` 接口上：底层实现就是
 * `setBlockAndUpdate`（见 `main.ts` 的注入），能写任意 id + 状态；扩接口会让
 * 每个测试 stub 都要跟着改，而这里只是"写一格方块"，没有新语义。
 */
function fillWaterlogged(world: FluidWorld, x: number, y: number, z: number): void {
  const target = world.getBlock(x, y, z);
  world.setFluid(x, y, z, target, withWaterlogged(world.getState(x, y, z), true));
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
    const nx = x + dx;
    const nz = z + dz;
    // 含水方块（批次 621 / Q18）：它是"实心 + 水"的一格，原版把它当 0 级供源。
    // 只对水生效 —— 岩浆没有 waterlogged 这一说。
    if (id === WATER && isWaterSourceAt(world, nx, y, nz)) {
      count++;
      continue;
    }
    if (world.getBlock(nx, y, nz) !== id) continue;
    if (fluidLevel(world.getState(nx, y, nz)) === 0) count++;
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
    // 含水方块算 0 级供源（批次 621 / Q18）：漏了这一句，水会绕着台阶流过去、
    // 却不肯承认台阶是水源，结果是"台阶边上的水慢慢干涸"。
    // 注意用 `isWaterSourceAt` 而不是 `isWaterAt`：后者对"一格流动的水"也返回 true，
    // 那会让同级邻居互相当供源（回归见该函数的注释）。
    if (id === WATER && isWaterSourceAt(world, nx, y, nz) && world.getBlock(nx, y, nz) !== WATER) {
      best = 0;
      break;
    }
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

/**
 * 一次流动刻：处理 (x,y,z) 这一格液体。
 * @returns 是否改动了世界
 */
export function fluidTick(world: FluidWorld, x: number, y: number, z: number): boolean {
  const rawId = world.getBlock(x, y, z);
  // 含水方块（批次 621 / Q18）：它不是流体，但**要参与扩散**——
  // 原版往半砖里倒满水之后，水会从半砖那里继续往旁边的坑流。
  // 所以这里把含水方块统一当成 `WATER` 往下跑；写回时靠 `fillWaterlogged` 保留方块本身。
  const waterloggedBlock = !isFluid(rawId) && isWaterAt(world, x, y, z);
  if (!isFluid(rawId) && !waterloggedBlock) return false;
  const id = waterloggedBlock ? WATER : rawId;

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
  //
  // ⚠️ **含水方块要跳过重算**（批次 621 / Q18）：它不是"会产生液面等级的水"，
  // 而是"一个含水的方块"。照着水源那条路走会把状态覆盖成 0 级水，
  // 或者在某些条件下判成"断源"、直接写 `Block.AIR` —— 两种都会**把台阶毁掉**。
  // 它作为供源这件事已经在 `countAdjacentSources` / `desiredFluidState` 里表达过了。
  if (!waterloggedBlock) {
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
  }

  // ---- 2) 优先向下：下方能进就往下灌（下落液体不衰减）
  //
  // 「能进」有两种：整格换成液体，或者把台阶/栅栏之类**灌成含水**（Q18）。
  // 后者保留方块本身，只置 bit7 —— 这条分支必须在水流真正扩散之前试，
  // 否则水会绕过台阶继续往前，台阶永远是干的。
  if (canFillWaterlogged(world, x, y - 1, z, id)) {
    fillWaterlogged(world, x, y - 1, z);
    world.schedule(x, y - 1, z, flowDelay(id));
    return true;
  }
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
      // 含水方块：灌满它（保留方块），不要跳过 —— 跳过就等于"水流被半砖挡住"，
      // 而原版的水是从半砖上漫过去的（Q18）。
      if (canFillWaterlogged(world, nx, y, nz, id)) {
        fillWaterlogged(world, nx, y, nz);
        world.schedule(nx, y, nz, flowDelay(id));
        changed = true;
        continue;
      }
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

/**
 * 下落方块（B8 尾巴 / 批次 543）
 *
 * 原版里沙子、红沙、沙砾、混凝土粉末与**脚手架**在**下方失去支撑**时是实体：
 * 会掉下去、能被推动、落地变成方块、砸到生物有伤害。本项目以前把它们当普通静态方块，
 * 于是"抽掉沙柱底下的方块，上面整柱悬空"——这是方块物理里最容易被玩家发现的一条差异。
 *
 * 这里**不新建渲染实体**：每 0.1 秒把方块往下挪一格，走的是现有的
 * `World.setBlock` → `onBlockChanged` → 区块重建那条路。代价是下落是"一格一格"的
 * 离散动画，不是原版那种平滑下落；好处是不用为它再开一套实体渲染与存档，
 * 也不会与现有的实体池/网络同步打架。
 *
 * 三条与原版的差异（都记进 TASKS B8）：
 *  1. **离散下落**（每 0.1 秒一格），没有加速度与平滑插值；
 *  2. 落地时**不会砸伤生物**，也不会把掉落的方块变成掉落物（原版砸在非固体上会掉物品）；
 *  3. **不持久化**：存档只存方块，读档时若恰好停在半空，要等下一次邻居变化才会继续掉。
 */

import { Block, CONCRETE_POWDER_ID_START, blockDef } from '../registry/blocks.ts';

/** 每下落一格需要的时间（秒）：10 格/秒，肉眼能看出在掉，又不至于一帧穿过地面 */
export const FALL_STEP_SECONDS = 0.1;

/** 一次 tick 内最多推进多少格（防止切后台回来 dt 很大时瞬间刷穿世界） */
const MAX_STEPS_PER_TICK = 32;

/** 世界下限（1.18：Y ∈ [-64, 320)） */
const MIN_Y = -64;
const MAX_Y = 319;

/** 这些方块在失去支撑时会下落 */
export function isFallingBlock(id: number): boolean {
  if (id === Block.SAND || id === Block.RED_SAND || id === Block.GRAVEL) return true;
  // 脚手架（批次 554）：原版拆掉底下一节，上面整片会跟着掉；
  // 这里复用同一套"一格一格下落"，观感与沙子一致
  if (id === Block.SCAFFOLDING) return true;
  // 16 色混凝土粉末：id 连续，落在 [START, START+16)
  return id >= CONCRETE_POWDER_ID_START && id < CONCRETE_POWDER_ID_START + 16;
}

export interface FallingWorld {
  getBlock(x: number, y: number, z: number): number;
  getBlockState(x: number, y: number, z: number): number;
  /** @returns 写入成功（区块未加载时返回 false） */
  setBlock(x: number, y: number, z: number, id: number, state?: number): boolean;
}

interface FallingEntry {
  x: number;
  y: number;
  z: number;
  id: number;
  state: number;
  /** 距离下一格还差多少秒 */
  timer: number;
}

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * 正在下落的方块表。
 *
 * 用法（主程序）：
 *  - 方块变动后调用 `wakeAfterChange(world, x, y, z)`——它会看"这一格自己"与"上面那一格"；
 *  - 每帧调用 `tick(world, dt)` 推进下落。
 */
export class FallingBlocks {
  private readonly entries = new Map<string, FallingEntry>();

  /** 当前有多少块正在下落（调试/断言用） */
  get pending(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * 方块变动后唤醒该醒的下落方块。
   *
   * 两个方向都要看：
   *  - **自己**：玩家把沙子放在半空（或活塞把支撑推走）；
   *  - **上面那一格**：抽掉沙柱底下那格，上面的沙子失去支撑。
   */
  wakeAfterChange(world: FallingWorld, x: number, y: number, z: number): void {
    this.wake(world, x, y, z);
    this.wake(world, x, y + 1, z);
  }

  /**
   * 让某一格（如果是下落方块且没支撑）开始下落。
   * @returns 是否登记了一块
   */
  wake(world: FallingWorld, x: number, y: number, z: number): boolean {
    if (y <= MIN_Y || y > MAX_Y) return false;
    const id = world.getBlock(x, y, z);
    if (!isFallingBlock(id)) return false;
    // 已经稳稳落在支撑上：不登记（也顺手把同坐标的旧记录清掉，
    // 例如一块沙子被活塞推回去之后又被放回来）
    if (this.isSupported(world, x, y, z)) {
      this.entries.delete(keyOf(x, y, z));
      return false;
    }
    const key = keyOf(x, y, z);
    const existing = this.entries.get(key);
    if (existing) {
      // 同一格可能被换成另一种下落方块（沙子 → 沙砾）；状态跟着世界走
      existing.id = id;
      existing.state = world.getBlockState(x, y, z);
      return true;
    }
    this.entries.set(key, {
      x,
      y,
      z,
      id,
      state: world.getBlockState(x, y, z),
      timer: 0,
    });
    return true;
  }

  /**
   * 推进所有下落方块。
   * @returns 这一帧移动了多少格（测试/调试用）
   */
  tick(world: FallingWorld, dt: number): number {
    if (!(dt > 0) || this.entries.size === 0) return 0;
    let moves = 0;
    // 从低到高处理：下面那块先落，上面那块才不会"每一帧都撞在还没让开的格子上"
    const list = [...this.entries.values()].sort((a, b) => a.y - b.y);
    for (const entry of list) {
      // 世界已经变了（被挖掉/被替换）：这条记录作废
      if (world.getBlock(entry.x, entry.y, entry.z) !== entry.id) {
        this.entries.delete(keyOf(entry.x, entry.y, entry.z));
        continue;
      }
      entry.timer += dt;
      let steps = 0;
      while (entry.timer >= FALL_STEP_SECONDS && steps < MAX_STEPS_PER_TICK) {
        entry.timer -= FALL_STEP_SECONDS;
        steps++;
        if (!this.stepDown(world, entry)) break;
        moves++;
      }
      if (steps >= MAX_STEPS_PER_TICK) entry.timer = 0;
    }
    return moves;
  }

  /** 往下走一格；落到底/被挡住返回 false */
  private stepDown(world: FallingWorld, entry: FallingEntry): boolean {
    const belowY = entry.y - 1;
    // 到世界底：直接消失（原版会掉进虚空）
    if (belowY < MIN_Y) {
      world.setBlock(entry.x, entry.y, entry.z, Block.AIR, 0);
      this.entries.delete(keyOf(entry.x, entry.y, entry.z));
      return false;
    }
    const below = world.getBlock(entry.x, belowY, entry.z);
    if (blockDef(below).solid) {
      // 落地：方块已经在 `entry.y` 那一格了，删掉记录即可
      this.entries.delete(keyOf(entry.x, entry.y, entry.z));
      // 上面那一柱可能因此悬空（拆掉中间那格的情况在 `wakeAfterChange` 里已经唤醒过）
      this.wake(world, entry.x, entry.y + 1, entry.z);
      return false;
    }

    const oldKey = keyOf(entry.x, entry.y, entry.z);
    if (!world.setBlock(entry.x, entry.y, entry.z, Block.AIR, 0)) {
      this.entries.delete(oldKey);
      return false;
    }
    if (!world.setBlock(entry.x, belowY, entry.z, entry.id, entry.state)) {
      this.entries.delete(oldKey);
      return false;
    }

    entry.y = belowY;
    this.entries.delete(oldKey);
    this.entries.set(keyOf(entry.x, entry.y, entry.z), entry);
    // 原来在头顶那一格的下落方块现在悬空了（沙柱整体下落）
    this.wake(world, entry.x, entry.y + 2, entry.z);
    return true;
  }

  /** 下方是不是实心方块（与原版 `FallingBlock` 的落地判据同口径：认 `solid`） */
  private isSupported(world: FallingWorld, x: number, y: number, z: number): boolean {
    if (y - 1 < MIN_Y) return false;
    return blockDef(world.getBlock(x, y - 1, z)).solid;
  }
}

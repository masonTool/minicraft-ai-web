/**
 * 雷电与避雷针（批次 83）
 *
 * 这一批补的是红石元件表里**最后一件纯机制件**：避雷针。
 * 它的输出不由玩家开关决定，而由**天气**决定——所以真正的活是"把雷电接到天气系统上"：
 * 雷暴里随机打雷 → 落点判定（避雷针会替附近的人挨这一下）→ 伤害 / 点火 / 红石脉冲。
 *
 * 分成三层，与项目里其它"世界机制"同一条口径：
 *  1. **规则**（本文件）：落点选择、杆头坐标、脉冲表——纯函数/纯类，离线可断言；
 *  2. **副作用**（`main.ts`）：伤害实体、点火、粒子与音效、给电路重算；
 *  3. **红石判定**（`RedstoneEngine`）：引擎通过注入的 `isRodPowered?()` 问一句
 *     "这一格现在通不通电"，**自己不产生事件**（与阳光传感器问 `getSkyLight` 同一条）。
 *
 * ⚠️ 与原版的差异（记在 TASKS B15）：
 *  - 雷不会把猪变成僵尸猪灵、把村民变成女巫、把苦力怕充能（那几种生物/机制都还没有）；
 *  - 原版雷击只打最高点、并且会先"找一片云"，这里是"在玩家周围 8~32 格随机挑一列、
 *    打到那一列的地表"（观感一致，但不是逐位对齐）；
 *  - 闪电的视觉是一根竖直的亮柱 + 一圈粒子（原版是分叉的模型）；
 *  - 避雷针**不会氧化**（原版是四档铜，本项目不做）。
 */

import { Block, blockDef } from '../registry/blocks.ts';
import { sixFacingOf } from '../registry/blockState.ts';
import { ROD_LENGTH } from '../registry/blockShapes.ts';

/** 避雷针替玩家挨雷的范围（原版 128 格） */
export const ROD_ATTRACT_RANGE = 128;
/** 雷击点离玩家的最近 / 最远距离（方块） */
export const MIN_STRIKE_DISTANCE = 8;
export const MAX_STRIKE_DISTANCE = 32;
/** 被雷劈的伤害（原版 5 颗心 = 10 点，**无视护甲**） */
export const LIGHTNING_DAMAGE = 10;
/** 伤害范围（以落点为中心的立方半边长；原版约 4 格半径） */
export const LIGHTNING_DAMAGE_RADIUS = 3;
/** 避雷针被劈中之后输出 8 tick = 0.4 秒（原版） */
export const ROD_PULSE_SECONDS = 0.4;
/** 雷暴里两次打雷之间的间隔区间（秒）——原版是"每 tick 小概率"，这里折成节奏 */
export const STRIKE_INTERVAL_MIN = 4;
export const STRIKE_INTERVAL_MAX = 16;

export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 一次雷击的落点 */
export interface StrikeTarget {
  /** 落点那一格 */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 是不是打中了避雷针（打中杆就不点火，而是给红石脉冲） */
  readonly rod: boolean;
}

/**
 * 选一次雷击的落点。
 *
 * 两条分支（原版也是这个结构）：
 *  1. **128 格内有避雷针** → 打**离玩家最近的那一根**（避雷针的全部意义就在这里）；
 *  2. 否则 → 在玩家周围 8~32 格随机挑一列。`y` 留给调用方按那一列的地表填，
 *     因为"地表在哪"是高度图/生成器的知识，不属于这条规则。
 *
 * `random` 是注入的：离线测试用固定序列钉住边界（0 → 最近距离、1−ε → 最远距离）。
 */
export function pickStrike(
  random: () => number,
  player: Position,
  rods: readonly Position[],
): StrikeTarget | null {
  let best: Position | null = null;
  let bestDistance = Infinity;
  for (const rod of rods) {
    const dx = rod.x + 0.5 - player.x;
    const dy = rod.y + 0.5 - player.y;
    const dz = rod.z + 0.5 - player.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > ROD_ATTRACT_RANGE) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rod;
    }
  }
  if (best) return { x: best.x, y: best.y, z: best.z, rod: true };

  const angle = random() * Math.PI * 2;
  const distance = MIN_STRIKE_DISTANCE + random() * (MAX_STRIKE_DISTANCE - MIN_STRIKE_DISTANCE);
  return {
    x: Math.floor(player.x + Math.cos(angle) * distance),
    y: 0, // 调用方填（先取 x/z，再按那一列找地表）
    z: Math.floor(player.z + Math.sin(angle) * distance),
    rod: false,
  };
}

/**
 * 避雷针的**杆头**在世界坐标里的位置：闪电的视觉终点与"打在哪儿"都按它算。
 *
 * 朝向是共享六向编码里的"伸出方向"，所以杆头就在那一侧的 6/16 处：
 * 朝上 → `y + 6/16`；朝东 → 贴着西边那块方块、往东伸到格子的 6/16 处。
 */
export function rodTipPoint(x: number, y: number, z: number, state: number): Position {
  switch (sixFacingOf(state)) {
    case 'up':
      return { x: x + 0.5, y: y + ROD_LENGTH, z: z + 0.5 };
    case 'down':
      return { x: x + 0.5, y: y + 1 - ROD_LENGTH, z: z + 0.5 };
    // ⚠️ 水平四向是**数字**（`Facing` = 北 0 / 东 1 / 南 2 / 西 3），竖直那两档才是字符串
    case 1: // 东
      return { x: x + ROD_LENGTH, y: y + 0.5, z: z + 0.5 };
    case 3: // 西
      return { x: x + 1 - ROD_LENGTH, y: y + 0.5, z: z + 0.5 };
    case 2: // 南
      return { x: x + 0.5, y: y + 0.5, z: z + ROD_LENGTH };
    case 0: // 北
    default:
      return { x: x + 0.5, y: y + 0.5, z: z + 1 - ROD_LENGTH };
  }
}

/**
 * 这一格该不该被点燃（雷劈地面时）。
 *
 * 判据只留一条：落点是**空气**、且**下面是实心方块**——那正是"火能立住"的条件
 * （`Fire.ts` 里用的是同一条）。避雷针被打中时**不点火**：它的存在意义就是把这一下接走。
 */
export function shouldIgnite(blockId: number, belowId: number): boolean {
  if (blockId !== Block.AIR) return false;
  return blockDef(belowId).solid;
}

/**
 * 避雷针的脉冲表。
 *
 * ⚠️ 与 TNT 的引信同一条取舍：**不进方块状态、也不进存档**。
 * "被劈中"是 0.4 秒的过程，而方块状态是"这东西现在是什么样"——两者的生命周期差一个数量级。
 * 方块状态里只写一个 `powered` 位（红石灯的读法，也让调试看得见），
 * 真正的倒计时在这里。
 *
 * 用法（`main` 的每帧）：
 * ```ts
 * for (const pos of pulses.tick(dt)) redstone.onBlockChanged(world, pos.x, pos.y, pos.z);
 * ```
 * ——**过期时**要主动喊一次重算，否则电路会一直亮着（"外部世界的量必须有人主动去看"）。
 */
export class RodPulses {
  private readonly remaining = new Map<string, number>();

  /** 这一格现在有没有输出（红石引擎每轮都问它） */
  isPowered(x: number, y: number, z: number): boolean {
    return this.remaining.has(`${x},${y},${z}`);
  }

  /** 被劈中：开始（或续上）一段脉冲 */
  pulse(x: number, y: number, z: number, seconds = ROD_PULSE_SECONDS): void {
    this.remaining.set(`${x},${y},${z}`, seconds);
  }

  /** 递减；返回**这一帧刚刚熄灭**的位置（调用方要拿它们重算电路） */
  tick(dt: number): Position[] {
    const expired: Position[] = [];
    for (const [key, left] of this.remaining) {
      const next = left - dt;
      if (next > 0) {
        this.remaining.set(key, next);
        continue;
      }
      this.remaining.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      expired.push({ x: x!, y: y!, z: z! });
    }
    return expired;
  }

  /** 当前有几根在输出（调试面板与验收脚本用） */
  get activeCount(): number {
    return this.remaining.size;
  }

  clear(): void {
    this.remaining.clear();
  }
}

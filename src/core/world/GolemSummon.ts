/**
 * 铁傀儡的召唤形状（批次 472，J24 的第一半）
 *
 * 原版的摆法是一竖一横两笔：
 *
 * ```text
 *       南瓜          ← 玩家放的最后一块
 *       铁块          ← y-1（中间那块）
 *   铁块 铁块 铁块     ← y-2（一排三块）
 * ```
 *
 * 横排既可以沿 X 也可以沿 Z，所以判据要试两个方向——`GolemAxis` 就是
 * "这一座是哪个方向摆的"，调用方据此决定清哪五格、把傀儡放在哪。
 *
 * ⚠️ 原版允许"雕刻过的南瓜"与"南瓜灯"，本项目只有普通南瓜（213），
 * 所以只认那一种；将来加了南瓜灯，往 `isGolemHead` 里加一行即可。
 *
 * 这个模块刻意做成**纯函数**（只吃 `getBlock`）：形状判定是玩家最容易猜错的一条
 * 规则，能离线断言比在游戏里试要可靠得多。
 */

/** 铁傀儡的横排方向（'x' = 三块铁块沿 X 排开，'z' = 沿 Z） */
export type GolemAxis = 'x' | 'z';

export interface GolemPattern {
  /** 横排方向 */
  readonly axis: GolemAxis;
  /** 南瓜那一格的坐标（= 传进来的 x/y/z） */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 这一块能不能当铁傀儡的头（原版：南瓜 / 雕刻南瓜 / 南瓜灯） */
export function isGolemHead(id: number, pumpkinId: number): boolean {
  return id === pumpkinId;
}

/**
 * 判断 `(x, y, z)` 这一格是不是铁傀儡的"头"，且下面摆好了 4 块铁块。
 *
 * @param getBlock 方块读取（世界或假数据都能传）
 * @param pumpkinId 南瓜的方块 id（由调用方传，避免这一层 import 方块注册表）
 * @param ironBlockId 铁块的 id
 * @returns 摆法（含方向）；不成立返回 null
 */
export function ironGolemPatternAt(
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  pumpkinId: number,
  ironBlockId: number,
): GolemPattern | null {
  if (!isGolemHead(getBlock(x, y, z), pumpkinId)) return null;
  // 头正下方那块（y-1）必须是铁块
  if (getBlock(x, y - 1, z) !== ironBlockId) return null;

  // 两排三块：先试沿 X，再试沿 Z
  for (const axis of ['x', 'z'] as const) {
    const dx = axis === 'x' ? 1 : 0;
    const dz = axis === 'z' ? 1 : 0;
    const left = getBlock(x - dx, y - 2, z - dz);
    const middle = getBlock(x, y - 2, z);
    const right = getBlock(x + dx, y - 2, z + dz);
    if (left === ironBlockId && middle === ironBlockId && right === ironBlockId) {
      return { axis, x, y, z };
    }
  }
  return null;
}

/**
 * 村庄守卫的生成判据（批次 472 的第二半）：**3 个村民 + 3 张床**。
 *
 * 本项目村民是按床生成的（`VillagePopulation`），所以"附近有 3 个村民"已经
 * 蕴含"3 张床"；这里只再要求**附近还没有铁傀儡**，否则每加载一次区块就多一只。
 *
 * @param villagers 半径内活着的村民数
 * @param golems 半径内活着的铁傀儡数
 * @param maxGolems 一个村庄最多几只（原版也是 1）
 */
export function shouldSpawnVillageGolem(villagers: number, golems: number, maxGolems = 1): boolean {
  return villagers >= 3 && golems < maxGolems;
}

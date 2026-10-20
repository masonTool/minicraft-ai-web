/**
 * 潮涌核心（批次 547）
 *
 * 原版的潮涌核心不是"放下就生效"：它要求
 *  1. 泡在水里；
 *  2. 周围有一圈**海晶石类方块**（海晶石 / 海晶石砖 / 暗海晶石 / 海灯）；
 *  3. 框架越大，作用半径越大（16 / 30 / 42 块 → 32 / 48 / 64 格）。
 *
 * 这里只做**判定**：框架层数、半径、是否在水里。真正给玩家挂 `conduit_power`
 * 的是主程序（它拿着效果表与玩家位置）。做成纯函数是为了能离线断言
 * "3×3×3 的框够不够 16 块、5×5×5 够不够 30 块"这类边界。
 *
 * ⚠️ 与原版的差异：**不做"攻击水生生物"的脉冲**（原版会周期性伤害附近的水生怪），
 * 也不要求框架的每个面都完整——只数外壳里的海晶石方块数量。
 */

import { Block, blockDef } from '../registry/blocks.ts';

/** 三个档位的框架方块下限（原版） */
export const CONDUIT_FRAME_THRESHOLDS = [16, 30, 42] as const;
/** 三个档位的作用半径（格） */
export const CONDUIT_RADII = [32, 48, 64] as const;

/** 海晶石家族：只有这四种算框架 */
export function isConduitFrameBlock(id: number): boolean {
  return (
    id === Block.PRISMARINE ||
    id === Block.PRISMARINE_BRICKS ||
    id === Block.DARK_PRISMARINE ||
    id === Block.SEA_LANTERN
  );
}

export interface ConduitWorld {
  getBlock(x: number, y: number, z: number): number;
}

/**
 * 数一数以 (x,y,z) 为中心、半径 `radius` 的**外壳**里有几块海晶石。
 *
 * 外壳 = 立方体里"至少有一个坐标在边界上"的格子；中心那一格不数（它是核心本身）。
 */
export function countConduitFrame(world: ConduitWorld, x: number, y: number, z: number, radius: number): number {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        if (isConduitFrameBlock(world.getBlock(x + dx, y + dy, z + dz))) count++;
      }
    }
  }
  return count;
}

/**
 * 潮涌核心的激活档位与半径。
 *
 * @returns 0 = 没激活；1~3 = 档位（半径见 `CONDUIT_RADII`）
 */
export function conduitTier(world: ConduitWorld, x: number, y: number, z: number): 0 | 1 | 2 | 3 {
  if (world.getBlock(x, y, z) !== Block.CONDUIT) return 0;
  // 必须泡在水里。⚠️ 3×3×3 的框架会把核心的六个面全包住，所以不能只看六个邻居：
  // 再往上看 4 格（3/5/7 三档的框架顶面分别在 +1/+2/+3，+4 一定在框架外）。
  const liquid = (bx: number, by: number, bz: number): boolean => blockDef(world.getBlock(bx, by, bz)).liquid;
  let water = liquid(x, y + 4, z);
  if (!water) {
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      if (liquid(x + dx, y + dy, z + dz)) {
        water = true;
        break;
      }
    }
  }
  if (!water) return 0;

  // 从大框往小框数：大框满足就直接取最高档
  // 每一档只看**对应半径那一层外壳**，不能把内层也累加进去：
  // 5×5×5 的外壳本身就有 98 块，累加会让它误判成 7×7×7 档
  for (let radius = 3; radius >= 1; radius--) {
    if (countConduitFrame(world, x, y, z, radius) >= CONDUIT_FRAME_THRESHOLDS[radius - 1]!) {
      return radius as 1 | 2 | 3;
    }
  }
  return 0;
}

/** 激活档位对应的作用半径；未激活返回 0 */
export function conduitRadius(world: ConduitWorld, x: number, y: number, z: number): number {
  const tier = conduitTier(world, x, y, z);
  return tier === 0 ? 0 : CONDUIT_RADII[tier - 1]!;
}

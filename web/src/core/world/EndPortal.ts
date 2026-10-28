/**
 * 末地传送门（K9 收口，批次 111）
 *
 * 在这之前，"去末地"只有一条调试键（`N` / 命令）——`Block.END_PORTAL_FRAME`
 * 与 `Block.END_PORTAL` 早就在注册表里、要塞也早就会生成，但**没有末影之眼、
 * 框架也不会被点亮**，所以生存里根本走不到（TASKS K9 写的"末地没有正门"）。
 *
 * 这一件东西是**一格一套的纯逻辑**，世界通过 `EndPortalWorld` 接口接触，
 * 因此可以离线断言（见 `tools/endportal-test.ts`）。对齐原版的地方：
 *
 *  - **12 格框架围成一圈**：中心 3×3 是传送门，框架在 5×5 的外圈上**去掉四个角**
 *    （四角在原版是空的），而且**必须在同一层 y**；
 *  - **框架里要有眼睛**：每格框架的状态位记着"插没插眼"（见 `blockState.ts` 的
 *    `withEndPortalEye`）——12 格全插满，中间 3×3 才亮起来；
 *  - **点亮之后往框架里再按眼睛**不重复做任何事（幂等）；
 *  - **拆掉任意一格框架，中间那 3×3 就灭掉**（原版如此：眼睛掉了、门也塌了）；
 *  - **末地那一侧有一块 5×5 的黑曜石到达平台**（原版在 (100, 50, 0)），
 *    而不是把人直接扔到末影龙脸上；
 *  - **从末地回主世界**落在**世界出生点**（原版也是回主世界的出生点/床）。
 *
 * ⚠️ 与原版的差异（写进 TASKS K9）：
 *  - **没有末影之眼投掷**（原版扔出去会飞向最近的要塞）——本项目还没有
 *    "带飞行轨迹的投掷物"这一档，找要塞只能靠走；
 *  - **框架不存朝向**：原版的框架有 `facing`（眼睛朝内），本项目只用一位存"有没有眼睛"，
 *    所以 12 格的朝向在存档里读不出来（视觉上也看不出来：框架的贴图不区分朝向）；
 *  - 到达平台**每次到达都重建**（原版只在"第一次生成平台"时插值，玩家搭的东西会被清掉
 *    ——与传送门落地时"目标点整片实心就新建一座门"是同一条取舍）。
 */

import { Block } from '../registry/blocks.ts';
import { hasEndPortalEye } from '../registry/blockState.ts';
// 只用类型：`import type` 让运行时完全不牵扯生成器（`gen/` 那边会反过来引用本文件，
// 用值导入就会形成环）
import type { DimensionId } from '../gen/Dimension.ts';

/** 末地传送门逻辑看到的世界（与 `PortalWorld` 同形，所以 App 里可以共用同一份适配器） */
export interface EndPortalWorld {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  /** 不实现就当全 0（没有眼睛） */
  getState?(worldX: number, worldY: number, worldZ: number): number;
  /** @returns 是否写入成功（区块未加载时应当返回 false） */
  setBlock(worldX: number, worldY: number, worldZ: number, id: number, state?: number): boolean;
}

/** 中间那圈传送门方块的边长（原版 3×3） */
export const END_PORTAL_INNER = 3;

/**
 * 12 格框架相对**中心**的水平偏移（原版那圈 5×5 去掉四个角）。
 *
 * 只在世界坐标的**同一层 y** 上——原版就是一圈平铺在地上的框架。
 */
export const END_PORTAL_RING: readonly (readonly [number, number])[] = (() => {
  const out: Array<readonly [number, number]> = [];
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      if (edge && !corner) out.push([dx, dz] as const);
    }
  }
  return out;
})();

/** 中间 3×3 那九格（点亮之后填的就是它们） */
export function endPortalCells(cx: number, cy: number, cz: number): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) cells.push([cx + dx, cy, cz + dz]);
  }
  return cells;
}

/** 12 格框架的世界坐标 */
export function endRingCells(cx: number, cy: number, cz: number): Array<[number, number, number]> {
  return END_PORTAL_RING.map(([dx, dz]) => [cx + dx, cy, cz + dz] as [number, number, number]);
}

const stateAt = (world: EndPortalWorld, x: number, y: number, z: number): number => world.getState?.(x, y, z) ?? 0;

/** 这一格是不是"插了眼"的框架 */
export function isEyedFrame(world: EndPortalWorld, x: number, y: number, z: number): boolean {
  if (world.getBlock(x, y, z) !== Block.END_PORTAL_FRAME) return false;
  return hasEndPortalEye(stateAt(world, x, y, z));
}

/** 12 格框架是不是**全插满了眼睛** */
export function isRingComplete(world: EndPortalWorld, cx: number, cy: number, cz: number): boolean {
  return endRingCells(cx, cy, cz).every(([x, y, z]) => isEyedFrame(world, x, y, z));
}

/**
 * 把中间 3×3 填成传送门方块；@returns **真正改动了几格**
 * （本来就亮着的格跳过——`setBlockAndUpdate` 每次都会重算光照与网格，
 * 重复写 9 格纯属白干；而"这一下是不是它点亮的"也正是靠这个数区分）。
 */
export function fillEndPortal(world: EndPortalWorld, cx: number, cy: number, cz: number): number {
  let filled = 0;
  for (const [x, y, z] of endPortalCells(cx, cy, cz)) {
    if (world.getBlock(x, y, z) === Block.END_PORTAL) continue;
    if (world.setBlock(x, y, z, Block.END_PORTAL, 0)) filled++;
  }
  return filled;
}

/**
 * 从**任意一格框架**出发，找出它所在的圈心；不在任何完整的圈上则返回 null。
 *
 * 做法是"把 12 个偏移都当一次答案试"：框架与中心的相对位置只有这 12 种可能，
 * 试完就完了（12 个候选 × 12 次读方块，只在"按眼睛"那一下跑一次，开销可以忽略）。
 */
export function ringCenterAt(world: EndPortalWorld, x: number, y: number, z: number): [number, number, number] | null {
  for (const [ox, oz] of END_PORTAL_RING) {
    const cx = x - ox;
    const cz = z - oz;
    if (isRingComplete(world, cx, y, cz)) return [cx, y, cz];
  }
  return null;
}

/** 从**一格传送门方块**出发，找出它所属的圈心；框架不完整（门该灭）则返回 null */
export function portalCenterAt(world: EndPortalWorld, x: number, y: number, z: number): [number, number, number] | null {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      if (isRingComplete(world, cx, y, cz)) return [cx, y, cz];
    }
  }
  return null;
}

/** 一次"按眼睛"的结果；`filled === 0` 表示这一下没点亮（圈还差眼睛，或者早就亮着） */
export interface EndPortalActivation {
  center: [number, number, number];
  filled: number;
}

/**
 * 往 (x,y,z) 这格框架里按下一只眼睛**之后**调用：圈齐了就点亮中间的 3×3。
 *
 * 返回 null 表示"圈还没齐"（这是最常见的一种，什么都不做）。
 * 幂等：已经亮着的圈再按一次眼睛时，`filled` 是 0（9 格本来就已经是门方块了）。
 */
export function activateEndPortalAt(
  world: EndPortalWorld,
  x: number,
  y: number,
  z: number,
): EndPortalActivation | null {
  const center = ringCenterAt(world, x, y, z);
  if (!center) return null;
  return { center, filled: fillEndPortal(world, center[0], center[1], center[2]) };
}

/**
 * 拆掉一格框架之后清场（与下界传送门那套同一条做法）：
 * 那一层附近还留着的 3×3 传送门方块，只要其圈已经**不完整**就整片清掉。
 *
 * @returns 被清掉的格子（联机时要把这次改动广播出去，所以返回明细而不是数量）
 */
export function clearBrokenEndPortalsAround(
  world: EndPortalWorld,
  x: number,
  y: number,
  z: number,
): Array<[number, number, number]> {
  const removed: Array<[number, number, number]> = [];
  const handled = new Set<string>();

  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let dx = -5; dx <= 5; dx++) {
        const px = x + dx;
        const py = y + dy;
        const pz = z + dz;
        if (world.getBlock(px, py, pz) !== Block.END_PORTAL) continue;
        // 圈还完整的（拆的不是它的框架）不动
        if (portalCenterAt(world, px, py, pz)) continue;
        for (let cz = -1; cz <= 1; cz++) {
          for (let cx = -1; cx <= 1; cx++) {
            const key = `${px + cx},${py},${pz + cz}`;
            if (handled.has(key)) continue;
            handled.add(key);
            if (world.getBlock(px + cx, py, pz + cz) !== Block.END_PORTAL) continue;
            if (world.setBlock(px + cx, py, pz + cz, Block.AIR, 0)) removed.push([px + cx, py, pz + cz]);
          }
        }
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------- 传送与到达平台

/**
 * 末地那一侧的到达平台（原版在 (100, 50, 0)）：一块悬在虚空上的 5×5 黑曜石。
 *
 * 为什么照搬"离岛心 100 格"这个数：末地主岛的半径是 64（`MAIN_ISLAND_RADIUS`），
 * 所以这块平台**正好悬在岛外的虚空上**——玩家落地先看到的是脚下的黑曜石与远处的岛，
 * 而不是直接站在末影龙与返回传送门中间。
 */
export const END_ARRIVAL_X = 100;
export const END_ARRIVAL_Y = 50;
export const END_ARRIVAL_Z = 0;

/** 站上传送门几 tick 后传送（原版末地传送门是"碰到就传"，这里留 1 tick 让物理先站定） */
export const END_PORTAL_WAIT_TICKS = 1;

/**
 * 搭出（或修复）到达平台：5×5 黑曜石 + 上方 3 格清空。
 *
 * 幂等，且**每次都重写**：玩家把平台改过（垫了方块、挖了角）时，下一次到达会把它修回原样
 * ——与原版"平台是插值出来的、被破坏就补回来"的观感一致。
 *
 * @returns 写成功了几格（0 通常意味着那块区块还没加载出来）
 */
export function buildEndArrivalPlatform(
  world: EndPortalWorld,
  cx = END_ARRIVAL_X,
  cy = END_ARRIVAL_Y,
  cz = END_ARRIVAL_Z,
): number {
  let written = 0;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (world.setBlock(cx + dx, cy - 1, cz + dz, Block.OBSIDIAN, 0)) written++;
      for (let dy = 0; dy <= 2; dy++) {
        if (world.setBlock(cx + dx, cy + dy, cz + dz, Block.AIR, 0)) written++;
      }
    }
  }
  return written;
}

export interface EndPortalTarget {
  dimension: DimensionId;
  x: number;
  y: number;
  z: number;
}

/**
 * 末地传送门通到哪。
 *
 * 与原版的取舍：**从末地回主世界落在世界出生点**（原版也是出生点/床，
 * 而不是"回来时脚下再生一座传送门"——末地传送门本来就只有一个方向是"正门"）。
 *
 * @param spawn 世界出生点（主世界坐标）；末地 → 主世界时用它
 */
export function endPortalTarget(from: DimensionId, spawn: { x: number; y: number; z: number }): EndPortalTarget {
  if (from === 'end') {
    return { dimension: 'overworld', x: spawn.x, y: spawn.y, z: spawn.z };
  }
  // 主世界（以及"在下界里被摆出来"的末地传送门）都去末地的到达平台
  return { dimension: 'end', x: END_ARRIVAL_X + 0.5, y: END_ARRIVAL_Y + 1, z: END_ARRIVAL_Z + 0.5 };
}

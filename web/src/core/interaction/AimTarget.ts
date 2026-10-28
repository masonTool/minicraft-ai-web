/**
 * 生物瞄准规则（批次 271）
 *
 * 与"方块选取"分开：方块射线用 `World.isSelectable`（非空气、非流体都算），
 * 草/花/雪层/地毯这些**没有碰撞的薄方块**因此会抢先命中；
 * 但玩家真正盯着的是站在草里的那只猪——它们不该把生物目标挤掉。
 *
 * 这里的判据只有一条：**能挡住视线的方块 = 有碰撞、且不是薄片形状**。
 *  - 挡：石头、泥土、玻璃、树叶、冰块、台阶、楼梯……（隔着玻璃仍然打不到怪，与原版一致）
 *  - 不挡：草/花/雪层/地毯/铁轨/红石/火把/梯子/藤蔓/锁链/睡莲/水/岩浆
 *
 * 规则做成纯函数，主程序只负责把世界里的方块 id 采样进来。
 */

import { blockDef } from '../registry/blocks.ts';
import type { BlockShape } from '../registry/blockState.ts';
import { raycastVoxels } from './Raycast.ts';

/**
 * 生物瞄准的 AABB 外扩容差（格）。
 *
 * 射线是零宽度的，鸡/蝙蝠/鱼这种小体型生物要像素级对准才打得中；
 * 外扩 0.12 格约等于触屏十几像素，手感上是"指到它旁边也算"，
 * 但不至于把两只并排的羊判成同一只（它们至少隔 0.6 格）。
 */
export const AIM_INFLATE = 0.12;

/**
 * 触屏"目标不掉"的屏幕半径（CSS px，会乘触摸缩放）。
 *
 * 猪每秒走 1.3 格，0.2 秒（标签刷新周期）就是 0.26 格；
 * 在 3 格外看大约是屏幕上 40 多像素，所以锁半径取 44：
 * 足够覆盖"生物走半步"，又不至于锁到屏幕另一侧。
 */
export const AIM_LOCK_RADIUS_PX = 44;

/** 薄片/无碰撞形状：它们看得见、能挖，但**不挡生物视线** */
const THIN_SHAPES: ReadonlySet<BlockShape> = new Set<BlockShape>([
  'cross',
  'flat',
  'snow',
  'lily_pad',
  'coral_fan',
  'torch',
  'ladder',
  'vine',
  'chain',
  'fluid',
]);

/** 这一格方块会不会挡住"看生物"的视线 */
export function isSightBlocker(blockId: number): boolean {
  const def = blockDef(blockId);
  if (def.id === 0) return false;
  if (!def.solid) return false;
  return !THIN_SHAPES.has(def.shape);
}

/** 世界方块的取样函数（主程序传 `world.getBlock`，测试里传一张表） */
export type BlockSampler = (x: number, y: number, z: number) => number;

/**
 * 眼睛到目标点之间有没有**真正挡视线**的方块。
 *
 * 终点前留 0.05 格余量：生物站在地上时，它的包围盒中心与脚下那一格
 * 只差半格，不减这一点会把"它自己脚下的地面"算成遮挡。
 */
export function sightBlocked(
  sample: BlockSampler,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): boolean {
  const dx = targetX - eyeX;
  const dy = targetY - eyeY;
  const dz = targetZ - eyeZ;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= 1e-3) return false;
  const hit = raycastVoxels(
    (x, y, z) => isSightBlocker(sample(x, y, z)),
    eyeX,
    eyeY,
    eyeZ,
    dx,
    dy,
    dz,
    Math.max(0, distance - 0.05),
  );
  return hit !== null;
}

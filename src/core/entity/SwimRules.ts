/**
 * 生物游泳（J3 收口，批次 517）
 *
 * 在批次 517 之前，除鱿鱼那类 `aquatic` 以外，所有生物在水里都走**普通重力**：
 * 掉进河里就一路沉底，追人的怪到河边会贴着河床走、甚至卡在深水里。
 * 原版生物在水里会自己浮起来，并且朝目标方向划水。
 *
 * 这一批只补**纵向**那一半：
 *  - 身体泡在水里、头也在水下 → 给一个向上的速度（追人时 2.6，否则慢慢浮 0.6）；
 *  - 头已经露出水面 → **不再推**（再推就成了"跳出水面的鱼"）；
 *  - 没在水里 → 完全交给原来的重力分支。
 *
 * 横向仍由 `moveDir` 决定，A* 也不用改：水在方块表里本来就不是实心的。
 *
 * ⚠️ 不做"生物溺水"：原版只有玩家有氧气条，生物在水下不会掉血（鱿鱼上岸窒息是另一条）。
 */

/** 追人时上浮的速度（格/秒） */
export const SWIM_UP_SPEED = 2.6;
/** 没在追人时的缓慢上浮（格/秒） */
export const SWIM_FLOAT_SPEED = 0.6;

export interface SwimInput {
  /** 身体中部那一格是不是水 */
  readonly submerged: boolean;
  /** 头（约 0.9 身高处）是不是已经露出水面 */
  readonly headAboveWater: boolean;
  /** 目标是否在上方（追人时比较玩家的 y；不在追人 = false） */
  readonly targetAbove: boolean;
  /** 当前纵向速度 */
  readonly vy: number;
}

/**
 * 这一帧的纵向速度。
 *
 * 用 `max(vy, 目标速度)` 而不是直接赋值：**下落中的生物不会被硬拽住**，
 * 已经在快速上浮的（被击退、跳起来）也不会被压回 2.6。
 */
export function swimVerticalSpeed(input: SwimInput): number {
  if (!input.submerged) return input.vy;
  if (input.headAboveWater) return input.vy;
  const target = input.targetAbove ? SWIM_UP_SPEED : SWIM_FLOAT_SPEED;
  return Math.max(input.vy, target);
}

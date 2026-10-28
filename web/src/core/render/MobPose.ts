/**
 * 远端玩家的姿势偏移（联机37）。
 *
 * 远端玩家在渲染上是一个 `Mob`（走 `MobRenderer` 的方块人规格），而本地玩家的姿势由
 * `PlayerRenderer` 自己算。于是队友蹲下、骑东西的时候，你这边看到的仍是一根笔直的柱子——
 * 状态其实早就传过来了（联机17 的 `sneak` / `ride`），只是渲染没人用。
 *
 * 这里把"状态 → 竖直偏移"抽成纯函数：MobRenderer 拿它做一次整体平移，能离线断言。
 *
 * 数值参照 `PlayerRenderer` 的下蹲（下沉 0.12、前倾 0.22 rad）——两边不一样会很怪：
 * 你自己蹲下时镜头低了 0.12，队友看你却只低了 0.05。
 */

/** 下蹲时整体下沉多少（格） */
export const SNEAK_SINK = 0.12;
/** 骑乘时整体抬高多少（格）：坐在鞍上的高度 */
export const RIDE_LIFT = 0.42;

/**
 * 这个 Mob 该在竖直方向偏移多少。
 *
 * 骑乘优先于下蹲：骑在马上按蹲是"想下来"，但姿势上人仍是坐着的。
 */
export function mobPoseOffsetY(pose: { sneaking: boolean; riding: boolean }): number {
  if (pose.riding) return RIDE_LIFT;
  if (pose.sneaking) return -SNEAK_SINK;
  return 0;
}

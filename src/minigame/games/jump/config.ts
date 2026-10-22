/**
 * 跳一跳的**全部可调参数**（J0，批次 20261022-2220）
 *
 * 为什么集中在一个文件：手感（蓄力时长 / 距离 / 方块大小 / 间距）一定会反复调，
 * 分散在 logic、scene、测试里就会三处不一致。改这里、跑一遍离线断言与平衡脚本即可。
 *
 * 数值来源：`.continue/notes/jump-game.md` §4 参数表（初值）。
 * 调整顺序建议：先 `maxDistance`（能不能够到），再 `gap*`（难度曲线），最后 `maxCharge`（手感）。
 */

export const JUMP_CONFIG = {
  /** 蓄满所需时间（秒）：按满 = 最大距离 */
  maxCharge: 0.9,
  /** 最大水平跳跃距离（格） */
  maxDistance: 4.5,
  /** 生成间距必须比最大距离短这么多，留一点余量 */
  reachMargin: 0.3,

  /** 方块边长：0 分 → 每 `shrinkScore` 分线性缩到最小 */
  blockSizeStart: 1.8,
  blockSizeMin: 0.9,
  shrinkScore: 60,

  /** 间距下限：0 分 → 每 `growScore` 分线性抬到终值 */
  gapMinStart: 1.4,
  gapMinEnd: 2.2,
  /** 间距上限：0 分 → 终值（最终会被 `maxDistance - reachMargin` 夹住） */
  gapMaxStart: 2.0,
  gapMaxEnd: 3.6,
  growScore: 60,

  /** 生成方向（度，0 = 正前方；负数在左、正数在右） */
  directionDegrees: [-30, 0, 30] as const,

  /** 中心判定：落点距方块中心 ≤ 半边长 × 这个比例 */
  centerRatio: 0.22,

  /** 连击：第 n 次连续中心得 `comboStep × n`，封顶 `comboMax` */
  comboStep: 2,
  comboMax: 32,

  /** 特殊方块：多少分之后才出现、出现概率、停留奖励 */
  specialAfterScore: 10,
  specialChance: 0.12,
  specialMusicBonus: 30,
  specialCubeBonus: 10,
  /** 特殊方块的加分需要停留多久（秒） */
  specialHoldSeconds: 2,
} as const;

export type JumpConfig = typeof JUMP_CONFIG;

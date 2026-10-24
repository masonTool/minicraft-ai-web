/**
 * 跳一跳的**全部可调参数**（批次 20261024-0415 对齐原版）
 *
 * 为什么集中在一个文件：手感（蓄力时长 / 距离 / 方块大小 / 间距）一定会反复调，
 * 分散在 logic、scene、测试里就会三处不一致。改这里、跑一遍离线断言与平衡脚本即可。
 *
 * 这一轮相对旧参数的三处改动，都是为了"看起来与原版一样"：
 *
 *  1. **间距改成"边长的倍数"**（`gapRatioMin/Max = 1.15~1.9`）。原版相邻方块几乎贴着，
 *     中心距就是 1.15~1.9 个边长（规格表 §2 实测 1.75）；旧参数是绝对格数（2.6~4.2 格），
 *     方块一小就散开了，观感立刻变成"MC 里搭的柱子"。
 *  2. **方向只剩等距两向**（`[0, 90]`）。原版没有"正前方 0° 偏一点"的中间方向，
 *     屏幕上只有右上 / 左上两条轴。
 *  3. **四类特殊方块**（井盖 5 / 魔方 10 / 便利店 15 / 音乐盒 30），停留 3 秒才加分。
 *
 * 调整顺序建议：先 `maxDistance`（能不能够到），再 `gapRatio*`（难度曲线），
 * 最后 `maxCharge`（手感）。改完必须跑 `npm run jump:balance`。
 */

export const JUMP_CONFIG = {
  /** 蓄满所需时间（秒）：按满 = 最大水平距离 */
  maxCharge: 0.9,
  /** 最大水平跳跃距离（格） */
  maxDistance: 4.5,
  /** 生成间距必须比最大距离短这么多，留一点余量 */
  reachMargin: 0.3,

  /** 方块边长：0 分 → 每 `shrinkScore` 分线性缩到最小 */
  blockSizeStart: 2.0,
  blockSizeMin: 0.9,
  shrinkScore: 60,

  /**
   * 间距 = 边长 × 这个区间。
   *
   * ⚠️ 下限必须 > 1：等于 1 时两块正好贴合，圆角和阴影会互相压住，看着像一整块。
   * 上限被 `maxDistance − reachMargin` 夹住（见 `logic.maxReachableGap()`）。
   */
  gapRatioMin: 1.15,
  gapRatioMax: 1.9,

  /**
   * 前进方向（度，0 = 正前方 −Z，正数向右偏）。
   *
   * 原版只有等距两向：世界 −Z（屏幕右上）与 −X（屏幕左上）。**没有 0° 以外的斜角**，
   * 加上 ±30° 会让方块散到画面中间，等距投影立刻破功。
   */
  directionDegrees: [0, 90] as const,

  /** 中心判定：落点距方块中心 ≤ 半边长 × 这个比例 */
  centerRatio: 0.22,

  /** 连击：第 n 次连续中心得 `comboStep × n`，封顶 `comboMax` */
  comboStep: 2,
  comboMax: 32,

  /** 特殊方块：多少分之后才出现、出现概率、停留奖励 */
  specialAfterScore: 10,
  specialChance: 0.12,
  specialWellBonus: 5,
  specialCubeBonus: 10,
  specialStoreBonus: 15,
  specialMusicBonus: 30,
  /**
   * 特殊方块的加分需要停留多久（秒）。
   *
   * 原版是 3 秒（攻略文的统一说法）。这个数字直接决定"要不要放弃一次跳跃去等分"，
   * 调小会让特殊方块变成免费分，调大会让人不愿意等。
   */
  specialHoldSeconds: 3,
} as const;

export type JumpConfig = typeof JUMP_CONFIG;

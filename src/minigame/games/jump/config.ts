/**
 * 跳一跳的**全部可调参数**（批次 20261024-1331 重调手感）
 *
 * 为什么集中在一个文件：手感（蓄力时长 / 距离 / 方块大小 / 间距）一定会反复调，
 * 分散在 logic、scene、测试里就会三处不一致。改这里、跑一遍离线断言与平衡脚本即可。
 *
 * 这一轮相对上一版（间距 = 边长 × 1.15~1.9）改了四件事，都是为了"横屏下更舒展、
 * 且给「人倒下」留出空间"：
 *
 *  1. **间距回到绝对格数**（`gapStart*` / `gapEnd*`）：方块变小时，若间距仍按边长倍数算，
 *     绝对距离会跟着缩水，"越往后越远"根本做不到。
 *  2. **间距硬下限**（`gapFloorRatio`）：两块中心距至少要放得下"一块边长 + 倒下的
 *     一个小人高度"，否则人一倒就砸在下一块上，看起来像穿模。
 *  3. **方块下限抬到 1.2、缩到 80 分才封顶**：上一版 60 分就缩到 0.9，横屏下小得像黄豆。
 *  4. **蓄满 1.25 秒 / 最远 7.2 格**：间距拉到 4.6~6.0 格之后，原来的 0.9 秒 4.5 格
 *     根本够不着。
 *
 * 调整顺序建议：先 `maxDistance`（能不能够到），再 `gap*`（难度曲线），
 * 最后 `maxCharge`（手感）。改完必须跑 `npm run jump:balance`。
 */

export const JUMP_CONFIG = {
  /** 蓄满所需时间（秒）：按满 = 最大水平距离 */
  maxCharge: 1.25,
  /** 最大水平跳跃距离（格） */
  maxDistance: 7.2,
  /** 生成间距必须比最大距离短这么多，留一点余量 */
  reachMargin: 0.35,

  /** 方块边长：0 分 → 每 `shrinkScore` 分线性缩到最小 */
  blockSizeStart: 2.0,
  blockSizeMin: 1.2,
  shrinkScore: 80,

  /**
   * 中心距（格）的绝对曲线：0 分从 `gapStart*` 出发，`gapGrowScore` 分封顶到 `gapEnd*`。
   *
   * 开局 4.6~5.4 格 ≈ 2.3~2.7 倍边长，封顶 4.8~6.0 格 ≈ 4.0~5.0 倍边长。
   * 上限被 `maxReachableGap()` 与"从上一块最靠后位置起跳"两条一起夹住。
   */
  gapStartMin: 4.6,
  gapStartMax: 5.4,
  gapEndMin: 4.8,
  gapEndMax: 6.0,
  /** 间距曲线爬到顶所需分数 */
  gapGrowScore: 100,

  /**
   * 间距硬下限 = 上一块边长 × 这个系数 + 余量。
   *
   * 2.12 = 1 个边长（两块之间不留缝）+ 1.12 个边长（小人高度，倒下时要用掉的空间）。
   * 低于这个值时，人一倾倒就会砸在下一块的侧面上。
   */
  gapFloorRatio: 2.12,
  gapFloorMargin: 0.1,

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

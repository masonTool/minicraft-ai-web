/**
 * 动画时序与缓动的离线断言（批次 20261024-0415，`[跳7]`）
 *
 * 运行：`npm run test:jumpmotion`
 *
 * 时序错在截图里看不出来（截图是静止的），所以这里逐条钉住"某个时刻应该是多少"：
 *
 *  1. **弧线形状**：上升只占 65% 却要升到峰值，所以必须"前快后慢"；下落 35% 是"前慢后快"。
 *     写成对称的正弦（旧实现）在画面上只是"有点飘"，很难看出错；
 *  2. **总时长固定 400ms**：与跳多远无关。旧实现按距离加时长，远跳更慢；
 *  3. **收敛性**：落地压缩、方块回弹、入场、淡出都必须在规定时长**精确回到端值**，
 *     否则会留下"永久压着一点"或"永远差 0.98"的残影；
 *  4. **越界与 NaN**：动画进度来自帧时间，切标签页回来可能一次给很大 dt。
 */

import {
  BLOCK_DENT,
  ENTER_SCALE,
  JUMP_TIMING,
  LAND_SQUASH,
  TOPPLE_ANGLE,
  blockBounceScale,
  bounceOut,
  cubicIn,
  cubicOut,
  enterScale,
  fadeScale,
  flipProgress,
  jumpArc,
  landingSquash,
  rippleProgress,
  sinusInOut,
  toppleAngle,
} from '../src/minigame/games/jump/motion.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function near(label: string, actual: number, expected: number, tolerance = 1e-9): void {
  check(label, Math.abs(actual - expected) <= tolerance, `实际 ${actual}，期望 ${expected} ±${tolerance}`);
}

console.log('\n缓动函数');
{
  near('cubicOut(0) = 0', cubicOut(0), 0);
  near('cubicOut(1) = 1', cubicOut(1), 1);
  near('cubicOut(0.5) = 0.875（前快后慢）', cubicOut(0.5), 0.875);
  near('cubicIn(0.5) = 0.125（前慢后快）', cubicIn(0.5), 0.125);
  near('sinusInOut(0.5) = 0.5', sinusInOut(0.5), 0.5);
  check('sinusInOut 在中点两侧对称', Math.abs(sinusInOut(0.25) + sinusInOut(0.75) - 1) < 1e-12);
  near('bounceOut(0) = 0', bounceOut(0), 0);
  near('bounceOut(1) = 1（末段收敛）', bounceOut(1), 1);
  // Bounce.Out 不是单调曲线：它每隔一段就"落地"一次，从 1 掉下来再弹回去。
  // 真正的判据是**有几次回弹**（局部极小值个数）与全程落在 0~1。
  const samples = Array.from({ length: 400 }, (_, i) => bounceOut(i / 399));
  let dips = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i]! < samples[i - 1]! - 1e-12 && samples[i]! <= samples[i + 1]!) dips += 1;
  }
  check('bounceOut 至少弹 2 次（不是一条光滑曲线）', dips >= 2, `回弹 ${dips} 次`);
  check('bounceOut 全程落在 0~1', samples.every((v) => v >= -1e-12 && v <= 1 + 1e-12));
}

console.log('\n跳跃弧线（400ms，上升 65% / 下落 35%）');
{
  near('起点在地面', jumpArc(0), 0);
  near('上升段结束时到峰值', jumpArc(JUMP_TIMING.riseRatio), 1);
  near('终点回到地面', jumpArc(1), 0);

  const rise = Array.from({ length: 20 }, (_, i) => jumpArc((i / 19) * JUMP_TIMING.riseRatio));
  const fall = Array.from({ length: 20 }, (_, i) => jumpArc(JUMP_TIMING.riseRatio + (i / 19) * (1 - JUMP_TIMING.riseRatio)));
  check('上升段单调不减', rise.every((v, i) => i === 0 || v >= rise[i - 1]! - 1e-12));
  check('下落段单调不增', fall.every((v, i) => i === 0 || v <= fall[i - 1]! + 1e-12));
  check('上升段"前快后慢"（前半段已过 70% 高度）', jumpArc(JUMP_TIMING.riseRatio / 2) > 0.7, `${jumpArc(JUMP_TIMING.riseRatio / 2)}`);
  check('下落段"前慢后快"（前半段还没掉一半）', jumpArc(JUMP_TIMING.riseRatio + (1 - JUMP_TIMING.riseRatio) / 2) > 0.5, `${jumpArc(JUMP_TIMING.riseRatio + (1 - JUMP_TIMING.riseRatio) / 2)}`);
  check('峰值处无折角（两侧斜率都接近 0）', (() => {
    const eps = 1e-4;
    const left = (jumpArc(JUMP_TIMING.riseRatio) - jumpArc(JUMP_TIMING.riseRatio - eps)) / eps;
    const right = (jumpArc(JUMP_TIMING.riseRatio + eps) - jumpArc(JUMP_TIMING.riseRatio)) / eps;
    return Math.abs(left) < 0.05 && Math.abs(right) < 0.05;
  })());
  near('超出 1 被夹住', jumpArc(3), 0);
  near('负数被夹住', jumpArc(-1), 0);
  near('NaN 当作 0', jumpArc(Number.NaN), 0);
}

console.log('\n空翻（Sinusoidal.InOut，一转 360°）');
{
  near('起跳角度 0', flipProgress(0), 0);
  near('半程转到半圈', flipProgress(0.5), 0.5);
  near('落地转满一圈', flipProgress(1), 1);
  check('单调不减', Array.from({ length: 50 }, (_, i) => flipProgress(i / 49)).every((v, i, arr) => i === 0 || v >= arr[i - 1]! - 1e-12));
  check('两端慢（起跳/落地不突兀）', flipProgress(0.1) < 0.1 && flipProgress(0.9) > 0.9);
}

console.log('\n落地压缩 / 方块回弹 / 入场 / 淡出');
{
  const squashZero = (1 - LAND_SQUASH) / (1 - 0.6);
  near('落地瞬间压到 0.8 身高', landingSquash(0), squashZero);
  near('100ms 后站直', landingSquash(JUMP_TIMING.landSquashMs), 0);
  check('压缩量单调递减到 0', Array.from({ length: 20 }, (_, i) => landingSquash((i / 19) * JUMP_TIMING.landSquashMs)).every((v, i, arr) => i === 0 || v <= arr[i - 1]! + 1e-12));
  check('永远不会压成负数', landingSquash(9999) === 0);

  near('被踩方块先凹下去', blockBounceScale(0), BLOCK_DENT);
  near('500ms 后回到 1', blockBounceScale(JUMP_TIMING.blockBounceMs), 1);
  check('回弹过程中不越界（0.8~1.01）', Array.from({ length: 50 }, (_, i) => blockBounceScale((i / 49) * JUMP_TIMING.blockBounceMs)).every((v) => v >= 0.84 && v <= 1.001));

  near('新方块从 0.6 开始', enterScale(0), ENTER_SCALE);
  near('400ms 后长到 1', enterScale(JUMP_TIMING.enterMs), 1);
  check('入场不会超过 1.01（不然会互相穿插）', Array.from({ length: 50 }, (_, i) => enterScale((i / 49) * JUMP_TIMING.enterMs)).every((v) => v <= 1.001));

  near('旧方块开始时不缩', fadeScale(0), 1);
  near('400ms 后缩没', fadeScale(JUMP_TIMING.fadeMs), 0);
  check('淡出单调递减', Array.from({ length: 20 }, (_, i) => fadeScale((i / 19) * JUMP_TIMING.fadeMs)).every((v, i, arr) => i === 0 || v <= arr[i - 1]! + 1e-12));

  near('波纹从 0 开始', rippleProgress(0), 0);
  near('波纹 600ms 结束', rippleProgress(JUMP_TIMING.rippleMs), 1);
  near('波纹越界夹住', rippleProgress(9999), 1);
}

console.log('\n倾倒（380ms 缓入到 ~95°）');
{
  const ms = JUMP_TIMING.toppleMs;
  near('起点不倾斜', toppleAngle(0), 0);
  near('380ms 到终点', toppleAngle(ms), TOPPLE_ANGLE);
  const degrees = (TOPPLE_ANGLE * 180) / Math.PI;
  check('终点角度落在 90°~100°（正好 90° 会像贴着墙躺平）', degrees >= 90 && degrees <= 100, `${degrees.toFixed(1)}°`);
  check(
    '全程单调不减',
    Array.from({ length: 60 }, (_, i) => toppleAngle((i / 59) * ms)).every((v, i, arr) => i === 0 || v >= arr[i - 1]! - 1e-12),
  );
  // 缓入：前半程几乎不动（还在"犹豫"），最后 100ms 才猛地扑下去。
  // 写成缓出会变成"被人推倒"，截图看不出差别，只有曲线能量出来。
  check('前半程只倒了两成不到（缓入）', toppleAngle(ms / 2) / TOPPLE_ANGLE < 0.2, `${(toppleAngle(ms / 2) / TOPPLE_ANGLE).toFixed(3)}`);
  check(
    '最后 1/4 时间转过一半以上',
    toppleAngle(ms) - toppleAngle(ms * 0.75) > TOPPLE_ANGLE * 0.5,
    `${((toppleAngle(ms) - toppleAngle(ms * 0.75)) / TOPPLE_ANGLE).toFixed(3)}`,
  );
  near('超过时长被夹住', toppleAngle(9999), TOPPLE_ANGLE);
  near('负数归零', toppleAngle(-5), 0);
  near('NaN 归零', toppleAngle(Number.NaN), 0);
  near('倾倒时长 380ms', JUMP_TIMING.toppleMs, 380);
}

console.log('\n时序常量（对齐规格表 §8）');
{
  near('一次跳跃 400ms', JUMP_TIMING.totalMs, 400);
  near('上升占 65%', JUMP_TIMING.riseRatio, 0.65);
  near('落地压缩 100ms', JUMP_TIMING.landSquashMs, 100);
  near('方块回弹 500ms', JUMP_TIMING.blockBounceMs, 500);
  near('新块入场 400ms', JUMP_TIMING.enterMs, 400);
  check('所有时长都是正数', Object.values(JUMP_TIMING).every((v) => Number.isFinite(v) && v > 0));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);

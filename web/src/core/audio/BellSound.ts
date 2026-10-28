/**
 * 钟声（批次 490，B19 的"钟"）
 *
 * 原版敲钟是一声**很长、很低、带拍频的金属共鸣**（钟体越大越低）。
 * 这里用三个正弦泛音叠出来：基频 + 两个非整数倍泛音——**非整数倍**是关键，
 * 整数倍（220/440/660）听起来像管风琴，而真实钟体的泛音是 2.76、5.4 这种比例
 * （所谓"钟的嗡鸣"就来自这几个不对齐的峰）。
 *
 * 为什么单独成模块（而不是塞进 `AudioEngine` 的 `SOUNDS` 表）：
 *  - `SOUNDS` 是"一种音效一条 spec"的静态表，而钟声要按**玩家的位置**播、
 *    且这辈子只会有一个变体，放在这里与唱片旋律（`DiscMelody.ts`）同一层更清楚；
 *  - 纯函数好测：频率比例、时长、包络首尾，都能离线断言。
 */

import type { SoundSpec, ToneLayer } from './AudioEngine.ts';

/** 钟声的基频（Hz）：一口村钟大约在这个音高（接近 A3） */
export const BELL_BASE_HZ = 220;

/** 钟的泛音比例（相对基频）——真实钟体的非整数倍泛音 */
const BELL_PARTIALS: readonly { ratio: number; gain: number }[] = [
  { ratio: 1, gain: 1 },
  // 2.76 是"钟的嗡鸣"那一声，也是最容易被认出来的特征
  { ratio: 2.76, gain: 0.5 },
  { ratio: 5.4, gain: 0.22 },
];

/** 钟声的持续时间（秒）：原版敲一下能听到三秒多 */
export const BELL_RING_SECONDS = 3.2;

/** 一个泛音 → 一层振荡器（缓起、慢衰减，模拟金属余韵） */
function partialLayer(ratio: number, gain: number): ToneLayer {
  return {
    t: 'tone',
    at: 0,
    dur: BELL_RING_SECONDS / (ratio > 2 ? 2 : 1),
    gain,
    // 起音 8ms（金属不会"啪"一下起振），保持 8%，剩下 92% 全是衰减
    env: [
      [0, 0],
      [0.008, 1],
      [0.08, 0.55],
      [1, 0],
    ],
    wave: 'sine',
    hz: BELL_BASE_HZ * ratio,
  };
}

/**
 * 敲钟的声音。
 *
 * `gain` 比普通音效低一档（0.55）：钟声是"环境里最响的那一声"，
 * 但它是**长音**，开太大会盖住之后两三秒的所有其他声音。
 */
export function bellSoundSpec(): SoundSpec {
  return {
    layers: BELL_PARTIALS.map((partial) => partialLayer(partial.ratio, partial.gain)),
    gain: 0.55,
    pitchJitter: 0,
  };
}

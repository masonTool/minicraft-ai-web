/**
 * 音效引擎（K5；批次 232 重写）：用 Web Audio 现场合成，不依赖任何音频文件
 *
 * 为什么不放音频资源：本项目的贴图都是程序化生成的（`atlasLayout.ts`），
 * 音效沿用同一思路——而且省掉了打包与许可问题。
 *
 * 为什么批次 232 要把引擎重写一遍：旧版一条声音只有"一段噪声 + 一条滑音 + 可选的闷响"，
 * 参数表里 `release` 甚至**根本没被引擎用到**。于是所有声音都是同一种"嗖——"的包络，
 * 走路、受伤、牛叫听起来像同一个电子蜂鸣器换了音高。玩家能听出来的差别只有"频率"。
 *
 * 新版的最小单位是**层**（`SoundLayer`）：
 *  - `tone`：振荡器 + 任意折线的音高走向 + 2~3 个共振峰（元音）+ 颤音；
 *  - `noise`：噪声 + 可扫频的滤波器 + 幅度抖动（骨节"咔咔"、羊叫的"咩～"）；
 *  - 每一层都有自己的起止时间、音量与**折线包络**，所以"起音 → 保持 → 收尾"能分开写。
 *
 * 一条声音 = 若干层叠起来（牛叫 = 声带层 + 呼气层；石头碎裂 = 瞬态 + 主体 + 余韵）。
 * 这是"更像真的"与"省节点"之间的折中：一条声音 2~4 层，正常同屏 6 声以内。
 *
 * 另外三件以前完全没有、但对"正常感"影响极大的事：
 *  1. **随机化**：同一条声音有 2~3 个变体 + 音高抖动，连踩几步不会一模一样；
 *  2. **声像与距离低通**：知道声音在左还是右，远处的声音更闷（不是一样亮）；
 *  3. **主总线**：压缩器（多声叠加不炸）+ 两条反馈延迟做的"房间感"（不用卷积，手机友好）。
 *
 * 浏览器自动播放策略：AudioContext 必须在**用户手势之后**才能出声，
 * 因此 `resume()` 会挂在第一次点击/按键上（见 main 的绑定）。
 */

/** 折线点：时间比例 0~1 → 值（包络是 0~1，音高是基频倍率） */
export type LayerPoint = readonly [number, number];

/** 元音共振峰：中心频率 / 尖锐度 / 相对音量 */
export interface Formant {
  hz: number;
  q: number;
  gain: number;
}

interface LayerBase {
  /** 相对整段声音起点的延迟（秒） */
  at: number;
  /** 这一层持续多久（秒） */
  dur: number;
  /** 这一层的相对音量（0~1，最终还会乘 `SoundSpec.gain` 与总音量） */
  gain: number;
  /** 幅度折线：[[0,0],[0.06,1],[0.6,0.8],[1,0]] 这种写法就是"起音 → 保持 → 收尾" */
  env: readonly LayerPoint[];
  /** 幅度抖动：骨节"咔咔"、羊叫的颤（对噪声层与音调层都生效） */
  tremolo?: { hz: number; depth: number };
}

/** 有音高的层：振荡器（动物的声带、木头/玻璃的余韵都靠它） */
export interface ToneLayer extends LayerBase {
  t: 'tone';
  wave: OscillatorType;
  hz: number;
  /** 音高走向（倍率）：牛哞"先升后降"、末影人"往下滑"都在这里 */
  pitch?: readonly LayerPoint[];
  /** 共振峰（元音）。有它才像"嗓子"，没有它就是"电子音" */
  formants?: readonly Formant[];
  /** 颤音：生物叫声的灵魂（羊 11Hz、村民 4Hz、末影人 12Hz） */
  vibrato?: { hz: number; cents: number };
}

/** 噪声层：脚步的摩擦、碎裂的瞬态、苦力怕的"嘶" */
export interface NoiseLayer extends LayerBase {
  t: 'noise';
  filter: 'lowpass' | 'bandpass' | 'highpass';
  hz: number;
  /** 滤波器扫频（倍率），例如"嘶——"从 900Hz 扫到 1400Hz */
  sweep?: readonly LayerPoint[];
  q: number;
}

export type SoundLayer = ToneLayer | NoiseLayer;

export interface SoundSpec {
  layers: readonly SoundLayer[];
  /** 整条声音的基准音量（0~1） */
  gain: number;
  /** 每次播放的音高抖动（音分，1 半音 = 100 音分）：0 = 每次完全一样 */
  pitchJitter?: number;
  /** 2~3 个变体；有它时随机挑一个，`layers` 只当兜底 */
  variants?: readonly (readonly SoundLayer[])[];
}

// ---------------------------------------------------------------- 造表小工具
//
// 让下面那张表能一眼看出"这一声由哪几层组成"，而不是被对象字面量淹掉。

function curve(...points: [number, number][]): LayerPoint[] {
  return points;
}

function tone(o: Omit<ToneLayer, 't'>): ToneLayer {
  return { t: 'tone', ...o };
}

function noise(o: Omit<NoiseLayer, 't'>): NoiseLayer {
  return { t: 'noise', ...o };
}

function spec(gain: number, layers: SoundLayer[], opts: { jitter?: number; variants?: SoundLayer[][] } = {}): SoundSpec {
  return { gain, layers, pitchJitter: opts.jitter, variants: opts.variants };
}

/** 取某个音效要播的那一组层（有变体就随机挑） */
export function pickLayers(spec: SoundSpec, random: () => number = Math.random): readonly SoundLayer[] {
  if (!spec.variants || spec.variants.length === 0) return spec.layers;
  const index = Math.min(spec.variants.length - 1, Math.floor(random() * spec.variants.length));
  return spec.variants[index] ?? spec.layers;
}

/** 一组层的总时长（秒） */
export function layersDuration(layers: readonly SoundLayer[]): number {
  let end = 0;
  for (const layer of layers) end = Math.max(end, layer.at + layer.dur);
  return end;
}

/** 一条声音的总时长（按最长的变体算，用于并发计数与测试） */
export function specDuration(s: SoundSpec): number {
  let end = layersDuration(s.layers);
  for (const variant of s.variants ?? []) end = Math.max(end, layersDuration(variant));
  return end;
}

export type SoundKind =
  // ---- 破坏方块（按材质）
  | 'break_stone'
  | 'break_wood'
  | 'break_grass'
  | 'break_sand'
  | 'break_glass'
  | 'break_wool'
  // ---- 放置方块（按材质；`place` 给"不是放方块"的交互兜底）
  | 'place'
  | 'place_stone'
  | 'place_wood'
  | 'place_grass'
  | 'place_sand'
  | 'place_glass'
  | 'place_wool'
  // ---- 脚步声（批次 232：以前直接借破坏音）
  | 'step'
  | 'step_grass'
  | 'step_stone'
  | 'step_wood'
  | 'step_sand'
  | 'step_gravel'
  | 'step_snow'
  | 'step_wool'
  // ---- 挖掘中的持续摩擦（批次 233：以前只有"挖断那一下"）
  | 'dig_stone'
  | 'dig_wood'
  | 'dig_soft'
  | 'dig_glass'
  // ---- 落地 / 受伤 / 死亡（批次 232：以前 `fall` 定义了却从没播过）
  | 'land_soft'
  | 'land_hard'
  | 'hurt'
  | 'death'
  | 'hit_flesh'
  | 'fall'
  // ---- 开关与交互
  | 'door'
  | 'door_close'
  | 'trapdoor'
  | 'fence_gate'
  | 'explode'
  | 'splash'
  | 'click'
  | 'eat'
  | 'drink'
  | 'pickup'
  | 'xp'
  | 'bow_shoot'
  | 'arrow_hit'
  | 'shear'
  | 'flint'
  | 'thunder'
  | 'portal'
  | 'fuse'
  | 'achievement'
  | 'trade'
  | 'item_move'
  | 'shield_block';

/**
 * 音效表。数值是听感调出来的，不是采样复刻——
 * 目标是"闭着眼能分辨出是石头还是木头、是牛还是羊"，而不是逐位还原原版音源。
 *
 * ⚠️ 新旧口径的差别：
 *  - 旧版一个 `duration` 管整条声音，包络永远是"起音后一路指数衰减"；
 *  - 新版每一层各有 `at/dur/env`，所以"两下骨节响"就是两个延迟 0.06 秒的噪声层，
 *    而不是两次 `play()`（两次播放会被 70ms 的同种节流吞掉一次）。
 *
 * ⚠️ 生物叫声**不在**这张表里：它们按"种类 → 声音档案"组织，
 * 见 `core/audio/MobVoices.ts`（一种生物要有环境叫/受伤/死亡三条，塞在这里会淹没方块音）。
 */
const SOUNDS: Record<SoundKind, SoundSpec> = {
  // ---------------------------------------------------------------- 破坏方块
  // 石头：硬瞬态（高频短噪声）+ 主体（带通噪声）+ 一点低频"闷"
  break_stone: spec(0.5, [
    noise({ at: 0, dur: 0.05, gain: 0.8, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 2600, q: 0.7 }),
    noise({ at: 0, dur: 0.18, gain: 1, env: curve([0, 0], [0.06, 1], [1, 0]), filter: 'bandpass', hz: 1500, q: 0.9 }),
    tone({
      at: 0,
      dur: 0.14,
      gain: 0.35,
      env: curve([0, 0], [0.05, 1], [1, 0]),
      wave: 'triangle',
      hz: 175,
      pitch: curve([1, 0.6]),
    }),
  ]),
  // 木头：低频共鸣更明显（"咚"），噪声偏窄
  break_wood: spec(0.46, [
    noise({ at: 0, dur: 0.06, gain: 0.7, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'highpass', hz: 1800, q: 0.8 }),
    noise({ at: 0, dur: 0.16, gain: 0.9, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'bandpass', hz: 900, q: 1.4 }),
    tone({ at: 0, dur: 0.16, gain: 0.5, env: curve([0, 0], [0.04, 1], [1, 0]), wave: 'triangle', hz: 230, pitch: curve([1, 0.62]) }),
  ]),
  // 草/树叶：只有摩擦，没有体量（所以很轻、很快）
  break_grass: spec(0.3, [
    noise({ at: 0, dur: 0.13, gain: 1, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'lowpass', hz: 2400, q: 0.6 }),
    noise({ at: 0.01, dur: 0.08, gain: 0.5, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 4200, q: 0.7 }),
  ]),
  break_sand: spec(0.34, [
    noise({ at: 0, dur: 0.16, gain: 1, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'lowpass', hz: 3200, q: 0.5 }),
    noise({ at: 0.02, dur: 0.1, gain: 0.45, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 1700, q: 0.8 }),
  ]),
  // 玻璃：三个高频短音（碎片）+ 一层很高的噪声（不是"一声脆响"就完了）
  break_glass: spec(0.4, [
    tone({ at: 0, dur: 0.22, gain: 0.55, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'sine', hz: 2250, pitch: curve([1, 0.92]) }),
    tone({ at: 0.03, dur: 0.18, gain: 0.4, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'sine', hz: 2950, pitch: curve([1, 0.9]) }),
    tone({ at: 0.07, dur: 0.14, gain: 0.3, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'sine', hz: 3400 }),
    noise({ at: 0, dur: 0.12, gain: 0.5, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'highpass', hz: 5000, q: 0.7 }),
  ]),
  break_wool: spec(0.26, [
    noise({ at: 0, dur: 0.15, gain: 1, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'lowpass', hz: 1100, q: 0.5 }),
    noise({ at: 0.01, dur: 0.1, gain: 0.4, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 700, q: 0.9 }),
  ]),

  // ---------------------------------------------------------------- 放置方块
  // 放方块 = 短、闷、没有碎片（它不该和"挖掉它"一样响）
  place: spec(0.28, [
    tone({ at: 0, dur: 0.07, gain: 0.6, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'square', hz: 300, pitch: curve([1, 0.6]) }),
    noise({ at: 0, dur: 0.05, gain: 0.6, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 1500, q: 1 }),
  ]),
  place_stone: spec(0.3, [
    noise({ at: 0, dur: 0.07, gain: 0.9, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'bandpass', hz: 1800, q: 1.1 }),
    tone({ at: 0, dur: 0.06, gain: 0.5, env: curve([0, 0], [0.08, 1], [1, 0]), wave: 'triangle', hz: 190, pitch: curve([1, 0.7]) }),
  ]),
  place_wood: spec(0.29, [
    noise({ at: 0, dur: 0.07, gain: 0.7, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'bandpass', hz: 1000, q: 1.4 }),
    tone({ at: 0, dur: 0.1, gain: 0.55, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'triangle', hz: 250, pitch: curve([1, 0.75]) }),
  ]),
  place_grass: spec(0.22, [
    noise({ at: 0, dur: 0.08, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'lowpass', hz: 2200, q: 0.6 }),
  ]),
  place_sand: spec(0.24, [
    noise({ at: 0, dur: 0.1, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'lowpass', hz: 3000, q: 0.5 }),
  ]),
  place_glass: spec(0.26, [
    tone({ at: 0, dur: 0.1, gain: 0.6, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sine', hz: 2100 }),
    noise({ at: 0, dur: 0.04, gain: 0.4, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 4200, q: 0.8 }),
  ]),
  place_wool: spec(0.2, [
    noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'lowpass', hz: 1000, q: 0.5 }),
  ]),

  // ---------------------------------------------------------------- 脚步
  // 脚步的判据：**短、软、比破坏音低一档**。玩家每 1.6 格就听一次，
  // 任何"亮"的成分都会在连续走动时变成噪音。
  step: spec(0.16, [
    noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'lowpass', hz: 1400, q: 0.6 }),
  ], {
    jitter: 60,
    variants: [
      [
        noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'lowpass', hz: 1400, q: 0.6 }),
      ],
      [
        noise({ at: 0, dur: 0.06, gain: 0.9, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 1700, q: 1 }),
        tone({ at: 0, dur: 0.05, gain: 0.25, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 130 }),
      ],
    ],
  }),
  step_grass: spec(0.15, [
    noise({ at: 0, dur: 0.08, gain: 1, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'lowpass', hz: 2200, q: 0.6 }),
    tone({ at: 0, dur: 0.05, gain: 0.2, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 120 }),
  ], {
    jitter: 70,
    variants: [
      [
        noise({ at: 0, dur: 0.08, gain: 1, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'lowpass', hz: 2200, q: 0.6 }),
        tone({ at: 0, dur: 0.05, gain: 0.2, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 120 }),
      ],
      [
        noise({ at: 0, dur: 0.09, gain: 0.9, env: curve([0, 0], [0.18, 1], [1, 0]), filter: 'bandpass', hz: 2600, q: 0.7 }),
      ],
      [
        noise({ at: 0, dur: 0.075, gain: 1, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'lowpass', hz: 1800, q: 0.5 }),
        noise({ at: 0.02, dur: 0.05, gain: 0.4, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 3800, q: 0.8 }),
      ],
    ],
  }),
  step_stone: spec(0.16, [
    noise({ at: 0, dur: 0.055, gain: 1, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'bandpass', hz: 2400, q: 1.1 }),
    tone({ at: 0, dur: 0.05, gain: 0.25, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 190 }),
  ], {
    jitter: 55,
    variants: [
      [
        noise({ at: 0, dur: 0.055, gain: 1, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'bandpass', hz: 2400, q: 1.1 }),
        tone({ at: 0, dur: 0.05, gain: 0.25, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 190 }),
      ],
      [
        noise({ at: 0, dur: 0.06, gain: 1, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'bandpass', hz: 1900, q: 1.4 }),
        noise({ at: 0, dur: 0.03, gain: 0.5, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'highpass', hz: 4200, q: 0.7 }),
      ],
    ],
  }),
  step_wood: spec(0.17, [
    noise({ at: 0, dur: 0.06, gain: 0.8, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 1000, q: 1.4 }),
    tone({ at: 0, dur: 0.09, gain: 0.45, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'triangle', hz: 240, pitch: curve([1, 0.8]) }),
  ], {
    jitter: 55,
    variants: [
      [
        noise({ at: 0, dur: 0.06, gain: 0.8, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 1000, q: 1.4 }),
        tone({ at: 0, dur: 0.09, gain: 0.45, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'triangle', hz: 240, pitch: curve([1, 0.8]) }),
      ],
      [
        tone({ at: 0, dur: 0.1, gain: 0.5, env: curve([0, 0], [0.08, 1], [1, 0]), wave: 'triangle', hz: 200, pitch: curve([1, 0.85]) }),
        noise({ at: 0, dur: 0.045, gain: 0.5, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 1400, q: 1.2 }),
      ],
    ],
  }),
  step_sand: spec(0.15, [
    noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 3000, q: 0.5 }),
  ], {
    jitter: 80,
    variants: [
      [
        noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 3000, q: 0.5 }),
      ],
      [
        noise({ at: 0, dur: 0.1, gain: 1, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'bandpass', hz: 3600, q: 0.6 }),
      ],
    ],
  }),
  // 砂砾：三个错开的短爆（"咯吱咯吱"的颗粒感）
  step_gravel: spec(0.16, [
    noise({ at: 0, dur: 0.035, gain: 0.9, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 2500, q: 1.2 }),
    noise({ at: 0.028, dur: 0.03, gain: 0.7, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 3100, q: 1.4 }),
    noise({ at: 0.055, dur: 0.04, gain: 0.8, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 2200, q: 1 }),
  ], { jitter: 90 }),
  step_snow: spec(0.13, [
    noise({ at: 0, dur: 0.1, gain: 1, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'lowpass', hz: 3500, q: 0.5 }),
    noise({ at: 0, dur: 0.06, gain: 0.4, env: curve([0, 0], [0.3, 1], [1, 0]), filter: 'bandpass', hz: 1200, q: 0.7 }),
  ], { jitter: 70 }),
  step_wool: spec(0.12, [
    noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'lowpass', hz: 1100, q: 0.5 }),
  ], { jitter: 60 }),

  // ---------------------------------------------------------------- 挖掘中的摩擦
  // 挖矿时每 0.2 秒响一次。判据是"短、闷、比破坏音轻"——它的作用是
  // 让玩家在方块碎掉之前就知道"我正在挖"，而不是替掉挖断那一声。
  dig_stone: spec(0.16, [
    noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 1800, q: 1.6 }),
    noise({ at: 0, dur: 0.05, gain: 0.5, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'highpass', hz: 3600, q: 0.8 }),
  ], { jitter: 80 }),
  dig_wood: spec(0.15, [
    noise({ at: 0, dur: 0.09, gain: 0.9, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 900, q: 1.8 }),
    tone({ at: 0, dur: 0.08, gain: 0.3, env: curve([0, 0], [0.15, 1], [1, 0]), wave: 'triangle', hz: 210, pitch: curve([1, 0.8]) }),
  ], { jitter: 70 }),
  dig_soft: spec(0.13, [
    noise({ at: 0, dur: 0.1, gain: 1, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'lowpass', hz: 1900, q: 0.6 }),
  ], { jitter: 90 }),
  dig_glass: spec(0.14, [
    noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'highpass', hz: 4800, q: 0.9 }),
  ], { jitter: 60 }),

  // ---------------------------------------------------------------- 落地
  // 软着陆：一声很短的闷响（脚掌拍地），没有碎石
  land_soft: spec(0.3, [
    tone({ at: 0, dur: 0.12, gain: 0.7, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'sine', hz: 95, pitch: curve([1, 0.6]) }),
    noise({ at: 0, dur: 0.08, gain: 0.6, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'lowpass', hz: 900, q: 0.7 }),
  ], { jitter: 40 }),
  // 硬着陆：更低的闷响 + 碎石 + 稍微长一点的尾（"砰——"）
  land_hard: spec(0.42, [
    tone({ at: 0, dur: 0.26, gain: 0.85, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sine', hz: 72, pitch: curve([1, 0.5]) }),
    noise({ at: 0, dur: 0.14, gain: 0.9, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'lowpass', hz: 700, q: 0.6 }),
    noise({ at: 0.02, dur: 0.16, gain: 0.35, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 2100, q: 0.8 }),
  ], {
    jitter: 30,
    variants: [
      [
        tone({ at: 0, dur: 0.26, gain: 0.85, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sine', hz: 72, pitch: curve([1, 0.5]) }),
        noise({ at: 0, dur: 0.14, gain: 0.9, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'lowpass', hz: 700, q: 0.6 }),
        noise({ at: 0.02, dur: 0.16, gain: 0.35, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 2100, q: 0.8 }),
      ],
      [
        tone({ at: 0, dur: 0.3, gain: 0.8, env: curve([0, 0], [0.04, 1], [1, 0]), wave: 'sine', hz: 64, pitch: curve([1, 0.55]) }),
        noise({ at: 0, dur: 0.18, gain: 0.9, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'lowpass', hz: 600, q: 0.5 }),
      ],
    ],
  }),
  // 旧名字（K5 就有），保留给"从高处掉下来"这一档，与 `land_hard` 略有区别
  fall: spec(0.38, [
    tone({ at: 0, dur: 0.22, gain: 0.8, env: curve([0, 0], [0.04, 1], [1, 0]), wave: 'triangle', hz: 120, pitch: curve([1, 0.55]) }),
    noise({ at: 0, dur: 0.12, gain: 0.7, env: curve([0, 0], [0.07, 1], [1, 0]), filter: 'lowpass', hz: 800, q: 0.8 }),
  ], { jitter: 35 }),

  // ---------------------------------------------------------------- 玩家受伤/死亡
  //
  // 批次 236：这一版是**两段元音**，不是一条长滑音。
  // 只说"锯齿波 + 共振峰"仍然会像合成器，原因有三条，这次逐条改掉：
  //  1. **共振峰的 Q 太高**（7~12）会变成几个"哨音"，人声的 F1/F2 大约 Q 4~6；
  //  2. **元音从头到尾不变** → "机器人在念 uh"；真实的一声"呃啊"是
  //     喉咙先闭（F1 500 / F2 900）、再张开（F1 730 / F2 1150）；
  //  3. **没有起音**：真人挨打先是短促的"h"（呼气），再出声带；
  //     所以这里补了一层 0.05 秒的带通噪声。
  //
  // 另外保留批次 234 的两层"手机外放听得见"的东西：2.4k 的咬字层与低频胸腔。
  // 音量 0.42 → 0.46，抖动 45 音分（每次挨打音高都不同）。
  hurt: spec(0.46, [
    // ---- 起音："呃"（喉咙闭着）
    tone({
      at: 0,
      dur: 0.13,
      gain: 0.8,
      env: curve([0, 0], [0.06, 1], [0.6, 0.8], [1, 0]),
      wave: 'sawtooth',
      hz: 172,
      pitch: curve([0.3, 1.06], [1, 0.84]),
      formants: [
        { hz: 500, q: 4.5, gain: 1 },
        { hz: 900, q: 5.5, gain: 0.55 },
        { hz: 2400, q: 7, gain: 0.1 },
      ],
      vibrato: { hz: 7, cents: 15 },
    }),
    // ---- 尾音："啊"（张口，气从胸口出来）
    tone({
      at: 0.055,
      dur: 0.28,
      gain: 0.9,
      env: curve([0, 0], [0.14, 1], [0.55, 0.72], [1, 0]),
      wave: 'sawtooth',
      hz: 160,
      pitch: curve([0.2, 1.08], [1, 0.6]),
      formants: [
        { hz: 730, q: 5, gain: 1 },
        { hz: 1150, q: 6, gain: 0.55 },
        { hz: 2500, q: 8, gain: 0.12 },
      ],
      vibrato: { hz: 5, cents: 18 },
      tremolo: { hz: 14, depth: 0.16 },
    }),
    // ---- 起音的"h"（不是元音，是一口气）
    noise({ at: 0, dur: 0.05, gain: 0.5, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 900, q: 0.7 }),
    // ---- 咬字/牙齿（手机喇叭在 1k 以上衰减很快，没有这层会听不清）
    noise({ at: 0.01, dur: 0.09, gain: 0.3, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 2400, q: 0.7 }),
    // ---- 胸腔（一声"闷"的重量）
    tone({ at: 0, dur: 0.16, gain: 0.28, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'sine', hz: 98, pitch: curve([1, 0.6]) }),
  ], {
    jitter: 45,
    variants: [
      // 短促的"呃"（轻伤）
      [
        tone({
          at: 0,
          dur: 0.12,
          gain: 0.8,
          env: curve([0, 0], [0.06, 1], [0.6, 0.8], [1, 0]),
          wave: 'sawtooth',
          hz: 182,
          pitch: curve([0.3, 1.05], [1, 0.8]),
          formants: [
            { hz: 470, q: 4.5, gain: 1 },
            { hz: 860, q: 5.5, gain: 0.5 },
            { hz: 2350, q: 7, gain: 0.1 },
          ],
          vibrato: { hz: 8, cents: 14 },
        }),
        noise({ at: 0, dur: 0.045, gain: 0.5, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 820, q: 0.7 }),
        noise({ at: 0.01, dur: 0.07, gain: 0.26, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 2500, q: 0.7 }),
        tone({ at: 0, dur: 0.12, gain: 0.26, env: curve([0, 0], [0.06, 1], [1, 0]), wave: 'sine', hz: 105, pitch: curve([1, 0.65]) }),
      ],
      // 长的"啊"（重伤）
      [
        tone({
          at: 0,
          dur: 0.16,
          gain: 0.8,
          env: curve([0, 0], [0.06, 1], [0.6, 0.8], [1, 0]),
          wave: 'sawtooth',
          hz: 178,
          pitch: curve([0.3, 1.05], [1, 0.82]),
          formants: [
            { hz: 520, q: 4.5, gain: 1 },
            { hz: 950, q: 5.5, gain: 0.55 },
            { hz: 2400, q: 7, gain: 0.1 },
          ],
          vibrato: { hz: 6.5, cents: 16 },
        }),
        tone({
          at: 0.06,
          dur: 0.38,
          gain: 0.9,
          env: curve([0, 0], [0.16, 1], [0.5, 0.75], [1, 0]),
          wave: 'sawtooth',
          hz: 168,
          pitch: curve([0.2, 1.06], [1, 0.52]),
          formants: [
            { hz: 780, q: 5, gain: 1 },
            { hz: 1200, q: 6, gain: 0.5 },
            { hz: 2550, q: 8, gain: 0.1 },
          ],
          vibrato: { hz: 4.5, cents: 24 },
          tremolo: { hz: 12, depth: 0.18 },
        }),
        noise({ at: 0, dur: 0.06, gain: 0.55, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 950, q: 0.7 }),
        noise({ at: 0.02, dur: 0.14, gain: 0.3, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'highpass', hz: 2300, q: 0.7 }),
        tone({ at: 0, dur: 0.24, gain: 0.3, env: curve([0, 0], [0.08, 1], [1, 0]), wave: 'sine', hz: 92, pitch: curve([1, 0.5]) }),
      ],
      // 低沉的一声"呃"（血厚/低音色，避免每次都一样）
      [
        tone({
          at: 0,
          dur: 0.15,
          gain: 0.8,
          env: curve([0, 0], [0.07, 1], [0.6, 0.8], [1, 0]),
          wave: 'sawtooth',
          hz: 138,
          pitch: curve([0.3, 1.06], [1, 0.78]),
          formants: [
            { hz: 460, q: 4, gain: 1 },
            { hz: 820, q: 5, gain: 0.5 },
            { hz: 2200, q: 7, gain: 0.1 },
          ],
          vibrato: { hz: 7.5, cents: 14 },
        }),
        tone({
          at: 0.05,
          dur: 0.3,
          gain: 0.9,
          env: curve([0, 0], [0.16, 1], [0.55, 0.7], [1, 0]),
          wave: 'sawtooth',
          hz: 128,
          pitch: curve([0.25, 1.06], [1, 0.55]),
          formants: [
            { hz: 660, q: 4.5, gain: 1 },
            { hz: 1050, q: 5.5, gain: 0.5 },
            { hz: 2350, q: 8, gain: 0.1 },
          ],
          vibrato: { hz: 5, cents: 20 },
          tremolo: { hz: 15, depth: 0.14 },
        }),
        noise({ at: 0, dur: 0.05, gain: 0.45, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 780, q: 0.7 }),
        noise({ at: 0.01, dur: 0.1, gain: 0.28, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 2200, q: 0.7 }),
        tone({ at: 0, dur: 0.2, gain: 0.32, env: curve([0, 0], [0.07, 1], [1, 0]), wave: 'sine', hz: 84, pitch: curve([1, 0.55]) }),
      ],
    ],
  }),
  // 死亡：同样的"两段元音"，但拖得更长、尾音更低、呼气更多
  death: spec(0.5, [
    tone({
      at: 0,
      dur: 0.2,
      gain: 0.8,
      env: curve([0, 0], [0.06, 1], [0.6, 0.8], [1, 0]),
      wave: 'sawtooth',
      hz: 168,
      pitch: curve([0.3, 1.04], [1, 0.82]),
      formants: [
        { hz: 520, q: 4.5, gain: 1 },
        { hz: 940, q: 5.5, gain: 0.55 },
        { hz: 2350, q: 7, gain: 0.1 },
      ],
      vibrato: { hz: 6, cents: 16 },
    }),
    tone({
      at: 0.12,
      dur: 0.75,
      gain: 0.9,
      env: curve([0, 0], [0.14, 1], [0.4, 0.8], [0.75, 0.5], [1, 0]),
      wave: 'sawtooth',
      hz: 158,
      pitch: curve([0.2, 1.05], [1, 0.38]),
      formants: [
        { hz: 720, q: 4.5, gain: 1 },
        { hz: 1120, q: 5.5, gain: 0.5 },
        { hz: 2300, q: 8, gain: 0.1 },
      ],
      vibrato: { hz: 3.6, cents: 26 },
      tremolo: { hz: 9, depth: 0.14 },
    }),
    noise({ at: 0, dur: 0.07, gain: 0.5, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 900, q: 0.7 }),
    noise({ at: 0.05, dur: 0.7, gain: 0.28, env: curve([0, 0], [0.25, 1], [1, 0]), filter: 'lowpass', hz: 1100, q: 0.6 }),
    noise({ at: 0, dur: 0.12, gain: 0.26, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 2300, q: 0.7 }),
    tone({ at: 0, dur: 0.6, gain: 0.3, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 88, pitch: curve([1, 0.42]) }),
  ], { jitter: 25 }),
  // 打中生物的"闷响"（玩家近战那一下的打击感；不代替生物的受伤叫）
  hit_flesh: spec(0.3, [
    noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'lowpass', hz: 650, q: 0.8 }),
    tone({ at: 0, dur: 0.09, gain: 0.5, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'sine', hz: 105, pitch: curve([1, 0.65]) }),
  ], { jitter: 30 }),

  // ---------------------------------------------------------------- 开关与交互
  door: spec(0.3, [
    tone({
      at: 0,
      dur: 0.38,
      gain: 0.55,
      env: curve([0, 0], [0.15, 1], [0.7, 0.8], [1, 0]),
      wave: 'sawtooth',
      hz: 170,
      pitch: curve([0.5, 1.25], [1, 0.9]),
      vibrato: { hz: 8, cents: 45 },
    }),
    noise({ at: 0, dur: 0.36, gain: 0.4, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 800, q: 3.2 }),
  ]),
  door_close: spec(0.36, [
    tone({ at: 0, dur: 0.16, gain: 0.7, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'square', hz: 230, pitch: curve([1, 0.45]) }),
    noise({ at: 0, dur: 0.12, gain: 0.6, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'lowpass', hz: 900, q: 2.4 }),
    tone({ at: 0, dur: 0.2, gain: 0.35, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sine', hz: 95, pitch: curve([1, 0.6]) }),
  ]),
  trapdoor: spec(0.34, [
    tone({ at: 0, dur: 0.18, gain: 0.65, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'square', hz: 200, pitch: curve([1, 0.55]) }),
    noise({ at: 0, dur: 0.14, gain: 0.7, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'bandpass', hz: 1100, q: 2.2 }),
    tone({ at: 0, dur: 0.16, gain: 0.3, env: curve([0, 0], [0.04, 1], [1, 0]), wave: 'sine', hz: 115 }),
  ]),
  fence_gate: spec(0.28, [
    tone({ at: 0, dur: 0.2, gain: 0.5, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sawtooth', hz: 330, pitch: curve([1, 0.6]) }),
    noise({ at: 0, dur: 0.16, gain: 0.55, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 1500, q: 2 }),
  ]),
  shield_block: spec(0.38, [
    tone({ at: 0, dur: 0.2, gain: 0.7, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'square', hz: 300, pitch: curve([1, 0.4]) }),
    noise({ at: 0, dur: 0.1, gain: 0.7, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'bandpass', hz: 1800, q: 1.6 }),
    tone({ at: 0, dur: 0.16, gain: 0.5, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'sine', hz: 120, pitch: curve([1, 0.55]) }),
  ]),

  // ---------------------------------------------------------------- 环境
  // 爆炸：低频主体 + 早期的高频"撕裂" + 一条长尾
  explode: spec(0.62, [
    noise({ at: 0, dur: 0.9, gain: 1, env: curve([0, 0], [0.008, 1], [0.25, 0.6], [1, 0]), filter: 'lowpass', hz: 520, q: 0.5, sweep: curve([0.4, 1.5]) }),
    noise({ at: 0, dur: 0.18, gain: 0.8, env: curve([0, 0], [0.01, 1], [1, 0]), filter: 'bandpass', hz: 1600, q: 0.7 }),
    tone({ at: 0, dur: 0.7, gain: 0.9, env: curve([0, 0], [0.01, 1], [1, 0]), wave: 'sine', hz: 62, pitch: curve([1, 0.35]) }),
  ], { jitter: 20 }),
  thunder: spec(0.68, [
    noise({ at: 0, dur: 1.7, gain: 1, env: curve([0, 0], [0.02, 1], [0.4, 0.8], [1, 0]), filter: 'lowpass', hz: 330, q: 0.5, sweep: curve([1, 0.55]) }),
    tone({ at: 0, dur: 1.5, gain: 0.5, env: curve([0, 0], [0.05, 1], [0.5, 0.7], [1, 0]), wave: 'sine', hz: 46, pitch: curve([1, 0.7]) }),
    noise({ at: 0.1, dur: 1.2, gain: 0.3, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'lowpass', hz: 180, q: 0.6, tremolo: { hz: 0.9, depth: 0.5 } }),
  ], { jitter: 0 }),
  splash: spec(0.3, [
    noise({ at: 0, dur: 0.32, gain: 1, env: curve([0, 0], [0.03, 1], [1, 0]), filter: 'bandpass', hz: 2200, q: 0.5, sweep: curve([1, 1.7]) }),
    noise({ at: 0.04, dur: 0.3, gain: 0.45, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'highpass', hz: 3500, q: 0.6 }),
    tone({ at: 0.06, dur: 0.14, gain: 0.3, env: curve([0, 0], [0.2, 1], [1, 0]), wave: 'sine', hz: 900, pitch: curve([1, 1.6]) }),
  ], { jitter: 60 }),
  portal: spec(0.36, [
    tone({
      at: 0,
      dur: 0.85,
      gain: 0.8,
      env: curve([0, 0], [0.15, 1], [0.7, 0.85], [1, 0]),
      wave: 'sawtooth',
      hz: 220,
      pitch: curve([0.5, 1.15], [1, 0.55]),
      vibrato: { hz: 3.2, cents: 40 },
    }),
    noise({ at: 0, dur: 0.8, gain: 0.2, env: curve([0, 0], [0.3, 1], [1, 0]), filter: 'lowpass', hz: 900, q: 1.5 }),
  ]),
  fuse: spec(0.26, [
    noise({ at: 0, dur: 1.3, gain: 1, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'highpass', hz: 1500, q: 0.7, sweep: curve([1, 2]), tremolo: { hz: 7, depth: 0.35 } }),
    tone({ at: 0, dur: 1.2, gain: 0.12, env: curve([0, 0], [0.2, 1], [1, 0]), wave: 'triangle', hz: 220, pitch: curve([1, 1.4]) }),
  ]),

  // ---------------------------------------------------------------- 界面与工具
  click: spec(0.24, [
    tone({ at: 0, dur: 0.05, gain: 0.8, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'square', hz: 950, pitch: curve([1, 0.82]) }),
    noise({ at: 0, dur: 0.025, gain: 0.3, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'highpass', hz: 4000, q: 0.8 }),
  ], { jitter: 30 }),
  item_move: spec(0.15, [
    tone({ at: 0, dur: 0.04, gain: 0.7, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'square', hz: 560, pitch: curve([1, 0.65]) }),
    noise({ at: 0, dur: 0.02, gain: 0.35, env: curve([0, 0], [0.15, 1], [1, 0]), filter: 'bandpass', hz: 2400, q: 1.2 }),
  ], { jitter: 60 }),
  pickup: spec(0.22, [
    tone({ at: 0, dur: 0.09, gain: 0.8, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'sine', hz: 620, pitch: curve([0.5, 1.5], [1, 1.2]) }),
  ], { jitter: 40 }),
  xp: spec(0.2, [
    tone({ at: 0, dur: 0.18, gain: 0.7, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'sine', hz: 1320, pitch: curve([0.5, 1.25], [1, 1]) }),
    tone({ at: 0.03, dur: 0.16, gain: 0.35, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'sine', hz: 1980 }),
  ], { jitter: 35 }),
  achievement: spec(0.34, [
    tone({ at: 0, dur: 0.5, gain: 0.7, env: curve([0, 0], [0.03, 1], [0.6, 0.6], [1, 0]), wave: 'sine', hz: 880 }),
    tone({ at: 0.16, dur: 0.7, gain: 0.6, env: curve([0, 0], [0.03, 1], [0.6, 0.5], [1, 0]), wave: 'sine', hz: 1568, pitch: curve([1, 1.002]) }),
  ]),
  trade: spec(0.28, [
    tone({ at: 0, dur: 0.1, gain: 0.7, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'triangle', hz: 1250 }),
    tone({ at: 0.08, dur: 0.14, gain: 0.6, env: curve([0, 0], [0.03, 1], [1, 0]), wave: 'triangle', hz: 1870 }),
  ]),
  eat: spec(0.22, [
    noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'bandpass', hz: 1700, q: 1.4 }),
    noise({ at: 0.02, dur: 0.07, gain: 0.6, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'lowpass', hz: 700, q: 1 }),
  ], {
    jitter: 90,
    variants: [
      [
        noise({ at: 0, dur: 0.09, gain: 1, env: curve([0, 0], [0.08, 1], [1, 0]), filter: 'bandpass', hz: 1700, q: 1.4 }),
        noise({ at: 0.02, dur: 0.07, gain: 0.6, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'lowpass', hz: 700, q: 1 }),
      ],
      [
        noise({ at: 0, dur: 0.08, gain: 1, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 2100, q: 1.8 }),
      ],
      [
        noise({ at: 0, dur: 0.06, gain: 0.9, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'bandpass', hz: 1400, q: 1.2 }),
        noise({ at: 0.04, dur: 0.06, gain: 0.7, env: curve([0, 0], [0.12, 1], [1, 0]), filter: 'bandpass', hz: 1900, q: 1.5 }),
      ],
    ],
  }),
  // 喝（药水/牛奶）：连续"咕咚"（幅度抖动），没有咀嚼的脆感
  drink: spec(0.24, [
    noise({ at: 0, dur: 0.3, gain: 0.7, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 900, q: 1.2, tremolo: { hz: 14, depth: 0.7 } }),
    tone({ at: 0, dur: 0.3, gain: 0.3, env: curve([0, 0], [0.1, 1], [1, 0]), wave: 'sine', hz: 300, pitch: curve([1, 0.7]), vibrato: { hz: 9, cents: 60 } }),
  ], { jitter: 30 }),
  bow_shoot: spec(0.34, [
    noise({ at: 0, dur: 0.05, gain: 0.7, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'bandpass', hz: 2600, q: 1.2 }),
    tone({ at: 0, dur: 0.2, gain: 0.85, env: curve([0, 0], [0.02, 1], [1, 0]), wave: 'triangle', hz: 420, pitch: curve([0.15, 1.15], [1, 0.32]) }),
  ], { jitter: 25 }),
  arrow_hit: spec(0.26, [
    noise({ at: 0, dur: 0.07, gain: 1, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'bandpass', hz: 1900, q: 1.6 }),
    tone({ at: 0, dur: 0.08, gain: 0.5, env: curve([0, 0], [0.05, 1], [1, 0]), wave: 'square', hz: 460, pitch: curve([1, 0.5]) }),
  ], { jitter: 40 }),
  shear: spec(0.28, [
    noise({ at: 0, dur: 0.05, gain: 1, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'highpass', hz: 5200, q: 0.7 }),
    noise({ at: 0.05, dur: 0.05, gain: 0.8, env: curve([0, 0], [0.1, 1], [1, 0]), filter: 'highpass', hz: 4200, q: 0.7 }),
  ], { jitter: 40 }),
  flint: spec(0.32, [
    noise({ at: 0, dur: 0.1, gain: 0.9, env: curve([0, 0], [0.05, 1], [1, 0]), filter: 'highpass', hz: 3000, q: 0.8, sweep: curve([1, 0.35]) }),
    noise({ at: 0.08, dur: 0.22, gain: 0.5, env: curve([0, 0], [0.2, 1], [1, 0]), filter: 'bandpass', hz: 1200, q: 0.7, sweep: curve([1, 1.6]) }),
    tone({ at: 0.08, dur: 0.2, gain: 0.25, env: curve([0, 0], [0.15, 1], [1, 0]), wave: 'triangle', hz: 320, pitch: curve([1, 0.7]) }),
  ], { jitter: 35 }),
};

/**
 * 开关类方块 → 音效（批次 138）。
 *
 * 抽成纯函数的原因与 `breakSoundFor` 一样：**三种门的"声音分工"是纯逻辑**，
 * 而"哪一格是门"要在主程序里判。原来三种门共用 `door`，症状是
 * "关活板门听着像在推开一扇吱呀作响的大门"。
 */
export function doorSoundFor(shape: string, opened: boolean): SoundKind {
  if (shape === 'trapdoor') return 'trapdoor';
  if (shape === 'fence_gate') return 'fence_gate';
  return opened ? 'door' : 'door_close';
}

/**
 * 水下闷响（批次 138）：听者在水下时，所有音效过一道低通并压低音量。
 *
 * 批次 232 起它和"距离低通"合并成同一个滤波器（取两者更低的那个截止频率）——
 * 两件事都是"把高频削掉"，分两个滤波器只是多一倍节点。
 */
export const UNDERWATER_LOWPASS_HZ = 700;
export const UNDERWATER_GAIN = 0.55;

/** 水下的音量折算（纯函数，好断言；水下不该比空气里响） */
export function underwaterGain(gain: number): number {
  return gain * UNDERWATER_GAIN;
}

/** 全部音效种类（测试用：新增一种忘了填参数，这里会当场露） */
export const SOUND_KINDS = Object.keys(SOUNDS) as SoundKind[];

/** 取某个音效的参数（测试用） */
export function soundSpec(kind: SoundKind): SoundSpec | undefined {
  return SOUNDS[kind];
}

/**
 * 音量分组（批次 178，M20 的最后一项）。
 *
 * 原版把音量拆成"主音量 + 音乐 + 方块 + 生物 + 环境 + 语音"；本项目没有音乐与语音，
 * 于是收敛成**四组**：方块（挖/放/门/工具）、生物（叫/受伤）、玩家（脚步/受伤/吃/弓）、
 * 界面与环境（按钮/达成/交易/雷声/爆炸/传送门）。
 *
 * ⚠️ 生物那一组不在这张表里——它的声音是按"种类档案"播的（`MobVoices.ts`），
 * 走 `AudioEngine.playVoice()` 时固定归 `mobs`。表里留空的组仍然是有效设置项。
 *
 * ⚠️ 这张表**必须是穷尽映射**（`Record<SoundKind, …>`）：加了新音效却忘了分组，
 * 编译期就会报错——而不是等到玩家发现"这个声音调不小"。
 */
export type SoundGroup = 'blocks' | 'mobs' | 'player' | 'ui' | 'ambient' | 'music';

export const SOUND_GROUPS: Readonly<Record<SoundKind, SoundGroup>> = {
  break_stone: 'blocks',
  break_wood: 'blocks',
  break_grass: 'blocks',
  break_sand: 'blocks',
  break_glass: 'blocks',
  break_wool: 'blocks',
  place: 'blocks',
  place_stone: 'blocks',
  place_wood: 'blocks',
  place_grass: 'blocks',
  place_sand: 'blocks',
  place_glass: 'blocks',
  place_wool: 'blocks',
  door: 'blocks',
  door_close: 'blocks',
  trapdoor: 'blocks',
  fence_gate: 'blocks',
  flint: 'blocks',
  shear: 'blocks',
  dig_stone: 'blocks',
  dig_wood: 'blocks',
  dig_soft: 'blocks',
  dig_glass: 'blocks',
  step: 'player',
  step_grass: 'player',
  step_stone: 'player',
  step_wood: 'player',
  step_sand: 'player',
  step_gravel: 'player',
  step_snow: 'player',
  step_wool: 'player',
  land_soft: 'player',
  land_hard: 'player',
  hurt: 'player',
  death: 'player',
  hit_flesh: 'player',
  fall: 'player',
  splash: 'player',
  eat: 'player',
  drink: 'player',
  pickup: 'player',
  xp: 'player',
  bow_shoot: 'player',
  arrow_hit: 'player',
  shield_block: 'player',
  click: 'ui',
  achievement: 'ui',
  trade: 'ui',
  item_move: 'ui',
  explode: 'ui',
  thunder: 'ui',
  portal: 'ui',
  fuse: 'ui',
};

/** 某个音效属于哪一组（界面与测试用） */
export function soundGroupOf(kind: SoundKind): SoundGroup {
  return SOUND_GROUPS[kind];
}

/** 四组的显示顺序与中文名（设置界面按它排） */
export const SOUND_GROUP_LABELS: Readonly<Record<SoundGroup, string>> = {
  blocks: '方块音效',
  mobs: '生物音效',
  player: '玩家音效',
  ui: '界面与环境',
  ambient: '环境音（雨声）',
  music: '背景音乐',
};

/**
 * 方块名 → 破坏音效。抽成纯函数是为了能离线测试：
 * 引擎本身需要 AudioContext（浏览器才有），但"什么材质响什么声"是纯逻辑。
 */
export function breakSoundFor(blockName: string): SoundKind {
  const name = blockName.replace('minecraft:', '');
  if (name.includes('glass') || name.includes('ice')) return 'break_glass';
  if (name.includes('wool') || name.includes('wart') || name.includes('carpet')) return 'break_wool';
  if (name.includes('sand') || name.includes('gravel') || name.includes('soul_soil')) return 'break_sand';
  if (name.includes('grass') || name.includes('leaves') || name.includes('nylium') || name.includes('fern')) {
    return 'break_grass';
  }
  if (
    name.includes('planks') ||
    name.includes('log') ||
    name.includes('wood') ||
    name.includes('stem') ||
    name.includes('door') ||
    name.includes('fence') ||
    name.includes('bamboo') ||
    name.includes('chest') ||
    name.includes('table') ||
    name.includes('pumpkin') ||
    name.includes('melon') ||
    // 床（批次 79）：木框 + 羊毛，归木头那一档。
    // ⚠️ 用 `endsWith` 而不是 `includes('bed')`——后者会把 `bedrock`（基岩）也算成木头
    name.endsWith('_bed') ||
    // 告示牌（批次 80）：木板做的，同样是木头声
    name.endsWith('_sign')
  ) {
    return 'break_wood';
  }
  return 'break_stone';
}

/**
 * 方块名 → 脚步声（批次 232）。
 *
 * 以前脚步直接复用 `break_*`（草方块用"挖草"的声音），结果走路像一直在挖方块。
 * 脚步要的是"短、软、比破坏音低一档"，所以是**独立一套**，不是破坏音的降调版。
 *
 * ⚠️ 顺序要紧：`gravel` 归砂砾（不是沙子），`snow` 先于 `block`，
 * `carpet`/`wool` 归软材质——与 `breakSoundFor` 的分类口径保持一致，但多了一档"砂砾"。
 */
export function stepSoundFor(blockName: string): SoundKind {
  const name = blockName.replace('minecraft:', '');
  if (name.includes('snow')) return 'step_snow';
  if (name.includes('wool') || name.includes('carpet') || name.includes('wart')) return 'step_wool';
  if (name.includes('gravel')) return 'step_gravel';
  if (name.includes('sand') || name.includes('soul_soil')) return 'step_sand';
  if (name.includes('glass') || name.includes('ice')) return 'step_stone';
  // 泥土/耕地是"松软带颗粒"的，不是石头的硬响
  if (name.includes('dirt') || name.includes('farmland')) return 'step_gravel';
  if (
    name.includes('grass') ||
    name.includes('leaves') ||
    name.includes('moss') ||
    name.includes('nylium') ||
    name.includes('fern') ||
    name.includes('azalea') ||
    name.includes('podzol') ||
    name.includes('mycelium')
  ) {
    return 'step_grass';
  }
  if (
    name.includes('planks') ||
    name.includes('log') ||
    name.includes('wood') ||
    name.includes('stem') ||
    name.includes('bamboo') ||
    name.includes('chest') ||
    name.includes('table') ||
    name.endsWith('_sign')
  ) {
    return 'step_wood';
  }
  return 'step_stone';
}

/**
 * 方块名 → 挖掘中的摩擦声（批次 233）。
 *
 * 与脚步/破坏同一套材质口径，但只有四档：石头 / 木头 / 松软（草沙土羊毛）/ 玻璃。
 * 再多分档对"每 0.2 秒响一次"的摩擦声没有意义，反而会听出奇怪的跳变。
 */
export function digSoundFor(blockName: string): SoundKind {
  const name = blockName.replace('minecraft:', '');
  if (name.includes('glass') || name.includes('ice')) return 'dig_glass';
  if (
    name.includes('planks') ||
    name.includes('log') ||
    name.includes('wood') ||
    name.includes('stem') ||
    name.includes('bamboo') ||
    name.includes('chest') ||
    name.includes('table') ||
    name.endsWith('_sign')
  ) {
    return 'dig_wood';
  }
  if (
    name.includes('grass') ||
    name.includes('leaves') ||
    name.includes('sand') ||
    name.includes('gravel') ||
    name.includes('dirt') ||
    name.includes('snow') ||
    name.includes('wool') ||
    name.includes('carpet')
  ) {
    return 'dig_soft';
  }
  return 'dig_stone';
}

/** 方块名 → 放置音效（批次 232：以前所有方块共用一个 `place`） */
export function placeSoundFor(blockName: string): SoundKind {
  const name = blockName.replace('minecraft:', '');
  if (name.includes('glass') || name.includes('ice')) return 'place_glass';
  if (name.includes('wool') || name.includes('carpet') || name.includes('wart')) return 'place_wool';
  if (name.includes('sand') || name.includes('gravel') || name.includes('soul_soil')) return 'place_sand';
  if (name.includes('grass') || name.includes('leaves') || name.includes('nylium') || name.includes('fern')) {
    return 'place_grass';
  }
  if (
    name.includes('planks') ||
    name.includes('log') ||
    name.includes('wood') ||
    name.includes('stem') ||
    name.includes('bamboo') ||
    name.includes('chest') ||
    name.includes('table') ||
    name.endsWith('_sign')
  ) {
    return 'place_wood';
  }
  return 'place_stone';
}

/** 可听距离（格）：超出这个距离不再播放，省掉无意义的合成开销 */
const HEARING_RANGE = 32;

/**
 * 同一种音效在这么短的时间内**不重复播**（秒，按 AudioContext 时钟）。
 *
 * 挖矿、连击、一群生物同时受击时，同一种声音会在几十毫秒内被请求十几次；
 * 它们叠在一起既听不出区别，又要各自建一套节点。
 * ⚠️ 0.07 秒远小于最密的正常节奏（脚步约 0.37 秒一声、破坏冷却 0.25 秒），
 * 所以 Regular 玩法不会被吞声。
 */
const SAME_SOUND_THROTTLE = 0.07;

/**
 * 同时发声的上限。
 *
 * 超出的请求直接丢弃（不是排队）——密集场景里"少响几声"听不出来，
 * 但省掉的是一整批节点的创建与随后的回收。
 * 批次 232：12 → 16（生物环境叫也进这条路了），并给"最该听见的"留了余地。
 */
const MAX_CONCURRENT_VOICES = 16;

/**
 * 关键的几种声音可以**突破上限**（再宽限这么多声）。
 *
 * 以前 12 声满了之后，第一个被丢的可能正是"玩家受伤"——
 * 一群怪围上来时反而听不见自己挨打。取舍很简单：这几种很少同时响。
 */
const CRITICAL_KINDS: ReadonlySet<string> = new Set(['hurt', 'death', 'explode', 'shield_block']);
const CRITICAL_BYPASS = 4;

/** 混响发送量（0 = 干声）。10% 足够让脚步/弓弦不"贴着脸"，又不至于糊 */
const REVERB_MIX = 0.1;

export class AudioEngine {
  /**
   * WX-017：把 AudioContext 的创建方式注入进来。
   *
   * 默认仍是浏览器 `new AudioContext()`（Web 版行为不变）；
   * 微信小游戏传 `() => wx.createWebAudioContext()` 即可复用整套合成音效。
   */
  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  private ctx: AudioContext | null = null;
  /** 主总线（所有声音都汇到这里 → 压缩器 → 扬声器） */
  private master: GainNode | null = null;
  /** 混响发送（两条反馈延迟；不用卷积，手机上更稳） */
  private reverbSend: GainNode | null = null;
  /** 主音量（与设置里的音量联动） */
  volume = 0.7;
  /**
   * 四组各自的音量倍率（0~1，默认 1 = 不额外衰减）。
   *
   * 与 `volume` 是**相乘**关系：主音量管"整体"，分组管"我想让哪一类更轻"。
   * 分组的默认值给 1 而不是 0.8：默认状态下"没有这个功能"才是对的，
   * 玩家调过之后才有差别（免得一上来所有声音都比以前小一截）。
   */
  private readonly groupVolume: Record<SoundGroup, number> = {
    blocks: 1,
    mobs: 1,
    player: 1,
    ui: 1,
    ambient: 1,
    music: 1,
  };
  /** 是否启用（可在设置里关掉；AudioContext 创建失败时为 false） */
  enabled = true;
  /** 监听者位置（玩家），用于距离衰减 */
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  /** 监听者朝向（弧度，0 = 朝 -Z）：声像靠它算"在左还是在右" */
  private listenerYaw = 0;
  /**
   * 听者是不是在水下（批次 138）：主程序每帧按"眼睛那一格是不是水"设置。
   * 水下所有音效都会**过一道低通 + 压低音量**（见 `UNDERWATER_LOWPASS_HZ`）。
   */
  underwater = false;
  /** 噪声缓冲复用：每次合成都新建 AudioBuffer 会产生大量垃圾 */
  private noiseBuffer: AudioBuffer | null = null;
  /**
   * 环境音的循环节点（批次 233，雨声）。
   *
   * 与所有"一次性合成"不同，它是**常驻**的：一个循环噪声源 + 两条滤波，
   * 音量用 `setTargetAtTime` 平滑推拉（晴/雨之间不会"啪"地切换）。
   * 只有第一次真的需要出声时才建，晴天一分钱不花。
   */
  private ambienceGain: GainNode | null = null;
  /** 音乐声部的结束时刻：与音效的并发上限**分开**计数（音乐不该抢音效的名额） */
  private musicEnds: number[] = [];
  /** 统计播放次数（调试面板用） */
  played = 0;
  /** 每种音效最近一次的起始时刻（秒，AudioContext 时钟），用于同一声的节流 */
  private readonly lastStartAt = new Map<string, number>();
  /** 音符盒那一声的节流（它没有 `SoundKind`，单开一个时间戳，见 `playNote`） */
  private lastNoteAt = -1;
  /** 仍在发声的那些声音的结束时刻（秒），用来数当前并发了几声 */
  private voiceEnds: number[] = [];

  /**
   * 创建/恢复 AudioContext。必须由用户手势触发（浏览器自动播放策略），
   * 因此 main 会把它挂在第一次 pointerdown / keydown 上。
   */
  resume(): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= this.createContext();
      this.ensureGraph(this.ctx);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // 某些环境（无音频设备、隐私模式）会直接抛错：关掉音效，不影响游戏
      this.enabled = false;
    }
  }

  /**
   * 页面进后台时挂起（批次 303）。
   *
   * 主循环 `dt = 0` 只能让音乐导演不再排新音符：雨声是**常驻循环节点**、
   * 已经预约到未来的音符也还在播——只有挂起 AudioContext 才真的安静。
   * 恢复走既有的 `resume()`（它本来就会处理 `suspended`）。
   */
  suspend(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    void ctx.suspend().catch(() => undefined);
  }

  /**
   * 关掉 AudioContext（批次 181）。
   *
   * 应用内"保存并退出到主菜单"会销毁整局 App；不关 context 的话，
   * 每进出一次世界就多一个还在跑的音频线程（手机上几轮就能听见电流声）。
   */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.reverbSend = null;
    this.noiseBuffer = null;
    this.ambienceGain = null;
    this.musicEnds = [];
    this.lastStartAt.clear();
    this.voiceEnds = [];
    if (ctx) void ctx.close().catch(() => undefined);
  }

  /** AudioContext 状态（验收脚本用：suspended 说明还没被用户手势解锁） */
  get contextState(): string {
    return this.ctx?.state ?? 'none';
  }

  /**
   * 建主总线：gain → 压缩器 → 扬声器，外加一条反馈延迟做的混响发送。
   *
   * 为什么不需要卷积混响：我们要的是"有一点空间"而不是"大教堂"。
   * 两条 80/140ms 的反馈延迟就已经能把"贴着脸的干声"推远一点，
   * 而且没有 FFT 卷积的固定开销（手机上更稳）。
   */
  private ensureGraph(ctx: AudioContext): void {
    if (this.master) return;

    const master = ctx.createGain();
    master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    // 阈值不压得太狠：单声几乎不过去，只有"多声叠在一起"才被收住
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    master.connect(comp).connect(ctx.destination);

    const send = ctx.createGain();
    send.gain.value = REVERB_MIX;
    const wetSum = ctx.createGain();
    wetSum.gain.value = 0.55;
    for (const [time, feedback, cutoff] of [
      [0.083, 0.34, 3200],
      [0.137, 0.28, 2600],
    ] as const) {
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = time;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = cutoff;
      const fb = ctx.createGain();
      fb.gain.value = feedback;
      send.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(wetSum);
    }
    // 混响也要过压缩器：不然它的尾巴会把总电平顶上去
    wetSum.connect(comp);

    this.master = master;
    this.reverbSend = send;
  }

  /**
   * 设置某一组的音量（0~1，超范围夹住）。
   *
   * 只影响**之后**播放的声音：已经响着的那一声不会跟着变（它与原版一样是"合成一次、播完即弃"）。
   */
  setGroupVolume(group: SoundGroup, value: number): void {
    this.groupVolume[group] = Math.max(0, Math.min(1, value));
  }

  /** 某一组现在的音量（设置界面回显与测试用） */
  groupVolumeOf(group: SoundGroup): number {
    return this.groupVolume[group];
  }

  /**
   * 设置听者的位置与朝向。
   *
   * 朝向是可选的：老代码/测试只传坐标时，声像按"yaw = 0"算（正前方是 -Z），
   * 至少不会因为少传一个参数就静音。
   */
  setListener(x: number, y: number, z: number, yaw = this.listenerYaw): void {
    this.listenerX = x;
    this.listenerY = y;
    this.listenerZ = z;
    this.listenerYaw = yaw;
  }

  /** 播放一个音效；给坐标时会按距离衰减并做声像。`gainScale` 用于"疾跑更响"这类微调 */
  play(kind: SoundKind, at?: { x: number; y: number; z: number }, gainScale = 1): void {
    const spec = SOUNDS[kind];
    if (!spec) return;
    this.playSpec(kind, spec, at, gainScale, SOUND_GROUPS[kind], 1, SAME_SOUND_THROTTLE);
  }

  /**
   * 播放一条生物声音（环境叫 / 受伤 / 死亡）。
   *
   * 与 `play()` 分开的原因：生物声音不是"一种音效一条 spec"，而是
   * **每种生物三条**（见 `MobVoices.ts`）。把它们全塞进 `SOUNDS` 会让表长出 80 多条，
   * 而且"加一种生物就要改三个地方"。这里统一归 `mobs` 音量组。
   *
   * @param pitch 音高倍率：幼体更高、洞穴蜘蛛更高（由 `mobVoicePitchFor` 算）
   */
  playVoice(kind: string, spec: SoundSpec, at: { x: number; y: number; z: number }, pitch = 1): void {
    // 环境叫的节流比"受伤"宽：它只是"在场感"，一群牛不该变成合唱
    const throttle = kind.endsWith(':ambient') ? 0.32 : SAME_SOUND_THROTTLE;
    this.playSpec(kind, spec, at, 1, 'mobs', pitch, throttle);
  }

  /**
   * 设置环境音强度（批次 233：雨声）。
   *
   * `level` 0~1：0 = 停（平滑淡出），1 = 大雨。主程序每帧按天气调一次，
   * 所以这里不做"状态记忆"，只负责把音量推向目标（`setTargetAtTime`，
   * 时间常数 0.5 秒——雨停不会"啪"一声断掉）。
   *
   * 只有真的需要出声时才建节点：晴天一个常驻节点都不会多。
   */
  setAmbience(level: number): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || !this.master) return;
    const target = Math.max(0, Math.min(1, level));
    if (target <= 0.001 && !this.ambienceGain) return;

    const ctx = this.ctx;
    if (!this.ambienceGain) {
      const out = ctx.createGain();
      out.gain.value = 0;
      const source = ctx.createBufferSource();
      source.buffer = this.getNoiseBuffer(ctx);
      source.loop = true;

      // 两层：高频"沙沙"（雨点打在地上）+ 低频"呼呼"（雨幕的体量）
      const hiss = ctx.createBiquadFilter();
      hiss.type = 'bandpass';
      hiss.frequency.value = 2200;
      hiss.Q.value = 0.45;
      const hissLevel = ctx.createGain();
      hissLevel.gain.value = 0.85;
      source.connect(hiss).connect(hissLevel).connect(out);

      const rumble = ctx.createBiquadFilter();
      rumble.type = 'lowpass';
      rumble.frequency.value = 420;
      rumble.Q.value = 0.6;
      const rumbleLevel = ctx.createGain();
      rumbleLevel.gain.value = 0.5;
      source.connect(rumble).connect(rumbleLevel).connect(out);

      // 缓慢起伏（0.13Hz ≈ 8 秒一轮）：雨不该是一条死平的白噪声
      const gust = ctx.createOscillator();
      gust.type = 'sine';
      gust.frequency.value = 0.13;
      const gustDepth = ctx.createGain();
      gustDepth.gain.value = 0.045;
      gust.connect(gustDepth).connect(out.gain);
      gust.start();

      source.start(0, Math.random() * 0.8);
      out.connect(this.master);
      this.ambienceGain = out;
    }

    // 0.22 是"大雨"的上限：雨是背景，不该盖过脚步与生物叫
    const volume = 0.22 * target * this.volume * this.groupVolume.ambient;
    this.ambienceGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.5);
  }

  /**
   * 播一个音乐音符（批次 233，背景音乐）。
   *
   * 为什么不用 `play()`：音乐要的是"**可以预约**的音符 + 更湿的混响 + 自己的并发上限"。
   * 主程序每次给一小段（`MusicDirector` 决定音高/时值/力度），这里只负责发声；
   * 音符按 `delay` 预约到未来，所以节拍不受帧率影响。
   *
   * 音色是"软钢琴/钟"：三角波基频 + 两个正弦谐波，起音很短；
   * 长音（低音铺底）把起音拉到 0.5 秒，听起来像 pad 而不是"敲了一下"。
   */
  playMusicNote(
    hz: number,
    options: { duration?: number; velocity?: number; delay?: number; wave?: OscillatorType } = {},
  ): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const duration = Math.max(0.2, Math.min(12, options.duration ?? 2));
    const delay = Math.max(0, Math.min(12, options.delay ?? 0));
    const velocity = Math.max(0, Math.min(1, options.velocity ?? 1));
    const start = now + delay;
    const end = start + duration;

    // 并发上限只数音乐（24 声够一段和弦 + 余音，又不会在极端情况下堆节点）
    this.musicEnds = this.musicEnds.filter((timestamp) => timestamp > now);
    if (this.musicEnds.length >= 24) return;
    this.musicEnds.push(end);

    const freq = Math.max(20, Math.min(4000, hz));
    // 音乐整体比音效轻（0.16），主音量/音乐滑杆再乘上去
    const gain = 0.16 * velocity * this.volume * this.groupVolume.music;
    if (gain <= 0.0005) return;

    const out = ctx.createGain();
    const attack = duration > 4 ? 0.5 : 0.015;
    out.gain.setValueAtTime(0.0001, start);
    out.gain.linearRampToValueAtTime(gain, start + attack);
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    out.connect(this.master);
    // 音乐比音效湿一档（22% vs 10%）：音符要有"空间"，否则像玩具琴
    if (this.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = 2.2;
      out.connect(send).connect(this.reverbSend);
    }

    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, options.wave ?? 'triangle'],
      [2, 0.22, 'sine'],
      [3, 0.06, 'sine'],
    ];
    for (const [ratio, level, wave] of partials) {
      if (freq * ratio > 16000) continue;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq * ratio, start);
      const voice = ctx.createGain();
      voice.gain.value = level;
      osc.connect(voice).connect(out);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }

  private playSpec(
    key: string,
    spec: SoundSpec,
    at: { x: number; y: number; z: number } | undefined,
    gainScale: number,
    group: SoundGroup,
    rateScale: number,
    throttle: number,
  ): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const master = this.master;
    const wet = this.reverbSend;
    if (!master) return;

    const now = ctx.currentTime;

    // ---- 节流：同一条声音在极短时间内不重复播
    const last = this.lastStartAt.get(key);
    if (last !== undefined && now - last < throttle) return;

    // ---- 距离：先判"听不见"，**再**占并发名额（旧版顺序反了，远处被丢弃的请求会白占一个）
    let distance = 0;
    if (at) {
      distance = Math.hypot(at.x - this.listenerX, at.y - this.listenerY, at.z - this.listenerZ);
      if (distance > HEARING_RANGE) return;
    }

    // ---- 并发上限：关键的几种允许突破（见 `CRITICAL_KINDS`）
    if (this.voiceEnds.length > 0) {
      this.voiceEnds = this.voiceEnds.filter((end) => end > now);
      const cap = MAX_CONCURRENT_VOICES + (CRITICAL_KINDS.has(key) ? CRITICAL_BYPASS : 0);
      if (this.voiceEnds.length >= cap) return;
    }

    const layers = pickLayers(spec);
    const duration = layersDuration(layers);

    let gain = spec.gain * this.volume * this.groupVolume[group] * gainScale;
    if (at) {
      // 距离衰减：近处几乎不衰减，远处快速变小（与原版的听觉范围接近）
      gain *= Math.max(0.08, 1 - distance / HEARING_RANGE) ** 1.6;
    }
    // 水下：全局压低音量（低通在下面的出口处接）
    if (this.underwater) gain = underwaterGain(gain);
    if (gain <= 0.001) return;

    this.lastStartAt.set(key, now);
    this.voiceEnds.push(now + duration);

    // ---- 音高抖动：变体之外的第二层随机（同一条声音每次也不完全一样）
    const jitter = spec.pitchJitter ?? 0;
    const rate = rateScale * (jitter > 0 ? 2 ** (((Math.random() * 2 - 1) * jitter) / 1200) : 1);

    const out = ctx.createGain();
    out.gain.value = gain;

    // ---- 距离低通（与水下的闷响合并成一个滤波器）
    let tail: AudioNode = out;
    const cutoff = this.cutoffFor(distance);
    if (cutoff < 16000) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cutoff;
      lowpass.Q.value = 0.7;
      out.connect(lowpass);
      tail = lowpass;
    }

    // ---- 声像：把"源相对听者的左右投影"映射到 -1..1
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = at ? this.panFor(at, distance) : 0;
      tail.connect(panner);
      panner.connect(master);
      if (wet) panner.connect(wet);
    } else {
      // 极老的浏览器没有 StereoPanner：退化成"没有左右"，不影响出声
      tail.connect(master);
      if (wet) tail.connect(wet);
    }

    for (const layer of layers) this.scheduleLayer(ctx, layer, now, rate, out);
    this.played++;
  }

  /** 距离越远，高频越少（32 格外全部听不见，截止频率从 18k 收到 2.4k） */
  private cutoffFor(distance: number): number {
    const t = Math.min(1, Math.max(0, distance / HEARING_RANGE));
    const hz = 18000 * Math.pow(2400 / 18000, t);
    return this.underwater ? Math.min(hz, UNDERWATER_LOWPASS_HZ) : hz;
  }

  /**
   * 声像：源在听者右侧为正、左侧为负。
   *
   * `yaw = 0` 时玩家朝 -Z，右向量是 (cos yaw, 0, -sin yaw) = (1, 0, 0)。
   * 除以水平距离（而不是三维距离）是为了"正上方/正下方的声音"不因为竖直距离被压成中间。
   */
  private panFor(at: { x: number; y: number; z: number }, distance: number): number {
    if (distance < 0.001) return 0;
    const dx = at.x - this.listenerX;
    const dz = at.z - this.listenerZ;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 0.001) return 0;
    const rightX = Math.cos(this.listenerYaw);
    const rightZ = -Math.sin(this.listenerYaw);
    const side = (dx * rightX + dz * rightZ) / horizontal;
    return Math.max(-1, Math.min(1, side)) * 0.7;
  }

  /** 把一层排进时间线（所有时间都相对"这一声的起点"） */
  private scheduleLayer(ctx: AudioContext, layer: SoundLayer, now: number, rate: number, out: AudioNode): void {
    const start = now + Math.max(0, layer.at);
    const end = start + Math.max(0.01, layer.dur);

    // ---- 这一层的幅度包络（折线；起点先归零，避免爆音）
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, start);
    for (const [ratio, level] of layer.env) {
      const t = start + Math.min(1, Math.max(0, ratio)) * layer.dur;
      const value = Math.max(0, level) * layer.gain;
      if (t <= start) amp.gain.setValueAtTime(value, start);
      else amp.gain.linearRampToValueAtTime(value, t);
    }
    amp.connect(out);

    // 幅度抖动：正弦 LFO 叠在包络上（对音调层与噪声层一视同仁）
    if (layer.tremolo && layer.tremolo.depth > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = Math.max(0.1, layer.tremolo.hz);
      const depth = ctx.createGain();
      depth.gain.value = layer.gain * Math.min(1, layer.tremolo.depth) * 0.5;
      lfo.connect(depth).connect(amp.gain);
      lfo.start(start);
      lfo.stop(end + 0.02);
    }

    if (layer.t === 'tone') {
      const hz = Math.max(20, layer.hz * rate);
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(hz, start);
      for (const [ratio, mult] of layer.pitch ?? []) {
        osc.frequency.linearRampToValueAtTime(Math.max(20, hz * mult), start + Math.min(1, ratio) * layer.dur);
      }

      // 颤音：一个正弦 LFO 直接加到频率上（单位是 Hz，按音分折算）
      if (layer.vibrato && layer.vibrato.cents > 0) {
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = Math.max(0.1, layer.vibrato.hz);
        const depth = ctx.createGain();
        depth.gain.value = hz * (2 ** (layer.vibrato.cents / 1200) - 1);
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(start);
        lfo.stop(end + 0.02);
      }

      if (layer.formants && layer.formants.length > 0) {
        // 并联共振峰 = 元音。再留一点点干声当"身体"，否则只剩几个峰、像口哨
        for (const formant of layer.formants) {
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = Math.min(12000, Math.max(60, formant.hz * rate));
          band.Q.value = Math.max(0.3, formant.q);
          const level = ctx.createGain();
          level.gain.value = Math.max(0, formant.gain);
          osc.connect(band).connect(level).connect(amp);
        }
        // 0.09 而不是 0.14（批次 236）：两段元音叠在一起时，干声叠两遍会让嗓音发"嗡"
        const dry = ctx.createGain();
        dry.gain.value = 0.09;
        osc.connect(dry).connect(amp);
      } else {
        osc.connect(amp);
      }

      osc.start(start);
      osc.stop(end + 0.02);
      return;
    }

    // ---- 噪声层
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter;
    filter.Q.value = Math.max(0.05, layer.q);
    const hz = Math.max(20, layer.hz * rate);
    filter.frequency.setValueAtTime(hz, start);
    for (const [ratio, mult] of layer.sweep ?? []) {
      filter.frequency.linearRampToValueAtTime(Math.max(20, hz * mult), start + Math.min(1, ratio) * layer.dur);
    }
    source.connect(filter).connect(amp);

    // 从噪声缓冲的随机位置起播：同一段噪声听起来也不一样
    source.start(start, Math.random() * 0.8);
    source.stop(end + 0.02);
  }

  /**
   * 按**频率**播放一声（批次 173，音符盒）。
   *
   * 为什么不并进 `play(kind)`：`SOUNDS` 那张表是"**每种声音一条固定参数**"
   * （频率从 A 滑到 B），而音符盒要的是"25 个音高共用同一个音色、只有基频不同"。
   * 给它 25 条 spec 显然是错的（而且新加音高还得改表）。
   *
   * 音色取三角形波（木琴的近亲）+ 一层二次谐波（`2f`，音量 0.35）——
   * 单正弦太"电子"，两个谐波才像木头敲出来的。
   * 节流与并发上限照旧：同一声 70ms 内连响两次、或同时响超过上限，
   * 玩家都听不出来（与 `play()` 同一条判断）。
   */
  playNote(frequency: number, at?: { x: number; y: number; z: number }): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const master = this.master;
    if (!master) return;
    const now = ctx.currentTime;
    if (now - this.lastNoteAt < SAME_SOUND_THROTTLE) return;
    if (this.voiceEnds.length > 0) {
      this.voiceEnds = this.voiceEnds.filter((end) => end > now);
      if (this.voiceEnds.length >= MAX_CONCURRENT_VOICES) return;
    }
    this.lastNoteAt = now;

    const hz = Math.max(20, Math.min(4000, frequency));
    const duration = 0.55;
    // 音符盒归"方块"那一组（它就是一块木头）
    let gain = 0.42 * this.volume * this.groupVolume.blocks;
    let distance = 0;
    if (at) {
      distance = Math.hypot(at.x - this.listenerX, at.y - this.listenerY, at.z - this.listenerZ);
      if (distance > HEARING_RANGE) return;
      gain *= Math.max(0.08, 1 - distance / HEARING_RANGE) ** 1.6;
    }
    if (this.underwater) gain = underwaterGain(gain);
    if (gain <= 0.001) return;

    this.voiceEnds.push(now + duration);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(gain, now + 0.004);
    out.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    let tail: AudioNode = out;
    const cutoff = this.cutoffFor(distance);
    if (cutoff < 16000) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cutoff;
      lowpass.Q.value = 0.7;
      out.connect(lowpass);
      tail = lowpass;
    }
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = at ? this.panFor(at, distance) : 0;
      tail.connect(panner);
      panner.connect(master);
      if (this.reverbSend) panner.connect(this.reverbSend);
    } else {
      tail.connect(master);
      if (this.reverbSend) tail.connect(this.reverbSend);
    }

    for (const [multiplier, level] of [
      [1, 1],
      [2, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz * multiplier, now);
      const voice = ctx.createGain();
      voice.gain.value = level;
      osc.connect(voice).connect(out);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }
    this.played++;
  }

  /** 按方块材质挑破坏音效（方块名 → 音效） */
  playBreakForBlock(blockName: string, at?: { x: number; y: number; z: number }): void {
    this.play(breakSoundFor(blockName), at);
  }

  /** 按方块材质挑脚步声 */
  playStepForBlock(blockName: string, gainScale = 1): void {
    this.play(stepSoundFor(blockName), undefined, gainScale);
  }

  /** 按方块材质挑放置音效 */
  playPlaceForBlock(blockName: string, at?: { x: number; y: number; z: number }): void {
    this.play(placeSoundFor(blockName), at);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) return this.noiseBuffer;
    // 1 秒白噪声循环使用：每次播放都新建太浪费（一秒钟 48000 个浮点数）
    const length = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }
}

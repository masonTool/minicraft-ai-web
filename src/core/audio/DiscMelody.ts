/**
 * 唱片的旋律（批次 489，B19 + G9 的唱片机）
 *
 * 原版的唱片是**预先录好的曲子**（几十秒到两分钟）。这里没有音频素材，
 * 所以用同一套"合成音效"的办法现场合成：一段旋律 = 一串 `ToneLayer`，
 * 每个音一个 layer（`at` 递增），走 `AudioEngine.playVoice` 播出去。
 *
 * 为什么单独成模块、并且是**纯数据 + 纯函数**：
 *  - 旋律是数据（音高 / 时长 / 波形），与 AudioContext 无关，可以离线断言；
 *  - 渲染层与音频层都不该知道"13 号唱片是什么调"——那是内容。
 *
 * ⚠️ 与原版的差异：原版唱片是真的音乐（有鼓、有贝斯、有和声），
 * 这里只有**一条单声部旋律 + 低音铺底**——够让"放唱片"这件事有声音，
 * 但不打算复刻那 12 首曲子（那既做不到，也不该占这个项目的预算）。
 */

import type { SoundSpec, ToneLayer } from './AudioEngine.ts';

/** 一个音：MIDI 音高 + 起始时间（秒）+ 时长（秒） */
export interface DiscNote {
  readonly midi: number;
  readonly at: number;
  readonly dur: number;
  /** 音量（0~1） */
  readonly gain?: number;
}

/** 一张唱片的定义 */
export interface DiscTrack {
  /** 文案里的曲子名（`13` / `cat` / `ward`） */
  readonly name: string;
  /** 主旋律 */
  readonly notes: readonly DiscNote[];
  /** 低音铺底（只给"有伴奏"的那两张） */
  readonly bass: readonly DiscNote[];
  /** 整首的长度（秒）：最后一个音的结束时间，至少 8 秒 */
  readonly duration: number;
}

/** MIDI 音高 → 频率（A4 = 69 = 440Hz） */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 三张唱片的旋律。
 *
 * 调性各不相同（13 号是小调、cat 是大调、ward 是五声），这样"换一张唱片"
 * 耳朵能立刻听出来——比三首都用同一个调号更容易分辨。
 */
const TRACKS: Readonly<Record<string, DiscTrack>> = {
  // 13：a 小调，慢，阴沉（原版 13 也是最"不安"的那首）
  '13': {
    name: '13',
    notes: [
      { midi: 57, at: 0.0, dur: 0.9 },
      { midi: 60, at: 0.8, dur: 0.9 },
      { midi: 64, at: 1.6, dur: 0.9 },
      { midi: 62, at: 2.4, dur: 0.9 },
      { midi: 60, at: 3.2, dur: 1.2 },
      { midi: 57, at: 4.4, dur: 0.9 },
      { midi: 55, at: 5.2, dur: 0.9 },
      { midi: 57, at: 6.0, dur: 1.6 },
      { midi: 64, at: 7.6, dur: 0.9 },
      { midi: 62, at: 8.4, dur: 0.9 },
      { midi: 60, at: 9.2, dur: 0.9 },
      { midi: 57, at: 10.0, dur: 2.0 },
    ],
    bass: [
      { midi: 45, at: 0.0, dur: 3.2, gain: 0.35 },
      { midi: 43, at: 3.2, dur: 3.2, gain: 0.35 },
      { midi: 45, at: 6.4, dur: 3.2, gain: 0.35 },
      { midi: 43, at: 9.6, dur: 2.4, gain: 0.35 },
    ],
    duration: 12,
  },
  // cat：C 大调，明快，跳进跳出的音型（原版 cat 也是最"轻快"的那首）
  cat: {
    name: 'cat',
    notes: [
      { midi: 60, at: 0.0, dur: 0.35 },
      { midi: 64, at: 0.4, dur: 0.35 },
      { midi: 67, at: 0.8, dur: 0.35 },
      { midi: 72, at: 1.2, dur: 0.35 },
      { midi: 67, at: 1.6, dur: 0.35 },
      { midi: 64, at: 2.0, dur: 0.35 },
      { midi: 65, at: 2.4, dur: 0.35 },
      { midi: 69, at: 2.8, dur: 0.35 },
      { midi: 72, at: 3.2, dur: 0.7 },
      { midi: 62, at: 4.0, dur: 0.35 },
      { midi: 65, at: 4.4, dur: 0.35 },
      { midi: 69, at: 4.8, dur: 0.35 },
      { midi: 74, at: 5.2, dur: 0.7 },
      { midi: 72, at: 6.0, dur: 0.35 },
      { midi: 69, at: 6.4, dur: 0.35 },
      { midi: 65, at: 6.8, dur: 0.35 },
      { midi: 67, at: 7.2, dur: 0.8 },
      { midi: 60, at: 8.0, dur: 0.35 },
      { midi: 64, at: 8.4, dur: 0.35 },
      { midi: 67, at: 8.8, dur: 0.7 },
      { midi: 72, at: 9.6, dur: 1.2 },
    ],
    bass: [
      { midi: 48, at: 0.0, dur: 1.6, gain: 0.3 },
      { midi: 53, at: 1.6, dur: 1.6, gain: 0.3 },
      { midi: 55, at: 3.2, dur: 1.6, gain: 0.3 },
      { midi: 48, at: 4.8, dur: 1.6, gain: 0.3 },
      { midi: 50, at: 6.4, dur: 1.6, gain: 0.3 },
      { midi: 48, at: 8.0, dur: 2.8, gain: 0.3 },
    ],
    duration: 10.8,
  },
  // ward：d 五声，太空感（原版 ward 是碎拍；这里用长音 + 五度跳）
  ward: {
    name: 'ward',
    notes: [
      { midi: 62, at: 0.0, dur: 1.6 },
      { midi: 69, at: 1.2, dur: 1.6 },
      { midi: 67, at: 2.4, dur: 1.6 },
      { midi: 62, at: 3.6, dur: 1.6 },
      { midi: 65, at: 4.8, dur: 1.6 },
      { midi: 72, at: 6.0, dur: 2.4 },
      { midi: 69, at: 8.4, dur: 1.2 },
      { midi: 65, at: 9.6, dur: 1.2 },
      { midi: 62, at: 10.8, dur: 2.8 },
    ],
    bass: [
      { midi: 50, at: 0.0, dur: 4.8, gain: 0.32 },
      { midi: 48, at: 4.8, dur: 4.8, gain: 0.32 },
      { midi: 50, at: 9.6, dur: 4.0, gain: 0.32 },
    ],
    duration: 13.6,
  },
};

/** 已知的曲名（测试与 UI 都用它，避免各处手抄字符串） */
export const DISC_TRACK_NAMES: readonly string[] = Object.keys(TRACKS);

/** 按曲名取一张唱片（null = 不认识） */
export function discTrack(name: string): DiscTrack | null {
  return Object.prototype.hasOwnProperty.call(TRACKS, name) ? (TRACKS[name] ?? null) : null;
}

/** 一个音 → 一层振荡器（正弦 + 快起慢落的包络，听起来像拨弦/木琴） */
function noteLayer(note: DiscNote, wave: OscillatorType, gainScale: number): ToneLayer {
  return {
    t: 'tone',
    at: note.at,
    dur: note.dur,
    gain: (note.gain ?? 1) * gainScale,
    // 起音 12ms（避免爆音）、保持到 55%、尾巴 45% 收干净
    env: [
      [0, 0],
      [0.06, 1],
      [0.55, 0.72],
      [1, 0],
    ],
    wave,
    hz: midiToHz(note.midi),
  };
}

/**
 * 把一张唱片变成可以直接交给 `AudioEngine.playVoice` 的 spec。
 *
 * 旋律用三角波（更接近原版唱片的"木质"音色）、低音用正弦（不抢主旋律）。
 *
 * @returns null = 不是已知曲名
 */
export function discSoundSpec(name: string): SoundSpec | null {
  const track = discTrack(name);
  if (!track) return null;
  const layers: ToneLayer[] = [
    ...track.notes.map((note) => noteLayer(note, 'triangle', 0.55)),
    ...track.bass.map((note) => noteLayer(note, 'sine', 0.5)),
  ];
  // 长音不能被 1 秒的"同类节流"截掉：`playVoice` 的节流按 kind 记，
  // 所以曲名进 kind（`disc:13`），不同唱片的节流互不影响
  return { layers, gain: 0.7, pitchJitter: 0 };
}

/** 一张唱片的总时长（秒）：给"多久之后自动停下"用 */
export function discDuration(name: string): number {
  return discTrack(name)?.duration ?? 0;
}

/** 唱片的音乐种类键（`AudioEngine` 的节流与音量组按它分） */
export function discSoundKind(name: string): string {
  return `disc:${name}`;
}

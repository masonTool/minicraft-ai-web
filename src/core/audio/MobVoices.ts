/**
 * 生物声音档案（批次 232）
 *
 * 为什么单独一份而不是继续往 `AudioEngine.SOUNDS` 里加：一种生物要有**三条**
 * （环境叫 / 受伤 / 死亡），29 种生物就是 87 条。塞进那张表会把方块音淹没，
 * 而且"加一种生物"要改三处。这里按**声音档案**组织：
 *
 *   种类 id → 档案（`undead` / `cow` / `skeleton` …）→ 三条 `SoundSpec`
 *
 * 同族共用一套（僵尸/尸壳都是 `undead`，蜘蛛/洞穴蜘蛛都是 `spider`），
 * 个体差异用**音高倍率**表达（幼体 +28%、洞穴蜘蛛 ×1.35）——这与原版"同族不同调"同源，
 * 但配方是我们自己的，不会和原版音源重合。
 *
 * 三条硬约定：
 *  1. **每条档案都必须三条齐全**（`MOB_VOICES` 的类型就是死的），测试会逐种检查；
 *  2. 没写进表的新生物走**家族兜底**（亡灵低吼 / 节肢咔哒 / 其它鼻音），永远不静默；
 *  3. 配方全部是"层"的组合（见 `AudioEngine.ts`），这里只描述**听感**，不碰节点。
 */

import type { Formant, NoiseLayer, SoundLayer, SoundSpec, ToneLayer } from './AudioEngine.ts';

export type MobVoiceEvent = 'ambient' | 'hurt' | 'death';

/** 一套生物声音：环境叫 / 受伤 / 死亡 */
export interface MobVoice {
  ambient: SoundSpec;
  hurt: SoundSpec;
  death: SoundSpec;
}

export type MobVoiceId =
  | 'undead'
  | 'drowned'
  | 'piglin'
  | 'skeleton'
  | 'wither_skeleton'
  | 'creeper'
  | 'spider'
  | 'enderman'
  | 'blaze'
  | 'ghast'
  | 'slime'
  | 'magma_cube'
  | 'cow'
  | 'pig'
  | 'sheep'
  | 'chicken'
  | 'villager'
  | 'squid'
  // 驯养系（批次 242）：狼的低吼、猫的喵、狐狸的短促狐鸣（豹猫复用 cat）
  | 'wolf'
  | 'cat'
  | 'fox'
  | 'phantom'
  | 'wither'
  | 'dragon'
  | 'passive';

// ---------------------------------------------------------------- 造层小工具
// 与 `AudioEngine.ts` 里同名工具一致；这里只依赖类型，不引运行时值（避免循环依赖）。

type Point = readonly [number, number];

function curve(...points: [number, number][]): Point[] {
  return points;
}

function tone(o: Omit<ToneLayer, 't'>): ToneLayer {
  return { t: 'tone', ...o };
}

function noise(o: Omit<NoiseLayer, 't'>): NoiseLayer {
  return { t: 'noise', ...o };
}

/** 两个共振峰 → 一个元音（再加高一点的第三峰当"齿音/临场感"） */
function vowel(pair?: readonly [number, number]): Formant[] | undefined {
  if (!pair) return undefined;
  const [f1, f2] = pair;
  return [
    { hz: f1, q: 7, gain: 1 },
    { hz: f2, q: 9, gain: 0.55 },
    { hz: f1 * 3.1, q: 11, gain: 0.16 },
  ];
}

interface CallOptions {
  hz: number;
  hzEnd: number;
  dur: number;
  /** 整条声音的音量（0~1） */
  gain?: number;
  /** 波形：生物声带用锯齿波，鸟/骨头用方波更像 */
  wave?: OscillatorType;
  /** 元音：两个共振峰中心频率（牛 [300,800]、羊 [700,1700]…） */
  formants?: readonly [number, number];
  vibrato?: { hz: number; cents: number };
  /** 呼气噪声占比（0 = 完全没有） */
  breath?: number;
  /** 幅度抖动（羊叫"咩～"的颤） */
  tremolo?: { hz: number; depth: number };
  /** 分成几个音节（猪"哼-哼" = 2、鸡"咯咯咯" = 3） */
  syllables?: number;
  /** 音高抖动（音分） */
  jitter?: number;
}

/**
 * 一声"嗓子"：振荡器（带音高走向 + 共振峰 + 颤音）+ 一层呼气噪声。
 *
 * 这是生物叫声的**唯一**主力函数。以前引擎里只有"锯齿波从 A 滑到 B"，
 * 没有共振峰就永远像蜂鸣器；加上两个共振峰之后，"哞/咩/嗯"才有口腔形状。
 */
function call(o: CallOptions): SoundSpec {
  const total = Math.max(1, Math.round(o.syllables ?? 1));
  const segment = o.dur / total;
  const layers: SoundLayer[] = [];
  const formants = vowel(o.formants);
  const pitchEnd = Math.max(0.2, o.hzEnd / o.hz);
  const breath = o.breath ?? 0.12;

  for (let i = 0; i < total; i++) {
    const at = i * segment * 0.82;
    layers.push(
      tone({
        at,
        dur: segment,
        gain: 0.9,
        // 起音 → 保持 → 收尾：这是"像呼吸"与"像电子音"的分水岭
        env: curve([0, 0], [0.12, 1], [0.55, 0.85], [1, 0]),
        wave: o.wave ?? 'sawtooth',
        // 后面几个音节略高一点（"咯-咯-咯"的语调是往上走的）
        hz: o.hz * (1 + i * 0.035),
        pitch: curve([0.35, 1.06], [1, pitchEnd]),
        formants,
        vibrato: o.vibrato,
        tremolo: o.tremolo,
      }),
    );
    if (breath > 0) {
      layers.push(
        noise({
          at,
          dur: segment * 0.8,
          gain: breath,
          env: curve([0, 0], [0.15, 1], [1, 0]),
          filter: 'bandpass',
          hz: Math.min(6000, o.hz * 3.4),
          q: 0.8,
        }),
      );
    }
  }
  return { gain: o.gain ?? 0.32, layers, pitchJitter: o.jitter ?? 12 };
}

interface RattleOptions {
  clicks: number;
  hz: number;
  dur?: number;
  gain?: number;
}

/** 骨节/节肢的"咔哒"：N 个错开的极短噪声（不是一声长嘶） */
function rattle(o: RattleOptions): SoundSpec {
  const dur = o.dur ?? 0.3;
  const spacing = dur / o.clicks;
  const layers: SoundLayer[] = [];
  for (let i = 0; i < o.clicks; i++) {
    layers.push(
      noise({
        at: i * spacing,
        dur: Math.min(0.05, spacing * 1.2),
        gain: Math.max(0.35, 0.9 - (i / Math.max(1, o.clicks)) * 0.45),
        env: curve([0, 0], [0.15, 1], [1, 0]),
        filter: 'bandpass',
        hz: o.hz * (1 + (i % 3) * 0.08),
        q: 7,
      }),
    );
  }
  return { gain: o.gain ?? 0.3, layers, pitchJitter: 30 };
}

interface HissOptions {
  hz: number;
  hzEnd: number;
  dur: number;
  gain?: number;
  q?: number;
  tremolo?: { hz: number; depth: number };
  /** 底下垫一个低频音（"嘶"里带一点体量） */
  low?: number;
}

/** 苦力怕的"嘶——"、蜘蛛的尖嘶：噪声 + 可扫的带通/高通 */
function hiss(o: HissOptions): SoundSpec {
  const layers: SoundLayer[] = [
    noise({
      at: 0,
      dur: o.dur,
      gain: 0.9,
      env: curve([0, 0], [0.12, 1], [0.7, 0.8], [1, 0]),
      filter: 'highpass',
      hz: o.hz,
      q: o.q ?? 0.8,
      sweep: curve([1, Math.max(0.2, o.hzEnd / o.hz)]),
      tremolo: o.tremolo,
    }),
  ];
  if (o.low) {
    layers.push(
      tone({
        at: 0,
        dur: o.dur,
        gain: 0.22,
        env: curve([0, 0], [0.2, 1], [1, 0]),
        wave: 'sine',
        hz: o.low,
      }),
    );
  }
  return { gain: o.gain ?? 0.28, layers, pitchJitter: 20 };
}

interface SquelchOptions {
  hz: number;
  hzEnd: number;
  dur: number;
  gain?: number;
  /** 岩浆怪：底下垫一层低频"噼啪" */
  crackle?: boolean;
}

/** 史莱姆/鱿鱼的"啵叽"：音高上滑 + 湿润的带通噪声 */
function squelch(o: SquelchOptions): SoundSpec {
  const layers: SoundLayer[] = [
    tone({
      at: 0,
      dur: o.dur,
      gain: 0.8,
      env: curve([0, 0], [0.1, 1], [0.6, 0.7], [1, 0]),
      wave: 'sine',
      hz: o.hz,
      pitch: curve([0.5, 1.3], [1, Math.max(0.3, o.hzEnd / o.hz)]),
    }),
    noise({
      at: 0,
      dur: o.dur * 0.8,
      gain: 0.5,
      env: curve([0, 0], [0.15, 1], [1, 0]),
      filter: 'bandpass',
      hz: Math.min(6000, o.hz * 6),
      q: 1.4,
      tremolo: { hz: 18, depth: 0.6 },
    }),
  ];
  if (o.crackle) {
    layers.push(
      noise({
        at: 0,
        dur: o.dur,
        gain: 0.22,
        env: curve([0, 0], [0.2, 1], [1, 0]),
        filter: 'lowpass',
        hz: 240,
        q: 0.6,
        tremolo: { hz: 9, depth: 0.8 },
      }),
    );
  }
  return { gain: o.gain ?? 0.28, layers, pitchJitter: 25 };
}

/** 低频咆哮（凋灵/末影龙/僵尸家族）：元音更靠后、呼气更多、颤音更慢 */
function growl(o: CallOptions): SoundSpec {
  return call({
    ...o,
    wave: 'sawtooth',
    formants: o.formants ?? [320, 760],
    breath: o.breath ?? 0.3,
    vibrato: o.vibrato ?? { hz: 3.4, cents: 30 },
  });
}

/**
 * 生物声音档案表。
 *
 * 配方是"听感描述"，不是原版采样：例如牛是"u 元音 + 先升后降 + 一点呼气"，
 * 羊是"高一点 + 11Hz 颤音"，骷髅是"一串骨节咔哒"。一耳朵能分清就够。
 */
export const MOB_VOICES: Readonly<Record<MobVoiceId, MobVoice>> = {
  // ---- 亡灵家族
  undead: {
    ambient: growl({ hz: 92, hzEnd: 68, dur: 0.9, gain: 0.32, formants: [480, 980], breath: 0.32 }),
    hurt: call({ hz: 128, hzEnd: 96, dur: 0.28, gain: 0.3, formants: [600, 1150], breath: 0.25, vibrato: { hz: 6, cents: 25 } }),
    death: growl({ hz: 88, hzEnd: 46, dur: 1.15, gain: 0.34, formants: [460, 900], breath: 0.35 }),
  },
  drowned: {
    ambient: growl({ hz: 82, hzEnd: 62, dur: 0.85, gain: 0.3, formants: [430, 880], breath: 0.5, tremolo: { hz: 6, depth: 0.5 } }),
    hurt: call({ hz: 118, hzEnd: 88, dur: 0.3, gain: 0.28, formants: [520, 1000], breath: 0.45 }),
    death: growl({ hz: 78, hzEnd: 42, dur: 1.2, gain: 0.32, formants: [420, 820], breath: 0.55 }),
  },
  piglin: {
    ambient: growl({ hz: 150, hzEnd: 108, dur: 0.7, gain: 0.3, formants: [400, 900], breath: 0.35, vibrato: { hz: 5, cents: 35 } }),
    hurt: call({ hz: 176, hzEnd: 132, dur: 0.26, gain: 0.28, formants: [520, 1050], breath: 0.3 }),
    death: growl({ hz: 138, hzEnd: 70, dur: 1.0, gain: 0.32, formants: [380, 820], breath: 0.4 }),
  },
  skeleton: {
    ambient: rattle({ clicks: 5, hz: 2400, dur: 0.36, gain: 0.26 }),
    hurt: rattle({ clicks: 2, hz: 1900, dur: 0.15, gain: 0.24 }),
    death: rattle({ clicks: 8, hz: 2600, dur: 0.7, gain: 0.3 }),
  },
  wither_skeleton: {
    ambient: rattle({ clicks: 4, hz: 1300, dur: 0.4, gain: 0.28 }),
    hurt: rattle({ clicks: 2, hz: 1150, dur: 0.16, gain: 0.26 }),
    death: rattle({ clicks: 7, hz: 1500, dur: 0.8, gain: 0.3 }),
  },
  // ---- 主世界敌对
  creeper: {
    ambient: hiss({ hz: 900, hzEnd: 1400, dur: 0.45, gain: 0.18, tremolo: { hz: 5, depth: 0.3 } }),
    hurt: hiss({ hz: 1200, hzEnd: 1900, dur: 0.22, gain: 0.24 }),
    death: hiss({ hz: 800, hzEnd: 2200, dur: 0.95, gain: 0.3, low: 90 }),
  },
  spider: {
    ambient: rattle({ clicks: 6, hz: 3200, dur: 0.3, gain: 0.22 }),
    hurt: hiss({ hz: 2400, hzEnd: 3200, dur: 0.2, gain: 0.24, q: 1.4 }),
    death: rattle({ clicks: 10, hz: 3000, dur: 0.55, gain: 0.26 }),
  },
  enderman: {
    ambient: call({ hz: 320, hzEnd: 92, dur: 0.85, gain: 0.3, formants: [500, 1400], breath: 0.3, vibrato: { hz: 12, cents: 60 } }),
    hurt: call({ hz: 260, hzEnd: 140, dur: 0.24, gain: 0.28, formants: [520, 1350], breath: 0.25 }),
    // 死的时候往下滑到底（"被抽走"的感觉）
    death: call({ hz: 300, hzEnd: 55, dur: 1.0, gain: 0.32, formants: [480, 1200], breath: 0.3, vibrato: { hz: 9, cents: 50 } }),
  },
  blaze: {
    // 烈焰人：火焰呼气 + 两个随机爆点（多层错开就是"噼啪"）
    ambient: hiss({ hz: 700, hzEnd: 1200, dur: 0.55, gain: 0.24, tremolo: { hz: 6, depth: 0.45 }, low: 120 }),
    hurt: hiss({ hz: 1500, hzEnd: 800, dur: 0.28, gain: 0.26, q: 1.2 }),
    death: hiss({ hz: 1200, hzEnd: 350, dur: 0.9, gain: 0.3, low: 90 }),
  },
  ghast: {
    ambient: call({ hz: 620, hzEnd: 430, dur: 1.15, gain: 0.3, formants: [700, 1500], breath: 0.35, vibrato: { hz: 5, cents: 40 } }),
    hurt: call({ hz: 700, hzEnd: 500, dur: 0.35, gain: 0.28, formants: [750, 1600], breath: 0.3, vibrato: { hz: 6, cents: 45 } }),
    death: call({ hz: 600, hzEnd: 300, dur: 1.6, gain: 0.32, formants: [680, 1450], breath: 0.4, vibrato: { hz: 4, cents: 35 } }),
  },
  slime: {
    ambient: squelch({ hz: 150, hzEnd: 330, dur: 0.34, gain: 0.26 }),
    hurt: squelch({ hz: 200, hzEnd: 390, dur: 0.18, gain: 0.24 }),
    death: squelch({ hz: 140, hzEnd: 270, dur: 0.5, gain: 0.28 }),
  },
  magma_cube: {
    ambient: squelch({ hz: 120, hzEnd: 260, dur: 0.36, gain: 0.28, crackle: true }),
    hurt: squelch({ hz: 160, hzEnd: 320, dur: 0.2, gain: 0.26, crackle: true }),
    death: squelch({ hz: 110, hzEnd: 220, dur: 0.55, gain: 0.3, crackle: true }),
  },
  // ---- 被动生物
  cow: {
    ambient: call({ hz: 150, hzEnd: 112, dur: 1.0, gain: 0.3, formants: [300, 800], breath: 0.18, vibrato: { hz: 3, cents: 20 } }),
    hurt: call({ hz: 172, hzEnd: 122, dur: 0.34, gain: 0.28, formants: [330, 820], breath: 0.2 }),
    death: call({ hz: 148, hzEnd: 80, dur: 1.2, gain: 0.32, formants: [300, 780], breath: 0.25 }),
  },
  pig: {
    ambient: call({ hz: 215, hzEnd: 178, dur: 0.32, gain: 0.26, formants: [420, 950], breath: 0.2, syllables: 2 }),
    hurt: call({ hz: 242, hzEnd: 192, dur: 0.2, gain: 0.24, formants: [440, 980], breath: 0.18 }),
    death: call({ hz: 208, hzEnd: 128, dur: 0.8, gain: 0.28, formants: [400, 900], breath: 0.22 }),
  },
  sheep: {
    ambient: call({
      hz: 420,
      hzEnd: 340,
      dur: 0.8,
      gain: 0.28,
      formants: [700, 1700],
      breath: 0.15,
      vibrato: { hz: 6, cents: 25 },
      tremolo: { hz: 11, depth: 0.55 },
    }),
    hurt: call({ hz: 468, hzEnd: 362, dur: 0.3, gain: 0.26, formants: [720, 1750], breath: 0.15, tremolo: { hz: 13, depth: 0.4 } }),
    death: call({ hz: 400, hzEnd: 236, dur: 0.9, gain: 0.28, formants: [680, 1650], breath: 0.2, tremolo: { hz: 9, depth: 0.4 } }),
  },
  chicken: {
    ambient: call({ hz: 900, hzEnd: 640, dur: 0.36, gain: 0.24, wave: 'square', formants: [1200, 2400], breath: 0.3, syllables: 3 }),
    hurt: call({ hz: 1120, hzEnd: 700, dur: 0.24, gain: 0.24, wave: 'square', formants: [1300, 2500], breath: 0.25 }),
    death: call({ hz: 1000, hzEnd: 480, dur: 0.8, gain: 0.26, wave: 'square', formants: [1200, 2300], breath: 0.3, vibrato: { hz: 8, cents: 40 } }),
  },
  villager: {
    ambient: call({ hz: 300, hzEnd: 226, dur: 0.55, gain: 0.26, formants: [500, 1000], breath: 0.12, vibrato: { hz: 4, cents: 20 } }),
    hurt: call({ hz: 340, hzEnd: 250, dur: 0.28, gain: 0.26, formants: [540, 1050], breath: 0.15 }),
    death: call({ hz: 300, hzEnd: 158, dur: 0.9, gain: 0.28, formants: [500, 980], breath: 0.2 }),
  },
  // 驯养系（批次 242）：三种都比牛羊"尖"，但各有辨识点——
  // 狼是**低而长**的喉音，猫是**先升后落**的喵，狐狸是**两声短促**的狐鸣。
  wolf: {
    ambient: growl({ hz: 168, hzEnd: 124, dur: 0.8, gain: 0.28, formants: [520, 1080], breath: 0.3, vibrato: { hz: 4, cents: 22 } }),
    hurt: call({ hz: 268, hzEnd: 176, dur: 0.24, gain: 0.26, formants: [620, 1250], breath: 0.28 }),
    death: growl({ hz: 190, hzEnd: 74, dur: 0.95, gain: 0.3, formants: [480, 980], breath: 0.34 }),
  },
  cat: {
    ambient: call({ hz: 520, hzEnd: 640, dur: 0.55, gain: 0.22, formants: [820, 1900], breath: 0.12, vibrato: { hz: 5, cents: 26 } }),
    hurt: call({ hz: 760, hzEnd: 520, dur: 0.22, gain: 0.22, formants: [880, 2000], breath: 0.16 }),
    death: call({ hz: 660, hzEnd: 280, dur: 0.85, gain: 0.26, formants: [820, 1800], breath: 0.2 }),
  },
  fox: {
    ambient: call({ hz: 620, hzEnd: 460, dur: 0.32, gain: 0.22, formants: [900, 2050], breath: 0.24, syllables: 2 }),
    hurt: call({ hz: 780, hzEnd: 540, dur: 0.2, gain: 0.22, formants: [940, 2100], breath: 0.2 }),
    death: call({ hz: 700, hzEnd: 320, dur: 0.75, gain: 0.24, formants: [880, 1900], breath: 0.26 }),
  },
  squid: {
    ambient: squelch({ hz: 220, hzEnd: 118, dur: 0.4, gain: 0.22 }),
    hurt: squelch({ hz: 262, hzEnd: 148, dur: 0.2, gain: 0.22 }),
    death: squelch({ hz: 200, hzEnd: 88, dur: 0.6, gain: 0.24 }),
  },
  // ---- 特殊
  phantom: {
    ambient: call({ hz: 900, hzEnd: 600, dur: 0.6, gain: 0.26, formants: [800, 1800], breath: 0.3, vibrato: { hz: 7, cents: 45 } }),
    hurt: call({ hz: 1000, hzEnd: 700, dur: 0.26, gain: 0.26, formants: [850, 1900], breath: 0.25 }),
    death: call({ hz: 850, hzEnd: 400, dur: 1.1, gain: 0.28, formants: [800, 1700], breath: 0.3, vibrato: { hz: 6, cents: 40 } }),
  },
  wither: {
    ambient: growl({ hz: 70, hzEnd: 45, dur: 1.4, gain: 0.36, formants: [280, 620], breath: 0.5, vibrato: { hz: 2.6, cents: 40 } }),
    hurt: growl({ hz: 86, hzEnd: 52, dur: 0.5, gain: 0.32, formants: [300, 660], breath: 0.45 }),
    death: growl({ hz: 60, hzEnd: 28, dur: 2.0, gain: 0.38, formants: [260, 560], breath: 0.5, vibrato: { hz: 2, cents: 35 } }),
  },
  dragon: {
    ambient: growl({ hz: 55, hzEnd: 36, dur: 1.8, gain: 0.4, formants: [240, 560], breath: 0.55, vibrato: { hz: 2.2, cents: 45 } }),
    hurt: growl({ hz: 72, hzEnd: 42, dur: 0.6, gain: 0.36, formants: [260, 600], breath: 0.5 }),
    death: growl({ hz: 50, hzEnd: 24, dur: 2.2, gain: 0.42, formants: [220, 500], breath: 0.55, vibrato: { hz: 1.8, cents: 40 } }),
  },
  /** 家族兜底：以后新增的动物即使忘了写档案，也有"一声鼻音"而不是静默 */
  passive: {
    ambient: call({ hz: 260, hzEnd: 212, dur: 0.5, gain: 0.24, formants: [600, 1100], breath: 0.15 }),
    hurt: call({ hz: 300, hzEnd: 232, dur: 0.25, gain: 0.24, formants: [620, 1150], breath: 0.18 }),
    death: call({ hz: 250, hzEnd: 150, dur: 0.8, gain: 0.26, formants: [580, 1080], breath: 0.2 }),
  },
};

/**
 * 种类 id → 档案。
 *
 * 为什么不是写在 `MobType` 上：那是 29 处分散的数据表，而"哪种生物叫什么声"
 * 是音频模块的知识；写在这里，加生物时最坏也只是落到家族兜底（不会静默）。
 */
const VOICE_BY_ID: Readonly<Record<string, MobVoiceId>> = {
  zombie: 'undead',
  husk: 'undead',
  drowned: 'drowned',
  zombie_piglin: 'piglin',
  // 批次 344：猪灵复用同一套"猪人"档案；疣猪兽暂时也借它（本项目没有猪叫档案）
  piglin: 'piglin',
  hoglin: 'piglin',
  piglin_brute: 'piglin',
  silverfish: 'spider',
  // 炽足兽暂时借牛的低声（本项目没有"岩浆生物"档案）
  strider: 'cow',
  shulker: 'enderman',
  iron_golem: 'villager',
  pillager: 'villager',
  bee: 'spider',
  parrot: 'chicken',
  endermite: 'spider',
  mooshroom: 'cow',
  guardian: 'drowned',
  elder_guardian: 'drowned',
  skeleton: 'skeleton',
  stray: 'skeleton',
  wither_skeleton: 'wither_skeleton',
  creeper: 'creeper',
  spider: 'spider',
  cave_spider: 'spider',
  enderman: 'enderman',
  blaze: 'blaze',
  ghast: 'ghast',
  slime_big: 'slime',
  slime: 'slime',
  slime_small: 'slime',
  magma_cube_big: 'magma_cube',
  magma_cube: 'magma_cube',
  magma_cube_small: 'magma_cube',
  cow: 'cow',
  pig: 'pig',
  sheep: 'sheep',
  chicken: 'chicken',
  villager: 'villager',
  squid: 'squid',
  wolf: 'wolf',
  cat: 'cat',
  // 豹猫与猫同科：叫声复用同一套档案（个体差异交给音高）
  ocelot: 'cat',
  fox: 'fox',
  // 水生（批次 259）：本项目没有单独的鱼叫/海豚哨声，复用鱿鱼的水声（个体差异交给音高）
  cod: 'squid',
  salmon: 'squid',
  dolphin: 'squid',
  // 北极熊（批次 260）：低吼与狼相近，复用 wolf（个体差异交给音高）
  polar_bear: 'wolf',
  phantom: 'phantom',
  wither: 'wither',
  ender_dragon: 'dragon',
};

/**
 * 这一只生物用哪套档案。
 *
 * `remote_player`（联机里的另一名玩家）返回 `null`：他不该发出动物的声音。
 */
export function mobVoiceFor(typeId: string, family?: 'undead' | 'arthropod'): MobVoiceId | null {
  const direct = VOICE_BY_ID[typeId];
  if (direct) return direct;
  if (typeId === 'remote_player') return null;
  if (family === 'undead') return 'undead';
  if (family === 'arthropod') return 'spider';
  return 'passive';
}

/**
 * 音高倍率：幼体更高、小史莱姆更高、洞穴蜘蛛比蜘蛛尖。
 *
 * 这一条承担"同族个体差异"——同是 `spider` 档案，洞穴蜘蛛听起来就不该和蜘蛛一样。
 */
export function mobVoicePitchFor(typeId: string, baby = false): number {
  let pitch = baby ? 1.28 : 1;
  switch (typeId) {
    case 'cave_spider':
      pitch *= 1.35;
      break;
    case 'slime_small':
    case 'magma_cube_small':
      pitch *= 1.5;
      break;
    case 'slime':
    case 'magma_cube':
      pitch *= 1.22;
      break;
    case 'chicken':
      pitch *= 1.08;
      break;
    default:
      break;
  }
  return pitch;
}

/** 取档案里的一条（越界回退到家族兜底，永远不返回 undefined） */
export function mobVoiceSpec(voice: MobVoiceId, event: MobVoiceEvent): SoundSpec {
  return (MOB_VOICES[voice] ?? MOB_VOICES.passive)[event];
}

/**
 * 环境叫的间隔（秒）。默认 9~20 秒；苦力怕很安静、boss 的吼声更稀疏
 * （不然一群怪会把"环境叫"变成背景噪音）。
 */
const AMBIENT_INTERVAL: Partial<Record<MobVoiceId, readonly [number, number]>> = {
  creeper: [22, 45],
  wither: [20, 36],
  dragon: [18, 32],
  phantom: [12, 26],
};

export function ambientIntervalFor(voice: MobVoiceId): readonly [number, number] {
  return AMBIENT_INTERVAL[voice] ?? [9, 20];
}

/** 全部档案 id（测试用：每一种都要三条齐全） */
export const MOB_VOICE_IDS = Object.keys(MOB_VOICES) as MobVoiceId[];

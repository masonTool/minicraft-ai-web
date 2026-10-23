/**
 * 跳一跳的**音效**（批次 20261024-0415，`[跳9]`）
 *
 * 原版的音效是"手感"的一部分：蓄力时每 0.15 秒升一级音阶，靠数音高判断按了多久；
 * 落地、完美命中、特殊方块、失败各有一套声音。这一类音频**有版权**，所以一个文件都
 * 不引入——全部用 WebAudio 现场合成，只对齐"节奏与音高走向"。
 *
 * 分两半：
 *
 *  · **纯函数**（`chargeStepFor` / `chargeFrequencyFor` / `specialSequence` / `SFX`）：
 *    音符表与时间轴都在这里，离线可以直接断言"第 3 级是多少赫兹""+30 的音符比 +5 多"；
 *  · **`JumpAudio` 类**：只负责把上面的音符丢给 WebAudio。拿不到 AudioContext（自动化环境、
 *    浏览器拦截、老设备）时**全部静默吞掉**，绝不让音效失败影响玩法。
 *
 * 音阶用大调五声（do re mi sol la）而不是半音阶：原版蓄力音是"音乐性"的，半音阶听起来
 * 像电子表报警。两个八度共 12 级，正好覆盖 0.9 秒蓄满（0.9 / 0.15 = 6 级，留足余量）。
 */

import type { JumpBlockKind } from './logic.ts';

/** 蓄力每升一级的间隔（秒）——攻略文口径 */
export const CHARGE_STEP_SECONDS = 0.15;
/** 音阶级数上限（两个八度的五声：12 级） */
export const CHARGE_MAX_STEPS = 12;
/** 音阶基准频率（A3） */
export const CHARGE_BASE_FREQ = 220;

/** 大调五声的十二级半音偏移（do re mi sol la × 2 个八度 + 高音 do re） */
const CHARGE_SEMITONES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26] as const;

/** 蓄力了 `seconds` 秒之后应该是第几级音（0 起） */
export function chargeStepFor(seconds: number, maxSteps: number = CHARGE_MAX_STEPS): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const cap = Math.max(1, Math.floor(maxSteps));
  return Math.min(cap - 1, Math.floor(seconds / CHARGE_STEP_SECONDS));
}

/** 第 `step` 级的频率（十二平均律，按五声音阶取音） */
export function chargeFrequencyFor(step: number): number {
  const index = Number.isFinite(step) ? Math.min(CHARGE_MAX_STEPS - 1, Math.max(0, Math.floor(step))) : 0;
  const semitone = CHARGE_SEMITONES[index] ?? 0;
  return CHARGE_BASE_FREQ * 2 ** (semitone / 12);
}

/** 一个音符：什么时候响、响多久、多高 */
export interface Note {
  /** 频率（赫兹） */
  readonly freq: number;
  /** 相对开始时刻（秒） */
  readonly at: number;
  /** 持续时长（秒） */
  readonly duration: number;
  /** 波形 */
  readonly wave: OscillatorType;
  /** 音量（0~1，最终还会乘总音量） */
  readonly gain: number;
}

/** 单音（起跳 / 落地 / 完美 / 失败都用它描述） */
export interface Sweep {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly wave: OscillatorType;
  readonly gain: number;
}

/** 起跳：短促上滑「嗖」 */
export const JUMP_SFX: Sweep = { from: 320, to: 520, duration: 0.08, wave: 'sine', gain: 0.09 };
/** 普通落地：闷「咚」 */
export const LAND_SFX: Sweep = { from: 170, to: 90, duration: 0.07, wave: 'triangle', gain: 0.11 };
/** 完美命中：清亮「叮」（上滑一点，听起来像金属） */
export const PERFECT_SFX: Sweep = { from: 880, to: 1320, duration: 0.12, wave: 'sine', gain: 0.1 };
/** 失败：下滑音 */
export const FAIL_SFX: Sweep = { from: 300, to: 80, duration: 0.35, wave: 'sine', gain: 0.11 };

/**
 * 特殊方块的短旋律：音符按"分越高越长"排列（+5 两个音、+30 五个音）。
 *
 * 旋律是现写的（不引用任何现成曲目），只保证"越贵越好听"这个直觉：
 * 井盖是两声敲门、魔方是三声上行、便利店是四声拐弯、音乐盒是五声琶音。
 */
const SPECIAL_NOTES: Readonly<Record<'well' | 'cube' | 'store' | 'music', readonly number[]>> = {
  well: [523.25, 659.25],
  cube: [523.25, 659.25, 783.99],
  store: [392, 523.25, 659.25, 783.99],
  music: [523.25, 659.25, 783.99, 987.77, 1046.5],
};

/** 特殊方块的音符序列（时间轴从 0 开始，每个音 0.11 秒、间隔 0.02 秒） */
export function specialSequence(kind: JumpBlockKind): Note[] {
  if (kind === 'normal') return [];
  const freqs = SPECIAL_NOTES[kind] ?? [];
  return freqs.map((freq, index) => ({
    freq,
    at: index * 0.13,
    duration: 0.11,
    wave: 'sine',
    gain: 0.08,
  }));
}

/** 特殊方块的旋律总时长（秒）：场景据此决定要不要等它放完 */
export function specialDuration(kind: JumpBlockKind): number {
  const notes = specialSequence(kind);
  const last = notes[notes.length - 1];
  return last ? last.at + last.duration : 0;
}

/**
 * WebAudio 播放器。
 *
 * 所有方法在拿不到音频上下文时都是**静默空操作**：自动化环境里没有音频设备，
 * 浏览器也可能因为"没有用户手势"拒绝创建——小游戏不能因此报错。
 */
export class JumpAudio {
  private ctx: AudioContext | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private chargeStep = -1;

  /** 开始蓄力：起一个持续音，之后靠 `updateCharge` 逐级升调 */
  startCharge(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopCharge();
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = chargeFrequencyFor(0);
      gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this.chargeOsc = osc;
      this.chargeGain = gain;
      this.chargeStep = 0;
    } catch {
      this.stopCharge();
    }
  }

  /**
   * 蓄力推进：每跨过 0.15 秒升一级（不是连续滑音）。
   *
   * 原版是"阶梯感"的音阶，连续滑音会让人分不清按了几级；只有跨级时才改频率，
   * 所以这里先算级数再比较，未跨级直接返回。
   */
  updateCharge(ratio: number, elapsedSeconds?: number): void {
    if (!this.chargeOsc) return;
    const seconds = Number.isFinite(elapsedSeconds)
      ? (elapsedSeconds as number)
      : Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * CHARGE_STEP_SECONDS * CHARGE_MAX_STEPS;
    const step = chargeStepFor(seconds);
    if (step === this.chargeStep) return;
    this.chargeStep = step;
    try {
      this.chargeOsc.frequency.setTargetAtTime(chargeFrequencyFor(step), this.ctx?.currentTime ?? 0, 0.01);
    } catch {
      // 频率更新失败不该影响玩法
    }
  }

  stopCharge(): void {
    try {
      this.chargeOsc?.stop();
    } catch {
      // 已经停过
    }
    this.chargeOsc = null;
    this.chargeGain?.disconnect();
    this.chargeGain = null;
    this.chargeStep = -1;
  }

  playJump(): void {
    this.sweep(JUMP_SFX);
  }

  playLand(center: boolean): void {
    if (center) this.sweep(PERFECT_SFX);
    else this.sweep(LAND_SFX);
  }

  /** 特殊方块：各自一段短旋律（普通方块不响） */
  playSpecial(kind: JumpBlockKind): void {
    for (const note of specialSequence(kind)) this.tone(note);
  }

  playFall(): void {
    this.sweep(FAIL_SFX);
  }

  dispose(): void {
    this.stopCharge();
    try {
      void this.ctx?.close();
    } catch {
      // 关闭失败无所谓
    }
    this.ctx = null;
  }

  // ---------------------------------------------------------------- 内部

  /** 一个"从 A 滑到 B"的单音 */
  private sweep(sweep: Sweep): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = sweep.wave;
      osc.frequency.setValueAtTime(sweep.from, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep.to), now + sweep.duration);
      gain.gain.setValueAtTime(sweep.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + sweep.duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + sweep.duration + 0.02);
    } catch {
      // 静默降级
    }
  }

  /** 旋律里的一个音符（按 `at` 排期） */
  private tone(note: Note): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + note.at;
      const end = start + note.duration;
      osc.type = note.wave;
      osc.frequency.setValueAtTime(note.freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    } catch {
      // 静默降级
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    try {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }
}

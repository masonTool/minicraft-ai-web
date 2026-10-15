/**
 * 音效引擎（K5）：用 Web Audio 现场合成，不依赖任何音频文件
 *
 * 为什么不放音频资源：本项目的贴图都是程序化生成的（`atlasLayout.ts`），
 * 音效沿用同一思路——一组噪声 + 振荡器 + 包络就足以表现"石头碎裂""玻璃叮当"
 * "僵尸低吼"这些辨识度很高的声音，而且省掉了打包与许可问题。
 *
 * 浏览器自动播放策略：AudioContext 必须在**用户手势之后**才能出声，
 * 因此 `resume()` 会挂在第一次点击/按键上（见 main 的绑定）。
 */

export type SoundKind =
  | 'break_stone'
  | 'break_wood'
  | 'break_grass'
  | 'break_sand'
  | 'break_glass'
  | 'break_wool'
  | 'place'
  | 'step'
  | 'hurt'
  | 'death'
  | 'fall'
  | 'door'
  | 'explode'
  | 'splash'
  | 'click'
  | 'eat'
  | 'bow_shoot'
  | 'arrow_hit'
  | 'mob_zombie'
  | 'mob_skeleton'
  | 'mob_creeper'
  | 'mob_cow'
  | 'mob_sheep'
  | 'fuse';

interface SoundSpec {
  /** 声音总时长（秒） */
  duration: number;
  /** 音量（0~1，再乘以播放增益与主音量） */
  gain: number;
  /** 噪声成分占比（0 = 纯振荡器，1 = 纯噪声） */
  noise: number;
  /** 振荡器起始/结束频率（赫兹）；两者不同即为滑音 */
  freqFrom: number;
  freqTo: number;
  /** 波形（噪声通道不使用） */
  type: OscillatorType;
  /** 滤波器中心频率与 Q（把噪声塑形成"石头/沙子/玻璃"的质感） */
  filter: number;
  filterQ: number;
  /** 包络（秒）：起音与释放 */
  attack: number;
  release: number;
  /** 是否叠加一个低频"闷响"（爆炸、受伤、落地用） */
  thump?: number;
}

/**
 * 音效表。数值是听感调出来的，不是采样复刻——
 * 目标是"闭着眼能分辨出是石头还是木头"，而不是逐位还原原版音源。
 */
const SOUNDS: Record<SoundKind, SoundSpec> = {
  break_stone: { duration: 0.22, gain: 0.55, noise: 0.9, freqFrom: 180, freqTo: 90, type: 'triangle', filter: 1400, filterQ: 0.8, attack: 0.002, release: 0.2, thump: 60 },
  break_wood: { duration: 0.2, gain: 0.5, noise: 0.7, freqFrom: 220, freqTo: 110, type: 'square', filter: 900, filterQ: 1.1, attack: 0.002, release: 0.18 },
  break_grass: { duration: 0.16, gain: 0.35, noise: 1, freqFrom: 400, freqTo: 300, type: 'triangle', filter: 2600, filterQ: 0.6, attack: 0.002, release: 0.14 },
  break_sand: { duration: 0.2, gain: 0.4, noise: 1, freqFrom: 300, freqTo: 260, type: 'triangle', filter: 3600, filterQ: 0.4, attack: 0.004, release: 0.18 },
  break_glass: { duration: 0.28, gain: 0.45, noise: 0.45, freqFrom: 2100, freqTo: 1400, type: 'sine', filter: 5200, filterQ: 2.5, attack: 0.001, release: 0.26 },
  break_wool: { duration: 0.18, gain: 0.32, noise: 1, freqFrom: 260, freqTo: 200, type: 'triangle', filter: 1200, filterQ: 0.5, attack: 0.004, release: 0.16 },
  place: { duration: 0.12, gain: 0.4, noise: 0.35, freqFrom: 320, freqTo: 180, type: 'square', filter: 1600, filterQ: 1, attack: 0.001, release: 0.1 },
  step: { duration: 0.1, gain: 0.18, noise: 1, freqFrom: 240, freqTo: 180, type: 'triangle', filter: 1500, filterQ: 0.6, attack: 0.003, release: 0.08 },
  hurt: { duration: 0.32, gain: 0.5, noise: 0.25, freqFrom: 380, freqTo: 160, type: 'sawtooth', filter: 1400, filterQ: 0.9, attack: 0.004, release: 0.3, thump: 90 },
  death: { duration: 0.9, gain: 0.55, noise: 0.2, freqFrom: 340, freqTo: 90, type: 'sawtooth', filter: 1000, filterQ: 0.8, attack: 0.01, release: 0.85, thump: 70 },
  fall: { duration: 0.24, gain: 0.45, noise: 0.5, freqFrom: 140, freqTo: 70, type: 'triangle', filter: 700, filterQ: 0.9, attack: 0.002, release: 0.22, thump: 55 },
  door: { duration: 0.4, gain: 0.4, noise: 0.55, freqFrom: 160, freqTo: 240, type: 'sawtooth', filter: 800, filterQ: 3.5, attack: 0.01, release: 0.36 },
  explode: { duration: 1.1, gain: 0.7, noise: 1, freqFrom: 120, freqTo: 40, type: 'triangle', filter: 500, filterQ: 0.5, attack: 0.002, release: 1.05, thump: 45 },
  splash: { duration: 0.5, gain: 0.4, noise: 1, freqFrom: 900, freqTo: 300, type: 'triangle', filter: 2200, filterQ: 0.5, attack: 0.004, release: 0.46 },
  click: { duration: 0.07, gain: 0.3, noise: 0.15, freqFrom: 900, freqTo: 700, type: 'square', filter: 3000, filterQ: 1, attack: 0.001, release: 0.06 },
  // 咀嚼声：短促的低频噪声，进食过程中每嚼一口响一次
  eat: { duration: 0.14, gain: 0.26, noise: 0.85, freqFrom: 320, freqTo: 200, type: 'triangle', filter: 900, filterQ: 1.6, attack: 0.008, release: 0.13 },
  // 弓弦：一声由高到低的"崩"（频率下滑得快、余音短）
  bow_shoot: { duration: 0.24, gain: 0.42, noise: 0.3, freqFrom: 880, freqTo: 180, type: 'triangle', filter: 2400, filterQ: 2.4, attack: 0.001, release: 0.22 },
  // 箭命中方块/生物：短促的"笃"
  arrow_hit: { duration: 0.1, gain: 0.32, noise: 0.55, freqFrom: 420, freqTo: 220, type: 'square', filter: 1800, filterQ: 1.4, attack: 0.001, release: 0.09 },
  mob_zombie: { duration: 0.7, gain: 0.42, noise: 0.45, freqFrom: 150, freqTo: 110, type: 'sawtooth', filter: 700, filterQ: 1.4, attack: 0.05, release: 0.6, thump: 80 },
  mob_skeleton: { duration: 0.35, gain: 0.38, noise: 0.4, freqFrom: 900, freqTo: 600, type: 'square', filter: 2800, filterQ: 2.2, attack: 0.002, release: 0.32 },
  mob_creeper: { duration: 0.55, gain: 0.45, noise: 1, freqFrom: 700, freqTo: 380, type: 'triangle', filter: 2400, filterQ: 1.2, attack: 0.01, release: 0.5 },
  mob_cow: { duration: 0.75, gain: 0.38, noise: 0.2, freqFrom: 210, freqTo: 150, type: 'sawtooth', filter: 900, filterQ: 1.1, attack: 0.08, release: 0.65 },
  mob_sheep: { duration: 0.6, gain: 0.36, noise: 0.25, freqFrom: 380, freqTo: 300, type: 'sawtooth', filter: 1400, filterQ: 1.3, attack: 0.05, release: 0.55 },
  // 苦力怕引信：持续的嘶嘶声，音调缓慢上扬（原版点火音的辨识度全靠它）
  fuse: { duration: 1.4, gain: 0.34, noise: 1, freqFrom: 1500, freqTo: 2600, type: 'triangle', filter: 3200, filterQ: 1.1, attack: 0.08, release: 1.3 },
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
    name.includes('melon')
  ) {
    return 'break_wood';
  }
  return 'break_stone';
}

/** 可听距离（格）：超出这个距离不再播放，省掉无意义的合成开销 */
const HEARING_RANGE = 32;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  /** 主音量（与设置里的音量联动） */
  volume = 0.7;
  /** 是否启用（可在设置里关掉；AudioContext 创建失败时为 false） */
  enabled = true;
  /** 监听者位置（玩家），用于距离衰减 */
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  /** 噪声缓冲复用：每次合成都新建 AudioBuffer 会产生大量垃圾 */
  private noiseBuffer: AudioBuffer | null = null;
  /** 统计播放次数（调试面板用） */
  played = 0;

  /**
   * 创建/恢复 AudioContext。必须由用户手势触发（浏览器自动播放策略），
   * 因此 main 会把它挂在第一次 pointerdown / keydown 上。
   */
  resume(): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // 某些环境（无音频设备、隐私模式）会直接抛错：关掉音效，不影响游戏
      this.enabled = false;
    }
  }

  /** AudioContext 状态（验收脚本用：suspended 说明还没被用户手势解锁） */
  get contextState(): string {
    return this.ctx?.state ?? 'none';
  }

  setListener(x: number, y: number, z: number): void {
    this.listenerX = x;
    this.listenerY = y;
    this.listenerZ = z;
  }

  /** 播放一个音效；给坐标时会按距离衰减 */
  play(kind: SoundKind, at?: { x: number; y: number; z: number }): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const spec = SOUNDS[kind];
    if (!spec) return;

    let gain = spec.gain * this.volume;
    if (at) {
      const distance = Math.hypot(at.x - this.listenerX, at.y - this.listenerY, at.z - this.listenerZ);
      if (distance > HEARING_RANGE) return;
      // 距离衰减：近处几乎不衰减，远处快速变小（与原版的听觉范围接近）
      gain *= Math.max(0.08, 1 - distance / HEARING_RANGE) ** 1.6;
    }
    if (gain <= 0.001) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(gain, now + spec.attack);
    out.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
    out.connect(ctx.destination);

    // ---- 噪声通道：白噪声 → 带通 → 包络（石头/沙子/爆炸的主体）
    if (spec.noise > 0.01) {
      const source = ctx.createBufferSource();
      source.buffer = this.getNoiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(spec.filter, now);
      filter.Q.value = spec.filterQ;
      const gainNode = ctx.createGain();
      gainNode.gain.value = spec.noise;
      source.connect(filter).connect(gainNode).connect(out);
      source.start(now);
      source.stop(now + spec.duration + 0.02);
    }

    // ---- 振荡器通道：给声音一个明确的音高（玻璃/脚步/生物叫）
    if (spec.noise < 0.99) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.freqFrom, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqTo), now + spec.duration);
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1 - spec.noise;
      osc.connect(gainNode).connect(out);
      osc.start(now);
      osc.stop(now + spec.duration + 0.02);
    }

    // ---- 低频闷响：爆炸/受伤/落地那一下"拳头感"
    if (spec.thump) {
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(spec.thump * 2, now);
      thump.frequency.exponentialRampToValueAtTime(spec.thump * 0.6, now + spec.duration * 0.6);
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.9, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration * 0.7);
      thump.connect(gainNode).connect(out);
      thump.start(now);
      thump.stop(now + spec.duration * 0.8);
    }

    this.played++;
  }

  /** 按方块材质挑破坏音效（方块名 → 音效） */
  playBreakForBlock(blockName: string, at?: { x: number; y: number; z: number }): void {
    this.play(breakSoundFor(blockName), at);
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

/**
 * 背景音乐（批次 233）
 *
 * 本项目**没有音乐素材**（与音效同一个版权口径），所以这里做的是
 * **程序化生成**：每隔半分钟到一分半，随机"写"一小段 4~7 个音的短句，
 * 用软钢琴/钟的音色铺在过去——不是循环播放一段固定旋律。
 *
 * 三条设计约束（也是"不难听"的原因）：
 *  1. **只用五声音阶**（跨两个八度）：随机走音也不会撞出刺耳的小二度；
 *  2. **稀疏**：短句之间留 45~100 秒空白（原版音乐也不是连续播的），
 *     它必须能被玩家忘掉，才不会变成噪音；
 *  3. **有铺底**：多数段落带一个低八度的长音（pad），
 *     单独几个高音会像"手机铃声"，加一层低频才有"场景"感。
 *
 * 下界用**增四度/小二度**（`MUSIC_SCALES.nether`），末地用高而稀疏的音，
 * 与主世界区分开。这一层是纯逻辑（不碰 Web Audio），所以能离线断言；
 * 发声全部由 `AudioEngine.playMusicNote` 完成。
 */

export type MusicDimension = 'overworld' | 'nether' | 'end';

export interface MusicContext {
  dimension: MusicDimension;
  night: boolean;
}

/** 一段音乐里的一个音符（`delay` 是相对现在多少秒后发声） */
export interface MusicNote {
  hz: number;
  delay: number;
  duration: number;
  velocity: number;
}

/**
 * 音阶（Hz）。
 *
 * 主世界白天是 A 小调五声（A C D E G），夜里整段降八度；
 * 下界故意往下压并用增四度（A 与 D#）制造"不安"；
 * 末地高而空（A5 起），与主世界一耳朵能分开。
 */
export const MUSIC_SCALES: Readonly<Record<'day' | 'night' | 'nether' | 'end', readonly number[]>> = {
  day: [220.0, 261.63, 293.66, 329.63, 392.0, 440.0],
  night: [110.0, 130.81, 146.83, 164.81, 196.0, 220.0],
  nether: [110.0, 116.54, 155.56, 164.81, 233.08],
  end: [440.0, 523.25, 659.25, 783.99, 880.0],
};

/** 第一段音乐等多久（秒）：进世界就响会显得像"开场动画"，原版也会先安静一会儿 */
const FIRST_DELAY_MIN = 12;
const FIRST_DELAY_MAX = 26;

/** 两段之间留白（秒）：主世界最长，下界略短（那里本来就压抑） */
const GAP: Readonly<Record<MusicDimension, readonly [number, number]>> = {
  overworld: [45, 90],
  nether: [35, 70],
  end: [55, 100],
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 音乐导演：决定"什么时候来下一段、这一段弹什么"。
 *
 * 用 tick 推进（`update(dt, 环境)` 返回"现在该预约的音符"），而不是 `setInterval`：
 * 暂停时主循环 `dt = 0`，音乐自然停在那儿，不需要额外的暂停/恢复分支。
 */
export class MusicDirector {
  /** 距下一段还有多久（秒） */
  private timer: number;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.timer = this.firstDelay();
  }

  /** 距下一段还有多久（测试与调试用） */
  get nextIn(): number {
    return this.timer;
  }

  /** 进新世界 / 换维度时重置（不至于刚传送就立刻响，也不会等太久） */
  reset(): void {
    this.timer = this.firstDelay();
  }

  /**
   * 推进时间。返回**要立刻预约**的音符（可能为空；一段音乐一次给好几个）。
   *
   * 调用方（`main`）把每个音符交给 `AudioEngine.playMusicNote`，由后者按 `delay`
   * 预约到未来——所以节拍精度与帧率无关。
   */
  update(dt: number, context: MusicContext): MusicNote[] {
    if (!(dt > 0)) return [];
    this.timer -= dt;
    if (this.timer > 0) return [];

    const notes = this.compose(context);
    const tail = notes.reduce((max, note) => Math.max(max, note.delay + note.duration), 0);
    this.timer = tail + this.gapFor(context.dimension);
    return notes;
  }

  private firstDelay(): number {
    return FIRST_DELAY_MIN + this.random() * (FIRST_DELAY_MAX - FIRST_DELAY_MIN);
  }

  private gapFor(dimension: MusicDimension): number {
    const [min, max] = GAP[dimension];
    return min + this.random() * (max - min);
  }

  /** 这一环境用哪条音阶 */
  private scaleFor(context: MusicContext): readonly number[] {
    if (context.dimension === 'nether') return MUSIC_SCALES.nether;
    if (context.dimension === 'end') return MUSIC_SCALES.end;
    return context.night ? MUSIC_SCALES.night : MUSIC_SCALES.day;
  }

  /**
   * 写一小段。
   *
   * 结构是"铺底（可能没有）+ 4~7 个音的上行/下行游走 + 偶尔一个五度叠音"。
   * 约三成的段落**完全不放旋律**（只有铺底）——留白比多写几个音更像"背景音乐"。
   */
  private compose(context: MusicContext): MusicNote[] {
    const random = this.random;
    const scale = this.scaleFor(context);
    const notes: MusicNote[] = [];
    const sparse = context.dimension === 'end';
    const padDuration = 6 + random() * 4;

    // 铺底：下界/末地每段都有，主世界一半概率（免得每次都是同一个低频嗡嗡声）
    if (context.dimension !== 'overworld' || random() < 0.5) {
      notes.push({
        hz: scale[0] / 2,
        delay: 0,
        duration: padDuration,
        velocity: 0.34,
      });
    }

    // 三成段落只有铺底（"这一段只是一个和弦"）
    if (random() < 0.3) return notes;

    const count = 4 + Math.floor(random() * 4); // 4~7 个音
    const stepBase = sparse ? 1.35 : context.night ? 1.0 : 0.78;
    const noteBase = sparse ? 2.8 : context.night ? 2.0 : 1.65;
    let index = clamp(1 + Math.floor(random() * (scale.length - 2)), 0, scale.length - 1);
    let delay = 0.35 + random() * 0.5;

    for (let i = 0; i < count; i++) {
      const hz = scale[index] ?? scale[0]!;
      const duration = noteBase * (0.85 + random() * 0.4);
      const velocity = 0.62 + random() * 0.3;
      notes.push({ hz, delay, duration, velocity });

      // 偶尔叠一个五度（1.5×）：比三度更"空"，适合背景
      if (random() < 0.16) {
        notes.push({ hz: hz * 1.5, delay, duration: duration * 0.85, velocity: velocity * 0.45 });
      }

      delay += stepBase * (0.85 + random() * 0.35);
      // 随机游走：多半走一步，一少半停住或跨一步
      const move = random();
      index = clamp(index + (move < 0.38 ? -1 : move > 0.62 ? 1 : 0), 0, scale.length - 1);
    }

    return notes;
  }
}

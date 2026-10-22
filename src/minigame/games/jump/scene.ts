/**
 * 跳一跳的**画面、输入与一局流程**（J1~J3，批次 20261022-2220）
 *
 * 规则全在 `logic.ts`，这里只做四件事：把状态画出来、把按下/松开翻译成蓄力与起跳、
 * 结算与最高分、音效。
 *
 * 五条刻意的做法：
 *
 *  1. **一个自由度**：方向自动对准下一个方块，玩家只控制蓄力时长。
 *  2. **状态机显式**：`ready → charging → jumping → (ready | falling → over)`；
 *     每次状态切换只在一个地方发生（`beginCharge` / `release` / `land` / `finish`）。
 *  3. **压缩身体**：`PlayerRenderer.object` 的原点在脚底，所以 `scale.y` 直接压就是
 *     "蹲下"，不会陷进方块；起跳时弹回并前空翻，落地再压一次。
 *  4. **柱子每跳重建**：一屏 4~5 根，重建比增量维护简单；主题每 20 分换一次。
 *  5. **音效静默降级**：没有 AudioContext / 被浏览器拦截时全部吞掉，`guard` 必须 0 错误。
 */

import { t, tp } from '../../../core/i18n/I18n.ts';
import { PlayerRenderer } from '../../../render/PlayerRenderer.ts';
import { bestScore, loadProgress, recordScore, saveProgress } from '../../progress.ts';
import { JUMP_CONFIG } from './config.ts';
import {
  createRun,
  currentBlock,
  distanceForCharge,
  jump,
  specialBonus,
  targetBlock,
  type JumpRun,
  type LandingOutcome,
} from './logic.ts';
import { PillarScene, type PillarSpec } from './PillarScene.ts';
import { themeForScore, type JumpTheme } from './themes.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';

type Phase = 'ready' | 'charging' | 'jumping' | 'falling' | 'over';

/** 方块顶面高度 */
const STAND_Y = 1;
/** 蓄力到满时的身体压缩比例 */
const BODY_SQUASH = 0.35;
/** 蓄力时柱子顶面下沉的最大比例 */
const PILLAR_SQUASH = 0.12;
/** 结算面板淡入前的等待（让玩家看清"掉下去了"） */
const FALL_SECONDS = 0.75;

export interface JumpGameOptions {
  /** 一局结束时的得分（主程序写最高分用；不传就只写本地存储） */
  readonly onScore?: (score: number) => void;
}

export class JumpGame implements MiniGame {
  readonly id = 'jump' as const;
  readonly titleKey = 'minigame.jump.title';

  status: MiniGameStatus = 'playing';

  private context: MiniGameContext | null = null;
  private pillars: PillarScene | null = null;
  private player: PlayerRenderer | null = null;
  private audio: JumpAudio | null = null;

  private theme: JumpTheme = themeForScore(0);
  private run: JumpRun;
  private seed = 1;
  private phase: Phase = 'ready';

  /** 蓄力累计（秒） */
  private charge = 0;
  private elapsed = 0;
  private duration = 0.36;
  private jumpFrom = { x: 0, z: 0 };
  private jumpTo = { x: 0, z: 0 };
  private jumpPeak = 1.2;
  private yaw = 0;
  private pending: LandingOutcome | null = null;

  /** 落地后正在"停留加分"的方块 id（-1 = 没有） */
  private holdBlockId = -1;
  private holdTimer = 0;
  private specialTaken = false;

  private hud: HTMLDivElement | null = null;
  private scoreEl: HTMLDivElement | null = null;
  private bestEl: HTMLDivElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private overEl: HTMLDivElement | null = null;
  private overTitleEl: HTMLDivElement | null = null;
  private overBestEl: HTMLDivElement | null = null;

  private best = 0;
  private readonly listeners = new AbortController();

  constructor(private readonly options: JumpGameOptions = {}) {
    this.run = createRun(this.seed);
    this.best = bestScoreOf();
  }

  mount(context: MiniGameContext): void {
    this.context = context;
    this.best = bestScoreOf();
    this.seed = 1;
    this.run = createRun(this.seed);
    this.phase = 'ready';

    this.theme = themeForScore(0);
    const pillars = new PillarScene({ atlas: context.atlas, theme: this.theme });
    pillars.setViewport(window.innerWidth, window.innerHeight);
    this.pillars = pillars;
    this.rebuildPillars();
    pillars.snap(currentBlock(this.run), targetBlock(this.run));

    const player = new PlayerRenderer(pillars.scene, () => 1);
    player.setVisible(true);
    this.player = player;

    this.audio = new JumpAudio();
    this.buildHud(context);
    this.updateHud();

    window.addEventListener('resize', this.onResize, { signal: this.listeners.signal });
    document.addEventListener('keydown', this.onKeyDown, { signal: this.listeners.signal });
    document.addEventListener('keyup', this.onKeyUp, { signal: this.listeners.signal });
  }

  unmount(): void {
    this.listeners.abort();
    this.player?.dispose();
    this.player = null;
    this.pillars?.dispose();
    this.pillars = null;
    this.audio?.dispose();
    this.audio = null;
    this.hud?.remove();
    this.hud = null;
    this.overEl?.remove();
    this.overEl = null;
    this.scoreEl = null;
    this.bestEl = null;
    this.hintEl = null;
    this.overTitleEl = null;
    this.overBestEl = null;
    this.context = null;
    this.pending = null;
    this.phase = 'ready';
  }

  update(dt: number): void {
    const context = this.context;
    const pillars = this.pillars;
    const player = this.player;
    if (!context || !pillars || !player) return;

    const step = Math.min(0.05, Math.max(0, dt));

    if (this.phase === 'charging') {
      this.charge = Math.min(JUMP_CONFIG.maxCharge, this.charge + step);
      const ratio = this.charge / JUMP_CONFIG.maxCharge;
      player.object.scale.y = 1 - BODY_SQUASH * ratio;
      pillars.setSquash(PILLAR_SQUASH * ratio);
      this.audio?.updateCharge(ratio);
    }

    if (this.phase === 'ready' || this.phase === 'charging') {
      this.tickSpecialHold(step);
      const block = currentBlock(this.run);
      this.drawPlayer(block.x, STAND_Y, block.z, this.yaw);
    } else if (this.phase === 'jumping') {
      this.elapsed += step;
      const progress = Math.min(1, this.elapsed / this.duration);
      const x = this.jumpFrom.x + (this.jumpTo.x - this.jumpFrom.x) * progress;
      const z = this.jumpFrom.z + (this.jumpTo.z - this.jumpFrom.z) * progress;
      // 抛物线：起跳和落地都是 0，中间到峰值
      const y = STAND_Y + Math.sin(Math.PI * progress) * this.jumpPeak;
      this.drawPlayer(x, y, z, this.yaw);
      // `update()` 会把 rotation.x 归零，所以空翻必须写在它之后
      player.object.rotation.x = -Math.PI * 2 * progress;
      if (progress >= 1) this.land();
    } else if (this.phase === 'falling') {
      this.elapsed += step;
      const y = STAND_Y - this.elapsed * 7;
      this.drawPlayer(this.jumpTo.x, y, this.jumpTo.z, this.yaw);
      player.object.rotation.z = this.elapsed * 2.2;
      if (this.elapsed >= FALL_SECONDS) this.finish();
    }

    pillars.follow(currentBlock(this.run), targetBlock(this.run), step);
    pillars.render(context.renderer);
  }

  onPointer(pointer: MiniGamePointer): void {
    if (this.phase === 'over') return;
    if (pointer.type === 'down') this.beginCharge();
    else if (pointer.type === 'up') this.release();
  }

  /**
   * 验收脚本用：只读快照。
   *
   * 不暴露可变对象：E2E 只需要"现在几分、在哪个阶段"，拿到 `run` 就能改分，
   * 那样的断言等于自己给自己判卷。
   */
  get debugState(): {
    phase: Phase;
    score: number;
    combo: number;
    index: number;
    best: number;
    blocks: number;
  } {
    return {
      phase: this.phase,
      score: this.run.score,
      combo: this.run.combo,
      index: this.run.index,
      best: this.best,
      blocks: this.run.blocks.length,
    };
  }

  // ---------------------------------------------------------------- 状态

  private beginCharge(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'charging';
    this.charge = 0;
    this.audio?.startCharge();
  }

  private release(): void {
    if (this.phase !== 'charging') return;

    const from = currentBlock(this.run);
    const to = targetBlock(this.run);
    const distance = distanceForCharge(this.charge);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz) || 1;

    this.pending = jump(this.run, distance);
    this.jumpFrom = { x: from.x, z: from.z };
    this.jumpTo = {
      x: from.x + (dx / length) * distance,
      z: from.z + (dz / length) * distance,
    };
    this.jumpPeak = Math.min(2.4, 0.85 + distance * 0.3);
    this.duration = 0.3 + distance * 0.045;
    this.yaw = Math.atan2(-(dx / length), -(dz / length));
    this.elapsed = 0;

    this.phase = 'jumping';
    this.charge = 0;
    this.pillars?.setSquash(0);
    if (this.player) this.player.object.scale.y = 1;
    this.audio?.stopCharge();
    this.audio?.playJump();
  }

  private land(): void {
    const outcome = this.pending;
    this.pending = null;
    if (!outcome) {
      this.finish();
      return;
    }

    if (this.player) {
      this.player.object.rotation.x = 0;
      this.player.object.scale.y = 1;
    }

    if (outcome.over) {
      this.phase = 'falling';
      this.elapsed = 0;
      this.audio?.playFall();
      return;
    }

    this.run = outcome.run;
    this.applyThemeIfNeeded();
    this.rebuildPillars();
    this.phase = 'ready';
    this.elapsed = 0;

    this.audio?.playLand(outcome.center);
    if (outcome.center) this.context?.toast(`+${outcome.points}`);

    const landed = currentBlock(this.run);
    this.holdBlockId = landed.kind === 'normal' ? -1 : landed.id;
    this.holdTimer = 0;
    this.specialTaken = false;
    this.updateHud();
  }

  private finish(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.status = 'lost';

    const score = this.run.score;
    this.best = Math.max(this.best, score);
    const progress = recordScore(loadProgress(), 'jump', score);
    saveProgress(progress);
    this.options.onScore?.(score);

    this.updateHud();
    this.showOver(score);
  }

  private restart(): void {
    this.seed += 1;
    this.run = createRun(this.seed);
    this.phase = 'ready';
    this.status = 'playing';
    this.charge = 0;
    this.elapsed = 0;
    this.holdBlockId = -1;
    this.holdTimer = 0;
    this.specialTaken = false;
    this.pending = null;

    if (this.player) {
      this.player.object.scale.y = 1;
      this.player.object.rotation.set(0, 0, 0);
    }
    this.overEl?.classList.add('hidden');
    this.applyThemeIfNeeded();
    this.rebuildPillars();
    this.pillars?.snap(currentBlock(this.run), targetBlock(this.run));
    this.updateHud();
  }

  /** 停留加分：普通方块不参与，每块只给一次 */
  private tickSpecialHold(dt: number): void {
    if (this.holdBlockId < 0 || this.specialTaken) return;
    this.holdTimer += dt;
    if (this.holdTimer < JUMP_CONFIG.specialHoldSeconds) return;

    this.specialTaken = true;
    const block = currentBlock(this.run);
    const bonus = specialBonus(block.kind);
    if (bonus <= 0) return;

    this.run = { ...this.run, score: this.run.score + bonus };
    this.audio?.playSpecial();
    this.context?.toast(`+${bonus}`);
    this.updateHud();
  }

  // ---------------------------------------------------------------- 画面

  private drawPlayer(x: number, y: number, z: number, yaw: number): void {
    this.player?.update(
      {
        x,
        y,
        z,
        yaw,
        pitch: 0,
        walkPhase: 0,
        walkAmount: 0,
        swing: 0,
        flying: false,
      },
      () => null,
    );
  }

  private applyThemeIfNeeded(): void {
    const next = themeForScore(this.run.score);
    if (next.id === this.theme.id) return;
    this.theme = next;

    const context = this.context;
    if (!context) return;
    this.pillars?.dispose();
    const pillars = new PillarScene({ atlas: context.atlas, theme: this.theme });
    pillars.setViewport(window.innerWidth, window.innerHeight);
    this.pillars = pillars;
    // 玩家模型挂在旧场景的根上：重建场景后要重新挂一次
    this.player?.dispose();
    this.player = new PlayerRenderer(pillars.scene, () => 1);
    this.player.setVisible(true);
    pillars.snap(currentBlock(this.run), targetBlock(this.run));
  }

  private rebuildPillars(): void {
    const pillars = this.pillars;
    if (!pillars) return;
    const specs: PillarSpec[] = [];
    const from = Math.max(0, this.run.index - 1);
    const to = Math.min(this.run.blocks.length - 1, this.run.index + 2);
    for (let i = from; i <= to; i++) {
      const block = this.run.blocks[i];
      if (!block) continue;
      specs.push({
        x: block.x,
        z: block.z,
        size: block.size,
        kind: block.kind,
        current: i === this.run.index,
      });
    }
    pillars.setPillars(specs);
  }

  private readonly onResize = (): void => {
    this.pillars?.setViewport(window.innerWidth, window.innerHeight);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (this.phase === 'over') {
      this.restart();
      return;
    }
    this.beginCharge();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    this.release();
  };

  // ---------------------------------------------------------------- HUD

  private buildHud(context: MiniGameContext): void {
    const hud = document.createElement('div');
    hud.className = 'jump-hud';

    const score = document.createElement('div');
    score.className = 'jump-score';
    this.scoreEl = score;

    const best = document.createElement('div');
    best.className = 'jump-best';
    this.bestEl = best;

    const hint = document.createElement('div');
    hint.className = 'jump-hint';
    hint.textContent = t('minigame.jump.hint');
    this.hintEl = hint;

    hud.append(score, best, hint);
    context.layer.appendChild(hud);
    this.hud = hud;

    const over = document.createElement('div');
    over.className = 'jump-over hidden';

    const panel = document.createElement('div');
    panel.className = 'jump-over-panel';

    const title = document.createElement('div');
    title.className = 'jump-over-title';
    this.overTitleEl = title;

    const overBest = document.createElement('div');
    overBest.className = 'jump-over-best';
    this.overBestEl = overBest;

    const actions = document.createElement('div');
    actions.className = 'jump-over-actions';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.dataset.action = 'retry';
    retry.textContent = t('minigame.jump.retry');
    retry.addEventListener('click', (event) => {
      event.stopPropagation();
      this.restart();
    });

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.dataset.action = 'exit';
    exit.textContent = t('minigame.exit');
    exit.addEventListener('click', (event) => {
      event.stopPropagation();
      context.exit();
    });

    actions.append(retry, exit);
    panel.append(title, overBest, actions);
    over.appendChild(panel);
    context.layer.appendChild(over);
    this.overEl = over;
  }

  private updateHud(): void {
    if (this.scoreEl) this.scoreEl.textContent = String(this.run.score);
    if (this.bestEl) this.bestEl.textContent = tp('minigame.jump.best', { best: this.best });
    if (this.hintEl) this.hintEl.classList.toggle('hidden', this.run.score > 0 || this.phase === 'over');
  }

  private showOver(score: number): void {
    if (!this.overEl) return;
    if (this.overTitleEl) this.overTitleEl.textContent = tp('minigame.jump.over', { score });
    if (this.overBestEl) this.overBestEl.textContent = tp('minigame.jump.best', { best: this.best });
    this.overEl.classList.remove('hidden');
    if (this.hintEl) this.hintEl.classList.add('hidden');
  }
}

// ------------------------------------------------------------------ 音效

/**
 * 极简 WebAudio：不引入任何音频文件（不增加包体）。
 *
 * 蓄力是一条持续振荡器，频率随蓄力从 220Hz 升到 660Hz——这是原版"听声音数节奏"
 * 那个手感的关键；落地按"是否中心"给两种短音。
 *
 * ⚠️ 任何一步失败都静默：AudioContext 在某些浏览器里要用户手势后才能创建，
 * 小游戏的第一次 pointerdown 正好满足；但自动化环境里可能完全没有音频设备。
 */
class JumpAudio {
  private ctx: AudioContext | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  startCharge(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopCharge();
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 220;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this.chargeOsc = osc;
      this.chargeGain = gain;
    } catch {
      this.stopCharge();
    }
  }

  updateCharge(ratio: number): void {
    if (!this.chargeOsc) return;
    try {
      this.chargeOsc.frequency.value = 220 + 440 * Math.min(1, Math.max(0, ratio));
    } catch {
      // 忽略：频率更新失败不该影响玩法
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
  }

  playJump(): void {
    this.blip(320, 520, 0.08);
  }

  playLand(center: boolean): void {
    this.blip(center ? 880 : 160, center ? 880 : 120, center ? 0.12 : 0.07);
  }

  playSpecial(): void {
    this.blip(660, 990, 0.16);
  }

  playFall(): void {
    this.blip(300, 80, 0.35);
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

  private blip(from: number, to: number, seconds: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + seconds);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + seconds + 0.02);
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

// ------------------------------------------------------------------ 小工具

function bestScoreOf(): number {
  return bestScore(loadProgress(), 'jump');
}

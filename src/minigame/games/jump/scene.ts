/**
 * 跳一跳的**画面、输入与一局流程**（J1~J3 起，批次 20261024-0415 重写渲染层）
 *
 * 规则全在 `logic.ts`，镜头在 `iso.ts`，方块与色板在 `BlockScene.ts` / `palette.ts`，
 * 小人在 `JumperModel.ts`；这里只做四件事：把状态画出来、把按下/松开翻译成蓄力与起跳、
 * 结算与最高分、音效。
 *
 * 五条刻意的做法：
 *
 *  1. **一个自由度**：方向自动对准下一个方块，玩家只控制蓄力时长。
 *  2. **状态机显式**：`ready → charging → jumping → (ready | falling → over)`；
 *     每次状态切换只在一个地方发生（`beginCharge` / `release` / `land` / `finish`）。
 *  3. **小人原点在脚底**：所以"站到方块顶面"就是 `position.y = 顶面高度`，压扁也从脚底压，
 *     不会陷进方块；蓄力压扁、空中翻转、落地回弹全部交给 `JumperModel` 的三个 setter。
 *  4. **方块每跳重建**：一屏 3~4 块，重建比增量维护简单；换一局只换色板（不重建场景）。
 *  5. **音效静默降级**：没有 AudioContext / 被浏览器拦截时全部吞掉，`guard` 必须 0 错误。
 */

import { t, tp } from '../../../core/i18n/I18n.ts';
import { bestScore, loadProgress, recordScore, saveProgress } from '../../progress.ts';
import { JUMP_CONFIG } from './config.ts';
import {
  createRun,
  currentBlock,
  distanceForCharge,
  jump,
  specialBonus,
  targetBlock,
  type JumpBlock,
  type JumpRun,
  type LandingOutcome,
} from './logic.ts';
import { BlockScene, type BlockSpec } from './BlockScene.ts';
import { JumperModel } from './JumperModel.ts';
import { BLOCK_HEIGHT_RATIO } from './iso.ts';
import { JUMP_TIMING, flipProgress, jumpArc, landingSquash } from './motion.ts';
import { paletteForSeed } from './palette.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';

type Phase = 'ready' | 'charging' | 'jumping' | 'falling' | 'over';

/** 站在某块方块上的脚底高度（方块高度 = 边长 × 0.6，见规格表 §2） */
function standHeight(block: { size: number }): number {
  return Math.max(0.05, block.size * BLOCK_HEIGHT_RATIO);
}

/** 蓄力时当前方块下压的最大比例（规格表 §8：顶面 y → 0.8） */
const PILLAR_SQUASH = 0.2;
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
  private blocks: BlockScene | null = null;
  private jumper: JumperModel | null = null;
  private audio: JumpAudio | null = null;

  private run: JumpRun;
  private seed = 1;
  private phase: Phase = 'ready';

  /** 蓄力累计（秒） */
  private charge = 0;
  private elapsed = 0;
  private duration = 0.36;
  private jumpFrom = { x: 0, z: 0 };
  private jumpTo = { x: 0, z: 0 };
  /** 起跳 / 落地时脚底的高度（方块会随分数变矮，不能当成常量） */
  private jumpFromY = 1;
  private jumpToY = 1;
  private jumpPeak = 1.2;
  private yaw = 0;
  private pending: LandingOutcome | null = null;
  /** 落地压缩已过去的毫秒（> JUMP_TIMING.landSquashMs 即结束） */
  private landSquashMs = Number.POSITIVE_INFINITY;

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

    const blocks = new BlockScene(paletteForSeed(this.seed));
    blocks.setViewport(window.innerWidth, window.innerHeight);
    this.blocks = blocks;
    this.rebuildBlocks();
    blocks.follow(0);

    this.landSquashMs = Number.POSITIVE_INFINITY;
    const jumper = new JumperModel();
    jumper.setSize(currentBlock(this.run).size);
    jumper.setPosition(currentBlock(this.run).x, standHeight(currentBlock(this.run)), currentBlock(this.run).z);
    blocks.scene.add(jumper.object);
    this.jumper = jumper;

    this.audio = new JumpAudio();
    this.buildHud(context);
    this.updateHud();

    window.addEventListener('resize', this.onResize, { signal: this.listeners.signal });
    document.addEventListener('keydown', this.onKeyDown, { signal: this.listeners.signal });
    document.addEventListener('keyup', this.onKeyUp, { signal: this.listeners.signal });
  }

  unmount(): void {
    this.listeners.abort();
    this.jumper?.dispose();
    this.jumper = null;
    this.blocks?.dispose();
    this.blocks = null;
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
    const blocks = this.blocks;
    const jumper = this.jumper;
    if (!context || !blocks || !jumper) return;

    const step = Math.min(0.05, Math.max(0, dt));

    // 方块侧的动画（入场 / 回弹 / 淡出 / 波纹）自己走一个钟
    blocks.tick(step);

    // 落地压缩：站直之前先被压一下（100ms 回弹），蓄力时以蓄力为准
    if (this.phase !== 'charging' && this.landSquashMs < JUMP_TIMING.landSquashMs) {
      this.landSquashMs += step * 1000;
      jumper.setSquash(landingSquash(this.landSquashMs));
    }

    if (this.phase === 'charging') {
      this.charge = Math.min(JUMP_CONFIG.maxCharge, this.charge + step);
      const ratio = this.charge / JUMP_CONFIG.maxCharge;
      jumper.setSquash(ratio);
      blocks.setSquash(PILLAR_SQUASH * ratio);
      this.audio?.updateCharge(ratio);
    }

    if (this.phase === 'ready' || this.phase === 'charging') {
      this.tickSpecialHold(step);
      const block = currentBlock(this.run);
      // 站姿：脚底贴方块顶面中心（压扁已在上面按蓄力比例处理，脚底不动）
      this.placeJumper(block.x, standHeight(block), block.z);
    } else if (this.phase === 'jumping') {
      this.elapsed += step;
      const progress = Math.min(1, this.elapsed / this.duration);
      const x = this.jumpFrom.x + (this.jumpTo.x - this.jumpFrom.x) * progress;
      const z = this.jumpFrom.z + (this.jumpTo.z - this.jumpFrom.z) * progress;
      // 弧线：上升 65% Cubic.Out + 下落 35% Cubic.In（规格表 §8）。
      // 两端方块顶面高度可能不同，先线性过渡再叠加弧线。
      const base = this.jumpFromY + (this.jumpToY - this.jumpFromY) * progress;
      const y = base + jumpArc(progress) * this.jumpPeak;
      this.placeJumper(x, y, z);
      jumper.setFlip(-Math.PI * 2 * flipProgress(progress));
      if (progress >= 1) this.land();
    } else if (this.phase === 'falling') {
      this.elapsed += step;
      const y = this.jumpToY - this.elapsed * 7;
      this.placeJumper(this.jumpTo.x, y, this.jumpTo.z);
      // 掉下去时越转越快，翻脸式下坠（原版也是"翻着掉出去"）
      jumper.setFlip(this.elapsed * 8);
      if (this.elapsed >= FALL_SECONDS) this.finish();
    }

    // 掉落与结算期间不再跟随：人已经掉出画面，镜头再追会把方块甩到奇怪的视角
    if (this.phase !== 'falling' && this.phase !== 'over') {
      blocks.follow(step);
    }
    blocks.render(context.renderer);
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
    gap: number;
  } {
    const from = currentBlock(this.run);
    const to = this.run.blocks[this.run.index + 1];
    return {
      phase: this.phase,
      score: this.run.score,
      combo: this.run.combo,
      index: this.run.index,
      best: this.best,
      blocks: this.run.blocks.length,
      // 到下一个方块中心的距离：E2E 靠它算出"该按多久"（只读，不改状态）
      gap: to ? Math.hypot(to.x - from.x, to.z - from.z) : 0,
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
    this.jumpFromY = standHeight(from);
    this.jumpToY = standHeight(to);
    this.jumpPeak = Math.min(2.4, 0.85 + distance * 0.3);
    // 原版一跳固定 400ms，与跳多远无关（旧实现按距离加时长，远跳更慢、手感发飘）
    this.duration = JUMP_TIMING.totalMs / 1000;
    this.yaw = Math.atan2(-(dx / length), -(dz / length));
    this.elapsed = 0;

    this.phase = 'jumping';
    this.charge = 0;
    this.blocks?.setSquash(0);
    this.jumper?.setSquash(0);
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

    this.jumper?.resetPose();

    if (outcome.over) {
      this.phase = 'falling';
      this.elapsed = 0;
      this.audio?.playFall();
      return;
    }

    this.run = outcome.run;
    this.rebuildBlocks();
    // 方块会随分数变小，小人也跟着变小——否则会在小方块上站一个"巨人"
    this.jumper?.setSize(currentBlock(this.run).size);
    this.phase = 'ready';
    this.elapsed = 0;

    this.audio?.playLand(outcome.center);

    const landed = currentBlock(this.run);
    // 被踩的方块凹一下再回弹；完美命中在落点扩三层同心圆 + 头顶飘 +N
    this.blocks?.punch(landed.x, landed.z);
    if (outcome.center) {
      this.blocks?.playRipple(landed.x, landed.z, landed.size);
      this.showFloat(`+${outcome.points}`, landed);
    }
    this.landSquashMs = 0;
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
    const newRecord = score > this.best;
    this.best = Math.max(this.best, score);
    const progress = recordScore(loadProgress(), 'jump', score);
    saveProgress(progress);
    this.options.onScore?.(score);

    this.updateHud();
    this.showOver(score, newRecord);
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

    this.jumper?.resetPose();
    this.jumper?.setSize(currentBlock(this.run).size);
    this.landSquashMs = Number.POSITIVE_INFINITY;
    this.overEl?.classList.add('hidden');
    this.syncPalette();
    this.rebuildBlocks();
    this.blocks?.follow(0);
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
    this.showFloat(`+${bonus}`, block);
    this.updateHud();
  }

  // ---------------------------------------------------------------- 画面

  /** 把小人放到某点（原点是脚底，所以 y 直接就是"脚底高度"） */
  private placeJumper(x: number, y: number, z: number): void {
    const jumper = this.jumper;
    if (!jumper) return;
    jumper.setPosition(x, y, z);
    jumper.setYaw(this.yaw);
  }

  /**
   * `+N` 飘字：贴在方块上方、向上飘并淡出。
   *
   * 用 DOM 而不是 3D 文字：字体、抗锯齿、DPI 缩放全部交给浏览器（3D 文字要么靠贴图、
   * 要么引入字体文件），而且它本来就在 HUD 层里，跟分数同一个坐标系。
   */
  private showFloat(text: string, block: JumpBlock): void {
    const layer = this.context?.layer;
    const blocks = this.blocks;
    if (!layer || !blocks) return;
    const point = blocks.projectToScreen(
      block.x,
      standHeight(block) + block.size * 0.72 * 1.1,
      block.z,
    );
    const element = document.createElement('div');
    element.className = 'jump-float';
    element.textContent = text;
    element.style.left = `${(point.x * 100).toFixed(2)}%`;
    element.style.top = `${(point.y * 100).toFixed(2)}%`;
    layer.appendChild(element);
    // 兜底清理：动画 900ms，万一 transitionend 不触发（标签页切走）也不会留节点
    window.setTimeout(() => element.remove(), 1000);
  }


  /** 换一局的配色：场景与相机都留着，只换色板（比旧版重建整个场景便宜得多） */
  private syncPalette(): void {
    this.blocks?.setPalette(paletteForSeed(this.seed));
  }

  /**
   * 重建这一屏的方块：当前块前后各一块（原版一屏 3~4 块）。
   *
   * 前后各留一块是为了让"刚跳过的"和"下一块"都在画面里——原版也是这么构图的。
   */
  private rebuildBlocks(): void {
    const blocks = this.blocks;
    if (!blocks) return;
    const specs: BlockSpec[] = [];
    const from = Math.max(0, this.run.index - 1);
    const to = Math.min(this.run.blocks.length - 1, this.run.index + 2);
    for (let i = from; i <= to; i++) {
      const block: JumpBlock | undefined = this.run.blocks[i];
      if (!block) continue;
      specs.push({
        x: block.x,
        z: block.z,
        size: block.size,
        kind: block.kind,
        current: i === this.run.index,
        colorIndex: block.id,
      });
    }
    blocks.setBlocks(specs);
  }

  private readonly onResize = (): void => {
    this.blocks?.setViewport(window.innerWidth, window.innerHeight);
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

    hud.append(score, best);
    // 提示单独挂在 stage 上：`.jump-hint` 是绝对定位，挂进 `.jump-hud`（也是 absolute）
    // 会相对它定位，结果跑到左上角与分数叠在一起
    context.layer.append(hud, hint);
    this.hud = hud;

    const over = document.createElement('div');
    over.className = 'jump-over hidden';
    // ⚠️ 宿主在 stage 上 `setPointerCapture`，会把后续 click 也重定向到 stage——
    // 结算面板的按钮就永远收不到 click（实测点"再来一局"毫无反应）。
    // 在面板这一层吞掉指针事件，宿主就不会拿捕获，按钮的 click 才正常。
    const swallow = (event: Event): void => event.stopPropagation();
    over.addEventListener('pointerdown', swallow);
    over.addEventListener('pointerup', swallow);
    over.addEventListener('pointermove', swallow);

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

  private showOver(score: number, newRecord = false): void {
    if (!this.overEl) return;
    if (this.overTitleEl) this.overTitleEl.textContent = tp('minigame.jump.over', { score });
    if (this.overBestEl) {
      this.overBestEl.textContent = newRecord
        ? t('minigame.jump.record')
        : tp('minigame.jump.best', { best: this.best });
    }
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

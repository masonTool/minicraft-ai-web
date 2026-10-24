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
 *  5. **音效静默降级**：WebAudio 代码全在 `audio.ts`，拿不到上下文时全部吞掉，`guard` 必须 0 错误。
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
  type JumpBlockKind,
  type JumpRun,
  type LandingOutcome,
} from './logic.ts';
import { BlockScene, type BlockSpec } from './BlockScene.ts';
import { JumperModel } from './JumperModel.ts';
import { BLOCK_HEIGHT_RATIO } from './iso.ts';
import { JUMP_TIMING, flipProgress, jumpArc, landingSquash, toppleAngle } from './motion.ts';
import { JumpAudio } from './audio.ts';
import { paletteForSeed } from './palette.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer, MiniGameStatus } from '../../types.ts';

type Phase = 'ready' | 'charging' | 'jumping' | 'toppling' | 'falling' | 'over';

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
  /** 分数下方的连击标记（`×N`，断连击即消失） */
  private comboEl: HTMLDivElement | null = null;
  private overEl: HTMLDivElement | null = null;
  private overTitleEl: HTMLDivElement | null = null;
  private overScoreEl: HTMLDivElement | null = null;
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
    this.comboEl = null;
    this.overTitleEl = null;
    this.overScoreEl = null;
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
      this.audio?.updateCharge(ratio, this.charge);
    }

    if (this.phase === 'ready' || this.phase === 'charging') {
      this.tickSpecialHold(step);
      const block = currentBlock(this.run);
      // 站姿：脚底贴**实际落点**（落到哪儿就站哪儿，不再被拉回方块中心）。
      // 压扁已在上面按蓄力比例处理，脚底不动。
      this.placeJumper(this.run.stand.x, standHeight(block), this.run.stand.z);
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
    } else if (this.phase === 'toppling') {
      // 倾覆：380ms 缓入扑到 ~95°，播完才自由落体。方向恒为前进方向（冲过头和没跳够都往前扑）
      this.elapsed += step;
      const ms = this.elapsed * 1000;
      jumper.setTilt(toppleAngle(ms));
      if (ms >= JUMP_TIMING.toppleMs) {
        // 已经扑倒，落地时不必再保留倾角（下坠本身有翻转）
        jumper.setTilt(0);
        this.phase = 'falling';
        this.elapsed = 0;
      }
    } else if (this.phase === 'falling') {
      this.elapsed += step;
      const y = this.jumpToY - this.elapsed * 7;
      this.placeJumper(this.jumpTo.x, y, this.jumpTo.z);
      // 掉下去时越转越快，翻脸式下坠（原版也是"翻着掉出去"）
      jumper.setFlip(this.elapsed * 8);
      if (this.elapsed >= FALL_SECONDS) this.finish();
    }

    // 掉落与结算期间不再跟随：人已经掉出画面，镜头再追会把方块甩到奇怪的视角
    if (this.phase !== 'falling' && this.phase !== 'toppling' && this.phase !== 'over') {
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
    /** 间距 ÷ 边长（E2E 用它验"间距被拉大了"） */
    gapRatio: number;
    /** 站姿离当前方块中心多远（0 = 站在正中；E2E 用它验"落点没有被复位"） */
    standOffset: number;
    /** 这一步沿哪条世界轴前进（原版只有 x / z 两向） */
    axis: 'x' | 'z';
    /** 当前站着的方块种类 */
    kind: JumpBlockKind;
    /** 下一块种类 */
    nextKind: JumpBlockKind;
    /** 相机是不是正交的（透视相机会破坏等距观感，必须能验） */
    orthographic: boolean;
  } {
    const from = currentBlock(this.run);
    const to = this.run.blocks[this.run.index + 1];
    const stand = this.run.stand;
    // 距离要从**站姿**量：落到哪儿就站哪儿，这一跳的实际长度不是方块中心距
    const gap = to ? Math.hypot(to.x - stand.x, to.z - stand.z) : 0;
    // 方向仍按**方块中心**判：等距两向是生成器的设计约束，站偏只是让这一跳略斜
    const centreDx = to ? to.x - from.x : 0;
    const centreDz = to ? to.z - from.z : 0;
    return {
      phase: this.phase,
      score: this.run.score,
      combo: this.run.combo,
      index: this.run.index,
      best: this.best,
      blocks: this.run.blocks.length,
      // 到下一个方块中心的距离：E2E 靠它算出"该按多久"（只读，不改状态）
      gap,
      gapRatio: gap > 0 ? gap / from.size : 0,
      standOffset: Math.hypot(stand.x - from.x, stand.z - from.z),
      axis: Math.abs(centreDx) >= Math.abs(centreDz) ? 'x' : 'z',
      kind: from.kind,
      nextKind: to?.kind ?? 'normal',
      orthographic: this.blocks?.camera.isOrthographicCamera === true,
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
    // 起跳点是**实际站姿**：上一跳站偏了就真的要少跳/多跳那一段
    const stand = this.run.stand;
    const dx = to.x - stand.x;
    const dz = to.z - stand.z;
    const length = Math.hypot(dx, dz) || 1;

    this.pending = jump(this.run, distance);
    this.jumpFrom = { x: stand.x, z: stand.z };
    this.jumpTo = {
      x: stand.x + (dx / length) * distance,
      z: stand.z + (dz / length) * distance,
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
      // 倾倒与坠落都从同一个落点开始，只是先播 380ms 的倾覆（跳9 接上角度曲线）
      this.phase = outcome.kind === 'topple' ? 'toppling' : 'falling';
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

    // 完美命中按连击升调（连击越高越亮），普通落地不变
    this.audio?.playLand(outcome.center, outcome.run.combo);

    const landed = currentBlock(this.run);
    // 被踩的方块凹一下再回弹；完美命中在**落点**扩散同心圆（层数随连击）+ 头顶飘字
    this.blocks?.punch(landed.x, landed.z);
    if (outcome.center) {
      this.blocks?.playRipple(outcome.point.x, outcome.point.z, landed.size, outcome.run.combo);
      // 连中两次起飘 `×N  +P`：只给"连击"一个视觉上的名字，计分规则一个字没动
      const combo = outcome.run.combo;
      this.showFloat(combo >= 2 ? `×${combo}  +${outcome.points}` : `+${outcome.points}`, landed);
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
    this.audio?.playSpecial(block.kind);
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
   * 重建这一屏的方块：**上一块 + 当前 + 下一块**，共 3 块。
   *
   * 只画 3 块是这一轮定的口径：横屏下间距拉到 4.6~6.0 格之后，4 块会挤到看不清，
   * 而多出来的第 4 块（下下块）本来也在画面边缘、被取景压扁，删掉不影响判断。
   */
  private rebuildBlocks(): void {
    const blocks = this.blocks;
    if (!blocks) return;
    const specs: BlockSpec[] = [];
    const from = Math.max(0, this.run.index - 1);
    const to = Math.min(this.run.blocks.length - 1, this.run.index + 1);
    for (let i = from; i <= to; i++) {
      const block: JumpBlock | undefined = this.run.blocks[i];
      if (!block) continue;
      specs.push({
        x: block.x,
        z: block.z,
        size: block.size,
        kind: block.kind,
        shape: block.shape,
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
    // 原版游戏里**只有一个分数**：左上角、深色细体、没有任何别的字。
    // 所以这里不建"最高分"行、也不建底部提示——它们正是"看着不像原版"的来源。
    const hud = document.createElement('div');
    hud.className = 'jump-hud';

    const score = document.createElement('div');
    score.className = 'jump-score';
    this.scoreEl = score;

    // 连击标记：贴在分数下方，只在连中两次以后出现（原版没有这行，是这一轮加的"表现层"）
    const combo = document.createElement('div');
    combo.className = 'jump-combo';
    this.comboEl = combo;

    hud.append(score, combo);
    context.layer.append(hud);
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

    // 原版没有结算页可参照（参考图 09 是排行榜），所以沿用首页的语言：
    // 一行小标签 + 一个很大的数字 + 最高分 + 两颗胶囊按钮。
    const title = document.createElement('div');
    title.className = 'jump-over-title';
    title.textContent = t('minigame.jump.over');
    this.overTitleEl = title;

    const overScore = document.createElement('div');
    overScore.className = 'jump-over-score';
    this.overScoreEl = overScore;

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
    panel.append(title, overScore, overBest, actions);
    over.appendChild(panel);
    context.layer.appendChild(over);
    this.overEl = over;
  }

  private updateHud(): void {
    if (this.scoreEl) this.scoreEl.textContent = String(this.run.score);
    // `×N`：连中两次起显示，落到非中心 / 掉下去就自然消失（combo 已被清零）
    if (this.comboEl) {
      const combo = this.run.combo;
      this.comboEl.textContent = combo >= 2 ? `×${combo}` : '';
      this.comboEl.classList.toggle('on', combo >= 2);
    }
  }

  private showOver(score: number, newRecord = false): void {
    if (!this.overEl) return;
    if (this.overScoreEl) this.overScoreEl.textContent = String(score);
    if (this.overTitleEl) this.overTitleEl.textContent = t('minigame.jump.over');
    if (this.overBestEl) {
      this.overBestEl.textContent = newRecord
        ? t('minigame.jump.record')
        : tp('minigame.jump.best', { best: this.best });
    }
    this.overEl.classList.remove('hidden');
  }
}

// ------------------------------------------------------------------ 小工具

function bestScoreOf(): number {
  return bestScore(loadProgress(), 'jump');
}

/**
 * 试点：把三样**纯展示**的 HUD 画到 canvas 上（`src/ui2d/` 阶段 0）
 *
 * 选这三样是有判据的，不是随手挑的：
 *  - **受伤红闪**（`#damage-flash`）：全屏 `opacity`，每帧都在变，最典型的"合成层开销"；
 *  - **破坏 / 进食进度条**：挖掘时每帧算百分比、每 1% 写一次 `style.width`；
 *  - **Boss 血条**：文字 + 两条渐变，且只在末地/凋灵时出现。
 *
 * 三者共同的三个"没有"：**没有命中测试**（不需要 `input.ts`）、
 * **没有文字排版难题**（一行 12px）、**不依赖混合模式** —— 于是它们能在不动
 * 任何交互逻辑的前提下先落一块真东西，用真机帧率来回答"要不要继续往下搬"。
 *
 * ⚠️ **准星不在这一批**（原本在计划里）。它靠 `mix-blend-mode: difference`
 * 与下层画面做差值混合，那是 **DOM 合成器**的能力：2D canvas 里
 * `globalCompositeOperation = 'difference'` 只在本图层内生效，叠到 WebGL 上
 * 就是一块白十字 —— 在雪地/沙漠这种浅色场景里反而看不见。
 * 要搬它得单独一张 canvas 并保留那条 CSS，成本与收益不成比例（写进
 * `notes/canvas-ui.md` 的"判定不搬"那一节）。
 *
 * 回退：DOM 版本一个字节都没删。`?ui2d=1` 才走这条线（见 `main.ts` 的
 * `UI2D_ENABLED`），关掉参数即恢复原样。
 */

import { Ui2DOverlay } from './overlay.ts';
import { drawText, uiFont } from './text.ts';
import { drawHudPanel, drawProgressBar, type Rect } from './widgets.ts';

export interface BossBarState {
  readonly visible: boolean;
  readonly title: string;
  /** 血量比例 0~1 */
  readonly ratio: number;
  readonly wither: boolean;
  readonly shielded: boolean;
}

export const EMPTY_BOSS_BAR: BossBarState = {
  visible: false,
  title: '',
  ratio: 0,
  wither: false,
  shielded: false,
};

/** Boss 条的几何（与 `index.html` 的 `#boss-bar` 逐项对应） */
export const BOSS_BAR_MAX_WIDTH = 420;
export const BOSS_BAR_WIDTH_RATIO = 0.68;
export const BOSS_BAR_TOP = 10;
export const BOSS_BAR_HEIGHT = 38;
export const BOSS_BAR_PADDING_X = 10;

/** 进度条的几何（`#break-progress` / `#eat-progress`） */
export const PROGRESS_WIDTH = 120;
export const PROGRESS_HEIGHT = 6;
export const PROGRESS_BREAK_BOTTOM = 74;
export const PROGRESS_EAT_BOTTOM = 86;

/** Boss 条宽度：`min(420px, 68vw)`（窄屏按比例，宽屏封顶） */
export function bossBarWidth(viewportWidth: number): number {
  return Math.min(BOSS_BAR_MAX_WIDTH, Math.max(0, viewportWidth) * BOSS_BAR_WIDTH_RATIO);
}

/** 贴底居中的进度条矩形；`bottom` 是**底边到视口底**的距离（与 CSS 的 `bottom` 同义） */
export function progressBarRect(viewportWidth: number, viewportHeight: number, bottom: number): Rect {
  return {
    x: Math.round((viewportWidth - PROGRESS_WIDTH) / 2),
    y: Math.round(viewportHeight - bottom - PROGRESS_HEIGHT),
    w: PROGRESS_WIDTH,
    h: PROGRESS_HEIGHT,
  };
}

/** 红闪精灵图的背板尺寸：够糊出渐变就行，缩放由 `drawImage` 做 */
export const DAMAGE_FLASH_SPRITE_W = 320;
export const DAMAGE_FLASH_SPRITE_H = 180;

let flashSprite: HTMLCanvasElement | null = null;

/**
 * 红闪的三层渐变（与 `#damage-flash` 的 CSS 一一对应）。
 *
 * 为什么预渲染成一张小图：`createRadialGradient` + 两个全屏 radial 每帧重画，
 * 在手机上就是两次全屏填充；预渲染一次之后每帧只剩一次 `drawImage` + `globalAlpha`。
 * 320×180 放大到 1080p 完全看不出块（它是低频渐变）。
 */
export function damageFlashSprite(): HTMLCanvasElement {
  if (flashSprite) return flashSprite;
  const canvas = document.createElement('canvas');
  canvas.width = DAMAGE_FLASH_SPRITE_W;
  canvas.height = DAMAGE_FLASH_SPRITE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const w = DAMAGE_FLASH_SPRITE_W;
  const h = DAMAGE_FLASH_SPRITE_H;
  const cx = w / 2;
  const cy = h / 2;
  const far = Math.hypot(w, h) / 2;

  // ① 整屏淡红底
  ctx.fillStyle = 'rgba(150, 0, 0, .18)';
  ctx.fillRect(0, 0, w, h);
  // ② 边缘重红（中心透明）
  const edge = ctx.createRadialGradient(cx, cy, far * 0.18, cx, cy, far);
  edge.addColorStop(0, 'rgba(255, 40, 40, 0)');
  edge.addColorStop(1, 'rgba(201, 5, 5, .92)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  // ③ 中心那一点点红（让"掉了血"在户外也看得见）
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, far * 0.58);
  core.addColorStop(0, 'rgba(214, 12, 12, .38)');
  core.addColorStop(1, 'rgba(214, 12, 12, 0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, w, h);

  flashSprite = canvas;
  return canvas;
}

/** 三种进度条 / Boss 条的填充配色（与 CSS 的 `linear-gradient` 同向、同色） */
const BREAK_STYLE = { fillTop: '#ffffff', fillBottom: '#c8c8c8', glow: 'rgba(255, 255, 255, .5)' };
const EAT_STYLE = { fillTop: '#ffe9a8', fillBottom: '#e0b552', glow: 'rgba(255, 210, 120, .5)' };
const DRAGON_STYLE = { fillTop: '#f56cf5', fillBottom: '#b02ab0', glow: 'rgba(214, 59, 214, .6)' };
const WITHER_STYLE = { fillTop: '#e0665a', fillBottom: '#7a1a14', glow: 'rgba(214, 80, 60, .6)' };
const SHIELDED_STYLE = { fillTop: '#8fd8ff', fillBottom: '#2f7fbf', glow: 'rgba(120, 200, 255, .7)' };

/**
 * 这三样 HUD 的 canvas 版。
 *
 * 只做"收状态 → 画"这一件事：数值怎么算（掉多少血、剩多少血量）全在 `main.ts`
 * 与 `core/` 里，这里一个 `if` 都不做业务判断 —— 否则同一套规则会有两份。
 */
export class Hud2D {
  private damage = 0;
  private boss: BossBarState = EMPTY_BOSS_BAR;
  private breakRatio: number | null = null;
  private eatRatio: number | null = null;
  /** 上一帧画过东西没有：没画过就不用清屏（静止时这一层开销为 0） */
  private drewLastFrame = false;

  constructor(private readonly overlay: Ui2DOverlay) {}

  /** 红闪强度 0~1（由 `ui/DamageFlash` 算好传进来） */
  setDamageFlash(intensity: number): void {
    const value = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    if (Math.abs(value - this.damage) < 0.004) return;
    this.damage = value;
  }

  setBossBar(state: BossBarState): void {
    this.boss = state;
  }

  /** `null` = 不显示 */
  setBreakProgress(ratio: number | null): void {
    this.breakRatio = ratio === null ? null : Math.min(1, Math.max(0, ratio));
  }

  setEatProgress(ratio: number | null): void {
    this.eatRatio = ratio === null ? null : Math.min(1, Math.max(0, ratio));
  }

  /** 每帧一次（在 `damageFlash.update()` 之后调，红闪的值才是这一帧的） */
  render(): void {
    const overlay = this.overlay;
    overlay.syncSize();
    const ctx = overlay.context;
    // 先清上一帧，再决定这一帧要不要画：清屏只发生在"上一帧真的画了东西"时
    if (this.drewLastFrame) overlay.clear();

    const showDamage = this.damage > 0.004;
    const showBreak = this.breakRatio !== null;
    const showEat = this.eatRatio !== null;
    const showBoss = this.boss.visible;
    if (!showDamage && !showBreak && !showEat && !showBoss) {
      this.drewLastFrame = false;
      return;
    }

    if (showDamage) {
      ctx.save();
      ctx.globalAlpha = this.damage;
      ctx.drawImage(damageFlashSprite(), 0, 0, overlay.width, overlay.height);
      ctx.restore();
    }

    if (showBoss) this.drawBossBar(ctx, overlay.width);
    if (showBreak) {
      drawProgressBar(ctx, progressBarRect(overlay.width, overlay.height, PROGRESS_BREAK_BOTTOM), this.breakRatio!, BREAK_STYLE);
    }
    if (showEat) {
      drawProgressBar(ctx, progressBarRect(overlay.width, overlay.height, PROGRESS_EAT_BOTTOM), this.eatRatio!, EAT_STYLE);
    }

    this.drewLastFrame = true;
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, viewportWidth: number): void {
    const w = bossBarWidth(viewportWidth);
    if (w <= 0) return;
    const x = Math.round((viewportWidth - w) / 2);
    const rect: Rect = { x, y: BOSS_BAR_TOP, w, h: BOSS_BAR_HEIGHT };
    drawHudPanel(ctx, rect, 0);

    drawText(ctx, this.boss.title, x + w / 2, rect.y + 12, {
      font: uiFont(12),
      color: '#ffffff',
      align: 'center',
      baseline: 'middle',
      maxWidth: w - BOSS_BAR_PADDING_X * 2,
    });

    const style = this.boss.shielded ? SHIELDED_STYLE : this.boss.wither ? WITHER_STYLE : DRAGON_STYLE;
    drawProgressBar(
      ctx,
      {
        x: x + BOSS_BAR_PADDING_X,
        y: rect.y + 24,
        w: w - BOSS_BAR_PADDING_X * 2,
        h: 8,
      },
      this.boss.ratio,
      { ...style, radius: 4, track: 'rgba(255, 255, 255, .14)' },
    );
  }

  /** 退出世界：清空状态（画布本身由 `Ui2DOverlay.dispose()` 摘掉） */
  dispose(): void {
    this.damage = 0;
    this.boss = EMPTY_BOSS_BAR;
    this.breakRatio = null;
    this.eatRatio = null;
    this.drewLastFrame = false;
    this.overlay.clear();
  }
}

/** 供调试/断言：当前这一层是否"什么都没画"（静止时应当是 `true`） */
export function hud2dIdle(hud: Hud2D): boolean {
  const value = hud as unknown as { drewLastFrame?: boolean };
  return value.drewLastFrame !== true;
}

/**
 * canvas 界面的统一入口（`src/ui2d/`）
 *
 * 分四块，依赖方向是单向的（越往下越"纯"）：
 *
 *   ```
 *   Hud2D / 未来各面板        ← 组合：收状态、排布局
 *        ↓
 *   widgets（画法） / overlay（画布/DPR）
 *        ↓
 *   text（排版） / input（命中测试）
 *   ```
 *
 * ⚠️ **这一层不许 import `main.ts`**，也不许反向依赖 `ui/` 里的 DOM 组件；
 * 唯一允许的 `ui/` 依赖是 `ui/Device.ts`（DPR 的唯一入口）。
 * 这条约束是"将来整层换后端（WebGL / 原生）"的前提：`Hud2D` 只认
 * `Ui2DOverlay` 暴露的 `context + width/height`，换成别的后端时改一个类即可。
 */

export { Ui2DOverlay, UI2D_DPR_CAP, type Ui2DOverlayOptions } from './overlay.ts';
export {
  Hud2D,
  EMPTY_BOSS_BAR,
  BOSS_BAR_HEIGHT,
  BOSS_BAR_MAX_WIDTH,
  BOSS_BAR_TOP,
  BOSS_BAR_WIDTH_RATIO,
  DAMAGE_FLASH_SPRITE_H,
  DAMAGE_FLASH_SPRITE_W,
  PROGRESS_BREAK_BOTTOM,
  PROGRESS_EAT_BOTTOM,
  PROGRESS_HEIGHT,
  PROGRESS_WIDTH,
  bossBarWidth,
  damageFlashSprite,
  hud2dIdle,
  progressBarRect,
  type BossBarState,
} from './Hud2D.ts';
export {
  ELLIPSIS,
  MEASURE_CACHE_LIMIT,
  TEXT_SHADOW_COLOR,
  UI_FONT_STACK,
  cachedMeasure,
  clearMeasureCache,
  drawText,
  isCjkCodePoint,
  tokenize,
  truncateToWidth,
  uiFont,
  wrapToWidth,
  type DrawTextOptions,
  type Measure,
} from './text.ts';
export { hitRegionAt, Ui2DInput, type HitRegion, type PointerHandler, type PointerHit } from './input.ts';
export {
  PALETTE,
  drawButton,
  drawHudPanel,
  drawProgressBar,
  roundRectPath,
  type ButtonState,
  type ProgressBarStyle,
  type Rect,
} from './widgets.ts';

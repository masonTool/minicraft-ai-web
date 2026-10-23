/**
 * 建造工具条的**几何约束**（创造5，批次 20261022-1954；抽屉形态，批次 20261024-0344）
 *
 * 与 `tutorialLayout.ts` 同一个理由：条目要求"抽屉不出界、不压顶部暂停条、热区 ≥44px"，
 * 而这件事能在离线断言里量出来——把开关尺寸、抽屉尺寸、格子尺寸算成数字，
 * 比截图看一眼可靠（换机型、改字号、改触摸缩放时截图不会替你回归）。
 *
 * 形态（批次 20261024-0344 之后的方案 A）：
 *
 *  1. **折叠态**只有一颗 44×56 的总开关（44 图标 + 9px 两字标签），贴右缘 8px、垂直居中。
 *     它比旧的双列竖排矮得多，所以再也不会压到右下那一簇操作键（含跳跃键）。
 *  2. **展开态**是一块**居中**的抽屉（基准 360×196，4 列 × 2 行），
 *     四周夹进视口 8px，顶边不得高过顶部暂停三键的下沿（`8 + 22 * touchScale`）——
 *     抽屉是模态的，一压住暂停条就等于玩家打不开设置了。
 *  3. **格子的热区下限 44px 是绝对值**，不随 `touchScale` 缩小（平台最小手势尺寸）；
 *     上限 84×68 才跟着 `touchScale` 放大/缩小。
 *
 * ⚠️ 本文件里的 `DRAWER_*` / 内边距 / 头部高度与 `index.html` 的 `.build-drawer` /
 * `.build-cell` 是**同一个口径**（CSS 用变量写死同一组数字），改一处必须改另一处。
 */

import { touchPauseBarRight } from './tutorialLayout.ts';

/** 平台最小手势尺寸（44px 是下限，不随 touchScale 缩小） */
export const BUILD_BUTTON_SIZE = 44;

/** HUD 通用的贴边距离（与 `index.html` 的 8px 一致） */
export const BUILD_EDGE = 8;

/** 顶部暂停键的边长（触摸端 22px × `--touch-scale`，见 `index.html` 的 `#touch-pause`） */
export const PAUSE_BAR_BUTTON_SIZE = 22;

/** 折叠态总开关：44 宽（图标），56 高（44 图标 + 9px 标签行 + 间隙） */
export const BUILD_TOGGLE_WIDTH = 44;
export const BUILD_TOGGLE_HEIGHT = 56;

/** 抽屉基准尺寸（`touchScale = 1` 时）：4 × 84 + 3 × 4 + 2 × 6 = 360；2 × 68 + … = 196 */
export const DRAWER_WIDTH = 360;
export const DRAWER_HEIGHT = 196;

/** 抽屉的网格：4 列 × 2 行（8 个工具；总开关在抽屉外面） */
export const DRAWER_COLUMNS = 4;
export const DRAWER_ROWS = 2;

/** 格子上限（`touchScale = 1`）：84×68 放得下 26px 图标 + 两字标签 + 一句短语 */
export const DRAWER_CELL_WIDTH = 84;
export const DRAWER_CELL_HEIGHT = 68;

/** 抽屉内边距 / 头部高度 / 格子间隙（`touchScale = 1`） */
const DRAWER_PADDING = 6;
const DRAWER_HEADER = 40;
const DRAWER_GAP = 4;

export interface BuildBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface BuildCellSize {
  readonly width: number;
  readonly height: number;
}

function sanitizeSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sanitizeScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `touchScale` 下的抽屉内尺寸（内边距 / 头部 / 间隙 / 格子上限） */
function drawerMetrics(scale: number): {
  readonly padding: number;
  readonly header: number;
  readonly gap: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
} {
  const s = sanitizeScale(scale);
  return {
    padding: Math.round(DRAWER_PADDING * s),
    header: Math.round(DRAWER_HEADER * s),
    gap: Math.round(DRAWER_GAP * s),
    cellWidth: Math.round(DRAWER_CELL_WIDTH * s),
    cellHeight: Math.round(DRAWER_CELL_HEIGHT * s),
  };
}

/** 抽屉在 `touchScale` 下的基准宽高（格子不压缩时该占多大） */
export function buildDrawerSize(scale = 1): { readonly width: number; readonly height: number } {
  const m = drawerMetrics(scale);
  return {
    width: m.padding * 2 + DRAWER_COLUMNS * m.cellWidth + (DRAWER_COLUMNS - 1) * m.gap,
    height:
      m.padding * 2 +
      m.header +
      m.gap +
      DRAWER_ROWS * m.cellHeight +
      (DRAWER_ROWS - 1) * m.gap,
  };
}

/** 顶部暂停三键的下沿（抽屉顶边不能高过这条线） */
export function pauseBarBottom(scale = 1): number {
  return BUILD_EDGE + Math.round(PAUSE_BAR_BUTTON_SIZE * sanitizeScale(scale));
}

/** 视口 → 折叠态总开关的盒子（贴右缘 8px、垂直居中） */
export function buildToggleBox(viewportWidth: number, viewportHeight: number): BuildBox {
  const width = sanitizeSize(viewportWidth);
  const height = sanitizeSize(viewportHeight);
  const right = Math.max(0, width - BUILD_EDGE);
  const left = Math.max(0, right - BUILD_TOGGLE_WIDTH);
  const top = clamp(
    Math.round((height - BUILD_TOGGLE_HEIGHT) / 2),
    0,
    Math.max(0, height - BUILD_TOGGLE_HEIGHT),
  );
  return {
    left,
    right,
    top,
    bottom: top + BUILD_TOGGLE_HEIGHT,
    width: BUILD_TOGGLE_WIDTH,
    height: BUILD_TOGGLE_HEIGHT,
  };
}

/**
 * 视口 → 抽屉占据的盒子（水平 + 垂直居中，四周夹进视口 8px，顶边不低于暂停条下沿）。
 *
 * 装不下时盒子会被**压小**（而不是越界）：压小之后格子还够不够 44px，
 * 由 `drawerFits()` 回答，`BuildToolbar` 据此决定要不要让网格内部滚动。
 */
export function buildDrawerBox(
  viewportWidth: number,
  viewportHeight: number,
  scale = 1,
): BuildBox {
  const width = sanitizeSize(viewportWidth);
  const height = sanitizeSize(viewportHeight);
  const base = buildDrawerSize(scale);
  const safeTop = pauseBarBottom(scale);

  const maxWidth = Math.max(0, width - 2 * BUILD_EDGE);
  const maxHeight = Math.max(0, height - safeTop - BUILD_EDGE);
  const boxWidth = Math.min(base.width, maxWidth);
  const boxHeight = Math.min(base.height, maxHeight);

  // 居中优先，但顶边必须让开暂停条：Math.ceil 保证不会因为取整漏出 0.4px 压上去
  const left = clamp(Math.round((width - boxWidth) / 2), 0, Math.max(0, width - boxWidth));
  const top = clamp(
    Math.max(Math.round((height - boxHeight) / 2), Math.ceil(safeTop)),
    0,
    Math.max(0, height - boxHeight),
  );
  return {
    left,
    right: left + boxWidth,
    top,
    bottom: top + boxHeight,
    width: boxWidth,
    height: boxHeight,
  };
}

/**
 * 抽屉里的格子尺寸：上限随 `touchScale` 走、下限恒为 44px，按抽屉可用宽高等比收缩。
 *
 * 抽屉被压小时才会真的缩到上限以下；缩到 44 还装不下就返回 44（下限语义），
 * 此时 `drawerFits()` 会给出 false。
 */
export function buildCellSize(
  viewportWidth: number,
  viewportHeight: number,
  scale = 1,
): BuildCellSize {
  const s = sanitizeScale(scale);
  const m = drawerMetrics(s);
  const box = buildDrawerBox(viewportWidth, viewportHeight, s);
  const innerWidth = Math.max(
    0,
    box.width - m.padding * 2 - (DRAWER_COLUMNS - 1) * m.gap,
  );
  const innerHeight = Math.max(
    0,
    box.height - m.padding * 2 - m.header - m.gap - (DRAWER_ROWS - 1) * m.gap,
  );
  return {
    width: Math.min(m.cellWidth, Math.max(BUILD_BUTTON_SIZE, Math.floor(innerWidth / DRAWER_COLUMNS))),
    height: Math.min(m.cellHeight, Math.max(BUILD_BUTTON_SIZE, Math.floor(innerHeight / DRAWER_ROWS))),
  };
}

/**
 * 视口能不能完整装下抽屉（基准尺寸不打折、格子热区 ≥44px）。
 *
 * false 时的处置**不再是"保持折叠"**（抽屉形态下没有可折叠的展开列），
 * 而是由 `BuildToolbar` 给网格加滚动——面板仍然能打开，只是要滑一下。
 */
export function drawerFits(viewportWidth: number, viewportHeight: number, scale = 1): boolean {
  const s = sanitizeScale(scale);
  const base = buildDrawerSize(s);
  const box = buildDrawerBox(viewportWidth, viewportHeight, s);
  const cell = buildCellSize(viewportWidth, viewportHeight, s);
  return (
    box.width >= base.width &&
    box.height >= base.height &&
    cell.width >= BUILD_BUTTON_SIZE &&
    cell.height >= BUILD_BUTTON_SIZE
  );
}

/**
 * 折叠态总开关会不会压到顶部暂停三键（横向）。
 *
 * 开关贴在右缘、暂停条在正中，横屏下永远分开；留着这个函数是因为
 * "按钮挪了位置"最容易在这里出问题，量一下比看一眼可靠。
 */
export function toggleOverlapsPauseBar(box: BuildBox, viewportWidth: number): boolean {
  return box.left < touchPauseBarRight(viewportWidth) + BUILD_EDGE;
}

/**
 * 建造工具条的**几何约束**（创造5，批次 20261022-1954）
 *
 * 与 `tutorialLayout.ts` 同一个理由：条目要求"844×390 下按钮不重叠、热区 ≥44px"，
 * 而这件事能在离线断言里量出来——把按钮尺寸、行列数、右边界算成数字，
 * 比截图看一眼可靠（换机型、改字号时截图不会替你回归）。
 *
 * 布局：右侧双列竖排，9 个按钮 = 5 行（最后一行只有一个）。
 * 折叠时只剩总开关（1 列 1 行），由 CSS 处理，不影响这里的满展开尺寸。
 */

import { touchPauseBarRight } from './tutorialLayout.ts';

/** 平台最小手势尺寸（44px 是下限，不是"大概这么大"） */
export const BUILD_BUTTON_SIZE = 44;
export const BUILD_BUTTON_GAP = 4;
export const BUILD_COLUMNS = 2;
/** 9 个按钮（开关 + 8 个工具）排成 5 行 */
export const BUILD_ROWS = 5;
/** 离屏幕右缘的距离 */
export const BUILD_TOOLBAR_EDGE = 8;

export interface BuildToolbarBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** 满展开时的宽高（不随视口变） */
export function buildToolbarSize(): { readonly width: number; readonly height: number } {
  return {
    width: BUILD_COLUMNS * BUILD_BUTTON_SIZE + (BUILD_COLUMNS - 1) * BUILD_BUTTON_GAP,
    height: BUILD_ROWS * BUILD_BUTTON_SIZE + (BUILD_ROWS - 1) * BUILD_BUTTON_GAP,
  };
}

/** 视口 → 工具条占据的盒子（垂直居中、贴右缘） */
export function buildToolbarBox(viewportWidth: number, viewportHeight: number): BuildToolbarBox {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, Math.floor(viewportHeight)) : 0;
  const size = buildToolbarSize();
  const right = Math.max(0, width - BUILD_TOOLBAR_EDGE);
  const left = Math.max(0, right - size.width);
  const top = Math.max(0, Math.round((height - size.height) / 2));
  return { left, right, top, bottom: top + size.height, width: size.width, height: size.height };
}

/**
 * 视口能不能装下满展开的工具条（上下各留 8px）。
 *
 * 装不下时主程序应该保持折叠态——比"按钮被屏幕切掉一半"好：
 * 折叠后只剩一个开关，玩家仍然能进建造模式。
 */
export function buildToolbarFits(viewportHeight: number): boolean {
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return buildToolbarSize().height <= height - 2 * BUILD_TOOLBAR_EDGE;
}

/** 工具条会不会压到屏幕正中的顶部暂停三键 */
export function buildToolbarOverlapsPauseBar(box: BuildToolbarBox, viewportWidth: number): boolean {
  return box.left < touchPauseBarRight(viewportWidth) + BUILD_TOOLBAR_EDGE;
}

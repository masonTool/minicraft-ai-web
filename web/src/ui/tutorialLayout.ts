/**
 * 新手引导卡的**几何约束**（批次 20261022-1954 · 引导2）
 *
 * 为什么要单独一个纯函数文件：条目要求"844×390 横屏下不遮挡摇杆/快捷栏/暂停条"，
 * 而这件事**能在离线断言里量出来**——把"卡片最多多宽、左边界落在哪"算成数字，
 * 比"截图看一眼觉得没挡"可靠（换机型、换字号时截图不会替你回归）。
 *
 * 三块必须避让的 HUD（尺寸来自 index.html，改那边要回来改这里）：
 *
 *  1. **顶部暂停三键**在屏幕正中：3 × 22px + 2 × 8px 间隙 = 82px 宽（触摸端）；
 *  2. **快捷栏**在底部居中（小屏 44px 槽位 + 12px 底距）；
 *  3. **右上角**本来就有一列（调试信息 / 状态效果 / 记分板），卡片是**那一列的成员**
 *     （挂在 `#hud-right` 里由 flex 排列），所以这里只算"横向别压到中间那颗键"。
 *
 * ⚠️ CSS 里的 `max-width: min(38vw, 320px)` 与本文件的 0.38 / 320 **是同一个口径**，
 * 改一处必须改另一处（断言只盯这里，CSS 改了它不知道）。
 */

/** 卡片的最大宽度（桌面/大屏上限） */
export const TUTORIAL_CARD_MAX_WIDTH = 320;

/** 视口宽度的占比上限（640×360 这种窄横屏下靠它让开暂停键） */
export const TUTORIAL_CARD_WIDTH_RATIO = 0.38;

/** 卡片离屏幕右/上边缘的距离（与 `#hud-right` 的 8px 一致） */
export const TUTORIAL_CARD_EDGE = 8;

/** 触摸端顶部三键的总宽：3 颗 22px + 2 个 8px 间隙 */
export const TOUCH_PAUSE_BAR_WIDTH = 3 * 22 + 2 * 8;

/** 卡片高度上限（标题 + 两行说明；横屏矮屏靠 CSS 截断说明来守住） */
export const TUTORIAL_CARD_MAX_HEIGHT = 132;

/** 底部快捷栏 + 底距的保守高度（卡片顶端到底部要留出这么多） */
export const HOTBAR_RESERVED_HEIGHT = 96;

export interface TutorialCardBox {
  /** 卡片左边界（px，从视口左侧算） */
  readonly left: number;
  /** 卡片右边界（贴右边缘） */
  readonly right: number;
  /** 卡片顶边 */
  readonly top: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** 视口 → 卡片允许占据的盒子（纯函数：宽度会随视口缩小） */
export function tutorialCardBox(viewportWidth: number, viewportHeight: number): TutorialCardBox {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, Math.floor(viewportHeight)) : 0;
  // 三道上限取最小：绝对上限、视口占比、以及"让开顶部暂停三键"之后的可用宽度。
  // 第三道是关键：430 竖屏下 38vw 仍有 163px，但暂停键右侧只剩 158px，
  // 只用占比会在窄竖屏上压到中间那颗键（CSS 里对应的那条是 `calc(50vw - 57px)`）。
  const available = width - touchPauseBarRight(width) - 2 * TUTORIAL_CARD_EDGE;
  const maxWidth = Math.max(
    0,
    Math.min(
      TUTORIAL_CARD_MAX_WIDTH,
      Math.floor(width * TUTORIAL_CARD_WIDTH_RATIO),
      Math.floor(available),
      width - 2 * TUTORIAL_CARD_EDGE,
    ),
  );
  // 视口退化到 0 宽时不要把边界算成负数（验收脚本会拿 0×0 试一遍）
  const right = Math.max(0, width - TUTORIAL_CARD_EDGE);
  return {
    left: right - maxWidth,
    right,
    top: TUTORIAL_CARD_EDGE,
    maxWidth,
    // 减掉顶端那 8px：这样"卡片底边"正好落在快捷栏预留区之上
    maxHeight: Math.max(0, Math.min(TUTORIAL_CARD_MAX_HEIGHT, height - HOTBAR_RESERVED_HEIGHT - TUTORIAL_CARD_EDGE)),
  };
}

/** 顶部暂停三键的右边界（卡片左边界必须在这条线右边） */
export function touchPauseBarRight(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  return width / 2 + TOUCH_PAUSE_BAR_WIDTH / 2;
}

/**
 * 卡片会不会压到顶部暂停三键。
 *
 * 留 `TUTORIAL_CARD_EDGE` 的间隙：贴着不重叠在视觉上仍然像"粘在一起"。
 */
export function overlapsTouchPauseBar(box: TutorialCardBox, viewportWidth: number): boolean {
  return box.left < touchPauseBarRight(viewportWidth) + TUTORIAL_CARD_EDGE;
}

/** 卡片会不会压到底部快捷栏 */
export function overlapsHotbar(box: TutorialCardBox, viewportHeight: number): boolean {
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return box.top + box.maxHeight > height - HOTBAR_RESERVED_HEIGHT;
}

/**
 * 视口是不是"矮横屏"（引导卡要收掉说明的第二行、字号再小一档）。
 *
 * 390 是常见横屏高度（844×390）留出来的余量：420 以下都算矮。
 */
export function isShortViewport(viewportHeight: number): boolean {
  return Number.isFinite(viewportHeight) && viewportHeight < 420;
}

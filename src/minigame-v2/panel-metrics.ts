/**
 * 面板尺寸常量 —— **背包与容器共用一份**。
 *
 * ⚠️ 这些数字原来各写一份：背包面板 670 宽、容器面板 460 宽，同一台机器上
 * 打开箱子/熔炉时面板会**突然缩窄一圈**，看起来像换了个界面（用户反馈过
 * "窗口要固定大小，点击闪来闪去"）。抽出来之后两边取同一批数，
 * 容器面板只是"内容少一点"，壳子不会变。
 *
 * 也别把这里改成"按内容自适应" —— 三个页签 + 两种容器共 5 种情况，
 * 一旦按内容算，切换时面板就会跳。
 */

/** 设计稿宽（UI 层固定按 1024 宽算，高度随屏幕比） */
export const DESIGN_WIDTH = 1024;

/** 格子边长（背包、容器、dock 都用这一档） */
export const SLOT_SIZE = 44;

/** 格子间距 */
export const SLOT_GAP = 2;

/** 9 列网格的宽度 */
export const GRID_W = 9 * SLOT_SIZE + 8 * SLOT_GAP;

/** 左右竖向轨道宽（背包有、容器没有，但**宽度照留**，否则面板会缩） */
export const RAIL_W = 40;

/** 轨道离面板内边的余量 */
export const RAIL_INSET = 3;

/** 面板左右内边距 */
export const PANEL_PAD = 12;

/** 顶栏高度（标题 + 关闭键那一行） */
export const HEADER_H = 24;

/** 内容区上下留白 */
export const BODY_PAD = 8;

/** 底部 dock 高度（面板不能盖住它） */
export const DOCK_H = 48;

/** 主背包 3 行的高度 */
export const BODY_H = 3 * SLOT_SIZE + 2 * SLOT_GAP;

/** 合成列宽度（2×2 + 箭头 + 产物） */
const CRAFT_SLOT = Math.round(SLOT_SIZE * 0.86);
const CRAFT_BLOCK_W = 2 * CRAFT_SLOT + 2 + 22 + CRAFT_SLOT;

/** 内容区宽度：恒按"27 格 + 合成列"这一档（容器的内容更少，但壳子一样宽） */
export const CONTENT_W = GRID_W + 16 + CRAFT_BLOCK_W;

/**
 * 面板宽度 —— **与显示什么无关**，恒为这一档。
 *
 * 670px（1024 宽设计稿下）。
 */
export const PANEL_W = Math.min(DESIGN_WIDTH - 16, CONTENT_W + RAIL_W * 2 + PANEL_PAD * 2);

/** 左轨 5 颗分类 + 1 颗物品栏需要的高度 */
const RAIL_NEED = 6 * 36 + 5 * 2 + 16;

/** 内容区最高那一档需要的高度（创造页多一条工具条 + 一条分页） */
const GRID_NEED = HEADER_H + BODY_PAD * 2 + BODY_H + 28 + 28 + 30;

/**
 * 面板高度 —— 按"最高那一档"算死。
 *
 * @param uiHeight 设计稿高度（`ui.height`，1024×390/844 下约 473）
 * @param needH    调用方要求的最小高度（容器界面要塞 3 行箱子 + 3 行背包，
 *                 比背包面板高；传 0 = 只要背包那一档）
 */
export function panelHeight(uiHeight: number, needH = 0): number {
  return Math.min(uiHeight - DOCK_H - 20, Math.max(RAIL_NEED, GRID_NEED, needH));
}

/**
 * 容器面板需要的高度 —— **箱子与熔炉共用同一档**（都按 3 行算）。
 *
 * ⚠️ 要是"按各自行数算"，箱子 358 / 熔炉 266，玩家在箱子和熔炉之间切一次
 * 面板就跳一次 —— 那正是用户说的"闪"。多出来的空间熔炉留白就好。
 */
export const CONTAINER_PANEL_NEED =
  HEADER_H + BODY_PAD + BODY_H + 26 + BODY_H + 34;

/** 面板左下角（居中后再给 dock 让位） */
export function panelOrigin(
  uiHeight: number,
  needH = 0,
): { x: number; y: number; w: number; h: number } {
  const h = panelHeight(uiHeight, needH);
  return {
    x: (DESIGN_WIDTH - PANEL_W) / 2,
    y: Math.max(6, (uiHeight - DOCK_H - h) / 2),
    w: PANEL_W,
    h,
  };
}

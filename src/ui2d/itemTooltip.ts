/**
 * 物品提示框（自绘背包的 tooltip）
 *
 * 镜像方案里 tooltip 仍是 DOM（`#item-tooltip`，z-index 60）—— 一旦背包改成自绘并接管指针，
 * DOM 的 hover 就再也收不到事件，提示框会彻底消失。所以替换之前必须先把这块画出来。
 *
 * 观感照抄 `index.html` 的 `#item-tooltip`：近黑紫底 `#100010f2`、2px 紫边 `#2d0a63`、
 * 左侧一条稀有度色条、白字 + 阴影。位置逻辑单独抽成纯函数 `itemTooltipRect`（离线可断言）。
 */

import { drawText, uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 提示框内容（由调用方从 `ItemStack` 生成：名字、说明行、耐久） */
export interface TooltipModel {
  readonly title: string;
  readonly lines?: readonly string[];
  /** 耐久条（工具/盔甲才有） */
  readonly durability?: { readonly ratio: number; readonly level: 'high' | 'mid' | 'low' } | null;
  /** 左侧色条（稀有度；缺省用普通色） */
  readonly accent?: string;
}

/** 色板（照抄 `#item-tooltip` 与 `--rarity-*`） */
export const TOOLTIP_SKIN = {
  bg: '#100010f2',
  border: '#2d0a63',
  accentDefault: '#8f8f8f',
  title: '#ffffff',
  line: '#d8d8d8',
  durability: {
    high: '#5ad45a',
    mid: '#d4d45a',
    low: '#d45a5a',
  },
  padding: 9,
  titleSize: 13,
  lineSize: 11,
  lineGap: 3,
  /** 指针与框之间的距离（免得框压住手指） */
  offset: 14,
  width: 150,
} as const;

/**
 * 提示框该放在哪（纯几何）。
 *
 * 规则：默认在指针**右下方**；右边放不下就翻到左边，下边放不下就翻到上边；
 * 最后统一夹进视口。这套"就近翻转"与 DOM 版的位置算法一致。
 */
export function itemTooltipRect(
  pointer: { readonly x: number; readonly y: number },
  size: { readonly w: number; readonly h: number },
  viewport: { readonly w: number; readonly h: number },
): Rect {
  const offset = TOOLTIP_SKIN.offset;
  let x = pointer.x + offset;
  let y = pointer.y + offset;
  if (x + size.w > viewport.w) x = pointer.x - offset - size.w;
  if (y + size.h > viewport.h) y = pointer.y - offset - size.h;
  x = Math.max(2, Math.min(viewport.w - size.w - 2, x));
  y = Math.max(2, Math.min(viewport.h - size.h - 2, y));
  return { x, y, w: size.w, h: size.h };
}

/** 画提示框（尺寸按内容算，位置交给 `itemTooltipRect`） */
export function drawItemTooltip(
  ctx: CanvasRenderingContext2D,
  model: TooltipModel,
  pointer: { readonly x: number; readonly y: number },
  viewport: { readonly w: number; readonly h: number },
): void {
  const lines = model.lines ?? [];
  const hasDurability = model.durability !== undefined && model.durability !== null;
  const height =
    TOOLTIP_SKIN.padding * 2 +
    TOOLTIP_SKIN.titleSize +
    4 +
    lines.length * (TOOLTIP_SKIN.lineSize + TOOLTIP_SKIN.lineGap) +
    (hasDurability ? 8 : 0);
  const width = TOOLTIP_SKIN.width;
  const rect = itemTooltipRect(pointer, { w: width, h: height }, viewport);

  ctx.save();
  roundRectPath(ctx, rect, 0);
  ctx.fillStyle = TOOLTIP_SKIN.bg;
  ctx.fill();
  ctx.strokeStyle = TOOLTIP_SKIN.border;
  ctx.lineWidth = 2;
  roundRectPath(ctx, { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 }, 0);
  ctx.stroke();
  // 左侧稀有度色条
  ctx.fillStyle = model.accent ?? TOOLTIP_SKIN.accentDefault;
  ctx.fillRect(rect.x + 2, rect.y + 2, 4, rect.h - 4);

  let textY = rect.y + TOOLTIP_SKIN.padding + TOOLTIP_SKIN.titleSize / 2;
  drawText(ctx, model.title, rect.x + TOOLTIP_SKIN.padding + 4, textY, {
    font: uiFont(TOOLTIP_SKIN.titleSize, 700),
    color: TOOLTIP_SKIN.title,
    baseline: 'middle',
    shadow: true,
    maxWidth: rect.w - TOOLTIP_SKIN.padding * 2 - 4,
  });
  textY += TOOLTIP_SKIN.titleSize / 2 + 4;

  for (const line of lines) {
    textY += TOOLTIP_SKIN.lineSize / 2;
    drawText(ctx, line, rect.x + TOOLTIP_SKIN.padding + 4, textY, {
      font: uiFont(TOOLTIP_SKIN.lineSize),
      color: TOOLTIP_SKIN.line,
      baseline: 'middle',
      shadow: true,
      maxWidth: rect.w - TOOLTIP_SKIN.padding * 2 - 4,
    });
    textY += TOOLTIP_SKIN.lineSize / 2 + TOOLTIP_SKIN.lineGap;
  }

  if (model.durability) {
    const barW = rect.w - TOOLTIP_SKIN.padding * 2 - 4;
    const barH = 4;
    const barY = rect.y + rect.h - TOOLTIP_SKIN.padding - barH;
    ctx.fillStyle = 'rgba(0, 0, 0, .55)';
    ctx.fillRect(rect.x + TOOLTIP_SKIN.padding + 4, barY, barW, barH);
    ctx.fillStyle = TOOLTIP_SKIN.durability[model.durability.level];
    ctx.fillRect(
      rect.x + TOOLTIP_SKIN.padding + 4,
      barY,
      Math.max(0, Math.min(1, model.durability.ratio)) * barW,
      barH,
    );
  }
  ctx.restore();
}

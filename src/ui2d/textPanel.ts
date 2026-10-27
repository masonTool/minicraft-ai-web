/**
 * **纯文字面板**的 canvas 版（`src/ui2d/` 阶段 4 的第一块）
 *
 * 适用对象：F3 调试信息（`#debug`）、计分板侧边栏（`#scoreboard-hud`）这类
 * "一块背景 + 若干行字"的 HUD。它们没有控件、没有命中测试，唯一的内容就是文字。
 *
 * 做法与前面几块一致：**DOM 是真源**。这里不重新排一遍版，而是把 DOM 里
 * **直接带文字的元素**（叶子节点）读成"一段文字 + 它的矩形 + 颜色字号"，
 * 再按原位画到 canvas 上。
 *
 * 三条理由：
 *  1. F3 那串文案是**拼出来的多行字符串**（帧率、区块数、坐标…），重排一遍等于把
 *     格式逻辑抄两份；
 *  2. 计分板是"名字左、分数右"的 flex 行，对齐规则在 CSS 里，抄一遍就会漂；
 *  3. 颜色/字号也读计算样式 —— 夜里、低血量、触摸端断点各有不同，抄不得。
 *
 * ⚠️ 代价：`readTextRuns` 要 `getComputedStyle`，**只在签名变化时读**（F3 每帧都变，
 * 但它只有 1~5 个叶子节点，一帧几次 `getComputedStyle` 是可接受的；计分板几乎不变）。
 */

import { drawText, uiFont } from './text.ts';
import { roundRectPath, type Rect } from './widgets.ts';

/** 一段文字：原位、原色、原字号 */
export interface TextRun {
  readonly rect: Rect;
  readonly text: string;
  readonly color: string;
  readonly fontSize: number;
  readonly weight: 400 | 600 | 700;
  readonly align: 'left' | 'center' | 'right';
  readonly shadow: boolean;
  /** 不透明度（占位提示用 0.55；其余默认 1） */
  readonly alpha?: number;
}

/** 渐变底的近似色（见 `hasBackground` 的注释） */
export const HUD_GRADIENT_FALLBACK = 'rgba(16, 17, 21, .66)';

/** 一块带底色的区域（F3 的 `rgba(0,0,0,.35)`、计分板的 `.45` 都是它） */
export interface TextBlock {
  readonly rect: Rect;
  readonly color: string;
  readonly radius: number;
  /** 边框（宽度 0 表示没有；MC 风格的按钮靠它出"凸起"感） */
  readonly borderWidth: number;
  readonly borderColor: string;
}

/** 元素是否有可见底色（`transparent` / alpha=0 的跳过） */
/** 元素自身的可画外观：底色（渐变退化）+ 圆角 + 边框；都没有就返回 `null` */
function readSurface(
  el: Element,
): { color: string; radius: number; borderWidth: number; borderColor: string } | null {
  const style = window.getComputedStyle(el);
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
  const borderWidth = Number.parseFloat(style.borderTopWidth) || 0;
  const borderColor = style.borderTopColor || 'transparent';
  // 只画同宽的边（MC 的按钮四边等宽；只画上边那种"下划线"交给文字本身）
  const hasBorder = borderWidth > 0 && borderColor !== 'transparent' && borderColor !== 'rgba(0, 0, 0, 0)';
  const color = style.backgroundColor;
  if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
    return { color, radius, borderWidth: hasBorder ? borderWidth : 0, borderColor };
  }
  /*
   * 渐变底（`background: var(--hud-bg)` 那类，状态效果的胶囊就是一例）在
   * `backgroundColor` 上是透明的，只能退化成一块半透明深色 —— **这是刻意的近似**：
   * 用 `createLinearGradient` 复刻一条 CSS 渐变，收益只有"上下差 2% 的亮度"，
   * 却要解析整串 `linear-gradient(...)`。
   */
  if (style.backgroundImage && style.backgroundImage !== 'none') {
    return { color: HUD_GRADIENT_FALLBACK, radius, borderWidth: hasBorder ? borderWidth : 0, borderColor };
  }
  // 只有边框（"描边按钮"）：底色透明，但边框要画出来
  if (hasBorder) return { color: 'transparent', radius, borderWidth, borderColor };
  return null;
}

/** 读出范围内的所有"底色块"（原位、原色、原圆角） */
export function readTextBlocks(
  root: HTMLElement,
  origin: DOMRect,
  view: { readonly w: number; readonly h: number },
): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const background = readSurface(el);
    if (!background) continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const rect: Rect = { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height };
    if (rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > view.w || rect.y > view.h) continue;
    blocks.push({
      rect,
      color: background.color,
      radius: background.radius,
      borderWidth: background.borderWidth,
      borderColor: background.borderColor,
    });
  }
  return blocks;
}

/** 画底色块（先块后字，与 DOM 的层叠一致） */
export function drawTextBlocks(ctx: CanvasRenderingContext2D, blocks: readonly TextBlock[]): void {
  for (const block of blocks) {
    ctx.save();
    if (block.color !== 'transparent') {
      roundRectPath(ctx, block.rect, block.radius);
      ctx.fillStyle = block.color;
      ctx.fill();
    }
    if (block.borderWidth > 0) {
      // 描边画在内侧半像素上：与 CSS 的 border-box 对齐（否则整块会胖 1px）
      const inset = block.borderWidth / 2;
      roundRectPath(
        ctx,
        {
          x: block.rect.x + inset,
          y: block.rect.y + inset,
          w: Math.max(0, block.rect.w - block.borderWidth),
          h: Math.max(0, block.rect.h - block.borderWidth),
        },
        Math.max(0, block.radius - inset),
      );
      ctx.strokeStyle = block.borderColor;
      ctx.lineWidth = block.borderWidth;
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 把 CSS 的 `font-weight` 归一到我们支持的档位（`uiFont` 只认 400/600/700） */
export function normalizeWeight(value: string | number): 400 | 600 | 700 {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 400;
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  return 400;
}

/** 文字行的基线（竖直居中；`drawText` 用 `baseline: 'middle'` 时就是这个点） */
export function runBaselineY(rect: Rect): number {
  return rect.y + rect.h / 2;
}

/** 签名：文本 / 位置 / 颜色 / 字号任一变化就要重读（F3 每帧都会变，本来就该重画） */
export function textRunsSignature(runs: readonly TextRun[]): string {
  return runs
    .map(
      (run) =>
        `${Math.round(run.rect.x)},${Math.round(run.rect.y)},${Math.round(run.rect.w)}|${run.fontSize}${
          run.weight
        }|${run.color}|${run.align}|${run.alpha ?? 1}|${run.text}`,
    )
    .join('\n');
}

/**
 * 输入框当前该显示什么文字。
 *
 * `<input>` / `<textarea>` 的**值不在 `textContent` 里** —— 这就是"整页镜像"最初
 * 不敢碰新建世界表单的原因。这里补上：值为空时用 `placeholder` 并降低不透明度
 * （CSS 的 `::placeholder` 读不到，用 0.55 近似）。
 */
export function inputDisplayText(value: string, placeholder: string): { text: string; isPlaceholder: boolean } {
  if (value.length > 0) return { text: value, isPlaceholder: false };
  if (placeholder.length > 0) return { text: placeholder, isPlaceholder: true };
  return { text: '', isPlaceholder: false };
}

/** 元素是不是要单独取值的输入框（密码/隐藏框不画） */
export function textFieldValue(el: Element): { value: string; placeholder: string } | null {
  if (el instanceof HTMLInputElement) {
    // 只画"看得到字"的类型；`type=hidden` 本来就没有尺寸，密码框不该被镜像出来
    if (el.type !== 'text' && el.type !== 'search' && el.type !== 'number') return null;
    return { value: el.value, placeholder: el.placeholder ?? '' };
  }
  if (el instanceof HTMLTextAreaElement) {
    return { value: el.value, placeholder: el.placeholder ?? '' };
  }
  return null;
}

/** 元素自己是否直接带文字（不是靠子元素拼出来的） */
function hasOwnText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0) return true;
  }
  return false;
}

/**
 * 从一段 DOM 里读出所有"直接带文字"的元素。
 *
 * @param root 读取范围（例如 `#debug` 本身、或 `#scoreboard-hud`）
 * @param origin 覆盖层画布的视口矩形（把绝对坐标换成相对坐标）
 * @param view 视口尺寸（用于剔掉完全在屏幕外的行）
 */
export function readTextRuns(
  root: HTMLElement,
  origin: DOMRect,
  view: { readonly w: number; readonly h: number },
): TextRun[] {
  const runs: TextRun[] = [];
  const nodes: Element[] = [root, ...root.querySelectorAll('*')];
  for (const el of nodes) {
    const field = textFieldValue(el);
    const own = hasOwnText(el);
    if (!field && !own) continue;
    const shown = field ? inputDisplayText(field.value, field.placeholder) : null;
    const text = shown ? shown.text : (el.textContent ?? '').trim();
    if (text.length === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const rect: Rect = { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height };
    // 完全在视口外就不画（否则会多出几十次 fillText）
    if (rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > view.w || rect.y > view.h) continue;
    const style = window.getComputedStyle(el);
    const align = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left';
    /*
     * 能画字的是**内容盒**：元素自己的 padding 不能丢（`#debug` 是 `6px 9px`、
     * 状态效果胶囊是 `3px 9px`）。不扣掉的话字会顶到边框上。
     */
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    const padTop = Number.parseFloat(style.paddingTop) || 0;
    const padBottom = Number.parseFloat(style.paddingBottom) || 0;
    runs.push({
      rect: {
        x: rect.x + padLeft,
        y: rect.y + padTop,
        w: Math.max(0, rect.w - padLeft - padRight),
        h: Math.max(0, rect.h - padTop - padBottom),
      },
      text,
      color: style.color || '#ffffff',
      fontSize: Number.parseFloat(style.fontSize) || 12,
      weight: normalizeWeight(style.fontWeight),
      align,
      // `#hud` 的 `text-shadow` 是全局的，这里统一按"有阴影"处理（与原版 HUD 一致）
      shadow: style.textShadow !== 'none',
      alpha: shown?.isPlaceholder ? 0.55 : 1,
    });
  }
  return runs;
}

/**
 * 按原位画这些文字（调用方负责清屏/画背景）。
 *
 * `slack` 给 `maxWidth` 留的余量（px）。为什么需要：DOM 的 `letter-spacing`（标题常常是
 * 负值）会让元素盒子比 canvas 量出来的字**窄**，不给余量就会把 "MINICRAFT" 截成
 * "MINICRA…"。镜像整页时传一个字的宽度即可；F3/计分板保持 0（那边要的就是严格截断）。
 */
export function drawTextRuns(
  ctx: CanvasRenderingContext2D,
  runs: readonly TextRun[],
  slack = 0,
): void {
  for (const run of runs) {
    // 多行文字（F3 的 `textContent` 里有换行）要按行拆开逐行画
    const lines = run.text.split('\n');
    const lineHeight = run.fontSize * 1.35;
    const total = lines.length * lineHeight;
    let y = run.rect.y + (run.rect.h - total) / 2 + lineHeight / 2;
    const x =
      run.align === 'center'
        ? run.rect.x + run.rect.w / 2
        : run.align === 'right'
          ? run.rect.x + run.rect.w
          : run.rect.x;
    for (const line of lines) {
      drawText(ctx, line, x, y, {
        font: uiFont(run.fontSize, run.weight),
        color: run.color,
        align: run.align,
        baseline: 'middle',
        shadow: run.shadow,
        maxWidth: run.rect.w + slack,
        alpha: run.alpha ?? 1,
      });
      y += lineHeight;
    }
  }
}

/**
 * **整页镜像**：把一块已经写好的 DOM 界面（主菜单 / 世界列表）原样画到 canvas 上
 * （`src/ui2d/` 阶段 3 的最后一块拼图）
 *
 * 这条路与前面几块都不同：
 *  - 快捷栏 / 血条：**自己画**（几何从 DOM 量，像素自己产出）；
 *  - 设置页 / 暂停菜单：**自己画控件，动作转发给 DOM 按钮**；
 *  - 这一块：**一条像素都不自己排** —— 把 DOM 里每段文字、每块底色与边框按原位重画
 *    （`textPanel.ts` 那套），DOM 只把 `opacity` 设成 0 让位像素。
 *
 * 为什么主菜单适合这么干：它**静态**（没有每帧动画）、视图少、而且以后还会加东西
 * （迷你游戏、资源包、账号……）。把布局抄一遍到 canvas，等于以后每加一个按钮都要写两遍；
 * 而镜像不需要知道界面上有什么 —— 加按钮、改文案、换语言，它自动跟上。
 *
 * 三条必须守住的边界：
 *  1. **用 `opacity: 0` 让位，不用 `visibility` / `display`**：元素必须继续参与命中，
 *     否则那些按钮就点不动了（与快捷栏同一条经验，见 `TIPS.md`）；
 *  2. **不做输入/焦点/滚动**：`<input>`、`<select>`、滚动条全留在 DOM，canvas 只画静态像素。
 *     代价是**输入框里的文字画不出来**（`<input>` 的 value 不在 `textContent` 里），
 *     所以调用方要避开带输入框的视图（当前只镜像 `home` / `worlds`）；
 *  3. **签名检查**：菜单是静态的，只有"文字 / 滚动位置 / 视口尺寸"变了才重读计算样式。
 */

import { applyDebugTint } from './debug.ts';
import { Ui2DOverlay } from './overlay.ts';
import {
  drawTextBlocks,
  drawTextRuns,
  readTextBlocks,
  readTextRuns,
  type TextBlock,
  type TextRun,
} from './textPanel.ts';
import { caretBlinkOn, caretRect, rangeRect, visibleSlice, metricsFor } from './textInput.ts';

/** 每隔几帧做一次签名比对（菜单是静态的，没必要每帧读一遍 `textContent`） */
const SIGNATURE_INTERVAL = 4;

export interface MenuScreenOptions {
  /** 调试遮罩（`?ui2dtint=1`）：这一层产出的像素染黄 */
  readonly tint?: boolean;
  /**
   * 覆盖层的 `z-index`（默认 `1`，与游戏内的 HUD 覆盖层一致）。
   *
   * ⚠️ 宿主是 `document.body` 时**必须显式给**：镜像的目标往往自己带高 z-index
   * （`#world-screen` 是 40、`#chat` 是 8），覆盖层用 1 会被压在它们下面，
   * 看起来就是"什么都没画"（`opacity: 0` 的 DOM 也看不见，于是整块消失）。
   */
  readonly zIndex?: number;
}

/**
 * 把一块 DOM 界面镜像到 canvas。
 *
 * 用法（`main.ts` 的主菜单就是这两步）：
 * ```ts
 * const screen = new MenuScreen2D(document.body);
 * if (wantCanvas) screen.engage(panelEl); else screen.disengage();
 * ```
 */
export class MenuScreen2D {
  private overlay: Ui2DOverlay | null = null;
  private source: HTMLElement | null = null;
  private runs: readonly TextRun[] = [];
  private blocks: readonly TextBlock[] = [];
  private signature = '';
  private frame = 0;
  private raf = 0;
  /** 让位前的行内 opacity（有些容器自己写了 opacity，还原时要还回去） */
  private previousOpacity = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly options: MenuScreenOptions = {},
  ) {}

  get engaged(): boolean {
    return this.source !== null;
  }

  /** 开始镜像某个元素（重复调用同一个元素是空操作） */
  engage(source: HTMLElement): void {
    if (this.source === source) return;
    this.disengage();
    if (!this.overlay) {
      this.overlay = new Ui2DOverlay(this.host);
      if (this.options.zIndex !== undefined) this.overlay.canvas.style.zIndex = String(this.options.zIndex);
    }
    this.source = source;
    this.previousOpacity = source.style.opacity;
    // 让位：只摘像素，不摘命中（`visibility` / `display` 会让按钮点不动）
    source.style.opacity = '0';
    this.signature = '';
    this.frame = 0;
    this.raf = requestAnimationFrame(this.loop);
    this.refresh(true);
  }

  /** 停止镜像并还原 DOM */
  disengage(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.source) this.source.style.opacity = this.previousOpacity;
    this.source = null;
    this.runs = [];
    this.blocks = [];
    this.signature = '';
    this.overlay?.clear();
  }

  dispose(): void {
    this.disengage();
    this.overlay?.dispose();
    this.overlay = null;
  }

  private readonly loop = (): void => {
    if (!this.source) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frame += 1;
    // 大部分帧只比一次"要不要重画"，省掉整棵树的计算样式读取
    if (this.frame % SIGNATURE_INTERVAL === 0) this.refresh(false);
  };

  /** 重新读一遍（`force` = 不看签名，直接读并重画） */
  private refresh(force: boolean): void {
    const source = this.source;
    const overlay = this.overlay;
    if (!source || !overlay) return;
    overlay.syncSize();
    const signature = this.computeSignature(source, overlay.width, overlay.height);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    const origin = overlay.canvas.getBoundingClientRect();
    const view = { w: overlay.width, h: overlay.height };
    this.runs = readTextRuns(source, origin, view);
    this.blocks = readTextBlocks(source, origin, view);
    this.draw();
  }

  /**
   * 签名：视口尺寸 + 所有可滚动元素的 `scrollTop` + 整块文字。
   *
   * 用 `textContent` 而不是逐元素比较，是因为菜单一次只会变一两处（切视图 / 删世界），
   * 拼一次整串（几百字）比读几十次计算样式便宜得多。
   */
  /**
   * 画**当前聚焦输入框**的光标与选区。
   *
   * 为什么需要：整页镜像把面板 `opacity` 设成 0，DOM 自己的插入符也一起不可见了 ——
   * 玩家打字时看不到光标在哪。这里用 `selectionStart/End` 算位置（`textInput.ts` 的
   * 同一套纯函数），只画"一条竖线 + 一块半透明蓝"，不接管任何输入。
   *
   * ⚠️ 只在**焦点元素属于被镜像的子树**时才画：菜单之外的输入框（比如聊天）不该被画进来。
   */
  private drawFieldCaret(): void {
    const overlay = this.overlay;
    const source = this.source;
    if (!overlay || !source) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) return;
    if (!source.contains(active)) return;

    const ctx = overlay.context;
    const box = active.getBoundingClientRect();
    const origin = overlay.canvas.getBoundingClientRect();
    const style = window.getComputedStyle(active);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    const padTop = Number.parseFloat(style.paddingTop) || 0;
    const padBottom = Number.parseFloat(style.paddingBottom) || 0;
    const inner = {
      x: box.left - origin.left + padLeft,
      y: box.top - origin.top + padTop,
      w: Math.max(0, box.width - padLeft - padRight),
      h: Math.max(0, box.height - padTop - padBottom),
    };
    if (!(inner.w > 0) || !(inner.h > 0)) return;

    const metrics = metricsFor(ctx, Number.parseFloat(style.fontSize) || 13);
    const value = active.value;
    const start = active.selectionStart ?? value.length;
    const end = active.selectionEnd ?? value.length;
    const caret = end;
    const visible = visibleSlice(metrics, value, caret, inner.w);

    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip();
    const selection = rangeRect(metrics, visible, inner, Math.min(start, end), Math.max(start, end));
    if (selection) {
      ctx.fillStyle = 'rgba(96, 160, 255, .38)';
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    }
    if (start === end && caretBlinkOn(performance.now()) > 0.5) {
      const caretBox = caretRect(metrics, visible, inner, caret);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(caretBox.x, caretBox.y, caretBox.w, caretBox.h);
    }
    ctx.restore();
  }

  private computeSignature(source: HTMLElement, width: number, height: number): string {
    let scroll = '';
    for (const el of source.querySelectorAll<HTMLElement>('*')) {
      if (el.scrollHeight > el.clientHeight + 1) scroll += `${el.scrollTop};`;
    }
    /*
     * ⚠️ 输入框的值**不进 `textContent`**：只比文字的话，玩家在"新建世界"里敲字
     * canvas 永远不会重画（第一版就是这样：输入框一直显示占位提示）。
     */
    let fields = '';
    for (const el of source.querySelectorAll('input, textarea')) {
      fields += `${(el as HTMLInputElement).value}\u0000`;
    }
    return `${Math.round(width)}x${Math.round(height)}|${scroll}|${fields}|${source.textContent ?? ''}`;
  }

  private draw(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.clear();
    const ctx = overlay.context;
    // 先底后字：与 DOM 的层叠一致（底块含边框）
    drawTextBlocks(ctx, this.blocks);
    // 留一个字宽的余量：DOM 的 letter-spacing 会让标题盒子比 canvas 量出的字窄
    drawTextRuns(ctx, this.runs, 10);
    // 焦点在输入框上时，光标/选区由我们画：DOM 那份被 `opacity: 0` 一起藏了
    this.drawFieldCaret();
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }
}

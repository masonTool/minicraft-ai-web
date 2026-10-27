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
import { roundRectPath } from './widgets.ts';
import { Ui2DOverlay } from './overlay.ts';
import {
  drawCanvasBlits,
  drawTextBlocks,
  drawTextRuns,
  readCanvasBlits,
  readTextBlocks,
  readTextRuns,
  type CanvasBlit,
  type TextBlock,
  type TextRun,
} from './textPanel.ts';
import { caretBlinkOn, caretRect, rangeRect, visibleSlice, metricsFor } from './textInput.ts';

/** 滚动条的宽度（与 DOM 的 UA 滚动条一个量级，但更细、不抢视线） */
export const SCROLLBAR_WIDTH = 4;
/** 滚动条与容器右边缘的间距 */
export const SCROLLBAR_INSET = 2;
/** 滚动条最小拇指长度（内容再长也要抓得住） */
export const SCROLLBAR_MIN_THUMB = 18;
/** 每帧的速度衰减（60fps 下 0.94 ≈ 0.4 秒停下来） */
export const SCROLL_DECAY = 0.94;
/** 低于这个速度就停（px/帧） */
export const SCROLL_STOP = 0.25;

/** 一根画出来的滚动条：轨道、拇指，外加它管着哪个元素 */
export interface ScrollBarEntry {
  readonly el: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly thumb: { x: number; y: number; w: number; h: number };
}

/** 一根滚动条的轨道与拇指（纯几何，离线可断言） */
export function scrollBarRects(
  track: { x: number; y: number; w: number; h: number },
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { track: { x: number; y: number; w: number; h: number }; thumb: { x: number; y: number; w: number; h: number } } | null {
  if (!(scrollHeight > clientHeight + 2) || !(track.h > 0)) return null;
  const thumbH = Math.max(SCROLLBAR_MIN_THUMB, (clientHeight / scrollHeight) * track.h);
  const max = scrollHeight - clientHeight;
  // `scrollTop` 可能是 NaN（刚重建的容器）或越界：一律夹进 [0, max]，别让拇指飞出轨道
  const safeTop = Number.isFinite(scrollTop) ? Math.min(max, Math.max(0, scrollTop)) : 0;
  const t = max > 0 ? safeTop / max : 0;
  const y = track.y + (track.h - thumbH) * t;
  return { track, thumb: { x: track.x, y, w: track.w, h: thumbH } };
}

/** 惯性：每帧按 `SCROLL_DECAY` 衰减；带 `dt` 归一化，掉帧时不会突然冲很远 */
export function decayVelocity(velocity: number, dtMs: number): number {
  if (!Number.isFinite(velocity)) return 0;
  const frames = Math.min(3, Math.max(0, dtMs) / 16.67);
  const next = velocity * Math.pow(SCROLL_DECAY, frames);
  return Math.abs(next) < SCROLL_STOP ? 0 : next;
}

/** 每隔几帧做一次签名比对（菜单是静态的，没必要每帧读一遍 `textContent`） */
const SIGNATURE_INTERVAL = 4;

export interface MenuScreenOptions {
  /** 调试遮罩（`?ui2dtint=1`）：这一层产出的像素染黄 */
  readonly tint?: boolean;
  /**
   * 强制重读的间隔（毫秒，`0` = 只靠签名）。
   *
   * 为什么需要：签名只看"文字 / 输入框的值 / 滚动位置"，而**背包的图标是位图** ——
   * 把一格石头和一格剑对调时，两边的数量文字都没变（都是 1，不显示数字），
   * 签名完全一样，canvas 就会一直显示旧图标。这类"只换了图、没换字"的变化
   * 用签名抓不到，只能定期兜底重读。背包面板是模态的，120ms 一次的开销可以接受。
   */
  readonly pollMs?: number;
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
  /** DOM 里的 `<canvas>`（物品图标）：必须一起搬，否则背包镜像是个"没有图标的背包" */
  private blits: readonly CanvasBlit[] = [];
  private signature = '';
  private frame = 0;
  /** 上次强制重读的时间（`pollMs` 用） */
  private lastForcedAt = 0;
  /**
   * 拖拽滚动（触摸"手贴着列表上下移动"）的状态。
   *
   * 为什么镜像要自己做这件事：`html, body { touch-action: none }` 是游戏为了拖动视角
   * 关掉的，内层滚动容器即使写了 `touch-action: pan-y`，各家 WebView 的处理也不一致 ——
   * 表现就是"手指贴着列表上下滑，列表纹丝不动"。这里直接接管：算位移、改 `scrollTop`，
   * 与手指同步（每帧重读一次，画面立刻跟上）。
   */
  /** 绑了拖拽滚动监听的那个根（解绑时要按它摘） */
  private dragSource: HTMLElement | null = null;
  private drag: {
    readonly pointerId: number;
    readonly el: HTMLElement;
    readonly startY: number;
    readonly startScroll: number;
    moved: boolean;
    /** 最近几次移动的采样（算松手时的速度，给惯性用） */
    samples: { y: number; at: number }[];
  } | null = null;
  /** 惯性：松手后继续滑（`v` 是 px/帧） */
  private inertia: { readonly el: HTMLElement; v: number } | null = null;
  private lastFrameAt = 0;
  /** 这一帧要画的滚动条（`refresh` 里算，`draw` 里画） */
  private scrollBars: ScrollBarEntry[] = [];
  /**
   * 正在拖的那根滚动条。
   *
   * `offset` 是"按下点相对拇指顶端的位移"：抓在拇指中间再拖，拇指不会往上一跳。
   * 抓在轨道空白处时先按"翻页"对齐（拇指中心跳到按下点），再继续拖。
   */
  private barDrag: { readonly bar: ScrollBarEntry; readonly offset: number } | null = null;
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
    this.bindDragScroll(source);
    this.raf = requestAnimationFrame(this.loop);
    this.refresh(true);
  }

  /** 停止镜像并还原 DOM */
  disengage(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unbindDragScroll();
    if (this.source) this.source.style.opacity = this.previousOpacity;
    this.source = null;
    this.runs = [];
    this.blocks = [];
    this.blits = [];
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
    this.stepInertia();
    // 大部分帧只比一次"要不要重画"，省掉整棵树的计算样式读取
    if (this.frame % SIGNATURE_INTERVAL === 0) this.refresh(false);
    // 兜底：只换了位图（图标）、文字没变的情况签名抓不到（见 `pollMs` 的注释）
    const pollMs = this.options.pollMs ?? 0;
    if (pollMs > 0) {
      const now = typeof performance === 'undefined' ? 0 : performance.now();
      if (now - this.lastForcedAt >= pollMs) {
        this.lastForcedAt = now;
        this.refresh(true);
      }
    }
  };

  /**
   * 接管触摸拖拽滚动：在镜像的子树里找**可滚的祖先**，手指动多少就滚多少。
   *
   * 只劫持"纵向位移先超过 8px"的手势 —— 这样点击、横向拖动（物品拖拽分配）
   * 仍然走原来的逻辑；内容装得下的容器（普通背包 27 格）根本不会命中，
   * 也就不会把"拖动分堆"变成"滚动"。
   */
  private bindDragScroll(source: HTMLElement): void {
    this.dragSource = source;
    source.addEventListener('pointerdown', this.onDragStart, { passive: true });
    window.addEventListener('pointermove', this.onDragMove, { passive: false });
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  }

  private unbindDragScroll(): void {
    const source = this.dragSource;
    if (source) source.removeEventListener('pointerdown', this.onDragStart);
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
    this.dragSource = null;
    this.drag = null;
  }

  private readonly onDragStart = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('input, textarea, select')) return;
    // 先看是不是抓在滚动条上：抓拇指 = 直接拖，抓轨道空白 = 拇指中心跳过来再拖
    const hostRect = this.overlay?.canvas.getBoundingClientRect();
    const localX = hostRect ? event.clientX - hostRect.left : event.clientX;
    const localY = hostRect ? event.clientY - hostRect.top : event.clientY;
    const bar = this.scrollBarAt(localX, localY);
    if (bar) {
      const y = localY;
      const inThumb = y >= bar.thumb.y && y <= bar.thumb.y + bar.thumb.h;
      this.barDrag = {
        bar,
        offset: inThumb ? y - bar.thumb.y : bar.thumb.h / 2,
      };
      this.inertia = null;
      if (!inThumb) this.applyBarDrag(y);
      return;
    }

    const el = this.scrollableAncestorOf(target);
    if (!el) return;
    this.inertia = null; // 一旦重新按住，立刻停住惯性
    this.drag = {
      pointerId: event.pointerId,
      el,
      startY: event.clientY,
      startScroll: el.scrollTop,
      moved: false,
      samples: [{ y: event.clientY, at: event.timeStamp }],
    };
  };

  private readonly onDragMove = (event: PointerEvent): void => {
    if (this.barDrag) {
      event.preventDefault();
      const hostRect = this.overlay?.canvas.getBoundingClientRect();
      this.applyBarDrag(hostRect ? event.clientY - hostRect.top : event.clientY);
      return;
    }
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < 8) return; // 还没到"这是滑动"的程度：点击/拖动物品照旧
      drag.moved = true;
    }
    event.preventDefault();
    const next = Math.max(0, Math.min(drag.el.scrollHeight - drag.el.clientHeight, drag.startScroll - dy));
    if (next === drag.el.scrollTop) return;
    drag.el.scrollTop = next;
    // 采样给惯性用（只留最近 5 个）
    drag.samples.push({ y: event.clientY, at: event.timeStamp });
    if (drag.samples.length > 5) drag.samples.shift();
    // 画面立刻跟上手指（不等到 pollMs）
    this.refresh(true);
  };

  private readonly onDragEnd = (): void => {
    if (this.barDrag) {
      this.barDrag = null;
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag || !drag.moved) return;
    // 松手速度 = 最近两次采样的位移 / 时间（px/帧，60fps 归一）
    const samples = drag.samples;
    if (samples.length < 2) return;
    const last = samples[samples.length - 1]!;
    const first = samples[0]!;
    const dt = last.at - first.at;
    if (!(dt > 0)) return;
    // 向上拖时 `first.y > last.y` → 速度为正 = "内容继续往上走"
    const velocity = ((first.y - last.y) / dt) * 16.67;
    if (Math.abs(velocity) < 1) return;
    this.inertia = { el: drag.el, v: velocity };
  };

  /** 松手后的惯性：每帧衰减，直到停下（0.94/帧，约 0.4 秒） */
  private stepInertia(): void {
    const inertia = this.inertia;
    if (!inertia) return;
    const now = typeof performance === 'undefined' ? 0 : performance.now();
    const dt = this.lastFrameAt === 0 ? 16.67 : Math.min(64, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const el = inertia.el;
    const max = el.scrollHeight - el.clientHeight;
    // `v` 是"内容继续往上走的像素/帧"（向上拖为正）→ scrollTop 继续增大
    const next = Math.max(0, Math.min(max, el.scrollTop + inertia.v));
    el.scrollTop = next;
    inertia.v = decayVelocity(inertia.v, dt);
    if (inertia.v === 0 || next === 0 || next === max) this.inertia = null;
    this.refresh(true);
  }

  /** 命中测试：按下的点落在哪根滚动条上（横向给 ±3px 的宽容，4px 宽的条太细） */
  private scrollBarAt(x: number, y: number): ScrollBarEntry | null {
    for (const bar of this.scrollBars) {
      if (x < bar.x - 3 || x > bar.x + bar.w + 3) continue;
      if (y < bar.y || y > bar.y + bar.h) continue;
      return bar;
    }
    return null;
  }

  /** 把"手指的 y"换算成 scrollTop（拇指顶到轨顶 = 0，到底 = 最大） */
  private applyBarDrag(y: number): void {
    const state = this.barDrag;
    if (!state) return;
    const { bar, offset } = state;
    const travel = bar.h - bar.thumb.h;
    const max = bar.el.scrollHeight - bar.el.clientHeight;
    if (travel <= 0 || max <= 0) return;
    const ratio = Math.min(1, Math.max(0, (y - offset - bar.y) / travel));
    const next = Math.round(ratio * max);
    if (next === bar.el.scrollTop) return;
    bar.el.scrollTop = next;
    this.refresh(true);
  }

  /** 收集这一帧要画的滚动条（每个真的能滚的容器一根） */
  private collectScrollBars(source: HTMLElement, origin: DOMRect): ScrollBarEntry[] {
    const bars: ScrollBarEntry[] = [];
    for (const el of source.querySelectorAll<HTMLElement>('*')) {
      if (!(el.scrollHeight > el.clientHeight + 2) || el.clientHeight <= 0) continue;
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const box = el.getBoundingClientRect();
      const rect = scrollBarRects(
        {
          x: box.left - origin.left + box.width - SCROLLBAR_WIDTH - SCROLLBAR_INSET,
          y: box.top - origin.top,
          w: SCROLLBAR_WIDTH,
          h: box.height,
        },
        el.scrollTop,
        el.scrollHeight,
        el.clientHeight,
      );
      if (rect) bars.push({ el, ...rect.track, thumb: rect.thumb });
    }
    return bars;
  }

  /** 画滚动条（半透明圆角拇指，压在内容右侧） */
  private drawScrollBars(ctx: CanvasRenderingContext2D): void {
    for (const bar of this.scrollBars) {
      ctx.save();
      roundRectPath(ctx, bar, bar.w / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .16)';
      ctx.fill();
      roundRectPath(ctx, bar.thumb, bar.thumb.w / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .55)';
      ctx.fill();
      ctx.restore();
    }
  }

  /** 从命中元素往上找第一个"真的能滚"的祖先（限制在镜像子树里） */
  private scrollableAncestorOf(target: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = target;
    while (node && node !== this.source) {
      if (node.scrollHeight > node.clientHeight + 2 && node.clientHeight > 0) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
      }
      node = node.parentElement;
    }
    return null;
  }

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
    this.blits = readCanvasBlits(source, origin, view);
    this.scrollBars = this.collectScrollBars(source, origin);
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
    /*
     * ⚠️ **几何也要进签名**：首页的按钮在字体/排版稳定后会整体上移（实测同一个按钮
     * y 从 483 变成 309）。只比文字的话，第一帧量到的旧位置会被一直沿用 ——
     * canvas 画在旧位置、DOM 在新位置，看起来就是"按钮显示错位、点也点不中"。
     */
    const box = source.getBoundingClientRect();
    const geometry = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}|${source.scrollWidth}x${source.scrollHeight}`;
    return `${Math.round(width)}x${Math.round(height)}|${geometry}|${scroll}|${fields}|${source.textContent ?? ''}`;
  }

  private draw(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.clear();
    const ctx = overlay.context;
    // 先底后字：与 DOM 的层叠一致（底块含边框）
    drawTextBlocks(ctx, this.blocks);
    // 图标位图夹在"底"与"文字"之间：DOM 里它们也在槽位底之上、数量文字之下
    drawCanvasBlits(ctx, this.blits);
    // 留一个字宽的余量：DOM 的 letter-spacing 会让标题盒子比 canvas 量出的字窄
    drawTextRuns(ctx, this.runs, 10);
    // 滚动条：DOM 的是 UA 画的，canvas 里没有，得自己补（否则"能滚但看不出能滚"）
    this.drawScrollBars(ctx);
    // 焦点在输入框上时，光标/选区由我们画：DOM 那份被 `opacity: 0` 一起藏了
    this.drawFieldCaret();
    if (this.options.tint) applyDebugTint(ctx, overlay.width, overlay.height);
  }
}

/**
 * canvas 界面覆盖层（`src/ui2d/` 阶段 0）
 *
 * 一张**独立**的 2D canvas，盖在 WebGL 画布上、`#hud` 之下。选"2D 覆盖层"而不是
 * "把界面塞进 WebGL"的理由只有一条：文字。`fillText` 直接用系统字体，
 * 6 种语言（含中日韩）一个字库都不用自己造；WebGL 路线得先有 SDF/MSDF 图集，
 * 成本高一个数量级（见 `text.ts` 顶部）。
 *
 * 几何与 DPR 的三条口径：
 *  1. **绘制单位一律 CSS px**：构造时 `setTransform(dpr, 0, 0, dpr, 0, 0)`，
 *     之后所有坐标直接照抄 `index.html` 里那套 px 值，不用在各处乘 DPR；
 *  2. **背板尺寸跟着容器**（`#app`），而不是 `window.innerWidth`：
 *     容器就是视口，但将来嵌进别的布局也不至于错位；
 *  3. **DPR 夹到 3**：与 `ui/ItemIcon.ts` 的图标背板同一个上限（3 倍屏再往上
 *     多花的像素在肉眼上分辨不出来，却要多清一块 4 倍的画布）。
 *
 * ⚠️ **默认不吃事件**（`pointer-events: none`）。可点控件要显式打开
 * （`input.ts` 的 `Ui2DInput.setRegions` 会在有区域时打开），否则铺满全屏的
 * 覆盖层会把触摸端的视角手势全部吃掉。
 */

import { devicePixelRatioValue } from '../ui/Device.ts';

/** 背板 DPR 上限（与 `ui/ItemIcon.ts` 的 `iconBackingScale` 口径一致） */
export const UI2D_DPR_CAP = 3;

export interface Ui2DOverlayOptions {
  /** canvas 的 id（默认 `ui2d`；调试与截图脚本靠它找节点） */
  readonly id?: string;
}

export class Ui2DOverlay {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;

  private cssWidth = 0;
  private cssHeight = 0;
  private ratio = 1;
  private readonly observer: ResizeObserver | null;
  private readonly onWindowResize = (): void => {
    this.syncSize();
  };

  constructor(
    private readonly host: HTMLElement,
    options: Ui2DOverlayOptions = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = options.id ?? 'ui2d';
    // 内联样式而不是再往 index.html 加一段：这一层跟着 `#app` 走，
    // 而 `#app canvas` 那条规则已经把 width/height 定成 100%，这里只补定位与层叠
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    // 与 WebGL 画布同一个父节点：DOM 里排在它之后，天然盖在上面；
    // 显式 z-index 是为了不依赖"后来者居上"这个细节（`#hud` 在 body 上，另说）
    this.canvas.style.zIndex = '1';

    const context = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) throw new Error('2D canvas 不可用（浏览器过旧？）');
    this.context = context;
    this.host.appendChild(this.canvas);
    this.syncSize();

    this.observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.syncSize());
    this.observer?.observe(this.host);
    if (typeof window !== 'undefined') window.addEventListener('resize', this.onWindowResize);
  }

  /** 视口宽度（CSS px） */
  get width(): number {
    return this.cssWidth;
  }

  /** 视口高度（CSS px） */
  get height(): number {
    return this.cssHeight;
  }

  /** 当前背板倍率（调试/断言用） */
  get dpr(): number {
    return this.ratio;
  }

  /** 尺寸变了没有；变了就重设背板与变换矩阵 */
  syncSize(): boolean {
    const width = this.host.clientWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
    const height = this.host.clientHeight || (typeof window === 'undefined' ? 0 : window.innerHeight);
    const ratio = Math.min(UI2D_DPR_CAP, Math.max(1, devicePixelRatioValue()));
    if (width === this.cssWidth && height === this.cssHeight && ratio === this.ratio) return false;
    this.cssWidth = width;
    this.cssHeight = height;
    this.ratio = ratio;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return true;
  }

  /** 整块清空（只清 CSS px 范围：变换矩阵已经把背板缩放过） */
  clear(): void {
    this.context.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  dispose(): void {
    this.observer?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    this.canvas.remove();
  }
}

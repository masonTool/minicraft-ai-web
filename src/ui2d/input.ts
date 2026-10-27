/**
 * canvas 界面的命中测试与指针路由（`src/ui2d/` 阶段 0）
 *
 * DOM 界面里"点到哪个按钮"是浏览器免费给的（元素级 `pointerdown`、`z-index` 层叠、
 * `pointer-events` 穿透）。换到 canvas 之后这些全要自己算：本文件就是那一小块。
 *
 * 三条口径（都有离线断言盯着）：
 *  1. **只认矩形**。这一层的控件全是矩形（按钮/槽位/条），圆角只是画法，不参与命中；
 *  2. **层号大的在上面，同层后加的在上面**——与 DOM 的"后来者居上"一致，
 *     这样从 DOM 迁过来时，元素的书写顺序不用重排；
 *  3. **坐标一律是 CSS px**（与 `clientX/Y` 同一套），DPR 只在绘制时乘。
 *
 * ⚠️ 阶段 0 只搬"纯展示"的 HUD，所以这张表通常是空的：空表 = 覆盖层
 *    `pointer-events: none`，一根手指都不会被它吃掉。等真要接可点控件时再打开，
 *    否则会把底层 `#touch-look` 的手势吃掉 —— 这正是 `TIPS.md` 里
 *    "按钮看得见、点了没反应"那条坑的 canvas 版本。
 */

export interface HitRegion {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 层号：大的优先（默认 0） */
  readonly layer?: number;
  /** 禁用区域仍然"挡住"下层（与 DOM 的 `disabled` 一样吃点击），但不派发事件 */
  readonly disabled?: boolean;
}

function contains(region: HitRegion, x: number, y: number): boolean {
  return x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
}

/**
 * 找最上层命中的区域；没命中返回 `null`。
 *
 * 遍历顺序是**从后往前**（后加的更靠上），层号相同时天然取最后一个；
 * 层号不同时取层号最大的那个 —— 两者合起来就是"先按层、再按绘制顺序"。
 */
export function hitRegionAt(regions: readonly HitRegion[], x: number, y: number): HitRegion | null {
  let best: HitRegion | null = null;
  let bestLayer = Number.NEGATIVE_INFINITY;
  /*
   * **正向**遍历 + `>=`：后加的同层区域会把先前的顶掉（"后来者居上"），
   * 层号更大的任何区域也会顶掉当前的。
   *
   * ⚠️ 反过来写（从后往前 + `>=`）是错的：那样每命中一个更靠前的区域就会
   * 覆盖掉已经找到的上层，最后返回的永远是最**底**的那个 —— 断言抓过一次。
   */
  for (const region of regions) {
    if (!contains(region, x, y)) continue;
    const layer = region.layer ?? 0;
    if (layer >= bestLayer) {
      best = region;
      bestLayer = layer;
    }
  }
  return best;
}

/** 一次指针按下/抬起要交给调用方的东西（已经换算成画布内的 CSS px） */
export interface PointerHit {
  readonly region: HitRegion;
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
}

export type PointerHandler = (hit: PointerHit) => void;

/**
 * 把命中表接到 canvas 上。
 *
 * `setRegions()` 会顺带切换 `pointerEvents`：**空表时一定关掉**。这条不是优化，
 * 是正确性 —— 覆盖层铺满全屏，一旦开着就再也没有事件能落到底下的视角层。
 */
export class Ui2DInput {
  private regions: readonly HitRegion[] = [];
  private readonly controller = new AbortController();
  /** 按下时抓住的那个区域：抬起只在它身上派发（与 DOM 的隐式指针捕获一致） */
  private captured: HitRegion | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: { onDown?: PointerHandler; onUp?: PointerHandler },
  ) {
    const { signal } = this.controller;
    canvas.addEventListener('pointerdown', (event) => this.dispatch('down', event), { signal });
    canvas.addEventListener('pointerup', (event) => this.dispatch('up', event), { signal });
    canvas.addEventListener('pointercancel', () => {
      this.captured = null;
    }, { signal });
    this.syncPointerEvents();
  }

  setRegions(regions: readonly HitRegion[]): void {
    this.regions = regions;
    this.syncPointerEvents();
  }

  dispose(): void {
    this.controller.abort();
    this.regions = [];
    this.captured = null;
    this.canvas.style.pointerEvents = 'none';
  }

  private syncPointerEvents(): void {
    this.canvas.style.pointerEvents = this.regions.length > 0 ? 'auto' : 'none';
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dispatch(kind: 'down' | 'up', event: PointerEvent): void {
    const { x, y } = this.local(event);
    if (kind === 'down') {
      const region = hitRegionAt(this.regions, x, y);
      if (!region) return;
      // 命中就吃掉：不让同一次按下再去挖方块（与 DOM 按钮的 preventDefault 同一目的）
      event.preventDefault();
      event.stopPropagation();
      if (region.disabled) return;
      this.captured = region;
      this.handlers.onDown?.({ region, x, y, pointerId: event.pointerId });
      return;
    }
    const captured = this.captured;
    this.captured = null;
    if (!captured || captured.disabled) return;
    // 抬起只在**同一个**区域里才算数（手指滑出去等于取消）
    if (!contains(captured, x, y)) return;
    this.handlers.onUp?.({ region: captured, x, y, pointerId: event.pointerId });
  }
}

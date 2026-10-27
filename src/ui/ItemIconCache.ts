/**
 * 物品图标的**位图缓存**（自绘背包的第一步，M26b）
 *
 * 自绘面板要画"每格是什么东西"，而图标只能由 `ui/ItemIcon.ts` 画进一块 `<canvas>`
 * （它需要 `TextureAtlas`）。如果每帧都重画，一个 36 格背包就是每帧 36 次图集采样；
 * 所以按**物品 id** 缓存一张 32×32 的位图，画的时候只是 `drawImage`。
 *
 * 为什么按 `itemId` 而不是按整叠：`drawItemIcon` 只吃 `itemId`（耐久条、数量是另一层画的），
 * 所以同一种物品的所有叠共用一张图 —— 这也是原版的做法。
 *
 * 画法由调用方注入（`IconPainter`）：游戏里是 `drawItemIcon(canvas, atlas, id)`，
 * 预览页与测试里可以塞一个画色块的假画笔 —— 于是这个类本身可以离线断言。
 */

/** 往画布上画一个物品图标的函数（由调用方注入，见文件头） */
export type IconPainter = (canvas: HTMLCanvasElement, itemId: number) => void;

/** 图标背板尺寸（与 `ItemIcon.DEFAULT_ICON_SIZE` 一致；`drawItemIcon` 会按需放大） */
export const ICON_CACHE_SIZE = 32;

export class ItemIconCache {
  private readonly icons = new Map<number, HTMLCanvasElement>();

  constructor(
    private readonly painter: IconPainter,
    private readonly size: number = ICON_CACHE_SIZE,
    /** 造画布的方式（默认 `document.createElement('canvas')`；测试里可以注入一个假的） */
    private readonly createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  ) {}

  /** 取某个物品的图标（第一次用到才画） */
  get(itemId: number): HTMLCanvasElement {
    const hit = this.icons.get(itemId);
    if (hit) return hit;
    const canvas = this.createCanvas();
    canvas.width = this.size;
    canvas.height = this.size;
    this.painter(canvas, itemId);
    this.icons.set(itemId, canvas);
    return canvas;
  }

  /** 已经缓存了多少张（调试/断言用） */
  get count(): number {
    return this.icons.size;
  }

  /** 图集换了（资源包热重载）时要清掉，否则会一直显示旧图 */
  clear(): void {
    this.icons.clear();
  }
}

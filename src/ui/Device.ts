/**
 * 设备查询的小包装（批次 95）
 *
 * 存在的理由有两条：
 *  1. `devicePixelRatio` 在 Node 里**根本不存在**，直接引用会抛 `ReferenceError`
 *     ——而"物品图标画多大"这类东西要在离线测试（Node）里断言；
 *  2. 让"当前 DPR 是多少"只有**一处入口**：图标那一层要它，
 *     渲染器与粒子系统各自也写过一遍 `Math.min(window.devicePixelRatio, 2)`，
 *     三处各写一遍迟早会漂（例如一处忘了夹上限，3 倍屏上就白烧一倍像素）。
 */

/** 当前设备像素比（浏览器之外或取值异常时一律 1） */
export function devicePixelRatioValue(): number {
  if (typeof window === 'undefined') return 1;
  const value = window.devicePixelRatio;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

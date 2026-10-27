/**
 * 图标缓存（`ui/ItemIconCache.ts`）
 *
 * 这一层只有一个风险：**该缓存的地方重复画**。36 格背包每帧重画 36 次图集采样，
 * 在中端手机上就是明显的掉帧；而"忘了解缓存换图"则相反 —— 换了资源包还显示旧图标。
 * 两头都用断言钉住。
 */
import { describe, expect, it } from 'vitest';
import { ICON_CACHE_SIZE, ItemIconCache } from '../src/ui/ItemIconCache.ts';

/** 假画布：只记尺寸，`getContext` 给个记号的空实现 */
function fakeCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0 } as HTMLCanvasElement;
}

describe('图标缓存', () => {
  it('同一物品只画一次（第二次直接命中缓存）', () => {
    let painted = 0;
    const cache = new ItemIconCache(
      () => {
        painted += 1;
      },
      ICON_CACHE_SIZE,
      fakeCanvas,
    );
    const a = cache.get(1);
    const b = cache.get(1);
    expect(a).toBe(b);
    expect(painted).toBe(1);
    expect(cache.count).toBe(1);
  });

  it('不同物品各一张，画布按背板尺寸分配', () => {
    const cache = new ItemIconCache(() => {}, ICON_CACHE_SIZE, fakeCanvas);
    const one = cache.get(1);
    cache.get(2);
    expect(cache.count).toBe(2);
    expect(one.width).toBe(ICON_CACHE_SIZE);
    expect(one.height).toBe(ICON_CACHE_SIZE);
    expect(cache.get(1)).toBe(one);
  });

  it('清空后会重画（资源包热重载就靠它）', () => {
    let painted = 0;
    const cache = new ItemIconCache(
      () => {
        painted += 1;
      },
      ICON_CACHE_SIZE,
      fakeCanvas,
    );
    cache.get(7);
    cache.clear();
    expect(cache.count).toBe(0);
    cache.get(7);
    expect(painted).toBe(2);
  });
});

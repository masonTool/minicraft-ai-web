/**
 * 盔甲与副手的放置规则（`src/ui2d/armorRules.ts`）。
 *
 * 用普通格子当装备格时，玩家能把面包塞进头盔格 —— 这不是"小瑕疵"，
 * 而是"这个界面到底是背包还是装备栏"的分界线。规则很短，但错一条就露馅。
 */
import { describe, expect, it } from 'vitest';
import { SIDE_SLOT_KINDS, canPlaceInSideSlot, sideSlotAt, sideSlotFor } from '../src/ui2d/armorRules.ts';

describe('装备列规则', () => {
  it('五个格子的顺序固定：头 / 胸 / 腿 / 靴 / 副手', () => {
    expect([...SIDE_SLOT_KINDS]).toEqual(['helmet', 'chestplate', 'leggings', 'boots', 'offhand']);
  });

  it('盔甲格只收对应部位（头盔格不收靴子）', () => {
    expect(canPlaceInSideSlot('helmet', 'helmet')).toBe(true);
    expect(canPlaceInSideSlot('helmet', 'boots')).toBe(false);
    expect(canPlaceInSideSlot('boots', 'helmet')).toBe(false);
    expect(canPlaceInSideSlot('chestplate', 'chestplate')).toBe(true);
    expect(canPlaceInSideSlot('leggings', 'leggings')).toBe(true);
  });

  it('副手什么都收（包括不是装备的东西）', () => {
    expect(canPlaceInSideSlot('offhand', null)).toBe(true);
    expect(canPlaceInSideSlot('offhand', 'helmet')).toBe(true);
  });

  it('非装备（`null`）进不了盔甲格，但能进副手（这是"塞入"的判据）', () => {
    for (const slot of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
      expect(canPlaceInSideSlot(slot, null)).toBe(false);
    }
    expect(canPlaceInSideSlot('offhand', null)).toBe(true);
  });

  it('非装备没有归属格（`sideSlotFor` 只回答"这件装备该进哪格"）', () => {
    expect(sideSlotFor(null)).toBeNull();
  });

  it('装备反查归属格', () => {
    expect(sideSlotFor('helmet')).toBe('helmet');
    expect(sideSlotFor('boots')).toBe('boots');
  });
});

describe('下标 → 装备种类', () => {
  it('装备列不一定从 0 开始（工作站排在它前面）', () => {
    // 假设熔炉占了 0..2，装备列从 3 开始
    expect(sideSlotAt(3, 3)).toBe('helmet');
    expect(sideSlotAt(7, 3)).toBe('offhand');
  });

  it('越界返回 null（不会把主背包的格子当成头盔格）', () => {
    expect(sideSlotAt(2, 3)).toBeNull();
    expect(sideSlotAt(8, 3)).toBeNull();
    expect(sideSlotAt(4, 0)).toBe('offhand');
    expect(sideSlotAt(5, 0)).toBeNull();
  });
});

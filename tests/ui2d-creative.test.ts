/**
 * 创造物品栏的搜索与分页（`src/ui2d/creativeModel.ts`）。
 *
 * 这几条都是"用户会立刻感觉到"的行为：搜不到、翻页翻到空白、"石"把"钻石"也搜出来。
 * 它们全是不依赖 DOM 的纯函数，正好钉死。
 */
import { describe, expect, it } from 'vitest';
import { creativePagerHits } from '../src/ui2d/CreativePanel2D.ts';
import {
  CREATIVE_PAGE_SIZE,
  creativePageCount,
  creativePageSlice,
  fillCreativeGrid,
  filterCreativeItems,
  matchesQuery,
  normalizeQuery,
} from '../src/ui2d/creativeModel.ts';

const item = (id: number, name: string, tab: string) => ({ id, name, tab });
const ITEMS = [
  item(1, '圆石', 'building'),
  item(2, '石砖', 'building'),
  item(3, '钻石', 'items'),
  item(4, '铁镐', 'equipment'),
  item(5, 'Stone', 'building'),
];
const nameOf = (i: { name: string }) => i.name;
const tabOf = (i: { tab: string }) => i.tab;

describe('搜索词', () => {
  it('去空白、转小写', () => {
    expect(normalizeQuery('  Stone ')).toBe('stone');
  });

  it('按"包含"匹配，空词全命中', () => {
    expect(matchesQuery('圆石', '')).toBe(true);
    expect(matchesQuery('圆石', '石')).toBe(true);
    expect(matchesQuery('Stone', 'STO')).toBe(true);
    expect(matchesQuery('圆石', '铁')).toBe(false);
  });

  it('多个别名任意命中（英文 label / 本地化名 / id 字符串）', () => {
    expect(matchesQuery(['圆石', 'Cobblestone', '1'], 'cobble')).toBe(true);
    expect(matchesQuery(['圆石', 'Cobblestone', '1'], '圆')).toBe(true);
    expect(matchesQuery(['圆石', 'Cobblestone', '1'], '1')).toBe(true);
    expect(matchesQuery(['圆石', 'Cobblestone', '1'], 'dirt')).toBe(false);
  });

  it('不做模糊匹配（搜"石"不会把"钻石"也算命中以外的意外，但确实包含）', () => {
    // 包含关系是刻意保留的：搜"石"应该同时给出"圆石/石砖/钻石"
    expect(filterCreativeItems(ITEMS, { query: '石', nameOf }).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe('按页签 + 搜索过滤', () => {
  it('只按页签：保持注册表顺序', () => {
    expect(filterCreativeItems(ITEMS, { query: '', nameOf, tabOf, tab: 'building' }).map((i) => i.id)).toEqual([1, 2, 5]);
  });

  it('页签 + 搜索一起生效', () => {
    expect(filterCreativeItems(ITEMS, { query: '石', nameOf, tabOf, tab: 'building' }).map((i) => i.id)).toEqual([1, 2]);
  });

  it('不传页签就搜全部', () => {
    expect(filterCreativeItems(ITEMS, { query: '铁', nameOf }).map((i) => i.id)).toEqual([4]);
  });

  it('搜不到就是空数组（不是 undefined）', () => {
    expect(filterCreativeItems(ITEMS, { query: '没有这东西', nameOf })).toEqual([]);
  });
});

describe('分页', () => {
  it('页数向上取整，空结果也算 1 页', () => {
    expect(creativePageCount(0)).toBe(1);
    expect(creativePageCount(1)).toBe(1);
    expect(creativePageCount(CREATIVE_PAGE_SIZE)).toBe(1);
    expect(creativePageCount(CREATIVE_PAGE_SIZE + 1)).toBe(2);
  });

  it('取页越界自动夹住（搜索后停在第 5 页不会得到一屏空白）', () => {
    const items = Array.from({ length: CREATIVE_PAGE_SIZE * 2 }, (_, i) => i);
    expect(creativePageSlice(items, 0)[0]).toBe(0);
    expect(creativePageSlice(items, 1)[0]).toBe(CREATIVE_PAGE_SIZE);
    expect(creativePageSlice(items, 99).length).toBe(CREATIVE_PAGE_SIZE);
    expect(creativePageSlice(items, 99)[0]).toBe(CREATIVE_PAGE_SIZE);
    expect(creativePageSlice(items, -3)[0]).toBe(0);
    expect(creativePageSlice(items, Number.NaN)[0]).toBe(0);
  });

  it('最后一页不足整页时返回剩余部分', () => {
    const items = Array.from({ length: CREATIVE_PAGE_SIZE + 3 }, (_, i) => i);
    expect(creativePageSlice(items, 1).length).toBe(3);
  });
});

describe('铺网格', () => {
  it('不足补 null，格子数固定', () => {
    const grid = fillCreativeGrid([1, 2], 3, 2);
    expect(grid.length).toBe(6);
    expect(grid.slice(0, 2)).toEqual([1, 2]);
    expect(grid.slice(2)).toEqual([null, null, null, null]);
  });

  it('多出来的被截掉（不会画到网格外面）', () => {
    expect(fillCreativeGrid([1, 2, 3, 4], 2, 1)).toEqual([1, 2]);
  });

  it('行列非法时返回空数组', () => {
    expect(fillCreativeGrid([1], 0, 5)).toEqual([]);
    expect(fillCreativeGrid([1], 3, -1)).toEqual([]);
  });
});

/**
 * 翻页热区（`creativePagerHits`）。
 *
 * 翻页区的可见内容只有 `‹ 1 / 19 ›` 这几个字，但**热区**要够宽才点得到：
 * 手指不会正好戳在那个小三角上。左/右各取 1/3 宽度（上限 40px），中间留给页码。
 */
describe('翻页热区', () => {
  const pager = { x: 100, y: 400, w: 300, h: 20 };

  it('左右各一块，中间是页码（不相交）', () => {
    const hits = creativePagerHits(pager);
    expect(hits.prev.x).toBe(100);
    expect(hits.next.x + hits.next.w).toBe(400);
    expect(hits.prev.x + hits.prev.w).toBeLessThan(hits.next.x);
  });

  it('热区有上限（宽面板上不会把页码挤掉）', () => {
    const wide = creativePagerHits({ x: 0, y: 0, w: 900, h: 20 });
    expect(wide.prev.w).toBeLessThanOrEqual(40);
    expect(wide.next.w).toBeLessThanOrEqual(40);
  });

  it('窄面板按 1/3 缩（不会重叠）', () => {
    const narrow = creativePagerHits({ x: 0, y: 0, w: 90, h: 20 });
    expect(narrow.prev.w).toBeCloseTo(30, 6);
    expect(narrow.next.x).toBeCloseTo(60, 6);
  });
});

/**
 * 创造栏的过滤/分页跑**真实注册表数据**（`CREATIVE_ITEMS` + `itemName` + `creativeTabFor`）。
 *
 * 为什么单独一条：`ui2d/creativeModel.ts` 自己是通用的（名字/页签都靠注入），
 * 所以"它到底能不能吃真数据"必须有一次端到端的验证 —— 否则接进游戏才发现
 * "某个页签一件都没有"或者"名字全是 `item.123`"。
 *
 * 这条测试也顺便锁住两侧的**约定**：`ui2d` 不 import `core`，所以适配发生在测试里
 * （游戏里则发生在 `main.ts`）。
 */
import { describe, expect, it } from 'vitest';
import { CREATIVE_ITEMS, itemName } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { CREATIVE_TABS, creativeTabFor, creativeTabLabel } from '../src/ui/CreativeTabs.ts';
import {
  CREATIVE_PAGE_SIZE,
  creativePageCount,
  creativePageSlice,
  fillCreativeGrid,
  filterCreativeItems,
  matchesQuery,
} from '../src/ui2d/creativeModel.ts';
import { CREATIVE_LAYOUT } from '../src/ui2d/InventoryPanel2D.ts';

/** 适配层：把注册表喂给 `ui2d` 的通用过滤（游戏里这段在 `main.ts`） */
const list = (tab: string, query = '') =>
  filterCreativeItems(CREATIVE_ITEMS, {
    query,
    // 三个别名，与 DOM 版的 `matchesQuery` 一致（少一个就"原版能搜 canvas 搜不到"）
    nameOf: (id) => [itemName(id), itemLabel(id), String(id)],
    tabOf: (id) => creativeTabFor(id),
    ...(tab === 'all' ? {} : { tab }),
  });

describe('创造栏 × 真实数据', () => {
  it('注册表里有东西（否则后面全是空断言）', () => {
    expect(CREATIVE_ITEMS.length).toBeGreaterThan(200);
  });

  it('每个页签都至少有一件（含"全部"）', () => {
    for (const tab of CREATIVE_TABS) {
      expect(list(tab).length, `页签 ${tab} 是空的`).toBeGreaterThan(0);
      expect(creativeTabLabel(tab).length).toBeGreaterThan(0);
    }
  });

  it('每个页签的物品都属于该页签（过滤没漏）', () => {
    for (const tab of CREATIVE_TABS) {
      if (tab === 'all') continue;
      for (const id of list(tab)) expect(creativeTabFor(id)).toBe(tab);
    }
  });

  it('各页签加起来 = 全部（没有既不在任何页签、又没被排除的物品）', () => {
    const specific = CREATIVE_TABS.filter((tab) => tab !== 'all');
    const sum = specific.reduce((total, tab) => total + list(tab).length, 0);
    expect(sum).toBe(list('all').length);
  });

  it('搜索走物品名（中文/英文都能搜）', () => {
    const hits = list('all', '石');
    expect(hits.length).toBeGreaterThan(0);
    for (const id of hits) {
      expect(matchesQuery([itemName(id), itemLabel(id), String(id)], '石')).toBe(true);
    }
    // 英文 id 名也能搜（`itemName` 里带英文名的话）
    expect(list('all', 'stone').length).toBeGreaterThan(0);
  });

  it('搜不到就是空（不是"退化成全部"）', () => {
    expect(list('all', '这个物品不存在xyz')).toEqual([]);
  });

  it('分页：一页正好铺满 12×5 个格子', () => {
    const all = list('all');
    const pages = creativePageCount(all.length);
    expect(pages).toBeGreaterThan(1);
    const first = creativePageSlice(all, 0);
    expect(first.length).toBe(CREATIVE_PAGE_SIZE);
    const grid = fillCreativeGrid(first, CREATIVE_LAYOUT.cols, 5);
    expect(grid.length).toBe(CREATIVE_LAYOUT.cols * 5);
    expect(grid.every((entry) => entry !== null)).toBe(true);
  });

  it('最后一页不足一页时补 null（格子数仍然固定）', () => {
    const all = list('all');
    const last = creativePageSlice(all, creativePageCount(all.length) - 1);
    const grid = fillCreativeGrid(last, CREATIVE_LAYOUT.cols, 5);
    expect(grid.length).toBe(CREATIVE_LAYOUT.cols * 5);
    expect(grid.filter((entry) => entry === null).length).toBe(CREATIVE_LAYOUT.cols * 5 - last.length);
  });

  it('每一件都有可显示的名字（不能出现空名字）', () => {
    for (const id of list('all')) {
      const name = itemName(id);
      expect(typeof name).toBe('string');
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});

/**
 * 版面下标 ↔ 玩家库存下标（`src/ui2d/panelIndexing.ts`）。
 *
 * 这层之前是 `main.ts` 里的一行三元表达式（`display < 27 ? 9 + display : display - 27`），
 * **只在纯背包前提下成立**：打开熔炉（+3 格）或装备列（+5 格）之后，工作站格子会被当成
 * 主背包 —— 表现是"把煤放进背包第 9 格"，不报错、只在真机上看得见。
 */
import { describe, expect, it } from 'vitest';
import {
  displayIndexForInventory,
  inventoryIndexAt,
  panelRegions,
  regionOfDisplayIndex,
} from '../src/ui2d/panelIndexing.ts';
import { STATION_SPECS, extraSlotWritable } from '../src/ui2d/stationLayouts.ts';

describe('区域划分', () => {
  it('纯背包：27 主背包 + 9 快捷栏 = 36', () => {
    const regions = panelRegions();
    expect(regions.main).toEqual({ start: 0, count: 27 });
    expect(regions.hotbar).toEqual({ start: 27, count: 9 });
    expect(regions.total).toBe(36);
    expect(regions.extra.count).toBe(0);
    expect(regions.side.count).toBe(0);
  });

  it('工作站与装备列排在主背包之前', () => {
    const regions = panelRegions({ extraCount: 10, sideCount: 5 }); // 合成台 + 装备列
    expect(regions.extra).toEqual({ start: 0, count: 10 });
    expect(regions.side).toEqual({ start: 10, count: 5 });
    expect(regions.main).toEqual({ start: 15, count: 27 });
    expect(regions.hotbar).toEqual({ start: 42, count: 9 });
    expect(regions.total).toBe(51);
  });

  it('区域归属', () => {
    const spec = { extraCount: 3, sideCount: 5 };
    expect(regionOfDisplayIndex(spec, 0)).toBe('extra');
    expect(regionOfDisplayIndex(spec, 2)).toBe('extra');
    expect(regionOfDisplayIndex(spec, 3)).toBe('side');
    expect(regionOfDisplayIndex(spec, 7)).toBe('side');
    expect(regionOfDisplayIndex(spec, 8)).toBe('main');
    // 总格数 = 3 + 5 + 27 + 9 = 44 → 0..43 合法
    expect(regionOfDisplayIndex(spec, 43)).toBe('hotbar');
    expect(regionOfDisplayIndex(spec, 44)).toBeNull();
    expect(regionOfDisplayIndex(spec, -1)).toBeNull();
    expect(regionOfDisplayIndex(spec, 1.5)).toBeNull();
  });
});

describe('下标换算', () => {
  it('纯背包：面板第 0 格 = 库存第 9 格（主背包第一格）', () => {
    expect(inventoryIndexAt({}, 0)).toBe(9);
    expect(inventoryIndexAt({}, 26)).toBe(35);
    expect(inventoryIndexAt({}, 27)).toBe(0);
    expect(inventoryIndexAt({}, 35)).toBe(8);
  });

  it('加了工作站/装备列之后不会错位（这正是老代码的坑）', () => {
    const spec = { extraCount: 10, sideCount: 5 };
    // 前 15 格都不是玩家库存
    for (let i = 0; i < 15; i += 1) expect(inventoryIndexAt(spec, i)).toBeNull();
    // 第 15 格才是主背包第一格
    expect(inventoryIndexAt(spec, 15)).toBe(9);
    expect(inventoryIndexAt(spec, 41)).toBe(35);
    expect(inventoryIndexAt(spec, 42)).toBe(0);
    expect(inventoryIndexAt(spec, 50)).toBe(8);
  });

  it('越界返回 null（不会把不存在的位置算成背包）', () => {
    expect(inventoryIndexAt({}, 36)).toBeNull();
    expect(inventoryIndexAt({}, -1)).toBeNull();
    expect(inventoryIndexAt({}, Number.NaN)).toBeNull();
  });

  it('反查：库存下标 → 显示下标', () => {
    const spec = { extraCount: 10, sideCount: 5 };
    expect(displayIndexForInventory(spec, 9)).toBe(15);
    expect(displayIndexForInventory(spec, 35)).toBe(41);
    expect(displayIndexForInventory(spec, 0)).toBe(42);
    expect(displayIndexForInventory(spec, 8)).toBe(50);
    expect(displayIndexForInventory(spec, 36)).toBeNull();
    expect(displayIndexForInventory(spec, -1)).toBeNull();
  });

  it('来回换算一致（36 格全跑一遍）', () => {
    const spec = { extraCount: 7, sideCount: 5 };
    for (let inv = 0; inv < 36; inv += 1) {
      const display = displayIndexForInventory(spec, inv);
      expect(display).not.toBeNull();
      expect(inventoryIndexAt(spec, display!)).toBe(inv);
    }
  });
});

/**
 * 与工作站预设合起来看：`extraCount` 由 `stationSpec` 算出，面板下标先落"容器区"。
 *
 * 这条串起了三块（stationLayouts → panelIndexing → 容器访问），也是"打开熔炉时
 * 原料格显示空、玩家背包错位"那类 bug 的防线。
 */
describe('工作站版面', () => {
  it('熔炉：0/1 是容器格（原料/燃料），2 是产物，3 起才是玩家背包', () => {
    const spec = STATION_SPECS.furnace;
    const indexSpec = { extraCount: spec.cols * spec.rows + (spec.result ? 1 : 0), sideCount: 0 };
    expect(indexSpec.extraCount).toBe(3);
    // 前 3 格不归玩家库存（由容器提供）
    for (let i = 0; i < 3; i += 1) {
      expect(inventoryIndexAt(indexSpec, i)).toBeNull();
      expect(extraSlotWritable(spec, i)).toBe(i < 2); // 产物格不可写
    }
    expect(inventoryIndexAt(indexSpec, 3)).toBe(9);
    expect(inventoryIndexAt(indexSpec, 3 + 26)).toBe(35);
    expect(inventoryIndexAt(indexSpec, 3 + 27)).toBe(0);
  });

  it('箱子：27 格容器 + 36 玩家格', () => {
    const spec = STATION_SPECS.chest;
    const indexSpec = { extraCount: spec.cols * spec.rows, sideCount: 0 };
    expect(indexSpec.extraCount).toBe(27);
    expect(inventoryIndexAt(indexSpec, 26)).toBeNull();
    expect(inventoryIndexAt(indexSpec, 27)).toBe(9);
    expect(panelRegions(indexSpec).total).toBe(63);
  });
});

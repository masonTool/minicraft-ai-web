/**
 * 工作站槽位预设（`src/ui2d/stationLayouts.ts`）。
 *
 * 这张表是"19 种工作站"的唯一出处：排版错了，玩家会看到"熔炉的燃料格跑到背包里"或者
 * "箱子只摆出 9 格"。所以逐条钉：每个工作站多少格、有没有结果格、未知种类怎么退化。
 */
import { describe, expect, it } from 'vitest';
import { layoutInventoryPanel } from '../src/ui2d/InventoryPanel2D.ts';
import {
  STATION_KINDS,
  STATION_SPECS,
  stationExtra,
  stationSlotCount,
  stationSpec,
} from '../src/ui2d/stationLayouts.ts';

describe('工作站表', () => {
  it('名字与 `InventoryPanelMode` 逐字一致（差一个字母就查不到表）', () => {
    // 这几个最容易写错：shulker_box 不是 shulker
    for (const kind of ['shulker_box', 'ender_chest', 'blast_furnace', 'cartography'] as const) {
      expect(STATION_SPECS[kind]).toBeDefined();
    }
    expect((STATION_SPECS as Record<string, unknown>).shulker).toBeUndefined();
  });

  it('20 种都在（13 个工作站 + 7 个存储容器），且每种都有名字与正整数行列', () => {
    expect(STATION_KINDS.length).toBe(20);
    for (const kind of STATION_KINDS) {
      const spec = STATION_SPECS[kind];
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.cols).toBeGreaterThan(0);
      expect(spec.rows).toBeGreaterThan(0);
    }
  });

  it('槽位数与 DOM 版一致（抽查七个）', () => {
    expect(stationSlotCount('crafting')).toBe(9);
    expect(stationSlotCount('furnace')).toBe(2); // 原料 + 燃料
    expect(stationSlotCount('smithing')).toBe(3); // 模板 + 两件材料
    expect(stationSlotCount('brewing')).toBe(4); // 3 瓶 + 1 材料
    expect(stationSlotCount('chest')).toBe(27);
    expect(stationSlotCount('hopper')).toBe(5);
    expect(stationSlotCount('dispenser')).toBe(9);
  });

  it('只有烧燃料的三种带火焰，只有"输入→等待→输出"的带进度箭头', () => {
    const flames = STATION_KINDS.filter((kind) => STATION_SPECS[kind].flame === true);
    expect(flames.sort()).toEqual(['blast_furnace', 'furnace', 'smoker']);
    const progress = STATION_KINDS.filter((kind) => STATION_SPECS[kind].progress === true);
    expect(progress.sort()).toEqual(['blast_furnace', 'brewing', 'furnace', 'smoker']);
  });

  it('存储类没有结果格（有结果格就成了工作台）', () => {
    for (const kind of ['chest', 'barrel', 'shulker_box', 'ender_chest', 'hopper', 'dispenser', 'dropper'] as const) {
      expect(STATION_SPECS[kind].result).toBe(false);
    }
  });

  it('带火焰的三种会把 flame 一起传下去（否则版面里根本不会排火焰块）', () => {
    for (const kind of ['furnace', 'smoker', 'blast_furnace'] as const) {
      expect(stationExtra(kind)).toMatchObject({ flame: true, result: true });
    }
    expect(stationExtra('chest')?.flame).toBeUndefined();
  });

  it('未知种类退化成"没有额外槽位"（不是 0 行 0 列）', () => {
    expect(stationSpec('not_a_station')).toBeNull();
    expect(stationExtra('not_a_station')).toBeUndefined();
    expect(stationSlotCount('not_a_station')).toBe(0);
  });
});

describe('预设喂给布局', () => {
  const total = (kind: string) => {
    const layout = layoutInventoryPanel(0, 0, {
      mainRows: 3,
      hotbarRows: 1,
      extra: stationExtra(kind),
    });
    return { layout, count: layout.slots.length };
  };

  it('合成台 = 9 + 结果 + 36 = 46', () => {
    expect(total('crafting').count).toBe(46);
  });

  it('熔炉 = 2 + 结果 + 36 = 39', () => {
    expect(total('furnace').count).toBe(39);
  });

  it('箱子 = 27 + 36 = 63（没有结果格）', () => {
    const { layout, count } = total('chest');
    expect(count).toBe(63);
    expect(layout.groups.result).toBeNull();
  });

  it('附魔台没有结果格（2 + 36 = 38）', () => {
    const { layout, count } = total('enchanting');
    expect(count).toBe(38);
    expect(layout.groups.result).toBeNull();
  });

  it('每种工作站都能排出"额外槽位在主背包上方"的布局', () => {
    for (const kind of STATION_KINDS) {
      const { layout } = total(kind);
      if (layout.groups.extra.length === 0) continue;
      const extraBottom = Math.max(...layout.groups.extra.map((rect) => rect.y + rect.h));
      const mainTop = Math.min(...layout.groups.main.map((rect) => rect.y));
      expect(mainTop).toBeGreaterThan(extraBottom);
    }
  });
});

/**
 * 与游戏侧 `InventoryPanelMode` 的**名字对齐**（跨层耦合的唯一一处，所以要显式钉）。
 *
 * 玩法侧用 `currentMode` 直接查表，所以两边的字面量必须逐字一致。这里用
 * `satisfies InventoryPanelMode[]` 让 TS 校验"名字确实存在"，再用运行时断言校验
 * "每个模式都能查到表" —— 改名的两个方向（改模式 / 改 StationKind）都会被抓住。
 */
describe('与 InventoryPanelMode 对齐', () => {
  it('每个容器/工作站模式都能查到预设', async () => {
    const { STATION_SPECS } = await import('../src/ui2d/stationLayouts.ts');
    const modes = [
      'crafting',
      'furnace',
      'chest',
      'barrel',
      'ender_chest',
      'shulker_box',
      'enchanting',
      'anvil',
      'grindstone',
      'smithing',
      'smoker',
      'blast_furnace',
      'campfire',
      'stonecutter',
      'loom',
      'cartography',
      'hopper',
      'dropper',
      'dispenser',
      'brewing',
    ] as const satisfies readonly import('../src/ui/InventoryScreen.ts').InventoryPanelMode[];
    for (const mode of modes) {
      expect(STATION_SPECS[mode as keyof typeof STATION_SPECS], `缺少 ${mode} 的预设`).toBeDefined();
    }
    // 纯背包与交易没有"操作区"，不该出现在表里
    expect((STATION_SPECS as Record<string, unknown>).inventory).toBeUndefined();
    expect((STATION_SPECS as Record<string, unknown>).trade).toBeUndefined();
  });
});

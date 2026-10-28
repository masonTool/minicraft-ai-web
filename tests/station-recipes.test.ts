import { describe, expect, it } from 'vitest';
import {
  brewingStationRecipes,
  furnaceStationRecipes,
  smithingStationRecipes,
  stationCatalogIds,
  stationFamilyIds,
  stationNeedFor,
} from '../web/src/core/crafting/StationRecipes.ts';
import { BREW_RECIPES } from '../web/src/core/crafting/Brewing.ts';
import { netheriteUpgradeList } from '../web/src/core/crafting/Smithing.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { Block } from '../web/src/core/registry/blocks.ts';

function countsOf(entries: Readonly<Record<number, number>>) {
  return (id: number): number => entries[id] ?? 0;
}

describe('工作站可做列表（批次 277）', () => {
  describe('熔炉系', () => {
    it('有原料但没燃料 → 红底，原因缺燃料', () => {
      const entries = furnaceStationRecipes('furnace', countsOf({ [Item.RAW_IRON]: 1 }), false);
      const iron = entries.find((entry) => entry.resultId === Item.IRON_INGOT);
      expect(iron?.available).toBe(false);
      expect(iron?.reason).toBe('missing_fuel');
    });

    it('原料 + 燃料都够 → 白底', () => {
      const entries = furnaceStationRecipes('furnace', countsOf({ [Item.RAW_IRON]: 1 }), true);
      const iron = entries.find((entry) => entry.resultId === Item.IRON_INGOT);
      expect(iron?.available).toBe(true);
      expect(iron?.reason).toBe(null);
    });

    it('烟熏炉只列食物（不列金属/建材）', () => {
      const entries = furnaceStationRecipes('smoker', countsOf({}), true);
      expect(entries.some((entry) => entry.resultId === Item.IRON_INGOT)).toBe(false);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('营火不需要燃料', () => {
      const entries = furnaceStationRecipes('campfire', countsOf({ [Item.POTATO]: 1 }), false);
      const baked = entries.find((entry) => entry.resultId === Item.BAKED_POTATO);
      expect(baked?.available).toBe(true);
    });
  });

  describe('锻造台', () => {
    it('九种钻石装备都能列出来', () => {
      expect(smithingStationRecipes(countsOf({})).length).toBe(netheriteUpgradeList().length);
    });

    it('缺装备 / 缺锭 / 都够 三档', () => {
      const first = netheriteUpgradeList()[0]!;
      expect(smithingStationRecipes(countsOf({}))[0]?.reason).toBe('missing_equipment');
      expect(smithingStationRecipes(countsOf({ [first.equipment]: 1 }))[0]?.reason).toBe('missing_material');
      expect(
        smithingStationRecipes(countsOf({ [first.equipment]: 1, [Item.NETHERITE_INGOT]: 1 }))[0]?.available,
      ).toBe(true);
    });
  });

  describe('跨站台目录（批次 293）', () => {
    it('目录包含熔炼/锻造/酿造的产物且不重复', () => {
      const ids = stationCatalogIds();
      expect(ids).toContain(Item.IRON_INGOT);
      expect(ids).toContain(netheriteUpgradeList()[0]!.result);
      expect(ids).toContain(BREW_RECIPES[0]!.to);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('同一族的站台共用一张产物表（烟熏炉也能看见金属，点开提示高炉）', () => {
      const smokerIds = stationFamilyIds('smoker');
      expect(smokerIds).toContain(Item.IRON_INGOT);
      expect(smokerIds).toContain(Item.BAKED_POTATO);
      expect(stationFamilyIds('smithing')).toContain(netheriteUpgradeList()[0]!.result);
      expect(stationFamilyIds('brewing')).toContain(BREW_RECIPES[0]!.to);
    });

    it('当前站台做不了时指出正确的站台', () => {
      expect(stationNeedFor(Item.IRON_INGOT, 'smoker')?.station).toBe('blast_furnace');
      expect(stationNeedFor(Item.BAKED_POTATO, 'blast_furnace')?.station).toBe('smoker');
      expect(stationNeedFor(Block.GLASS, 'blast_furnace')?.station).toBe('furnace');
      expect(stationNeedFor(Item.IRON_INGOT, 'smithing')?.station).toBe('furnace');
      expect(stationNeedFor(netheriteUpgradeList()[0]!.result, 'furnace')?.station).toBe('smithing');
      expect(stationNeedFor(BREW_RECIPES[0]!.to, 'furnace')?.station).toBe('brewing');
      expect(stationNeedFor(Block.DIRT, 'furnace')).toBe(null);
    });

    it('"需要xxx"带上原料，界面才能画图标与名字', () => {
      const need = stationNeedFor(Item.IRON_INGOT, 'smithing');
      expect(need?.inputs).toEqual([{ id: Item.RAW_IRON, count: 1 }]);
      expect(need?.label).toBe('熔炉');
      const upgrade = stationNeedFor(netheriteUpgradeList()[0]!.result, 'furnace');
      expect(upgrade?.inputs[1]).toEqual({ id: Item.NETHERITE_INGOT, count: 1 });
      const brew = stationNeedFor(BREW_RECIPES[0]!.to, 'furnace');
      expect(brew?.inputs).toEqual([
        { id: BREW_RECIPES[0]!.from, count: 1 },
        { id: BREW_RECIPES[0]!.ingredient, count: 1 },
      ]);
    });
  });

  describe('酿造台', () => {
    it('缺基础药水 / 缺材料 / 缺燃料 / 都够 四档', () => {
      const recipe = BREW_RECIPES[0]!;
      const noBottle = brewingStationRecipes(countsOf({}), [], true);
      expect(noBottle.find((entry) => entry.resultId === recipe.to)?.reason).toBe('missing_input');

      const bottleOnly = brewingStationRecipes(countsOf({ [recipe.from]: 1 }), [], true);
      expect(bottleOnly.find((entry) => entry.resultId === recipe.to)?.reason).toBe('missing_material');

      const noFuel = brewingStationRecipes(
        countsOf({ [recipe.from]: 1, [recipe.ingredient]: 1 }),
        [],
        false,
      );
      expect(noFuel.find((entry) => entry.resultId === recipe.to)?.reason).toBe('missing_fuel');

      const ready = brewingStationRecipes(
        countsOf({ [recipe.from]: 1, [recipe.ingredient]: 1 }),
        [],
        true,
      );
      expect(ready.find((entry) => entry.resultId === recipe.to)?.available).toBe(true);
    });

    it('已经放进药水槽的基础药水也算有', () => {
      const recipe = BREW_RECIPES[0]!;
      const entries = brewingStationRecipes(
        countsOf({ [recipe.ingredient]: 1 }),
        [recipe.from],
        true,
      );
      expect(entries.find((entry) => entry.resultId === recipe.to)?.available).toBe(true);
    });
  });
});

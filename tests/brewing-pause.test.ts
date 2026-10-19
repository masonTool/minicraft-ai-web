import { describe, expect, it } from 'vitest';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BrewingStand,
} from '../src/core/container/BrewingStand.ts';
import { BREW_RECIPES } from '../src/core/crafting/Brewing.ts';
import { Item } from '../src/core/registry/items.ts';

describe('酿造台的"点目标框才开始"（批次 295）', () => {
  it('暂停时进度不走；恢复后才推进', () => {
    const recipe = BREW_RECIPES[0]!;
    const stand = new BrewingStand();
    stand.set(BREW_BOTTLE_SLOTS[0], { id: recipe.from, count: 1 });
    stand.set(BREW_INGREDIENT_SLOT, { id: recipe.ingredient, count: 1 });
    stand.set(BREW_FUEL_SLOT, { id: Item.BLAZE_POWDER, count: 1 });
    stand.paused = true;

    stand.tick(5);
    expect(stand.brewProgress).toBe(0);
    expect(stand.fuelLeft).toBe(0);

    stand.paused = false;
    stand.tick(5);
    expect(stand.brewProgress).toBeGreaterThan(0);
    expect(stand.fuelLeft).toBeGreaterThan(0);
  });
});

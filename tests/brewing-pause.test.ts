import { describe, expect, it } from 'vitest';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BrewingStand,
} from '../src/core/container/BrewingStand.ts';
import { BREW_RECIPES } from '../src/core/crafting/Brewing.ts';
import { Item } from '../src/core/registry/items.ts';
import { POTION_IDS } from '../src/core/registry/potions.ts';

/** 摆好一份最小可酿配方（水瓶 + 下界疣 + 烈焰粉） */
function readyStand(): { stand: BrewingStand; from: number } {
  const recipe = BREW_RECIPES[0]!;
  const stand = new BrewingStand();
  stand.set(BREW_BOTTLE_SLOTS[0], { id: recipe.from, count: 1 });
  stand.set(BREW_INGREDIENT_SLOT, { id: recipe.ingredient, count: 2 });
  stand.set(BREW_FUEL_SLOT, { id: Item.BLAZE_POWDER, count: 1 });
  return { stand, from: recipe.from };
}

describe('酿造台的"点目标框才开始"（批次 295 / 330）', () => {
  it('暂停时进度不走；恢复后才推进', () => {
    const { stand } = readyStand();
    stand.paused = true;

    stand.tick(5);
    expect(stand.brewProgress).toBe(0);
    expect(stand.fuelLeft).toBe(0);

    stand.paused = false;
    stand.tick(5);
    expect(stand.brewProgress).toBeGreaterThan(0);
    expect(stand.fuelLeft).toBeGreaterThan(0);
  });

  it('started=false 时即使 paused=false 也不推进（与熔炉同一条硬开关）', () => {
    const { stand, from } = readyStand();
    stand.paused = false;
    stand.started = false;

    stand.tick(30);
    expect(stand.brewProgress).toBe(0);
    expect(stand.fuelLeft).toBe(0);
    expect(stand.get(BREW_BOTTLE_SLOTS[0])?.id).toBe(from);
    expect(stand.get(BREW_INGREDIENT_SLOT)?.count).toBe(2);
  });

  it('进度推进中每个 tick 都会通知 onChange（界面进度条靠它）', () => {
    const { stand } = readyStand();
    let calls = 0;
    stand.onChange = () => {
      calls++;
    };

    stand.tick(1);
    expect(calls).toBeGreaterThan(0);
    const first = calls;
    stand.tick(1);
    expect(calls).toBeGreaterThan(first);
    expect(stand.brewProgress).toBeCloseTo(2);
  });

  it('条件被破坏、进度归零时也会通知 onChange', () => {
    const { stand } = readyStand();
    stand.tick(5);
    let calls = 0;
    stand.onChange = () => {
      calls++;
    };

    stand.set(BREW_INGREDIENT_SLOT, null);
    stand.tick(1);
    expect(stand.brewProgress).toBe(0);
    expect(calls).toBeGreaterThan(0);
  });

  it('三瓶共享一轮 20 秒，材料只扣 1 个', () => {
    const { stand } = readyStand();
    for (const slot of BREW_BOTTLE_SLOTS.slice(1)) {
      stand.set(slot, { id: Item.WATER_BOTTLE, count: 1 });
    }
    stand.set(BREW_INGREDIENT_SLOT, { id: Item.NETHER_WART, count: 3 });

    stand.tick(20);
    expect(BREW_BOTTLE_SLOTS.every((slot) => stand.get(slot)?.id === POTION_IDS.awkward)).toBe(true);
    expect(stand.get(BREW_INGREDIENT_SLOT)?.count).toBe(2);
    expect(stand.fuelLeft).toBe(19);
    expect(stand.brewProgress).toBe(0);
  });
});

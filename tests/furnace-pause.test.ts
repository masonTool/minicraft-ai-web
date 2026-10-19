import { describe, expect, it } from 'vitest';
import { FURNACE_FUEL, FURNACE_INPUT, Furnace } from '../src/core/container/Furnace.ts';
import { Item } from '../src/core/registry/items.ts';

describe('熔炉的"点目标框才开始"（批次 295）', () => {
  it('暂停时燃料不烧、进度不走；恢复后才推进', () => {
    const furnace = new Furnace('furnace');
    furnace.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 1 });
    furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
    furnace.paused = true;

    furnace.tick(2);
    expect(furnace.cookProgress).toBe(0);
    expect(furnace.burnTimeLeft).toBe(0);

    furnace.paused = false;
    furnace.tick(2);
    expect(furnace.cookProgress).toBeGreaterThan(0);
    expect(furnace.burnTimeLeft).toBeGreaterThan(0);
  });

  it('暂停不会吞掉已有燃烧时间', () => {
    const furnace = new Furnace('furnace');
    furnace.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 1 });
    furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
    furnace.tick(1);
    const burn = furnace.burnTimeLeft;
    furnace.paused = true;
    furnace.tick(5);
    expect(furnace.burnTimeLeft).toBe(burn);
    furnace.paused = false;
  });
});

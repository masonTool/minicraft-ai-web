import { describe, expect, it } from 'vitest';
import { FURNACE_FUEL, FURNACE_INPUT, Furnace } from '../src/core/container/Furnace.ts';
import { Campfire } from '../src/core/container/Campfire.ts';
import { Item } from '../src/core/registry/items.ts';

describe('熔炉的"点目标框才开始"（批次 295）', () => {
  it('暂停时燃料不烧、进度不走；恢复后才推进', () => {
    const furnace = new Furnace('furnace');
    furnace.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 1 });
    furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
    furnace.paused = true;
    furnace.started = true;

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
    furnace.started = true;
    furnace.tick(1);
    const burn = furnace.burnTimeLeft;
    furnace.paused = true;
    furnace.tick(5);
    expect(furnace.burnTimeLeft).toBe(burn);
    furnace.paused = false;
  });

  it('没点目标（started=false）时手动摆料绝不推进（批次 328）', () => {
    const furnace = new Furnace('furnace');
    furnace.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 1 });
    furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
    furnace.paused = false;
    furnace.started = false;
    furnace.tick(5);
    expect(furnace.cookProgress).toBe(0);
    expect(furnace.burnTimeLeft).toBe(0);
  });
});

describe('营火的 started 硬开关（批次 330，与熔炉/酿造台同一条口径）', () => {
  it('没点目标时手动摆料不烤', () => {
    const fire = new Campfire();
    fire.set(0, { id: Item.BEEF, count: 1 });
    fire.paused = false;
    fire.started = false;
    expect(fire.tick(60).cooked.length).toBe(0);
    expect(fire.get(0)?.id).toBe(Item.BEEF);
  });

  it('点过目标后 30 秒烤好', () => {
    const fire = new Campfire();
    fire.set(0, { id: Item.BEEF, count: 1 });
    fire.started = true;
    expect(fire.tick(30).cooked.length).toBe(1);
    expect(fire.get(0)).toBeNull();
  });
});

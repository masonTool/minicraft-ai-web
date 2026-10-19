import { describe, expect, it } from 'vitest';
import { Campfire } from '../src/core/container/Campfire.ts';
import { Item } from '../src/core/registry/items.ts';

describe('营火的"点目标框才开始"（批次 295）', () => {
  it('暂停时不烤；恢复后才推进并产出', () => {
    const fire = new Campfire();
    fire.set(0, { id: Item.POTATO, count: 1 });
    fire.paused = true;
    expect(fire.tick(5).cooked.length).toBe(0);
    expect(fire.ratio(0)).toBe(0);

    fire.paused = false;
    const result = fire.tick(31);
    expect(result.cooked.length).toBe(1);
    expect(result.cooked[0]?.output.id).toBe(Item.BAKED_POTATO);
  });
});

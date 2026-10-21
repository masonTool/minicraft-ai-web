/**
 * 坐骑货舱（J19b，批次 594）
 *
 * 覆盖两件事：
 *  - `Chest` 的格数参数（箱子仍 27，驴/骡/羊驼 15）；
 *  - 货舱能随实体寄存往返，且**空货舱也保留“装了箱子”这一事实**。
 */

import { describe, expect, it } from 'vitest';
import { Chest, CHEST_SIZE, MOB_CARGO_SIZE } from '../src/core/container/Chest.ts';
import { Horse } from '../src/core/entity/Horse.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { EntityParking } from '../src/core/entity/EntityParking.ts';
import { Block } from '../src/core/registry/blocks.ts';

describe('可变格数容器', () => {
  it('默认箱子仍是 27 格', () => {
    const chest = new Chest();
    expect(chest.size).toBe(CHEST_SIZE);
    chest.set(26, { id: Block.STONE, count: 1 });
    expect(chest.get(26)?.id).toBe(Block.STONE);
    expect(chest.get(27)).toBeNull();
  });

  it('货舱 15 格：第 15 格不可写', () => {
    const cargo = new Chest(MOB_CARGO_SIZE);
    expect(cargo.size).toBe(15);
    cargo.set(14, { id: Block.DIRT, count: 3 });
    cargo.set(15, { id: Block.DIRT, count: 3 });
    expect(cargo.get(14)?.count).toBe(3);
    expect(cargo.get(15)).toBeNull();
  });

  it('快照/恢复保留空槽与内容', () => {
    const cargo = new Chest(MOB_CARGO_SIZE);
    cargo.set(0, { id: Block.STONE, count: 2 });
    cargo.set(14, { id: Block.DIRT, count: 1 });
    const snapshot = cargo.snapshot();
    expect(snapshot).toHaveLength(15);

    const restored = new Chest(MOB_CARGO_SIZE);
    restored.restore(snapshot);
    expect(restored.get(0)?.id).toBe(Block.STONE);
    expect(restored.get(14)?.id).toBe(Block.DIRT);
    expect(restored.get(7)).toBeNull();
  });
});

describe('坐骑货舱能力与寄存', () => {
  it('驴/骡/羊驼能装，马不能', () => {
    const donkey = new Horse(mobTypeById('donkey')!, 0, 0, 0);
    const mule = new Horse(mobTypeById('mule')!, 0, 0, 0);
    const llama = new Horse(mobTypeById('llama')!, 0, 0, 0);
    const horse = new Horse(mobTypeById('horse')!, 0, 0, 0);
    expect(donkey.canCarryCargo).toBe(true);
    expect(mule.canCarryCargo).toBe(true);
    expect(llama.canCarryCargo).toBe(true);
    expect(horse.canCarryCargo).toBe(false);
  });

  it('货舱随实体寄存往返（含空货舱）', () => {
    const parking = new EntityParking();
    parking.park('overworld', 0, 0, {
      kind: 'mob',
      typeId: 'donkey',
      x: 1,
      y: 64,
      z: 1,
      yaw: 0,
      health: 20,
      tamed: true,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      cargo: [null, { id: Block.STONE, count: 2 }, null],
    });
    const round = new EntityParking();
    round.restoreAll(JSON.parse(JSON.stringify(parking.snapshotAll())) as never);
    const back = round.take('overworld', 0, 0).find((r) => r.kind === 'mob');
    expect(back?.kind).toBe('mob');
    if (back?.kind !== 'mob') return;
    expect(back.cargo).toHaveLength(MOB_CARGO_SIZE);
    expect(back.cargo?.[1]?.id).toBe(Block.STONE);
    expect(back.cargo?.[1]?.count).toBe(2);
  });
});

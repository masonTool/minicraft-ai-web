/**
 * 容器内容变更的"统一出口"（联机15）
 *
 * 原来只有箱子/木桶有 `onMutate`，而且只在**打开界面**时才挂：熔炉烧出东西、
 * 漏斗搬东西、发射器吐弹，队友那边全都看不见。
 *
 * 这里钉住"所有会同步的容器，写槽位都会触发 onMutate"——它是 `main.ts` 里那段
 * 防抖广播唯一的触发源，漏一个类就等于那类工作站回到"不同步"。
 */

import { describe, expect, it } from 'vitest';
import { Chest } from '../web/src/core/container/Chest.ts';
import { Furnace } from '../web/src/core/container/Furnace.ts';
import { Hopper } from '../web/src/core/container/Hopper.ts';
import { Dropper } from '../web/src/core/container/Dropper.ts';
import { BrewingStand } from '../web/src/core/container/BrewingStand.ts';

const stack = { id: 1, count: 3 } as never;

describe('每个会同步的容器写槽位都触发 onMutate', () => {
  const cases: [string, () => { set(i: number, s: unknown): void; onMutate: (() => void) | null }][] = [
    ['箱子', () => new Chest()],
    ['熔炉', () => new Furnace('furnace')],
    ['高炉', () => new Furnace('blast_furnace')],
    ['烟熏炉', () => new Furnace('smoker')],
    ['漏斗', () => new Hopper()],
    ['投掷器', () => new Dropper()],
    ['酿造台', () => new BrewingStand()],
  ];

  for (const [name, make] of cases) {
    it(`${name}：set 放下物品会通知`, () => {
      const container = make();
      let mutated = 0;
      container.onMutate = () => mutated++;
      container.set(0, stack);
      expect(mutated).toBe(1);
    });
  }

  it('拿空也要通知（队友得知道"东西被拿光了"）', () => {
    let mutated = 0;
    const chest = new Chest();
    chest.onMutate = () => mutated++;
    chest.set(0, stack);
    chest.set(0, null);
    expect(mutated).toBe(2);
  });

  it('没挂回调时不会炸（单机/离线路径）', () => {
    const furnace = new Furnace();
    expect(furnace.onMutate).toBeNull();
    expect(() => furnace.set(0, stack)).not.toThrow();
  });
});

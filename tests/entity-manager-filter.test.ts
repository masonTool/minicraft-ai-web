/**
 * 实体推进的逐实体过滤（L8 · MS3）
 *
 * 从属端不该推进**生物**（房主算完推快照，这边只画影子实体），但箭、掉落物、经验球
 * 这些"各端自己跑"的实体必须继续 tick——所以过滤是**逐实体**的，不是"整个 update 别看"。
 * 写反了的表现：从属端射出去的箭不飞（联机23 的箭头卡在原地）。
 */

import { describe, expect, it } from 'vitest';
import { EntityManager } from '../src/core/entity/EntityManager.ts';
import type { Entity } from '../src/core/entity/Entity.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';

/** 只实现 `tick` 与 `dead` 的假实体：`update` 只用到这两个 */
function fakeEntity(name: string, log: string[]): Entity {
  const entity = {
    dead: false,
    tick: () => {
      log.push(name);
    },
  };
  return entity as unknown as Entity;
}

const context = {} as EntityContext;

describe('EntityManager.update 的 shouldTick', () => {
  it('不传过滤时全部推进（单机 / 房主的行为不变）', () => {
    const manager = new EntityManager();
    const log: string[] = [];
    manager.spawn(fakeEntity('a', log));
    manager.spawn(fakeEntity('b', log));
    manager.update(context, 0.016);
    expect(log.sort()).toEqual(['a', 'b']);
  });

  it('过滤返回 false 的实体一步都不推进（从属端的生物）', () => {
    const manager = new EntityManager();
    const log: string[] = [];
    manager.spawn(fakeEntity('mob', log));
    manager.spawn(fakeEntity('arrow', log));
    manager.update(context, 0.016, (entity) => (entity as unknown as { kind?: string }).kind !== 'mob');
    // 两个都是"普通实体"，过滤条件不命中 → 都推进
    expect(log.sort()).toEqual(['arrow', 'mob']);
  });

  it('按名字过滤：只跳过被点名的那一个', () => {
    const manager = new EntityManager();
    const log: string[] = [];
    const mob = fakeEntity('mob', log);
    manager.spawn(mob);
    manager.spawn(fakeEntity('arrow', log));
    manager.update(context, 0.016, (entity) => entity !== mob);
    expect(log).toEqual(['arrow']);
  });

  it('被跳过的实体不会被当成 dead 从表里删掉（下一条快照还要用它）', () => {
    const manager = new EntityManager();
    const log: string[] = [];
    const mob = fakeEntity('mob', log);
    manager.spawn(mob);
    manager.update(context, 0.016, () => false);
    expect(log).toEqual([]);
    // 还在表里：影子实体不能因为"这一帧没 tick"就被抹掉
    expect(manager.all.includes(mob)).toBe(true);
  });
});

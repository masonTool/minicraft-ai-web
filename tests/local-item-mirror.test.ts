import { describe, expect, it } from 'vitest';
import { killLocalItemByLocalId } from '../web/src/core/net/LocalItemMirror.ts';

/**
 * 联机掉落物：**别人捡走我那堆之后，我这边也得消失**（2026-10-30 物品重复）。
 *
 * 服务端在 `item-take` 成功后会 `broadcast(item-remove)` 给房里所有人（含被捡的那位）。
 * 客户端以前只在 `remoteItems`（别人的镜像）里查，自己那堆在 `localNetItems` 里查不到，
 * 于是本机仍看得见、还能再捡一次 —— 两个人各得一份。
 */

interface FakeItem {
  dead: boolean;
}

function makeItem(): FakeItem {
  return { dead: false };
}

describe('killLocalItemByLocalId', () => {
  it('命中时摘表 + 标记死亡，并返回那个实体', () => {
    const a = makeItem();
    const b = makeItem();
    const items = new Map<FakeItem, number>([
      [a, 1],
      [b, 2],
    ]);

    const killed = killLocalItemByLocalId(items, 2);

    expect(killed).toBe(b);
    expect(b.dead).toBe(true);
    // 只动目标那一堆
    expect(a.dead).toBe(false);
    expect(items.size).toBe(1);
    expect(items.has(b)).toBe(false);
    expect(items.has(a)).toBe(true);
  });

  it('localId 不匹配时什么都不做', () => {
    const a = makeItem();
    const items = new Map<FakeItem, number>([[a, 1]]);

    expect(killLocalItemByLocalId(items, 999)).toBeNull();
    expect(a.dead).toBe(false);
    expect(items.size).toBe(1);
  });

  it('空表返回 null', () => {
    expect(killLocalItemByLocalId(new Map<FakeItem, number>(), 1)).toBeNull();
  });

  it('同一条 item-remove 重复到达是幂等的（服务端只广播一次，但别假设）', () => {
    const a = makeItem();
    const items = new Map<FakeItem, number>([[a, 7]]);

    expect(killLocalItemByLocalId(items, 7)).toBe(a);
    expect(killLocalItemByLocalId(items, 7)).toBeNull();
    expect(items.size).toBe(0);
  });

  it('摘表是必须的：否则“这堆不见了”会被扫描逻辑当成新消失再广播一次', () => {
    const a = makeItem();
    const items = new Map<FakeItem, number>([[a, 3]]);

    killLocalItemByLocalId(items, 3);

    // 表里已经没有它 —— 模拟 syncNetItems 的扫描口径
    expect([...items.keys()]).not.toContain(a);
    expect(a.dead).toBe(true);
  });
});

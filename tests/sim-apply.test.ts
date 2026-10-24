/**
 * 从属端影子实体（L8 · MS3）
 *
 * 三条核心行为：
 *  · 快照到达后**插值收敛**（不是直接赋值，否则模型一格一格跳）；
 *  · 大跳（> 8 格）**直接对齐**（重生/传送门是真跳，插值会拖出长线）；
 *  · 缺席要**留宽限**（AOI 边界会抖），但 `remove()` 立刻删（那是真死）。
 */

import { describe, expect, it } from 'vitest';
import { SHADOW_GRACE_SNAPSHOTS, SimApply } from '../src/game/sim/SimApply.ts';
import { ENTITY_FLAGS } from '../src/core/net/EntitySnapshot.ts';

/** 造一条线上形态的快照项 */
function wire(key: string, x: number, z: number, extra: { y?: number; health?: number; flags?: number; type?: string } = {}) {
  return [key, extra.type ?? 'zombie', x, extra.y ?? 70, z, 0, extra.health ?? 20, extra.flags ?? 0];
}

describe('SimApply', () => {
  it('新实体：apply 交出新建列表，位置就在快照那儿', () => {
    const apply = new SimApply();
    const created = apply.apply([wire('1:7', 3, 4)]);
    expect(created.map((entry) => entry.key)).toEqual(['1:7']);
    const [state] = apply.step(0.05);
    expect(state).toMatchObject({ key: '1:7', type: 'zombie', x: 3, z: 4 });
  });

  it('位置收敛：目标只移动 4 格时，逐帧逼近而不是瞬移', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    apply.apply([wire('1:7', 4, 0)]);
    const first = apply.step(0.05)[0]!;
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(4);
    // 多跑几帧后基本到位
    let last = first;
    for (let index = 0; index < 40; index += 1) last = apply.step(0.05)[0]!;
    expect(last.x).toBeCloseTo(4, 1);
  });

  it('大跳（> 8 格）直接对齐，不拖长线', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    apply.apply([wire('1:7', 60, 0)]);
    expect(apply.step(0.05)[0]?.x).toBe(60);
  });

  it(`缺席宽限：连丢 ${SHADOW_GRACE_SNAPSHOTS} 次还在，再丢才消失`, () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    for (let index = 0; index < SHADOW_GRACE_SNAPSHOTS; index += 1) apply.apply([]);
    expect(apply.size).toBe(1);
    apply.apply([]);
    expect(apply.size).toBe(0);
  });

  it('重新出现会清零缺席计数（AOI 边界来回抖动不该删）', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    apply.apply([]);
    apply.apply([]);
    apply.apply([wire('1:7', 0, 0)]);
    apply.apply([]);
    expect(apply.size).toBe(1);
  });

  it('remove() 立刻删（死亡事件不等宽限）', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    expect(apply.remove('1:7')).toBe(true);
    expect(apply.size).toBe(0);
    expect(apply.remove('1:7')).toBe(false);
  });

  it('血量按类型夹住，状态位原样跟随', () => {
    const apply = new SimApply({ maxHealthOf: () => 20 });
    apply.apply([wire('1:7', 0, 0, { health: -5, flags: ENTITY_FLAGS.onFire })]);
    expect(apply.step(0)[0]).toMatchObject({ health: 0, flags: ENTITY_FLAGS.onFire });
    apply.apply([wire('1:7', 0, 0, { health: 999 })]);
    expect(apply.step(0)[0]?.health).toBe(20);
  });

  it('坏快照不会把已有影子搞乱（解码层已逐条丢）', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 5, 5)]);
    apply.apply('nope');
    expect(apply.size).toBe(1);
    expect(apply.step(0)[0]?.x).toBe(5);
  });

  it('step 的输出顺序稳定（按 key 排，渲染顺序不抖）', () => {
    const apply = new SimApply();
    apply.apply([wire('1:9', 0, 0), wire('1:2', 1, 1), wire('1:5', 2, 2)]);
    expect(apply.step(0).map((entry) => entry.key)).toEqual(['1:2', '1:5', '1:9']);
    expect(apply.step(0).map((entry) => entry.key)).toEqual(['1:2', '1:5', '1:9']);
  });

  it('clear() 清空（退联机）', () => {
    const apply = new SimApply();
    apply.apply([wire('1:7', 0, 0)]);
    apply.clear();
    expect(apply.size).toBe(0);
    expect(apply.step(0)).toEqual([]);
  });
});

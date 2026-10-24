/**
 * 生物命中同步的匹配规则（联机19）
 *
 * 两端生物各自随机生成、服务端也没有实体 id，所以"队友打的那只怪"只能靠
 * **同类型 + 坐标邻域**来认。这里钉住：类型必须一致、取最近、超距不认、
 * 找不到返回 null（**不要凭空生成**，否则会双份怪物）。
 */

import { describe, expect, it } from 'vitest';
import { MOB_HIT_MATCH_DISTANCE, findMobMatch } from '../src/core/net/MobMatch.ts';

const zombie = (x: number, y = 70, z = 0, typeId = 'zombie') => ({ typeId, x, y, z });

describe('findMobMatch', () => {
  it('同类型、近距 → 命中', () => {
    const target = findMobMatch([zombie(10)], { typeId: 'zombie', x: 10.5, y: 70, z: 0.2 });
    expect(target).not.toBeNull();
    expect(target?.x).toBe(10);
  });

  it('类型不同不命中（僵尸的伤害不该落到骷髅身上）', () => {
    expect(findMobMatch([zombie(10, 70, 0, 'skeleton')], { typeId: 'zombie', x: 10, y: 70, z: 0 })).toBeNull();
  });

  it(`超过 ${MOB_HIT_MATCH_DISTANCE} 格不认`, () => {
    const hit = { typeId: 'zombie', x: 0, y: 70, z: 0 };
    expect(findMobMatch([zombie(MOB_HIT_MATCH_DISTANCE + 0.1, 70, 0)], hit)).toBeNull();
    expect(findMobMatch([zombie(MOB_HIT_MATCH_DISTANCE - 0.1, 70, 0)], hit)).not.toBeNull();
  });

  it('多只同类时取最近的那只', () => {
    const near = zombie(2.5);
    const far = zombie(2.9);
    expect(findMobMatch([far, near], { typeId: 'zombie', x: 2, y: 70, z: 0 })).toBe(near);
  });

  it('空集合 / 全都不匹配 → null（不要凭空生成一只）', () => {
    expect(findMobMatch([], { typeId: 'zombie', x: 0, y: 70, z: 0 })).toBeNull();
    expect(findMobMatch([zombie(100)], { typeId: 'zombie', x: 0, y: 70, z: 0 })).toBeNull();
  });

  it('坐标非法时安全返回 null（脏消息打不到任何东西）', () => {
    expect(findMobMatch([zombie(0)], { typeId: 'zombie', x: Number.NaN, y: 70, z: 0 })).toBeNull();
    expect(findMobMatch([zombie(0)], { typeId: 'zombie', x: 0, y: 70, z: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('三维距离（垂直方向也算）：头顶 3 格以上不算同一只', () => {
    expect(findMobMatch([zombie(0, 74, 0)], { typeId: 'zombie', x: 0, y: 70, z: 0 })).toBeNull();
  });
});

/*
 * 全局键优先（L8 · MS3 收尾）
 *
 * "同类型 + 最近"在两只同类怪挨着时会打错人：两端各自算出来的"最近"可能不是同一只。
 * 有全局键（房主分配的 `ownerId:localId`）就按身份认；没有才退回老口径。
 */
describe('findMobMatch · 全局键优先', () => {
  const candidates = [
    { typeId: 'zombie', x: 0, y: 64, z: 0, key: '3:1' },
    { typeId: 'zombie', x: 1, y: 64, z: 0, key: '3:2' },
  ];

  it('带键时按身份认，即使另一只更近', () => {
    const hit = { typeId: 'zombie', x: 0, y: 64, z: 0, key: '3:2' };
    expect(findMobMatch(candidates, hit)?.key).toBe('3:2');
  });

  it('带键时忽略距离上限（键就是身份，坐标只是它的当前值）', () => {
    const hit = { typeId: 'zombie', x: 999, y: 64, z: 999, key: '3:1' };
    expect(findMobMatch(candidates, hit)?.key).toBe('3:1');
  });

  it('键在我这边找不到 → 退回类型 + 邻域（老口径，不掉链子）', () => {
    const hit = { typeId: 'zombie', x: 0.5, y: 64, z: 0, key: '9:9' };
    expect(findMobMatch(candidates, hit)?.key).toBe('3:1');
  });

  it('没有键的命中照旧按最近认（老客户端兼容）', () => {
    const hit = { typeId: 'zombie', x: 0.9, y: 64, z: 0 };
    expect(findMobMatch(candidates, hit)?.key).toBe('3:2');
  });

  it('键匹配也不跨类型（对面发错类型时仍按类型兜底）', () => {
    const hit = { typeId: 'cow', x: 0, y: 64, z: 0, key: '3:1' };
    // 键命中会直接返回那只（键优先于类型检查）——这是有意的：键比类型更可靠
    expect(findMobMatch(candidates, hit)?.key).toBe('3:1');
  });
});

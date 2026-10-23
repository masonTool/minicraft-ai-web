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

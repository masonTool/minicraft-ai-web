/**
 * 实体快照编解码（L8 · MS3）
 *
 * 房主每 100ms 推一次，从属端照着画影子实体。这里钉三件事：
 *  · **往返一致**（除了坐标按 0.01 取整，这是刻意的）；
 *  · **坏条目单独丢**——一条脏数据不该让整包作废（与 `blocks` 同口径）；
 *  · 精度与上限：坐标不对齐到 0.01 会让每条多十几个字节，一包上限防"一次推 5000 只"。
 */

import { describe, expect, it } from 'vitest';
import {
  ENTITY_FLAGS,
  MAX_SNAPSHOT_ENTITIES,
  decodeEntities,
  encodeEntities,
  hasFlag,
  withFlag,
  type EntitySnapshot,
} from '../web/src/core/net/EntitySnapshot.ts';

const zombie: EntitySnapshot = {
  key: '3:7',
  type: 'zombie',
  x: 12.345,
  y: 70,
  z: -4.5,
  yaw: 1.234,
  health: 18,
  flags: ENTITY_FLAGS.onFire,
};

describe('encodeEntities / decodeEntities', () => {
  it('往返一致（坐标与朝向按 0.01 取整）', () => {
    const wire = encodeEntities([zombie]);
    expect(wire[0]).toEqual(['3:7', 'zombie', 12.35, 70, -4.5, 1.23, 18, ENTITY_FLAGS.onFire]);
    const back = decodeEntities(wire);
    expect(back).toEqual([{ ...zombie, x: 12.35, yaw: 1.23, z: -4.5 }]);
  });

  it('键不合法的条目在编码时就被丢掉（两端对不上身份的数据没用）', () => {
    const wire = encodeEntities([
      zombie,
      { ...zombie, key: 'nope' },
      { ...zombie, key: ':5' },
      { ...zombie, key: '1:' },
    ]);
    expect(wire).toHaveLength(1);
  });

  it('类型为空 / 数字非有限的条目同样丢掉', () => {
    const wire = encodeEntities([
      zombie,
      { ...zombie, key: '3:8', type: '' },
      { ...zombie, key: '3:9', x: Number.NaN },
      { ...zombie, key: '3:10', health: Number.POSITIVE_INFINITY },
    ]);
    expect(wire.map((entry) => entry[0])).toEqual(['3:7']);
  });

  it('解码时坏条目单独丢，不整包作废', () => {
    const wire = encodeEntities([zombie, { ...zombie, key: '3:8' }]);
    const dirty = [...wire, ['bad-key', 'zombie', 0, 0, 0, 0, 20, 0], 'nope', [1, 2, 3]];
    expect(decodeEntities(dirty).map((entity) => entity.key)).toEqual(['3:7', '3:8']);
  });

  it('血量按 maxHealth 夹住（负血会让从属端画出负长度的血条）', () => {
    const wire = encodeEntities([{ ...zombie, health: -5 }, { ...zombie, key: '3:8', health: 999 }]);
    expect(decodeEntities(wire, 20).map((entity) => entity.health)).toEqual([0, 20]);
  });

  it('不传 maxHealth 时血量原样（服务端/单测不该被夹）', () => {
    const wire = encodeEntities([{ ...zombie, health: 999 }]);
    expect(decodeEntities(wire)[0]?.health).toBe(999);
  });

  it(`一包最多 ${MAX_SNAPSHOT_ENTITIES} 只（超出的截掉，不是抛错）`, () => {
    const many = Array.from({ length: MAX_SNAPSHOT_ENTITIES + 40 }, (_unused, index) => ({
      ...zombie,
      key: `3:${index}`,
    }));
    expect(encodeEntities(many)).toHaveLength(MAX_SNAPSHOT_ENTITIES);
  });

  it('非数组输入返回空列表（网络来的东西什么形状都可能）', () => {
    expect(decodeEntities(null)).toEqual([]);
    expect(decodeEntities({})).toEqual([]);
    expect(decodeEntities('[]')).toEqual([]);
  });
});

describe('状态位', () => {
  it('hasFlag / withFlag 对称', () => {
    let flags = 0;
    flags = withFlag(flags, ENTITY_FLAGS.baby, true);
    flags = withFlag(flags, ENTITY_FLAGS.hurt, true);
    expect(hasFlag(flags, ENTITY_FLAGS.baby)).toBe(true);
    expect(hasFlag(flags, ENTITY_FLAGS.hurt)).toBe(true);
    expect(hasFlag(flags, ENTITY_FLAGS.onFire)).toBe(false);
    flags = withFlag(flags, ENTITY_FLAGS.baby, false);
    expect(hasFlag(flags, ENTITY_FLAGS.baby)).toBe(false);
    // 关掉一位不影响别的位
    expect(hasFlag(flags, ENTITY_FLAGS.hurt)).toBe(true);
  });

  it('四种状态位的值互不相同（改一位不会撞另一位）', () => {
    const values = Object.values(ENTITY_FLAGS);
    expect(new Set(values).size).toBe(values.length);
  });
});

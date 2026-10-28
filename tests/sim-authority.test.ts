/**
 * 房主侧实体采集（L8 · MS3）
 *
 * 三条规则，每条漏了都会出真问题：
 *  · **只采 AOI 内**：不然村庄里几百只怪全推给手机，带宽和帧率一起塌；
 *  · **只采同维度**：从属端在下界时收主世界的怪，只会画出一堆幽灵；
 *  · **近的优先**：超一包上限时丢远处的（近处正在被看着）。
 *
 * 半径用**切比雪夫**，与服务端 `withinAoi` 同一把尺子——两边不一致会出现
 * "房主发了、服务端又丢掉"的怪现象。
 */

import { describe, expect, it } from 'vitest';
import {
  ENTITY_SNAPSHOT_RADIUS_CHUNKS,
  collectEntitySnapshots,
  decodeEntitySnapshots,
  encodeEntitySnapshots,
  withinEntityAoi,
  type SimEntity,
} from '../web/src/game/sim/SimAuthority.ts';
import { ENTITY_FLAGS } from '../web/src/core/net/EntitySnapshot.ts';

function entity(key: string, x: number, z: number, extra: Partial<SimEntity> = {}): SimEntity {
  return {
    key,
    type: 'zombie',
    x,
    y: 70,
    z,
    yaw: 0,
    health: 20,
    flags: 0,
    dimension: 'overworld',
    ...extra,
  };
}

const here = { x: 0, z: 0, dimension: 'overworld' };

describe('withinEntityAoi', () => {
  it('默认半径内为真、半径外为假（切比雪夫：8 区块 = 128 格）', () => {
    const edge = ENTITY_SNAPSHOT_RADIUS_CHUNKS * 16;
    expect(withinEntityAoi(entity('1:1', edge, edge), here)).toBe(true);
    expect(withinEntityAoi(entity('1:2', edge + 16, 0), here)).toBe(false);
  });

  it('只看水平距离（y 差多少都不影响）', () => {
    expect(withinEntityAoi(entity('1:1', 4, 4, { y: 320 }), here)).toBe(true);
  });

  it('维度不同一律不在范围内', () => {
    expect(withinEntityAoi(entity('1:1', 0, 0, { dimension: 'nether' }), here)).toBe(false);
  });

  it('坐标是 NaN 的实体不采（坏数据不该进快照）', () => {
    expect(withinEntityAoi(entity('1:1', Number.NaN, 0), here)).toBe(false);
  });

  it('半径可调（小半径下同样的怪就出界了）', () => {
    const near = entity('1:1', 40, 0);
    expect(withinEntityAoi(near, here, 8)).toBe(true);
    expect(withinEntityAoi(near, here, 1)).toBe(false);
  });
});

describe('collectEntitySnapshots', () => {
  it('只采 AOI 内的实体', () => {
    const list = [
      entity('1:1', 5, 5),
      entity('1:2', 200, 200),
      entity('1:3', 0, 0, { dimension: 'nether' }),
    ];
    expect(collectEntitySnapshots(list, here).map((entry) => entry.key)).toEqual(['1:1']);
  });

  it('近的排在前面（超上限时先留近的）', () => {
    const list = [entity('1:far', 100, 0), entity('1:near', 1, 0), entity('1:mid', 40, 0)];
    expect(collectEntitySnapshots(list, here).map((entry) => entry.key)).toEqual(['1:near', '1:mid', '1:far']);
  });

  it('状态位与血量原样带出（渲染要用）', () => {
    const list = [entity('1:1', 1, 1, { health: 7, flags: ENTITY_FLAGS.baby | ENTITY_FLAGS.onFire, yaw: 1.5 })];
    const [snap] = collectEntitySnapshots(list, here);
    expect(snap).toMatchObject({ health: 7, flags: ENTITY_FLAGS.baby | ENTITY_FLAGS.onFire, yaw: 1.5 });
  });

  it('空输入得到空快照（没人/没怪时不该抛）', () => {
    expect(collectEntitySnapshots([], here)).toEqual([]);
  });
});

describe('encodeEntitySnapshots', () => {
  it('一步到线上形态（省得调用方忘了编码）', () => {
    const wire = encodeEntitySnapshots([entity('1:1', 12.345, -4.567)], here);
    expect(wire).toHaveLength(1);
    expect(wire[0]?.[0]).toBe('1:1');
    expect(wire[0]?.[2]).toBe(12.35);
  });

  it('编码后能解码回同一批实体（往返）', () => {
    const list = [entity('1:1', 12.34, -4.56, { health: 9 }), entity('1:2', 20, 20)];
    const back = decodeEntitySnapshots(encodeEntitySnapshots(list, here));
    expect(back.map((entry) => entry.key)).toEqual(['1:1', '1:2']);
    expect(back[0]?.health).toBe(9);
  });
});

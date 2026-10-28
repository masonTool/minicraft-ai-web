/**
 * 远端实体的分级关注（联机20）
 *
 * 16 格内 100ms、32 格内 250ms、更远不更新。这里钉住**三档边界**与**门控语义**：
 * 降频不能把近处那位也拖慢（按 id 分开记时间戳），远处则明确不再接受。
 */

import { describe, expect, it } from 'vitest';
import {
  AOI_MID_INTERVAL_MS,
  AOI_NEAR_INTERVAL_MS,
  RemoteAoiGate,
  aoiIntervalForDistance,
  aoiIntervalMs,
  aoiLevel,
} from '../web/src/core/net/NetAoi.ts';

describe('aoiLevel 三档边界', () => {
  it('16 格内是近档（含边界与 0）', () => {
    expect(aoiLevel(0)).toBe('near');
    expect(aoiLevel(15.9)).toBe('near');
    expect(aoiLevel(16)).toBe('near');
  });

  it('16~32 格是中档（含 32）', () => {
    expect(aoiLevel(16.1)).toBe('mid');
    expect(aoiLevel(32)).toBe('mid');
  });

  it('32 格之外是远档', () => {
    expect(aoiLevel(32.1)).toBe('far');
    expect(aoiLevel(1000)).toBe('far');
  });

  it('非法距离按近档处理（不返回 far 把实体冻住）', () => {
    expect(aoiLevel(Number.NaN)).toBe('near');
  });

  it('间隔与档位对应', () => {
    expect(aoiIntervalMs('near')).toBe(AOI_NEAR_INTERVAL_MS);
    expect(aoiIntervalMs('mid')).toBe(AOI_MID_INTERVAL_MS);
    expect(aoiIntervalMs('far')).toBe(Number.POSITIVE_INFINITY);
    expect(aoiIntervalForDistance(8)).toBe(100);
    expect(aoiIntervalForDistance(24)).toBe(250);
  });
});

describe('RemoteAoiGate 门控', () => {
  it('近档：100ms 内只接受一次', () => {
    const gate = new RemoteAoiGate();
    expect(gate.accept(1, 8, 0)).toBe(true);
    expect(gate.accept(1, 8, 50)).toBe(false);
    expect(gate.accept(1, 8, 100)).toBe(true);
  });

  it('中档：250ms 内只接受一次', () => {
    const gate = new RemoteAoiGate();
    expect(gate.accept(2, 24, 0)).toBe(true);
    expect(gate.accept(2, 24, 100)).toBe(false);
    expect(gate.accept(2, 24, 250)).toBe(true);
  });

  it('远档：一律不接受（位置停在上一次）', () => {
    const gate = new RemoteAoiGate();
    expect(gate.accept(3, 64, 0)).toBe(false);
    expect(gate.accept(3, 64, 1000)).toBe(false);
  });

  it('按 id 分开记：近处那位不会被远处的降频拖累', () => {
    const gate = new RemoteAoiGate();
    expect(gate.accept(1, 8, 0)).toBe(true); // 近
    expect(gate.accept(2, 24, 0)).toBe(true); // 中
    expect(gate.accept(1, 8, 110)).toBe(true); // 近的照常 100ms
    expect(gate.accept(2, 24, 110)).toBe(false); // 中的还没到 250ms
  });

  it('从远处走进来会立刻恢复更新（不是等满一个旧间隔）', () => {
    const gate = new RemoteAoiGate();
    expect(gate.accept(4, 64, 0)).toBe(false);
    // 远档不要时间戳，所以第一次进近档就能接受
    expect(gate.accept(4, 8, 10)).toBe(true);
  });

  it('forget / clear 之后可以重新开始', () => {
    const gate = new RemoteAoiGate();
    gate.accept(5, 8, 0);
    expect(gate.accept(5, 8, 10)).toBe(false);
    gate.forget(5);
    expect(gate.accept(5, 8, 10)).toBe(true);

    gate.accept(6, 8, 0);
    gate.clear();
    expect(gate.size).toBe(0);
    expect(gate.accept(6, 8, 10)).toBe(true);
  });
});

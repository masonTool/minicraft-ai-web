/**
 * 密度函数组合树（D2，批次 607）
 *
 * 钉住：基本算子、噪声缩放、样条、三线性插值、JSON 往返与非法输入。
 */

import { describe, expect, it } from 'vitest';
import {
  densityFromJson,
  densityToJson,
  evaluateDensity,
  type DensityNode,
} from '../src/core/gen/DensityFunction.ts';

const ctx = { x: 1.5, y: 2.5, z: -3.5 };

describe('密度函数求值', () => {
  it('加减乘除/最小最大/夹紧', () => {
    const add: DensityNode = { type: 'add', left: { type: 'constant', value: 2 }, right: { type: 'constant', value: 3 } };
    const mul: DensityNode = { type: 'mul', left: add, right: { type: 'constant', value: 4 } };
    const min: DensityNode = { type: 'min', left: mul, right: { type: 'constant', value: 10 } };
    const max: DensityNode = { type: 'max', left: min, right: { type: 'constant', value: 12 } };
    const clamp: DensityNode = { type: 'clamp', input: max, min: 0, max: 15 };
    expect(evaluateDensity(add, ctx)).toBe(5);
    expect(evaluateDensity(mul, ctx)).toBe(20);
    expect(evaluateDensity(min, ctx)).toBe(10);
    expect(evaluateDensity(max, ctx)).toBe(12);
    expect(evaluateDensity(clamp, ctx)).toBe(12);
  });

  it('噪声节点把坐标与缩放交给回调', () => {
    const calls: number[][] = [];
    const node: DensityNode = { type: 'noise', name: 'temperature', xzScale: 2, yScale: 3 };
    const value = evaluateDensity(node, {
      ...ctx,
      noise: (_name, x, y, z) => {
        calls.push([x, y, z]);
        return 0.25;
      },
    });
    expect(value).toBe(0.25);
    expect(calls[0]).toEqual([3, 7.5, -7]);
  });

  it('样条节点对输入做三次插值', () => {
    const node: DensityNode = {
      type: 'spline',
      input: { type: 'constant', value: 0.5 },
      points: [
        { location: 0, value: 0 },
        { location: 1, value: 10 },
      ],
    };
    const mid = evaluateDensity(node, ctx);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
  });

  it('interpolated 在八个角点之间三线性插值', () => {
    const children: DensityNode[] = [0, 10, 20, 30, 40, 50, 60, 70].map((value) => ({
      type: 'constant',
      value,
    }));
    const node: DensityNode = { type: 'interpolated', children };
    // 中心点取八角平均
    expect(evaluateDensity(node, { x: 0.5, y: 0.5, z: 0.5 })).toBe(35);
  });
});

describe('密度树 JSON', () => {
  it('往返保持结构', () => {
    const node: DensityNode = {
      type: 'clamp',
      min: -1,
      max: 1,
      input: {
        type: 'add',
        left: { type: 'noise', name: 'continents' },
        right: { type: 'constant', value: 0.5 },
      },
    };
    const round = densityFromJson(densityToJson(node));
    expect(round).toEqual(node);
    expect(evaluateDensity(round, { ...ctx, noise: () => 0.25 })).toBe(0.75);
  });

  it('非法结构直接报错', () => {
    expect(() => densityFromJson(null)).toThrow();
    expect(() => densityFromJson({ type: 'clamp', min: 2, max: 1, input: { type: 'constant', value: 0 } })).toThrow();
    expect(() => densityFromJson({ type: 'interpolated', children: [] })).toThrow();
    expect(() => densityFromJson({ type: 'unknown' })).toThrow();
  });
});

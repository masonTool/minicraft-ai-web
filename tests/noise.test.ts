/**
 * 噪声与密度函数的黄金参考值（A6，批次 589）
 *
 * 为什么需要这一层：
 *  - `generation.test.ts` 只证明“同种子同结果”，证明不了“没有人在调参时把世界改坏”；
 *  - `tools/noise-stats.ts` 只打印标准差，是标定工具，不做判定；
 *  - 这里把几条具体坐标的输出钉死：改八度/振幅/归一化/种子派生方式，都会当场变红。
 *
 * ⚠️ 这些值是**本项目的基准**，不是原版 Minecraft 的参考值（O1 仍单独追踪）。
 * 如果确实要改地形参数，必须同步更新这里的常量，并在提交信息里说明原因。
 */

import { describe, expect, it } from 'vitest';
import { DoublePerlinNoise, NormalNoise } from '../web/src/core/gen/noise/PerlinNoise.ts';
import { Random } from '../web/src/core/gen/noise/Random.ts';
import { OverworldGenerator } from '../web/src/core/gen/OverworldGenerator.ts';

const SEED = 20261014;

describe('噪声通道的黄金参考值', () => {
  it('NormalNoise 同种子同坐标输出固定', () => {
    const noise = new NormalNoise(new Random(12345), -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    expect(noise.getValue(12.5, 34.25, -56.75)).toBeCloseTo(1.5240084129826188, 10);
    expect(noise.getValue(-100.25, 70.5, 200.75)).toBeCloseTo(-0.47252070604739904, 10);
    // 原点在 Perlin 里恒为 0：这条不是黄金值，是结构性质，能抓“把种子混进坐标”的改法
    expect(noise.getValue(0, 0, 0)).toBe(0);
  });

  it('DoublePerlinNoise 同种子同坐标输出固定', () => {
    const noise = new DoublePerlinNoise(new Random(777), -7, [1, 1]);
    expect(noise.getValue(12.5, 34.25, -56.75)).toBeCloseTo(-0.42331136693112714, 10);
    expect(noise.getValue(0, 0, 0)).toBe(0);
  });

  it('不同种子的同一坐标输出不同（种子真的进了噪声）', () => {
    const a = new NormalNoise(new Random(1), -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    const b = new NormalNoise(new Random(2), -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    expect(a.getValue(12.5, 34.25, -56.75)).not.toBe(b.getValue(12.5, 34.25, -56.75));
  });
});

describe('密度函数（地表高度）的黄金参考值', () => {
  it('同种子下三个坐标的地表高度固定', () => {
    const generator = new OverworldGenerator(SEED);
    expect(generator.surfaceY(0, 0)).toBe(65);
    expect(generator.surfaceY(123, -456)).toBe(93);
    expect(generator.surfaceY(-789, 321)).toBe(36);
  });

  it('高度落在世界高度范围内', () => {
    const generator = new OverworldGenerator(SEED);
    for (let x = -512; x <= 512; x += 64) {
      for (let z = -512; z <= 512; z += 64) {
        const y = generator.surfaceY(x, z);
        expect(y).toBeGreaterThanOrEqual(-64);
        expect(y).toBeLessThan(320);
      }
    }
  });
});

/**
 * 噪声幅度标定工具
 *
 * 运行：npm run noise:stats
 *
 * 用途：NormalNoise 的归一化因子必须按**实际方差**来定，不能凭感觉。
 * 这里量出单层 Perlin 的标准差，以及按候选因子归一化后各噪声通道的实际标准差。
 */

import { DoublePerlinNoise, NormalNoise } from '../web/src/core/gen/noise/PerlinNoise.ts';
import { Random } from '../web/src/core/gen/noise/Random.ts';
import { OverworldGenerator } from '../web/src/core/gen/OverworldGenerator.ts';

const SAMPLES = 40000;

function standardDeviation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function sampleNoise(noise: { getValue(x: number, y: number, z: number): number }, scale = 1): number[] {
  const values: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i * 7.13) % 1000;
    const y = (i * 3.71) % 256;
    const z = (i * 11.37) % 1000;
    values.push(noise.getValue(x * scale, y * scale, z * scale));
  }
  return values;
}

console.log('\n[单层 Perlin 的实际标准差]');

// 单八度 NormalNoise：此时 valueFactor = 1/sqrt(1 * var)，所以输出标准差 = sqrt(var)
const singleOctave = new NormalNoise(new Random(12345), 0, [1]);
const perlinStd = standardDeviation(sampleNoise(singleOctave, 1));
console.log(`  单层 Perlin 标准差 ≈ ${perlinStd.toFixed(4)}   （方差 ${(perlinStd ** 2).toFixed(4)}）`);
console.log(`  归一化因子当前用 1/Σ|振幅|，单八度即 1，所以这就是原始幅度`);

console.log('\n[各通道按候选因子归一化后的标准差]');

interface Channel {
  name: string;
  firstOctave: number;
  amplitudes: number[];
  double: boolean;
}

const CHANNELS: Channel[] = [
  { name: 'continents', firstOctave: -9, amplitudes: [1, 1, 2, 2, 2, 1, 1, 1, 1], double: true },
  { name: 'erosion', firstOctave: -9, amplitudes: [1, 1, 0, 1, 1], double: true },
  { name: 'ridges', firstOctave: -7, amplitudes: [1, 2, 1, 0, 0, 0], double: true },
  { name: 'temperature', firstOctave: -10, amplitudes: [1.5, 0, 1, 0, 0, 0], double: true },
  { name: 'humidity', firstOctave: -8, amplitudes: [1, 1, 0, 0, 0, 0], double: true },
  { name: 'detail3d', firstOctave: -5, amplitudes: [1, 1, 1, 0.6, 0.3], double: false },
];

for (const channel of CHANNELS) {
  const random = new Random(9876);
  const noise = channel.double
    ? new DoublePerlinNoise(random, channel.firstOctave, channel.amplitudes)
    : new NormalNoise(random, channel.firstOctave, channel.amplitudes);
  const std = standardDeviation(sampleNoise(noise, 1));
  const gamma = channel.amplitudes.reduce((a, b) => a + b, 0);
  const amplitude = Math.hypot(...channel.amplitudes);
  console.log(
    `  ${channel.name.padEnd(12)} 标准差 ${std.toFixed(4)}   振幅和 ${gamma}   振幅平方和开根 ${amplitude.toFixed(3)}`,
  );
}

console.log('\n[地形样条输入的实际跨度]');
{
  const generator = new OverworldGenerator(20261014);
  const continents: number[] = [];
  const erosions: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = (i * 13.7) % 4000;
    const z = (i * 29.3) % 4000;
    const climate = generator.climateAt(x, z);
    continents.push(climate.continent);
    erosions.push(climate.erosion);
  }
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
  const percentile = (values: number[], p: number) => values[Math.floor(p * (values.length - 1))]!;
  const c = sorted(continents);
  const e = sorted(erosions);
  console.log(
    `  大陆度 标准差 ${standardDeviation(continents).toFixed(3)}   1%~99%: ${percentile(c, 0.01).toFixed(3)} ~ ${percentile(c, 0.99).toFixed(3)}`,
  );
  console.log(
    `  侵蚀度 标准差 ${standardDeviation(erosions).toFixed(3)}   1%~99%: ${percentile(e, 0.01).toFixed(3)} ~ ${percentile(e, 0.99).toFixed(3)}`,
  );
  console.log('  （样条控制点写在 -1.1 ~ 1.1 区间；只有输入真的铺满这个区间，样条才被完整用到）');
}

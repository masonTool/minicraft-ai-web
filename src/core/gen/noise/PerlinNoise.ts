/**
 * Perlin 噪声与多八度噪声
 *
 * 这里对齐原版 1.18 的 Noise 体系：
 *  - PerlinNoise        ：单层三维经典 Perlin（使用原版那 16 个梯度方向）
 *  - NormalNoise        ：多个八度叠加，振幅按数组给定，输出归一化到约 [-1, 1]
 *  - DoublePerlinNoise  ：两组 NormalNoise 取平均，抑制方向性条纹
 *
 * 八度频率为 2^(firstOctave + i)，与官方的 firstOctave / amplitudes 表示法一致。
 */

import type { Random } from './Random.ts';

/** 原版 PerlinNoise.GRADIENT：16 个梯度方向 */
const GRADIENT = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1,
  0, -1, -1, 1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

export class PerlinNoise {
  /** 256 项置换表：保留 0-255 的完整取值，梯度索引时才截到低 4 位 */
  private readonly perm = new Uint8Array(256);

  constructor(random: Random) {
    for (let i = 0; i < 256; i++) this.perm[i] = i;
    // Fisher-Yates 洗牌
    for (let i = 0; i < 256; i++) {
      const j = i + random.nextInt(256 - i);
      const tmp = this.perm[i]!;
      this.perm[i] = this.perm[j]!;
      this.perm[j] = tmp;
    }
  }

  getValue(x: number, y: number, z: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    const xf = x - fx;
    const yf = y - fy;
    const zf = z - fz;

    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const p = this.perm;
    const a = (p[X]! + Y) & 255;
    const aa = (p[a]! + Z) & 255;
    const ab = (p[(a + 1) & 255]! + Z) & 255;
    const b = (p[(X + 1) & 255]! + Y) & 255;
    const ba = (p[b]! + Z) & 255;
    const bb = (p[(b + 1) & 255]! + Z) & 255;

    const x1 = xf - 1;
    const y1 = yf - 1;
    const z1 = zf - 1;

    return lerp(
      lerp(
        lerp(grad(aa, xf, yf, zf), grad(ba, x1, yf, zf), u),
        lerp(grad(ab, xf, y1, zf), grad(bb, x1, y1, zf), u),
        v,
      ),
      lerp(
        lerp(grad((aa + 1) & 255, xf, yf, z1), grad((ba + 1) & 255, x1, yf, z1), u),
        lerp(grad((ab + 1) & 255, xf, y1, z1), grad((bb + 1) & 255, x1, y1, z1), u),
        v,
      ),
      w,
    );
  }
}

function grad(hash: number, x: number, y: number, z: number): number {
  const g = (hash & 15) * 3;
  return GRADIENT[g]! * x + GRADIENT[g + 1]! * y + GRADIENT[g + 2]! * z;
}

/** 多八度噪声：振幅数组描述各倍频的相对权重 */
export class NormalNoise {
  private readonly noises: PerlinNoise[] = [];
  private readonly amplitudes: number[] = [];
  private readonly frequencies: number[] = [];
  private readonly valueFactor: number;

  constructor(random: Random, firstOctave: number, amplitudes: readonly number[]) {
    const count = amplitudes.length;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const amplitude = amplitudes[i]!;
      if (amplitude === 0) continue;
      this.amplitudes.push(amplitude);
      this.frequencies.push(Math.pow(2, firstOctave + i));
      this.noises.push(new PerlinNoise(random));
      total += Math.abs(amplitude);
    }
    // 归一化到约 [-1, 1]，便于样条使用统一量纲
    this.valueFactor = total === 0 ? 0 : 1 / total;
  }

  /** 该噪声的最大振幅（归一化前），对应原版的 amplitude() */
  get amplitude(): number {
    return 1 / this.valueFactor;
  }

  getValue(x: number, y: number, z: number): number {
    let sum = 0;
    for (let i = 0; i < this.noises.length; i++) {
      const f = this.frequencies[i]!;
      sum += this.amplitudes[i]! * this.noises[i]!.getValue(x * f, y * f, z * f);
    }
    return sum * this.valueFactor;
  }
}

/**
 * 双 Perlin 噪声：两组独立的多八度噪声取平均。
 * 单组 Perlin 在轴向有明显的条纹感，取平均后可显著削弱。
 */
export class DoublePerlinNoise {
  private readonly first: NormalNoise;
  private readonly second: NormalNoise;
  private readonly valueFactor: number;

  constructor(random: Random, firstOctave: number, amplitudes: readonly number[]) {
    this.first = new NormalNoise(random, firstOctave, amplitudes);
    this.second = new NormalNoise(random, firstOctave, amplitudes);
    this.valueFactor = 0.5 * (this.first.amplitude + this.second.amplitude);
  }

  get amplitude(): number {
    return this.valueFactor;
  }

  getValue(x: number, y: number, z: number): number {
    return (this.first.getValue(x, y, z) + this.second.getValue(x, y, z)) * 0.5;
  }
}

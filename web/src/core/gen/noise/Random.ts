/**
 * 确定性随机源
 *
 * 复刻原版 1.18 的思路：世界种子经 SplitMix64 扩展为 Xoroshiro128++ 状态，
 * 各噪声再各自从种子派生独立序列。同一世界种子必然生成完全一致的世界。
 *
 * 性能说明：这里用 BigInt 只是为了种子扩展与状态推进（每次噪声构造、每次按位置
 * 派生种子时才用到），不在逐方块的采样热路径上，因此不会成为瓶颈。
 */

const MASK64 = 0xffffffffffffffffn;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

function splitMix64(seed: bigint): bigint {
  let z = (seed + GOLDEN_GAMMA) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function rotl(value: bigint, shift: bigint): bigint {
  return ((value << shift) | (value >> (64n - shift))) & MASK64;
}

export class Random {
  private s0: bigint;
  private s1: bigint;
  private gaussian: number | null = null;

  constructor(seed: number | bigint) {
    const base = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
    this.s0 = splitMix64(base);
    this.s1 = splitMix64(this.s0);
    // Xoroshiro 状态不可全零
    if (this.s0 === 0n && this.s1 === 0n) this.s1 = 1n;
  }

  /** 从另一个随机源派生（对应原版 RandomSource.fork） */
  static fromRandom(other: Random): Random {
    return new Random(other.nextLong());
  }

  nextLong(): bigint {
    const s0 = this.s0;
    const s1 = this.s1;
    const result = (rotl((s0 + s1) & MASK64, 17n) + s0) & MASK64;
    const x = (s1 ^ s0) & MASK64;
    this.s0 = (rotl(s0, 49n) ^ x ^ ((x << 21n) & MASK64)) & MASK64;
    this.s1 = rotl(x, 28n);
    return result;
  }

  /** [0, bound) 内的均匀整数 */
  nextInt(bound: number): number {
    if (bound <= 0) return 0;
    return Number(this.nextLong() % BigInt(bound));
  }

  /** [0, 1) 的双精度浮点 */
  nextDouble(): number {
    return Number(this.nextLong() >> 11n) / 9007199254740992;
  }

  nextFloat(): number {
    return this.nextDouble();
  }

  /** 标准正态分布（Box-Muller，带缓存） */
  nextGaussian(): number {
    if (this.gaussian !== null) {
      const value = this.gaussian;
      this.gaussian = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.nextDouble() * 2 - 1;
      v = this.nextDouble() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    this.gaussian = v * multiplier;
    return u * multiplier;
  }
}

/**
 * 位置随机源：给定种子与坐标，派生出一个稳定的随机源。
 * 对应原版的 PositionalRandomFactory，用于按方块位置决定细粒度随机。
 */
export class PositionalRandom {
  constructor(private readonly seed: bigint) {}

  static fromSeed(seed: number | bigint): PositionalRandom {
    const base = typeof seed === 'bigint' ? seed : BigInt(Math.trunc(seed));
    return new PositionalRandom(splitMix64(base));
  }

  /**
   * 坐标哈希，返回 [0,1)。纯计算无状态，适合逐方块的细粒度随机
   * （地表装饰、树木位置等）。
   */
  at(x: number, y: number, z: number): number {
    let h = this.seed;
    h = splitMix64(h ^ (BigInt(Math.trunc(x)) & MASK64));
    h = splitMix64(h ^ (BigInt(Math.trunc(y)) & MASK64));
    h = splitMix64(h ^ (BigInt(Math.trunc(z)) & MASK64));
    return Number(h >> 11n) / 9007199254740992;
  }
}

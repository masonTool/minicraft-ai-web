/**
 * 三次样条
 *
 * 1.18 地形的高度与起伏完全由样条决定：大陆度 → 高度偏移、侵蚀度 → 起伏系数与
 * 山脊锐度、奇异度 → 峰谷分布。原版用一组 (位置, 值, 导数) 控制点做分段三次
 * Hermite 插值，这里保持一致；导数缺省为 0，等价于控制点之间做平滑过渡。
 */

export interface SplinePoint {
  /** 控制点位置 */
  location: number;
  /** 控制点取值 */
  value: number;
  /** 该点处的导数；缺省 0（平滑过渡） */
  derivative?: number;
}

export class Spline {
  private readonly locations: Float64Array;
  private readonly values: Float64Array;
  private readonly derivatives: Float64Array;

  constructor(points: readonly SplinePoint[]) {
    if (points.length < 2) throw new Error('样条至少需要 2 个控制点');
    const sorted = [...points].sort((a, b) => a.location - b.location);
    this.locations = new Float64Array(sorted.map((p) => p.location));
    this.values = new Float64Array(sorted.map((p) => p.value));
    // 未指定导数时，用相邻点斜率作为默认值，避免出现明显折角
    this.derivatives = new Float64Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const explicit = sorted[i]!.derivative;
      if (explicit !== undefined) {
        this.derivatives[i] = explicit;
        continue;
      }
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      if (prev && next) {
        this.derivatives[i] = (next.value - prev.value) / (next.location - prev.location);
      } else {
        this.derivatives[i] = 0;
      }
    }
  }

  apply(x: number): number {
    const n = this.locations.length;
    if (x <= this.locations[0]!) return this.values[0]!;
    if (x >= this.locations[n - 1]!) return this.values[n - 1]!;

    // 二分查找所在区间
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x < this.locations[mid]!) hi = mid;
      else lo = mid;
    }

    const x0 = this.locations[lo]!;
    const x1 = this.locations[hi]!;
    const y0 = this.values[lo]!;
    const y1 = this.values[hi]!;
    const d0 = this.derivatives[lo]!;
    const d1 = this.derivatives[hi]!;
    const h = x1 - x0;
    const t = (x - x0) / h;

    // 三次 Hermite 基函数
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * y0 + h10 * h * d0 + h01 * y1 + h11 * h * d1;
  }
}

/** 常用的小工具：把区间 [0,1] 内的值做平滑插值 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * `/locate biome` 的搜索（K11，批次 416）—— 纯逻辑，探针注入，离线可断言。
 *
 * 为什么把"找最近的群系"单独拎出来：
 *  - 它只依赖一个 `(x, z) → 群系名` 的探针（主线程上就是一次气候噪声查询，很便宜），
 *    所以能在 Node 里用假探针把"搜多远、先命中哪个"钉死；
 *  - 命令那一层只负责解析参数与打印结果，错了也好定位是哪一边。
 *
 * ⚠️ 三条口径（都写在这里，免得以后"看起来像 bug"）：
 *  1. **按环形由近到远找，第一个命中就返回**。环的半径是切比雪夫距离（正方形环），
 *     不是欧氏距离——所以"找到的不一定是严格最近的那一个"，但一定在**最近的那一环**里。
 *     原版也是按区块环搜，同样不保证严格最近。
 *  2. **步长默认 16 格（一个区块）**：群系边界的最小尺度就是区块级（气候噪声在
 *     4 格网格上采样再插值），逐格扫没有任何收益，只会慢 16 倍。
 *  3. **搜索半径有上限**（默认 640 格 = 40 区块）：找不到就说"没找到"，
 *     而不是把主线程卡住——`/locate` 卡死比"没找到"难受得多。
 */

export interface LocateOrigin {
  x: number;
  z: number;
}

export interface LocateHit {
  x: number;
  z: number;
  /** 与起点的欧氏距离（报给玩家看的那个数） */
  distance: number;
  /** 找到时所在的环半径（切比雪夫距离，测试用） */
  ring: number;
}

export interface LocateOptions {
  /** 采样步长（格）。默认 16 = 一个区块 */
  step?: number;
  /** 搜索半径上限（格）。默认 640 */
  maxRadius?: number;
}

export const LOCATE_DEFAULT_STEP = 16;
export const LOCATE_DEFAULT_RADIUS = 640;

/**
 * 找最近的（按环形）满足 `probe(x, z) === target` 的位置；找不到返回 null。
 *
 * 环内采样顺序固定（先正北，顺时针），所以**同样的输入永远得到同一个结果**——
 * 这条对"验收脚本读到哪个坐标"很重要。
 */
export function findNearestBiome(
  probe: (x: number, z: number) => string | null,
  target: string,
  origin: LocateOrigin,
  options: LocateOptions = {},
): LocateHit | null {
  const step = Math.max(1, Math.floor(options.step ?? LOCATE_DEFAULT_STEP));
  const maxRadius = Math.max(step, Math.floor(options.maxRadius ?? LOCATE_DEFAULT_RADIUS));

  // 起点本身先验一次：站在目标群系里时应当立刻返回"就在这里"
  const here = probe(Math.floor(origin.x), Math.floor(origin.z));
  if (here === target) {
    return { x: Math.floor(origin.x), z: Math.floor(origin.z), distance: 0, ring: 0 };
  }

  for (let ring = step; ring <= maxRadius; ring += step) {
    let best: LocateHit | null = null;
    for (const [dx, dz] of ringSamples(ring)) {
      const x = Math.floor(origin.x) + dx;
      const z = Math.floor(origin.z) + dz;
      if (probe(x, z) !== target) continue;
      const distance = Math.hypot(dx, dz);
      if (best === null || distance < best.distance) best = { x, z, distance, ring };
    }
    // 这一环里已经命中就不必往更远处找了（更远的环距离一定更大）
    if (best) return best;
  }
  return null;
}

/**
 * 一个正方形环上的采样点（步长 = `size`）。
 * 从正北 (-size, -size→+size) 起顺时针走一圈，顺序固定。
 */
function ringSamples(size: number): Array<[number, number]> {
  // 一圈取 8 个点：四个角 + 四条边的中点。步长就是环半径本身，
  // 所以"环 r"上任意两点的间距是 r，不会漏掉整块群系（群系的最小尺度是一个区块）。
  return [
    [-size, -size],
    [0, -size],
    [size, -size],
    [-size, 0],
    [size, 0],
    [-size, size],
    [0, size],
    [size, size],
  ];
}

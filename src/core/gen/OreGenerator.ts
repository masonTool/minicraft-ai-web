/**
 * 矿石分布（对齐 1.18 的 Y 分布与丰度）
 *
 * 1.18 每种矿石的分布是「Y 区间 + 众数高度 + 每区块矿脉数 + 矿脉大小」的组合，
 * 其中钻石显著集中在基岩层上方（约 y=-59），这是 1.18 最著名的分布特征。
 *
 * 说明：矿脉起点限制在区块内，走到区块边界的部分会被裁掉（原版会把矿脉写到相邻区块）。
 * 完整跨区块写入会在后续优化中补齐；当前表现是"矿脉在区块边界处断开"，不影响玩法。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk } from '../world/Chunk.ts';
import { Random } from './noise/Random.ts';

interface OreSpec {
  /** 普通（石头）变体 */
  ore: number;
  /** 深板岩变体 */
  deepslate: number;
  /** 每区块矿脉数 */
  veins: number;
  minY: number;
  maxY: number;
  /** 分布众数高度 */
  peakY: number;
  minSize: number;
  maxSize: number;
  /** 只在多山区域生成（绿宝石） */
  mountainOnly?: boolean;
}

/**
 * 主世界矿石分布表（1.18）。
 *
 * 说明：官方给出的 Y 上限（如煤炭 192、铜 96）是指"最高可能出现的高度"，
 * 山顶以下才有实心岩石，因此实际产出主要由中低 Y 区间的概率决定。
 * 这里按离线统计（tools/gen-stats.ts）校准到"煤炭最多、钻石最稀有"的原版丰度关系。
 */
const ORES: readonly OreSpec[] = [
  { ore: Block.COAL_ORE, deepslate: Block.DEEPSLATE_COAL_ORE, veins: 24, minY: 0, maxY: 150, peakY: 46, minSize: 5, maxSize: 17 },
  { ore: Block.COPPER_ORE, deepslate: Block.DEEPSLATE_COPPER_ORE, veins: 8, minY: 0, maxY: 96, peakY: 40, minSize: 4, maxSize: 10 },
  { ore: Block.IRON_ORE, deepslate: Block.DEEPSLATE_IRON_ORE, veins: 12, minY: -24, maxY: 56, peakY: 16, minSize: 4, maxSize: 13 },
  { ore: Block.GOLD_ORE, deepslate: Block.DEEPSLATE_GOLD_ORE, veins: 3, minY: -64, maxY: 32, peakY: -16, minSize: 4, maxSize: 9 },
  { ore: Block.REDSTONE_ORE, deepslate: Block.DEEPSLATE_REDSTONE_ORE, veins: 4, minY: -64, maxY: 15, peakY: -32, minSize: 4, maxSize: 8 },
  { ore: Block.LAPIS_ORE, deepslate: Block.DEEPSLATE_LAPIS_ORE, veins: 2, minY: -64, maxY: 64, peakY: 0, minSize: 4, maxSize: 6 },
  // 钻石：明显偏向深部，众数约 -59（基岩层上方），且非常稀有
  { ore: Block.DIAMOND_ORE, deepslate: Block.DEEPSLATE_DIAMOND_ORE, veins: 1, minY: -64, maxY: 16, peakY: -59, minSize: 4, maxSize: 8 },
  // 绿宝石：只在山地单块生成
  { ore: Block.EMERALD_ORE, deepslate: Block.DEEPSLATE_EMERALD_ORE, veins: 24, minY: -16, maxY: 320, peakY: 100, minSize: 1, maxSize: 1, mountainOnly: true },
];

/** 三角分布逆变换：以 peakT 为众数，在 [0,1] 上采样 */
function sampleTriangle(u: number, peakT: number): number {
  const p = Math.min(0.999, Math.max(0.001, peakT));
  return u <= p ? Math.sqrt(u * p) : 1 - Math.sqrt((1 - u) * (1 - p));
}

export class OreGenerator {
  private readonly carvable = new Set<number>([Block.STONE, Block.DEEPSLATE, Block.GRANITE, Block.DIORITE, Block.ANDESITE, Block.TUFF, Block.CALCITE]);

  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * @param erosionAt 返回该列侵蚀度，用于判断是否属于多山区域（绿宝石）
   */
  generate(
    blocks: Uint8Array,
    cx: number,
    cz: number,
    erosionAt: (worldX: number, worldZ: number) => number,
  ): void {
    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;

    for (let index = 0; index < ORES.length; index++) {
      const spec = ORES[index]!;
      // 每种矿石独立的确定性随机流，保证同一区块结果稳定
      const rng = new Random(mixSeed(this.seed, cx, cz, index));

      for (let vein = 0; vein < spec.veins; vein++) {
        const startX = Math.floor(rng.nextDouble() * CHUNK_SIZE_X);
        const startZ = Math.floor(rng.nextDouble() * CHUNK_SIZE_Z);

        if (spec.mountainOnly) {
          const erosion = erosionAt(originX + startX, originZ + startZ);
          // 侵蚀度越低越接近山地（原版绿宝石只生成在山地生物群系）
          if (erosion > -0.12) continue;
        }

        const peakT = (spec.peakY - spec.minY) / (spec.maxY - spec.minY);
        const y = Math.floor(spec.minY + sampleTriangle(rng.nextDouble(), peakT) * (spec.maxY - spec.minY));
        if (y < spec.minY || y > spec.maxY) continue;

        this.placeVein(blocks, spec, rng, startX, y, startZ);
      }
    }
  }

  /** 随机游走式矿脉：沿一个随机方向前进，每一步放置一小簇矿石 */
  private placeVein(
    blocks: Uint8Array,
    spec: OreSpec,
    rng: Random,
    startX: number,
    startY: number,
    startZ: number,
  ): void {
    const size = spec.minSize + Math.floor(rng.nextDouble() * (spec.maxSize - spec.minSize + 1));
    const radius = spec.minSize === 1 ? 0 : 0.55 + rng.nextDouble() * 0.5;

    let directionX = rng.nextDouble() * 2 - 1;
    let directionY = rng.nextDouble() * 0.7 - 0.35;
    let directionZ = rng.nextDouble() * 2 - 1;
    const length = Math.hypot(directionX, directionY, directionZ) || 1;
    directionX /= length;
    directionY /= length;
    directionZ /= length;

    let x = startX;
    let y = startY;
    let z = startZ;
    const step = spec.minSize === 1 ? 1 : 0.75 + rng.nextDouble() * 0.6;

    for (let i = 0; i < size; i++) {
      if (radius > 0) {
        const r = Math.ceil(radius);
        for (let ox = -r; ox <= r; ox++) {
          for (let oy = -r; oy <= r; oy++) {
            for (let oz = -r; oz <= r; oz++) {
              if (ox * ox + oy * oy + oz * oz > radius * radius) continue;
              this.tryPlace(blocks, Math.round(x) + ox, Math.round(y) + oy, Math.round(z) + oz, spec);
            }
          }
        }
      } else {
        this.tryPlace(blocks, Math.round(x), Math.round(y), Math.round(z), spec);
      }

      x += directionX * step;
      y += directionY * step;
      z += directionZ * step;

      // 轻微扰动方向，让矿脉呈自然弯曲
      directionX += (rng.nextDouble() * 2 - 1) * 0.18;
      directionZ += (rng.nextDouble() * 2 - 1) * 0.18;
      const horizontal = Math.hypot(directionX, directionZ) || 1;
      directionX /= horizontal;
      directionZ /= horizontal;
    }
  }

  private tryPlace(blocks: Uint8Array, x: number, y: number, z: number, spec: OreSpec): void {
    if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) return;
    if (y < -64 || y >= 320) return;

    const index = Chunk.index(x, y, z);
    const current = blocks[index]!;
    if (!this.carvable.has(current)) return;

    // 深板岩区域用深板岩变体
    blocks[index] = current === Block.DEEPSLATE ? spec.deepslate : spec.ore;
  }
}

/** 把 (seed, cx, cz, 矿石序号) 混成一个稳定种子 */
function mixSeed(seed: number, cx: number, cz: number, index: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (cx | 0), 0x165667b1);
  h = Math.imul(h ^ (cz | 0), 0x9e3779b9);
  h = Math.imul(h ^ (index | 0), 0x85ebca6b);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * 矿石分布（对齐 1.18 的 Y 分布与丰度）
 *
 * 两套机制并存：
 *
 *  1. **小矿脉**：每种矿石按"每区块矿脉数"播撒起点，再随机游走成弯曲的团簇
 *     （煤炭/铜/铁/金/红石/青金石/钻石/绿宝石）。分布是「Y 区间 + 众数高度
 *     （三角分布）+ 矿脉大小」，钻石显著集中在基岩层上方（众数 y=-59），
 *     这是 1.18 最著名的分布特征。
 *
 *  2. **大矿脉（Ore Vein）**：1.18 新增的蛇形巨型矿体，只有铜矿脉与铁矿脉两种。
 *     它们围绕 y≈0 生成，长达数十格、半径数格，内部以**花岗岩**（铜）或
 *     **凝灰岩**（铁）为伴生岩，并夹带稀有的**粗铜块 / 粗铁块**。
 *
 * ---- 跨区块写入 ----
 * 每条矿脉的起点与游走完全由「起点所属区块 + 矿石序号 + 起点序号」派生的随机流决定，
 * 游走在世界坐标上进行。生成某个区块时会遍历其**邻域**区块里的全部矿脉起点，
 * 但只把落在本区块内的方块写进数组。
 * 于是相邻区块各自生成时会重建出完全相同的矿脉形状，矿脉不再被区块边界切断。
 * 邻域半径由矿脉的最大伸展长度决定：小矿脉 1（3×3），大矿脉 2（5×5）。
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
  /** 每区块矿脉数（可含小数：小数部分按概率取整，用于表达"若干区块才有一条"） */
  veins: number;
  minY: number;
  maxY: number;
  /** 分布众数高度 */
  peakY: number;
  minSize: number;
  maxSize: number;
  /** 只在多山区域生成（绿宝石） */
  mountainOnly?: boolean;
  /** 矿脉半径范围；缺省时 minSize>1 用 [0.55, 1.05]，minSize===1 为单块 */
  radius?: readonly [number, number];
  /** 游走步长范围 */
  step?: readonly [number, number];
  /** 竖直游走权重（越小越平缓），缺省 0.7 */
  verticalDrift?: number;
  /** 伴生岩方块（花岗岩 / 凝灰岩）及其占矿脉的比例 */
  host?: number;
  hostRatio?: number;
  /** 稀有粗金属块及其比例 */
  raw?: number;
  rawRatio?: number;
  /** 跨区块覆盖半径（单位：区块），1 = 3×3，2 = 5×5 */
  neighborhood?: number;
}

/**
 * 主世界矿石分布表（1.18）。
 *
 * 说明：官方给出的 Y 上限（如煤炭 192、铜 96）是指"最高可能出现的高度"，
 * 山顶以下才有实心岩石，因此实际产出主要由中低 Y 区间的概率决定。
 * 这里按离线统计（tools/ore-test.ts）校准到"煤炭最多、钻石最稀有"的原版丰度关系。
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

  // ---- 大矿脉（1.18 Ore Vein）：铜矿脉，花岗岩伴生 + 稀有粗铜块
  {
    ore: Block.COPPER_ORE,
    deepslate: Block.DEEPSLATE_COPPER_ORE,
    veins: 0.12,
    minY: -20,
    maxY: 44,
    peakY: 6,
    minSize: 26,
    maxSize: 38,
    radius: [2.4, 4.0],
    step: [1.0, 1.25],
    verticalDrift: 0.3,
    host: Block.GRANITE,
    hostRatio: 0.42,
    raw: Block.RAW_COPPER_BLOCK,
    rawRatio: 0.02,
    neighborhood: 2,
  },
  // ---- 大矿脉：铁矿脉，凝灰岩伴生 + 稀有粗铁块
  {
    ore: Block.IRON_ORE,
    deepslate: Block.DEEPSLATE_IRON_ORE,
    veins: 0.12,
    minY: -20,
    maxY: 44,
    peakY: 2,
    minSize: 26,
    maxSize: 38,
    radius: [2.4, 4.0],
    step: [1.0, 1.25],
    verticalDrift: 0.3,
    host: Block.TUFF,
    hostRatio: 0.42,
    raw: Block.RAW_IRON_BLOCK,
    rawRatio: 0.02,
    neighborhood: 2,
  },
];

/** 三角分布逆变换：以 peakT 为众数，在 [0,1] 上采样 */
function sampleTriangle(u: number, peakT: number): number {
  const p = Math.min(0.999, Math.max(0.001, peakT));
  return u <= p ? Math.sqrt(u * p) : 1 - Math.sqrt((1 - u) * (1 - p));
}

/** 全部矿石方块，用来避免矿脉互相覆盖（测试脚本也用它识别矿石） */
export const ORE_BLOCKS = new Set<number>(ORES.flatMap((spec) => [spec.ore, spec.deepslate]));

/** 累积缓冲里表示"普通矿石"的哨兵值（具体用石头还是深板岩变体，写入时才决定） */
const ORE_MARKER = -1;

export class OreGenerator {
  private readonly carvable = new Set<number>([
    Block.STONE,
    Block.DEEPSLATE,
    Block.GRANITE,
    Block.DIORITE,
    Block.ANDESITE,
    Block.TUFF,
    Block.CALCITE,
  ]);

  private readonly seed: number;

  /** 复用的累积缓冲：区块内索引 → 方块 id */
  private readonly pending = new Map<number, number>();

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
      const reach = (spec.maxSize ?? 1) * (spec.step?.[1] ?? 1.35) + (spec.radius?.[1] ?? 1) + 2;
      const span = spec.neighborhood ?? 1;

      // 遍历邻域区块：邻区块里起点、但延伸到本区块的那部分矿脉也要写进来
      for (let dx = -span; dx <= span; dx++) {
        for (let dz = -span; dz <= span; dz++) {
          const veinCx = cx + dx;
          const veinCz = cz + dz;
          const baseX = veinCx * CHUNK_SIZE_X;
          const baseZ = veinCz * CHUNK_SIZE_Z;

          // 起点区块离本区块太远时，整条矿脉不可能伸进本区块，直接跳过
          if (distanceToChunk(baseX, baseZ, originX, originZ) > reach) continue;

          const rng = new Random(mixSeed(this.seed, veinCx, veinCz, index));

          // 小数矿脉数按概率取整（整数时不消耗随机数，保证既有分布不变）
          const whole = Math.floor(spec.veins);
          const fraction = spec.veins - whole;
          const count = whole + (fraction > 0 && rng.nextDouble() < fraction ? 1 : 0);

          for (let vein = 0; vein < count; vein++) {
            const startX = baseX + Math.floor(rng.nextDouble() * CHUNK_SIZE_X);
            const startZ = baseZ + Math.floor(rng.nextDouble() * CHUNK_SIZE_Z);

            if (spec.mountainOnly) {
              const erosion = erosionAt(startX, startZ);
              // 侵蚀度越低越接近山地（原版绿宝石只生成在山地生物群系）
              if (erosion > -0.12) continue;
            }

            const peakT = (spec.peakY - spec.minY) / (spec.maxY - spec.minY);
            const y = Math.floor(spec.minY + sampleTriangle(rng.nextDouble(), peakT) * (spec.maxY - spec.minY));
            if (y < spec.minY || y > spec.maxY) continue;

            this.placeVein(blocks, spec, rng, startX, y, startZ, originX, originZ);
          }
        }
      }
    }
  }

  /**
   * 随机游走式矿脉：沿一个随机方向前进，每一步放置一小簇矿石。
   *
   * ⚠️ 关键约束：随机数的消耗次数必须与"当前区块是谁"无关，
   * 否则同一条矿脉在不同区块会被算成不同形状，跨区块就会断裂。
   * 因此所有随机量（尺寸、半径、步长、每一步的类型与扰动）都按固定顺序取出。
   */
  private placeVein(
    blocks: Uint8Array,
    spec: OreSpec,
    rng: Random,
    startX: number,
    startY: number,
    startZ: number,
    originX: number,
    originZ: number,
  ): void {
    const size = spec.minSize + Math.floor(rng.nextDouble() * (spec.maxSize - spec.minSize + 1));

    let radius: number;
    if (spec.radius) {
      radius = spec.radius[0] + rng.nextDouble() * (spec.radius[1] - spec.radius[0]);
    } else {
      radius = spec.minSize === 1 ? 0 : 0.55 + rng.nextDouble() * 0.5;
    }

    const verticalScale = spec.verticalDrift ?? 0.7;

    let directionX = rng.nextDouble() * 2 - 1;
    let directionY = rng.nextDouble() * verticalScale - verticalScale / 2;
    let directionZ = rng.nextDouble() * 2 - 1;
    const length = Math.hypot(directionX, directionY, directionZ) || 1;
    directionX /= length;
    directionY /= length;
    directionZ /= length;

    const stepRange = spec.step;
    const minStep = stepRange ? stepRange[0] : 0.75;
    const maxStep = stepRange ? stepRange[1] : 1.35;
    const step = spec.minSize === 1 ? 1 : minStep + rng.nextDouble() * (maxStep - minStep);

    const hasExtras = spec.host !== undefined || spec.raw !== undefined;

    // 先把整条矿脉的形状累积到"本区块内索引 → 方块"的映射里，最后统一写入。
    //
    // 为什么不边走边写：那样后面的球会覆盖前面的球，而覆盖的结果取决于方块是否
    // "可替换"——花岗岩/凝灰岩可替换（会被后来的矿石吃掉），粗金属块却不可替换
    // （一旦写下就永远留着）。于是同类矿脉里粗金属块的比例会被系统性放大好几倍
    // （实测粗铜块/花岗岩 = 0.28，配置只有 0.048）。
    // 先累积再统一写入之后，每格只由"最后一次经过它的那一簇"决定，各类方块的
    // 存活条件完全一致，比例也就回到配置值。
    const pending = this.pending;
    pending.clear();

    let x = startX;
    let y = startY;
    let z = startZ;

    for (let i = 0; i < size; i++) {
      // 每一步先确定这一簇该放什么（消耗次数固定，见上面的说明）
      let tile = ORE_MARKER;
      if (hasExtras) {
        const typeRoll = rng.nextDouble();
        const rawRoll = rng.nextDouble();
        if (spec.raw !== undefined && rawRoll < (spec.rawRatio ?? 0)) tile = spec.raw;
        else if (spec.host !== undefined && typeRoll < (spec.hostRatio ?? 0)) tile = spec.host;
      }

      if (radius > 0) {
        const r = Math.ceil(radius);
        const cx = Math.round(x);
        const cy = Math.round(y);
        const cz = Math.round(z);
        // 球体与本区块不相交时不必展开。这只是一次纯几何剔除，
        // 不消耗随机数，所以不会影响跨区块重建的一致性。
        if (
          cx + r >= originX &&
          cx - r <= originX + CHUNK_SIZE_X - 1 &&
          cz + r >= originZ &&
          cz - r <= originZ + CHUNK_SIZE_Z - 1
        ) {
          for (let ox = -r; ox <= r; ox++) {
            for (let oy = -r; oy <= r; oy++) {
              for (let oz = -r; oz <= r; oz++) {
                if (ox * ox + oy * oy + oz * oz > radius * radius) continue;
                const worldY = cy + oy;
                if (worldY < -64 || worldY >= 320) continue;
                const lx = cx + ox - originX;
                const lz = cz + oz - originZ;
                if (lx < 0 || lx >= CHUNK_SIZE_X || lz < 0 || lz >= CHUNK_SIZE_Z) continue;
                pending.set(Chunk.index(lx, worldY, lz), tile);
              }
            }
          }
        }
      } else {
        const worldY = Math.round(y);
        const lx = Math.round(x) - originX;
        const lz = Math.round(z) - originZ;
        if (worldY >= -64 && worldY < 320 && lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
          pending.set(Chunk.index(lx, worldY, lz), tile);
        }
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

    for (const [index, tile] of pending) {
      const current = blocks[index]!;
      if (!this.carvable.has(current)) continue;
      // 不覆盖已有矿石（避免大矿脉把钻石矿吃掉）
      if (ORE_BLOCKS.has(current)) continue;

      if (tile === ORE_MARKER) {
        // 深板岩区域用深板岩变体
        blocks[index] = current === Block.DEEPSLATE ? spec.deepslate : spec.ore;
      } else {
        blocks[index] = tile;
      }
    }
    pending.clear();
  }
}

/** 点 (x,z) 到区块 [chunkX, chunkX+15] × [chunkZ, chunkZ+15] 的切比雪夫距离 */
function distanceToChunk(x: number, z: number, chunkX: number, chunkZ: number): number {
  const dx = Math.max(chunkX - x, x - (chunkX + CHUNK_SIZE_X - 1), 0);
  const dz = Math.max(chunkZ - z, z - (chunkZ + CHUNK_SIZE_Z - 1), 0);
  return Math.max(dx, dz);
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

/**
 * 含水层（Aquifer）—— 1.18 的地下流体填充
 *
 * 原版的 Aquifer 挂在密度场计算里：凡是密度 ≤ 0（也就是"石头被挖掉"）的位置，
 * 都要问一次含水层"这里该放水、岩浆还是空气"。它的水位由两个二维噪声决定：
 *
 *   - `fluid_level_floodedness`：该点是否被淹没。值越高水位越接近海平面，
 *     值很低时水位掉到世界底部附近（也就是"干的"）；
 *   - `fluid_level_spread`：水位的水平散布，避免整片地下一刀切出平整水面，
 *     而是形成原版那种"一层层台阶状的地下水面"。
 *
 * 本实现按同样的思路落地，但采样方式适配我们的生成流程：
 * 我们的洞穴是**雕刻器**（在填石头之后挖）而不是密度场的一部分，
 * 所以含水层放在雕刻之后运行，把雕刻出来的空洞按水位灌满流体。
 * 因此效果与原版一致：地表以下、水位以下的空洞是水（深部是岩浆），
 * 水位以上保持空气。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { type BlockArray, CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_MIN_Y } from '../world/Chunk.ts';
import { DoublePerlinNoise } from './noise/PerlinNoise.ts';
import type { Random } from './noise/Random.ts';

/** 岩浆层高度（与原版一致：y ≤ -54 的地下空洞被岩浆填满） */
export const LAVA_LEVEL = -54;

/**
 * 淹没度阈值：低于 SUBMERGED_LOW 视为完全没水，高于 SUBMERGED_HIGH 视为被水淹到海平面。
 * 噪声标准差 ≈ 1，因此这两条线大约切掉两端各 30% 的分布，中段做平滑过渡。
 */
const SUBMERGED_LOW = -0.45;
const SUBMERGED_HIGH = 0.55;

/** 深部岩浆池的噪声阈值（值越高越稀有） */
const LAVA_POCKET_THRESHOLD = 0.72;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 水位栅格的四周留一圈，避免相邻区块的水面在边界处出现台阶状裂缝 */
const LEVEL_MARGIN = 1;
const LEVEL_SIZE = (CHUNK_SIZE_X + LEVEL_MARGIN * 2) * (CHUNK_SIZE_Z + LEVEL_MARGIN * 2);

export class Aquifer {
  private readonly floodedness: DoublePerlinNoise;
  private readonly spread: DoublePerlinNoise;
  private readonly lavaNoise: DoublePerlinNoise;

  /** 当前区块的水位栅格（含 1 格外扩，便于将来做双线性插值） */
  private readonly levels = new Float32Array(LEVEL_SIZE);

  constructor(
    random: Random,
    private readonly seaLevel: number,
  ) {
    this.floodedness = new DoublePerlinNoise(random, -7, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    this.spread = new DoublePerlinNoise(random, -5, [1, 2, 1]);
    this.lavaNoise = new DoublePerlinNoise(random, -3, [1, 1, 0, 0]);
  }

  /** 单列水位（世界坐标），落在 [WORLD_MIN_Y+6, seaLevel] 之间 */
  waterLevelAt(worldX: number, worldZ: number): number {
    const flooded = this.floodedness.getValue(worldX, 0, worldZ);
    const t = clamp01((flooded - SUBMERGED_LOW) / (SUBMERGED_HIGH - SUBMERGED_LOW));
    // 平滑过渡（smoothstep），避免水位随淹没度线性变化时出现折角
    const smooth = t * t * (3 - 2 * t);

    const lowest = WORLD_MIN_Y + 6;
    const base = lowest + (this.seaLevel - lowest) * smooth;
    // 加一点水平散布：相邻列水位可以差几格，形成原版那种层叠水面
    const jitter = this.spread.getValue(worldX, 0, worldZ) * 3.5;
    const level = base + jitter;
    return level < lowest ? lowest : level > this.seaLevel ? this.seaLevel : level;
  }

  /** 该点的流体方块 id（水 / 岩浆） */
  fluidAt(worldX: number, y: number, worldZ: number): number {
    if (y <= LAVA_LEVEL) return Block.LAVA;
    if (y < 0 && this.lavaNoise.getValue(worldX, y, worldZ) > LAVA_POCKET_THRESHOLD) return Block.LAVA;
    return Block.WATER;
  }

  /** 预采样当前区块的水位栅格 */
  private prepareLevels(originX: number, originZ: number): void {
    const stride = CHUNK_SIZE_X + LEVEL_MARGIN * 2;
    for (let z = 0; z < CHUNK_SIZE_Z + LEVEL_MARGIN * 2; z++) {
      const worldZ = originZ + z - LEVEL_MARGIN;
      for (let x = 0; x < CHUNK_SIZE_X + LEVEL_MARGIN * 2; x++) {
        const worldX = originX + x - LEVEL_MARGIN;
        this.levels[z * stride + x] = this.waterLevelAt(worldX, worldZ);
      }
    }
  }

  /**
   * 把雕刻后的地下空洞灌满流体。只填空气，所以不会破坏已有的海水/岩浆。
   * @returns 本次填充的水与岩浆方块数（供统计脚本与测试使用）
   */
  fill(blocks: BlockArray, originX: number, originZ: number): { water: number; lava: number } {
    this.prepareLevels(originX, originZ);

    const stride = CHUNK_SIZE_X + LEVEL_MARGIN * 2;
    let water = 0;
    let lava = 0;

    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const level = this.levels[(z + LEVEL_MARGIN) * stride + (x + LEVEL_MARGIN)]!;
        const highest = Math.floor(level);
        if (highest <= WORLD_MIN_Y + 1) continue;

        const worldX = originX + x;
        const worldZ = originZ + z;

        for (let y = WORLD_MIN_Y + 1; y <= highest; y++) {
          const index = Chunk.index(x, y, z);
          if (blocks[index] !== Block.AIR) continue;
          const fluid = this.fluidAt(worldX, y, worldZ);
          blocks[index] = fluid;
          if (fluid === Block.LAVA) lava++;
          else water++;
        }
      }
    }

    return { water, lava };
  }
}

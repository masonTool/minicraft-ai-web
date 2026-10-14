/**
 * 主世界地形生成器（1.18 体系）
 *
 * 结构完全对齐 1.18 的"噪声路由器"思路：
 *   1. 二维气候噪声：大陆度 / 侵蚀度 / 奇异度 / 温度 / 湿度
 *      （大陆度决定海陆分布；侵蚀度决定地形起伏强度；奇异度经折叠后给出峰谷）
 *   2. 样条插值：气候参数 → 高度偏移、起伏系数、山脊锐度
 *   3. 三维密度：地表高度梯度 + 三维噪声细节 → 密度场（> 0 为固体）
 *   4. 密度场按 4×8×4 的粗网格采样 + 三线性插值（原版同款做法，
 *      每个区块只需 5×49×5 = 1225 次采样，而不是 98304 次）
 *   5. 地表规则 + 灌水 + 基岩层
 *
 * ⚠️ 诚实说明：这是**算法结构与官方一致、参数经视觉校准**的实现，
 * 不是逐位对齐官方 noise_settings JSON 的复刻（后者依赖官方数据包文件）。
 * 群系分布、洞穴雕刻、含水层将在 D6~D12 继续补齐。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, WORLD_HEIGHT, WORLD_MIN_Y } from '../world/Chunk.ts';
import { CaveCarver } from './CaveCarver.ts';
import { bandBlockAt, columnSurface } from './SurfaceRules.ts';
import { OreGenerator } from './OreGenerator.ts';
import { applyClimateGain, biomeForColumn, findLandBiome, type BiomeDef } from './Biome.ts';
import { DoublePerlinNoise, NormalNoise } from './noise/PerlinNoise.ts';
import { Random } from './noise/Random.ts';
import { Spline } from './noise/Spline.ts';

/** 海平面（原版主世界海平面为 y=63） */
export const SEA_LEVEL = 63;

/** 密度采样单元格：水平 4 格、竖直 8 格，与原版一致 */
const CELL_XZ = 4;
const CELL_Y = 8;
const GRID_XZ = CHUNK_SIZE_X / CELL_XZ + 1; // 5
const GRID_Y = WORLD_HEIGHT / CELL_Y + 1; // 49

/** 气候通道数：大陆度 / 侵蚀度 / 奇异度 / 温度 / 湿度 */
const CHANNELS = 5;

/** 深板岩起始深度（原版 y=0 附近开始过渡） */
const DEEPSLATE_TOP = 0;
const DEEPSLATE_FULL = -8;

/** 稳定种子混合，用于给子生成器派生独立随机流 */
function mixSeed(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 原版的峰谷折叠函数 */
function peaksAndValleys(weirdness: number): number {
  return -(Math.abs(Math.abs(weirdness) - 0.6666667) - 0.33333334) * 3;
}

function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

export class OverworldGenerator {
  private readonly continents: DoublePerlinNoise;
  private readonly erosion: DoublePerlinNoise;
  private readonly ridges: DoublePerlinNoise;
  private readonly temperature: DoublePerlinNoise;
  private readonly humidity: DoublePerlinNoise;
  /** 三维细节噪声：制造悬崖、洞穴口、悬垂 */
  private readonly detail3d: NormalNoise;
  /** 山脊噪声：制造尖锐山峰 */
  private readonly ridgeNoise: NormalNoise;

  private readonly offsetSpline: Spline;
  private readonly factorSpline: Spline;
  private readonly jaggednessSpline: Spline;

  private readonly carver: CaveCarver;
  private readonly oreGenerator: OreGenerator;

  // 复用缓冲区，避免每次生成都重新分配
  private readonly climateGrid = new Float32Array(GRID_XZ * GRID_XZ * CHANNELS);
  private readonly densityGrid = new Float32Array(GRID_XZ * GRID_XZ * GRID_Y);

  constructor(seed: number) {
    const random = new Random(seed);

    // firstOctave / amplitudes 采用官方 overworld 的公开参数
    this.continents = new DoublePerlinNoise(random, -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    this.erosion = new DoublePerlinNoise(random, -9, [1, 1, 0, 1, 1]);
    this.ridges = new DoublePerlinNoise(random, -7, [1, 2, 1, 0, 0, 0]);
    this.temperature = new DoublePerlinNoise(random, -10, [1.5, 0, 1, 0, 0, 0]);
    this.humidity = new DoublePerlinNoise(random, -8, [1, 1, 0, 0, 0, 0]);
    this.detail3d = new NormalNoise(random, -5, [1, 1, 1, 0.6, 0.3]);
    this.ridgeNoise = new NormalNoise(random, -3, [1, 0.7]);

    // 大陆度 → 高度偏移。
    // 校准目标：偏移 ≈ 0 时地表刚好落在海平面附近（即海岸线），
    // 因此大陆度约 -0.22 以上为陆地，海陆比接近原版的"约一半海洋"。
    this.offsetSpline = new Spline([
      { location: -1.1, value: -0.3 },
      { location: -0.78, value: -0.25 },
      { location: -0.55, value: -0.16 },
      { location: -0.4, value: -0.07 },
      { location: -0.24, value: 0.0 },
      { location: -0.1, value: 0.06 },
      { location: 0.05, value: 0.11 },
      { location: 0.25, value: 0.17 },
      { location: 0.5, value: 0.24 },
      { location: 0.8, value: 0.32 },
      { location: 1.1, value: 0.38 },
    ]);

    // 侵蚀度 → 起伏强度（侵蚀度越低越崎岖）
    this.factorSpline = new Spline([
      { location: -1.1, value: 1.55 },
      { location: -0.7, value: 1.2 },
      { location: -0.4, value: 0.85 },
      { location: -0.15, value: 0.55 },
      { location: 0.15, value: 0.32 },
      { location: 0.45, value: 0.14 },
      { location: 0.75, value: 0.05 },
      { location: 1.1, value: 0.0 },
    ]);

    // 侵蚀度 → 山脊锐度（只在地形崎岖的区域生效）
    this.jaggednessSpline = new Spline([
      { location: -1.1, value: 0.95 },
      { location: -0.85, value: 0.7 },
      { location: -0.65, value: 0.42 },
      { location: -0.5, value: 0.18 },
      { location: -0.35, value: 0.04 },
      { location: -0.2, value: 0.0 },
      { location: 1.1, value: 0.0 },
    ]);

    this.carver = new CaveCarver(new Random(mixSeed(seed, 0xc0ffee)));
    this.oreGenerator = new OreGenerator(seed);
  }

  /** 采样一列的气候参数，写入 climateGrid 的指定槽位 */
  private sampleClimate(x: number, z: number, slot: number): void {
    const grid = this.climateGrid;
    grid[slot] = this.continents.getValue(x, 0, z);
    grid[slot + 1] = this.erosion.getValue(x, 0, z);
    grid[slot + 2] = this.ridges.getValue(x, 0, z);
    grid[slot + 3] = this.temperature.getValue(x, 0, z);
    grid[slot + 4] = this.humidity.getValue(x, 0, z);
  }

  /** 该点对外的气候参数（供生物群系与地表规则使用） */
  climateAt(x: number, z: number): { continent: number; erosion: number; weirdness: number; temperature: number; humidity: number } {
    return {
      continent: this.continents.getValue(x, 0, z),
      erosion: this.erosion.getValue(x, 0, z),
      weirdness: this.ridges.getValue(x, 0, z),
      temperature: this.temperature.getValue(x, 0, z),
      humidity: this.humidity.getValue(x, 0, z),
    };
  }

  /**
   * 该列所属的生物群系。
   * 地形采样出的五个气候参数直接作为参数空间坐标交给群系匹配器；
   * depth 维度目前恒为 0（所有群系的 depth 区间都是全集，不影响匹配结果）。
   */
  biomeAt(x: number, z: number): BiomeDef {
    return findLandBiome(
      applyClimateGain({
        temperature: this.temperature.getValue(x, 0, z),
        humidity: this.humidity.getValue(x, 0, z),
        continentalness: this.continents.getValue(x, 0, z),
        erosion: this.erosion.getValue(x, 0, z),
        depth: 0,
        weirdness: this.ridges.getValue(x, 0, z),
      }),
    );
  }

  /**
   * 密度场：> 0 为固体。
   * @param slot climateGrid 中该列气候参数起始下标
   */
  private densityAt(x: number, y: number, z: number, slot: number): number {
    const grid = this.climateGrid;
    const continent = grid[slot]!;
    const erosion = grid[slot + 1]!;
    const weirdness = grid[slot + 2]!;

    const offset = this.offsetSpline.apply(continent);
    const factor = this.factorSpline.apply(erosion);
    const jaggedness = this.jaggednessSpline.apply(erosion);
    const pv = peaksAndValleys(weirdness);

    // 目标地表高度
    let surface = SEA_LEVEL + offset * 96;
    surface += pv * factor * 40;
    if (jaggedness > 0.001) surface += jaggedness * Math.abs(this.ridgeNoise.getValue(x, 0, z)) * 46;

    // 竖直梯度 + 三维细节
    const gradient = (surface - y) / 26;
    const detail = this.detail3d.getValue(x, y, z);
    let density = gradient + detail * (0.5 + factor * 0.85);

    // 深处强制实心，避免出现大片浮空岛（洞穴由 D10 的雕刻器另行挖出）
    if (y < surface - 34) density = Math.max(density, 1);
    return density;
  }

  generate(cx: number, cz: number, out?: Uint8Array): Uint8Array {
    const blocks = out ?? new Uint8Array(CHUNK_VOLUME);
    if (out) blocks.fill(0);

    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;

    this.sampleGrid(originX, originZ);
    this.fillFromDensity(blocks);
    this.applySurface(blocks, originX, originZ);
    this.applyBedrock(blocks);

    // 雕刻顺序对齐原版：地形 → 地表规则 → 雕刻 → 矿石
    this.carver.carve(blocks, originX, originZ);
    this.oreGenerator.generate(blocks, cx, cz, (wx, wz) => this.erosion.getValue(wx, 0, wz));

    return blocks;
  }

  /** 第一步：在粗网格上采样气候与密度 */
  private sampleGrid(originX: number, originZ: number): void {
    for (let gx = 0; gx < GRID_XZ; gx++) {
      const worldX = originX + gx * CELL_XZ;
      for (let gz = 0; gz < GRID_XZ; gz++) {
        const worldZ = originZ + gz * CELL_XZ;
        const slot = (gx * GRID_XZ + gz) * CHANNELS;
        this.sampleClimate(worldX, worldZ, slot);

        const densityBase = (gx * GRID_XZ + gz) * GRID_Y;
        for (let gy = 0; gy < GRID_Y; gy++) {
          const worldY = WORLD_MIN_Y + gy * CELL_Y;
          this.densityGrid[densityBase + gy] = this.densityAt(worldX, worldY, worldZ, slot);
        }
      }
    }
  }

  /** 第二步：三线性插值填石头 */
  private fillFromDensity(blocks: Uint8Array): void {
    const grid = this.densityGrid;

    for (let gx = 0; gx < GRID_XZ - 1; gx++) {
      for (let gz = 0; gz < GRID_XZ - 1; gz++) {
        const base000 = (gx * GRID_XZ + gz) * GRID_Y;
        const base100 = ((gx + 1) * GRID_XZ + gz) * GRID_Y;
        const base001 = (gx * GRID_XZ + (gz + 1)) * GRID_Y;
        const base101 = ((gx + 1) * GRID_XZ + (gz + 1)) * GRID_Y;

        for (let gy = 0; gy < GRID_Y - 1; gy++) {
          const d000 = grid[base000 + gy]!;
          const d001 = grid[base001 + gy]!;
          const d100 = grid[base100 + gy]!;
          const d101 = grid[base101 + gy]!;
          const d010 = grid[base000 + gy + 1]!;
          const d011 = grid[base001 + gy + 1]!;
          const d110 = grid[base100 + gy + 1]!;
          const d111 = grid[base101 + gy + 1]!;

          const cellBaseY = WORLD_MIN_Y + gy * CELL_Y;

          for (let iy = 0; iy < CELL_Y; iy++) {
            const ty = iy / CELL_Y;
            // 先沿 Y 方向插值，减少内层重复计算
            const d00 = d000 + (d010 - d000) * ty;
            const d01 = d001 + (d011 - d001) * ty;
            const d10 = d100 + (d110 - d100) * ty;
            const d11 = d101 + (d111 - d101) * ty;

            const worldY = cellBaseY + iy;
            const yIndexBase = (worldY - WORLD_MIN_Y) * CHUNK_SIZE_Z * CHUNK_SIZE_X;

            for (let ix = 0; ix < CELL_XZ; ix++) {
              const tx = ix / CELL_XZ;
              const d0 = d00 + (d10 - d00) * tx;
              const d1 = d01 + (d11 - d01) * tx;
              const xBase = yIndexBase + (gx * CELL_XZ + ix);

              for (let iz = 0; iz < CELL_XZ; iz++) {
                const tz = iz / CELL_XZ;
                const density = d0 + (d1 - d0) * tz;
                if (density <= 0) continue;

                const worldX = gx * CELL_XZ + ix;
                const worldZ = gz * CELL_XZ + iz;
                blocks[xBase + worldZ * CHUNK_SIZE_X] =
                  worldY >= DEEPSLATE_TOP
                    ? Block.STONE
                    : worldY <= DEEPSLATE_FULL
                      ? Block.DEEPSLATE
                      : hash2(worldX, worldZ * 31 + worldY, 17) < (worldY - DEEPSLATE_FULL) / -DEEPSLATE_FULL
                        ? Block.STONE
                        : Block.DEEPSLATE;
              }
            }
          }
        }
      }
    }
  }

  /** 第三步：地表规则 + 灌水 */
  private applySurface(blocks: Uint8Array, originX: number, originZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const worldX = originX + x;
        const worldZ = originZ + z;

        // 找最高固体方块
        let top = WORLD_MIN_Y - 1;
        for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
          if (blocks[Chunk.index(x, y, z)] !== Block.AIR) {
            top = y;
            break;
          }
        }
        if (top < WORLD_MIN_Y) continue;

        const raw = this.climateAt(worldX, worldZ);
        const biome = biomeForColumn(
          {
            temperature: raw.temperature,
            humidity: raw.humidity,
            continentalness: raw.continent,
            erosion: raw.erosion,
            depth: 0,
            weirdness: raw.weirdness,
          },
          top,
          SEA_LEVEL,
        );
        const underwater = top < SEA_LEVEL;

        // 地表分层交给 SurfaceRules：群系地表 → 次表层 → （恶地的）深层彩色色带
        const profile = columnSurface(biome, top, SEA_LEVEL, worldX, worldZ);

        blocks[Chunk.index(x, top, z)] = profile.surface;
        for (let d = 1; d <= profile.subDepth; d++) {
          const y = top - d;
          if (y < WORLD_MIN_Y) break;
          const current = blocks[Chunk.index(x, y, z)]!;
          if (current !== Block.STONE && current !== Block.DEEPSLATE) break;
          blocks[Chunk.index(x, y, z)] = profile.subSurface;
        }

        // 恶地：次表层之下继续铺彩色陶瓦色带（原版恶地最标志性的特征）
        if (profile.deepBands) {
          const from = top - profile.subDepth - 1;
          const to = Math.max(WORLD_MIN_Y, top - profile.deepDepth);
          for (let y = from; y >= to; y--) {
            const current = blocks[Chunk.index(x, y, z)]!;
            if (current !== Block.STONE && current !== Block.DEEPSLATE) continue;
            blocks[Chunk.index(x, y, z)] = bandBlockAt(profile.deepBands, worldX, y, worldZ);
          }
        }

        // 灌水到海平面
        if (underwater) {
          for (let y = top + 1; y <= SEA_LEVEL; y++) {
            blocks[Chunk.index(x, y, z)] = Block.WATER;
          }
        }
      }
    }
  }

  /** 第四步：底部基岩层（越深越密，形成原版的参差不齐过渡） */
  private applyBedrock(blocks: Uint8Array): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        blocks[Chunk.index(x, WORLD_MIN_Y, z)] = Block.BEDROCK;
        for (let d = 1; d <= 4; d++) {
          const y = WORLD_MIN_Y + d;
          const chance = 1 - d / 5;
          if (hash2(x * 7 + y, z * 13, 91) < chance * chance) blocks[Chunk.index(x, y, z)] = Block.BEDROCK;
        }
      }
    }
  }
}

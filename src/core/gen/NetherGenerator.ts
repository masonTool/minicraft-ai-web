/**
 * 下界地形生成器
 *
 * 与主世界完全不同的生成逻辑：
 *   岩浆海（y ≤ 32）→ 洞窟（2D 地板/天花板高度 + 3D 团块噪声 + 粗网格插值）
 *   → 基岩（底 4 层 / 顶 2 层）→ 群系地表（菌岩 / 灵魂沙 / 玄武岩 / 下界岩）
 *   → 矿石（石英 / 远古残骸）→ 地物（菌菇树 / 荧光石簇 / 玄武岩柱 / 灵魂沙斑块 / 岩浆泉）
 *
 * 与原版的差距（已记录到 TASKS.md）：
 *  - 群系用"极坐标分区"近似原版的 multi_noise（5 个下界群系都会出现，但边界形状不同）；
 *  - 没有下界要塞、堡垒遗迹、废弃传送门（结构系统只做了主世界的 7 种）；
 *  - 洞穴形态是"噪声团块"，不是原版的噪声洞穴雕刻器。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { type BlockArray, CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_MAX_Y, WORLD_MIN_Y, createBlockArray } from '../world/Chunk.ts';
import { DoublePerlinNoise, NormalNoise } from './noise/PerlinNoise.ts';
import { Random } from './noise/Random.ts';
import { FeatureWriter, hashAt, PositionalRng } from './Features.ts';

/** 岩浆海面高度（原版下界岩浆海在 y=32） */
export const NETHER_LAVA_LEVEL = 32;
/** 洞顶起始高度（再往上就是实心岩层） */
export const NETHER_CEILING = 118;
/** 洞顶实心岩层一直铺到这一层，再往上两层是基岩 */
export const NETHER_ROOF = 126;
/** 洞窟噪声网格的起点与层数（覆盖 y ∈ [8, 136]） */
const GRID_Y0 = 8;
const GRID_Y_COUNT = 17;
const CELL_XZ = 4;
const CELL_Y = 8;
const GRID_XZ = CHUNK_SIZE_X / CELL_XZ + 1; // 5

/** 下界群系 */
export const NetherBiome = {
  NETHER_WASTES: 0,
  SOUL_SAND_VALLEY: 1,
  CRIMSON_FOREST: 2,
  WARPED_FOREST: 3,
  BASALT_DELTAS: 4,
} as const;

export const NETHER_BIOME_NAMES: readonly string[] = [
  'nether_wastes',
  'soul_sand_valley',
  'crimson_forest',
  'warped_forest',
  'basalt_deltas',
];

function mixSeed(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export class NetherGenerator {
  /** 群系极坐标的两个参数 */
  private readonly biomeA: DoublePerlinNoise;
  private readonly biomeB: DoublePerlinNoise;
  /** 洞窟团块噪声（决定洞窟中间的实心块） */
  private readonly caves: NormalNoise;
  /** 洞窟细节噪声（把团块边缘打碎） */
  private readonly detail: NormalNoise;
  /** 地形起伏 */
  private readonly relief: DoublePerlinNoise;


  /** 洞窟噪声的粗网格缓存（每个区块生成一次） */
  private readonly caveGrid = new Float32Array(GRID_XZ * GRID_XZ * GRID_Y_COUNT);
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    const random = new Random(mixSeed(seed, 0x11e7));
    this.biomeA = new DoublePerlinNoise(random, -6, [1, 1, 1]);
    this.biomeB = new DoublePerlinNoise(random, -6, [1, 1, 0.5]);
    this.caves = new NormalNoise(random, -6, [1, 1, 1, 0.5]);
    this.detail = new NormalNoise(random, -3, [1, 0.5]);
    this.relief = new DoublePerlinNoise(random, -7, [1, 1, 0.5]);
  }

  // ---------------------------------------------------------------- 高度与群系（纯函数）

  /**
   * 该列的地板高度。
   *
   * 范围故意跨过岩浆海面（28~46）：低于海面的列就成了真正的"岩浆海"，
   * 高于海面的列是下界岩地台——这正是原版下界的样子。
   */
  floorAt(x: number, z: number): number {
    const raw = NETHER_LAVA_LEVEL - 4 + (this.relief.getValue(x, 0, z) * 0.5 + 0.5) * 18;
    // ⚠️ 必须夹紧：噪声值偶尔会超出 ±1（双 Perlin 的尾部），不夹紧会出现
    // 地板高过岩浆海面 20 格、或者洞顶被顶穿到 120 以上的极端列。
    return Math.max(NETHER_LAVA_LEVEL - 8, Math.min(NETHER_LAVA_LEVEL + 18, Math.round(raw)));
  }

  /** 该列的洞顶高度 */
  ceilingAt(x: number, z: number): number {
    const raw = NETHER_CEILING - 4 - (this.relief.getValue(x + 512, 0, z - 512) * 0.5 + 0.5) * 8;
    // 夹紧到 [106, NETHER_CEILING]：洞顶永远不高于 NETHER_CEILING，保证 118 以上是整层实心
    return Math.max(106, Math.min(NETHER_CEILING, Math.round(raw)));
  }

  /**
   * 该列的群系。
   *
   * 用两个噪声当作极坐标：半径小 → 下界荒原（作为"背景"），
   * 外围再按角度切成灵魂沙峡谷 / 绯红森林 / 诡异森林 / 玄武岩三角洲四块。
   * 原版是六维参数空间的最近匹配，这里用极坐标分区近似，五个群系都会成片出现。
   */
  biomeAt(x: number, z: number): number {
    const a = this.biomeA.getValue(x, 0, z);
    const b = this.biomeB.getValue(x, 0, z);
    const radius = Math.hypot(a, b);
    if (radius < 0.28) return NetherBiome.NETHER_WASTES;

    // 角度再加一点噪声扰动，边界就不会是笔直的放射线
    const jitter = this.detail.getValue(x, 0, z) * 0.35;
    const angle = Math.atan2(b, a) + jitter;
    const sector = Math.floor(((angle + Math.PI) / (Math.PI / 2)) % 4);
    switch (sector) {
      case 0:
        return NetherBiome.SOUL_SAND_VALLEY;
      case 1:
        return NetherBiome.CRIMSON_FOREST;
      case 2:
        return NetherBiome.WARPED_FOREST;
      default:
        return NetherBiome.BASALT_DELTAS;
    }
  }

  /** 该列的地表高度（地板），供地物使用；下界是解析式，精确且与世界坐标一一对应 */
  surfaceY(x: number, z: number): number {
    return this.floorAt(x, z);
  }

  // ---------------------------------------------------------------- 生成

  generate(cx: number, cz: number, out?: BlockArray): BlockArray {
    const blocks = out ?? createBlockArray();
    if (out) blocks.fill(0);

    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;

    this.sampleCaveGrid(originX, originZ);
    this.fillTerrain(blocks, originX, originZ);
    this.applySurface(blocks, originX, originZ);
    this.generateOres(blocks, cx, cz, originX, originZ);
    this.decorate(blocks, cx, cz, originX, originZ);

    return blocks;
  }

  /** 粗网格采样洞窟噪声（4×8×4，块内三线性插值），避免逐格采样 3D 噪声 */
  private sampleCaveGrid(originX: number, originZ: number): void {
    for (let gx = 0; gx < GRID_XZ; gx++) {
      for (let gz = 0; gz < GRID_XZ; gz++) {
        const worldX = originX + gx * CELL_XZ;
        const worldZ = originZ + gz * CELL_XZ;
        const base = (gx * GRID_XZ + gz) * GRID_Y_COUNT;
        for (let gy = 0; gy < GRID_Y_COUNT; gy++) {
          const worldY = GRID_Y0 + gy * CELL_Y;
          // 团块噪声 + 细节：两者都在粗网格上采样，插值后仍然有足够的破碎感
          this.caveGrid[base + gy] = this.caves.getValue(worldX, worldY, worldZ) + this.detail.getValue(worldX, worldY, worldZ) * 0.35;
        }
      }
    }
  }

  /** 粗网格插值取某点的洞窟密度 */
  private caveAt(localX: number, worldY: number, localZ: number): number {
    const gxf = localX / CELL_XZ;
    const gzf = localZ / CELL_XZ;
    const gyf = (worldY - GRID_Y0) / CELL_Y;

    const gx0 = Math.max(0, Math.min(GRID_XZ - 2, Math.floor(gxf)));
    const gz0 = Math.max(0, Math.min(GRID_XZ - 2, Math.floor(gzf)));
    const gy0 = Math.max(0, Math.min(GRID_Y_COUNT - 2, Math.floor(gyf)));
    const tx = gxf - gx0;
    const tz = gzf - gz0;
    const ty = gyf - gy0;

    const grid = this.caveGrid;
    const at = (gx: number, gy: number, gz: number): number => grid[(gx * GRID_XZ + gz) * GRID_Y_COUNT + gy]!;

    const c000 = at(gx0, gy0, gz0);
    const c100 = at(gx0 + 1, gy0, gz0);
    const c001 = at(gx0, gy0, gz0 + 1);
    const c101 = at(gx0 + 1, gy0, gz0 + 1);
    const c010 = at(gx0, gy0 + 1, gz0);
    const c110 = at(gx0 + 1, gy0 + 1, gz0);
    const c011 = at(gx0, gy0 + 1, gz0 + 1);
    const c111 = at(gx0 + 1, gy0 + 1, gz0 + 1);

    const c00 = c000 + (c100 - c000) * tx;
    const c01 = c001 + (c101 - c001) * tx;
    const c10 = c010 + (c110 - c010) * tx;
    const c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c01 - c00) * tz;
    const c1 = c10 + (c11 - c10) * tz;
    return c0 + (c1 - c0) * ty;
  }

  /** 地形主体：地板以下实心、洞顶以上实心、中间按洞窟噪声决定 */
  private fillTerrain(blocks: BlockArray, originX: number, originZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const worldX = originX + x;
        const worldZ = originZ + z;
        const floor = this.floorAt(worldX, worldZ);
        const ceiling = this.ceilingAt(worldX, worldZ);

        const low = WORLD_MIN_Y;
        const high = Math.min(WORLD_MAX_Y - 1, NETHER_ROOF + 1);

        for (let y = low; y <= high; y++) {
          let solid: boolean;
          if (y <= floor) solid = true;
          else if (y >= ceiling) solid = true;
          else solid = this.caveAt(x, y, z) > 0.62;

          if (!solid) continue;
          // 底部 5 层与顶部 2 层是基岩（越靠边越密）
          let id: number = Block.NETHERRACK;
          if (y <= WORLD_MIN_Y + 4) id = Block.BEDROCK;
          else if (y >= NETHER_ROOF) id = Block.BEDROCK;
          blocks[Chunk.index(x, y, z)] = id;
        }
      }
    }
  }

  /**
   * 群系地表：
   *  - 绯红/诡异森林：地表铺菌岩（顶面朝上、天花板朝下）
   *  - 灵魂沙峡谷：灵魂沙 + 灵魂土，并向深处延伸几格
   *  - 玄武岩三角洲：玄武岩 + 黑石 + 岩浆块
   *  - 下界荒原：保持下界岩，撒一点岩浆块
   */
  private applySurface(blocks: BlockArray, originX: number, originZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const worldX = originX + x;
        const worldZ = originZ + z;
        const biome = this.biomeAt(worldX, worldZ);
        const floor = this.floorAt(worldX, worldZ);
        const ceiling = this.ceilingAt(worldX, worldZ);
        const noise = hashAt(worldX, worldZ, 0x9e11);

        // ---- 地面
        const top = this.solidTop(blocks, x, floor, z);
        if (top !== null) {
          this.applyGroundLayer(blocks, x, top, z, biome, noise);
        }

        // ---- 天花板（森林群系的天花板也长菌岩，原版如此）
        if (biome === NetherBiome.CRIMSON_FOREST || biome === NetherBiome.WARPED_FOREST) {
          const nylium = biome === NetherBiome.CRIMSON_FOREST ? Block.CRIMSON_NYLIUM : Block.WARPED_NYLIUM;
          for (let y = ceiling; y < NETHER_ROOF; y++) {
            if (blocks[Chunk.index(x, y, z)] !== Block.NETHERRACK) break;
            blocks[Chunk.index(x, y, z)] = nylium;
          }
        }

        // ---- 岩浆海：海面以下的空气灌岩浆（地板低于海面的列就形成岩浆海）
        for (let y = WORLD_MIN_Y + 5; y <= NETHER_LAVA_LEVEL; y++) {
          const index = Chunk.index(x, y, z);
          if (blocks[index] === Block.AIR) blocks[index] = Block.LAVA;
        }
      }
    }
  }

  /** 某列最上面的实心方块（地板到洞顶之间），没有返回 null */
  private solidTop(blocks: BlockArray, x: number, floor: number, z: number): number | null {
    // 从地板上方往上找第一格实心（团块噪声可能在地板上方又堆出石头）
    const limit = Math.min(WORLD_MAX_Y - 1, NETHER_CEILING);
    for (let y = Math.min(limit, floor + 12); y >= WORLD_MIN_Y; y--) {
      if (blocks[Chunk.index(x, y, z)] !== Block.AIR) return y;
    }
    return null;
  }

  private applyGroundLayer(blocks: BlockArray, x: number, top: number, z: number, biome: number, noise: number): void {
    const set = (y: number, id: number): void => {
      if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
      blocks[Chunk.index(x, y, z)] = id;
    };

    switch (biome) {
      case NetherBiome.CRIMSON_FOREST:
      case NetherBiome.WARPED_FOREST: {
        const nylium = biome === NetherBiome.CRIMSON_FOREST ? Block.CRIMSON_NYLIUM : Block.WARPED_NYLIUM;
        set(top, nylium);
        for (let d = 1; d <= 2; d++) {
          if (blocks[Chunk.index(x, top - d, z)] === Block.NETHERRACK) set(top - d, nylium);
        }
        // 菌岩边缘混入下界岩，避免出现"整片同色地板"
        if (noise < 0.12) set(top, Block.NETHERRACK);
        break;
      }
      case NetherBiome.SOUL_SAND_VALLEY: {
        set(top, Block.SOUL_SAND);
        for (let d = 1; d <= 3; d++) {
          if (top - d < WORLD_MIN_Y) break;
          if (blocks[Chunk.index(x, top - d, z)] === Block.NETHERRACK) set(top - d, Block.SOUL_SOIL);
        }
        break;
      }
      case NetherBiome.BASALT_DELTAS: {
        set(top, noise < 0.45 ? Block.BASALT : Block.BLACKSTONE);
        for (let d = 1; d <= 3; d++) {
          if (top - d < WORLD_MIN_Y) break;
          if (blocks[Chunk.index(x, top - d, z)] === Block.NETHERRACK) set(top - d, Block.BASALT);
        }
        if (noise > 0.93) set(top, Block.MAGMA_BLOCK);
        break;
      }
      default: {
        // 下界荒原：地表保持下界岩，零星撒岩浆块
        if (noise > 0.96) set(top, Block.MAGMA_BLOCK);
        break;
      }
    }
  }

  /** 矿石：石英（常见，全高度）+ 远古残骸（稀有，y 8~22） */
  private generateOres(blocks: BlockArray, cx: number, cz: number, originX: number, originZ: number): void {
    const rng = new PositionalRng(cx, cz, this.seed ^ 0x0f0f);

    const veins: Array<{ id: number; count: number; size: number; minY: number; maxY: number }> = [
      { id: Block.NETHER_QUARTZ_ORE, count: 6 + rng.int(5), size: 6, minY: 10, maxY: 117 },
      { id: Block.ANCIENT_DEBRIS, count: rng.chance(0.75) ? 1 : 2, size: 3, minY: 8, maxY: 22 },
    ];

    for (const vein of veins) {
      for (let i = 0; i < vein.count; i++) {
        const baseX = originX + rng.int(CHUNK_SIZE_X);
        const baseZ = originZ + rng.int(CHUNK_SIZE_Z);
        const baseY = vein.minY + rng.int(vein.maxY - vein.minY);
        // 矿脉在小范围里游走
        let x = baseX;
        let y = baseY;
        let z = baseZ;
        for (let step = 0; step < vein.size; step++) {
          const localX = x - originX;
          const localZ = z - originZ;
          if (localX >= 0 && localX < CHUNK_SIZE_X && localZ >= 0 && localZ < CHUNK_SIZE_Z && y >= WORLD_MIN_Y && y < WORLD_MAX_Y) {
            const index = Chunk.index(localX, y, localZ);
            if (blocks[index] === Block.NETHERRACK) blocks[index] = vein.id;
          }
          x += rng.int(3) - 1;
          y += rng.int(3) - 1;
          z += rng.int(3) - 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 地物

  /**
   * 下界地物。
   *
   * 与主世界同样的跨区块约定：地物的坐标只依赖世界坐标（地板高度是解析式，
   * 岩浆海面是常数），因此 3×3 邻域重放时不会错位。
   */
  private decorate(blocks: BlockArray, cx: number, cz: number, originX: number, originZ: number): void {
    const writer = new FeatureWriter(blocks, cx, cz);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.decorateSource(writer, originX + dx * CHUNK_SIZE_X, originZ + dz * CHUNK_SIZE_Z);
      }
    }
  }

  private decorateSource(w: FeatureWriter, sourceX: number, sourceZ: number): void {
    const biome = this.biomeAt(sourceX + 8, sourceZ + 8);

    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = sourceX + x;
        const wz = sourceZ + z;
        const surface = this.surfaceY(wx, wz) + 1;
        const rng = new PositionalRng(wx, wz, this.seed ^ 0x77aa);

        // ---- 菌菇树（绯红/诡异森林）
        if (biome === NetherBiome.CRIMSON_FOREST || biome === NetherBiome.WARPED_FOREST) {
          const density = biome === NetherBiome.CRIMSON_FOREST ? 0.022 : 0.024;
          if (hashAt(wx, wz, this.seed ^ 0x1234) < density) {
            const crimson = biome === NetherBiome.CRIMSON_FOREST;
            this.fungusTree(w, wx, surface, wz, rng, crimson);
          }
          // 菌索 / 下界苗
          if (hashAt(wx, wz, this.seed ^ 0x5678) < 0.08) {
            const root = biome === NetherBiome.CRIMSON_FOREST ? Block.CRIMSON_ROOTS : Block.WARPED_ROOTS;
            w.put(wx, surface, wz, root);
          }
        }

        // ---- 灵魂沙峡谷：灵魂火把（用火把代替）+ 玄武岩柱
        if (biome === NetherBiome.SOUL_SAND_VALLEY) {
          if (hashAt(wx, wz, this.seed ^ 0x2468) < 0.015) {
            const height = 4 + rng.int(12);
            for (let h = 0; h < height; h++) w.fill(wx, surface + h, wz, Block.BASALT);
            w.fill(wx, surface + height, wz, Block.SOUL_SOIL);
          }
          if (hashAt(wx, wz, this.seed ^ 0x1357) < 0.04) w.put(wx, surface, wz, Block.SOUL_SOIL);
        }

        // ---- 玄武岩三角洲：玄武岩柱 + 岩浆块
        if (biome === NetherBiome.BASALT_DELTAS) {
          if (hashAt(wx, wz, this.seed ^ 0x9876) < 0.02) {
            const height = 3 + rng.int(9);
            for (let h = 0; h < height; h++) w.fill(wx, surface + h, wz, Block.BASALT);
          }
          if (hashAt(wx, wz, this.seed ^ 0x8765) < 0.05) w.fill(wx, surface - 1, wz, Block.MAGMA_BLOCK);
        }

        // ---- 荧光石簇：挂在天花板上（原版标志性的"灯"）
        if (hashAt(wx, wz, this.seed ^ 0xabcd) < 0.012) {
          const ceiling = this.ceilingAt(wx, wz) - 1;
          const size = 1 + rng.int(4);
          for (let i = 0; i < size; i++) {
            const gx = wx + rng.int(3) - 1;
            const gy = ceiling - rng.int(3);
            const gz = wz + rng.int(3) - 1;
            w.fill(gx, gy, gz, Block.GLOWSTONE);
          }
        }

        // ---- 岩浆泉：地面上冒出的岩浆
        if (hashAt(wx, wz, this.seed ^ 0x0bad) < 0.004) {
          const radius = 1 + rng.int(2);
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
              if (Math.abs(dx) + Math.abs(dz) > radius) continue;
              w.fill(wx + dx, surface - 1, wz + dz, Block.LAVA);
            }
          }
        }
      }
    }
  }

  /**
   * 测试/调试用：在指定世界坐标种一棵菌菇树。
   * 走的是与正式生成完全相同的代码路径，因此测到的形状就是世界里长出来的形状。
   */
  plantFungusTreeForTest(
    blocks: BlockArray,
    cx: number,
    cz: number,
    x: number,
    z: number,
    crimson: boolean,
    salt = 1,
  ): void {
    const writer = new FeatureWriter(blocks, cx, cz);
    this.fungusTree(writer, x, this.surfaceY(x, z) + 1, z, new PositionalRng(x, z, salt), crimson);
  }

  /** 一棵菌菇树：菌柄 + 菌盖（霓虹色的疣块 + 菌光体） */
  private fungusTree(w: FeatureWriter, x: number, y: number, z: number, rng: PositionalRng, crimson: boolean): void {
    const stem = crimson ? Block.CRIMSON_STEM : Block.WARPED_STEM;
    const wart = crimson ? Block.NETHER_WART_BLOCK : Block.WARPED_WART_BLOCK;
    const cap = crimson ? Block.CRIMSON_FUNGUS : Block.WARPED_FUNGUS;
    const height = 4 + rng.int(9);

    for (let h = 0; h < height; h++) w.fill(x, y + h, z, stem);
    const top = y + height;

    // 菌盖：3×3 的疣块 + 中间一层更大
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        w.fill(x + dx, top - 1, z + dz, wart);
        if (rng.chance(0.5)) w.fill(x + dx, top, z + dz, wart);
      }
    }
    w.fill(x, top, z, wart);
    if (rng.chance(0.35)) w.fill(x, top + 1, z, Block.SHROOMLIGHT);
    // 树顶小菌菇
    w.put(x, top + 1, z, cap);
  }
}

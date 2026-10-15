/**
 * 末地地形生成器
 *
 * 末地与主世界/下界都不同：它**不是连续地形**，而是一堆悬空的末地石岛。
 *   主岛（中心 0,0 半径 ~64 的钟形岛）→ 黑曜石柱（10 根环绕）→ 返回传送门（岛心）
 *   → 外岛（距中心 900 格以外，按 256 格的"岛屿单元"哈希散布）
 *   → 紫颂树（外岛上的末地独有植物）
 *
 * 跨区块约定与下界一致：岛的位置、高度、群系全部是世界坐标的纯函数
 * （单元哈希 + 噪声），所以 3×3 邻域重放时紫颂树不会错位。
 *
 * 与原版的差距（已记录到 TASKS.md）：
 *  - 外岛分布用"256 格单元哈希"近似原版的同心环岛屿，数量与位置不同；
 *  - 末地折跃门用末地传送门方块代替（没有独立的 end_gateway 方块）；
 *  - 末地城/末地船见 `EndStructures.ts`，末影龙见实体系统。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { type BlockArray, CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_MAX_Y, WORLD_MIN_Y, createBlockArray } from '../world/Chunk.ts';
import { NormalNoise } from './noise/PerlinNoise.ts';
import { Random } from './noise/Random.ts';
import { FeatureWriter, hashAt, PositionalRng } from './Features.ts';

/** 主岛半径（格） */
export const MAIN_ISLAND_RADIUS = 64;
/** 主岛中心的岛面高度 */
export const MAIN_ISLAND_TOP = 66;
/** 外岛从这个半径之外开始 */
export const OUTER_ISLAND_START = 900;
/** 外岛的单元网格尺寸（格） */
const OUTER_CELL = 256;
/** 黑曜石柱环的半径 */
const PILLAR_RING = 42;
/** 黑曜石柱数量 */
const PILLAR_COUNT = 10;

/** 末地生物群系 */
export const EndBiome = {
  THE_END: 0,
  END_HIGHLANDS: 1,
  END_MIDLANDS: 2,
  SMALL_END_ISLANDS: 3,
  END_BARRENS: 4,
  THE_VOID: 5,
} as const;

export const END_BIOME_NAMES: readonly string[] = [
  'the_end',
  'end_highlands',
  'end_midlands',
  'small_end_islands',
  'end_barrens',
  'the_void',
];

function mixSeed(seed: number, salt: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 一座岛的形状 */
export interface IslandInfo {
  /** 岛面高度（顶） */
  top: number;
  /** 岛底高度 */
  bottom: number;
  /** 是否主岛 */
  main: boolean;
  /** 岛心到该点的归一化距离（0 = 岛心，1 = 岛缘） */
  t: number;
  /** 岛半径 */
  radius: number;
}

/**
 * 10 根黑曜石柱的顶部坐标（柱顶基岩之上那一格）。
 *
 * 独立成一个不依赖类实例的函数：主线程要用它在柱顶生成末地水晶，
 * 而地形生成在 Worker 里——两边必须算出**完全相同**的柱子位置。
 */
export function endPillarTops(seed: number): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const angle = (i / PILLAR_COUNT) * Math.PI * 2;
    const x = Math.round(Math.cos(angle) * PILLAR_RING);
    const z = Math.round(Math.sin(angle) * PILLAR_RING);
    const height = 76 + Math.floor(hashAt(i, 31, seed ^ 0x9f9f) * 28);
    out.push({ x, y: height + 1, z });
  }
  return out;
}

export class EndGenerator {
  private readonly detail: NormalNoise;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    const random = new Random(mixSeed(seed, 0x5eed));
    this.detail = new NormalNoise(random, -4, [1, 0.5]);
  }

  /** 主岛的岛面 / 岛底（钟形剖面） */
  private mainIsland(x: number, z: number, distance: number): IslandInfo {
    // 半径加噪声扰动，岛缘才不会是完美的圆
    const radius = MAIN_ISLAND_RADIUS * (1 + this.detail.getValue(x, 0, z) * 0.12);
    const t = Math.min(1, distance / radius);
    const profile = 1 - t * t;
    return {
      // 中心最高，向边缘下沉 16 格
      top: Math.round(MAIN_ISLAND_TOP - (1 - profile) * 16),
      // 底部向下收成一个倒锥（原版主岛是一块厚实的"钟"）
      bottom: Math.round(MAIN_ISLAND_TOP - 22 - profile * 16),
      main: true,
      t,
      radius,
    };
  }

  /**
   * 某个单元里的岛（岛心坐标 / 半径 / 岛心高度）；该单元没有岛返回 null。
   *
   * 这是外岛的**唯一数据源**：地形、群系、末地城放置都查它，
   * 因此"哪里有一座岛""岛有多大"在三处永远一致。
   */
  outerIslandOfCell(cellX: number, cellZ: number): { x: number; z: number; radius: number; centerTop: number } | null {
    const sizeRoll = hashAt(cellX, cellZ, this.seed ^ 0x9abc);
    // 25% 的单元不出岛，让外岛之间有真正的空隙（end_barrens）
    if (sizeRoll < 0.25) return null;
    const x = cellX * OUTER_CELL + (0.2 + hashAt(cellX, cellZ, this.seed ^ 0x1234) * 0.6) * OUTER_CELL;
    const z = cellZ * OUTER_CELL + (0.2 + hashAt(cellX + 31, cellZ - 17, this.seed ^ 0x5678) * 0.6) * OUTER_CELL;
    return {
      x,
      z,
      radius: 16 + sizeRoll * 26,
      centerTop: 56 + hashAt(cellX - 7, cellZ + 13, this.seed ^ 0xdef0) * 26,
    };
  }

  /** 外岛：把世界切成 256 格的单元，每个单元由哈希决定是否有一座岛、岛心在哪、多大 */
  private outerIsland(x: number, z: number): IslandInfo | null {
    const cell = this.outerIslandOfCell(Math.floor(x / OUTER_CELL), Math.floor(z / OUTER_CELL));
    if (!cell) return null;

    const distanceToCenter = Math.hypot(x - cell.x, z - cell.z);
    // 岛缘按噪声轻微起伏（纯函数）：完全规则的圆看起来太"程序化"
    const radius = cell.radius * (1 + this.detail.getValue(x, 0, z) * 0.14);
    if (distanceToCenter >= radius) return null;

    const t = distanceToCenter / radius;
    const profile = 1 - t * t;
    return {
      top: Math.round(cell.centerTop - (1 - profile) * 10),
      bottom: Math.round(cell.centerTop - 14 - profile * 14),
      main: false,
      t,
      radius,
    };
  }

  /** 该列的岛（没有岛返回 null） */
  islandAt(x: number, z: number): IslandInfo | null {
    const distance = Math.hypot(x, z);
    if (distance < MAIN_ISLAND_RADIUS * 1.25) return this.mainIsland(x, z, distance);
    if (distance < OUTER_ISLAND_START) return null;
    return this.outerIsland(x, z);
  }

  /** 10 根黑曜石柱的顶部坐标（柱顶基座之上），供末地水晶使用 */
  pillarTops(): Array<{ x: number; y: number; z: number }> {
    return endPillarTops(this.seed);
  }

  /** 岛面高度（供地物使用）；没有岛返回 null */
  surfaceY(x: number, z: number): number | null {
    const island = this.islandAt(x, z);
    return island ? island.top : null;
  }

  /** 群系：主岛是 the_end，外岛按"岛内位置 + 岛的大小"分档 */
  biomeAt(x: number, z: number): number {
    const distance = Math.hypot(x, z);
    if (distance < MAIN_ISLAND_RADIUS * 1.25) return EndBiome.THE_END;
    if (distance < OUTER_ISLAND_START) return EndBiome.THE_VOID;

    const island = this.outerIsland(x, z);
    if (!island) return EndBiome.END_BARRENS;
    if (island.radius < 22) return EndBiome.SMALL_END_ISLANDS;
    return island.t < 0.55 ? EndBiome.END_HIGHLANDS : EndBiome.END_MIDLANDS;
  }

  // ---------------------------------------------------------------- 生成

  generate(cx: number, cz: number, out?: BlockArray): BlockArray {
    const blocks = out ?? createBlockArray();
    if (out) blocks.fill(0);

    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;

    this.fillIslands(blocks, originX, originZ);
    this.decorate(blocks, cx, cz, originX, originZ);
    this.buildCentralPortal(blocks, cx, cz);
    this.buildPillars(blocks, cx, cz);

    return blocks;
  }

  /** 填岛：逐列从岛底填到岛面，其余保持空气（末地的岛是悬空的） */
  private fillIslands(blocks: BlockArray, originX: number, originZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const worldX = originX + x;
        const worldZ = originZ + z;
        const island = this.islandAt(worldX, worldZ);
        if (!island) continue;

        const top = Math.min(WORLD_MAX_Y - 1, island.top);
        const bottom = Math.max(WORLD_MIN_Y, island.bottom);
        for (let y = bottom; y <= top; y++) {
          blocks[Chunk.index(x, y, z)] = Block.END_STONE;
        }
        // 岛面下 2 格掺一点末地石砖，让大岛不至于是一片纯色
        if (island.main && hashAt(worldX, worldZ, this.seed ^ 0x77) < 0.06) {
          blocks[Chunk.index(x, top, z)] = Block.END_STONE_BRICKS;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 地物

  /** 紫颂树：只长在外岛上（原版如此），沿用 3×3 邻域重放的跨区块约定 */
  private decorate(blocks: BlockArray, cx: number, cz: number, originX: number, originZ: number): void {
    const writer = new FeatureWriter(blocks, cx, cz);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.decorateSource(writer, originX + dx * CHUNK_SIZE_X, originZ + dz * CHUNK_SIZE_Z);
      }
    }
  }

  private decorateSource(w: FeatureWriter, sourceX: number, sourceZ: number): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = sourceX + x;
        const wz = sourceZ + z;
        const island = this.islandAt(wx, wz);
        if (!island || island.main) continue;
        // 紫颂树密度：外岛地面上约 3%
        if (hashAt(wx, wz, this.seed ^ 0xc401) > 0.03) continue;
        if (Math.hypot(wx, wz) < OUTER_ISLAND_START) continue;
        this.chorusTree(w, wx, island.top + 1, wz, new PositionalRng(wx, wz, this.seed ^ 0x1c10));
      }
    }
  }

  /**
   * 一棵紫颂树：主干向上长，中途随机分叉，顶端开一朵紫颂花。
   * 原版的紫颂植株会分叉成一片"珊瑚状"，这里做出主干 + 1~3 根分枝的可辨识形态。
   */
  private chorusTree(w: FeatureWriter, x: number, y: number, z: number, rng: PositionalRng): void {
    const trunk = 3 + rng.int(5);
    let cy = y;
    for (let i = 0; i < trunk; i++) {
      w.fill(x, cy, z, Block.CHORUS_PLANT);
      cy++;
    }

    const branches = rng.int(3);
    for (let b = 0; b < branches; b++) {
      const dx = rng.chance(0.5) ? 1 : -1;
      const dz = rng.chance(0.5) ? 1 : -1;
      const length = 1 + rng.int(3);
      let bx = x;
      let bz = z;
      let by = cy - 1 - rng.int(2);
      for (let i = 0; i < length; i++) {
        bx += dx;
        by += 1;
        if (i > 0 && rng.chance(0.4)) bz += dz;
        w.fill(bx, by, bz, Block.CHORUS_PLANT);
      }
      // 分枝顶端也开花
      if (rng.chance(0.7)) w.fill(bx, by + 1, bz, Block.CHORUS_FLOWER);
    }

    w.fill(x, cy, z, Block.CHORUS_FLOWER);
  }

  // ---------------------------------------------------------------- 主岛结构

  /**
   * 返回传送门：岛心的 3×3 末地传送门 + 基岩基座 + 四角的基岩柱与火把。
   * （原版是召唤末影龙时生成、并带 4 根火把与龙蛋；这里先做成固定地标）
   */
  private buildCentralPortal(blocks: BlockArray, cx: number, cz: number): void {
    const w = new FeatureWriter(blocks, cx, cz);
    const y = MAIN_ISLAND_TOP + 1;

    // 基岩基座（5×5，中间 3×3 是传送门）
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        w.fill(dx, y - 1, dz, Block.BEDROCK);
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        w.fill(dx, y, dz, Block.END_PORTAL);
      }
    }
    // 四角基岩柱 + 火把
    for (const [dx, dz] of [
      [-2, -2],
      [-2, 2],
      [2, -2],
      [2, 2],
    ] as const) {
      w.fill(dx, y, dz, Block.BEDROCK);
      w.fill(dx, y + 1, dz, Block.BEDROCK);
      w.fill(dx, y + 2, dz, Block.TORCH);
    }
  }

  /**
   * 黑曜石柱：以岛心为中心、半径 42 格的圆上均匀立 10 根，高度 76~103，
   * 柱顶垫一格基岩（末地水晶由实体系统放在基岩之上）。
   */
  private buildPillars(blocks: BlockArray, cx: number, cz: number): void {
    const w = new FeatureWriter(blocks, cx, cz);
    for (const top of endPillarTops(this.seed)) {
      const px = top.x;
      const pz = top.z;
      const height = top.y - 1;

      for (let y = MAIN_ISLAND_TOP; y < height; y++) {
        // 3×3 的柱子，四角砍掉（截面接近"十字柱"）
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
            w.fill(px + dx, y, pz + dz, Block.OBSIDIAN);
          }
        }
      }
      w.fill(px, height, pz, Block.BEDROCK);
      w.fill(px, height - 1, pz, Block.BEDROCK);
    }
  }
}

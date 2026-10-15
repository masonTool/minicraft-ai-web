/**
 * 地物（Features）：树、花草、蘑菇、甘蔗、南瓜、西瓜、仙人掌……
 *
 * ── 跨区块一致性的核心约定 ──────────────────────────────────────────────
 * 一个区块的地物**不是**只由它自己决定的：一棵树的树冠会伸进邻居区块。
 * 原版的做法是"按区块为单位的特征队列 + 阶段化放置"，这里用等价但更直接的办法：
 *
 *   生成区块 C 时，遍历 3×3 邻域里的每个区块 S，重放 S 的**全部**地物，
 *   但只把落在 C 内部的方块写下去。
 *
 * 这样每个地物只"属于"一个区块（它的原点所在区块），邻居只是把伸进来的部分补上，
 * 不会出现重复生成。前提是地物的每一个决策都必须是**世界坐标的纯函数**
 * （高度取自 `sampler.surfaceY(x,z)`，随机取自位置哈希），
 * 否则相邻区块会把同一棵树算到不同高度，接缝处就会错位。
 *
 * 唯一允许的例外：树干向下补土/补树干这类**只在拥有该列的区块里**做的事情——
 * 因为"是否持有该列"本身就等价于"当前区块是不是那个唯一的拥有者"，依然是确定的。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block, Wood, type WoodBlockIds } from '../registry/blocks.ts';
import { Biome, type BiomeDef } from './Biome.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

// ---------------------------------------------------------------- 随机与哈希

/** 位置哈希 → [0,1)：地物决策的随机源，纯函数，跨区块稳定 */
export function hashAt(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

/** 由位置派生的确定性随机序列（xorshift32） */
export class PositionalRng {
  private state: number;

  constructor(x: number, z: number, salt: number) {
    // 用两次混合把坐标与盐值摊平，避免相邻坐标产生相近的种子
    let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491);
    this.state = (h ^ (h >>> 13)) >>> 0 || 0x1f123bb5;
  }

  next(): number {
    let s = this.state;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.state = s;
    return s / 0x100000000;
  }

  /** [0, bound) 的整数 */
  int(bound: number): number {
    return Math.floor(this.next() * bound) % Math.max(1, bound);
  }

  /** 以概率 p 返回 true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 从数组里随机取一项 */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}

// ---------------------------------------------------------------- 世界采样接口

/** 地物模块需要的地形信息（由 OverworldGenerator / NetherGenerator 提供） */
export interface FeatureWorld {
  /** 该列的近似地表高度（世界 Y，最高固体方块） */
  surfaceY(worldX: number, worldZ: number): number;
  /** 该列的群系 */
  columnBiome(worldX: number, worldZ: number): BiomeDef;
}

/** `get()` 在区块之外时的返回值（真实方块 id 最大 245，不会冲突） */
export const OUTSIDE = -1;

/** 可以被地物覆盖的方块（植物的"可替换"集合） */
function isReplaceable(id: number): boolean {
  if (id === Block.AIR) return true;
  const shape = BLOCK_SHAPES_AS_REPLACEABLE;
  return shape.has(id);
}

/**
 * 地物可以覆盖的方块：空气、各种植物、树叶。
 * （树叶也算：树冠重叠时后放的树可以把前面的叶子覆盖掉，与原版行为一致）
 */
const BLOCK_SHAPES_AS_REPLACEABLE = new Set<number>([
  Block.SHORT_GRASS,
  Block.FERN,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.OXEYE_DAISY,
  Block.CORNFLOWER,
  Block.RED_MUSHROOM,
  Block.BROWN_MUSHROOM,
  Block.DEAD_BUSH,
  Block.SNOW_BLOCK,
  Block.OAK_LEAVES,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
  Block.NETHER_SPROUTS,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
]);

/** 地物写入器：坐标一律是世界坐标，越界的写入会被丢弃（由邻居区块负责） */
export class FeatureWriter {
  readonly originX: number;
  readonly originZ: number;

  /**
   * @param blocks 该区块的方块数组
   * @param states 可选的方块状态数组（门/楼梯这类需要朝向的方块用）；
   *               不传时 `fillState` 会退化成普通写入（结构以外的地方不需要状态）
   * @param onStateWrite 写入状态时的回调（用于把"本区块有状态"标记出去）
   */
  constructor(
    private readonly blocks: Uint8Array,
    readonly cx: number,
    readonly cz: number,
    private readonly states: Uint8Array | null = null,
    private readonly onStateWrite?: () => void,
  ) {
    this.originX = cx * CHUNK_SIZE_X;
    this.originZ = cz * CHUNK_SIZE_Z;
  }

  /** 读写本区块内的方块；区块外返回 OUTSIDE（-1） */
  get(worldX: number, worldY: number, worldZ: number): number {
    if (worldY < WORLD_MIN_Y || worldY >= WORLD_MAX_Y) return OUTSIDE;
    const x = worldX - this.originX;
    const z = worldZ - this.originZ;
    if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) return OUTSIDE;
    return this.blocks[Chunk.index(x, worldY, z)]!;
  }

  /** 本区块内该列是否属于自己（用于"补树干"这类只有拥有者才做的操作） */
  owns(worldX: number, worldZ: number): boolean {
    const x = worldX - this.originX;
    const z = worldZ - this.originZ;
    return x >= 0 && x < CHUNK_SIZE_X && z >= 0 && z < CHUNK_SIZE_Z;
  }

  /** 只在空气/可替换方块上写（不会挖穿地形） */
  put(worldX: number, worldY: number, worldZ: number, id: number): boolean {
    const current = this.get(worldX, worldY, worldZ);
    if (current === OUTSIDE) return false;
    if (!isReplaceable(current)) return false;
    const x = worldX - this.originX;
    const z = worldZ - this.originZ;
    this.blocks[Chunk.index(x, worldY, z)] = id;
    return true;
  }

  /** 强制写入（结构建造用，会覆盖既有方块） */
  fill(worldX: number, worldY: number, worldZ: number, id: number): boolean {
    if (worldY < WORLD_MIN_Y || worldY >= WORLD_MAX_Y) return false;
    const x = worldX - this.originX;
    const z = worldZ - this.originZ;
    if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) return false;
    const index = Chunk.index(x, worldY, z);
    this.blocks[index] = id;
    // 换方块时旧状态一律作废（与 Chunk#set 的行为保持一致）
    if (this.states) this.states[index] = 0;
    return true;
  }

  /** 强制写入并带方块状态（门、楼梯这类朝向方块） */
  fillState(worldX: number, worldY: number, worldZ: number, id: number, state: number): boolean {
    if (!this.fill(worldX, worldY, worldZ, id)) return false;
    if (this.states && state !== 0) {
      const x = worldX - this.originX;
      const z = worldZ - this.originZ;
      this.states[Chunk.index(x, worldY, z)] = state;
      this.onStateWrite?.();
    }
    return true;
  }

  /** 读该位置的状态（区块外返回 0） */
  getState(worldX: number, worldY: number, worldZ: number): number {
    if (!this.states) return 0;
    const x = worldX - this.originX;
    const z = worldZ - this.originZ;
    if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) return 0;
    return this.states[Chunk.index(x, worldY, z)]!;
  }

  /**
   * 该列的"地表之上第一格"（地物坐落的高度）。
   * 用采样器的近似高度，保证同一列在任何区块里算出的值都一样——
   * 跨区块的地物（树冠、结构）必须用这个值。
   */
  groundAbove(world: FeatureWorld, worldX: number, worldZ: number): number {
    return world.surfaceY(worldX, worldZ) + 1;
  }

  /**
   * 只用本区块数据校准出的"地表之上第一格"（在期望高度附近 ±depth 内找真实地面）。
   *
   * 近似高度允许有 1~3 格误差，单列地物（草、花、甘蔗……）不需要跨区块一致，
   * 因此可以直接用本区块的真实数据把落点修正到真正的地面上——
   * 否则"地表那一格正好是草方块"的概率很低，会导致花草、甘蔗几乎不生成。
   */
  surfaceAbove(worldX: number, worldZ: number, expectY: number, depth = 4): number {
    if (!this.owns(worldX, worldZ)) return expectY;
    for (let dy = 0; dy <= depth; dy++) {
      const y = expectY - dy;
      if (isGround(this.get(worldX, y - 1, worldZ)) && isPlantableAt(this.get(worldX, y, worldZ))) return y;
    }
    for (let dy = 1; dy <= depth; dy++) {
      const y = expectY + dy;
      if (isGround(this.get(worldX, y - 1, worldZ)) && isPlantableAt(this.get(worldX, y, worldZ))) return y;
    }
    return expectY;
  }

  /**
   * 从 y 往下补方块直到碰到实心方块（最多 depth 格）。
   * 只在拥有该列的区块里生效——近似地形高度可能有 1~2 格误差，
   * 补一截树干/柱子可以避免树悬空。
   */
  fillDown(worldX: number, worldY: number, worldZ: number, id: number, depth = 3): void {
    if (!this.owns(worldX, worldZ)) return;
    for (let i = 0; i < depth; i++) {
      const y = worldY - i;
      const current = this.get(worldX, y, worldZ);
      if (current === OUTSIDE || current === Block.AIR) {
        this.fill(worldX, y, worldZ, id);
        continue;
      }
      // 碰到可替换的植物也当作"还没到地面"
      if (isReplaceable(current) && current !== Block.AIR) {
        this.fill(worldX, y, worldZ, id);
        continue;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- 树

/** 11 种树 */
export type TreeKind =
  | 'oak'
  | 'big_oak'
  | 'birch'
  | 'spruce'
  | 'mega_spruce'
  | 'jungle'
  | 'mega_jungle'
  | 'acacia'
  | 'dark_oak'
  | 'swamp_oak'
  | 'bamboo';

type Planter = (
  w: FeatureWriter,
  world: FeatureWorld,
  x: number,
  z: number,
  rng: PositionalRng,
  wood: WoodBlockIds,
) => void;

/**
 * 1×1 树干；返回树冠顶（最上面一段树干的高度）。
 *
 * ⚠️ 树干用**强制写入**（fill）而不是"只在空气上写"：
 * 采样器给的高度是密度场的地表，与实际地表允许有 1~3 格误差。
 * 高度偏低时，树干底部会落在土里——强制写入正好把这一截埋进地面（看不见），
 * 露出地面的部分依然从真实地表开始，视觉上完全正常；
 * 高度偏高时用 fillDown 往下补一截。两者都只影响树干自身，
 * 树冠的绝对高度在区块之间始终一致（跨区块接缝靠的就是这一点）。
 */
function trunk(w: FeatureWriter, x: number, z: number, base: number, height: number, log: number): number {
  for (let i = 0; i < height; i++) w.fill(x, base + i, z, log);
  // 只在拥有该列时补一截树干：采样高度可能偏高，补到真实地面以免树悬空
  w.fillDown(x, base - 1, z, log, 10);
  return base + height - 1;
}

/** 2×2 树干（巨型云杉 / 深色橡木 / 巨型丛林） */
function trunk2x2(w: FeatureWriter, x: number, z: number, base: number, height: number, log: number): number {
  for (let i = 0; i < height; i++) {
    for (let dx = 0; dx <= 1; dx++) {
      for (let dz = 0; dz <= 1; dz++) w.fill(x + dx, base + i, z + dz, log);
    }
  }
  for (let dx = 0; dx <= 1; dx++) {
    for (let dz = 0; dz <= 1; dz++) w.fillDown(x + dx, base - 1, z + dz, log, 10);
  }
  return base + height - 1;
}

/** 团状树冠：以 (x, top, z) 为中心，radius 逐层收缩，角上随机剔除 */
function blobCanopy(w: FeatureWriter, x: number, z: number, top: number, leaf: number, rng: PositionalRng, radius = 2, layers = 2): void {
  for (let dy = 0; dy >= -layers; dy--) {
    const r = dy === 0 ? Math.max(1, radius - 1) : radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy < 0 ? rng.chance(0.5) : true)) continue;
        w.put(x + dx, top + dy, z + dz, leaf);
      }
    }
  }
  w.put(x, top + 1, z, leaf);
}

/** 扁平的"伞状"树冠（金合欢 / 深色橡木 / 沼泽橡木用） */
function flatCanopy(w: FeatureWriter, x: number, z: number, top: number, leaf: number, rng: PositionalRng, radius: number): void {
  for (let dy = 0; dy >= -1; dy--) {
    const r = dy === 0 ? radius : radius + 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
        if (dy < 0 && rng.chance(0.25)) continue;
        w.put(x + dx, top + dy, z + dz, leaf);
      }
    }
  }
  w.put(x, top + 1, z, leaf);
}

/** 圆锥形树冠（云杉：越往上越窄，分两层重复） */
function coneCanopy(w: FeatureWriter, x: number, z: number, top: number, leaf: number, height: number, rng: PositionalRng): void {
  let r = 0;
  for (let dy = 0; dy < height; dy++) {
    const layer = Math.floor(dy / 2);
    r = Math.min(3, layer);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
        if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        if (rng.chance(0.14)) continue;
        w.put(x + dx, top - dy, z + dz, leaf);
      }
    }
  }
}

const PLANTERS: Record<TreeKind, Planter> = {
  /** 橡木：主干 4~6 格 + 团状树冠 */
  oak: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const top = trunk(w, x, z, base, 4 + rng.int(3), wood.log);
    blobCanopy(w, x, z, top, wood.leaves, rng, 2, 2);
  },

  /** 大橡木：更高更宽的树冠（原版大橡木还带枝条，这里用两层宽冠表现） */
  big_oak: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 6 + rng.int(4);
    const top = trunk(w, x, z, base, height, wood.log);
    blobCanopy(w, x, z, top, wood.leaves, rng, 3, 3);
    if (rng.chance(0.6)) {
      const dx = rng.chance(0.5) ? 1 : -1;
      const dz = rng.chance(0.5) ? 1 : -1;
      w.put(x + dx, top - 2, z + dz, wood.leaves);
      w.put(x + dx, top - 3, z + dz, wood.leaves);
    }
  },

  /** 白桦：细高、树冠小 */
  birch: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const top = trunk(w, x, z, base, 5 + rng.int(3), wood.log);
    blobCanopy(w, x, z, top, wood.leaves, rng, 1, 2);
  },

  /** 云杉：圆锥形树冠，塔状 */
  spruce: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 7 + rng.int(4);
    const top = trunk(w, x, z, base, height, wood.log);
    coneCanopy(w, x, z, top - 2, wood.leaves, height - 1, rng);
    w.put(x, top + 1, z, wood.leaves);
  },

  /** 巨型云杉：2×2 树干 + 高大的圆锥树冠（针叶林的地标） */
  mega_spruce: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 13 + rng.int(7);
    const top = trunk2x2(w, x, z, base, height, wood.log);
    coneCanopy(w, x + 1, z + 1, top - 3, wood.leaves, height - 4, rng);
    // 顶部十字
    w.put(x + 1, top + 1, z + 1, wood.leaves);
    w.put(x, top, z, wood.leaves);
  },

  /** 丛林树：树高且树冠靠上 */
  jungle: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 6 + rng.int(5);
    const top = trunk(w, x, z, base, height, wood.log);
    blobCanopy(w, x, z, top, wood.leaves, rng, 2, 2);
  },

  /** 巨型丛林树：2×2 树干、20 格以上、多层宽树冠 */
  mega_jungle: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 16 + rng.int(10);
    const top = trunk2x2(w, x, z, base, height, wood.log);
    blobCanopy(w, x + 1, z + 1, top, wood.leaves, rng, 3, 3);
    blobCanopy(w, x + 1, z + 1, top - 4, wood.leaves, rng, 2, 1);
    w.put(x + 1, top + 1, z + 1, wood.leaves);
  },

  /** 金合欢：树干斜着长一节，顶部一张扁平的伞 */
  acacia: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const straight = 2 + rng.int(3);
    let top = trunk(w, x, z, base, straight, wood.log);

    const dx = rng.chance(0.5) ? 1 : -1;
    const dz = rng.chance(0.5) ? 1 : -1;
    const bends = 1 + rng.int(2);
    let bx = x;
    let bz = z;
    for (let i = 0; i < bends; i++) {
      // 两个方向交替水平偏移，形成原版那种"歪脖子"的轮廓
      if (i % 2 === 0) bx += dx;
      else bz += dz;
      top += 1;
      w.put(bx, top, bz, wood.log);
    }
    flatCanopy(w, bx, bz, top + 1, wood.leaves, rng, 2 + rng.int(2));
  },

  /** 深色橡木：2×2 树干 + 宽扁树冠 */
  dark_oak: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const height = 6 + rng.int(3);
    const top = trunk2x2(w, x, z, base, height, wood.log);
    flatCanopy(w, x, z, top + 1, wood.leaves, rng, 3);
    // 2×2 树干，树冠要按两个中心各铺一遍才盖得住
    flatCanopy(w, x + 1, z + 1, top, wood.leaves, rng, 2);
    w.put(x, top + 1, z, wood.leaves);
    w.put(x + 1, top + 1, z + 1, wood.leaves);
  },

  /** 沼泽橡木：矮而宽的树冠，生成在沼泽的水边 */
  swamp_oak: (w, world, x, z, rng, wood) => {
    const base = w.groundAbove(world, x, z);
    const top = trunk(w, x, z, base, 4 + rng.int(3), wood.log);
    flatCanopy(w, x, z, top, wood.leaves, rng, 3);
    w.put(x, top + 1, z, wood.leaves);
  },

  /** 竹：一丛高矮不一的竹子（原版第 11 种"树"） */
  bamboo: (w, world, x, z, rng, _wood) => {
    const base = w.groundAbove(world, x, z);
    const stalks = 4 + rng.int(6);
    for (let i = 0; i < stalks; i++) {
      const sx = x + rng.int(4) - 1;
      const sz = z + rng.int(4) - 1;
      const height = 7 + rng.int(7);
      for (let h = 0; h < height; h++) w.fill(sx, base + h, sz, Block.BAMBOO);
      w.fillDown(sx, base - 1, sz, Block.BAMBOO, 10);
    }
  },
};



// ---------------------------------------------------------------- 各群系的地物配置

interface BiomeFeature {
  /** 主树种与权重（权重为相对值，总和不必为 1） */
  trees: readonly (readonly [TreeKind, number])[];
  /** 每区块的树木尝试密度（0-1，按列哈希；0.02 ≈ 每区块 5 棵） */
  treeDensity: number;
  /** 草/蕨的密度 */
  grass: number;
  /** 花的密度（0 表示不长花） */
  flowers: number;
  /** 花的种类 */
  flowerKinds: readonly number[];
  /** 蘑菇密度 */
  mushrooms: number;
  /** 特殊地物 */
  special?: 'cactus' | 'pumpkin' | 'melon' | 'sugar_cane' | 'dead_bush' | 'bamboo';
  /** 特殊地物密度 */
  specialDensity: number;
}

const NO_FLOWERS: readonly number[] = [];
const PLAINS_FLOWERS = [Block.DANDELION, Block.POPPY, Block.OXEYE_DAISY, Block.CORNFLOWER] as const;

/** 默认配置：什么都没长（海洋、山峰等） */
const EMPTY_FEATURE: BiomeFeature = {
  trees: [],
  treeDensity: 0,
  grass: 0,
  flowers: 0,
  flowerKinds: NO_FLOWERS,
  mushrooms: 0,
  specialDensity: 0,
};

/**
 * 群系 → 地物表。
 * ⚠️ 必须覆盖全部群系 id；下面的启动校验会拦住漏配的群系。
 */
export const BIOME_FEATURES: Record<number, BiomeFeature> = {
  [Biome.DEEP_OCEAN]: EMPTY_FEATURE,
  [Biome.OCEAN]: { ...EMPTY_FEATURE, special: 'sugar_cane', specialDensity: 0.002 },
  [Biome.FROZEN_OCEAN]: EMPTY_FEATURE,
  [Biome.WARM_OCEAN]: { ...EMPTY_FEATURE, special: 'sugar_cane', specialDensity: 0.004 },
  [Biome.BEACH]: { ...EMPTY_FEATURE, special: 'sugar_cane', specialDensity: 0.02 },
  [Biome.STONY_SHORE]: EMPTY_FEATURE,

  [Biome.PLAINS]: {
    trees: [
      ['oak', 6],
      ['big_oak', 2],
    ],
    treeDensity: 0.015,
    grass: 0.16,
    flowers: 0.03,
    flowerKinds: PLAINS_FLOWERS,
    mushrooms: 0,
    special: 'pumpkin',
    specialDensity: 0.0008,
  },
  [Biome.SUNFLOWER_PLAINS]: {
    trees: [['oak', 1]],
    treeDensity: 0.008,
    grass: 0.16,
    // 向日葵平原的特征就是"花海"
    flowers: 0.12,
    flowerKinds: PLAINS_FLOWERS,
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.FOREST]: {
    trees: [
      ['oak', 5],
      ['big_oak', 3],
      ['birch', 2],
    ],
    treeDensity: 0.07,
    grass: 0.1,
    flowers: 0.012,
    flowerKinds: [Block.DANDELION, Block.POPPY, Block.BLUE_ORCHID],
    mushrooms: 0.006,
    specialDensity: 0,
  },
  [Biome.BIRCH_FOREST]: {
    trees: [['birch', 1]],
    treeDensity: 0.06,
    grass: 0.1,
    flowers: 0.01,
    flowerKinds: [Block.DANDELION, Block.CORNFLOWER],
    mushrooms: 0.004,
    specialDensity: 0,
  },
  [Biome.TAIGA]: {
    trees: [
      ['spruce', 4],
      ['mega_spruce', 1],
    ],
    treeDensity: 0.06,
    grass: 0.12,
    flowers: 0.004,
    flowerKinds: [Block.DANDELION],
    mushrooms: 0.008,
    special: 'pumpkin',
    specialDensity: 0.001,
  },
  [Biome.SNOWY_PLAINS]: {
    trees: [['spruce', 1]],
    treeDensity: 0.004,
    grass: 0.01,
    flowers: 0,
    flowerKinds: NO_FLOWERS,
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.SNOWY_TAIGA]: {
    trees: [['spruce', 3], ['mega_spruce', 1]],
    treeDensity: 0.04,
    grass: 0.02,
    flowers: 0,
    flowerKinds: NO_FLOWERS,
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.DESERT]: {
    trees: [],
    treeDensity: 0,
    grass: 0,
    flowers: 0,
    flowerKinds: NO_FLOWERS,
    mushrooms: 0,
    special: 'cactus',
    specialDensity: 0.012,
  },
  [Biome.SAVANNA]: {
    trees: [['acacia', 3], ['oak', 1]],
    treeDensity: 0.03,
    grass: 0.2,
    flowers: 0.004,
    flowerKinds: [Block.DANDELION],
    mushrooms: 0,
    special: 'melon',
    specialDensity: 0.0006,
  },
  [Biome.JUNGLE]: {
    trees: [
      ['jungle', 4],
      ['mega_jungle', 2],
    ],
    treeDensity: 0.07,
    grass: 0.3,
    flowers: 0.006,
    flowerKinds: [Block.BLUE_ORCHID],
    mushrooms: 0.006,
    special: 'melon',
    specialDensity: 0.006,
  },
  [Biome.SWAMP]: {
    trees: [['swamp_oak', 1]],
    treeDensity: 0.03,
    grass: 0.14,
    flowers: 0.004,
    flowerKinds: [Block.BLUE_ORCHID],
    mushrooms: 0.012,
    special: 'sugar_cane',
    specialDensity: 0.02,
  },
  [Biome.WINDSWEPT_HILLS]: {
    trees: [['spruce', 3], ['oak', 1]],
    treeDensity: 0.015,
    grass: 0.08,
    flowers: 0.006,
    flowerKinds: [Block.DANDELION],
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.MEADOW]: {
    trees: [['oak', 1]],
    treeDensity: 0.004,
    grass: 0.2,
    flowers: 0.09,
    flowerKinds: PLAINS_FLOWERS,
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.STONY_PEAKS]: EMPTY_FEATURE,
  [Biome.SNOWY_SLOPES]: {
    ...EMPTY_FEATURE,
    trees: [['spruce', 1]],
    treeDensity: 0.004,
  },
  [Biome.GROVE]: {
    trees: [['spruce', 1]],
    treeDensity: 0.015,
    grass: 0.02,
    flowers: 0,
    flowerKinds: NO_FLOWERS,
    mushrooms: 0,
    specialDensity: 0,
  },
  [Biome.BADLANDS]: {
    trees: [],
    treeDensity: 0,
    grass: 0,
    flowers: 0,
    flowerKinds: NO_FLOWERS,
    mushrooms: 0,
    special: 'dead_bush',
    specialDensity: 0.01,
  },
};

/** 群的密度再乘一次（雨林比森林更"满"） */

// ---------------------------------------------------------------- 地物放置

/** 树可以生长的地表方块 */
const SOIL = new Set<number>([Block.GRASS_BLOCK, Block.DIRT]);

/** 沙地（仙人掌/枯木/甘蔗） */
const SANDY = new Set<number>([Block.SAND, Block.SANDSTONE, Block.TERRACOTTA]);

/** 山顶积雪/冰面上不长东西 */
const UNPLANTABLE = new Set<number>([Block.SNOW_BLOCK, Block.ICE, Block.PACKED_ICE, Block.GRAVEL]);

/** 植物可以落地的地面（草地 / 泥土 / 沙） */
function isGround(id: number): boolean {
  return SOIL.has(id) || SANDY.has(id);
}

/** 该位置是不是可以放植物（空气或可替换） */
function isPlantableAt(id: number): boolean {
  return id === Block.AIR || isReplaceable(id);
}

/**
 * 该列是否是"可以长树"的普通地面：地表方块合适、上方是空的、还没被别的地物占用。
 */
function isPlantable(w: FeatureWriter, x: number, y: number, z: number, ground: Set<number>): boolean {
  const surface = w.get(x, y - 1, z);
  if (surface === OUTSIDE) {
    // 列不在本区块：无法验证，交给拥有该列的区块去判断（地物是位置纯函数，结论一致）
    return true;
  }
  if (!ground.has(surface)) return false;
  const above = w.get(x, y, z);
  return above === Block.AIR || isReplaceable(above);
}

/**
 * 直接种一棵指定种类的树（测试与调试用；x/z 为世界坐标）。
 * 与正式生成走完全相同的 Planter，因此测到的形状就是世界里长出来的形状。
 */
export function plantTree(
  kind: TreeKind,
  blocks: Uint8Array,
  cx: number,
  cz: number,
  world: FeatureWorld,
  x: number,
  z: number,
  salt = 1,
): void {
  const writer = new FeatureWriter(blocks, cx, cz);
  PLANTERS[kind](writer, world, x, z, new PositionalRng(x, z, salt), woodFor(kind));
}

/** 11 种树的清单（测试遍历用） */
export const TREE_KINDS: readonly TreeKind[] = [
  'oak',
  'big_oak',
  'birch',
  'spruce',
  'mega_spruce',
  'jungle',
  'mega_jungle',
  'acacia',
  'dark_oak',
  'swamp_oak',
  'bamboo',
];

/**
 * 一个区块的地物总数统计（供测试与调试面板使用）
 */
export interface FeatureStats {
  trees: number;
  plants: number;
  specials: number;
}

/**
 * 给一个区块铺地物。
 *
 * @param blocks 该区块的方块数组（会被就地修改）
 * @param cx/cz  区块坐标
 * @param world  地形采样器
 * @param seed   世界种子（决定所有地物的位置）
 * @param stats  可选统计输出
 */
export function decorate(
  blocks: Uint8Array,
  cx: number,
  cz: number,
  world: FeatureWorld,
  seed: number,
  stats?: FeatureStats,
): void {
  const writer = new FeatureWriter(blocks, cx, cz);

  // (1) 树：多块结构，树冠会伸进邻居，所以必须重放 3×3 邻域，
  //     并且所有坐标只依赖世界坐标（见文件头的约定）。
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      decorateTrees(writer, cx + dx, cz + dz, world, seed, stats);
    }
  }

  // (2) 单列地物（草、花、蘑菇、甘蔗、仙人掌、南瓜……）：这些方块永远只落在
  //     自己的区块里，所以**不需要**邻域重放，直接在本区块范围内处理即可。
  //     好处是可以用本区块的真实地面数据（surfaceAbove）把落点校准到地面上，
  //     否则"估算高度那一格正好是草方块"的概率很低，花草会长不出来。
  //     若也走邻域重放，同一格会被"拥有者"和"重放者"各判定一次（一个用真实数据、
  //     一个只能用估算），同一格出现两种结论，反而制造出不一致。
  decorateLocal(writer, world, seed, stats);
}

/** 重放某个源区块的树木（写入时按当前区块裁剪） */
function decorateTrees(
  w: FeatureWriter,
  sx: number,
  sz: number,
  world: FeatureWorld,
  seed: number,
  stats?: FeatureStats,
): void {
  const originX = sx * CHUNK_SIZE_X;
  const originZ = sz * CHUNK_SIZE_Z;
  const config = biomeConfigAt(world, originX, originZ);

  if (config.treeDensity <= 0 || config.trees.length === 0) return;

  const totalWeight = config.trees.reduce((sum, [, weight]) => sum + weight, 0);
  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      const wx = originX + x;
      const wz = originZ + z;
      if (!isTreePosition(wx, wz, seed, config.treeDensity)) continue;

      // ⚠️ 这里只能用"世界坐标的纯函数"做判定：高度来自采样器、水下判定来自海平面。
      // 一旦读本区块的方块，同一个位置在拥有者与邻居里就会得出不同结论，
      // 结果就是接缝上的树冠只剩半边。
      const groundY = world.surfaceY(wx, wz) + 1;
      if (groundY <= SEA_LEVEL) continue;
      if (groundY >= WORLD_MAX_Y - 24) continue;

      const kind = pickTree(config.trees, wx, wz, seed, totalWeight);
      const rng = new PositionalRng(wx, wz, seed ^ 0x51ed);
      PLANTERS[kind](w, world, wx, wz, rng, woodFor(kind));
      if (stats && w.owns(wx, wz)) stats.trees++;
    }
  }
}

/** 只处理本区块自己的单列地物 */
function decorateLocal(w: FeatureWriter, world: FeatureWorld, seed: number, stats?: FeatureStats): void {
  const originX = w.cx * CHUNK_SIZE_X;
  const originZ = w.cz * CHUNK_SIZE_Z;
  const centerBiome = world.columnBiome(originX + 8, originZ + 8);
  const config = biomeConfigAt(world, originX, originZ);

  // ---- 草、蕨
  if (config.grass > 0) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = originX + x;
        const wz = originZ + z;
        if (hashAt(wx, wz, seed ^ 0x6a11) >= config.grass) continue;
        const y = w.surfaceAbove(wx, wz, world.surfaceY(wx, wz) + 1);
        if (!isPlantable(w, wx, y, wz, SOIL)) continue;
        const fern = centerBiome.id === Biome.TAIGA || centerBiome.id === Biome.JUNGLE || centerBiome.id === Biome.SWAMP;
        const id = fern && hashAt(wx, wz, seed ^ 0x77aa) < 0.4 ? Block.FERN : Block.SHORT_GRASS;
        if (w.put(wx, y, wz, id) && stats) stats.plants++;
      }
    }
  }

  // ---- 花
  if (config.flowers > 0 && config.flowerKinds.length > 0) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = originX + x;
        const wz = originZ + z;
        if (hashAt(wx, wz, seed ^ 0xf10e) >= config.flowers) continue;
        const y = w.surfaceAbove(wx, wz, world.surfaceY(wx, wz) + 1);
        if (!isPlantable(w, wx, y, wz, SOIL)) continue;
        const kind = config.flowerKinds[(hashAt(wx, wz, seed ^ 0x1234) * config.flowerKinds.length) | 0]!;
        if (w.put(wx, y, wz, kind) && stats) stats.plants++;
      }
    }
  }

  // ---- 蘑菇（阴暗潮湿的群系）
  if (config.mushrooms > 0) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const wx = originX + x;
        const wz = originZ + z;
        if (hashAt(wx, wz, seed ^ 0x3b3b) >= config.mushrooms) continue;
        const y = w.surfaceAbove(wx, wz, world.surfaceY(wx, wz) + 1);
        if (!isPlantable(w, wx, y, wz, SOIL)) continue;
        const red = hashAt(wx, wz, seed ^ 0x9a9a) < 0.5;
        if (w.put(wx, y, wz, red ? Block.RED_MUSHROOM : Block.BROWN_MUSHROOM) && stats) stats.plants++;
      }
    }
  }

  // ---- 特殊地物
  if (config.special && config.specialDensity > 0) {
    placeSpecial(w, world, seed, config, stats);
  }
}

/** 取该区块中心处的群系配置 */
function biomeConfigAt(world: FeatureWorld, originX: number, originZ: number): BiomeFeature {
  const biome = world.columnBiome(originX + 8, originZ + 8);
  return BIOME_FEATURES[biome.id] ?? EMPTY_FEATURE;
}

/**
 * 树木位置：以列哈希做局部极小值判定。
 *
 * 只与 -x/-z 象限的 8 个邻居比较（同一对位置只需要一方做决定），
 * 于是每列的接受概率 = d × (1-d)^8：d=0.07 的森林约 10 棵/区块，
 * 且树与树之间自动保持 2~3 格的最小间距，不会出现"两棵树长在同一个格子里"。
 */
function isTreePosition(wx: number, wz: number, seed: number, density: number): boolean {
  if (hashAt(wx, wz, seed ^ 0x7ee5) >= density) return false;
  for (let dx = -2; dx <= 0; dx++) {
    for (let dz = -2; dz <= 0; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (hashAt(wx + dx, wz + dz, seed ^ 0x7ee5) < density) return false;
    }
  }
  return true;
}

function pickTree(
  trees: readonly (readonly [TreeKind, number])[],
  wx: number,
  wz: number,
  seed: number,
  totalWeight: number,
): TreeKind {
  let roll = hashAt(wx, wz, seed ^ 0x2f2f) * totalWeight;
  for (const [kind, weight] of trees) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return trees[0]![0];
}

/**
 * 橡木不在 `Wood` 表里（它是 id 5/6/7 的元老方块，没有独立的 5 件套），
 * 这里补一份等价结构，让所有树种共用同一套 Planter 签名。
 */
const OAK_BLOCKS: WoodBlockIds = {
  log: Block.OAK_LOG,
  planks: Block.OAK_PLANKS,
  leaves: Block.OAK_LEAVES,
  slab: 72, // stone_slab：橡木台阶不在 SHAPED_PARENTS 里，这里只是占位，Planter 不会用到
  stairs: 84,
};

/** 树种的木料方块 */
function woodFor(kind: TreeKind): WoodBlockIds {
  switch (kind) {
    case 'birch':
      return Wood.birch!;
    case 'spruce':
    case 'mega_spruce':
      return Wood.spruce!;
    case 'jungle':
    case 'mega_jungle':
      return Wood.jungle!;
    case 'acacia':
      return Wood.acacia!;
    case 'dark_oak':
      return Wood.dark_oak!;
    case 'bamboo':
      // 竹没有木料（Planter 只写 BAMBOO 方块，不会用到这几个字段）
      return OAK_BLOCKS;
    default:
      return OAK_BLOCKS;
  }
}

// ---------------------------------------------------------------- 特殊地物

function placeSpecial(
  w: FeatureWriter,
  world: FeatureWorld,
  seed: number,
  config: BiomeFeature,
  stats?: FeatureStats,
): void {
  const originX = w.cx * CHUNK_SIZE_X;
  const originZ = w.cz * CHUNK_SIZE_Z;
  const kind = config.special!;
  const salt = 0x5ec1;

  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      const wx = originX + x;
      const wz = originZ + z;
      if (hashAt(wx, wz, seed ^ salt) >= config.specialDensity) continue;
      const rng = new PositionalRng(wx, wz, seed ^ salt);
      const y = w.surfaceAbove(wx, wz, world.surfaceY(wx, wz) + 1);

      if (kind === 'cactus' || kind === 'dead_bush') {
        if (!isPlantable(w, wx, y, wz, SANDY)) continue;
        if (kind === 'dead_bush') {
          if (w.put(wx, y, wz, Block.DEAD_BUSH) && stats) stats.specials++;
          continue;
        }
        // 仙人掌：1~3 格高，旁边不能紧贴方块（原版要求四周至少留一格）
        const height = 1 + rng.int(3);
        let placed = 0;
        for (let h = 0; h < height; h++) if (w.put(wx, y + h, wz, Block.CACTUS)) placed++;
        if (placed > 0 && stats) stats.specials++;
        continue;
      }

      if (kind === 'pumpkin' || kind === 'melon') {
        if (!isPlantable(w, wx, y, wz, SOIL)) continue;
        const id = kind === 'pumpkin' ? Block.PUMPKIN : Block.MELON;
        // 原版的南瓜/西瓜是"成小片"出现的：以落点为中心铺 1~4 个。
        // 只写本区块拥有的列：越界的格子只能靠"估算高度"，会与拥有者算出不同的落点。
        const count = 1 + rng.int(4);
        let placed = 0;
        for (let i = 0; i < count; i++) {
          const px = wx + rng.int(3) - 1;
          const pz = wz + rng.int(3) - 1;
          if (!w.owns(px, pz)) continue;
          const py = w.surfaceAbove(px, pz, world.surfaceY(px, pz) + 1);
          if (!isPlantable(w, px, py, pz, SOIL)) continue;
          if (w.put(px, py, pz, id)) placed++;
        }
        if (placed > 0 && stats) stats.specials += placed;
        continue;
      }

      if (kind === 'sugar_cane') {
        // 甘蔗只长在水边（沙/草/泥上，紧邻水）
        if (!isPlantable(w, wx, y, wz, SOIL) && !isPlantable(w, wx, y, wz, SANDY)) continue;
        if (!nearWater(w, world, wx, wz, y)) continue;
        const height = 1 + rng.int(3);
        let placed = 0;
        for (let h = 0; h < height; h++) if (w.put(wx, y + h, wz, Block.SUGAR_CANE)) placed++;
        if (placed > 0 && stats) stats.specials += placed;
        continue;
      }

      if (kind === 'bamboo') {
        if (!isPlantable(w, wx, y, wz, SOIL)) continue;
        PLANTERS.bamboo(w, world, wx, wz, rng, woodFor('bamboo'));
        if (stats) stats.specials++;
      }
    }
  }
}

/**
 * 该位置是否紧邻水面。
 * 区块内的相邻列直接读方块；区块外（很少见）用"地表低于海平面 ⇒ 有水"近似，
 * 甘蔗只在拥有该列的区块里写方块，因此这个近似不会造成跨区块不一致。
 */
function nearWater(w: FeatureWriter, world: FeatureWorld, wx: number, wy: number, wz: number): boolean {
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = wx + dx;
    const nz = wz + dz;
    const block = w.get(nx, wy, nz);
    if (block === Block.WATER) return true;
    if (block === OUTSIDE) {
      // 邻列不在本区块：用它自己的地表高度判断是否被水淹没
      if (world.surfaceY(nx, nz) + 1 < SEA_LEVEL) return true;
    }
  }
  return false;
}

/**
 * 海平面（与 OverworldGenerator.SEA_LEVEL 保持一致）。
 * 放这里是为了让地物模块不反向依赖生成器（Worker 只需要拉进来必要的东西）。
 */
export const SEA_LEVEL = 63;

/** 群系地物表的完整性校验：每个群系都要有一行 */
export function validateBiomeFeatures(biomeCount: number): void {
  for (let id = 0; id < biomeCount; id++) {
    if (!BIOME_FEATURES[id]) throw new Error(`群系 ${id} 缺少地物配置`);
  }
}

export { UNPLANTABLE };

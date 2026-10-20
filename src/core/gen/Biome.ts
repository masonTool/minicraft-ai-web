/**
 * 生物群系（多噪声群系源）
 *
 * 1.18 的群系不是"按温度湿度查表"，而是**六维参数空间里的最近点匹配**：
 *   temperature / humidity / continentalness / erosion / depth / weirdness
 * 每个群系在参数空间里是一个区间盒，地形采样出六个参数后，取"离盒子最近"的那个群系。
 * 这样才能自然形成沙漠贴着草原、雪原贴着针叶林这类连续过渡。
 *
 * ⚠️ 诚实说明：官方的 61 个主世界群系参数表在 wiki 上（对自动抓取返回 403），
 * 拿不到原始数据。这里实现的是**机制完全一致**的匹配算法 + 一份经过校准的
 * 32 个代表性群系子集（批次 338 把海洋补齐到 9 种、339 补森林/丛林变体），
 * 覆盖海洋/海岸/平原/森林/
 * 针叶林/雪原/沙漠/热带草原/丛林/沼泽/山地/裸岩这些主干。
 * 补齐到 61 个只需继续往表里加区间，不需要改算法。
 */

import { Block } from '../registry/blocks.ts';

/** 群系 id */
export const Biome = {
  DEEP_OCEAN: 0,
  OCEAN: 1,
  FROZEN_OCEAN: 2,
  WARM_OCEAN: 3,
  // 批次 338（D20 第一批）：把"海洋"从 4 种扩到 9 种。
  // 原版的海洋是「深度 × 温度」两个维度的组合，这里补上缺的 5 种。
  COLD_OCEAN: 23,
  DEEP_COLD_OCEAN: 24,
  LUKEWARM_OCEAN: 25,
  DEEP_LUKEWARM_OCEAN: 26,
  DEEP_FROZEN_OCEAN: 27,
  // 批次 339（D20 第二批）：森林/丛林/山地的变体
  DARK_FOREST: 28,
  SPARSE_JUNGLE: 29,
  BAMBOO_JUNGLE: 30,
  SNOWY_BEACH: 31,
  // 批次 342：低频率区域变体（不参与气候匹配）
  FLOWER_FOREST: 32,
  OLD_GROWTH_BIRCH_FOREST: 33,
  // 批次 346：针叶林/山地/热带草原的变体
  OLD_GROWTH_PINE_TAIGA: 34,
  OLD_GROWTH_SPRUCE_TAIGA: 35,
  WINDSWEPT_FOREST: 36,
  SAVANNA_PLATEAU: 37,
  WOODED_BADLANDS: 38,
  MUSHROOM_FIELD: 39,
  // 批次 353：按**高度**分带的高山群系（不靠气候平面匹配）
  JAGGED_PEAKS: 40,
  FROZEN_PEAKS: 41,
  // 批次 362：砾石丘陵 + 侵蚀恶地
  WINDSWEPT_GRAVELLY_HILLS: 42,
  ERODED_BADLANDS: 43,
  // 批次 363：冰刺平原（积雪平原的区域变体）
  ICE_SPIKES: 44,
  // 批次 366：破碎热带草原（最陡的热带草原）
  WINDSWEPT_SAVANNA: 45,
  // 批次 394：洞穴群系（不进陆地匹配，按 y 与哈希判）
  LUSH_CAVES: 46,
  DRIPSTONE_CAVES: 47,
  // 批次 398：内陆浅水 = 河流（不参与陆地匹配）
  RIVER: 48,
  FROZEN_RIVER: 49,
  BEACH: 4,
  STONY_SHORE: 5,
  PLAINS: 6,
  SUNFLOWER_PLAINS: 7,
  FOREST: 8,
  BIRCH_FOREST: 9,
  TAIGA: 10,
  SNOWY_PLAINS: 11,
  SNOWY_TAIGA: 12,
  DESERT: 13,
  SAVANNA: 14,
  JUNGLE: 15,
  SWAMP: 16,
  WINDSWEPT_HILLS: 17,
  MEADOW: 18,
  STONY_PEAKS: 19,
  SNOWY_SLOPES: 20,
  GROVE: 21,
  BADLANDS: 22,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

/** 参数区间：写成 [min, max] */
export type Range = readonly [number, number];

/** 群系英文 id → 中文名（命令帮助的自动联想用；命令里仍拼英文 id） */
export const BIOME_LABELS: Readonly<Record<string, string>> = {
  deep_ocean: '深海',
  ocean: '海洋',
  frozen_ocean: '冻洋',
  warm_ocean: '暖水海洋',
  cold_ocean: '冷水海洋',
  deep_cold_ocean: '冷水深海',
  lukewarm_ocean: '温水海洋',
  deep_lukewarm_ocean: '温水深海',
  deep_frozen_ocean: '冻洋深海',
  beach: '沙滩',
  stony_shore: '石岸',
  snowy_plains: '雪原',
  snowy_taiga: '积雪针叶林',
  plains: '平原',
  sunflower_plains: '向日葵平原',
  forest: '森林',
  birch_forest: '桦木森林',
  taiga: '针叶林',
  desert: '沙漠',
  savanna: '热带草原',
  jungle: '丛林',
  swamp: '沼泽',
  windswept_hills: '风袭丘陵',
  meadow: '草甸',
  stony_peaks: '石峰',
  snowy_slopes: '积雪山坡',
  badlands: '恶地',
  grove: '雪林',
  dark_forest: '黑森林',
  sparse_jungle: '稀疏丛林',
  bamboo_jungle: '竹林',
  old_growth_pine_taiga: '旧生长松木针叶林',
  old_growth_spruce_taiga: '旧生长云杉针叶林',
  windswept_forest: '风袭森林',
  savanna_plateau: '热带高原',
  wooded_badlands: '疏林恶地',
  windswept_gravelly_hills: '风袭沙砾丘陵',
  eroded_badlands: '侵蚀恶地',
  windswept_savanna: '风袭热带草原',
  ice_spikes: '冰刺之地',
  jagged_peaks: '尖峭山峰',
  frozen_peaks: '冰封山峰',
  mushroom_fields: '蘑菇岛',
  flower_forest: '繁花森林',
  old_growth_birch_forest: '旧生长桦木森林',
  lush_caves: '繁茂洞穴',
  dripstone_caves: '溶洞',
  river: '河流',
  frozen_river: '冻河',
  snowy_beach: '积雪沙滩',
};

export interface BiomeDef {
  readonly id: number;
  readonly name: string;
  /** 是否海洋群系（只用于统计与调试） */
  readonly ocean: boolean;
  /** 温度 / 湿度 */
  readonly temperature: Range;
  readonly humidity: Range;
  /** 大陆度（决定海陆） */
  readonly continentalness: Range;
  /** 侵蚀度（决定起伏） */
  readonly erosion: Range;
  /** 深度（负数 = 地表以上，正数 = 地下） */
  readonly depth: Range;
  /** 奇异度 */
  readonly weirdness: Range;
  /**
   * 区域变体（批次 342）：它的母群系 id。
   *
   * 变体**不参与气候匹配**（`LAND_BIOMES` 会把它过滤掉），而是在母群系命中之后，
   * 按 **64 格粗格** 的哈希决定"这一片是不是变体"。原因：窄气候区间在 4 格粗格上
   * 只有 1~2 格宽，无论怎么平滑都会被切成碎片；而 64 格哈希天然给出成片的区域。
   */
  readonly variantOf?: number;
  /** 变体占比（0~100，按 64 格粗格掷点） */
  readonly regionChance?: number;

  /** 地表方块 */
  readonly surface: number;
  /** 次表层方块 */
  readonly subSurface: number;
  /** 次表层厚度 */
  readonly subDepth: number;
  /** 水下地表方块 */
  readonly underwater: number;
  /** 是否常年积雪（地表上方会再铺雪） */
  readonly snowy: boolean;
  /** 草色（0xRRGGBB），供后续植被染色使用 */
  readonly grassColor: number;
  /** 树叶色 */
  readonly foliageColor: number;
}

/** 区间到点的距离：在区间内为 0，在外为到最近边界的距离 */
function rangeDistance(range: Range, value: number): number {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}

const ANY: Range = [-1.1, 1.1];

export const BIOMES: readonly BiomeDef[] = [
  // ---- 海洋：大陆度最低的一档
  {
    id: Biome.DEEP_OCEAN,
    name: 'deep_ocean',
    ocean: true,
    temperature: ANY,
    humidity: ANY,
    continentalness: [-1.1, -0.65],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.STONE,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.OCEAN,
    name: 'ocean',
    ocean: true,
    temperature: [-0.45, 0.5],
    humidity: ANY,
    continentalness: [-0.75, -0.42],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.FROZEN_OCEAN,
    name: 'frozen_ocean',
    ocean: true,
    temperature: [-1.1, -0.45],
    humidity: ANY,
    continentalness: [-0.75, -0.42],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.GRAVEL,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.WARM_OCEAN,
    name: 'warm_ocean',
    ocean: true,
    temperature: [0.5, 1.1],
    humidity: ANY,
    continentalness: [-0.75, -0.42],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },

  // ---- 批次 338：海洋的温度 / 深度细分（原版 9 种，这里补齐 5 种）
  // 海底材质与原版一致：寒带与深海是砾石，温水是沙。
  {
    id: Biome.COLD_OCEAN,
    name: 'cold_ocean',
    ocean: true,
    temperature: [-0.45, -0.15],
    humidity: ANY,
    continentalness: [-0.75, -0.42],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.GRAVEL,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.DEEP_COLD_OCEAN,
    name: 'deep_cold_ocean',
    ocean: true,
    temperature: [-0.45, -0.15],
    humidity: ANY,
    continentalness: [-1.1, -0.65],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.STONE,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.LUKEWARM_OCEAN,
    name: 'lukewarm_ocean',
    ocean: true,
    temperature: [0.15, 0.55],
    humidity: ANY,
    continentalness: [-0.75, -0.42],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.DEEP_LUKEWARM_OCEAN,
    name: 'deep_lukewarm_ocean',
    ocean: true,
    temperature: [0.15, 0.55],
    humidity: ANY,
    continentalness: [-1.1, -0.65],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.STONE,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.DEEP_FROZEN_OCEAN,
    name: 'deep_frozen_ocean',
    ocean: true,
    temperature: [-1.1, -0.45],
    humidity: ANY,
    continentalness: [-1.1, -0.65],
    erosion: ANY,
    depth: [0, 1.1],
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.STONE,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },

  // ---- 海岸
  {
    id: Biome.BEACH,
    name: 'beach',
    ocean: false,
    temperature: [-0.45, 1.1],
    humidity: ANY,
    continentalness: [-0.42, -0.15],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 3,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  },
  {
    id: Biome.STONY_SHORE,
    name: 'stony_shore',
    ocean: false,
    temperature: [-1.1, 0.3],
    humidity: ANY,
    continentalness: [-0.42, -0.15],
    erosion: [-1.1, -0.5],
    depth: ANY,
    weirdness: ANY,
    surface: Block.STONE,
    subSurface: Block.STONE,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },

  // ---- 低起伏内陆（平原 / 森林 / 针叶林 / 雪原 / 沙漠 / 草原 / 丛林 / 沼泽）
  {
    id: Biome.SNOWY_PLAINS,
    name: 'snowy_plains',
    ocean: false,
    temperature: [-1.1, -0.45],
    humidity: [-1.1, 0.3],
    continentalness: [-0.15, 1.1],
    erosion: [-0.375, 1.1],
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.SNOWY_TAIGA,
    name: 'snowy_taiga',
    ocean: false,
    temperature: [-1.1, -0.45],
    humidity: [0.3, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.PLAINS,
    name: 'plains',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [-0.35, 0.3],
    continentalness: [-0.15, 1.1],
    erosion: [-0.375, 1.1],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x91bd59,
    foliageColor: 0x77ab2f,
  },
  {
    id: Biome.SUNFLOWER_PLAINS,
    name: 'sunflower_plains',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [-0.35, 0.3],
    continentalness: [-0.15, 1.1],
    erosion: [-0.375, 1.1],
    depth: ANY,
    weirdness: [0.15, 1.1],
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x91bd59,
    foliageColor: 0x77ab2f,
  },
  {
    id: Biome.FOREST,
    name: 'forest',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.3, 0.6],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
  },
  {
    id: Biome.BIRCH_FOREST,
    name: 'birch_forest',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.6, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x88bb67,
    foliageColor: 0x6ba941,
  },
  {
    id: Biome.TAIGA,
    name: 'taiga',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.3, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: [-1.1, -0.375],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
  },
  {
    id: Biome.DESERT,
    name: 'desert',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [-1.1, -0.35],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SANDSTONE,
    subDepth: 4,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  },
  {
    id: Biome.SAVANNA,
    name: 'savanna',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [-0.35, 0.3],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  },
  {
    id: Biome.JUNGLE,
    name: 'jungle',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [0.3, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
  },
  {
    id: Biome.SWAMP,
    name: 'swamp',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.6, 1.1],
    continentalness: [-0.25, 0.1],
    erosion: [0.1, 1.1],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.CLAY,
    snowy: false,
    grassColor: 0x6a7039,
    foliageColor: 0x6a7039,
  },

  // ---- 高起伏（山地）
  {
    id: Biome.WINDSWEPT_HILLS,
    name: 'windswept_hills',
    ocean: false,
    // 温度必须收窄：否则它会和 snowy_slopes / grove 完全重叠，
    // 而字符串匹配是"取第一个距离为 0 的"，寒冷山地会被错判成温带山地
    temperature: [-0.45, 1.1],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-1.1, -0.5],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.MEADOW,
    name: 'meadow',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-0.5, -0.2],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x83bb6d,
    foliageColor: 0x63a948,
  },
  {
    id: Biome.STONY_PEAKS,
    name: 'stony_peaks',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: [0.3, 1.1],
    erosion: [-1.1, -0.6],
    depth: ANY,
    weirdness: [0.1, 1.1],
    surface: Block.STONE,
    subSurface: Block.STONE,
    subDepth: 4,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.SNOWY_SLOPES,
    name: 'snowy_slopes',
    ocean: false,
    temperature: [-1.1, -0.45],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-1.1, -0.5],
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.STONE,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.BADLANDS,
    name: 'badlands',
    ocean: false,
    // 炎热、极干燥、低侵蚀（原版恶地是高地台地）。
    // ⚠️ 区间不能收得太窄：湿度那一维的实际标准差只有 ~0.97，
    // 一开始写成「温度>0.55 且湿度<-0.75」，联合概率过低，实测世界里一次都不出现。
    temperature: [0.35, 1.1],
    humidity: [-1.1, -0.62],
    continentalness: [-0.15, 1.1],
    erosion: [-1.1, -0.375],
    depth: ANY,
    weirdness: ANY,
    // 地表是陶瓦；下方的彩色陶瓦色带由地表规则按高度分层铺（见 SurfaceRules）
    surface: Block.TERRACOTTA,
    subSurface: Block.TERRACOTTA,
    subDepth: 2,
    underwater: Block.TERRACOTTA,
    snowy: false,
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
  },
  {
    id: Biome.GROVE,
    name: 'grove',
    ocean: false,
    temperature: [-0.6, -0.2],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-0.5, -0.2],
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },

  // ---- 批次 339：森林 / 丛林 / 山地变体 + 积雪沙滩
  // 这几个都是"已有群系的更具体子集"：靠**多约束一个维度**在参数空间里赢过母群系
  // （`specificity()` 先比约束维度数，再比总宽度）。
  {
    id: Biome.DARK_FOREST,
    name: 'dark_forest',
    ocean: false,
    temperature: [-0.45, 0.3],
    // ⚠️ 变体群系**不要拿 weirdness 切**：它来自高频的 ridges 噪声，
    // 一刀下去会把陆地切成"一格一换"的碎斑（`test:terrain:normal` 的中位斑块会从 15 掉到 4）。
    // 这里只用温度/湿度/侵蚀三个低频维度，靠"多约束一个维度"赢过母群系。
    humidity: [0.85, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: [0.2, 1.1],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x507a32,
    foliageColor: 0x3f5f22,
  },
  {
    id: Biome.SPARSE_JUNGLE,
    name: 'sparse_jungle',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [0.3, 0.55],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
  },
  {
    id: Biome.BAMBOO_JUNGLE,
    name: 'bamboo_jungle',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [0.75, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
  },
  {
    id: Biome.OLD_GROWTH_PINE_TAIGA,
    name: 'old_growth_pine_taiga',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.3, 1.1],
    continentalness: [-0.15, 1.1],
    // 比针叶林更窄的侵蚀区间 → 同一批维度里更具体，赢在"最陡的那一档"
    erosion: [-1.1, -0.82],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
  },
  {
    id: Biome.OLD_GROWTH_SPRUCE_TAIGA,
    name: 'old_growth_spruce_taiga',
    ocean: false,
    temperature: [-0.45, 0.3],
    humidity: [0.3, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: [-0.82, -0.6],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
  },
  {
    id: Biome.WINDSWEPT_FOREST,
    name: 'windswept_forest',
    ocean: false,
    // 暖 + 陡：靠"温度下限 0.3"比 windswept_hills 更窄而赢
    temperature: [0.3, 1.1],
    humidity: [0.3, 1.1],
    continentalness: [0.1, 1.1],
    erosion: [-1.1, -0.62],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.SAVANNA_PLATEAU,
    name: 'savanna_plateau',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [-0.35, 0.3],
    continentalness: [-0.15, 1.1],
    erosion: [-1.1, -0.85],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  },
  {
    id: Biome.WOODED_BADLANDS,
    name: 'wooded_badlands',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    // 恶地里的"有树那一档"：同样不参与气候匹配，按 64 格区域掷点
    variantOf: Biome.BADLANDS,
    regionChance: 20,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
  },
  {
    id: Biome.WINDSWEPT_GRAVELLY_HILLS,
    name: 'windswept_gravelly_hills',
    ocean: false,
    // 收窄温度：否则"温度全集(2.2 宽) + 侵蚀"会输给 windswept_hills（总宽更窄）
    temperature: [-0.45, 1.1],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    // 比 windswept_hills 更窄的侵蚀区间 → 赢在"最陡那一档"
    erosion: [-1.1, -0.85],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRAVEL,
    subSurface: Block.GRAVEL,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.ERODED_BADLANDS,
    name: 'eroded_badlands',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    // 恶地的"被侵蚀那一档"：按 64 格区域掷点，地表换成陶瓦
    variantOf: Biome.BADLANDS,
    regionChance: 25,
    surface: Block.TERRACOTTA,
    subSurface: Block.TERRACOTTA,
    subDepth: 4,
    underwater: Block.TERRACOTTA,
    snowy: false,
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
  },
  {
    id: Biome.WINDSWEPT_SAVANNA,
    name: 'windswept_savanna',
    ocean: false,
    temperature: [0.3, 1.1],
    humidity: [-0.35, 0.3],
    continentalness: [-0.15, 1.1],
    // 比热带高原（-0.7 下限）更窄：在最陡的一档赢过它
    erosion: [-1.1, -0.93],
    depth: ANY,
    weirdness: ANY,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  },
  {
    id: Biome.ICE_SPIKES,
    name: 'ice_spikes',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    // 积雪平原的 64 格区域变体：地表雪块 + 密集冰刺
    variantOf: Biome.SNOWY_PLAINS,
    regionChance: 12,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.SNOW_BLOCK,
    subDepth: 2,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.JAGGED_PEAKS,
    name: 'jagged_peaks',
    ocean: false,
    temperature: [-0.45, 0.35],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-1.1, -0.45],
    depth: ANY,
    weirdness: ANY,
    surface: Block.STONE,
    subSurface: Block.STONE,
    subDepth: 4,
    underwater: Block.GRAVEL,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.FROZEN_PEAKS,
    name: 'frozen_peaks',
    ocean: false,
    temperature: [-1.1, -0.45],
    humidity: ANY,
    continentalness: [0.1, 1.1],
    erosion: [-1.1, -0.5],
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.STONE,
    subDepth: 3,
    underwater: Block.GRAVEL,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.MUSHROOM_FIELD,
    name: 'mushroom_fields',
    ocean: false,
    // 暖湿 + 平坦（三约束赢过丛林/竹林）
    temperature: [0.4, 1.1],
    humidity: [0.75, 1.1],
    continentalness: [-0.15, 1.1],
    erosion: [0.5, 1.1],
    depth: ANY,
    weirdness: ANY,
    surface: Block.MYCELIUM,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x8a7f96,
    foliageColor: 0x9a8fa8,
  },
  {
    id: Biome.FLOWER_FOREST,
    name: 'flower_forest',
    ocean: false,
    // 气候区间给全集：它**不参与匹配**，只在森林命中之后按 64 格区域掷点
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    variantOf: Biome.FOREST,
    regionChance: 12,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
  },
  {
    id: Biome.OLD_GROWTH_BIRCH_FOREST,
    name: 'old_growth_birch_forest',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    variantOf: Biome.BIRCH_FOREST,
    regionChance: 15,
    surface: Block.GRASS_BLOCK,
    subSurface: Block.DIRT,
    subDepth: 3,
    underwater: Block.DIRT,
    snowy: false,
    grassColor: 0x88bb67,
    foliageColor: 0x6ba941,
  },
  {
    id: Biome.LUSH_CAVES,
    name: 'lush_caves',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.MOSS_BLOCK,
    subSurface: Block.MOSS_BLOCK,
    subDepth: 1,
    underwater: Block.MOSS_BLOCK,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.DRIPSTONE_CAVES,
    name: 'dripstone_caves',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.STONE,
    subSurface: Block.DRIPSTONE_BLOCK,
    subDepth: 1,
    underwater: Block.STONE,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.RIVER,
    name: 'river',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: false,
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  },
  {
    id: Biome.FROZEN_RIVER,
    name: 'frozen_river',
    ocean: false,
    temperature: ANY,
    humidity: ANY,
    continentalness: ANY,
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SAND,
    subSurface: Block.SAND,
    subDepth: 2,
    underwater: Block.SAND,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
  {
    id: Biome.SNOWY_BEACH,
    name: 'snowy_beach',
    ocean: false,
    temperature: [-1.1, -0.45],
    humidity: ANY,
    continentalness: [-0.42, -0.15],
    erosion: ANY,
    depth: ANY,
    weirdness: ANY,
    surface: Block.SNOW_BLOCK,
    subSurface: Block.SAND,
    subDepth: 3,
    underwater: Block.SAND,
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  },
];

if (BIOMES.length !== Object.keys(Biome).length) {
  throw new Error(
    `群系表与 Biome 常量数量不一致：表 ${BIOMES.length} 项，常量 ${Object.keys(Biome).length} 项`,
  );
}

/**
 * 按 id 排序并校验连续。
 * ⚠️ 必须排序：`biomeName(id)` 是按数组下标取的，声明顺序一旦与 id 不一致就会取到别的群系
 * （方块表踩过同一个坑，这里直接用启动校验挡住）。
 */
const SORTED_BIOMES = [...BIOMES].sort((a, b) => a.id - b.id);
for (let index = 0; index < SORTED_BIOMES.length; index++) {
  if (SORTED_BIOMES[index]!.id !== index) {
    throw new Error(`群系 id 必须从 0 开始连续：下标 ${index} 处实际 id=${SORTED_BIOMES[index]!.id}`);
  }
}

export const BIOME_TABLE: readonly BiomeDef[] = SORTED_BIOMES;

/** 六维气候参数 */
export interface ClimatePoint {
  temperature: number;
  humidity: number;
  continentalness: number;
  erosion: number;
  depth: number;
  weirdness: number;
}

/**
 * 在参数空间里找"离采样点最近"的群系（原版同款做法）。
 * 距离取六个维度越界量的平方和；落在区间内为 0，因此多个候选都命中时，
 * 越"深"落在自己区间里的那个越容易被选中。
 */
export function findBiome(point: ClimatePoint): BiomeDef {
  let best = BIOMES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const biome of BIOMES) {
    const dTemperature = rangeDistance(biome.temperature, point.temperature);
    const dHumidity = rangeDistance(biome.humidity, point.humidity);
    const dContinentalness = rangeDistance(biome.continentalness, point.continentalness);
    const dErosion = rangeDistance(biome.erosion, point.erosion);
    const dDepth = rangeDistance(biome.depth, point.depth);
    const dWeirdness = rangeDistance(biome.weirdness, point.weirdness);

    const distance =
      dTemperature * dTemperature +
      dHumidity * dHumidity +
      dContinentalness * dContinentalness +
      dErosion * dErosion +
      dDepth * dDepth +
      dWeirdness * dWeirdness;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = biome;
    }
    // 完全落在所有区间内时提前退出（距离已经是理论最优的 0）
    if (bestDistance === 0) break;
  }

  return best;
}

export function biomeName(id: number): string {
  return BIOME_TABLE[id]?.name ?? `unknown(${id})`;
}

// ---------------------------------------------------------------- 气候增益

/**
 * 气候增益（只在群系匹配这一步使用）
 *
 * ⚠️ 这里暴露了一个底层偏差，必须写清楚，不能含糊过去：
 * 本项目 NormalNoise 的归一化用的是 `1 / Σ|振幅|`，等价于对多个八度做**加权平均**，
 * 会把整体幅度压得远小于原版（原版按方差归一化，输出标准差约为 1）。
 * 实测四个通道的标准差只有 0.054 / 0.101 / 0.105 / 0.082，
 * 而群系参数表是按 ±1.1 的量纲写的——直接拿去匹配，采样值几乎永远落在区间中间，
 * 结果就是「99.4% 的世界都是平原」（这是实测出来的，不是推测）。
 *
 * 折中做法：**只在群系匹配这一步**按通道放大到合适量纲；地形样条保持不变，
 * 因为它们已经按原始幅度校准过了（放大后会变成另一套地形）。
 *
 * 彻底修法是改回按方差归一化、然后重新校准全部地形样条，
 * 已作为任务记进 TASKS（D1b）。这里的每个增益都按「3 倍标准差 ≈ 0.9」反推。
 */
export const CLIMATE_GAIN = {
  // D1b 修好噪声归一化后，各通道标准差已经 ≈1，参数空间量纲与区间盒一致，增益全部为 1。
  // 这张表保留为「按通道微调」的统一入口：将来某一维度偏强/偏弱时改这里即可。
  continentalness: 1,
  temperature: 1,
  humidity: 1,
  erosion: 1,
  weirdness: 1,
} as const;

export function applyClimateGain(point: ClimatePoint): ClimatePoint {
  const clamp = (value: number) => Math.max(-1.1, Math.min(1.1, value));
  return {
    temperature: clamp(point.temperature * CLIMATE_GAIN.temperature),
    humidity: clamp(point.humidity * CLIMATE_GAIN.humidity),
    continentalness: clamp(point.continentalness * CLIMATE_GAIN.continentalness),
    erosion: clamp(point.erosion * CLIMATE_GAIN.erosion),
    depth: point.depth,
    weirdness: clamp(point.weirdness * CLIMATE_GAIN.weirdness),
  };
}

/** 按 id 取群系（BIOME_TABLE 已按 id 排序，可直接下标） */
export function biomeById(id: number): BiomeDef {
  return BIOME_TABLE[id] ?? BIOME_TABLE[0]!;
}

/** 只在这些群系里做陆地表层匹配（海洋/海岸单独判；区域变体也不参与） */
export const LAND_BIOMES = BIOMES.filter(
  (biome) =>
    !biome.ocean &&
    biome.variantOf === undefined &&
    biome.id !== Biome.BEACH &&
    biome.id !== Biome.STONY_SHORE &&
    // 批次 339：积雪沙滩与沙滩同一个判定通道，不能进陆地匹配
    biome.id !== Biome.SNOWY_BEACH &&
    // 批次 353：山峰按高度判，不参与气候平面匹配
    biome.id !== Biome.JAGGED_PEAKS &&
    biome.id !== Biome.FROZEN_PEAKS &&
    // 批次 394：洞穴群系不参与陆地匹配
    biome.id !== Biome.LUSH_CAVES &&
    biome.id !== Biome.DRIPSTONE_CAVES &&
    // 批次 398：河流按水线判，不参与陆地匹配
    biome.id !== Biome.RIVER &&
    biome.id !== Biome.FROZEN_RIVER,
);

/**
 * 64 格粗格上的确定性哈希（批次 342）。用整数混合而不是 `Math.random`：
 * 同一个坐标必须永远给出同一个结论（存档/联机/跨区块重放都依赖这一点）。
 */
function regionHash(x: number, z: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(salt, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 母群系 → 区域变体（批次 342）。`x/z` 是**世界坐标**，内部按 64 格切格。
 * 没有变体命中时原样返回母群系。
 */
export function regionVariantAt(base: BiomeDef, x: number, z: number): BiomeDef {
  for (const biome of BIOMES) {
    if (biome.variantOf !== base.id) continue;
    const chance = biome.regionChance ?? 0;
    if (chance <= 0) continue;
    const cx = Math.floor(x / 64);
    const cz = Math.floor(z / 64);
    if (regionHash(cx, cz, biome.id) % 100 < chance) return biome;
  }
  return base;
}

/**
 * 只在陆地群系里找最近匹配
 */
/** 全区间宽度（ANY 的宽度） */
const ANY_WIDTH = 1.1 * 2;

/**
 * 「特化程度」度量：**先看约束了几个维度，再比总宽度**。
 *
 * ⚠️ 只比总宽度是不行的：沙漠（约束温度、湿度）的总宽度比恶地（约束温度、湿度、侵蚀度）
 * 还窄，于是并列时沙漠依旧胜出、恶地依然不出现。必须先比"约束了几个维度"——
 * 约束越多说明越具体，这才是"恶地是沙漠的子集"这件事的正确度量。
 */
function specificity(biome: BiomeDef): number {
  const ranges: readonly Range[] = [biome.temperature, biome.humidity, biome.erosion, biome.weirdness];
  let constrained = 0;
  let width = 0;
  for (const range of ranges) {
    const w = range[1] - range[0];
    if (w < ANY_WIDTH - 0.01) {
      constrained++;
      width += w;
    }
  }
  // 约束维度数优先（越大越具体），同维数时区间越窄越具体
  return constrained * 100 - width;
}

/**
 * 只在陆地群系里找最近匹配。
 *
 * ⚠️ 并列（距离同为 0）时必须优先**更特化**的群系，而不能按声明顺序取第一个。
 * 否则「沙漠」（温度>0.3 且湿度<-0.35，区间很宽）会把「恶地」
 * （还要更干、且侵蚀度低，区间窄得多）的采样点全部抢走——
 * 实测表现就是恶地在这个世界里一次都不出现。
 */
/**
 * 洞穴群系（批次 394）：按 y 与坐标哈希判。
 *
 * ⚠️ 这是**简化版**：原版是独立的三维噪声（且与地表群系无关）。这里只做到
 * "深处更可能是滴水石洞、浅处更可能是繁茂洞穴"，并让洞穴装饰按它分配密度；
 * 没有"洞穴群系的生物/地表"那一层。
 */
export function caveBiomeAt(x: number, y: number, z: number): BiomeDef | null {
  if (y > 40) return null;
  let h = Math.imul(x + 1, 73856093) ^ Math.imul(z + 1, 19349663) ^ Math.imul(y + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  if (y < 0) return biomeById(h % 3 === 0 ? Biome.LUSH_CAVES : Biome.DRIPSTONE_CAVES);
  return biomeById(h % 2 === 0 ? Biome.LUSH_CAVES : Biome.DRIPSTONE_CAVES);
}

export function findLandBiome(point: ClimatePoint): BiomeDef {
  let best = LAND_BIOMES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestSpecificity = specificity(best);

  for (const biome of LAND_BIOMES) {
    const distance =
      rangeDistance(biome.temperature, point.temperature) ** 2 +
      rangeDistance(biome.humidity, point.humidity) ** 2 +
      rangeDistance(biome.erosion, point.erosion) ** 2 +
      rangeDistance(biome.weirdness, point.weirdness) ** 2;
    const biomeSpecificity = specificity(biome);

    // 并列时取「特化度更高」的（数值越大越具体）
    const better =
      distance < bestDistance ||
      (distance === bestDistance && biomeSpecificity > bestSpecificity);
    if (better) {
      bestDistance = distance;
      bestSpecificity = biomeSpecificity;
      best = biome;
    }
  }

  return best;
}

/**
 * 按「实际地表高度 + 气候」判群系。
 *
 * ⚠️ 这里没有用原版那套「大陆度决定海陆」的做法，原因是本实现的地形海陆边界
 * **不是由大陆度决定的**：真正把地表推过海平面的是峰谷项（pv × factor × 40，振幅可达 ±60 格），
 * 而大陆度的实际波动只有 ±0.13（约 ±12 格）。如果照原版拿大陆度分海洋/沙滩，
 * 会出现「明明是海的地方判成沙滩、明明是陆地的地方判成深海」——实测沙滩一度占到 23.5%。
 *
 * 所以改为直接看地表高度，判定结果与画面一致；温度只用来区分寒带/温带/热带海洋。
 * 等 D1b（按方差归一化噪声）修好之后，可以再切回原版做法。
 */
export function biomeForColumn(climate: ClimatePoint, groundY: number, seaLevel: number): BiomeDef {
  const gain = applyClimateGain(climate);

  if (groundY < seaLevel - 1) {
    // 批次 398：内陆浅水（离海远、水深 ≤4）判成河流 / 冻河
    if (groundY >= seaLevel - 4 && gain.continentalness > 0.05) {
      return biomeById(gain.temperature < -0.45 ? Biome.FROZEN_RIVER : Biome.RIVER);
    }
    // 批次 338：先分「深 / 浅」，再按温度分五档（原版就是这两个维度的组合）。
    // ⚠️ 原版没有 deep_warm_ocean：暖水海洋只出现在浅海，深海那一档落到 deep_lukewarm。
    const deep = groundY < seaLevel - 14;
    if (gain.temperature < -0.45) {
      return biomeById(deep ? Biome.DEEP_FROZEN_OCEAN : Biome.FROZEN_OCEAN);
    }
    if (gain.temperature < -0.15) {
      return biomeById(deep ? Biome.DEEP_COLD_OCEAN : Biome.COLD_OCEAN);
    }
    if (gain.temperature > 0.55) {
      return biomeById(deep ? Biome.DEEP_LUKEWARM_OCEAN : Biome.WARM_OCEAN);
    }
    if (gain.temperature > 0.15) {
      return biomeById(deep ? Biome.DEEP_LUKEWARM_OCEAN : Biome.LUKEWARM_OCEAN);
    }
    return biomeById(deep ? Biome.DEEP_OCEAN : Biome.OCEAN);
  }

  // 沙滩只留**水线上下各一格**（2 格）的窄带。
  //
  // 批次 179 把海岸改成缓坡之后，这条边界必须跟着收：以前 `-1..+1`（3 格）落在
  // 陡岸上只覆盖很窄的一条；现在缓坡 + 平坦海滨意味着一个 3 格高的带子能铺开
  // 十几格宽，实测沙滩占比 17.6%（原版随机一片区域大约 2~5%）。
  // 收成 `-1..0` 之后沙滩回到水线那一圈，`+1` 及以上算陆地（与画面上"沙到水边为止"一致）。
  if (groundY >= seaLevel - 1 && groundY <= seaLevel) {
    if (gain.erosion < -0.6) return biomeById(Biome.STONY_SHORE);
    // 批次 339：寒冷海岸是积雪沙滩（原版 snowy_beach）
    if (gain.temperature < -0.45) return biomeById(Biome.SNOWY_BEACH);
    return biomeById(Biome.BEACH);
  }

  // 批次 353：高山带按**高度**分带。
  // 气候平面里再窄的区间也表达不了"山顶"——山峰是地形高度决定的，不是气候决定的。
  if (groundY >= seaLevel + 55 && gain.erosion < -0.4) {
    return biomeById(gain.temperature < -0.45 ? Biome.FROZEN_PEAKS : Biome.JAGGED_PEAKS);
  }

  return findLandBiome(gain);
}

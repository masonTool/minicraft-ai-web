/**
 * 方块注册表（P0 最小可用版本）
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名；P1 会扩展为完整的 1.18 方块集
 *   （含 block state、朝向、半砖、楼梯等），此处先保留最小结构。
 */

export interface BlockDef {
  readonly id: number;
  readonly name: string;
  /** [顶面, 底面, 侧面]，值为图集贴图名 */
  readonly tiles: readonly [string, string, string];
  /** 参与碰撞 */
  readonly solid: boolean;
  /** 完全遮挡：剔除相邻面 + 阻挡光照 */
  readonly opaque: boolean;
  /** 自发光等级 0-15 */
  readonly light: number;
  /** 是否为液体 */
  readonly liquid: boolean;
  /** 半透明：走独立的透明渲染层（水、玻璃） */
  readonly translucent: boolean;
}

interface BlockSpec {
  id: number;
  name: string;
  tiles?: readonly [string, string, string];
  solid?: boolean;
  opaque?: boolean;
  light?: number;
  liquid?: boolean;
  translucent?: boolean;
}

const SPECS: readonly BlockSpec[] = [
  { id: 0, name: 'minecraft:air', tiles: ['', '', ''], solid: false, opaque: false },
  { id: 1, name: 'minecraft:stone', tiles: ['stone', 'stone', 'stone'] },
  { id: 2, name: 'minecraft:dirt', tiles: ['dirt', 'dirt', 'dirt'] },
  { id: 3, name: 'minecraft:grass_block', tiles: ['grass_top', 'dirt', 'grass_side'] },
  { id: 4, name: 'minecraft:sand', tiles: ['sand', 'sand', 'sand'] },
  { id: 5, name: 'minecraft:oak_log', tiles: ['oak_log_top', 'oak_log_top', 'oak_log_side'] },
  { id: 6, name: 'minecraft:oak_leaves', tiles: ['oak_leaves', 'oak_leaves', 'oak_leaves'] },
  { id: 7, name: 'minecraft:oak_planks', tiles: ['oak_planks', 'oak_planks', 'oak_planks'] },
  { id: 8, name: 'minecraft:cobblestone', tiles: ['cobblestone', 'cobblestone', 'cobblestone'] },
  { id: 9, name: 'minecraft:bedrock', tiles: ['bedrock', 'bedrock', 'bedrock'] },
  { id: 10, name: 'minecraft:water', tiles: ['water', 'water', 'water'], solid: false, opaque: false, liquid: true, translucent: true },
  { id: 11, name: 'minecraft:glass', tiles: ['glass', 'glass', 'glass'], opaque: false, translucent: true },
];

/** 方块 id 常量，避免代码里出现魔法数字 */
export const Block = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS_BLOCK: 3,
  SAND: 4,
  OAK_LOG: 5,
  OAK_LEAVES: 6,
  OAK_PLANKS: 7,
  COBBLESTONE: 8,
  BEDROCK: 9,
  WATER: 10,
  GLASS: 11,
} as const;

/** 按 id 索引的方块定义表 */
export const BLOCKS: readonly BlockDef[] = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  tiles: s.tiles ?? ['stone', 'stone', 'stone'],
  solid: s.solid ?? true,
  opaque: s.opaque ?? true,
  light: s.light ?? 0,
  liquid: s.liquid ?? false,
  translucent: s.translucent ?? false,
}));

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0];
}

export function isOpaque(id: number): boolean {
  return blockDef(id).opaque;
}

export function isSolid(id: number): boolean {
  return blockDef(id).solid;
}

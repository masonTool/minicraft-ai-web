/**
 * 地表规则（Surface Rules）
 *
 * 决定"一列从地表往下每一层是什么方块"。原版是一棵规则树（if/then + 高度条件），
 * 这里按同样的思路做成一列**分层描述**：地表 → 次表层 → 深层色带。
 *
 * 目前覆盖：
 *  - 群系地表/次表层（草、沙、雪、砾石、陶瓦……）
 *  - 水下按深度切换（浅水沙、深水砾石）
 *  - **恶地彩色陶瓦色带**：按高度交替铺不同颜色的陶瓦，这是恶地最标志性的特征
 *  - 水下黏土/沙的群系差异（沼泽是黏土）
 *
 * ⚠️ 与原版的差距：原版规则里还有"水下 5 格以上铺砾石""深层岩石 30 格以上才用深板岩"等
 * 更细的条件，以及繁茂洞穴、紫晶洞这类特殊地物。这里实现的是主干，
 * 细节差异已在 TASKS 的 H3 里逐条列出。
 */

import { Block, terracottaId } from '../registry/blocks.ts';
import { Biome, type BiomeDef } from './Biome.ts';

/** 恶地色带的颜色顺序（对齐原版的橙 / 黄 / 白 / 浅灰 / 棕循环） */
const BADLANDS_BANDS: readonly number[] = [
  terracottaId(1), // 橙
  terracottaId(4), // 黄
  terracottaId(0), // 原色
  terracottaId(8), // 浅灰
  terracottaId(12), // 棕
  terracottaId(2), // 品红
  terracottaId(0),
];

/** 每层色带的厚度（方块数）。原版色带大致是 1-3 格，这里取 2 格并让列间有偏移 */
const BAND_THICKNESS = 2;

export interface ColumnSurface {
  /** 地表方块（最上面那一格） */
  surface: number;
  /** 次表层方块 */
  subSurface: number;
  /** 次表层厚度 */
  subDepth: number;
  /**
   * 深层色带：次表层之下继续铺设的方块序列（循环使用）。
   * 为 null 表示不再往下铺，保持岩石原样。
   */
  deepBands: readonly number[] | null;
  /** 色带向下延伸的深度（相对地表的格数） */
  deepDepth: number;
}

/** 稳定哈希：让色带边界在 (x,z) 上确定且看起来随机 */
function bandHash(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * 计算一列的地表分层。
 *
 * @param biome 该列所属群系
 * @param groundY 地表高度（最高固体方块）
 * @param seaLevel 海平面
 * @param worldX/worldZ 世界坐标（色带边界用）
 */
export function columnSurface(
  biome: BiomeDef,
  groundY: number,
  seaLevel: number,
  worldX: number,
  worldZ: number,
): ColumnSurface {
  const underwater = groundY < seaLevel;

  if (underwater) {
    // 水下：浅水用群系的水下变体，深水换成砾石（原版的深海海底是砾石）
    const deepWater = groundY < seaLevel - 7;
    const block = deepWater ? Block.GRAVEL : biome.underwater;
    return { surface: block, subSurface: block, subDepth: biome.subDepth, deepBands: null, deepDepth: 0 };
  }

  // 恶地：地表陶瓦 + 往下 20 多格的彩色色带
  if (biome.id === Biome.BADLANDS) {
    const bandSeed = bandHash(Math.floor(worldX / 7), Math.floor(worldZ / 7), 0x5bd1);
    return {
      surface: biome.surface,
      subSurface: biome.subSurface,
      subDepth: 2,
      deepBands: BADLANDS_BANDS,
      // 每列的地层厚度略有差异，避免所有列在同一高度切换颜色
      deepDepth: 22 + (bandSeed % 8),
    };
  }

  return {
    surface: biome.surface,
    subSurface: biome.subSurface,
    subDepth: biome.subDepth,
    deepBands: null,
    deepDepth: 0,
  };
}

/** 取色带在某一深度处该用的方块 */
export function bandBlockAt(bands: readonly number[], worldX: number, worldY: number, worldZ: number): number {
  // 用世界 Y 与横向坐标共同决定层号：同一水平层颜色一致，列与列之间又略有交错
  const layer = Math.floor((worldY + (bandHash(worldX, worldZ, 0x77) % BAND_THICKNESS)) / BAND_THICKNESS);
  return bands[((layer % bands.length) + bands.length) % bands.length]!;
}

export { BADLANDS_BANDS };

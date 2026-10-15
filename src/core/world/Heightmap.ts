/**
 * 高度图（C6）：按列缓存"最高的那个方块在哪"
 *
 * 为什么需要：很多东西只想知道"这一列的地表在哪"——被动生物刷怪要找地表草地、
 * 将来的地图/信标/结构放置也要。原来 `MobSpawner` 是**从玩家高度往下逐格找草方块**，
 * 一次刷怪尝试最多 `16 列 × 330 格 ≈ 5000 次 getBlock`（每 2 秒一次）。
 *
 * 两种高度图（与原版同名，语义也一致）：
 *  - `world_surface`：最高的**非空气**方块（记它的 y**+1**，与原版一样是"地表之上的第一格"）
 *  - `motion_blocking`：最高的**会挡住移动**的方块（实心或流体）。
 *    它才是"地表"的正解：草/花/火把这些不挡路的植物不算，否则站在草丛里的地表会被判到草尖上。
 *
 * 存储与代价：
 *  - 每列 **2 字节**（`Uint16Array(256)`，一个区块 512 字节；两种都建也才 1KB）
 *  - **按需建表**：`0xffff` 表示"这一列还没算过"，第一次查询时才回扫那一列（≤384 次读）
 *  - 方块变化只维护**那一列**：往上长是 O(1)，把地表那一格挖掉才回扫（原版的 heightmap 也这么做）
 *
 * 这里全是纯函数（只有 `Chunk` 的 `get` 是依赖），所以能离线断言：
 * "建表后再查 1000 次不再读方块"这种事必须钉住，否则优化会在某次重构里悄悄退化。
 */

import { Block, blockDef } from '../registry/blocks.ts';

/** 世界高度范围（与 `Chunk` 保持一致） */
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320;

export type HeightmapKind = 'world_surface' | 'motion_blocking';

/** `Uint16Array` 里表示"这一列还没算过"的哨兵值 */
export const HEIGHT_DIRTY = 0xffff;
/** 表示"这一列没有任何匹配的方块"（全空气，理论上只在未生成的区块出现） */
export const HEIGHT_NONE = 0;
/**
 * 存进去的是 `y + Y_OFFSET`：y 可以是 -64，而 `Uint16Array` 只装得下非负数。
 * 取 65 是为了让"最高方块 y=-64"也能存成正数（1），同时把 0 留给"没有方块"。
 */
const Y_OFFSET = 65;

/** 高度图读方块只需要这一个能力（传对象而不是闭包：`Chunk.set` 是热路径，不额外分配） */
export interface BlockColumnReader {
  get(x: number, y: number, z: number): number;
}

/** 新建一张空高度图（全部列都是"未计算"） */
export function createHeightmap(): Uint16Array {
  const map = new Uint16Array(256);
  map.fill(HEIGHT_DIRTY);
  return map;
}

/** 这种方块算不算这种高度图里的"地表" */
export function heightmapMatches(kind: HeightmapKind, id: number): boolean {
  if (id === Block.AIR) return false;
  if (kind === 'world_surface') return true; // 任何非空气
  const def = blockDef(id);
  // 实心或有流体都算"挡住移动"：草/花/树苗/火把都不挡
  return def.solid || def.liquid;
}

/** 从 `fromY` 往下找最高匹配的方块；找不到返回 `HEIGHT_NONE` */
export function computeColumn(
  reader: BlockColumnReader,
  lx: number,
  lz: number,
  kind: HeightmapKind,
  fromY = WORLD_MAX_Y - 1,
): number {
  const top = Math.min(fromY, WORLD_MAX_Y - 1);
  for (let y = top; y >= WORLD_MIN_Y; y--) {
    if (heightmapMatches(kind, reader.get(lx, y, lz))) return y + Y_OFFSET;
  }
  return HEIGHT_NONE;
}

/**
 * 读某一列的高度（存的是 `y + Y_OFFSET`）；没算过就当场算并缓存。
 * @returns `HEIGHT_NONE`(0) 表示这一列没有匹配的方块
 */
export function heightAt(
  map: Uint16Array,
  reader: BlockColumnReader,
  lx: number,
  lz: number,
  kind: HeightmapKind,
): number {
  const index = (lz << 4) | lx;
  const cached = map[index]!;
  if (cached !== HEIGHT_DIRTY) return cached;

  const height = computeColumn(reader, lx, lz, kind);
  map[index] = height;
  return height;
}

/**
 * 方块变化后维护高度图。
 *
 * 三种情况：
 *  1. 这一列还没建过表 → 什么都不做（第一次查询时会用新地形算）
 *  2. 新方块"算地表"且比原来的高 → 直接抬高（O(1)）
 *  3. 新方块"不算地表"（挖掉/换成植物）**且原来记的就是它** → 从它下面回扫
 */
export function onBlockChanged(
  map: Uint16Array,
  reader: BlockColumnReader,
  lx: number,
  lz: number,
  y: number,
  id: number,
  kind: HeightmapKind,
): void {
  const index = (lz << 4) | lx;
  const cached = map[index]!;
  if (cached === HEIGHT_DIRTY) return;

  const stored = y + Y_OFFSET;
  if (heightmapMatches(kind, id)) {
    if (stored > cached) map[index] = stored;
    return;
  }
  if (stored === cached) {
    map[index] = computeColumn(reader, lx, lz, kind, y - 1);
  }
}

/** 存进去的值 → 方块 y；`HEIGHT_NONE` 返回 null */
export function heightToY(height: number): number | null {
  return height === HEIGHT_NONE ? null : height - Y_OFFSET;
}

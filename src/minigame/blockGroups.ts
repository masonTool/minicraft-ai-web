/**
 * 方块 → 图集分组的**纯逻辑**（小游戏2，批次 20261022-1954）
 *
 * `InstancedMesh` 的每个实例共享同一份几何体与材质，所以"不同方块用不同贴图"
 * 只能靠**按 tile 分组**：一组 = 一个 InstancedMesh（几何体的 UV 固定在这张 tile 上）。
 * 常见的关卡只有 3~5 种方块，于是 draw call 也只有 3~5 个。
 *
 * 为什么单独一个文件：分组这一步不依赖 three、不依赖 DOM，可以在 node 里
 * 用 5000 个方块直接压测（条目要求"单帧构建 < 100ms"）——
 * 真正建 `InstancedMesh` 要 WebGL，那部分没法离线量。
 */

import { blockDef } from '../core/registry/blocks.ts';
import { TILE_ORDER } from '../render/atlasLayout.ts';

export interface BlockInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface BlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlockGroup {
  /** 图集里的贴图名（`blockDef(id).tiles[0]`，即顶面） */
  readonly tile: string;
  /** 在 `TILE_ORDER` 里的下标（调试与断言用） */
  readonly tileIndex: number;
  readonly positions: readonly BlockPosition[];
}

export interface BlockGroups {
  readonly groups: readonly BlockGroup[];
  /** 贴图名对不上图集的方块（被跳过；正常为 0，断言盯着它） */
  readonly skipped: number;
}

/** `TILE_ORDER` 的快速索引（模块级建一次，5000 次查询也不慢） */
const TILE_INDEX = new Map<string, number>(TILE_ORDER.map((name, index) => [name, index]));

/** 一个方块用哪张图集贴图（只取顶面；小游戏不做六面区分） */
export function blockTileOf(blockId: number): string {
  return blockDef(blockId).tiles[0] ?? 'stone';
}

/**
 * 按贴图分组（顺序按"第一次出现"的先后，便于断言与稳定渲染）。
 *
 * ⚠️ 坐标不做去重：同一格放两次是调用方的问题，这里照单全收（去重会让
 * "两个方块叠在同一格"这种 bug 变得更难发现）。
 */
export function buildBlockGroups(blocks: readonly BlockInstance[]): BlockGroups {
  const byTile = new Map<string, BlockPosition[]>();
  let skipped = 0;

  for (const block of blocks) {
    const tile = blockTileOf(block.blockId);
    const tileIndex = TILE_INDEX.get(tile);
    if (tileIndex === undefined) {
      skipped += 1;
      continue;
    }
    let list = byTile.get(tile);
    if (!list) {
      list = [];
      byTile.set(tile, list);
    }
    list.push({ x: block.x, y: block.y, z: block.z });
  }

  const groups: BlockGroup[] = [];
  for (const [tile, positions] of byTile) {
    groups.push({ tile, tileIndex: TILE_INDEX.get(tile)!, positions });
  }
  return { groups, skipped };
}

/** 分组后的实例总数（应等于输入里"贴图能对上"的数量） */
export function groupInstanceCount(groups: BlockGroups): number {
  return groups.groups.reduce((sum, group) => sum + group.positions.length, 0);
}

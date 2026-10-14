/**
 * 地形生成（占位实现）
 *
 * ⚠️ P1 阶段这里仍是正弦函数堆出来的假地形，只为验证"生成 → 传输 → 网格化 → 渲染"的
 * 完整链路和分块调度。P2 会把内部替换为 1.18 的多噪声地形生成器：
 * 密度函数（大陆度/侵蚀度/峰谷/温度/湿度/深度/奇异度）→ 样条插值 → 地表规则 → 雕刻器。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_HEIGHT, WORLD_MIN_Y } from '../world/Chunk.ts';

export const CHUNK_BLOCK_COUNT = CHUNK_SIZE_X * CHUNK_SIZE_Z * WORLD_HEIGHT;
export const WATER_LEVEL = 20;

/** 位置哈希：确定性伪随机，用于地表装饰 */
export function hash3(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b9) ^ Math.imul(salt + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

/** 地表高度（占位：多频正弦叠加） */
function surfaceHeight(wx: number, wz: number, seed: number): number {
  const o = (seed % 1000) * 0.01;
  return Math.floor(
    20 +
      5.5 * Math.sin(wx / 34 + o) +
      4.5 * Math.cos(wz / 29 + o) +
      2.5 * Math.sin((wx + wz) / 15) +
      1.6 * Math.cos((wx - wz) / 9),
  );
}

/**
 * 生成一个区块的方块数据。
 * @param out 可选复用缓冲区，避免频繁分配大数组
 */
export function generateChunkBlocks(cx: number, cz: number, seed: number, out?: Uint8Array): Uint8Array {
  const blocks = out ?? new Uint8Array(CHUNK_BLOCK_COUNT);
  if (out) blocks.fill(0);

  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;

  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      const h = surfaceHeight(originX + x, originZ + z, seed);
      // 与 Chunk.index 保持同一套内存布局：index = (y - WORLD_MIN_Y) * 256 + z * 16 + x
      const base = (0 - WORLD_MIN_Y) * CHUNK_SIZE_Z * CHUNK_SIZE_X + z * CHUNK_SIZE_X + x;
      const step = CHUNK_SIZE_Z * CHUNK_SIZE_X;

      for (let y = 0; y <= h; y++) {
        let id: number;
        if (y === 0) id = Block.BEDROCK;
        else if (y < h - 3) id = Block.STONE;
        else if (y < h) id = Block.DIRT;
        else id = h <= WATER_LEVEL ? Block.SAND : Block.GRASS_BLOCK;
        blocks[base + y * step] = id;
      }
      for (let y = h + 1; y <= WATER_LEVEL; y++) blocks[base + y * step] = Block.WATER;
    }
  }

  placeTrees(blocks, cx, cz, originX, originZ, seed);
  return blocks;
}

function placeTrees(blocks: Uint8Array, cx: number, cz: number, originX: number, originZ: number, seed: number): void {
  const put = (x: number, y: number, z: number, id: number): void => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= WORLD_HEIGHT) return;
    blocks[Chunk.index(x, y, z)] = id;
  };
  const get = (x: number, y: number, z: number): number => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= WORLD_HEIGHT) return 0;
    return blocks[Chunk.index(x, y, z)]!;
  };

  const treeCount = hash3(cx, 0, cz, seed + 7) > 0.72 ? 2 : 1;
  for (let t = 0; t < treeCount; t++) {
    const lx = 3 + Math.floor(hash3(cx, t, cz, seed + 11) * 10);
    const lz = 3 + Math.floor(hash3(cx, t, cz, seed + 23) * 10);
    const ground = surfaceHeight(originX + lx, originZ + lz, seed);
    if (ground <= WATER_LEVEL) continue;

    const trunkHeight = 4 + Math.floor(hash3(cx, t, cz, seed + 31) * 3);
    for (let i = 1; i <= trunkHeight; i++) put(lx, ground + i, lz, Block.OAK_LOG);

    const top = ground + trunkHeight;
    for (let dy = -2; dy <= 1; dy++) {
      const radius = dy <= -1 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && hash3(lx + dx, dy, lz + dz, seed) > 0.5) continue;
          if (get(lx + dx, top + dy, lz + dz) === Block.AIR) put(lx + dx, top + dy, lz + dz, Block.OAK_LEAVES);
        }
      }
    }
  }
}

/**
 * 地形生成入口
 *
 * 负责把 OverworldGenerator 的密度地形生成结果，再叠加一层地表装饰（地物）。
 * 装饰放在同一次 Worker 任务里完成，避免额外的跨线程往返。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, WORLD_HEIGHT } from '../world/Chunk.ts';
import { OverworldGenerator, SEA_LEVEL } from './OverworldGenerator.ts';

export const CHUNK_BLOCK_COUNT = CHUNK_VOLUME;
export { SEA_LEVEL };

/** 每个种子一个生成器实例（内部持有噪声表，构造开销不应重复付出） */
const generators = new Map<number, OverworldGenerator>();

function generatorFor(seed: number): OverworldGenerator {
  let generator = generators.get(seed);
  if (!generator) {
    generator = new OverworldGenerator(seed);
    generators.set(seed, generator);
  }
  return generator;
}

function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 0xffffffff;
}

/**
 * 生成一个区块的方块数据。
 * @param out 可选复用缓冲区，避免频繁分配大数组
 */
export function generateChunkBlocks(cx: number, cz: number, seed: number, out?: Uint8Array): Uint8Array {
  const blocks = generatorFor(seed).generate(cx, cz, out);
  decorateTrees(blocks, cx, cz, seed);
  return blocks;
}

/**
 * 树木地物（简化版：只在本区块内部成树）。
 *
 * 树干限定在 [2, 13] 列，保证半径 2 的树冠完全落在本区块内，避免跨区块被切断。
 * 完整的跨区块地物放置（按区块边界的特征队列）会在 D13 实现。
 */
function decorateTrees(blocks: Uint8Array, cx: number, cz: number, seed: number): void {
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;

  const get = (x: number, y: number, z: number): number => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= WORLD_HEIGHT) return 0;
    return blocks[Chunk.index(x, y, z)]!;
  };
  const put = (x: number, y: number, z: number, id: number): void => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= WORLD_HEIGHT) return;
    blocks[Chunk.index(x, y, z)] = id;
  };

  for (let z = 2; z < 14; z++) {
    for (let x = 2; x < 14; x++) {
      if (hash2(originX + x, originZ + z, seed) < 0.982) continue;

      // 找该列最高的非空气方块
      let top = -1;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (blocks[Chunk.index(x, y, z)] !== Block.AIR) {
          top = y;
          break;
        }
      }
      if (top < 0 || top + 8 >= WORLD_HEIGHT) continue;
      if (get(x, top, z) !== Block.GRASS_BLOCK) continue;

      const trunkHeight = 4 + Math.floor(hash2(originX + x + 31, originZ + z + 7, seed) * 3);
      const canopyTop = top + trunkHeight;

      // 先放树叶，树干随后覆盖，避免树冠被树干挤掉
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy <= -1 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && hash2(x + dx, z + dz, dy + 3) > 0.5) continue;
            if (get(x + dx, canopyTop + dy, z + dz) === Block.AIR) put(x + dx, canopyTop + dy, z + dz, Block.OAK_LEAVES);
          }
        }
      }
      for (let i = 1; i <= trunkHeight; i++) put(x, top + i, z, Block.OAK_LOG);
    }
  }
}

/**
 * 超平坦世界生成（世界类型 `flat`）
 *
 * 只有三层：基岩（防掉出世界）+ 泥土 + 草方块，其余全是空气——与原版"经典"预设一致。
 * 没有洞穴、含水层、矿石、地物与结构：平坦世界的意义就是"一眼看得清"，
 * 而且结构（村庄、矿井）会依赖地形高度做落点，放在一片平板地上反而容易悬空。
 *
 * 种子参数保留但不用：接口与 `OverworldGenerator` 对齐，方便生成器分派里一视同仁。
 */

import { Block } from '../registry/blocks.ts';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  Chunk,
  WORLD_MIN_Y,
  createBlockArray,
  type BlockArray,
} from '../world/Chunk.ts';
import { FLAT_LAYERS } from './WorldType.ts';

/** 生成一个超平坦区块（可以直接复用传入的缓冲区） */
export function generateFlatChunk(_cx: number, _cz: number, out?: BlockArray): BlockArray {
  const blocks = out ?? createBlockArray();
  // 只有 y = -64 起的那几层有内容，其余保持 0（空气）
  blocks.fill(0);

  const bedrock = FLAT_LAYERS.bedrockY;
  if (bedrock >= WORLD_MIN_Y) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        blocks[Chunk.index(x, bedrock, z)] = Block.BEDROCK;
        for (let y = FLAT_LAYERS.dirtFrom; y <= FLAT_LAYERS.dirtTo; y++) {
          blocks[Chunk.index(x, y, z)] = Block.DIRT;
        }
        blocks[Chunk.index(x, FLAT_LAYERS.grassY, z)] = Block.GRASS_BLOCK;
      }
    }
  }

  return blocks;
}

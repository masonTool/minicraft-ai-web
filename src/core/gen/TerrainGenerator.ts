/**
 * 地形生成入口
 *
 * 一次 Worker 任务里跑完：密度地形 → 雕刻/含水层/矿石 → 地物（树、花草、特殊地物）。
 * 装饰放在同一次任务里完成，避免额外的跨线程往返。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { CHUNK_VOLUME } from '../world/Chunk.ts';
import { BIOME_TABLE } from './Biome.ts';
import { decorate, validateBiomeFeatures, type FeatureStats } from './Features.ts';
import { OverworldGenerator, SEA_LEVEL } from './OverworldGenerator.ts';

export const CHUNK_BLOCK_COUNT = CHUNK_VOLUME;
export { SEA_LEVEL };

/** 每个种子一个生成器实例（内部持有噪声表，构造开销不应重复付出） */
const generators = new Map<number, OverworldGenerator>();

/** 地物配置表完整性校验：每个群系都必须有一行（启动即报错，不留隐患） */
validateBiomeFeatures(BIOME_TABLE.length);

function generatorFor(seed: number): OverworldGenerator {
  let generator = generators.get(seed);
  if (!generator) {
    generator = new OverworldGenerator(seed);
    generators.set(seed, generator);
  }
  return generator;
}

/**
 * 生成一个区块的方块数据（含地物）。
 * @param out 可选复用缓冲区，避免频繁分配大数组
 * @param stats 可选：统计本次生成的地物数量（测试与调试用）
 */
export function generateChunkBlocks(
  cx: number,
  cz: number,
  seed: number,
  out?: Uint8Array,
  stats?: FeatureStats,
): Uint8Array {
  const generator = generatorFor(seed);
  const blocks = generator.generate(cx, cz, out);
  decorate(blocks, cx, cz, generator, seed, stats);
  return blocks;
}

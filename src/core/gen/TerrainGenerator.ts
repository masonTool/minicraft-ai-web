/**
 * 地形生成入口
 *
 * 一次 Worker 任务里跑完：密度地形 → 雕刻/含水层/矿石 → 地物（树、花草）→ 结构（村庄、矿井…）。
 * 全部在同一次任务里完成，避免额外的跨线程往返。
 *
 * ⚠️ 顺序很重要：**结构放在地物之后**。结构用强制写入覆盖地形与地物，
 * 于是村庄里不会长出一棵穿过屋顶的树，海底神殿也不会被海草/沉船叠进来。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { CHUNK_VOLUME, type BlockArray } from '../world/Chunk.ts';
import { BIOME_TABLE } from './Biome.ts';
import { Dimension, type DimensionId } from './Dimension.ts';
import { EndGenerator } from './EndGenerator.ts';
import { generateFlatChunk } from './FlatGenerator.ts';
import type { WorldType } from './WorldType.ts';
import { generateEndStructures } from './EndStructures.ts';
import { NetherGenerator } from './NetherGenerator.ts';
import { FeatureWriter, decorate, validateBiomeFeatures, type FeatureStats } from './Features.ts';
import { OverworldGenerator, SEA_LEVEL } from './OverworldGenerator.ts';
import { generateStructures } from './Structures.ts';

export const CHUNK_BLOCK_COUNT = CHUNK_VOLUME;
export { SEA_LEVEL };

/**
 * 每个种子 + 世界类型一个生成器实例（内部持有噪声表，构造开销不应重复付出）。
 * 键里带上世界类型：同一个种子的"默认"与"放大化"是两套参数，不能共用实例。
 */
const generators = new Map<string, OverworldGenerator>();
/** 下界生成器同样是"每个种子一个" */
const netherGenerators = new Map<number, NetherGenerator>();
/** 末地生成器 */
const endGenerators = new Map<number, EndGenerator>();

/** 地物配置表完整性校验：每个群系都必须有一行（启动即报错，不留隐患） */
validateBiomeFeatures(BIOME_TABLE.length);

function generatorFor(seed: number, worldType: WorldType): OverworldGenerator {
  const key = `${worldType}|${seed}`;
  let generator = generators.get(key);
  if (!generator) {
    generator = new OverworldGenerator(seed, worldType);
    generators.set(key, generator);
  }
  return generator;
}

function netherGeneratorFor(seed: number): NetherGenerator {
  let generator = netherGenerators.get(seed);
  if (!generator) {
    generator = new NetherGenerator(seed);
    netherGenerators.set(seed, generator);
  }
  return generator;
}

function endGeneratorFor(seed: number): EndGenerator {
  let generator = endGenerators.get(seed);
  if (!generator) {
    generator = new EndGenerator(seed);
    endGenerators.set(seed, generator);
  }
  return generator;
}

/**
 * 生成过程中写入的方块状态缓冲。
 *
 * 为什么需要：门、楼梯、挂墙火把这些方块除了 id 还要存"朝向/开关"，
 * 而区块的方块状态是**按需分配**的（自然地形全是 0，不需要额外 96KB）。
 * 这里复用一个缓冲区，只有真的写了非 0 状态时才把它回传给主线程。
 * Worker 里的请求是同步处理的，因此共享这一块缓冲是安全的。
 */
const generationStates = new Uint8Array(CHUNK_VOLUME);
let statesUsed = false;

/**
 * 取走本次生成写入的方块状态；本次没有状态时返回 null。
 * 必须在 generateChunkBlocks 之后、下一次生成之前调用。
 */
export function takeGeneratedStates(): Uint8Array | null {
  if (!statesUsed) return null;
  statesUsed = false;
  return generationStates.slice();
}

/**
 * 生成一个区块的方块数据（含地物与结构）。
 *
 * 维度分派：下界与末地各自走自包含流程（地形 + 自己的地物 + 自己的结构），
 * 主世界才需要群系地物 / 结构 / 状态回传。
 *
 * @param dimension 维度（默认主世界）
 * @param worldType 世界类型（默认 `default`）；只影响主世界，下界与末地照旧
 * @param out 可选复用缓冲区，避免频繁分配大数组
 * @param stats 可选：统计本次生成的地物数量（测试与调试用）
 */
export function generateChunkBlocks(
  cx: number,
  cz: number,
  seed: number,
  dimension: DimensionId = Dimension.OVERWORLD,
  worldType: WorldType = 'default',
  out?: BlockArray,
  stats?: FeatureStats,
): BlockArray {
  // 超平坦只换主世界：下界与末地仍按原样生成（原版也是这个规则）
  if (dimension === Dimension.OVERWORLD && worldType === 'flat') {
    generationStates.fill(0);
    statesUsed = false;
    return generateFlatChunk(cx, cz, out);
  }

  if (dimension === Dimension.NETHER) {
    // 下界不写方块状态：地物全是整块方块，没有门/楼梯
    return netherGeneratorFor(seed).generate(cx, cz, out);
  }

  if (dimension === Dimension.END) {
    // 末地：地形 + 紫颂地物 + 黑曜石柱/中央传送门在生成器内完成，
    // 末地城与末地船是独立的"结构"（用世界坐标的岛判定做放置）
    const endGenerator = endGeneratorFor(seed);
    const blocks = endGenerator.generate(cx, cz, out);
    generationStates.fill(0);
    statesUsed = false;
    generateEndStructures(new FeatureWriter(blocks, cx, cz, generationStates, () => {
      statesUsed = true;
    }), endGenerator, seed);
    return blocks;
  }

  const generator = generatorFor(seed, worldType);
  const blocks = generator.generate(cx, cz, out);

  // 地物阶段也要能写方块状态：**雪层**的层数就存在状态里（批次 37）。
  // 这条通道早先没有接（只传了 blocks），"雪层写状态"会被静默丢掉。
  generationStates.fill(0);
  statesUsed = false;
  decorate(blocks, cx, cz, generator, seed, stats, generationStates, () => {
    statesUsed = true;
  });

  // ⚠️ 这里**不能**再 `generationStates.fill(0)`：地物刚写进去的雪层状态会被抹掉
  // （结构只写门/楼梯这类"新放的方块"的状态，不会与雪层冲突）。清零已经在上面做过一次。
  const writer = new FeatureWriter(blocks, cx, cz, generationStates, () => {
    statesUsed = true;
  });
  generateStructures(writer, generator, seed);

  return blocks;
}

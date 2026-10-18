/**
 * 世界类型（批次 181）离线测试
 *
 * 用户问过："三种世界类型是不是都能找到所有材料？"
 * 答案不是——超平坦在 `TerrainGenerator` 里**直接返回三层方块**，
 * 地物与结构阶段根本不会跑。这套断言把"三种类型各有什么"钉住：
 *  - 默认/放大化：有群系地物（树、花草），方块种类丰富；
 *  - 超平坦：只有基岩/泥土/草，没有任何树、矿石或结构方块。
 *
 * 运行：npm run test:worldtype
 */

import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { FLAT_LAYERS, WORLD_TYPE_HINTS, WORLD_TYPE_LABELS, WORLD_TYPES } from '../src/core/gen/WorldType.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { WORLD_MIN_Y } from '../src/core/world/Chunk.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

const SEED = 20261018;
const CX = 0;
const CZ = 0;

interface Stats {
  blocks: Uint32Array;
  solid: number;
  unique: Set<number>;
  minY: number;
  maxY: number;
  has: (id: number) => boolean;
}

function sample(worldType: 'default' | 'flat' | 'amplified'): Stats {
  const blocks = generateChunkBlocks(CX, CZ, SEED, Dimension.OVERWORLD, worldType);
  const unique = new Set<number>();
  let solid = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < blocks.length; i++) {
    const id = blocks[i]!;
    if (id === Block.AIR) continue;
    solid++;
    unique.add(id);
    // 区块索引按 y 分层（每层 16×16），y 从 WORLD_MIN_Y 起
    const y = Math.floor(i / (16 * 16)) + WORLD_MIN_Y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { blocks, solid, unique, minY, maxY, has: (id) => unique.has(id) };
}

console.log('\n[一、类型清单与文案]');
{
  equal('三种世界类型', WORLD_TYPES.join(','), 'default,flat,amplified');
  check('每种都有名字', WORLD_TYPES.every((type) => WORLD_TYPE_LABELS[type].length > 0));
  check('每种都有说明', WORLD_TYPES.every((type) => WORLD_TYPE_HINTS[type].length >= 8));
  check('超平坦的说明写明没有树木/村庄/矿石', /没有树木、村庄与矿石/.test(WORLD_TYPE_HINTS.flat));
  check('默认世界自称完整', WORLD_TYPE_HINTS.default.includes('完整世界'));
}

console.log('\n[二、超平坦：只有三层]');
{
  const flat = sample('flat');
  equal('超平坦只有 3 种方块', flat.unique.size, 3);
  check('有基岩', flat.has(Block.BEDROCK));
  check('有泥土', flat.has(Block.DIRT));
  check('有草方块', flat.has(Block.GRASS_BLOCK));
  check('没有原木（没有树）', !flat.has(Block.OAK_LOG) && !flat.has(Block.OAK_LEAVES));
  check('没有矿石（煤/铁/钻石都找不到）', !flat.has(Block.COAL_ORE) && !flat.has(Block.IRON_ORE) && !flat.has(Block.DIAMOND_ORE));
  // 实心格数 = 16×16 × 4 层（基岩 1 + 泥土 2 + 草 1）
  equal('实心格数正好四层', flat.solid, 16 * 16 * 4);
  equal('最低层是基岩所在高度', flat.minY, FLAT_LAYERS.bedrockY + 0, `${flat.minY}`);
}

console.log('\n[三、默认 / 放大化：完整世界]');
{
  const normal = sample('default');
  const amplified = sample('amplified');
  check('默认世界方块种类丰富（> 20 种）', normal.unique.size > 20, `${normal.unique.size} 种`);
  check('默认世界有树（原木或树叶）', normal.has(Block.OAK_LOG) || normal.has(Block.OAK_LEAVES));
  check('默认世界有花草（短草或蒲公英）', normal.has(Block.SHORT_GRASS) || normal.has(Block.DANDELION));
  check('放大化也有地物', amplified.unique.size > 20, `${amplified.unique.size} 种`);
  let firstDiff = -1;
  for (let i = 0; i < normal.blocks.length; i++) {
    if (normal.blocks[i] !== amplified.blocks[i]) {
      firstDiff = i;
      break;
    }
  }
  check('放大化与默认不是同一份地形（同一区块逐格比较）', firstDiff >= 0, `第一处不同在 ${firstDiff}`);
  check('默认世界比超平坦高得多（有山或树）', normal.maxY > FLAT_LAYERS.grassY + 3, `${normal.maxY}`);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);

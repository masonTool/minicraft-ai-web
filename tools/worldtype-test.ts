/**
 * 世界类型（批次 483：`caves` / `floating_islands`）
 *
 * 三块：
 *  ① 类型表本身（五种、每种都有名称/说明/地表基准）；
 *  ② 洞穴世界：**空气占多数**、底部有垫底（不掉出世界）、高处没有"地表"；
 *  ③ 浮空岛：地表之上真的有实心方块，而默认世界在同样高度是空气（负对照）。
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Chunk } from '../src/core/world/Chunk.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import {
  WORLD_SURFACE_Y,
  WORLD_TYPES,
  WORLD_TYPE_HINTS,
  WORLD_TYPE_LABELS,
  isWorldType,
  type WorldType,
} from '../src/core/gen/WorldType.ts';

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

const SEED = 20261014;

/** 数某个高度区间里"实心方块"的格子数（空气/水都算不实心） */
function countSolid(
  cx: number,
  cz: number,
  worldType: WorldType,
  yFrom: number,
  yTo: number,
  step = 1,
): { solid: number; air: number } {
  const blocks = generateChunkBlocks(cx, cz, SEED, undefined, worldType);
  takeGeneratedStates();
  let solid = 0;
  let air = 0;
  for (let y = yFrom; y <= yTo; y += step) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = blocks[Chunk.index(x, y, z)]!;
        if (id === Block.AIR || id === Block.WATER) air++;
        else solid++;
      }
    }
  }
  return { solid, air };
}

console.log('\n[五种世界类型]');
{
  equal('一共五种', WORLD_TYPES.length, 5);
  check('洞穴世界在列表里', WORLD_TYPES.includes('caves'));
  check('浮空岛在列表里', WORLD_TYPES.includes('floating_islands'));
  for (const type of WORLD_TYPES) {
    check(`${type} 有中文名`, (WORLD_TYPE_LABELS[type] ?? '').length > 0, WORLD_TYPE_LABELS[type]);
    check(`${type} 有说明`, (WORLD_TYPE_HINTS[type] ?? '').length > 0);
    check(`${type} 有地表基准`, Number.isFinite(WORLD_SURFACE_Y[type]));
  }
  check('isWorldType 认新类型', isWorldType('caves') && isWorldType('floating_islands'));
  check('isWorldType 不认拼错的', !isWorldType('cave'));
}

console.log('\n[洞穴世界：只剩洞穴]');
{
  // 扫一大段高度：洞壁应当是少数（空气占多数），否则就不是"洞穴世界"而是实心世界
  const { solid, air } = countSolid(3, 5, 'caves', -64, 120);
  const airRatio = air / (solid + air);
  check('空气占多数（洞腔比岩壁多）', airRatio > 0.5, `空气 ${(airRatio * 100).toFixed(1)}%`);
  check('确实还有岩壁（不是全空）', solid > 0, `${solid} 格`);

  // 底部垫实：掉不出世界
  const bottom = countSolid(3, 5, 'caves', -64, -61);
  equal('最下面 4 层全是实心', bottom.air, 0);

  // 高处没有"地表"：默认世界在 y=100 之上基本是空气，洞穴世界也一样没有整片地面
  const high = countSolid(3, 5, 'caves', 100, 120);
  check('高处没有整片地面', high.air > high.solid, `实心 ${high.solid} / 空气 ${high.air}`);
}

console.log('\n[浮空岛：地表之上还有岛]');
{
  // 地表基准 64：往上看 20~60 格。默认世界那里是天空，浮空岛世界应该有实心。
  const islands = countSolid(3, 5, 'floating_islands', 84, 124);
  const plain = countSolid(3, 5, 'default', 84, 124);
  check('浮空岛世界在地表之上有实心方块', islands.solid > 0, `${islands.solid} 格`);
  equal('同一片天空在默认世界里是空的（负对照）', plain.solid, 0);
  check('浮空岛不是"整片天花板"（还留得出天空）', islands.air > islands.solid, `实心 ${islands.solid} / 空气 ${islands.air}`);
  // 地表本体还在：把整个"地下"扫一遍（到 y=80），实心应占多数。
  // ⚠️ 不能只看 y=50~70：那一层可能正好落在海里/山谷（第一版就是这么红的）
  const ground = countSolid(3, 5, 'floating_islands', -64, 80);
  check('地面本体还在（地下以实心为主）', ground.solid > ground.air, `实心 ${ground.solid} / 空气 ${ground.air}`);
}

console.log('\n[默认世界不受影响]');
{
  const ground = countSolid(3, 5, 'default', -64, 80);
  check('默认世界的地下以实心为主', ground.solid > ground.air, `实心 ${ground.solid} / 空气 ${ground.air}`);
  const sky = countSolid(3, 5, 'default', 120, 140);
  equal('默认世界的高空没有方块', sky.solid, 0);
}


console.log('\n[洞穴世界跳过地物与结构（批次 485）]');
{
  /** 数某个方块 id 在一个区块里出现了几次（扫全高度） */
  const countBlock = (cx: number, cz: number, worldType: WorldType, id: number): number => {
    const blocks = generateChunkBlocks(cx, cz, SEED, undefined, worldType);
    takeGeneratedStates();
    let count = 0;
    for (let y = -64; y < 200; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (blocks[Chunk.index(x, y, z)] === id) count++;
        }
      }
    }
    return count;
  };

  // 抽样几个区块：洞穴世界里不该出现树干与树叶（它们只能来自地物）
  const caveLogs = [3, 4, 5].reduce((sum, cx) => sum + countBlock(cx, 5, 'caves', Block.OAK_LOG), 0);
  const caveLeaves = [3, 4, 5].reduce((sum, cx) => sum + countBlock(cx, 5, 'caves', Block.OAK_LEAVES), 0);
  equal('洞穴世界里没有树干（地物被跳过）', caveLogs, 0);
  equal('洞穴世界里没有树叶', caveLeaves, 0);

  // 浮空岛与默认世界**不该**被这条影响：它们仍然有地表植被。
  // 用 `FeatureStats.trees`（地物计数）而不是"数原木"：树可能长在别的区块，
  // 数方块会受"这片刚好没树"影响（第一版就是这么红的）
  const treesOf = (cx: number, cz: number, worldType: WorldType): number => {
    const stats = { trees: 0, plants: 0, specials: 0 };
    generateChunkBlocks(cx, cz, SEED, undefined, worldType, undefined, stats);
    takeGeneratedStates();
    return stats.trees;
  };
  let foundPlainTrees = 0;
  outer: for (let cz = 0; cz < 8; cz++) {
    for (let cx = 0; cx < 8; cx++) {
      const trees = treesOf(cx, cz, 'default');
      if (trees > 0) {
        foundPlainTrees = trees;
        break outer;
      }
    }
  }
  check('默认世界有地表植被（负对照）', foundPlainTrees > 0, `${foundPlainTrees} 棵`);
  // 浮空岛只改地形、不碰地物：同一个区块的树数应当与默认世界一致
  equal(
    '浮空岛世界的地物与默认世界一致（只跳过 caves）',
    treesOf(0, 0, 'floating_islands'),
    treesOf(0, 0, 'default'),
  );
}

console.log(`\n世界类型测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

/**
 * 矿石分布与大矿脉离线测试
 *
 * 运行：npm run test:ore
 *
 * 断言重点：
 *   1. **跨区块写入**：矿脉在区块边界两侧必须接壤（存在跨边界的相邻矿石对），
 *      且结果与区块访问顺序无关 —— 这是"同一条矿脉被相邻区块重建出相同形状"的直接证据；
 *   2. **大矿脉（Ore Vein）**：铜矿脉伴随花岗岩与粗铜块、铁矿脉伴随凝灰岩与粗铁块，
 *      伴生岩只出现在矿脉的高度带内，粗金属块显著稀有；
 *   3. **丰度关系**：煤炭 > 铁、煤炭 > 铜，钻石明显比其他矿石稀有且集中在深部。
 */

import { ORE_BLOCKS } from '../src/core/gen/OreGenerator.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import {
  type BlockArray,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  Chunk,
  WORLD_HEIGHT,
  WORLD_MIN_Y,
} from '../src/core/world/Chunk.ts';
import { Block, blockDef } from '../src/core/registry/blocks.ts';

const label = (id: number): string => blockDef(id).name.replace('minicraft:', '');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

const SEED = 424242;
const N = 10; // 10×10 区块样本

/** 大矿脉的高度带 */
const VEIN_BAND_MIN = -30;
const VEIN_BAND_MAX = 60;

console.log('\n[矿石丰度]');
const counts = new Map<number, number>();
const extras = new Map<number, number>();
const heights = new Map<number, number[]>();
let outOfBandHosts = 0;
{
  const generator = new OverworldGenerator(SEED);
  const started = Date.now();

  for (let cx = 0; cx < N; cx++) {
    for (let cz = 0; cz < N; cz++) {
      const blocks = generator.generate(cx, cz);
      for (let y = WORLD_MIN_Y; y < WORLD_MIN_Y + WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
          for (let x = 0; x < CHUNK_SIZE_X; x++) {
            const id = blocks[Chunk.index(x, y, z)]!;
            if (ORE_BLOCKS.has(id)) {
              counts.set(id, (counts.get(id) ?? 0) + 1);
              const list = heights.get(id);
              if (list) list.push(y);
              else heights.set(id, [y]);
            } else if (
              id === Block.GRANITE ||
              id === Block.TUFF ||
              id === Block.RAW_COPPER_BLOCK ||
              id === Block.RAW_IRON_BLOCK
            ) {
              extras.set(id, (extras.get(id) ?? 0) + 1);
              if (y < VEIN_BAND_MIN || y > VEIN_BAND_MAX) outOfBandHosts++;
            }
          }
        }
      }
    }
  }

  const elapsed = Date.now() - started;
  console.log(`    生成 ${N * N} 个区块耗时 ${elapsed}ms（${(elapsed / (N * N)).toFixed(1)}ms/区块）`);
  for (const [id, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${label(id).padEnd(34)} ${String(count).padStart(7)}  ${(count / (N * N)).toFixed(1)}/区块`);
  }
  console.log('    大矿脉伴生：');
  for (const [id, count] of extras) {
    console.log(`    ${label(id).padEnd(34)} ${String(count).padStart(7)}  ${(count / (N * N)).toFixed(1)}/区块`);
  }

  const perChunk = (id: number): number => (counts.get(id) ?? 0) / (N * N);
  const coal = perChunk(Block.COAL_ORE);
  const iron = perChunk(Block.IRON_ORE) + perChunk(Block.DEEPSLATE_IRON_ORE);
  const copper = perChunk(Block.COPPER_ORE) + perChunk(Block.DEEPSLATE_COPPER_ORE);
  const gold = perChunk(Block.GOLD_ORE) + perChunk(Block.DEEPSLATE_GOLD_ORE);
  const redstone = perChunk(Block.REDSTONE_ORE) + perChunk(Block.DEEPSLATE_REDSTONE_ORE);
  const lapis = perChunk(Block.LAPIS_ORE) + perChunk(Block.DEEPSLATE_LAPIS_ORE);
  const diamond = perChunk(Block.DIAMOND_ORE) + perChunk(Block.DEEPSLATE_DIAMOND_ORE);
  const emerald = perChunk(Block.EMERALD_ORE) + perChunk(Block.DEEPSLATE_EMERALD_ORE);

  console.log(
    `    每区块：煤 ${coal.toFixed(1)} / 铁 ${iron.toFixed(1)} / 铜 ${copper.toFixed(1)} / 金 ${gold.toFixed(1)}` +
      ` / 红石 ${redstone.toFixed(1)} / 青金石 ${lapis.toFixed(1)} / 钻石 ${diamond.toFixed(1)} / 绿宝石 ${emerald.toFixed(1)}`,
  );

  check('每区块都能采到煤炭', coal > 20, `${coal.toFixed(1)}/区块`);
  check('煤炭多于铁与铜（原版丰度关系）', coal > iron && coal > copper, `煤 ${coal.toFixed(1)} / 铁 ${iron.toFixed(1)} / 铜 ${copper.toFixed(1)}`);
  check('钻石比金、红石、青金石都稀有', diamond < gold && diamond < redstone && diamond < lapis, `钻石 ${diamond.toFixed(2)}`);
  check('绿宝石最稀有（只限山地）', emerald < diamond, `绿宝石 ${emerald.toFixed(2)} vs 钻石 ${diamond.toFixed(2)}`);

  const diamondHeights = (heights.get(Block.DEEPSLATE_DIAMOND_ORE) ?? []).sort((a, b) => a - b);
  const median = diamondHeights[Math.floor(diamondHeights.length / 2)] ?? 0;
  check('钻石集中在地下深处（中位高度 < 0）', median < 0, `中位高度 ${median}`);

  console.log('\n[大矿脉]');
  const granite = extras.get(Block.GRANITE) ?? 0;
  const tuff = extras.get(Block.TUFF) ?? 0;
  const rawCopper = extras.get(Block.RAW_COPPER_BLOCK) ?? 0;
  const rawIron = extras.get(Block.RAW_IRON_BLOCK) ?? 0;

  check('铜矿脉的花岗岩伴生岩存在', granite > 200 / (N * N / 25), `${granite} 格`);
  check('铁矿脉的凝灰岩伴生岩存在', tuff > 200 / (N * N / 25), `${tuff} 格`);
  check('两种大矿脉规模相当（花岗岩与凝灰岩同量级）', granite / Math.max(1, tuff) < 4 && tuff / Math.max(1, granite) < 4, `花岗岩 ${granite} / 凝灰岩 ${tuff}`);
  check('粗铜块存在且显著稀有', rawCopper > 0 && rawCopper < granite * 0.2, `粗铜块 ${rawCopper} / 花岗岩 ${granite}`);
  check('粗铁块存在且显著稀有', rawIron > 0 && rawIron < tuff * 0.2, `粗铁块 ${rawIron} / 凝灰岩 ${tuff}`);
  check('伴生岩只出现在大矿脉的高度带内', outOfBandHosts === 0, `越界 ${outOfBandHosts} 格`);
}

console.log('\n[跨区块写入]');
{
  const generator = new OverworldGenerator(SEED);

  const grid = new Map<string, BlockArray>();
  for (let cx = 0; cx < 3; cx++) {
    for (let cz = 0; cz < 2; cz++) {
      grid.set(`${cx},${cz}`, generator.generate(cx, cz));
    }
  }

  const isOre = (blocks: BlockArray, x: number, y: number, z: number): boolean =>
    ORE_BLOCKS.has(blocks[Chunk.index(x, y, z)]!);

  let touchingX = 0;
  let touchingZ = 0;
  for (let cx = 0; cx < 2; cx++) {
    for (let cz = 0; cz < 2; cz++) {
      const left = grid.get(`${cx},${cz}`)!;
      const right = grid.get(`${cx + 1},${cz}`)!;
      for (let y = WORLD_MIN_Y; y < WORLD_MIN_Y + WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
          if (isOre(left, 15, y, z) && isOre(right, 0, y, z)) touchingX++;
        }
      }
    }
  }
  for (let cx = 0; cx < 2; cx++) {
    const near = grid.get(`${cx},0`)!;
    const far = grid.get(`${cx},1`)!;
    for (let y = WORLD_MIN_Y; y < WORLD_MIN_Y + WORLD_HEIGHT; y++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        if (isOre(near, x, y, 15) && isOre(far, x, y, 0)) touchingZ++;
      }
    }
  }

  console.log(`    X 方向跨边界矿石接壤 ${touchingX} 对，Z 方向 ${touchingZ} 对`);
  check('矿脉在 X 方向跨过区块边界', touchingX > 0, `${touchingX} 对`);
  check('矿脉在 Z 方向跨过区块边界', touchingZ > 0, `${touchingZ} 对`);

  const a = generator.generate(7, -3);
  const b = generator.generate(7, -3);
  let identical = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      identical = false;
      break;
    }
  }
  check('同一区块重复生成结果一致', identical);

  const orderA = new OverworldGenerator(SEED).generate(4, 4);
  const warmup = new OverworldGenerator(SEED);
  warmup.generate(-1, -1);
  warmup.generate(0, 0);
  warmup.generate(4, 3);
  const orderB = warmup.generate(4, 4);
  let orderIdentical = true;
  for (let i = 0; i < orderA.length; i++) {
    if (orderA[i] !== orderB[i]) {
      orderIdentical = false;
      break;
    }
  }
  check('生成结果与区块访问顺序无关', orderIdentical);
}

console.log(`\n矿石测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);

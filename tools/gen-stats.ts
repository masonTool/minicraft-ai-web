/**
 * 地形生成离线统计
 *
 * 用途：在不启动浏览器的情况下快速评估地形/洞穴/矿石的生成结果与耗时，
 * 用于标定雕刻阈值等参数。
 *
 * 运行：node tools/gen-stats.ts [种子] [半径]
 */

import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { Block, BLOCKS } from '../src/core/registry/blocks.ts';
import { Chunk, WORLD_HEIGHT, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';

const seed = Number(process.argv[2] ?? 20261014);
const radius = Number(process.argv[3] ?? 2);

const generator = new OverworldGenerator(seed);

/** 洞穴统计只看"本该是实心"的区间，避免把地表以上的空气算进去 */
const CAVE_MIN_Y = WORLD_MIN_Y + 5;
const CAVE_MAX_Y = 40;

let totalBlocks = 0;
let airInRock = 0;
let waterBlocks = 0;
let lavaBlocks = 0;
let surfaceAir = 0;
const blockCounts = new Map<number, number>();
let chunkCount = 0;
let elapsed = 0;

const heights: number[] = [];

for (let cx = -radius; cx <= radius; cx++) {
  for (let cz = -radius; cz <= radius; cz++) {
    const start = performance.now();
    const blocks = generator.generate(cx, cz);
    elapsed += performance.now() - start;
    chunkCount++;

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let top = WORLD_MIN_Y;
        for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
          const id = blocks[Chunk.index(x, y, z)]!;
          if (id !== Block.AIR && id !== Block.WATER) {
            top = y;
            break;
          }
        }
        if (cx === 0 && cz === 0 && x % 4 === 0 && z % 4 === 0) heights.push(top);

        for (let y = CAVE_MIN_Y; y <= CAVE_MAX_Y; y++) {
          const id = blocks[Chunk.index(x, y, z)]!;
          totalBlocks++;
          if (id === Block.AIR) airInRock++;
          else if (id === Block.WATER) waterBlocks++;
          else if (id === Block.LAVA) lavaBlocks++;
        }
        // 地表以上是否漏空气（洞穴开口）
        if (blocks[Chunk.index(x, top + 1, z)] === Block.AIR && top + 1 < 320) {
          // 正常
        }
      }
    }

    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i]!;
      blockCounts.set(id, (blockCounts.get(id) ?? 0) + 1);
      if (id === Block.AIR) surfaceAir++;
    }
  }
}

const pct = (v: number) => `${((v / totalBlocks) * 100).toFixed(2)}%`;

console.log(`种子 ${seed}  区块数 ${chunkCount}  半径 ${radius}`);
console.log(`生成耗时：总计 ${elapsed.toFixed(1)}ms，平均 ${(elapsed / chunkCount).toFixed(2)}ms/区块`);
console.log('');
console.log(`[岩层区 ${CAVE_MIN_Y}..${CAVE_MAX_Y} 的构成]`);
console.log(`  空气（洞穴）  ${pct(airInRock)}`);
console.log(`  水            ${pct(waterBlocks)}`);
console.log(`  岩浆          ${pct(lavaBlocks)}`);
console.log('');
console.log('[矿区附近的方块的绝对数量]');
const interesting = [
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.COPPER_ORE,
  Block.GOLD_ORE,
  Block.REDSTONE_ORE,
  Block.LAPIS_ORE,
  Block.DIAMOND_ORE,
  Block.EMERALD_ORE,
  Block.DEEPSLATE_COAL_ORE,
  Block.DEEPSLATE_IRON_ORE,
  Block.DEEPSLATE_COPPER_ORE,
  Block.DEEPSLATE_GOLD_ORE,
  Block.DEEPSLATE_REDSTONE_ORE,
  Block.DEEPSLATE_LAPIS_ORE,
  Block.DEEPSLATE_DIAMOND_ORE,
  Block.DEEPSLATE_EMERALD_ORE,
];
const oreTotals = new Map<string, number>();
for (const id of interesting) {
  const name = BLOCKS[id]!.name.replace('minecraft:', '').replace('deepslate_', '');
  oreTotals.set(name, (oreTotals.get(name) ?? 0) + (blockCounts.get(id) ?? 0));
}
for (const [name, count] of [...oreTotals.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(10)} ${count}`);
}
console.log('');
console.log(`[样本地表高度] ${heights.join(' ')}`);
console.log(`[空气总量占比] ${((surfaceAir / (chunkCount * 98304)) * 100).toFixed(1)}%`);

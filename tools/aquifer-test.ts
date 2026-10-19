/**
 * 含水层（Aquifer）离线测试与统计
 *
 * 运行：npm run test:aquifer
 *
 * 断言重点：
 *   1. 水位确实有水平变化（不是一刀切的平面），且始终不高于海平面；
 *   2. 雕刻出来的空洞在水位以下必须被灌满（空气残留为 0），水位以上保持空气；
 *   3. 岩浆只出现在深部（y ≤ -54 或 y < 0 的岩浆池），浅层流体一定是水；
 *   4. 生成是确定性的（同种子同区块两次结果一致）。
 */

import { LAVA_LEVEL } from '../src/core/gen/Aquifer.ts';
import { OverworldGenerator, SEA_LEVEL } from '../src/core/gen/OverworldGenerator.ts';
import { Chunk, WORLD_HEIGHT, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { Block } from '../src/core/registry/blocks.ts';

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

const SEED = 20261014;
const CHUNKS = 6;

console.log('\n[含水层：水位]');
{
  const generator = new OverworldGenerator(SEED);
  let min = Infinity;
  let max = -Infinity;
  let atSea = 0;
  let deep = 0;
  const samples = 4000;
  for (let i = 0; i < samples; i++) {
    const x = (i % 100) * 13 - 640;
    const z = Math.floor(i / 100) * 29 - 580;
    const level = generator.waterLevelAt(x, z);
    min = Math.min(min, level);
    max = Math.max(max, level);
    if (level >= SEA_LEVEL - 0.5) atSea++;
    if (level < SEA_LEVEL - 30) deep++;
  }
  console.log(`    水位范围 ${min.toFixed(1)} ~ ${max.toFixed(1)}（海平面 ${SEA_LEVEL}）`);
  console.log(`    淹到海平面的列 ${((atSea / samples) * 100).toFixed(1)}%，深水位列 ${((deep / samples) * 100).toFixed(1)}%`);
  check('水位不高于海平面', max <= SEA_LEVEL + 1e-6, `实测最高 ${max}`);
  check('水位有水平变化（不是常数）', max - min > 10, `极差 ${(max - min).toFixed(1)}`);
  check('存在被淹没到海平面的区域', atSea / samples > 0.05, `占比 ${((atSea / samples) * 100).toFixed(1)}%`);
  check('存在水位很低（基本无水）的区域', deep / samples > 0.05, `占比 ${((deep / samples) * 100).toFixed(1)}%`);
}

console.log('\n[含水层：填充]');
{
  const generator = new OverworldGenerator(SEED);
  let water = 0;
  let lava = 0;
  let airBelowLevel = 0;
  let shallowLava = 0;
  let yMaxWater = -Infinity;
  let samples = 0;

  for (let cx = 0; cx < CHUNKS; cx++) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      const blocks = generator.generate(cx, cz);
      const originX = cx * 16;
      const originZ = cz * 16;

      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const worldX = originX + x;
          const worldZ = originZ + z;
          const highest = Math.floor(generator.waterLevelAt(worldX, worldZ));

          // 该列最高非空气方块（排除水/岩浆本身，只关心实心地形的高度）
          let top = WORLD_MIN_Y - 1;
          for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
            const id = blocks[Chunk.index(x, y, z)]!;
            if (id !== Block.AIR && id !== Block.WATER && id !== Block.LAVA) {
              top = y;
              break;
            }
          }

          for (let y = WORLD_MIN_Y + 1; y <= highest && y <= top; y++) {
            const id = blocks[Chunk.index(x, y, z)]!;
            samples++;
            if (id === Block.WATER) {
              water++;
              yMaxWater = Math.max(yMaxWater, y);
            } else if (id === Block.LAVA) {
              lava++;
              if (y > 0) shallowLava++;
            } else if (id === Block.AIR) {
              airBelowLevel++;
            }
          }
        }
      }
    }
  }

  console.log(`    水位以下统计格数 ${samples}，水 ${water}，岩浆 ${lava}，残留空气 ${airBelowLevel}`);
  console.log(`    最高水位下方出现的水位于 y=${yMaxWater}`);
  check('雕刻出的空洞被灌满（水位以下无残留空气）', airBelowLevel === 0, `残留 ${airBelowLevel} 格`);
  check('确实产生了水体', water > 500, `水 ${water} 格`);
  check('深处产生了岩浆', lava > 0, `岩浆 ${lava} 格`);
  check('浅层没有岩浆', shallowLava === 0, `y>0 岩浆 ${shallowLava} 格`);
  check('水位以下的流体不高于海平面', yMaxWater <= SEA_LEVEL + 1, `最高 y=${yMaxWater}`);
}

console.log('\n[含水层：流体连续性（批次 283）]');
{
  // 批次的由来：地表灌水发生在雕刻**之前**，所以海底被掏空时那层海水会悬在空气上；
  // 而批次 281 的"加载后补排流动"已经撤销（真机上把光照预算吃满）。
  // 正确做法是在生成期就让水连续：水下的列，含水层水位不低于海平面。
  const generator = new OverworldGenerator(SEED);
  let hanging = 0;
  let water = 0;
  let underwaterCavesWater = 0;

  for (let cx = 0; cx < CHUNKS; cx++) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      const blocks = generator.generate(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = WORLD_MIN_Y + 1; y < SEA_LEVEL + 1; y++) {
            if (blocks[Chunk.index(x, y, z)] !== Block.WATER) continue;
            water++;
            if (blocks[Chunk.index(x, y - 1, z)] === Block.AIR) hanging++;
            // 海底以下的洞穴里的水：算一次"确实连到海里"的旁证
            if (y < SEA_LEVEL - 1 && blocks[Chunk.index(x, y + 1, z)] === Block.WATER) underwaterCavesWater++;
          }
        }
      }
    }
  }

  console.log(`    海平面以下的水 ${water} 格，悬空水 ${hanging} 格`);
  check('海平面以下没有"悬在空气上的水"', hanging === 0, `悬空 ${hanging} 格`);
  check('水下的体量正常（不是被抽干）', water > 10000, `水 ${water} 格`);
  check('海底以下的洞穴确实有水（与海连成一片）', underwaterCavesWater > 0, String(underwaterCavesWater));
}

console.log('\n[含水层：边界与确定性]');
{
  const a = new OverworldGenerator(SEED).generate(3, 2);
  const b = new OverworldGenerator(SEED).generate(3, 2);
  let identical = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      identical = false;
      break;
    }
  }
  check('同种子同区块生成结果一致', identical);

  check('LAVA_LEVEL 为 -54（对齐原版）', LAVA_LEVEL === -54);

  // 含水层只填空气，不应该覆盖已有海水：抽查区块列，水面以上不得被改成水
  const blocks = a;
  let badAboveWater = 0;
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const id = blocks[Chunk.index(x, SEA_LEVEL + 1, z)]!;
      if (id === Block.WATER || id === Block.LAVA) badAboveWater++;
    }
  }
  check('海平面之上不会被灌水', badAboveWater === 0, `越界 ${badAboveWater} 格`);
}

console.log(`\n含水层测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);

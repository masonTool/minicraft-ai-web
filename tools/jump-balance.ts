/**
 * 跳一跳的**难度平衡模拟**（J3，批次 20261022-2220）
 *
 * 运行：`npm run jump:balance`
 *
 * 它回答三个问题（都不用开浏览器）：
 *  1. 生成器会不会造出"理论上跳不到"的间距？（可达率必须 100%）
 *  2. 一个"每次都精准"的玩家能一直跳下去吗？（不能的话难度曲线写错了）
 *  3. 一个"手抖"的玩家平均能玩多久 / 多少分？（太短 = 劝退，太长 = 无聊）
 *
 * 随机数是确定性的（`logic.nextRandom`），所以这次输出与下次一样，便于对比调参前后。
 */

import { JUMP_CONFIG } from '../src/minigame/games/jump/config.ts';
import {
  createRun,
  currentBlock,
  gapRangeForScore,
  jump,
  maxReachableGap,
  nextBlock,
  nextRandom,
  targetBlock,
  type JumpRun,
} from '../src/minigame/games/jump/logic.ts';

type Skill = 'perfect' | 'sharp' | 'random';

let rngState = 20261022;
function rand(): number {
  const next = nextRandom(rngState);
  rngState = next.seed;
  return next.value;
}

/** 近似正态：两个均匀分布求和，再映射到 [-1, 1] */
function jitter(): number {
  return (rand() + rand() - 1) * 2;
}

interface Result {
  readonly skill: Skill;
  readonly runs: number;
  readonly avgJumps: number;
  readonly avgScore: number;
  readonly bestScore: number;
  readonly worstScore: number;
  readonly capRate: number;
}

const MAX_JUMPS = 300;

/**
 * 手抖的距离误差（格）——**绝对值，不是距离的百分比**。
 *
 * 玩家按的是时长，误差来自"早按/晚按了 0.1 秒"：`0.1s × maxDistance / maxCharge ≈ 0.5 格`，
 * 与目标远近无关。旧版用的是"距中心的 ±12%"，那在旧参数（间距 2.6~4.2 格、方块 2.0~0.9）
 * 下恰好与半块边长同量级；但 `[跳5]` 把间距改成"边长的 1.15~1.9 倍"之后，12% 的间距
 * 永远小于半块（0.24 格 vs 0.45 格），模拟里就成了一局不死——注释写着 ±0.18 格、
 * 代码却是百分比，本来就是两套说法，这里统一成绝对误差。
 */
const TIMING_ERROR = 0.55;

function playOne(skill: Skill, seed: number): { jumps: number; score: number; capped: boolean } {
  let run: JumpRun = createRun(seed);
  let jumps = 0;
  let capped = false;

  while (run.status === 'playing' && jumps < MAX_JUMPS) {
    const from = currentBlock(run);
    const to = targetBlock(run);
    const exact = Math.hypot(to.x - from.x, to.z - from.z);

    let distance: number;
    if (skill === 'perfect') distance = exact;
    else if (skill === 'sharp') distance = exact + jitter() * TIMING_ERROR;
    else distance = rand() * JUMP_CONFIG.maxDistance;

    distance = Math.min(JUMP_CONFIG.maxDistance, Math.max(0, distance));
    const outcome = jump(run, distance);
    run = outcome.run;
    jumps += 1;
    if (outcome.over) break;
  }

  if (jumps >= MAX_JUMPS) capped = true;
  return { jumps, score: run.score, capped };
}

function simulate(skill: Skill, runs: number): Result {
  let totalJumps = 0;
  let totalScore = 0;
  let best = 0;
  let worst = Number.POSITIVE_INFINITY;
  let capped = 0;

  for (let i = 0; i < runs; i++) {
    const one = playOne(skill, 1000 + i * 7919);
    totalJumps += one.jumps;
    totalScore += one.score;
    best = Math.max(best, one.score);
    worst = Math.min(worst, one.score);
    if (one.capped) capped += 1;
  }

  return {
    skill,
    runs,
    avgJumps: totalJumps / runs,
    avgScore: totalScore / runs,
    bestScore: best,
    worstScore: worst,
    capRate: capped / runs,
  };
}

/** 可达率：用 5000 次生成覆盖 0~300 分，检查每个间距都在最大距离内 */
function reachableRate(): number {
  let ok = 0;
  let total = 0;
  let current = createRun(1).blocks[0]!;
  let seed = 424242;
  for (let score = 0; score <= 300; score++) {
    const generated = nextBlock(current, score, seed);
    const gap = Math.hypot(generated.block.x - current.x, generated.block.z - current.z);
    const range = gapRangeForScore(score);
    total += 1;
    if (gap <= maxReachableGap() + 1e-9 && gap >= range.from - 1e-9 && gap <= range.to + 1e-9) ok += 1;
    current = generated.block;
    seed = generated.seed;
  }
  return ok / total;
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(18)} ${value}`);
}

const reach = reachableRate();
const perfect = simulate('perfect', 200);
const sharp = simulate('sharp', 500);
const random = simulate('random', 500);

console.log('跳一跳 · 难度平衡模拟');
console.log(`  参数：最大距离 ${JUMP_CONFIG.maxDistance} 格 · 间距上限 ${maxReachableGap().toFixed(2)} 格 · 蓄满 ${JUMP_CONFIG.maxCharge}s`);
console.log('');
line('可达率', `${(reach * 100).toFixed(2)}%（0~300 分逐分生成）`);
line('完美玩家', `${perfect.avgScore.toFixed(1)} 分 / ${perfect.avgJumps.toFixed(1)} 跳`);
line('手抖 ±' + TIMING_ERROR + ' 格', `${sharp.avgScore.toFixed(1)} 分 / ${sharp.avgJumps.toFixed(1)} 跳（最高 ${sharp.bestScore}）`);
line('乱按', `${random.avgScore.toFixed(1)} 分 / ${random.avgJumps.toFixed(1)} 跳（最高 ${random.bestScore}）`);
console.log('');

const failures: string[] = [];
if (reach < 1) failures.push(`可达率不是 100%（${(reach * 100).toFixed(2)}%）`);
if (perfect.capRate < 1) failures.push('完美玩家掉下去了（难度曲线有问题）');
if (sharp.avgJumps < 8) failures.push(`手抖玩家平均只跳 ${sharp.avgJumps.toFixed(1)} 次（太劝退）`);
if (sharp.avgJumps > 200) failures.push(`手抖玩家平均跳 ${sharp.avgJumps.toFixed(1)} 次（太难死，没挑战）`);
if (sharp.avgScore <= random.avgScore) failures.push('手抖玩家不如乱按（手感没有回报）');

if (failures.length > 0) {
  console.log('✗ 平衡不达标：');
  for (const failure of failures) console.log(`  · ${failure}`);
  process.exit(1);
}

console.log('✓ 平衡达标（可达 100% / 完美玩家不掉 / 手抖玩家优于乱按）');

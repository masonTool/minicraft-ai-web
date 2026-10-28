/**
 * 方块行为快照校验（批次 20261025-0329 · 宿主2）
 *
 * 作用有两层：
 *   1. **现在**：给这 46 个"贴图/发光随状态变"的方块上一道回归锁。以后谁动了
 *      `frontTile` / `barrelFace` / `nozzleTile` 这类工厂，或者改错某块的状态位判据，
 *      这里会直接指名到方块——而不是等玩家发现"熔炉正面贴反了"。
 *   2. **宿主3**：把闭包从 SPECS 搬进 `BLOCK_BEHAVIORS` 时，这份快照就是"搬得对不对"的判据。
 *
 * 口径在 `behavior-signature.ts` 里（生成器与这里共用同一份，避免两边漂）。
 *
 * 失配时的处置：先看是**有意**改行为还是搬错了。有意改 → `npm run gen:behaviors` 重生成
 * 并在提交信息里说明；搬错了 → 改代码，**不要**重生成。
 *
 * 运行：npm run test:behaviors
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlockTable } from '../web/src/core/registry/blocks.ts';
import { STATE_COUNT, behaviorHash, hasBehavior } from './behavior-signature.ts';

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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = resolve(ROOT, 'tests/fixtures/block-behaviors.golden.json');

interface Golden {
  readonly version: number;
  readonly stateCount: number;
  readonly blocks: Readonly<Record<string, string>>;
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
const blocks = buildBlockTable();

/** 当前代码里带行为的方块 → 哈希 */
const current: Record<string, string> = {};
for (const block of blocks) {
  if (hasBehavior(block)) current[block.name] = behaviorHash(block);
}

console.log('\n[一、快照本身]');
{
  equal('快照版本为 1', golden.version, 1);
  equal('快照的 state 范围与口径一致', golden.stateCount, STATE_COUNT);
  check('快照非空（否则这道锁是空的）', Object.keys(golden.blocks).length > 0);
}

console.log('\n[二、集合一致]');
{
  const goldenNames = Object.keys(golden.blocks).sort();
  const currentNames = Object.keys(current).sort();
  const missing = goldenNames.filter((name) => !(name in current));
  const added = currentNames.filter((name) => !(name in golden.blocks));
  equal('带行为的方块数量一致', currentNames.length, goldenNames.length);
  check('快照里的方块现在都还在且带行为', missing.length === 0, missing.slice(0, 6).join(', '));
  check(
    '没有"新增带行为方块但快照没记"（否则快照过期）',
    added.length === 0,
    `${added.slice(0, 6).join(', ')}${added.length > 6 ? ` …共 ${added.length} 个` : ''}`,
  );
}

console.log('\n[三、逐块行为输出一致]');
{
  const changed: string[] = [];
  for (const [name, expected] of Object.entries(golden.blocks)) {
    const actual = current[name];
    if (actual !== expected) changed.push(`${name}（${expected} → ${actual ?? '缺失'}）`);
  }
  check(
    `全部 ${Object.keys(golden.blocks).length} 个方块的 stateTiles/faceTile/stateLight 输出未变`,
    changed.length === 0,
    changed.slice(0, 6).join(' / ') +
      (changed.length > 6 ? ` …共 ${changed.length} 个（先看是不是有意改的，再决定要不要 npm run gen:behaviors）` : ''),
  );
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);

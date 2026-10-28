/**
 * 方块行为输出快照生成器（批次 20261025-0329 · 宿主2）
 *
 * 为什么要有：宿主3 要把 `stateTiles` / `faceTile` / `stateLight` 从 SPECS 里搬出去
 * （闭包塞不进二进制，它们必须留在代码里）。这类搬迁最怕的不是"崩"，而是**静默改错**：
 * 熔炉正脸贴反、红石灯亮时不发光、桶盖方向错——引擎不报错，只有玩家看得出来。
 *
 * 所以先把**当前代码**在 46 个带行为方块上的输出全部固化下来（口径见 `behavior-signature.ts`），
 * 搬迁之后重算一遍，任何一个字对不上都会指名道姓地说出是哪个方块。
 *
 * 产物：`tests/fixtures/block-behaviors.golden.json`（**要提交**，它是基线）
 *
 * ⚠️ 重跑本脚本 = 承认"这些行为变化是有意的"。改行为时先跑 `npm run test:behaviors`
 * 看清楚哪几个方块变了，再决定要不要重生成。
 *
 * 运行：`npm run gen:behaviors`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlockTable } from '../web/src/core/registry/blocks.ts';
import { STATE_COUNT, behaviorHash, hasBehavior } from './behavior-signature.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/fixtures/block-behaviors.golden.json');

const blocks = buildBlockTable();
const entries: Record<string, string> = {};
for (const block of blocks) {
  if (!hasBehavior(block)) continue;
  entries[block.name] = behaviorHash(block);
}

const names = Object.keys(entries).sort();
const sorted: Record<string, string> = {};
for (const name of names) sorted[name] = entries[name]!;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ version: 1, stateCount: STATE_COUNT, blocks: sorted }, null, 2)}\n`);

console.log(`\n行为快照 · ${names.length} 个带行为的方块 → ${OUT}`);
console.log(`  stateTiles/faceTile/stateLight 各扫 ${STATE_COUNT} 个 state（faceTile 再乘 6 个外法线）`);
console.log(`  示例：${names.slice(0, 5).join(', ')}…`);

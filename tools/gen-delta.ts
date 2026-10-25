/**
 * 生成方块表增量（批次 20261025-1032）
 *
 * 输入：`host/core-baseline.bin`（**App 里内置的那份快照**，随仓库提交）+ 当前的 SPECS
 * 输出：`.tmp/hostcore/core-delta.json`（没有变化就不产出）
 *
 * 这就是"改方块不用发版"的那一步：
 *   ① 改 `blockSpecs.ts`（改属性 / 末尾加方块）
 *   ② `npm run gen:delta` → 得到几十字节到几 KB 的 JSON
 *   ③ `npm run build:app` 发线上 → 老 App 下次启动自动应用，**不用重新发版**
 *
 * ⚠️ 什么时候**必须**发版（而不是发增量）：
 *   · 删方块（会让存档里的 id 全部错位，`buildDelta()` 会直接抛）；
 *   · 改二进制格式本身（`BLOCK_TABLE_VERSION` 变了）；
 *   · 想让"新基线"成为所有用户的起点（比如积攒的增量太大，想收进包里）。
 *     做法：把新的全量快照覆盖到 `host/core-baseline.bin`，再发一次 APK。
 *
 * 运行：`npm run gen:delta`
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlockTable } from '../src/core/registry/blocks.ts';
import { decodeBlockTable } from '../src/core/registry/blockTableCodec.ts';
import { buildDelta, isEmptyDelta } from '../src/core/registry/coreDelta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_FILE = resolve(ROOT, 'host/core-baseline.bin');
const BASELINE_JSON = resolve(ROOT, 'host/baseline.json');
const OUT = resolve(ROOT, '.tmp/hostcore/core-delta.json');

if (!existsSync(BASE_FILE)) {
  console.log(`\n没有 ${BASE_FILE}，跳过增量生成（首次打包时把 core.bin 复制成它即可）`);
  process.exit(0);
}

const base = decodeBlockTable(readFileSync(BASE_FILE));
const next = buildBlockTable();

let delta;
try {
  delta = buildDelta(base, next);
} catch (error) {
  console.error(`\n✗ 无法生成增量：${error instanceof Error ? error.message : String(error)}`);
  console.error('  删方块 / 改格式这类改动只能发版：更新 host/core-baseline.bin 并重新打包');
  process.exit(1);
}

if (isEmptyDelta(delta)) {
  // 没有变化就把旧文件删掉：留着一份过期增量比没有更危险（会被应用到新基线上）
  rmSync(OUT, { force: true });
  console.log(`\n方块表增量：无变化（基线 ${base.length} 条，与当前完全一致），不产出文件`);
  process.exit(0);
}

// 把"基于第几版基线"写进增量：客户端能据此给出"应用太老"的明确日志，
// 发布检查也能校验"这份增量与 App 里的基线是否同一版"
const baselineVersion: number | undefined = existsSync(BASELINE_JSON)
  ? (JSON.parse(readFileSync(BASELINE_JSON, 'utf8')) as { baselineVersion?: number }).baselineVersion
  : undefined;
const output = baselineVersion === undefined ? delta : { ...delta, baseVersion: baselineVersion };

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
const size = statSync(OUT).size;

console.log('\n方块表增量');
console.log(`  基线        ${BASE_FILE}（${base.length} 条）`);
console.log(`  当前        ${next.length} 条`);
console.log(`  改属性      ${delta.patches.length} 条${delta.patches.length > 0 ? `（${delta.patches.slice(0, 3).map((p) => p.name.replace('minicraft:', '')).join(', ')}${delta.patches.length > 3 ? '…' : ''}）` : ''}`);
console.log(`  新增        ${delta.appends.length} 条${delta.appends.length > 0 ? `（${delta.appends.slice(0, 3).map((a) => a.name.replace('minicraft:', '')).join(', ')}${delta.appends.length > 3 ? '…' : ''}）` : ''}`);
console.log(`  产物        ${OUT}（${size} 字节）`);
console.log(`  基线指纹    ${delta.baseFingerprint}`);
console.log(`  基线版本    ${baselineVersion === undefined ? '(无台账)' : `v${baselineVersion}`}`);

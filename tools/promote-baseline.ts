/**
 * 把一个候选快照**提升为基线**（批次 20261025-1627 · 发版时用）
 *
 * 这是"打包安卓 App"那一步里唯一需要人记得的动作：
 *
 *   npm run gen:hostcore      # 从当前 SPECS 生成候选快照（.tmp/hostcore/core-v1.bin）
 *   npm run release:baseline  # ← 把它封为本版基线，并写台账（host/baseline.json）
 *   # 然后把 host/core-baseline.bin 打进 APK 的 assets/core.bin
 *
 * 为什么要单独一步、而不是让 `gen:hostcore` 直接覆盖基线：
 * 生成快照是**每天都在发生**的事（内循环也会跑），而"封版"是**一个发布决策**。
 * 两者混在一起，就会出现"随手跑了一次生成，线上 App 的基线被悄悄换掉"——
 * 之后的增量全部套不上，而且没有任何记录能查是哪次改的。
 *
 * 台账 `host/baseline.json` 记的是"**当前线上 App 里装的是哪一份**"：
 * 版本号、截止日期、对应提交、方块条数、指纹、App 版本号。有了它，
 *   · `gen:delta` 知道自己在给哪一版算增量；
 *   · `release-check` 能校验"增量的 baseVersion 与基线一致"；
 *   · 半年后回头看，能回答"第 3 版基线是什么时候封的"。
 *
 * 用法：
 *   npm run release:baseline -- --app-version=1.0.0 --note="首个上架版本"
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBlockTable } from '../src/core/registry/blockTableCodec.ts';
import { fingerprint } from '../src/core/registry/coreDelta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE = resolve(ROOT, '.tmp/hostcore/core-v1.bin');
const BASELINE_BIN = resolve(ROOT, 'host/core-baseline.bin');
const BASELINE_JSON = resolve(ROOT, 'host/baseline.json');

interface BaselineRecord {
  /** 基线版本号：1, 2, 3…（增量靠它对齐，不要手改） */
  baselineVersion: number;
  /** 封版日期（YYYY-MM-DD） */
  cutAt: string;
  /** 封版时的提交（排查用） */
  gitCommit: string;
  /** 方块条数 */
  blockCount: number;
  /** 名字表指纹（与 bin 里解出来的一致才算数） */
  fingerprint: string;
  /** 这版 App 的 versionName（人看的） */
  appVersion: string;
  /** 备注：为什么封这一版 */
  note: string;
}

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

if (!existsSync(CANDIDATE)) {
  console.error(`\n✗ 没有候选快照 ${CANDIDATE}\n  先跑：npm run gen:hostcore`);
  process.exit(1);
}

const candidateBytes = readFileSync(CANDIDATE);
const table = decodeBlockTable(candidateBytes);
const next = {
  blockCount: table.length,
  fingerprint: fingerprint(table),
};

const previous: BaselineRecord | undefined = existsSync(BASELINE_JSON)
  ? (JSON.parse(readFileSync(BASELINE_JSON, 'utf8')) as BaselineRecord)
  : undefined;

// 内容没变就不升版本：否则会把"增量"的作用范围搅乱（第 4 版与第 3 版完全一样，
// 之后算增量时 baseVersion 到底是几？），也会让台账里出现一串无意义的记录。
if (previous !== undefined && previous.blockCount === next.blockCount && previous.fingerprint === next.fingerprint) {
  console.log(
    `\n基线未变（v${previous.baselineVersion}，${previous.blockCount} 条，指纹 ${previous.fingerprint}）` +
      '\n无需封版：这次打包直接用现成的 host/core-baseline.bin 即可。',
  );
  process.exit(0);
}

const gitCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const record: BaselineRecord = {
  baselineVersion: (previous?.baselineVersion ?? 0) + 1,
  cutAt: new Date().toISOString().slice(0, 10),
  gitCommit,
  blockCount: next.blockCount,
  fingerprint: next.fingerprint,
  appVersion: argOf('app-version') ?? JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version,
  note: argOf('note') ?? '',
};

copyFileSync(CANDIDATE, BASELINE_BIN);
writeFileSync(BASELINE_JSON, `${JSON.stringify(record, null, 2)}\n`);

console.log('\n已封版为新基线');
console.log(`  基线版本    v${record.baselineVersion}${previous === undefined ? '（首次）' : `（上一版 v${previous.baselineVersion}：${previous.blockCount} 条 / ${previous.fingerprint}）`}`);
console.log(`  方块条数    ${record.blockCount}`);
console.log(`  指纹        ${record.fingerprint}`);
console.log(`  截止日期    ${record.cutAt}`);
console.log(`  对应提交    ${record.gitCommit}`);
console.log(`  App 版本    ${record.appVersion}`);
if (record.note !== '') console.log(`  备注        ${record.note}`);
console.log(`\n  基线文件    ${BASELINE_BIN}`);
console.log(`  台账        ${BASELINE_JSON}`);
console.log('\n下一步：把 host/core-baseline.bin 打进 APK 的 assets/core.bin（两者必须逐字节一致）');

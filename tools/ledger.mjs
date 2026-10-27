#!/usr/bin/env node
/**
 * 台账收尾（一条命令干完 `DONE` 插入 / 归档 / 数字同步 / 队列归档）。
 *
 * **为什么要有它**：以前每批收尾要手写一大段 DONE、猜插入锚点、手改 HANDOFF 的三个数字、
 * 再重跑 `npm run check` 确认——一轮下来十几分钟，还经常因为"锚点写错 / 编号撞号"返工。
 * 这些步骤全是机械的，应该由脚本做。
 *
 * 用法：
 *   node tools/ledger.mjs --batch 20261027-2400 --note "这一批的一句话背景"
 *
 * 它做的事：
 *   1. 读 `.continue/doing/<会话>.md`（队列文件本身就是 DONE 条目的正文）；
 *   2. 把条目插到 `DONE.md` 的**第一条 `## 批次` 之前**（不猜锚点，永远插最上面）；
 *   3. 超限就调用 `archive-done.mjs` 把最旧的搬走；
 *   4. `audit-tasks.mjs --fix` 把 HANDOFF 的进度数字改成实际值；
 *   5. 归档队列（`archive-queue.mjs`），`doing/` 清空。
 *
 * 仍然要**手写**的只有两处（内容因批而异，没法自动生成）：
 *   - `.continue/notes/batches.md` 的一行摘要
 *   - `.continue/TASKS.md` 的任务条目（编号要避开已用的，脚本会打印当前最大编号）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const DONE = new URL('.continue/DONE.md', ROOT);
const DOING = new URL('.continue/doing/', ROOT);
const TASKS = new URL('.continue/TASKS.md', ROOT);

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const batch = arg('batch');
const note = arg('note') ?? '';

if (batch === undefined) {
  console.error('用法：node tools/ledger.mjs --batch 20261027-2400 [--note "一句话背景"]');
  process.exit(1);
}

// ---- 1. 找队列文件
const queueFiles = existsSync(DOING)
  ? readdirSync(DOING).filter((name) => name.endsWith('.md') && !name.startsWith('.'))
  : [];
if (queueFiles.length === 0) {
  console.error('✗ .continue/doing/ 里没有队列文件——先写队列，再收尾');
  process.exit(1);
}
const queueFile = queueFiles[0];
const queuePath = new URL(queueFile, DOING);
const body = readFileSync(queuePath, 'utf8').trim();
const session = queueFile.replace(/\.md$/, '');

// ---- 2. 组条目并插到 DONE 最前面
const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
  today.getDate(),
).padStart(2, '0')}`;
const entry = [
  `## 批次 ${batch} · ${date} · 会话 ${session}`,
  '',
  ...(note.length > 0 ? [`> ${note}`, ''] : []),
  body,
  '',
  '---',
  '',
  '',
].join('\n');

const doneText = readFileSync(DONE, 'utf8');
// 只认真正的批次标题：`## 批次 20261027-2400`。文档开头有一行模板示例
// （`## 批次 <号> · 日期 · 会话 <前 8 位>`），用 indexOf('## 批次') 会插到说明段里。
const firstBatch = doneText.search(/^## 批次 \d{8}-\d{4}/m);
if (firstBatch < 0) {
  writeFileSync(DONE, `${doneText.trimEnd()}\n\n${entry}`);
} else {
  writeFileSync(DONE, doneText.slice(0, firstBatch) + entry + doneText.slice(firstBatch));
}
console.log(`✓ DONE 已插入批次 ${batch}`);

// ---- 3. DONE 超限就搬最旧
try {
  execFileSync('node', [new URL('.continue/hooks/archive-done.mjs', ROOT).pathname], {
    stdio: 'inherit',
  });
} catch {
  console.log('（archive-done 跳过）');
}

// ---- 4. HANDOFF 数字自己算
try {
  execFileSync('node', [new URL('tools/audit-tasks.mjs', ROOT).pathname, '--fix'], {
    stdio: 'pipe',
  });
} catch {
  // 审计里还有别的错（编号重复等），这里不阻断收尾
}

// ---- 5. 归档队列
try {
  execFileSync('node', [new URL('.continue/hooks/archive-queue.mjs', ROOT).pathname, session], {
    stdio: 'pipe',
  });
  console.log('✓ 队列已归档，doing/ 清空');
} catch {
  console.log('（archive-queue 失败，请手动归档）');
}

// ---- 6. 提醒还需要手写的两处
const tasksText = readFileSync(TASKS, 'utf8');
// 只统计 L 段（UI 与音频）：别的段是 A/B/D/O/P… 前缀，混在一起算会给出错误的"下一个编号"
const lNumbers = [...tasksText.matchAll(/^- \[.\] L(\d+)/gm)].map((m) => Number(m[1]));
const max = lNumbers.reduce((acc, value) => Math.max(acc, value), 0);
console.log('');
console.log('还需要手写两处（内容因批而异）：');
console.log(`  1. .continue/notes/batches.md 加一行摘要（批次 ${batch}）`);
console.log(`  2. .continue/TASKS.md 加任务条目——当前最大编号是 L${max}，下一条用 L${max + 1}`);

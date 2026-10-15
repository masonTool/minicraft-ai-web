#!/usr/bin/env node
/**
 * 任务清单自检（TASKS.md / HANDOFF.md）
 *
 * 为什么要有这个脚本：`TASKS.md` 是"做到哪了"的唯一锚点，提交信息、队列文件、
 * 交接文档都靠它的 id 互相对照。它会随着每批工作不断被追加，于是很容易出现：
 *
 *   - **编号撞车**：新增条目随手写了个已经用过的号（本轮就发生过：新写的 M6/M7/M8
 *     与既有的"死亡界面/成就/i18n"重号）
 *   - **编号跳号**：删条目或插条目时漏号
 *   - **数字漂移**：HANDOFF 里写"已完成 78"，实际早就 85 了
 *
 * 所以这里做三件事，任何一个不过就以非 0 退出（方便挂到 CI 或提交前手动跑）：
 *   1. 报告 已完成 / 进行中 / 待办 的条数（HANDOFF 的数字要与它一致）
 *   2. 检查 id 是否重复、每段编号是否连续
 *   3. 核对 HANDOFF 的"进度口径"那一行
 *
 * 用法：`npm run audit:tasks`
 */

import { readFileSync } from 'node:fs';

const TASK_FILE = new URL('../TASKS.md', import.meta.url);
const HANDOFF_FILE = new URL('../HANDOFF.md', import.meta.url);

/** 【原规格】那条只是锚点，与详细条目共用 id 是允许的 */
const SPEC_MARK = '【原规格】';

const text = readFileSync(TASK_FILE, 'utf8');
const lines = text.split('\n');

const counts = { done: 0, doing: 0, todo: 0, dropped: 0 };
const ids = [];
/** @type {Map<string, string[]>} 段落字母 → 出现的编号 */
const byPrefix = new Map();

let section = '';
for (const line of lines) {
  const head = /^## ([0-9A-O])\./.exec(line);
  if (head) section = head[1];

  const item = /^- \[([ x~-])\] ([A-Z]+)(\d+[a-z]?)\b(.*)$/.exec(line);
  if (!item) continue;

  const [, mark, prefix, number, rest] = item;
  if (mark === 'x') counts.done++;
  else if (mark === '~') counts.doing++;
  else if (mark === '-') counts.dropped++;
  else counts.todo++;

  // 原规格锚点行不参与重号检查
  if (rest.includes(SPEC_MARK)) continue;

  const id = `${prefix}${number}`;
  ids.push({ id, section, line });
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(Number(number));
}

const total = counts.done + counts.doing + counts.todo + counts.dropped;
console.log(`TASKS.md 共 ${total} 项：已完成 ${counts.done} / 进行中 ${counts.doing} / 待办 ${counts.todo}${
  counts.dropped > 0 ? ` / 放弃 ${counts.dropped}` : ''
}`);

let failed = false;

// ---- 1. 重号
const seen = new Map();
const duplicates = [];
for (const entry of ids) {
  if (seen.has(entry.id)) duplicates.push(`${entry.id}（第 ${seen.get(entry.id)} 行 与 第 ${entry.line} 行）`);
  else seen.set(entry.id, entry.line);
}
if (duplicates.length > 0) {
  failed = true;
  console.log(`\n✗ 编号重复 ${duplicates.length} 处：`);
  for (const dup of duplicates) console.log(`    ${dup}`);
} else {
  console.log('✓ 编号无重复');
}

// ---- 2. 跳号
const gaps = [];
for (const [prefix, numbers] of [...byPrefix.entries()].sort()) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const missing = [];
  for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) {
    if (!sorted.includes(n)) missing.push(n);
  }
  if (missing.length > 0) gaps.push(`${prefix}: 缺 ${missing.join(', ')}`);
}
if (gaps.length > 0) {
  failed = true;
  console.log(`\n✗ 编号不连续：`);
  for (const gap of gaps) console.log(`    ${gap}`);
} else {
  console.log('✓ 各段编号连续');
}

// ---- 3. HANDOFF 的进度口径
const handoff = readFileSync(HANDOFF_FILE, 'utf8');
const claim = /已完成 \*\*(\d+)\*\*、进行中 \*\*(\d+)\*\*、待办 (\d+)/.exec(handoff);
if (!claim) {
  failed = true;
  console.log('\n✗ HANDOFF.md 里找不到"进度口径：已完成 **N**、进行中 **M**、待办 K"这一行');
} else {
  const [, done, doing, todo] = claim.map(Number);
  const ok = done === counts.done && doing === counts.doing && todo === counts.todo;
  if (ok) {
    console.log('✓ HANDOFF 的进度口径与本表一致');
  } else {
    failed = true;
    console.log(
      `\n✗ HANDOFF 的进度口径过期：写着 已完成 ${done} / 进行中 ${doing} / 待办 ${todo}，` +
        `实际是 ${counts.done} / ${counts.doing} / ${counts.todo}`,
    );
  }
}

if (failed) {
  console.log('\n自检未通过：修好上面几项再提交（别让锚点文档自己先漂了）');
  process.exit(1);
}
console.log('\n任务清单自检通过');

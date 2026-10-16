/**
 * "与原版的差异台账"自动汇总（TASKS O7）
 *
 * 由来：差异一直散在各条目的 `⚠️` 注记里（TASKS 与 HANDOFF 各处），
 * 查"这一条和原版哪里不一样"要翻好几屏。于是照 `audit:coverage` 那套路子，
 * **从原文里汇总**、写回 TASKS 的标记块之间——不许手抄（手抄的派生内容必然漂）。
 *
 * 说明：
 *  - 只收 `⚠️` 开头的注记（"已收掉"的差异写成 `~~划线~~`，自然进不来）；
 *  - 注记里大多确实是"与原版的差异"，也有少量"实现注意"（两种都值得集中查）；
 *  - 条目名取最近的 `- [x] Bxx 标题` 行（标题截到第一个括号为止）。
 *
 * 用法：`npm run audit:diffs`（`--print` 只打印不写回）
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../TASKS.md', import.meta.url);
const START = '<!-- diffs:start -->';
const END = '<!-- diffs:end -->';
const NOTE = '⚠️';
const printOnly = process.argv.includes('--print');

/** 文本上限：台账是"索引"，长段落到原文（同一行的条目名）里看 */
const MAX_TEXT = 240;

/** `- [x] B40 **标题**（批次 66…）` → `B40 标题`；不是条目行则返回 null */
function entryLabel(line) {
  const match = /^- \[[ x~]\]\s+([A-Z]+\d+)\b[\s.、:：]*(.*)$/.exec(line);
  if (!match) return null;
  const title = match[2]
    .replace(/[（(].*$/, '')
    .replace(/\*\*/g, '')
    .replace(/[：:].*$/, '')
    .trim()
    .slice(0, 28);
  return `${match[1]}${title ? ` ${title}` : ''}`;
}

const rawText = readFileSync(FILE, 'utf8');
const allLines = rawText.split('\n');
// ⚠️ 扫之前先把**台账自己**那段剔掉：否则它里面的 `⚠️` 会被当成新注记收进来（自我增殖）
const cutStart = allLines.findIndex((line) => line.includes(START));
const cutEnd = allLines.findIndex((line) => line.includes(END));
const lines =
  cutStart >= 0 && cutEnd > cutStart
    ? [...allLines.slice(0, cutStart), ...allLines.slice(cutEnd + 1)]
    : allLines;

/** @type {{ entry: string, text: string, kind: 'diff' | 'note' }[]} */
const found = [];
let current = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const label = entryLabel(line);
  if (label) {
    current = label;
    continue;
  }
  if (!line.includes(NOTE)) continue;

  // 一条注记最多收 3 行（空行、下一个条目、下一条注记都停下）
  const block = [line];
  let j = i + 1;
  while (j < lines.length && block.length < 3) {
    const next = lines[j];
    if (next.trim() === '' || /^\s*- \[/.test(next) || /^#/.test(next) || /^---/.test(next)) break;
    if (next.includes(NOTE)) break;
    block.push(next);
    j++;
  }
  let text = block
    .map((part) => part.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|');
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}…`;
  // "与原版的差异"那类才算差异账；其余是"实现注意"（也集中列出来，便于对照）
  const kind = /与原版/.test(text) ? 'diff' : 'note';
  found.push({ entry: current ?? '(未归入条目)', text, kind });
  i = j - 1;
}

const table = (kind) =>
  found
    .filter((item) => item.kind === kind)
    .map((item) => `| ${item.entry} | ${item.text} |`)
    .join('\n');

const diffs = found.filter((item) => item.kind === 'diff');
const notes = found.filter((item) => item.kind === 'note');

const section = `${START}

> 由 \`npm run audit:diffs\` 从各条目的 \`⚠️\` 注记**自动汇总**（手改会被覆盖）。
> 长段落在原文里看（条目名就是索引），找"这一条与原版哪里不一样"grep 本节。

### 与原版的差异（${diffs.length} 条）

| 条目 | 差异 |
| --- | --- |
${table('diff')}

### 实现注意（${notes.length} 条，不是差异，但同样"集中查"更好）

| 条目 | 注意 |
| --- | --- |
${table('note')}

${END}`;

const start = rawText.indexOf(START);
const end = rawText.indexOf(END);

if (start < 0 || end < 0 || end < start) {
  console.error(`\n✗ TASKS.md 里找不到差异台账标记块（${START} … ${END}）`);
  process.exit(1);
}

const currentBlock = rawText.slice(start, end + END.length);
if (currentBlock === section) {
  console.log(`\n✓ TASKS.md 的差异台账与各条目一致（差异 ${diffs.length} 条 / 注意 ${notes.length} 条）`);
  process.exit(0);
}

if (printOnly) {
  console.log(`\n· TASKS.md 的差异台账过期（差异 ${diffs.length} 条 / 注意 ${notes.length} 条，--print 模式不写回）`);
  process.exit(1);
}

writeFileSync(FILE, rawText.slice(0, start) + section + rawText.slice(end + END.length));
console.log(
  `\n✗ TASKS.md 的差异台账已按各条目的 ⚠️ 注记自动重写（差异 ${diffs.length} 条 / 注意 ${notes.length} 条），请重新暂存后提交`,
);
process.exit(1);

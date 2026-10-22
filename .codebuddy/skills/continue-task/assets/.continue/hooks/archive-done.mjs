#!/usr/bin/env node
/**
 * 把 `DONE.md` 里**最旧的批次小节**搬进 `DONE.archive.md`，直到主文件回到上限以内。
 *
 * 为什么存在（挡的是哪次事故）：`DONE.md` 有 300 行上限，超了 `audit-docs` 会红，
 * 但"接下来怎么办"原先只有一句"搬进 DONE.archive.md"——靠人手工剪贴。
 * 手工剪贴的后果很具体：切在半个小节中间、把最新的批次搬走、或者搬完忘了留标题层级。
 * 上限是机器在管，归档动作也该由机器执行（README §0 原理 7）。
 *
 * 用法：
 *   node .continue/hooks/archive-done.mjs           # 按上限自动搬
 *   node .continue/hooks/archive-done.mjs --dry-run # 只报告会搬哪几批
 *
 * 行为：
 *   · 不超上限 → 什么都不做，exit 0；
 *   · 超了 → 从**最旧**的批次开始整节搬到 `DONE.archive.md`（新搬的在上，历史顺序不倒）；
 *   · 主文件的表头（说明文字）永远留在原位；搬走的小节**原文照搬**，不改一个字。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DOC_BYTE_LIMITS, DOC_LIMITS, CONTINUE_DIR, PROJECT_ROOT } from './lib.mjs';
import { join } from 'node:path';

const DONE = join(CONTINUE_DIR, 'DONE.md');
const ARCHIVE = join(CONTINUE_DIR, 'DONE.archive.md');
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(DONE)) {
  console.error('  ✗ 没有 .continue/DONE.md，无需归档');
  process.exit(0);
}

const text = readFileSync(DONE, 'utf8');
const countLines = (s) => (s.length === 0 ? 0 : s.replace(/\r?\n$/, '').split(/\r?\n/).length);

/**
 * **两条上限都要守**：`audit-docs` 查行数 + 字节两套，归档却只看行数。
 *
 * 这是个真实的坑：一批的完成说明写得很详细时，行数只涨了 50、字节涨了 13KB；
 * 按行看"没超"，`audit-docs` 却因为 40KB 字节上限判红，而归档命令说"无需归档"——
 * 只能手工剪贴，正是这个脚本当初要消灭的动作。
 */
const lineLimit = DOC_LIMITS.DONE;
const byteLimit = DOC_BYTE_LIMITS.DONE;
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const over = (s) => countLines(s) > lineLimit || bytes(s) > byteLimit;

const before = countLines(text);
if (!over(text)) {
  console.log(
    `DONE.md 共 ${before} 行 / ${(bytes(text) / 1024).toFixed(0)}KB，` +
      `未超过上限 ${lineLimit} 行 / ${(byteLimit / 1024).toFixed(0)}KB，无需归档。`,
  );
  process.exit(0);
}

/** 表头 = 第一个 `## 批次` 之前的内容；小节 = 每个 `## 批次` 开头的一块。 */
const parts = text.split(/^(?=## 批次 )/m);
const head = parts.shift() ?? '';
const sections = parts; // 顺序：新 → 旧

const keep = [...sections];
const moved = [];
while (keep.length > 0 && over(head + keep.join(''))) {
  moved.push(keep.pop()); // 从最旧的开始搬
}
moved.reverse(); // 恢复成"新 → 旧"的顺序，写进归档时仍是这个顺序

if (moved.length === 0) {
  console.log('撑爆上限的是表头本身（批次小节已全部搬走），请手工精简说明文字。');
  process.exit(0);
}

const afterText = head + keep.join('');
const after = countLines(afterText);
console.log(
  `${dryRun ? '[dry-run] ' : ''}DONE.md ${before} 行 / ${(bytes(text) / 1024).toFixed(0)}KB → ` +
    `${after} 行 / ${(bytes(afterText) / 1024).toFixed(0)}KB（上限 ${lineLimit} 行 / ` +
    `${(byteLimit / 1024).toFixed(0)}KB），搬走 ${moved.length} 个批次：`,
);
for (const section of moved) {
  console.log(`  · ${section.split(/\r?\n/)[0].replace(/^## /, '')}`);
}

if (dryRun) process.exit(0);

const archiveHead = existsSync(ARCHIVE)
  ? ''
  : `# 更早的归档 · DONE.archive\n\n> 由 \`node .continue/hooks/archive-done.mjs\` 自动搬入，原文照搬。\n> 找某个批次：\`grep -n '批次 <号>' .continue/DONE.archive.md\`\n\n`;
const archiveBody = existsSync(ARCHIVE) ? readFileSync(ARCHIVE, 'utf8') : archiveHead;

writeFileSync(DONE, head + keep.join(''));
writeFileSync(ARCHIVE, `${archiveBody}${moved.join('')}`);
console.log(`已写入 ${join(PROJECT_ROOT, '.continue', 'DONE.archive.md')}`);

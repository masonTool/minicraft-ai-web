#!/usr/bin/env node
/**
 * 文档体量门禁 + 旧批次自动归档（批次 337）
 *
 * 背景：HANDOFF 与 auto-continue 都写着"只留最近 N 批"，但那是**人工承诺**，
 * 没有任何门禁 → 两端都长回去了（auto-continue 210 → 1990 行，HANDOFF 250 → 1100+ 行）。
 * 这里把"保留几批 / 最长几行"变成可执行规则，并且只做**整段搬迁**（一字不改）。
 *
 * 用法：
 *   npm run audit:docs   # 只检查（过期非零退出，不改文件，给 npm run check 用）
 *   npm run docs:trim    # 按规则搬走旧批次（写回）
 *
 * ⚠️ 只搬两种边界，不会切半段：
 *   · auto-continue.md 的 `## 批次 N` 小节（到下一个 `## ` 为止）
 *   · HANDOFF.md §1 的 `- 批次 N（` 条目（含续行）
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

const printOnly = process.argv.includes('--print');

const FILES = {
  queue: new URL('../.codebuddy/hooks/process/auto-continue.md', import.meta.url),
  queueArchive: new URL('../.codebuddy/hooks/process/auto-continue-archive.md', import.meta.url),
  handoff: new URL('../HANDOFF.md', import.meta.url),
  handoffArchive: new URL('../docs/HANDOFF-ARCHIVE.md', import.meta.url),
};

const LIMITS = {
  /**
   * 队列行数上限：**已放开**（原 500）。
   *
   * 原来的理由是"钩子每轮把整个文件读进上下文"，但那条已经不成立了——
   * 钩子只把**当前这一条**递过去，并在反馈里明确"不用读整个队列文件"。
   * 所以队列多长与每轮 token 开销无关，限制没有意义。
   *
   * 仍留一个很宽松的值，只防"意外"（比如误把大文件粘进队列），
   * 不防"故意"——想排一百条就排，不需要跟门禁商量。
   */
  queueLines: 5000,
  queueBatches: 3,
  handoffLines: 340,
  handoffBatches: 6,
  archiveBytes: 900 * 1024,
};

const MARK_START = '<!-- docs-archive:start -->';
const MARK_END = '<!-- docs-archive:end -->';

const read = (url) => readFileSync(url, 'utf8');
const lineCount = (text) => text.split('\n').length;
const tidy = (text) =>
  text.replace(/\n{3,}/g, '\n\n').replace(/\n---\n\n---\n/g, '\n---\n\n');

/** 把 chunk 插到归档文件的标记块里（没有标记就建一个） */
function withArchive(text, chunk, label) {
  let out = text;
  if (!out.includes(MARK_START)) {
    out = `${out.trimEnd()}\n\n## ${label}\n\n${MARK_START}\n${MARK_END}\n`;
  }
  const at = out.indexOf(MARK_END);
  return `${out.slice(0, at)}${chunk.trimEnd()}\n\n${out.slice(at)}`;
}

/** 找出所有 `## 批次 N` 段（到下一个 `## ` 为止，跳过 `## 流程` 这类非批次标题） */
function batchBlocks(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^## 批次 (\d+)/.test(lines[i])) heads.push(i);
  }
  return heads.map((start, k) => {
    const nextHead = heads[k + 1] ?? lines.length;
    let end = nextHead;
    for (let j = start + 1; j < nextHead; j++) {
      if (/^## /.test(lines[j])) {
        end = j;
        break;
      }
    }
    return { start, end, num: Number(/^## 批次 (\d+)/.exec(lines[start])[1]) };
  });
}

function trimQueue() {
  const text = read(FILES.queue);
  const lines = text.split('\n');
  const blocks = batchBlocks(lines);
  const keep = new Set(blocks.slice(-LIMITS.queueBatches).map((b) => b.start));
  const moving = blocks.filter((b) => !keep.has(b.start));
  if (moving.length === 0) {
    return { lines: lineCount(text), moved: 0, remaining: blocks.length };
  }

  const chunk = moving.map((b) => lines.slice(b.start, b.end).join('\n')).join('\n');
  for (const b of [...moving].reverse()) lines.splice(b.start, b.end - b.start);
  const next = tidy(lines.join('\n'));

  if (!printOnly) {
    writeFileSync(
      FILES.queueArchive,
      withArchive(read(FILES.queueArchive), chunk, '批次流水（自动归档）'),
    );
    writeFileSync(FILES.queue, next);
  }
  return {
    lines: lineCount(next),
    moved: moving.length,
    remaining: blocks.length - moving.length,
  };
}

/** HANDOFF §1 里的 `- 批次 N（` 条目（含续行；跳过"及更早"那条指针） */
function handoffBullets(lines) {
  const start = lines.findIndex((l) => /^## 1\./.test(l));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  const out = [];
  for (let i = start; i < end; i++) {
    const m = /^- 批次 (\d+)[（(]/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < end && !/^- /.test(lines[j]) && !/^## /.test(lines[j]) && !/^---/.test(lines[j])) j++;
    out.push({ start: i, end: j, num: Number(m[1]) });
    i = j - 1;
  }
  return out;
}

function trimHandoff() {
  const text = read(FILES.handoff);
  const lines = text.split('\n');
  const bullets = handoffBullets(lines);
  if (bullets.length <= LIMITS.handoffBatches) {
    return { lines: lineCount(text), moved: 0, remaining: bullets.length };
  }

  // 保留**编号最大**的 N 条。不能按文档顺序取：并发会话会在中间插入新批次，
  // 文档顺序一旦被打乱，会把很早的条目当成"最近 6 批"留下来（批次 337 踩到过）。
  const keep = new Set(
    [...bullets]
      .sort((a, b) => b.num - a.num)
      .slice(0, LIMITS.handoffBatches)
      .map((b) => b.start),
  );
  const moving = bullets.filter((b) => !keep.has(b.start));
  const chunk = moving.map((b) => lines.slice(b.start, b.end).join('\n')).join('\n');
  for (const b of [...moving].reverse()) lines.splice(b.start, b.end - b.start);
  const next = tidy(lines.join('\n'));

  if (!printOnly) {
    writeFileSync(
      FILES.handoffArchive,
      withArchive(read(FILES.handoffArchive), chunk, '§1 批次流水（自动归档）'),
    );
    writeFileSync(FILES.handoff, next);
  }
  return {
    lines: lineCount(next),
    moved: moving.length,
    remaining: bullets.length - moving.length,
  };
}

let failed = false;

const report = (label, result, limitLines, limitItems, unit) => {
  const overLines = result.lines > limitLines;
  const overItems = result.remaining > limitItems;
  console.log(
    `${overLines || overItems ? '✗' : '✓'} ${label}：${result.lines} 行 / ${result.remaining} ${unit}` +
      `（上限 ${limitLines} 行 / ${limitItems} ${unit}）`,
  );
  if (result.moved > 0) {
    console.log(
      `  · ${printOnly ? '待归档' : '已归档'} ${result.moved} ${unit}` +
        (printOnly ? '（跑 npm run docs:trim 写回）' : ''),
    );
  }
  if (overLines || overItems) failed = true;
};

report('auto-continue.md', trimQueue(), LIMITS.queueLines, LIMITS.queueBatches, '个批次小节');
report('HANDOFF.md', trimHandoff(), LIMITS.handoffLines, LIMITS.handoffBatches, '条批次记录');

for (const [name, url] of [
  ['auto-continue-archive.md', FILES.queueArchive],
  ['docs/HANDOFF-ARCHIVE.md', FILES.handoffArchive],
]) {
  if (!existsSync(url)) continue;
  const size = statSync(url).size;
  if (size > LIMITS.archiveBytes) {
    console.log(`· ${name} 已 ${(size / 1024).toFixed(0)}KB（超过归档上限，下一步考虑分片）`);
  }
}

if (failed) {
  console.log('\n文档体量超标：跑 `npm run docs:trim` 归档旧批次后再提交');
  process.exit(1);
}
console.log('\n文档体量检查通过');

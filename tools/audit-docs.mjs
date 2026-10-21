#!/usr/bin/env node
/**
 * 文档体量门禁 + 旧批次自动归档（批次 337；2026-10-22 适配 continue-do）
 *
 * 背景：HANDOFF 与队列文档都写着"只留最近 N 批"，但那是**人工承诺**，
 * 没有任何门禁 → 两端都长回去了（HANDOFF 250 → 1100+ 行）。
 * 这里把"保留几批 / 最长几行"变成可执行规则，并且只做**整段搬迁**（一字不改）。
 *
 * ⚠️ 2026-10-22 迁移后队列改成了**会话级**（`.continue/queues/<session_id>.md`）：
 *   · 队列里不再有 `## 批次 N` 小节，收尾时整份搬进 `.continue/DONE.md` 并删除文件，
 *     "队列一路长到两千行"这件事从机制上消失了；
 *   · 所以这里只剩两件事：**单份队列别误粘大文件**（5000 行）+ **HANDOFF 只留最近 6 批**；
 *   · `npm run docs:trim` 只处理 HANDOFF：旧批次追加到 `.continue/DONE.md` 末尾的
 *     `docs-archive` 标记区（旧的 `docs/HANDOFF-ARCHIVE.md` 已整份并入该文件并下线）。
 *
 * 用法：
 *   npm run audit:docs   # 只检查（过期非零退出，不改文件，给 npm run check 用）
 *   npm run docs:trim    # 按规则搬走旧批次（写回）
 *
 * ⚠️ 只搬一种边界，不会切半段：HANDOFF.md §1 的 `- 批次 N（` 条目（含续行）。
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';

const printOnly = process.argv.includes('--print');

const FILES = {
  queuesDir: new URL('../.continue/queues/', import.meta.url),
  handoff: new URL('../HANDOFF.md', import.meta.url),
  /**
   * 完成档案（时间线）。2026-10-22 把旧队列、485 段批次流水、`docs/HANDOFF-ARCHIVE.md`
   * 都并了进来；`docs:trim` 往后搬的旧批次也追加到它末尾的 `docs-archive` 标记区。
   */
  done: new URL('../.continue/DONE.md', import.meta.url),
};

const LIMITS = {
  /**
   * 单份队列行数上限：**已放开**（原 500）。
   *
   * 钩子只把**当前这一条**递过去，并在反馈里明确"不用读整个队列文件"，
   * 所以队列多长与每轮 token 开销无关。仍留一个很宽松的值，只防"误把大文件粘进队列"。
   */
  queueLines: 5000,
  handoffLines: 340,
  handoffBatches: 6,
  /**
   * 归档体积提示线。`DONE.md` 是**时间线**，天然只增不减：2026-10-22 把旧队列（485 段）、
   * `docs/HANDOFF-ARCHIVE.md` 的批次流水都并了进来，一次性到 1.1MB。
   * 提到 1.5MB 只是给"还会长多久"留个观察点——真到了就把它按年代拆成
   * `DONE-<年>.md` 并在文首留索引，而不是继续往一个文件里堆。
   */
  archiveBytes: 1536 * 1024,
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
    writeFileSync(FILES.done, withArchive(read(FILES.done), chunk, '附：HANDOFF §1 自动归档'));
    writeFileSync(FILES.handoff, next);
  }
  return {
    lines: lineCount(next),
    moved: moving.length,
    remaining: bullets.length - moving.length,
  };
}

/** 每份会话队列各自算行数：队列是会话级的，不能只盯某一份 */
function queueStats() {
  let names = [];
  try {
    names = readdirSync(FILES.queuesDir).filter((name) => name.endsWith('.md'));
  } catch {
    names = [];
  }
  const rows = names.map((name) => ({
    name,
    lines: lineCount(readFileSync(new URL(name, FILES.queuesDir), 'utf8')),
  }));
  return { count: rows.length, over: rows.filter((row) => row.lines > LIMITS.queueLines), max: rows.reduce((m, r) => Math.max(m, r.lines), 0) };
}

let failed = false;

{
  const stats = queueStats();
  const bad = stats.over.length > 0;
  console.log(
    `${bad ? '✗' : '✓'} .continue/queues/：${stats.count} 份会话队列，最长 ${stats.max} 行` +
      `（上限 ${LIMITS.queueLines} 行/份）`,
  );
  for (const row of stats.over) console.log(`  · ${row.name} 已 ${row.lines} 行`);
  if (bad) failed = true;
}

{
  const result = trimHandoff();
  const overLines = result.lines > LIMITS.handoffLines;
  const overItems = result.remaining > LIMITS.handoffBatches;
  console.log(
    `${overLines || overItems ? '✗' : '✓'} HANDOFF.md：${result.lines} 行 / ${result.remaining} 条批次记录` +
      `（上限 ${LIMITS.handoffLines} 行 / ${LIMITS.handoffBatches} 条批次记录）`,
  );
  if (result.moved > 0) {
    console.log(
      `  · ${printOnly ? '待归档' : '已归档'} ${result.moved} 条批次记录` +
        (printOnly ? '（跑 npm run docs:trim 写回）' : ''),
    );
  }
  if (overLines || overItems) failed = true;
}

for (const [name, url] of [['.continue/DONE.md', FILES.done]]) {
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

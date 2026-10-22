#!/usr/bin/env node
/**
 * 文档体量门禁 + 旧批次自动归档（批次 337；2026-10-22 适配 continue-do）
 *
 * 背景：HANDOFF 与队列文档都写着"只留最近 N 批"，但那是**人工承诺**，
 * 没有任何门禁 → 两端都长回去了（HANDOFF 250 → 1100+ 行）。
 * 这里把"保留几批 / 最长几行"变成可执行规则，并且只做**整段搬迁**（一字不改）。
 *
 * ⚠️ 2026-10-22 迁移后队列改成了**会话级**（`.continue/doing/<session_id>.md`）：
 *   · 队列里不再有 `## 批次 N` 小节，收尾时整份搬进 `.continue/DONE.md` 并删除文件，
 *     "队列一路长到两千行"这件事从机制上消失了；
 *   · 所以这里只剩三件事：**单份队列别误粘大文件**（5000 行）+ **HANDOFF 只留最近 6 批**
 *     + **框架的文档上限没被重装覆盖**（见下面的 `DOC_LIMITS` 守卫）；
 *   · `npm run docs:trim` 只处理 HANDOFF：旧批次追加到 **`.continue/DONE.archive.md`**
 *     末尾的 `docs-archive` 标记区——不进 `DONE.md`，那份是每批都要读的时间线，
 *     体量由框架的 `audit-docs` 管（上限 300 行）。
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
  queuesDir: new URL('../.continue/doing/', import.meta.url),
  handoff: new URL('../.continue/HANDOFF.md', import.meta.url),
  /**
   * 旧存档。`docs:trim` 搬走的历史批次写这里，**不写 `DONE.md`**：
   * 那份是"最近几批"的时间线（框架上限 300 行，超了由 `archive-done.mjs` 归档），
   * 再往里塞历史会让框架的体量门禁常年红着。
   */
  archive: new URL('../.continue/DONE.archive.md', import.meta.url),
  done: new URL('../.continue/DONE.md', import.meta.url),
  /** 框架的上限表（唯一来源）。重装框架会覆盖它，所以这里要盯一眼。 */
  docLimits: new URL('../.continue/hooks/lib.mjs', import.meta.url),
};

/**
 * 本项目对框架 `DOC_LIMITS` 的**局部放宽**（批次 1363）。
 *
 * 为什么要有这个守卫：`lib.mjs` 属于框架文件，`node .continue/skills/.../install.mjs`
 * 重装时**总是覆盖**，放宽会被悄悄改回 600 —— 表现是"重装之后每次提交都被拒"，
 * 而且报错只说"TASKS.md 5506 行 > 上限 600"，不会告诉你这是本项目改过的值。
 * 所以由项目自己的门禁记住"应该有哪几项被放宽"，重装后当场报出来。
 */
const PROJECT_DOC_LIMITS = { TASKS: 7000 };

const LIMITS = {
  /**
   * 单份队列行数上限：**已放开**（原 500）。
   *
   * 钩子只把**当前这一条**递过去，并在反馈里明确"不用读整个队列文件"，
   * 所以队列多长与每轮 token 开销无关。仍留一个很宽松的值，只防"误把大文件粘进队列"。
   */
  queueLines: 5000,
  /**
   * 2026-10-22 起 `HANDOFF.md` 是**唯一一份**接手文档（机制 + 当前状态 + 命令 + 边界），
   * 由旧的根 `HANDOFF.md` 与 `.continue/HANDOFF.md` 合并而来，所以上限从 340 提到 520。
   * 再长就说明该把"项目细节"搬进 `notes/`（参考 `notes/debug-api.md` / `notes/packaging.md`）。
   */
  handoffLines: 520,
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
    const head = existsSync(FILES.archive)
      ? read(FILES.archive)
      : '# 更早的归档 · DONE.archive\n\n> 历史批次与旧队列的存档区，**不进每轮上下文**。\n> 找某个批次：`grep -n "批次 <号>" .continue/DONE.archive.md`\n';
    writeFileSync(FILES.archive, withArchive(head, chunk, '附：HANDOFF §1 自动归档'));
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
    `${bad ? '✗' : '✓'} .continue/doing/：${stats.count} 份会话队列，最长 ${stats.max} 行` +
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

for (const [name, url] of [
  ['.continue/DONE.md', FILES.done],
  ['.continue/DONE.archive.md', FILES.archive],
]) {
  if (!existsSync(url)) continue;
  const size = statSync(url).size;
  if (size > LIMITS.archiveBytes) {
    console.log(`· ${name} 已 ${(size / 1024).toFixed(0)}KB（超过归档上限，下一步考虑分片）`);
  }
}

// ---- 框架文档上限的局部放宽有没有被重装覆盖
{
  const bad = [];
  let text = '';
  try {
    text = read(FILES.docLimits);
  } catch {
    /* 没有 lib.mjs 说明框架没装，交给框架自检报，这里不重复 */
  }
  for (const [key, want] of Object.entries(PROJECT_DOC_LIMITS)) {
    const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(text);
    if (!m) continue;
    if (Number(m[1]) < want) bad.push(`${key} 现在是 ${m[1]}，应为 ${want}`);
  }
  console.log(
    `${bad.length > 0 ? '✗' : '✓'} 框架 DOC_LIMITS 放宽：` +
      Object.entries(PROJECT_DOC_LIMITS)
        .map(([key, want]) => `${key}=${want}`)
        .join(' · '),
  );
  for (const line of bad) console.log(`  · ${line}`);
  if (bad.length > 0) {
    console.log(
      '  · 重装 continue-do 会覆盖 .continue/hooks/lib.mjs ——把上面几项改回去再提交（理由见该处的注释）',
    );
    failed = true;
  }
}

if (failed) {
  console.log('\n文档体量超标：跑 `npm run docs:trim` 归档旧批次后再提交');
  process.exit(1);
}
console.log('\n文档体量检查通过');

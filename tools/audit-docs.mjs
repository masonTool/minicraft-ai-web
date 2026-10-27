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
/**
 * 复用钩子的解析，**不在这里另写一份**。
 *
 * 这条规矩不是洁癖，是踩过的：本文件曾经给文件名正则和队列头声明各写了一份自己的版本，
 * 两份**规则不一致**——门禁接受的写法钩子不认，于是那个写法**门禁全绿、机制一次都不触发**，
 * 且没有任何报错。现在文件名规则（`isDecisionFile` / `isLegacyPlanFile`）与队列解析
 * （含里程碑节点）全部指向 `lib.mjs` 一处——少一处副本就少一处会漂的地方。
 */
import {
  isDecisionFile,
  isLegacyPlanFile,
  parseQueue,
  sessionOfDecision,
  shortSid,
} from '../.continue/hooks/lib.mjs';

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
  /** 批次索引：里程碑确认行挂的批次号要与它交叉核对。 */
  batches: new URL('../.continue/notes/batches.md', import.meta.url),
  /** 注入协议的生成处：里程碑段有没有被重装覆盖，只能看这个文件的文本。 */
  queueInit: new URL('../.continue/hooks/queue-init.mjs', import.meta.url),
};

/**
 * 本项目对框架 `DOC_LIMITS` 的**局部放宽**（批次 1363）。
 *
 * 为什么要有这个守卫：`lib.mjs` 属于框架文件，`node .continue/skills/.../install.mjs`
 * 重装时**总是覆盖**，放宽会被悄悄改回 600 —— 表现是"重装之后每次提交都被拒"，
 * 而且报错只说"TASKS.md 5506 行 > 上限 600"，不会告诉你这是本项目改过的值。
 * 所以由项目自己的门禁记住"应该有哪几项被放宽"，重装后当场报出来。
 */
/**
 * ⚠️ 2026-10-24 起框架把字节上限的键从 `TASKS_BYTES` 改名成 `DOC_BYTE_LIMITS.TASKS`，
 * 于是这里也按"行数表 / 字节表"分开记：两个键现在同名（都叫 `TASKS`），只能各自在自己的
 * `export const DOC_LIMITS` / `export const DOC_BYTE_LIMITS` 块里取值，否则会取串。
 */
const PROJECT_DOC_LIMITS = { TASKS: 7000 };
const PROJECT_DOC_BYTE_LIMITS = { TASKS: 921600, OVERVIEW: 29696 };

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
  /** 决策记录：一次会话的拍板笔记；超了说明该合并同类项。 */
  decisionLines: 300,
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
  /** 只在一个 `export const <名字>` 块内取键值：两张表现在都有 `TASKS` 键，混着找会取串。 */
  const limitIn = (blockName, key) => {
    const start = text.indexOf(`export const ${blockName}`);
    if (start < 0) return null;
    const end = text.indexOf('\n};', start);
    const body = end < 0 ? text.slice(start) : text.slice(start, end);
    const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(body);
    return m ? Number(m[1]) : null;
  };
  const wanted = [
    ...Object.entries(PROJECT_DOC_LIMITS).map(([key, want]) => [key, want, 'DOC_LIMITS']),
    ...Object.entries(PROJECT_DOC_BYTE_LIMITS).map(([key, want]) => [key, want, 'DOC_BYTE_LIMITS']),
  ];
  for (const [key, want, block] of wanted) {
    const got = limitIn(block, key);
    // 键不见了也算坏：重装会把 lib.mjs 整份覆盖回框架默认值，
    // 旧写法 `continue` 会让"放宽项消失"这件事完全没有提示。
    if (got === null) {
      bad.push(`${block}.${key} 不见了（重装把 lib.mjs 覆盖回默认值？）`);
      continue;
    }
    if (got < want) bad.push(`${block}.${key} 现在是 ${got}，应为 ${want}`);
  }
  console.log(
    `${bad.length > 0 ? '✗' : '✓'} 框架文档上限放宽：` +
      wanted.map(([key, want, block]) => `${block}.${key}=${want}`).join(' · '),
  );
  for (const line of bad) console.log(`  · ${line}`);
  if (bad.length > 0) {
    console.log(
      '  · 重装 continue-do 会覆盖 .continue/hooks/lib.mjs ——把上面几项改回去再提交（理由见该处的注释）',
    );
    failed = true;
  }
}

// ---- 入口文档不得复述机制（P0：AGENTS 曾把"批次号=提交总数"抄成事实，门禁却查不出来）
{
  /**
   * 只拦"把规则写成事实"的句式。历史叙述（"曾经是…"）不该误伤，
   * 所以正则要求"批次号"后面紧跟等号/冒号，再出现"提交总数"。
   *
   * 为什么放在项目自己的门禁里：`AGENTS.md` 是每个会话第一份读到的文件，
   * 它抄错一条，后面所有文档都白写；而框架的 `audit-docs` 只管行数，查不出语义。
   */
  const STALE = /批次号\s*[=＝:：]\s*[^\n]{0,16}提交总数/;
  const bad = [];
  for (const [name, url] of [
    ['AGENTS.md', new URL('../AGENTS.md', import.meta.url)],
    ['.continue/HANDOFF.md', FILES.handoff],
  ]) {
    let text = '';
    try {
      text = read(url);
    } catch {
      continue; // 缺文件不是本脚本的职责
    }
    if (STALE.test(text)) bad.push(name);
  }
  console.log(
    `${bad.length > 0 ? '✗' : '✓'} 入口文档不复述过期机制：批次号是时间戳（见 .continue/README.md §2）`,
  );
  for (const name of bad) {
    console.log(`  · ${name} 仍写着"批次号 = 提交总数"——删掉，改成指向 README 的指针`);
  }
  if (bad.length > 0) failed = true;
}

// ---- 里程碑的结构与引用完整性（写在 doing/<会话ID>.md 里）
/**
 * 里程碑门禁。母题还是这一条：**写了两处就一定要查两处**。
 *
 *   · 里程碑的确认行挂着批次号（第二处：`notes/batches.md` / `DONE.md`）；
 *   · 注入文本挂着机制本身（第二处：`queue-init.mjs`，而它是**重装会被覆盖**的框架文件）；
 *   · 旧版计划文件不能留在 `doing/`（机制已移除，残留会被当成队列）。
 *
 * 任何一处漂了，关卡都会**静默退化**：队列照常递、别的检查照绿、钩子也不报错，
 * 只是"到点停下让人验收"永远不发生。这类"看起来正常但完全不生效"才是要拦的东西。
 */
{
  const problems = [];
  /** 只打印、不判红的那一类（粒度判断、误用提示）。口径同 `tools/i18n-audit.ts`。 */
  const hints = [];

  let names = [];
  try {
    names = readdirSync(FILES.queuesDir).filter((name) => name.endsWith('.md'));
  } catch {
    names = [];
  }
  /** 文件名规则来自 `lib.mjs`（钩子靠同一套判定区分队列 / 历史旧计划 / 决策记录）。 */
  const decisionNames = names.filter((name) => isDecisionFile(name));
  const legacyPlanNames = names.filter((name) => isLegacyPlanFile(name));
  /** 会话队列 = `doing/` 里既不是旧计划、也不是决策记录的那些。 */
  const queueNames = names.filter((name) => !isLegacyPlanFile(name) && !isDecisionFile(name));

  const readIfAny = (url) => {
    try {
      return read(url);
    } catch {
      return '';
    }
  };

  /**
   * 队列头部写的会话 ID，前 6 位必须等于文件名。
   *
   * 为什么要有这条：文件名为了好读只取前 6 位（`b09ae4.md`），万一两个会话的 ID 前 6 位相同，
   * 后开的那个会**直接接管**前一个的队列——勾错条目、写错 DONE，而且没有任何报错。
   * 队列头部保留完整 ID（`# 队列 · 会话 <full>`）就是为了在这里对一次账。
   */
  for (const name of queueNames) {
    const text = readIfAny(new URL(name, FILES.queuesDir));
    const m = /^#\s*队列\s*·\s*会话\s+(\S+)/m.exec(text);
    if (!m) continue;
    const stem = name.slice(0, -3);
    /**
     * 顺带挡一种"看着像队列、其实钩子永远找不到"的文件名：**把完整会话 ID 当文件名**。
     * 实测模型干过——它按头部里那个完整 ID 命名，钩子按 6 位算路径，于是机制静默失效。
     */
    if (/^[0-9a-f]{8,}$/i.test(stem)) {
      problems.push(
        `${name} 用的是完整会话 ID 当文件名；钩子按前 6 位算路径（应为 ${shortSid(m[1])}.md）` +
          '——名字差一个字符，整套机制就不生效，但不会报错',
      );
    }
    if (shortSid(m[1]) !== stem) {
      problems.push(
        `${name} 头部的会话是 ${m[1]}（前 6 位 ${shortSid(m[1])}），与文件名不一致` +
          '——两个会话可能撞进同一份队列（头部写着别人的 ID，却又叫这个文件名）',
      );
    }
  }

  /** 已知批次号：批次索引 + DONE（含归档）+ 各队列头部的 `> 批次：`。 */
  const knownBatches = new Set();
  for (const url of [FILES.batches, FILES.done, FILES.archive]) {
    for (const m of readIfAny(url).matchAll(/\b(\d{8}-\d{4})\b/g)) knownBatches.add(m[1]);
  }
  for (const name of queueNames) {
    const text = readIfAny(new URL(name, FILES.queuesDir));
    for (const m of text.matchAll(/\b(\d{8}-\d{4})\b/g)) knownBatches.add(m[1]);
  }

  /**
   * 里程碑的结构与引用（写在队列里，不再是独立文件）。
   *
   * 母题还是"写了两处就一定要查两处"：
   *   · 里程碑挂着批次号（第二处：`notes/batches.md` / `DONE.md`）；
   *   · 注入文本挂着机制本身（第二处：`queue-init.mjs`，而它是**重装会被覆盖**的框架文件）；
   *   · 队列头部的 `> 批次：`（第二处：批次索引）。
   * 任何一处漂了，关卡都会**静默退化**：队列照常递、别的检查照绿，只是"到点停下让人验收"永远不发生。
   */
  for (const name of queueNames) {
    const url = new URL(name, FILES.queuesDir);
    const text = readIfAny(url);
    const queue = parseQueue(text);
    if (queue.milestones.length === 0) continue;

    const ids = new Set();
    for (const ms of queue.milestones) {
      if (ids.has(ms.id)) problems.push(`${name} 里程碑 ${ms.id} 出现了两次（id 必须唯一）`);
      ids.add(ms.id);

      if (ms.acceptance.length === 0) {
        problems.push(`${name} 里程碑 ${ms.id} 没有 \`- 验收：\` 行——硬停到它时只能空手问人`);
      }
      if (ms.confirm) {
        const batch = /批次\s*`?(\d{8}-\d{4})`?/.exec(ms.confirm);
        if (batch && !knownBatches.has(batch[1])) {
          problems.push(
            `${name} 里程碑 ${ms.id} 的确认行挂着批次 ${batch[1]}，但 notes/batches.md / DONE.md / doing/ 里都没有它`,
          );
        }
        const unfinished = queue.entries.filter(
          (e) => e.index < ms.index && (e.kind === 'todo' || e.kind === 'doing'),
        );
        if (unfinished.length > 0) {
          problems.push(
            `${name} 里程碑 ${ms.id} 已确认，但它前面还有 ${unfinished.length} 条没做完` +
              `（第${unfinished[0].seq}条）——确认行必须真的验收过这一段`,
          );
        }
      } else if (
        !queue.entries.some((e) => e.index > ms.index && (e.kind === 'todo' || e.kind === 'doing'))
      ) {
        hints.push(`${name} 里程碑 ${ms.id} 后面没有待办了但还没确认——钩子会在这里硬停，等人工验收`);
      }
    }

    const total = queue.entries.length;
    if (total <= 16) {
      hints.push(
        `${name} 只有 ${total} 条就设了 ${queue.milestones.length} 个里程碑——≤16 条一般不该设` +
          '（关卡太密就会变成噪音，人开始无脑点"继续"）',
      );
    }
  }

  // 旧版计划文件：机制已移除，还留在 doing/ 里说明这个项目没重启过会话、迁移没跑
  for (const name of legacyPlanNames) {
    problems.push(
      `${name} 是旧版计划文件（机制已移除）；重启一次会话，让 migrateLegacyLayout() 把它归档到 logs/<会话ID>/plan.md`,
    );
  }

  // 注入文本里必须还有里程碑段：重装框架会整份覆盖 queue-init.mjs
  const initText = readIfAny(FILES.queueInit);
  if (initText) {
    for (const needle of ['## 里程碑 MS1', '硬停']) {
      if (!initText.includes(needle)) {
        problems.push(`queue-init.mjs 的注入里找不到「${needle}」——重装把它覆盖回旧版了？`);
      }
    }
  }

  // 决策记录：同样按 `<sid>` 配对，且每条都要有「决定 / 为什么」——否则它就是一份读不懂的流水
  const queueStems = new Set(queueNames.map((name) => name.slice(0, -3)));
  for (const name of decisionNames) {
    const sid = sessionOfDecision(name);
    if (!sid) continue;
    const text = readIfAny(new URL(name, FILES.queuesDir));
    if (!queueStems.has(sid)) {
      problems.push(
        `${name} 没有对应的会话队列 \`${sid}.md\`——决策记录按 \`decision-<会话ID>.md\` 与会话配对，` +
          '孤儿文件说明它没跟着收尾一起归档',
      );
    }
    const lines = lineCount(text);
    if (lines > LIMITS.decisionLines) problems.push(`${name} ${lines} 行 > 上限 ${LIMITS.decisionLines} 行`);
    const sections = text.split(/^## /m).slice(1);
    if (sections.length === 0) {
      problems.push(`${name} 里没有任何 \`## D1 …\` 条目（写了文件却没记决策？）`);
    }
    for (const section of sections) {
      const title = section.split('\n')[0].trim();
      if (!/^D\d+\b/.test(title)) continue;
      if (!/^[-*]\s*决定\s*[:：]/m.test(section)) {
        problems.push(`${name} 「${title}」缺 \`- 决定：\`（读者看不出你到底定了什么）`);
      }
      if (!/^[-*]\s*为什么\s*[:：]/m.test(section)) {
        problems.push(`${name} 「${title}」缺 \`- 为什么：\`（只留结论、没留依据，等于没法复核）`);
      }
    }
  }

  console.log(
    `${problems.length > 0 ? '✗' : '✓'} 里程碑 / 决策记录（doing/<会话ID>.md 内的里程碑节点、*-decision.md）：` +
      `${decisionNames.length} 份决策 · ` +
      '验收命令、确认行批次号、旧计划残留、注入文本交叉核对',
  );
  for (const line of problems) console.log(`  · ${line}`);
  for (const line of hints) console.log(`  · 提示（不判红）：${line}`);
  if (problems.length > 0) failed = true;
}

if (failed) {
  console.log('\n文档检查未通过：体量超了跑 `npm run docs:trim`；机制漂了按上面的提示改。');
  process.exit(1);
}
console.log('\n文档体量检查通过');

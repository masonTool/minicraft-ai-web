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
 * 这条规矩不是洁癖，是踩过的：本文件原来只复用了 `parsePlan`，却给文件名正则和
 * 队列头 `> 计划：` 各写了一份自己的版本，两份**规则不一致**——门禁接受带 `· 阶段` 的写法、
 * 钩子只认不带的，于是那个写法**门禁全绿、机制一次都不触发**，且没有任何报错。
 * 现在文件名规则（`isPlanFile` / `sessionOfPlan`）与计划解析全部指向 `lib.mjs` 一处；
 * 而"绑定"已经改由文件名表达，队列头那份声明被删掉了——少一处副本就少一处会漂的地方。
 */
import {
  isDecisionFile,
  isPlanFile,
  parsePlan,
  sessionOfDecision,
  sessionOfPlan,
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
  /** 批次索引：计划阶段行挂的批次号要与它交叉核对。 */
  batches: new URL('../.continue/notes/batches.md', import.meta.url),
  /** 注入协议的生成处：计划机制有没有被重装覆盖，只能看这个文件的文本。 */
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
const PROJECT_DOC_LIMITS = { TASKS: 7000, TASKS_BYTES: 921600 };

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
  /**
   * 计划文件（`doing/plan-*.md`）的上限：与单份队列同口径（500 行 / 60KB）。
   *
   * 为什么不给更多：计划是"阶段清单"，一个阶段一行，500 行就是几百个阶段——
   * 真到那个量级说明该拆成几份计划（每份一个里程碑族），而不是继续加长。
   * 上限定在这里而不是更宽，是为了把它挡在"变成第二个什么都往里写的文档"之前。
   */
  planLines: 500,
  planBytes: 60 * 1024,
  /** 决策记录：一次会话的拍板笔记，比计划短得多；超了说明该合并同类项。 */
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
  for (const [key, want] of Object.entries(PROJECT_DOC_LIMITS)) {
    const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(text);
    // 键不见了也算坏：重装会把 lib.mjs 整份覆盖回框架默认值，
    // 旧写法 `continue` 会让"放宽项消失"这件事完全没有提示。
    if (!m) {
      bad.push(`${key} 不见了（重装把 lib.mjs 覆盖回默认值？）`);
      continue;
    }
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

// ---- 计划的结构与引用完整性（doing/plan-*.md）
/**
 * 计划机制的六条门禁。母题还是这一条：**写了两处就一定要查两处**。
 *
 *   · 阶段行挂着批次号（第二处：`notes/batches.md` / `DONE.md`）；
 *   · 队列头部挂着计划名与阶段号（第二处：计划文件本身）；
 *   · 注入文本挂着机制本身（第二处：`queue-init.mjs`，而它是**重装会被覆盖**的框架文件）。
 *
 * 任何一处漂了，机制都**静默退化**：计划照样能写、门禁别的项照样绿、
 * 钩子也不再报错，只是永远不再往下取批次。这类"看起来正常但完全不生效"
 * 才是要拦的东西——加计划的目的是防跑偏，不是给自己加一层装饰。
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
  /** 文件名规则来自 `lib.mjs`（钩子靠同一个前缀区分"队列"与"计划"）。 */
  const planNames = names.filter((name) => isPlanFile(name));
  const decisionNames = names.filter((name) => isDecisionFile(name));
  /** 会话队列 = `doing/` 里既不是计划、也不是决策记录的那些。 */
  const queueNames = names.filter((name) => !isPlanFile(name) && !isDecisionFile(name));

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

  for (const name of planNames) {
    const url = new URL(name, FILES.queuesDir);
    const text = readIfAny(url);
    const plan = parsePlan(text);

    const n = lineCount(text);
    if (n > LIMITS.planLines) problems.push(`${name} ${n} 行 > 上限 ${LIMITS.planLines} 行`);
    let bytes = 0;
    try {
      bytes = statSync(url).size;
    } catch {
      bytes = 0;
    }
    if (bytes > LIMITS.planBytes) {
      problems.push(`${name} ${(bytes / 1024).toFixed(0)}KB > 上限 ${(LIMITS.planBytes / 1024).toFixed(0)}KB`);
    }

    // 阶段必须归在自己小节对应的里程碑下，否则"前缀比较"判的就是另一个里程碑
    const order = [];
    for (const ms of plan.milestones) {
      for (const stage of ms.stages) {
        if (stage.ms !== ms.id) {
          problems.push(`${name} 阶段 ${stage.id} 写在了「${ms.id}」小节里（编号与所属小节不一致）`);
        }
      }
      if (ms.stages.length > 0) order.push(ms.id);
    }
    const seen = new Set();
    for (const id of order) {
      if (seen.has(id)) {
        problems.push(`${name} 里程碑 ${id} 的阶段被拆成不连续的两段（前缀比较失真，跨里程碑判定会跟着错）`);
      }
      seen.add(id);
    }

    for (const stage of plan.stages) {
      if (stage.batch && !knownBatches.has(stage.batch)) {
        problems.push(
          `${name} 阶段 ${stage.id} 挂着批次 ${stage.batch}，但 .continue/notes/batches.md / DONE.md / doing/ 里都没有它`,
        );
      }
      if (stage.kind === 'done' && !stage.batch) {
        problems.push(`${name} 阶段 ${stage.id} 已勾 [x] 却没挂批次号（回溯链在这里断了）`);
      }
    }

    /**
     * 阶段行格式核对：`- [x] MS2.1 …`（阶段号**没带反引号**）会被 `parsePlan` 当普通行丢弃，
     * 钩子侧不报错、只是这条阶段消失（严重时整个计划被判定"已做完"）。
     * 判定方式是拿 `parsePlan` 自己解析出的 `raw` 做差集——**不另写一份阶段正则**，
     * 否则又是两份规则各自漂。
     */
    const stageRaws = new Set(plan.stages.map((stage) => stage.raw));
    const orphans = [];
    {
      const lines = text.split(/\r?\n/);
      let inFence = false;
      for (const line of lines) {
        const t = line.trim();
        if (/^(```|~~~)/.test(t)) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        if (!/^-\s*\[[^\]]{0,6}\]/.test(t)) continue;
        if (!stageRaws.has(t)) orphans.push(t);
      }
    }
    if (orphans.length > 0) {
      problems.push(
        `${name} 有 ${orphans.length} 行看着像阶段但解析不出来（阶段号两侧必须带反引号）：` +
          `「${orphans[0].slice(0, 48)}」`,
      );
    }

    /**
     * 里程碑粒度：**只提示、不判红**。
     *
     * 规则本身是硬的（计划只该出现在 >16 条的任务上，一个里程碑至少覆盖两批），
     * 但它是**判断**，不是结构：判红的时机太早会把"正在跑的老计划"直接卡死
     * （实测：本仓库那份 `plan-jump.md` 就是单阶段，它属于另一个正在进行的会话）。
     * 强行拆别人的计划等于改它这一批的执行流程，代价大于收益。
     *
     * 所以这里走 `i18n-audit` 用过的同一口径：**只报告、不失败，判死是人的事**。
     * 真正的约束放在两处硬的地方：注入协议（新计划不许这么写）与 `notes/plan.md` §0 的门槛。
     */
    for (const ms of plan.milestones) {
      if (ms.stages.length === 0) {
        hints.push(`${name} 里程碑「${ms.id} · ${ms.title}」下面一个阶段都没有（阶段行漏写？）`);
      } else if (ms.stages.length === 1) {
        hints.push(
          `${name} 里程碑「${ms.id} · ${ms.title}」只有 1 个阶段——每批都停等于关卡变噪音；` +
            '要么并到相邻里程碑，要么说明这个任务本来就 ≤16 条、不该建计划',
        );
      }
    }

    const doingCount = plan.stages.filter((stage) => stage.kind === 'doing').length;
    if (doingCount > 1) {
      problems.push(`${name} 有 ${doingCount} 条 [~]（计划里同一时间只能有一条，它就是游标）`);
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

  // 计划与队列靠**文件名配对**：`plan-<sid>.md` ↔ `<sid>.md`。
  // 配对不上就是孤儿计划——钩子按会话 ID 直接算路径，永远读不到它（且不报错）。
  for (const name of planNames) {
    const sid = sessionOfPlan(name);
    if (!sid) continue; // 已经被 isPlanFile 过滤过，这里只是防御
    if (!queueStems.has(sid)) {
      problems.push(
        `${name} 没有对应的会话队列 \`${sid}.md\`——计划按 \`plan-<会话ID>.md\` 与队列配对，` +
          '孤儿计划钩子永远读不到（跨会话接手时请 `git mv` 到新会话的 ID）',
      );
    }
  }

  // 注入文本里必须还有计划段：重装框架会整份覆盖 queue-init.mjs
  const initText = readIfAny(FILES.queueInit);
  if (initText) {
    for (const needle of ['<本会话ID>-plan.md', '完成到里程碑就停']) {
      if (!initText.includes(needle)) {
        problems.push(`queue-init.mjs 的注入里找不到「${needle}」——重装把它覆盖回旧版了？`);
      }
    }
  }

  console.log(
    `${problems.length > 0 ? '✗' : '✓'} 计划 / 决策记录（doing/*-plan.md、*-decision.md）：${planNames.length} 份计划 · ${decisionNames.length} 份决策 · ` +
      `${LIMITS.planLines} 行 / ${(LIMITS.planBytes / 1024).toFixed(0)}KB 上限 · ` +
      '阶段批次号、队列引用、注入文本交叉核对',
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

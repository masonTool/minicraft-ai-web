#!/usr/bin/env node
/**
 * 编号与引用完整性审计。
 *
 * 为什么存在（挡的是哪次事故）：
 *   批次号曾经=开工时的提交数，两个会话在同一提交点开工会拿到同一个号，
 *   本项目 `DONE.md` 里真的出现过两个「批次 1」，事后分不清谁是谁。
 *   同类问题还有：队列里引用 `[T9]` 但 `TASKS.md` 根本没有 T9；
 *   `DONE` 标题的批次号与 `OVERVIEW` 批次索引里的不一致。
 *   这些都是"手写同一事实的多份副本"，肉眼看不出来，只能靠机器核对。
 *
 * 退出码（框架约定：0 通过 / 1 检查不通过 / 2 用法或格式错误）：
 *   0 通过 / 1 检查失败 / 2 用法或格式错误（本项目当前不用 2）
 *
 * 幂等（契约 9）：只读，不写任何文件。
 * 不依赖 cwd（契约 7）：项目根由 lib.mjs 从脚本自身位置反推。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classify,
  CONTINUE_DIR,
  DONE_FILE,
  DOING_DIR,
  isDecisionFile,
  isFence,
  OVERVIEW_FILE,
  parseQueue,
  PROJECT_ROOT,
  TASKS_FILE,
} from './lib.mjs';

const problems = [];
const warnings = [];

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 从一行里取 `Tn` 号（`[T3]`、`T3`、`TASKS T3` 三种写法都认）。 */
function tIdsIn(text) {
  const ids = new Set();
  const re = /\bT(\d+)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) ids.add(`T${Number(m[1])}`);
  return ids;
}

/**
 * 剥掉 HTML 注释块再解析。
 *
 * ⚠️ 所有按行匹配的地方都必须先剥。模板里用注释包住格式样例
 * （`- [x] T1 <用户视角的一句话需求>`、`## <模块名>` 这类占位），
 * 不剥就会被当成真内容：轻则误报，重则**把模板里的 T1 当成真实需求存在**，
 * 于是队列引用了根本不存在的 T1 也能通过检查——比不检查更危险。
 */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const tasks = read(TASKS_FILE);
const done = read(DONE_FILE);
/** 搬进归档的批次仍算"已归档"，否则 `OVERVIEW` 的批次索引会被判成对不上。 */
const doneArchive = read(join(CONTINUE_DIR, 'DONE.archive.md'));
const overview = read(OVERVIEW_FILE);
/**
 * 批次索引 2026-10-22 从 `OVERVIEW.md` 迁到 `notes/batches.md`：
 * OVERVIEW 是每轮都要读的模块总览，批次流水天然只增不减，不该占它的 200 行预算。
 * 这里**两份都读**，交叉核对不放松（迁移不能变成"少查一处"）。
 */
const batchIndex = read(join(CONTINUE_DIR, 'notes', 'batches.md'));

// ------------------------------------------------------------------ 1. 需求号唯一
/**
 * `TASKS.md` 里每个 `T` 号只能有一条"条目行"（`- [ ] T3 ...`）。
 * 允许多处**引用**（说明文字里提到 T3），但入口只能有一个。
 */
const tasksIds = new Set();
if (tasks === null) {
  warnings.push('没有 TASKS.md，跳过需求号检查');
} else {
  const seen = new Map();
  for (const line of stripHtmlComments(tasks).split(/\r?\n/)) {
    if (!/^\s*-\s*\[[^\]]*\]\s*T\d+/.test(line)) continue;
    const m = /\bT(\d+)\b/.exec(line);
    if (!m) continue;
    const id = `T${Number(m[1])}`;
    tasksIds.add(id);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      problems.push(`TASKS.md 里 ${id} 出现在 ${count} 条条目行上（"永不复用"被破坏）`);
    }
  }

  /**
   * 断号只提示：缺号可能是删过需求，不一定是错。
   *
   * 但**有意空缺必须声明**，否则提示永远挂着，人就学会了无视它（假红拉高之后，
   * 真红也会被无视）。声明写在 `TASKS.md` 的注释里即可，脚本会在剥注释**之前**扫原文：
   *
   *   `作废编号：T9~T15`  /  `作废编号：T9、T11`
   *
   * 逗号可用 `,` `，` `、`，区间用 `~` `-` `～`。声明本身不自证理由——写清楚"为什么作废"
   * 是给人的，机器只管这个号不必再出现。
   */
  const voided = new Set();
  const voidDecl = /作废(?:编号|区间)?[：:]\s*([^\n]*)/g;
  for (const m of tasks.matchAll(voidDecl)) {
    for (const token of m[1].split(/[，,、；;]/)) {
      const range = /T(\d+)\s*[~\-～~]\s*T?(\d+)/.exec(token);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i += 1) voided.add(i);
        continue;
      }
      for (const single of token.matchAll(/T(\d+)/g)) voided.add(Number(single[1]));
    }
  }

  const nums = [...tasksIds].map((id) => Number(id.slice(1))).sort((a, b) => a - b);
  if (nums.length > 0) {
    const missing = [];
    for (let i = 1; i <= nums[nums.length - 1]; i += 1) {
      if (!nums.includes(i) && !voided.has(i)) missing.push(`T${i}`);
    }
    if (missing.length > 0) {
      warnings.push(
        `TASKS.md 缺少编号：${missing.join('、')}（手抄错号？有意不用就在注释里写"作废编号：T<n>~T<m>"）`,
      );
    }
  }
}

// ------------------------------------------------------------------ 2. 队列引用的 T 必须存在
/**
 * **跨文件引用完整性**。队列条目写着 `[T9]` 而 TASKS 里没有 T9，
 * 说明这个任务挂着一个不存在的需求——收尾时"每一条都要在 TASKS 落地"根本做不到。
 */
if (tasks !== null && existsSync(DOING_DIR)) {
  for (const name of readdirSync(DOING_DIR)) {
    if (!name.endsWith('.md')) continue;
    const text = read(join(DOING_DIR, name)) ?? '';
    /** 按文件汇总缺失的号——同一份队列里多条任务挂同一个缺失号，只该报一次。 */
    const missing = new Set();
    for (const line of stripHtmlComments(text).split(/\r?\n/)) {
      if (!/^\s*-\s*\[[^\]]*\]/.test(line)) continue;
      const ids = tIdsIn(line);
      // `[发现]` 条目允许暂时没有需求号（见 README §2）
      if (ids.size === 0) continue;
      for (const id of ids) if (!tasksIds.has(id)) missing.add(id);
    }
    if (missing.size > 0) {
      problems.push(
        `doing/${name} 引用了 ${[...missing].sort().join('、')}，但 TASKS.md 里没有这些需求`,
      );
    }
  }
}

// ------------------------------------------------------------------ 3. 批次号跨文件一致
/**
 * 同一批次号必须同时出现在 `DONE.md` 的标题和 `OVERVIEW.md` 的批次索引里。
 * 只写一处 = 另一处是手写的副本，早晚不同步。
 *
 * ⚠️ 两处假绿，都实测过：
 *   · `DONE.md` 必须**先剥注释**：归档样例标题写在注释里（旧模板曾是具体数字），
 *     不剥就被当成一个真实批次；
 *   · 比对必须精确到**批次索引表的第一列**：旧实现用 `overview.includes(id)`，
 *     批次 `24` 能被正文里随便一个 "批次 24→47" 命中，批次 `1` 被任何含 1 的文本命中。
 */
const BATCH_HEADING = /^##\s*批次\s+([0-9A-Za-z_-]+)/gm;

function batchHeadings(text) {
  return [...stripHtmlComments(text ?? '').matchAll(BATCH_HEADING)].map((m) => m[1]);
}

/** 批次索引（`OVERVIEW.md` 或 `notes/batches.md`）表格第一列的批次号（跳过表头与分隔行）。 */
function overviewBatchIndex(text) {
  const ids = new Set();
  const lines = stripHtmlComments(text ?? '').split(/\r?\n/);
  let inIndex = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) inIndex = /批次索引/.test(line);
    if (!inIndex || !line.trim().startsWith('|')) continue;
    const first = line.trim().slice(1).split('|')[0].trim();
    if (!first || first === '批次' || /^:?-+:?$/.test(first)) continue;
    ids.add(first);
  }
  return ids;
}

const liveList = batchHeadings(done);
const archivedList = batchHeadings(doneArchive);
const doneList = [...liveList, ...archivedList];
const doneBatches = new Set(doneList);
/** 当期 DONE 与归档区要分开判：归档区是历史，允许早于"批次索引"这套机制。 */
const liveBatches = new Set(liveList);
const archivedBatches = new Set(archivedList);
const dupes = new Map();
for (const id of doneList) dupes.set(id, (dupes.get(id) ?? 0) + 1);
for (const [id, count] of dupes) {
  if (count > 1) problems.push(`DONE.md 里批次 ${id} 出现 ${count} 次（批次号必须唯一）`);
}

if (overview !== null) {
  const indexed = new Set([...overviewBatchIndex(overview), ...overviewBatchIndex(batchIndex)]);

  /**
   * **当期 DONE ↔ 批次索引是硬约束，不是提示。**
   *
   * 这两条正对着"收尾五步有没有做完"：搬 DONE 与补索引是同一件事的两半，只做一半
   * 就是收尾没做完。以前这里是 `warnings`，实测出过事——`DONE.md` 里一个批次标题被
   * 写坏（塞进了引用行，`^## 批次` 匹配不到），审计只打了句"批次索引有 X 但 DONE 没有"，
   * 然后**通过（1 个提示，不阻塞）**，坏标题就这么留了一天。
   *
   * 归档区那侧仍只提示：那批历史可能早于"批次索引"这套机制，判红会逼人补假数据。
   */
  for (const id of liveBatches) {
    if (!indexed.has(id)) {
      problems.push(`DONE.md 有批次 ${id}，但批次索引（notes/batches.md / OVERVIEW.md）里没有这一行——收尾漏了补索引`);
    }
  }
  for (const id of indexed) {
    if (!liveBatches.has(id) && !archivedBatches.has(id)) {
      problems.push(`批次索引有 ${id}，但 DONE.md 与 DONE.archive.md 里都没有这个批次的归档——收尾漏了搬队列`);
    }
  }
  for (const id of archivedBatches) {
    if (!indexed.has(id)) {
      warnings.push(`DONE.archive.md 有批次 ${id}，但批次索引里没有这一行（历史批次，允许）`);
    }
  }
}

// ------------------------------------------------------------------ 3.5 档案里不该有未完成条目
/**
 * `DONE.md` 里的条目必须全部是 `[x]`（或 `[阻塞]`）。
 *
 * 为什么要有这条：收尾是"把已经发生的事实搬进档案"，所以搬进去的每一条都该是完成的。
 * 实测踩过——**归档跑在勾完之前**，于是档案里留下一条 `- [ ]`，而其它检查全绿
 * （行数、字节、批次索引都对得上），没人会再去逐条看那个方括号。
 *
 * 只看当期 `DONE.md`：`DONE.archive.md` 是历史，早年确实可能存在没做完就收尾的批次，
 * 拿这条去判红只会逼人改历史。
 */
const unfinishedInDone = [...done.matchAll(/^[-*]\s*\[ \]\s*(.+)$/gm)].map((m) => m[1].trim());
if (unfinishedInDone.length > 0) {
  problems.push(
    `DONE.md 里有 ${unfinishedInDone.length} 条仍是 \`[ ]\`：「${unfinishedInDone[0].slice(0, 48)}」` +
      '——未完成条目不该进档案（归档发生在勾完之前？先勾再归档）',
  );
}

// ------------------------------------------------------------------ 4. 内置红线
/**
 * (a) 队列里不该同时有两条 `[~]`：`[~]` 是"进行中"，一条队列一次只做一条。
 *     同时两条意味着状态写错（或人工改坏了），钩子会一直挑第一条，另一条永远轮不到。
 * (b) **不认识的状态标记直接判红**（README §0 原理 3：不认识的格式要能红，不能沉默）。`- [-]`、`- [/]`、`- [v]`
 *     这类写法 `classify()` 认不出，条目会从所有计数里**静默消失**——不算待办、不算完成，
 *     钩子当它不存在。`[-]` 尤其危险：常见写法里它是"放弃"，本框架早期它是"进行中"，
 *     两种读法都说得通，所以干脆不收：放弃就在回复里说明、交用户删除。
 *     只查方括号里 ≤ 4 个字符且后面不跟 `(` 的写法，避免误伤 `- [链接](url)`。
 * 两项都用 `parseQueue` 同一套解析（剥围栏代码块），和钩子看到的完全一致。
 */
if (existsSync(DOING_DIR)) {
  for (const name of readdirSync(DOING_DIR)) {
    if (!name.endsWith('.md')) continue;
    const text = read(join(DOING_DIR, name)) ?? '';
    const queue = parseQueue(text);
    if (queue.counts.doing > 1) {
      problems.push(`doing/${name} 里有 ${queue.counts.doing} 条 [~]（进行中），一次只能有一条`);
    }
    let inFence = false;
    stripHtmlComments(text)
      .split(/\r?\n/)
      .forEach((line) => {
        if (isFence(line)) {
          inFence = !inFence;
          return;
        }
        if (inFence) return;
        const trimmed = line.trim();
        if (!/^-\s*\[[^\]]{0,4}\](?!\()/.test(trimmed)) return;
        if (classify(trimmed) === null) {
          problems.push(
            `doing/${name} 有不认识的标记：「${trimmed.slice(0, 40)}」——只认 [ ] / [~] / [x] / [阻塞]，` +
              '其它写法会被钩子静默忽略',
          );
        }
      });
  }
}

// ------------------------------------------------------------------ 4.5 决策记录格式
/**
 * 挡的是：`doing/<会话ID>-decision.md` 写成一句散文、或者三段缺一段。
 *
 * 为什么值得机械校验（挡的是哪次事故）：2026-10-23 用户反馈"AI 明明有推荐结果，却停下来让我选"，
 * 查下来是**框架自己下了相反的命令**（每轮注入说"必须弹窗"，而"自己决定+记录"只写在一会话一次的注入里）。
 * 修完之后"自己决定"成了默认行为，这份文件从"可选留底"变成**唯一的审计线索**——
 * 它的格式要是没人管，等于把"AI 替我决定了什么"退回成"靠它自觉写在某处"。
 *
 * 只查**结构**（编号唯一、三段齐全），不查内容质量：内容对不对只有人判断得了。
 */
if (existsSync(DOING_DIR)) {
  for (const name of readdirSync(DOING_DIR)) {
    if (!isDecisionFile(name)) continue;
    const text = read(join(DOING_DIR, name)) ?? '';
    const ids = [];
    const sections = [];
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const head = /^##\s*(D\d+)\s*[·:：]/.exec(line);
      if (head) {
        cur = { id: head[1], fields: new Set() };
        ids.push(head[1]);
        sections.push(cur);
        continue;
      }
      if (!cur) continue;
      const field = /^[-*]\s*(决定|为什么|影响)\s*[:：]/.exec(line);
      if (field) cur.fields.add(field[1]);
    }
    for (const section of sections) {
      for (const field of ['决定', '为什么', '影响']) {
        if (section.fields.has(field)) continue;
        problems.push(
          `doing/${name} 的「${section.id}」缺 \`- ${field}：\` 一行——三行都要有（决定 / 为什么 / 影响），` +
            '「影响」尤其要写清退不退得回去',
        );
      }
    }
    if (ids.length === 0) {
      problems.push(`doing/${name} 里没有 \`## D<n> · <决策点>\` 条目——决策记录一条一编号`);
    }
    const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dup.length > 0) {
      problems.push(`doing/${name} 的决策编号重复：${dup.join('、')}（编号永不复用，重开就换新号）`);
    }
  }
}

// ------------------------------------------------------------------ 5. 模块名跨文件一致
/**
 * `OVERVIEW.md` 的模块小节名必须与 `TIPS.md` 的分节名对得上——
 * `OVERVIEW` 里写"细节见 TIPS.md#某模块"，而 TIPS 里没有这一节，指路就断了。
 *
 * 只查**TIPS 有、OVERVIEW 没有**的方向：OVERVIEW 允许有模块而暂无坑（那是正常的），
 * 但 TIPS 记了某模块的坑而 OVERVIEW 里没有这个模块，说明模块名被改过一处、漏了另一处。
 */
const overviewModules = new Set(
  stripHtmlComments(overview ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(4).trim()),
);
const tips = read(join(CONTINUE_DIR, 'TIPS.md'));
if (tips !== null && overview !== null) {
  const tipsModules = stripHtmlComments(tips)
    .split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.slice(2).trim())
    // `格式` / `索引` 是 TIPS 自己的结构节，不是模块
    .filter((name) => !['格式', '索引'].includes(name));
  for (const name of tipsModules) {
    if (!overviewModules.has(name)) {
      problems.push(`TIPS.md 有模块「${name}」，但 OVERVIEW.md 里没有同名小节（指路会断）`);
    }
  }
}

// ------------------------------------------------------------------ 6. 队列文件名 = 会话 ID
/**
 * 钩子只靠**会话 ID 推导路径**（`queuePath(sid)`）。文件名改错/手工另存之后，
 * 钩子读不到队列**也不报错**——表现是"不继续了"，极难查。
 *
 * 能查的部分：文件名必须是"像会话 ID 的东西"（`[A-Za-z0-9._-]{4,}`，与 `sessionId()` 同一口径）。
 * 查不了的部分：它是否**真的**等于当前会话 ID——那只有钩子运行时才知道。
 */
if (existsSync(DOING_DIR)) {
  for (const name of readdirSync(DOING_DIR)) {
    if (!name.endsWith('.md')) continue;
    const stem = name.slice(0, -3);
    if (!/^[A-Za-z0-9._-]{4,}$/.test(stem)) {
      problems.push(
        `doing/${name} 的文件名不像会话 ID（只允许字母/数字/._-，且至少 4 位）——` +
          `钩子按会话 ID 推导路径，读不到也不会报错`,
      );
    }
  }
}

/**
 * `--strict` 把"提示"降级成"问题"。
 *
 * 用在哪：CI 或收尾前想一次性清干净时。默认不严，是因为有些提示
 * （断号、OVERVIEW 缺批次行）在开发过程中是正常的中间状态。
 */
const strict = process.argv.includes('--strict');
if (strict && warnings.length > 0) {
  for (const w of warnings) problems.push(`[strict] ${w}`);
  warnings.length = 0;
}

// ------------------------------------------------------------------ 7. DONE 的完成项必须在 TASKS 落地
/**
 * 收尾第③步（把队列每条在 `TASKS.md` 里落地）是最容易漏的一步：搬运 `DONE`、更新 `OVERVIEW`
 * 都是有产出感的动作，而"回 TASKS 里把一个 `[ ]` 改成 `[x]`"很容易忘。
 * 漏了之后的需求会永远显示"待办"，下一轮又会被规划一次。
 *
 * 判据只看**归档过的**（`DONE.md` 里 `[x] [Tn]` 的条目）——队列里的在途条目不算，
 * 否则每批做到一半就会红。
 */
if (done !== null && tasks !== null) {
  const tasksStatus = new Map(); // Tn → 整段方括号内容（'x' / ' ' / '阻塞' …）
  for (const line of stripHtmlComments(tasks).split(/\r?\n/)) {
    const m = /^\s*-\s*\[([^\]]*)\]\s*T(\d+)\b/.exec(line);
    if (m) tasksStatus.set(`T${Number(m[2])}`, m[1]);
  }

  const archived = new Set();
  for (const line of stripHtmlComments(done).split(/\r?\n/)) {
    if (!/^\s*-\s*\[x\]/.test(line)) continue;
    for (const m of line.matchAll(/\[T(\d+)\]/g)) archived.add(`T${Number(m[1])}`);
  }

  for (const id of archived) {
    if (!tasksStatus.has(id)) {
      problems.push(
        `DONE.md 记了 ${id} 已完成，但 TASKS.md 里没有这条需求——收尾第③步漏了（归档与需求表对不上）`,
      );
    } else if (tasksStatus.get(id).trim() !== 'x') {
      problems.push(
        `DONE.md 记了 ${id} 已完成，但 TASKS.md 里它还是 \`[${tasksStatus.get(id)}]\`——收尾时忘了勾`,
      );
    }
  }
}

// ------------------------------------------------------------------ 输出

for (const w of warnings) console.error(`  ⚠ ${w}`);
if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n编号审计未通过：${problems.length} 个问题${warnings.length ? `、${warnings.length} 个提示` : ''}。`);
  process.exit(1);
}
console.log(`编号审计通过${warnings.length ? `（${warnings.length} 个提示，不阻塞）` : ''}。`);

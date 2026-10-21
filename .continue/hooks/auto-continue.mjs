#!/usr/bin/env node
/**
 * Stop 钩子 · 队列驱动
 *
 * 四态（与参考项目 minicraft-ai-web 的 .codebuddy/hooks 同一套语义）：
 *   `[ ]` 待办 · `[~]` 进行中 · `[x]` 完成 · `[阻塞]` 卡住
 *
 * 职责边界（这条边界是整个机制的地基）：
 *   · **AI 写 `[ ]`（规划）、`[~]`（开始做）、`[x]`（完成）**；
 *   · **脚本只读队列**，把"这一轮做这一条"注入回去，不替 AI 改标记；
 *   · 唯一例外：连续 N 轮没做完，脚本把它标成 `[阻塞]` 隔离，不再递回来。
 *
 * 为什么认领也交给 AI：脚本若在 AI 提交之后再写队列文件，工作区立刻又变脏，
 * 提交守卫每轮都要为"只改了勾"再拦一次，凭空多出一堆记账提交。
 * 让 AI 自己写标记，队列文件就跟着任务一起进同一个提交。
 *
 * 放行条件（按判定顺序）：
 *   1. 不是 Stop 事件 / 拿不到会话 ID（UserPromptSubmit 只复位轮次）；
 *   2. 本会话没有队列（纯问答会话不打扰）；
 *   3. 队列头部（前 5 行）是 `> 状态：讨论中`；
 *   4. 队列里没有 `[ ]` / `[~]`，且**已经请用户确认过收尾**。
 *
 * 收尾：`[ ]` / `[~]` 都没了 → 拦住，请 AI 弹窗让用户确认；
 *   确认后由 AI 把整份队列写进 `DONE.md`、把 `TASKS.md` 里对应条目改成 `[x]`、删除队列文件。
 *   同一份队列只问一次，问过就放行（否则会变成每轮催同一件事）。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTINUE_DIR,
  appendLog,
  commitCount,
  detectEvent,
  emitAllow,
  emitBlock,
  fingerprint,
  loadState,
  markBlocked,
  queuePath,
  readPayload,
  readQueue,
  saveState,
  sessionId,
  unfinishedCount,
} from './lib.mjs';

/** 连续几轮没做完就判"卡住"。默认 5：够 AI 试错，又不至于把上下文烧光。 */
const BLOCKED_MAX = Number(process.env.CONTINUE_BLOCK_AFTER ?? 5);
const DISCOVERED_LIMIT = Number(process.env.CONTINUE_DISCOVERED_LIMIT ?? 5);

const payload = readPayload();
const event = detectEvent(payload);
const sid = sessionId(payload);

// 用户主动说话 → 轮次归零（人工介入后重新计）。
// 只有把本脚本也注册到 UserPromptSubmit 才会走到这里，见 SKILL.md 的注册说明。
if (event === 'UserPromptSubmit') {
  if (sid) {
    const resetState = loadState(sid);
    resetState.count = 0;
    saveState(sid, resetState);
  }
  emitAllow();
}

if (event !== 'Stop') emitAllow();

/**
 * 紧急刹车（本项目在框架原版上补的）：`touch .continue/auto-continue.off` 即放行，
 * 删掉文件恢复。队列文件保留着，恢复后能接着跑——删队列会丢进度，两件事不一样。
 */
const OFF_FILE = join(CONTINUE_DIR, 'auto-continue.off');
if (existsSync(OFF_FILE)) {
  if (sid) appendLog(sid, 'Stop · 放行 · 存在刹车文件 auto-continue.off');
  emitAllow('自动继续已关闭（存在 .continue/auto-continue.off），删除该文件即可恢复。');
}

if (!sid) emitAllow('未拿到 session_id，无法推导队列路径，跳过。');

const file = queuePath(sid);
const queue = readQueue(file);

// 没有队列 = 用户只是在问问题/聊天 → 一次都不要拦。
if (!queue) {
  appendLog(sid, 'Stop · 放行 · 本会话尚未创建队列');
  emitAllow();
}

if (queue.hold) {
  appendLog(sid, 'Stop · 放行 · 队列头部标记为「状态：讨论中」');
  emitAllow('队列处于「讨论中」状态，钩子不递任务。改成「状态：执行中」后开始执行。');
}

const state = loadState(sid);
state.count = (state.count ?? 0) + 1;

/**
 * 选这一轮做哪一条（**只读**，不改文件）：
 *   · 已经有 `[~]`（进行中）→ 继续它（上一轮没做完 / 会话被打断）；
 *   · 没有 → 按用户排的顺序取第一条 `[ ]`，`[发现]` 排在后面。
 */
function pickNext(target) {
  if (!target) return null;
  const usable = target.entries.filter(
    (entry) => entry.kind === 'todo' || entry.kind === 'doing',
  );
  const doing = usable.find((entry) => entry.kind === 'doing');
  if (doing) return { raw: doing.raw, resumed: true };
  const scheduled = usable.find((entry) => !/^-\s*\[[^\]]*\]\s*\[发现\]/.test(entry.raw));
  const chosen = scheduled ?? usable[0];
  return chosen ? { raw: chosen.raw, resumed: false } : null;
}

/**
 * 批次号（= 当前提交总数）在这里取一次，递任务和收尾提示都要用。
 * 位置放这么靠后是因为**上面全是放行分支**：纯问答会话不该为一行展示文本付子进程开销。
 */
const batch = commitCount();

let pick = pickNext(queue);

/**
 * 没有可做的了 → 请用户确认收尾。
 *
 * 为什么必须问：`[阻塞]` 是脚本隔离的条目，用户没看过就等于悄悄丢活；
 * 而且 DONE.md / TASKS.md 一旦写入就是既成事实，写错了要回滚两份文档。
 */
if (!pick) {
  if (queue.entries.length === 0) {
    state.count = 0;
    saveState(sid, state);
    appendLog(sid, 'Stop · 放行 · 队列是空的');
    emitAllow('队列里没有任何条目。没有要做的就删掉这个队列文件。');
  }

  if (state.askedComplete) {
    appendLog(sid, 'Stop · 放行 · 已请用户确认收尾，等回复');
    emitAllow('已经请用户确认收尾了，等他们回复；确认后再更新 DONE.md 与 TASKS.md。');
  }

  state.askedComplete = true;
  state.count = 0;
  saveState(sid, state);
  appendLog(
    sid,
    `Stop · 待确认 · 完成 ${queue.counts.done} 条 / 卡住 ${queue.counts.blocked} 条`,
  );

  const blocked = queue.entries.filter((entry) => entry.kind === 'blocked');

  emitBlock(
    [
      '[auto-continue · 等用户确认收尾]',
      '',
      `队列里已经没有 \`[ ]\` / \`[~]\` 了：完成 ${queue.counts.done} 条，卡住 ${queue.counts.blocked} 条。`,
      ...(blocked.length > 0
        ? ['', `卡住的条目（\`[阻塞]\`，共 ${blocked.length} 条）：`, ...blocked.map((entry) => `  · ${fingerprint(entry.raw)}`)]
        : []),
      '',
      '## 现在要做的事：请用户确认',
      '',
      '用弹窗提问工具让用户拍板（CodeBuddy 叫 `ask_followup_question`，Claude Code 叫',
      '`AskUserQuestion`，按你手上的实际工具名来），选项按这个顺序（第一个是推荐）：',
      '',
      '1. **确认完成** —— 按下面的步骤收尾；',
      '2. **还要补充** —— 用户说清补什么，你补成 `- [ ]`，队列继续跑；',
      '3. **有做得不对的 / 卡住的要重做** —— 用户指出哪条，你把它改回 `- [ ]` 重做。',
      '',
      '## 用户确认完成后（五步都要做完）',
      '',
      '1. 把整份队列写进 `.continue/DONE.md`：条目原文照搬（含 `[阻塞]`），补一段完成说明，',
      `   标题写成 \`## 批次 ${batch ?? '<n>'}（提交 ${batch ?? '<n>'}→<收尾时的提交总数>）· 日期 · 会话 ${sid.slice(0, 8)}\`；`,
      '2. 把整份队列在 `.continue/TASKS.md` 里落地：已有对应条目的改成 `[x]`，',
      '   当场任务（TASKS 里原本没有的）在 `C. 已完成` 补一条 `[x]`，内容照抄队列那一行；',
      '   边界：只补 `[x]`（记录已发生的事），**不要新增 `[ ]`**——未来的计划由用户提；',
      '3. **自问一次**：这批有没有"下一批还会被绊到"的设计取舍（为什么这么做 / 代价 / 何时该重看）',
      '   → 有就在 `.continue/NOTES.md` 补一节（按模块归到已有小节下，别新建重复主题）；',
      '4. **自问一次**：这轮有没有会重复踩的坑（调很久才定位 / 改了 A 红了 B / 工具的隐蔽默认值）',
      '   → 有就在 `.continue/EXPERIENCE.md` 补一节（症状 → 根因 → 处置 → 适用面）；',
      '   ⚠️ 3、4 都**只写确实有的**：没有就跳过，**不写"本批无"占位**——占位会让人以为已经读过；',
      `5. 删除 \`.continue/queues/${sid}.md\`。`,
      '',
      '> 用户没确认之前不要动 DONE.md / TASKS.md，也不要删除队列文件。',
    ].join('\n'),
  );
}

const firstPick = pick;
let fp = fingerprint(firstPick.raw);

// 重新开始干活 → 作废"已经问过收尾"的记忆，下次收尾要重新确认。
state.askedComplete = null;

// ---------------------------------------------------------------- 卡住就隔离
let streak = state.currentFingerprint === fp ? (state.currentStreak ?? 0) + 1 : 1;
state.currentFingerprint = fp;
state.currentStreak = streak;
// ⚠️ 必须每轮落盘：不存的话下一轮读回来是初始值，连续次数永远是 1，隔离永远触发不了。
saveState(sid, state);

let justBlocked = null;
if (streak >= BLOCKED_MAX) {
  markBlocked(file, fp);
  appendLog(sid, `Stop · 隔离 · 连续 ${streak} 轮未完成 → 标 [阻塞] · ${fp.slice(0, 40)}`);
  justBlocked = { streak, text: fp };

  // 重置连续计数：用户将来改回 `[ ]` 时重新得到 N 次机会
  state.currentFingerprint = null;
  state.currentStreak = 0;
  saveState(sid, state);

  const after = readQueue(file);
  pick = pickNext(after);

  // 没有别的活了 → 放开，下一轮 Stop 会转入「等用户确认收尾」
  if (!pick || unfinishedCount(after) === 0) {
    state.count = 0;
    saveState(sid, state);
    appendLog(sid, 'Stop · 放行 · 没有别的活，等待收尾确认');
    emitAllow(
      `这一条连续 ${streak} 轮没做完，已标 [阻塞] 隔离。队列里没有别的待办了，` +
        '下次停下会请你确认收尾。',
    );
  }

  fp = fingerprint(pick.raw);
  state.currentFingerprint = fp;
  state.currentStreak = 0;
  saveState(sid, state);
}

const current = readQueue(file);
const remaining = unfinishedCount(current);
/**
 * 配额只数**还没做完**的 `[发现]`。
 * 数上 `[x]` 的话，插满 5 条并做完之后就永久"已满"，
 * 等于这个功能在队列后半程被静默关掉。
 */
const discovered = current.entries.filter(
  (entry) =>
    (entry.kind === 'todo' || entry.kind === 'doing') &&
    /^-\s*\[[^\]]*\]\s*\[发现\]/.test(entry.raw),
).length;
const discoveredFull = discovered >= DISCOVERED_LIMIT;
const blockedCount = current.counts.blocked;

// `firstPick` 是隔离**之前**选中的那条；隔离后 pick 可能已经换成下一条，
// 所以"是否续做 [~]"要以最终的 pick 为准，否则文案会张冠李戴。
const resumedNow = Boolean(pick && pick.resumed);

if (justBlocked) {
  appendLog(sid, `Stop · 递任务（已隔离上一条）· 剩 ${remaining} 条 · ${fp.slice(0, 40)}`);
} else if (resumedNow) {
  appendLog(sid, `Stop · 继续进行中的条目 · 剩 ${remaining} 条 · ${fp.slice(0, 40)}`);
} else {
  appendLog(sid, `Stop · 递任务 · 剩 ${remaining} 条 · ${fp.slice(0, 40)}`);
}

/**
 * 「发现风险就弹窗」，替代"上下文超阈值就打断让人换会话"。
 * 区别是本质的：旧逻辑按**与工作无关的指标**打断，新逻辑只在**真要人拍板**时停。
 */
const RISK_RULE = [
  '## ⚠️ 发现风险就弹窗问用户（重要）',
  '',
  '撞到下面任一情况，立刻用弹窗提问工具（`ask_followup_question` / `AskUserQuestion`）把 2~4 个',
  '**具体选项**摆出来（每个写清代价，推荐项放第一位），',
  '等用户选完再继续。不要先做了再汇报，也不要用"我觉得这样更好"绕过：',
  '',
  '1. **不可逆的破坏**：删数据 / 改存档格式 / 改公开接口 / 强制推送；',
  '2. **会波及其他队列**：要动的文件是另一条的地盘，或改动会让已通过的断言变红；',
  '3. **多种合理做法且取向不同**：性能 vs 一致性、对齐原版 vs 修复体验；',
  '4. **需求本身有歧义**：条目能理解成两个意思，做错了要返工；',
  '5. **超出这条的范围**：做完发现必须顺手改一大片不在本次范围内的东西。',
].join('\n');

const discoveredBlock = [
  '## 可以在队列里插任务——但有硬条件',
  '',
  `做完这条后，如果**在动手过程中**发现了更该先做的事，可以插一条（现有 ${discovered}/${DISCOVERED_LIMIT} 条）：`,
  '',
  '```',
  '- [ ] [发现] <一句话说清是什么>：<哪个文件/哪条断言暴露的> → <怎么算做完>',
  '```',
  '',
  '1. **必须是这一轮真实撞见的**，条目里写明证据（文件行号 / 断言失败 / 实测现象）；',
  '2. **只能插，不能删改用户排的条目**；',
  '3. **插完必须在回复里说一句**："我插了一条：[发现] …，因为 …"，让用户能看见并否决。',
  discoveredFull ? `\n⚠️ 本轮**不要再插**：\`[发现]\` 已满 ${DISCOVERED_LIMIT} 条，先让用户过一遍。` : '',
].join('\n');

const header = [
  `[auto-continue 第${state.count}轮`,
  batch ? `批次 ${batch}` : null,
  `会话 ${sid.slice(0, 8)}`,
  `队列还剩 ${remaining} 条`,
  `队列：.continue/queues/${sid}.md]`,
]
  .filter(Boolean)
  .join(' · ');

const feedback = [
  header,
  '',
  `## 这一轮做这一条${resumedNow ? '（它已经标了 `[~]`，接着做完）' : ''}`,
  `  · ${fp}`,
  '',
  '## 动手前（30 秒，省掉一次重新踩坑）',
  '`.continue/EXPERIENCE.md` / `NOTES.md` 若存在，按本条的关键词各 grep 一次（**别整份读**，很贵）；',
  '撞到已经记过的坑，直接用上面写的处置，不要重新试错；',
  '真踩到新坑且解决了 → 现在就可以补一条（不必等到收尾）。',
  '',
  '## 要求',
  '1. **只做这一条**，做完就停；下一条由下一轮脚本注入。',
  '2. **标记由你自己写**：开始做这条时把 `- [ ]` 改成 `- [~]`（进行中），',
  '   做完改成 `- [x]`。`[阻塞]` 只有脚本会写，**你不要自己写，也不要手动删除它**。',
  '3. 做完把这一条改成 `[x]`，然后连同队列文件一起单独提交',
  `   （中文 commit message：${batch ? `批次 ${batch} · ` : ''}改了什么 + 怎么验证的）。`,
  '4. 提交前自测；测试不过先修，不要提交半成品。',
  '5. 遇到困难自己解决并把结论记下来——**除非命中下面五条风险**，那时必须弹窗。',
  '6. 判断某条不该做（比如核对后发现已经实现）→ 在回复里说明理由，让用户决定',
  '   （把它删掉或改描述）；**不要自己把它改成 `[~]` 或删掉**——`[~]` 现在是"进行中"。',
  '',
  RISK_RULE,
  '',
  justBlocked
    ? [
        `## ⚠️ 刚有一条连续 ${justBlocked.streak} 轮没做完，已标 [阻塞] 隔离`,
        '',
        '上面「这一条」里**已经不含它**——脚本隔离了它，你现在做的是下一条。',
        '你要**在回复里如实上报**：',
        '',
        `1. **是哪一条**：${justBlocked.text}`,
        '2. **试过什么、卡在哪**（具体到报错 / 断言 / 文件行号，不要写"做不动"）；',
        '3. **给用户的三个选项**：改这条的描述继续做 / 直接删除 / 先留着后面处理。',
        '   用户会自己决定，你不要替他决定，也不要自行删除或改描述。',
        '',
        `它会被标成 \`- [阻塞] ...\`，之后不再被选中；用户处理完（改回 \`- [ ]\`）才会重试。`,
        '',
      ].join('\n')
    : '',
  blockedCount > 0 ? `> 队列里已有 ${blockedCount} 条 \`[阻塞]\`（卡住），收尾时一起交给用户确认。\n` : '',
  discoveredBlock,
].join('\n');

emitBlock(feedback);

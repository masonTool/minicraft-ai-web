#!/usr/bin/env node
/**
 * Stop 钩子 · 队列驱动
 *
 * 四态（沿用本框架早期的钩子实现，语义不变）：
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
 *   2. 刹车开着（`.continue/auto.off` 存在）；
 *   3. 本会话没有队列（纯问答会话不打扰，也不为它建日志文件）；
 *   4. 队列头部（前 5 行）是 `> 状态：讨论中`；
 *   5. 队列里没有 `[ ]` / `[~]`，**且**没有待验收的里程碑，且**自动收尾指令已下发过**（或已请用户拍板过）。
 *
 * 里程碑关卡（`## 里程碑 MS1 · 名` + `- 验收：…`）：走到它 → **硬停**，等人验收。
 * 这是这套机制里唯一"必须人说一句才继续"的地方——里程碑存在的理由就是这个停顿。
 *
 * 每一次 Stop 都会在日志里留痕：递任务记一条，空转放行记 `空转 · <原因>`，
 * 状态行里有累计的 `stopSeen`。没有这一层，"钩子放行了"和"钩子没跑"在日志里长得一样。
 *
 * 收尾：`[ ]` / `[~]` 都没了 → **默认自动收尾**（不弹窗、不等确认）：
 *   由 AI 把整份队列（含每条下方的完成说明）搬进 `DONE.md`、更新 `OVERVIEW.md`、
 *   把 `TASKS.md` 里对应条目改成 `[x]`、视情况补 `TIPS.md`、把队列归档到 `.logs/<会话ID>/`。
 *   **在工作树里也一样是五步**：2026-10-24 起取消了收尾自动 `rebase → merge`，
 *   这批做完就结束——合不合、何时合、树什么时候删，都由用户处理。
 *   **只有**出现 `[阻塞]`，或"打完勾但缺验证说明 / 自述未验证、没跑"的条目时才弹窗问用户
 *   ——那两类人没看过就等于悄悄丢活。同一份队列只催一次，之后放行（否则每轮重复同一句话）。
 */

import { existsSync } from 'node:fs';
import {
  setLogTag,
  appendLog,
  BRAKE_REL,
  brakeOn,
  DOING_REL,
  emitAllow,
  adoptStrayQueue,
  emitBlock,
  findStrayQueue,
  fingerprint,
  isInsideWorktree,
  listQueues,
  loadState,
  markBlocked,
  markEntryDoing,
  parseBatch,
  queueFileName,
  queuePath,
  readLogText,
  readPayload,
  readQueue,
  readTodo,
  resolveEvent,
  saveState,
  sessionId,
  shortSid,
  TODO_REL,
  unfinishedCount,
} from './lib.mjs';

/** 连续几轮没做完就判"卡住"。默认 5：够 AI 试错，又不至于把上下文烧光。 */
const BLOCKED_MAX = Number(process.env.CONTINUE_BLOCK_AFTER ?? 5);
const DISCOVERED_LIMIT = Number(process.env.CONTINUE_DISCOVERED_LIMIT ?? 5);

/**
 * 队列还剩这么多条时，提醒"该设检查点了"。
 *
 * 为什么需要：一批塞 30 条时，`DONE.md` 那一节自己就会超过 300 行上限，
 * 而 `archive-done.mjs` 只能按批次**整节搬**——届时没有更旧的节可搬，归档退化成手工精简。
 * 所以要在队列还长的时候就提示：要么按批分阶段收尾，要么在队列里插里程碑节点
 * （`## 里程碑 MSn · 名` + `- 验收：…`），让长任务在中间停下来让人看一眼。
 */
const LONG_QUEUE_HINT = 10;

const payload = readPayload();
// 事件名优先来自注册参数（`--event=Stop` / `--event=UserPromptSubmit`），写进日志行首
const event = resolveEvent(payload);
setLogTag('auto-continue', event);
const sid = sessionId(payload);

/**
 * 这一轮是不是「续跑」：宿主采纳了上一次 Stop 反馈、把模型又叫了起来。
 *
 * 为什么要认这个：有的宿主限制"每条用户消息最多采纳几次 Stop 反馈"
 * （CodeBuddy IDE 默认 1，字段叫 `loop_limit`；WorkBuddy 没有上限）。
 * 被限制时**这一轮反馈会被静默丢弃**——钩子照样跑、照样写"递任务"，
 * 只有日志里标出"续跑第 N 次"，才能区分"AI 不听话"和"反馈被宿主截断"。
 *
 * 判据：`stop_hook_active` 由宿主直接给；`loop_count` 只有部分宿主给（1 起）。
 * 两个都没有就按首轮处理，不要猜。
 */
const loopCount = Number(payload.loop_count);
const continuation = payload.stop_hook_active === true || (Number.isFinite(loopCount) && loopCount > 1);
const contMark = continuation ? ` · 续跑第${Number.isFinite(loopCount) ? loopCount : 2}次` : '';

// 用户主动说话 → 轮次归零（人工介入后重新计）。
// 只有把本脚本也注册到 UserPromptSubmit 才会走到这里，见 SKILL.md 的注册说明。
/**
 * 用户说话 → 轮次归零 + **留一行痕迹**。
 *
 * 只归零不记录，日志里就只剩 Stop 的行；用户看到"我发了好几条消息、日志一条没动"，
 * 会以为钩子没跑（真这么被问过）。这里记次数不记内容：内容没必要，次数足够回答
 * "钩子有没有在跟着我的消息走"。
 */
if (event === 'UserPromptSubmit') {
  if (sid) {
    const resetState = loadState(sid);
    resetState.count = 0;
    resetState.promptSeen = (resetState.promptSeen ?? 0) + 1;
    resetState.lastPromptAt = new Date().toISOString();
    saveState(sid, resetState);
    /**
     * **无条件**写这一行（T46）。原先的判据是"有队列，或 `queue-init` 已经建过日志"，
     * 而这两个钩子挂在**同一个 UserPromptSubmit 事件**上、并发执行、顺序不保证——
     * 于是同一场景两次运行，这一行时有时无（本仓库实测：会话里有 queue-init 的行、
     * 却没有这一行）。日志是判断"钩子有没有跟着用户消息走"的唯一证据，
     * 不能取决于另一个进程抢没抢到前面。
     */
    appendLog(sid, `收到用户消息 · 第 ${resetState.promptSeen} 次 · 轮次归零`);
  }
  emitAllow();
}

if (event !== 'Stop') emitAllow();

if (!sid) emitAllow('未拿到 session_id，无法推导队列路径，跳过。');

/**
 * 先认领"用完整会话 ID 命名"的队列，再读。
 *
 * 实测模型会把文件名写成完整会话 ID（`e2e000…e.md`），而钩子按前 6 位找——找不到就等于
 * 没有队列，整套机制静默失效。完整 ID 全局唯一，所以"文件名恰好等于完整 ID"时可以直接改名，
 * 没有歧义；只是前缀相同的其它文件一律不动（可能是另一个会话撞了 6 位前缀）。
 */
const adopted = adoptStrayQueue(sid);
if (adopted) appendLog(sid, `已认领队列文件名 · -> ${adopted}`);

const file = queuePath(sid);
const queue = readQueue(file);

/**
 * 本会话是否"值得留痕"：有队列，或者已经写过日志。
 * 两者都没有 = 纯问答会话，不为它凭空造一个日志文件。
 */
const tracked = queue !== null || readLogText(sid) !== null;

/**
 * 存活埋点（T16）：每次 Stop 都累加一次，**空转放行也记一行**。
 *
 * 为什么需要（挡的是哪次误判）：旧行为是"空转的放行不记"，结果一个 7 条任务的批次
 * 跑完，日志里只有会话启动和一条"就绪"——分不清"钩子放行了"和"钩子根本没跑"，
 * 排查时只能靠猜（那次真这么猜了半天，最后才确认是整批都在一个回合里做完）。
 * 一行日志的代价远小于一次错误归因。
 */
const liveState = tracked ? loadState(sid) : {};
if (tracked) {
  liveState.stopSeen = (liveState.stopSeen ?? 0) + 1;
  liveState.lastStopAt = new Date().toISOString();
  saveState(sid, liveState);
}

/** 空转放行：记一行再放行，让"跑过但放行"和"压根没跑"在日志里长得不一样。 */
function idleAllow(reason, message) {
  if (tracked) appendLog(sid, `空转 · ${reason}`);
  emitAllow(message);
}

if (brakeOn()) idleAllow('刹车已开', `刹车已开（${BRAKE_REL}），不递任务；删掉该文件即恢复。`);

// 没有队列 = 用户只是在问问题/聊天 → 一次都不要拦。
if (!queue) {
  /**
   * 「还没建」和「名字写错」在钩子眼里都是"没有队列"，后果却完全不同：
   * 前者正常，后者等于整套机制静默失效。所以先扫一遍近名文件，命中就拦住要求改名。
   */
  const stray = findStrayQueue(sid);
  if (stray) {
    appendLog(sid, `队列文件名可疑 · ${stray}（应为 ${queueFileName(sid)}）`);
    emitBlock(
      [
        '[auto-continue · 队列文件名不对，整套机制现在是失效的]',
        '',
        `本会话的队列应该叫 \`${DOING_REL}/${queueFileName(sid)}\`，`,
        `但 \`${DOING_REL}/\` 里有个 \`${stray}\`（前缀和本会话相同）。`,
        '',
        '文件名就是契约：钩子按会话 ID 直接算路径，**名字差一个字符就永远找不到它**。',
        '此时队列看着还在、你也在按流程走，但钩子一次都不会递任务、也不会收尾——而且不报错。',
        '',
        '## 现在要做的事',
        '',
        `1. 如果 \`${stray}\` 是你刚建的：\`git mv ${DOING_REL}/${stray} ${DOING_REL}/${queueFileName(sid)}\`，`,
        '   文件内容不用动；改名后钩子下一轮就能接上；',
        `2. 如果它是**别的会话**的（6 位前缀撞车）：不要动它，把本会话队列建成 \`${queueFileName(sid)}\`；`,
        '3. 两种都不是：先 `ls .continue/doing/` 看清楚再动手。',
      ].join('\n'),
    );
  }
  /**
   * 交接模式下"本会话没有队列"是**正常状态**，不是漏了建：
   * 主工作区规划完，队列躺在 `todo/` 里等 `dispatch` 建树。
   * 这里要说清"不用在本树开工"，否则 AI 会顺手建一份 doing 队列，
   * 主树的规划/执行分离当场破功（而且 Stop 会开始给本树递任务）。
   */
  const pending = isInsideWorktree() ? null : readTodo();
  if (pending) {
    const tree = pending.state?.tree;
    if (tree && existsSync(tree)) {
      idleAllow(
        '交接队列等待派发',
        `交接队列已派发到 ${tree}（分支 ${pending.state.branch ?? '?'}）：去那个窗口干活，本会话不用再做。`,
      );
    }
    /**
     * `doing/` 里一个会话队列都没有 → 交接**不该触发**（`dispatch` 也这么判）。
     * 这种时候还催"等 Stop 派发"就是空转：Stop 每轮都说同一句话，收件箱永远不动。
     * 直接告诉 AI 该走哪条路——把内容搬进本会话队列，在原地干完。
     */
    const othersRunning = listQueues().some((item) => item.file !== queuePath(sid));
    if (!othersRunning) {
      idleAllow(
        '交接不触发（没人在跑）',
        [
          `收件箱里有内容（${TODO_REL}/queue.md），但 \`${DOING_REL}/\` 里没有别的会话队列——交接只在有人并行时才触发。`,
          `把那份队列写进 \`${DOING_REL}/${queueFileName(sid)}\`（首行会话 ID 换成本会话完整 ID），`,
          '删掉收件箱里的文件，然后在本会话直接干完。',
        ].join('\n'),
      );
    }
    idleAllow(
      '交接队列等待派发',
      `收件箱有待派发队列（${TODO_REL}/queue.md）：Stop 时会自动建工作树并开新窗口，本会话不用再做。`,
    );
  }
  idleAllow('本会话没有队列');
}

if (queue.hold) {
  /**
   * `讨论中` 有两种：用户主动暂停（有内容），和"脚本刚建好还没填"（空）。
   * 后者静默放行就等于**永远停在这里**——没人会记得回来改状态。所以空的时候要拦一次。
   */
  if (queue.entries.length === 0) {
    emitBlock(
      [
        '[auto-continue · 队列还是空的（状态：讨论中）]',
        '',
        `\`${DOING_REL}/${queueFileName(sid)}\` 已经建好了，但里面**一条条目都没有**，`,
        '状态还是 `讨论中` ——这个状态钩子不递任务，会一直停在这里。',
        '',
        '## 现在要做的事',
        '',
        '1. 把这一批要做的事写成条目（每条一行 `- [ ] …`，下面带一行 `  - 验证：…`）；',
        '2. 把头部的 `> 状态：讨论中` 改成 `> 状态：执行中`；',
        '3. 之后钩子每轮递一条，做完勾 `[x]` 再提交。',
        '',
        '如果是用户明确要求**先讨论方案、先别动手**，那就保持 `讨论中` 不动，把问题问清楚即可。',
      ].join('\n'),
    );
  }
  idleAllow('讨论中，不递任务', '队列处于「讨论中」状态，钩子不递任务。改成「状态：执行中」后开始执行。');
}

const state = loadState(sid);
state.count = (state.count ?? 0) + 1;

/**
 * 选这一轮做哪一条（**只读**，不改文件）：
 *   · 已经有 `[~]`（进行中）→ 继续它（上一轮没做完 / 会话被打断）；
 *   · 没有 → 按用户排的顺序取第一条 `[ ]`，`[发现]` 排在后面。
 *
 * 返回的 `entry` 带上 `seq`（队列内序号，见 `parseQueue`）——它才是这一轮的
 * **条目身份**，隔离、状态记录、显示都用它，不再用正文指纹。
 */
function pickNext(target) {
  if (!target) return null;
  const usable = target.entries.filter(
    (entry) => entry.kind === 'todo' || entry.kind === 'doing',
  );
  const doing = usable.find((entry) => entry.kind === 'doing');
  if (doing) return { entry: doing, raw: doing.raw, resumed: true };
  const scheduled = usable.find((entry) => !/^-\s*\[[^\]]*\]\s*\[发现\]/.test(entry.raw));
  const chosen = scheduled ?? usable[0];
  return chosen ? { entry: chosen, raw: chosen.raw, resumed: false } : null;
}

/** 完成说明里的凭证行：`  - 验证：…`（半角/全角冒号都认）。 */
const VERIFY_RE = /^\s*(?:[-*]\s*)?验证\s*[:：]\s*(.*)$/;

/**
 * 自述"没验 / 没跑"的措辞。命中它 = 这条打了勾但没人能保证真的做完。
 *
 * ⚠️ **不要收 `跳过`**：本项目 `check:browser` 默认就是跳过，
 * "npm run check 绿（browser-check 默认跳过）"是一句诚实的验证，收进来会把
 * 每次自动收尾都变成弹窗（语义误伤，不是理论风险）。
 */
const UNPROVEN_RE = /未验证|无法验证|没法验证|没跑|未跑|没执行|待验证/;

/**
 * 找出"打了勾但没能自证"的条目：缺 `验证` 说明，或验证说明里自述未验证 / 跳过。
 *
 * 为什么由脚本判、而不是让 AI 自报：AI 一旦写"已测试"，人只能信；而"有没有 `验证` 行、
 * 行里怎么写的"是可以机械检查的——这也正是"跳过"唯一会留下的痕迹。
 * 宁可多问用户一句，也不要把一条没验证的活记进 `DONE.md` 变成既成事实。
 */
function collectUnproven(queue) {
  const lines = queue.text.split(/\r?\n/);
  const out = [];
  queue.entries.forEach((entry, i) => {
    if (entry.kind !== 'done') return;
    const next = queue.entries[i + 1];
    const body = lines.slice(entry.index + 1, next ? next.index : lines.length);
    // 只认 `验证：` 开头的那一行：正文里顺口提一句"验证"不算凭证。
    const verify = body.map((line) => VERIFY_RE.exec(line)).find(Boolean);
    if (!verify) out.push({ entry, reason: '缺「验证」说明' });
    else if (UNPROVEN_RE.test(verify[1])) out.push({ entry, reason: '自述未验证 / 没跑' });
  });
  return out;
}

/**
 * 批次号：**只读队列头部声明的 `> 批次：`**。
 *
 * 一批一个号，开工时由 `queue-init` 生成时间戳、AI 抄进队列头，之后恒定不变
 * （一批里提交很多次也还是同一个号）。
 *
 * ⚠️ **取不到时不回退**。旧设计在这里 `?? commitCount()`，后果是：队列没写批次时
 * 每轮都拿当前提交数当批次号，提交一次就从 `批次 3` 漂成 `批次 4`——
 * "批次恒定"悄悄失效，而且没有任何提示。现在改成 null 并在注入里显式告警。
 */
const batch = parseBatch(queue.text);

let pick = pickNext(queue);

/**
 * 里程碑关卡：找出**该停下来的那个节点**。
 *
 * 判据两条，缺一不可：
 *   · 这个里程碑还没有 `- 确认：已验收`（没被人工验收过）；
 *   · 它**前面**的条目全部是 `[x]` / `[阻塞]`（没有 `[ ]` / `[~]`）——即已经做完这一段。
 *
 * `[发现]` 例外：它是干活途中插进来的"以后再做"，不该拦住关卡。否则 `pickNext` 会
 * 先挑里程碑后面那条普通任务（`[发现]` 排在后面），关卡就被**绕过去**了。
 *
 * 为什么不再单独建计划文件：里程碑本来就是"队列里的一个位置"。写成独立文件后，
 * 队列顺序、批次号、完成状态都要在两处表达，两份必然漂（历史上真漂过：
 * 门禁接受的写法钩子不认，门禁全绿、机制一次不触发）。放在同一份文件里，顺序与状态只有一份。
 */
function pendingMilestone(target) {
  if (!target) return null;
  return (
    target.milestones.find(
      (ms) =>
        !ms.confirm &&
        target.entries.every(
          (entry) =>
            entry.index > ms.index ||
            entry.kind === 'done' ||
            entry.kind === 'blocked' ||
            /^-\s*\[[^\]]*\]\s*\[发现\]/.test(entry.raw),
        ),
    ) ?? null
  );
}

/**
 * 收尾步骤（自动收尾、用户拍板后收尾、里程碑中场收尾共用同一段，避免文案分叉）。
 *
 * 这五步都是"把已经发生的事实搬进文档"，没有取舍空间——默认不需要人拍板。
 *
 * `includeArchive=false` 用于**里程碑关卡的中场收尾**：队列还要接着装下一段，
 * 所以第 5 步（归档并移走队列文件）先不做；等走到最后一个里程碑时再走完整五步。
 */
/**
 * 收尾标题。**工作树里也是五步**：同步（rebase / merge）已取消，不再有第 6 步——
 * 标题跟着步数变过一次，这里留着常量是为了以后加步数时不用改三处文案。
 */
const WRAP_TITLE = '五步都要做完';

function wrapSteps(includeArchive = true) {
  return [
  '1. **原样搬运**：把整份队列写进 `.continue/DONE.md`——条目原文照搬（含 `[阻塞]`），',
  '   **连同每条下方的完成说明一起搬**，不再二次总结；',
  `   标题写成 \`## 批次 ${batch ?? '<n>'} · 日期 · 会话 ${sid.slice(0, 8)}\`。`,
  '   ⚠️ **不要写 `提交 n→m`**：`m` 要先知道收尾提交之后的总数，而写这个数字本身又产生一次提交，',
  '   `m` 立刻失效——这是个自指的死结（实测连改四版都追不上）。想知道这批动了几次，',
  `   直接 \`git log --oneline --grep '批次 ${batch ?? '<n>'}'\` 数一下。`,
  '   个别条目当时没写说明 → 现在补一段（做了什么 / 为什么 / 怎么验证）；',
  '   搬运前核对：每条 `[x]` 都要有 `验证：` 开头的一行。缺的当场跑一遍补上；跑不了就如实写"未验证"，',
  '   **不要替它编一个结果**；',
  '2. 更新 `.continue/OVERVIEW.md`：完成项按模块挂 `T` 编号 + 批次号，批次索引加一行，',
  '   这批新踩的坑在对应模块下写一行摘要；跨批的同一需求按批次分行累加，不要合并；',
  '3. 把整份队列在 `.continue/TASKS.md` 里落地：已有对应条目的改成 `[x]`，',
  '   当场任务（TASKS 里原本没有的）在 `C. 已完成` 补一条 `[x]`，内容照抄队列那一行；',
  '   边界：只补 `[x]`（记录已发生的事），**不要新增 `[ ]`**——未来的需求由用户提；',
  '4. **自问一次**：这轮有没有会重复踩的坑（调很久才定位 / 改了 A 红了 B / 工具的隐蔽默认值）',
  '   → 有就在 `.continue/TIPS.md` 的对应模块下补一节（症状 → 根因 → 处置 → 适用面）；',
  '   ⚠️ **只写确实有的**：语法记错、漏读文档导致的误判、一条命令就能查明的现象**都不算坑**，',
  '   写进去只会稀释真正有价值的条目。没有就跳过，**不写"本批无"占位**；',
    ...(includeArchive
      ? [`5. **归档队列文件**（不要 \`rm\`）：跑 \`node .continue/hooks/archive-queue.mjs ${sid}\`，` +
        '   它把队列**追加**到 `.continue/.logs/<会话ID>/queue.md` 的最上面（一个批次一节、`----------` 分隔），原文不会丢。' +
        '   队列原文已经整份进了 `DONE.md`，备份只是"想翻原文时还在"，不进仓库、不进提交。' +
        '   决策记录会跟着队列一起归档，不用再单独跑 `--decision`。']
      : []),
    '',
    '**到此为止**：不合并、不 rebase、不删工作树。合不合、什么时候合、树什么时候删，',
    '都由用户自己处理——不要顺手 `git merge`，那不属于这一批的收尾。',
    '',
    '**做完在回复里逐条回执**：各自"做了 / 没做（原因）"，让用户一眼看出收尾是否完整；',
    '漏掉的当场补，不要让用户自己去翻文档核对。',
  ];
}
/** 完整五步（含归档）。文案与自动收尾分支共用一份，自检里钉着"必须含归档、不许 rm"。 */
const WRAP_STEPS = wrapSteps(true);

/**
 * 走到里程碑 → **硬停**，等人验收。
 *
 * 为什么这是硬停而不是"顺手记一笔就继续"：里程碑存在的唯一理由就是"到这个点了，
 * 让人看一眼值不值得往下走"。自动越过它，等于关卡从来没有存在过。
 *
 * 重复提醒由 `state.msStep` 挡一次：同一把钥匙（里程碑 + 批次）连续出现 = 上一轮指令没落实，
 * 到 `BLOCKED_MAX` 轮就升级成"卡住了"告警——否则会永久空转且一声不吭。
 */
function emitMilestoneGate(ms) {
  const key = `${ms.id}:${batch ?? '?'}`;
  const blockedBefore = queue.entries.filter((entry) => entry.index < ms.index && entry.kind === 'blocked');
  if (state.msStep === key) {
    state.msStreak = (state.msStreak ?? 0) + 1;
  } else {
    state.msStep = key;
    state.msStreak = 0;
    state.msStuck = null;
  }
  // ⚠️ 立刻落盘：下面"只放行一次"的分支不会再写状态，不存的话连续次数永远是 1，
  // 「卡住了」升级永远触发不了（计划机制时代踩过，现象只是"它一直在等"，没有任何报错）。
  saveState(sid, state);

  if (state.msStreak >= BLOCKED_MAX && state.msStuck !== key) {
    state.msStuck = key;
    saveState(sid, state);
    appendLog(sid, `里程碑卡住 · ${key} 连续 ${state.msStreak} 轮没推进`);
    emitBlock(
      [
        '[auto-continue · 里程碑关卡卡住了，需要人看一眼]',
        '',
        `\`${key}\` 连续 **${state.msStreak} 轮**没有推进：指令下发过，但队列里的确认行 / 批次号都没变化。`,
        '',
        '**这不是"没事可做"，是上一轮该做的事没做成。**继续空转会一直停在这里，而且不会有新提示。',
        '',
        '## 现在要做的事',
        '',
        `1. 打开 \`.continue/doing/${queueFileName(sid)}\`，核对卡在哪一步`,
        '   （跑验收？弹窗问人？写 `- 确认：已验收`？换批次号？修剪已完成条目？）；',
        '2. 直接把它做掉——这些动作不产生新事实，没有取舍空间；',
        '3. 如果连指令都读不懂，`touch .continue/auto.off` 停下并告诉用户，',
        '   **不要**把"卡住"伪装成"完成"（比如替用户写确认行）。',
      ].join('\n'),
    );
  }

  if (state.msStreak > 0) {
    idleAllow(
      `里程碑 ${ms.id} 已请用户验收，等回复`,
      `\`${ms.id}\` 已经请你验收、指令也下发过了，正在等用户答复。答复之前不要动队列、也不要重复弹窗。`,
    );
  }

  state.count = 0;
  saveState(sid, state);
  appendLog(sid, `里程碑完成 · ${ms.id} · 硬停等验收 · 批次 ${batch ?? '?'}`);
  emitBlock(
    [
      `[auto-continue · 到达里程碑 ${ms.id}，停下等人工验收]`,
      '',
      `队列里 \`## 里程碑 ${ms.id} · ${ms.title}\` 之前的条目已经全部做完，`,
      '这个里程碑**还没有** `- 确认：已验收`，所以现在停下来。',
      '',
      '## 顺序不能反：跑验收 → 问人 → 拿到答复后才动队列',
      '',
      '### ① 真跑一遍这个里程碑的验收',
      '',
      ...(ms.acceptance.length > 0
        ? ms.acceptance.map((a) => `- \`${a.replace(/`/g, '')}\``)
        : ['- ⚠️ 这个里程碑**没写 `- 验收：`**。先补一行能跑的命令再执行；以后每个里程碑都要有这一行。']),
      '',
      '把输出贴给用户。**跑不起来就如实写"未验证"，不要编一个结果。**',
      '',
      '### ② 弹窗问用户',
      '',
      '用 `ask_followup_question` 给三个选项（第一个是推荐）：',
      '',
      '1. **继续下一段** —— 用户选这个之后才做 ③；',
      '2. **调整队列** —— 用户改队列条目/里程碑，改完再继续（此时队列还没动，正是原样）；',
      '3. **先收在这里** —— 只把队列头部改成 `> 状态：讨论中`（钩子会停），**条目原样保留**；',
      '   **不要**写 `确认：已验收`（那等于替用户验收了）。',
      '',
      ...(blockedBefore.length > 0
        ? [
            `⚠️ 这个里程碑前面还有 **${blockedBefore.length} 条 \`[阻塞]\`**，一起在同一个弹窗里逐条问`,
            '（改描述继续做 / 直接删除 / 先留着并写"未验证"收尾）：',
            ...blockedBefore.map((entry) => `  · 第${entry.seq}/${entry.total}条 · ${fingerprint(entry.raw)}`),
            '',
          ]
        : []),
      '',
      '### ③ 只有用户选了"继续"才做这些',
      '',
      `1. 在 \`## ${ms.id}\` 小节补一行 \`- 确认：已验收 · 批次 ${batch ?? '<n>'}\`；`,
      '2. 收尾**本段**（前四步，**第 5 步先别做**——队列还要接着用）：',
      '   ⚠️ 只搬**本段已经做完的条目**（`## ' + ms.id + '` 之前的那些），',
      '   后面的 `[ ]` 还在这份队列里、**不要搬进 `DONE.md`**（它们还没发生）。',
      '',
      ...wrapSteps(false),
      '',
      '3. 跑 `node .continue/hooks/queue-init.mjs --new-batch` 拿新批次号，写进队列头部 `> 批次：`；',
      '4. **修剪队列**：把本段已完成的 `[x]` 条目删掉（它们已经进了 `DONE.md`），',
      '   **保留**里程碑小节（含刚写的确认行）和后面还没做的条目；',
      '5. 直接开始下一条，不要来问用户"要不要继续"。',
      '',
      '> 如果这是最后一个里程碑（后面没有待办了），继续之后钩子会下发正常的五步收尾，',
      '> 那时才归档队列文件（`archive-queue.mjs`）。',
      '',
      '### ⚠️ 三条不许',
      '',
      '1. **不要跳过 ①②**：关卡存在的唯一理由就是"这一段到底值不值得往下走"；',
      '2. **不要替用户写 `确认：已验收`**：那一行是"人验收过"的凭证，写它的人必须收到过答复；',
      '3. **不要在 ② 之前动队列**（删条目 / 换批次号）：用户若选"调整 / 先收"，队列必须还是原样。',
    ].join('\n'),
  );
}

const gate = pendingMilestone(queue);
if (gate) emitMilestoneGate(gate);

/**
 * 递任务的同时**把这条标成进行中**（`[ ]` → `[~]`）。
 *
 * 不依赖 AI 记得改：实测经常出现"正在做的那条还是 `[ ]`"，因为 AI 改队列的时机不稳定。
 * 而"现在在发哪一条"是钩子自己的事实，由它落盘最可靠。
 * 已经 `[~]` 的条目不会再动（`markEntryDoing` 只处理 `todo`）。
 */
if (pick && markEntryDoing(file, pick.entry)) {
  appendLog(sid, `标记进行中 · 第${pick.entry.seq}/${pick.entry.total}条 · ${fingerprint(pick.raw).slice(0, 40)}`);
}

/**
 * 没有可做的了 → 收尾。
 *
 * 两条路，判据是**有没有需要人拍板的条目**：
 *   · **没有**（全 `[x]`、每条都有验证说明）→ **自动收尾**：直接做完五步并提交，不弹窗、不等确认。
 *     收尾只是记账，问一次只是白等一轮；实测更常见的结局是用户丢下不管、队列永久挂着。
 *   · **有**（`[阻塞]`，或打完勾但缺验证 / 自述未验证、跳过）→ **必须问**。
 *     这两类人没看过就等于悄悄丢活，而 DONE / TASKS 一旦写入是既成事实，写错要回滚两份文档。
 */
if (!pick) {
  if (queue.entries.length === 0) {
    state.count = 0;
    saveState(sid, state);
    appendLog(sid, '空转 · 队列没有条目');
    emitAllow('队列里没有任何条目。没有要做的就删掉这个队列文件。');
  }

  const blocked = queue.entries.filter((entry) => entry.kind === 'blocked');
  const unproven = collectUnproven(queue);

  // 没有需要拍板的条目 → 自动收尾，不弹窗。
  if (blocked.length === 0 && unproven.length === 0) {

    if (state.autoWrapped) {
      idleAllow(
        '自动收尾指令已下发，队列文件还在',
        '自动收尾的指令上一轮已经给过了：队列文件还在说明五步没做完。照五步补完并把队列归档即可，不要来问用户。',
      );
    }
    state.autoWrapped = true;
    state.count = 0;
    saveState(sid, state);
    appendLog(sid, `自动收尾 · 完成 ${queue.counts.done} 条 · 无卡住/未验证条目`);
    emitBlock(
      [
        '[auto-continue · 自动收尾]',
        '',
        `队列里已经没有 \`[ ]\` / \`[~]\` 了：完成 ${queue.counts.done} 条，没有 \`[阻塞]\`，也没有自述未验证 / 没跑的条目。`,
        '',
        '## 现在要做的事：直接收尾，**不要弹窗问用户**',
        '',
        '收尾是把已经发生的事实搬进文档的记账动作，没有需要用户拍板的取舍。',
        '只有出现卡住（`[阻塞]`）或跳过 / 未验证的条目时才问用户——这一轮两类都没有。',
        '',
        `## ${WRAP_TITLE}（做完才停）`,
        '',
        ...WRAP_STEPS,
        '',
        '## 收尾之后',
        '',
        '1. 把 `DONE.md` / `OVERVIEW.md` / `TASKS.md` / `TIPS.md` 的改动和"队列归档（doing 里那份被移走）"**一起提交**，',
        `   commit message：\`批次 ${batch ?? '<n>'} · 收尾 · <这批做了什么>\`；`,
        '2. 回复末尾写一句"收尾已自动完成"（各步各自做了还是没做）；',
        '3. 遗留问题（`[发现]` 里没做的、判断不该做的）单独列给用户，不要顺手塞进 `TASKS.md`。',
      ].join('\n'),
    );
  }

  if (state.askedComplete) {
    appendLog(sid, '空转 · 已请用户拍板卡住/未验证的条目，等回复');
    emitAllow('已经请用户拍板卡住 / 未验证的条目了，等回复；定了之后再收尾（DONE / OVERVIEW / TASKS / TIPS / 归档队列）。');
  }

  state.askedComplete = true;
  state.count = 0;
  saveState(sid, state);
  appendLog(
    sid,
    `待用户拍板 · 完成 ${queue.counts.done} 条 / 卡住 ${queue.counts.blocked} 条 / 未验证 ${unproven.length} 条`,
  );

  emitBlock(
    [
      '[auto-continue · 等用户拍板后再收尾]',
      '',
      `队列里已经没有 \`[ ]\` / \`[~]\` 了：完成 ${queue.counts.done} 条，卡住 ${queue.counts.blocked} 条，未验证 ${unproven.length} 条。`,
      '',
      '## 需要拍板的只有下面两类，别问"要不要收尾"',
      '',
      '收尾本身会自动做。要用户定的只有这些"没人拍板就可能悄悄丢掉的活"：',
      '',
      ...(blocked.length > 0
        ? [
            `**卡住的（\`[阻塞]\`，共 ${blocked.length} 条，脚本连续 N 轮没等到完成才隔离的）：**`,
            ...blocked.map((entry) => `  · 第${entry.seq}/${entry.total}条 · ${fingerprint(entry.raw)}`),
            '',
          ]
        : []),
      ...(unproven.length > 0
        ? [
            `**做完但没能自证的（共 ${unproven.length} 条）：**`,
            ...unproven.map(
              (item) =>
                `  · 第${item.entry.seq}/${item.entry.total}条 · ${fingerprint(item.entry.raw)} · ${item.reason}`,
            ),
            '',
          ]
        : []),
      '用弹窗提问工具（CodeBuddy 叫 `ask_followup_question`，Claude Code 叫 `AskUserQuestion`）逐条问，',
      '每条给 2~4 个选项，第一个是推荐：',
      '',
      '1. **改描述继续做** —— 条目没错，只是没做完 / 没验证；',
      '2. **直接删除** —— 确认不需要了，删掉这条；',
      '3. **先留着并收尾** —— 保持现状（`[阻塞]`，或补一句"未验证"），按五步收尾，遗留问题在回复里列出。',
      '',
      `## 用户拍板之后（${WRAP_TITLE}）`,
      '',
      ...WRAP_STEPS,
      '',
      '> 拍板之前不要动 DONE.md / OVERVIEW.md / TASKS.md，也不要归档队列文件。',
    ].join('\n'),
  );
}

/**
 * 这一轮的条目身份 = **序号**（`seq`），不是正文指纹。
 *
 * 旧实现用正文前 120 字当身份，遇到两条一样的任务（`修 bug` ×2）就分不清，
 * 隔离会标到错误的条目上。序号由 `parseQueue` 按文件顺序算出，天然唯一。
 * 状态字段也顺势改名（`currentSeq`），避免和历史的 `currentFingerprint` 混淆。
 */
const firstPick = pick;
let itemSeq = firstPick.entry.seq;

// 重新开始干活 → 作废"收尾指令已下发"的记忆，下次收尾要重新下发一次。
state.askedComplete = null;
state.autoWrapped = null;
// 里程碑关卡同理：既然又开始递任务了，说明上一道关卡已经过了，下一条里程碑要重新判定。
state.msStep = null;
state.msStreak = 0;

// ---------------------------------------------------------------- 卡住就隔离
let streak = state.currentSeq === itemSeq ? (state.currentStreak ?? 0) + 1 : 1;
state.currentSeq = itemSeq;
state.currentStreak = streak;
// ⚠️ 必须每轮落盘：不存的话下一轮读回来是初始值，连续次数永远是 1，隔离永远触发不了。
saveState(sid, state);

let justBlocked = null;
if (streak >= BLOCKED_MAX) {
  markBlocked(file, itemSeq);
  appendLog(
    sid,
    `隔离 · 连续 ${streak} 轮未完成 → 标 [阻塞] · 第${itemSeq}/${firstPick.entry.total}条 · ${fingerprint(firstPick.raw).slice(0, 40)}`,
  );
  justBlocked = {
    streak,
    seq: itemSeq,
    total: firstPick.entry.total,
    text: fingerprint(firstPick.raw),
  };

  // 重置连续计数：用户将来改回 `[ ]` 时重新得到 N 次机会
  state.currentSeq = null;
  state.currentStreak = 0;
  saveState(sid, state);

  const after = readQueue(file);
  pick = pickNext(after);
  // 隔离完接着递下一条时同样打标（否则"正在做"会停在被隔离的那条上）
  if (pick) markEntryDoing(file, pick.entry);

  // 没有别的活了 → 放开，下一轮 Stop 会转入收尾（有 [阻塞] 才会请用户拍板）
  if (!pick || unfinishedCount(after) === 0) {
    state.count = 0;
    saveState(sid, state);
    appendLog(sid, '放行 · 没有别的活，等待收尾');
    emitAllow(
      `这一条连续 ${streak} 轮没做完，已标 [阻塞] 隔离。队列里没有别的待办了，` +
        '下次停下会先请你拍板这条怎么处理，再自动收尾。',
    );
  }

  itemSeq = pick.entry.seq;
  state.currentSeq = itemSeq;
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

/** 队列还长时的分阶段提醒；只在超过阈值时出现，避免小队列每轮多一行噪声。 */
const longQueueLine =
  remaining > LONG_QUEUE_HINT
    ? `> 这批还剩 ${remaining} 条。如果它其实是几个阶段拼起来的，**在队列里插一个里程碑节点**：\n` +
      '> `## 里程碑 MS1 · <名字>` + `- 验收：`<命令>`（到那儿钩子会硬停，等人工验收再往下走）；\n' +
      '> 或者做完当前阶段就收尾、跑 `node .continue/hooks/queue-init.mjs --new-batch` 拿新号开下一批。\n' +
      '> 别硬塞同一批——`DONE.md` 一节到 300 行就搬不动了。\n'
    : '';

/** 下一个还没过的里程碑：告诉 AI 它离关卡还有多远（本轮不硬停时才有意义）。 */
const upcoming = current.milestones.find((ms) => !ms.confirm && pick && ms.index > pick.entry.index) ?? null;
const milestoneLine = upcoming
  ? `> 下一个里程碑 \`${upcoming.id} · ${upcoming.title}\` 在这条之后；做到它前面的条目全部完成时，` +
    '钩子会**硬停**，要你先跑它的 `- 验收：` 命令、再问用户是否继续。本轮安心做这一条即可。\n'
  : current.milestones.length > 0
    ? '> 队列里有里程碑节点；做完它前面的条目时会硬停等人工验收，不要自己越过它。\n'
    : '';

// `firstPick` 是隔离**之前**选中的那条；隔离后 pick 可能已经换成下一条，
// 所以"是否续做 [~]"要以最终的 pick 为准，否则文案会张冠李戴。
const resumedNow = Boolean(pick && pick.resumed);

const taskLabel = pick
  ? `第${pick.entry.seq}/${pick.entry.total}条 · ${fingerprint(pick.raw).slice(0, 40)}`
  : '';
if (justBlocked) {
  appendLog(sid, `递任务（已隔离上一条）· 剩 ${remaining} 条 · ${taskLabel}${contMark}`);
} else if (resumedNow) {
  appendLog(sid, `继续进行中 · 剩 ${remaining} 条 · ${taskLabel}${contMark}`);
} else {
  appendLog(sid, `递任务 · 剩 ${remaining} 条 · ${taskLabel}${contMark}`);
}

/**
 * 「该自己决定，还是要问用户」——**每轮都注入**，与 `queue-init` 第 10 条、`README.md` §3 同源同口径。
 *
 * 为什么重写（挡的是 2026-10-23 用户反馈的那次事故："AI 明明已经有推荐结果，却停下来让我选"）：
 *   旧版这段叫 `RISK_RULE`，写的是"撞到下面**任一**情况，立刻弹窗…等用户选完再继续"，
 *   而五条里包含"**多种合理做法且取向不同**"和"**需求本身有歧义**"——这两条几乎覆盖了所有真实取舍。
 *   它**每轮**都在眼前，而"自己决定 + 记录"只写在一会话一次的 `queue-init` 注入里，
 *   README 的机制章节甚至根本没写这条规则。于是每轮的最强指令都是"必须弹窗"。
 *   这不是"没生效"，是**框架自己下了相反的命令**。
 *
 * 现在的分工（三条硬边界之外一律自己决定）：
 *   · 默认：按判断做，把取舍写进 `doing/<会话ID>-decision.md`（`audit-ids` 会校验格式）；
 *   · 只有三类必须弹窗：退不回去的动作 / 只有用户知道的信息 / 规矩要求他签字的节点；
 *   · "有多种做法""有歧义"**不再**是弹窗理由。
 */
const DECISION_FILE_REL = '.continue/doing/<会话ID>-decision.md';

const DECISION_RULE = [
  '## 该自己决定，还是要问用户（每轮都适用）',
  '',
  '**默认自己决定并留底，不要弹窗。** 怎么实现、选哪种写法、拆不拆文件、用哪个**已在依赖里**的库、',
  '命名与目录、先做哪一半——都按你的判断做。每一处**实质取舍**写进',
  `\`${DECISION_FILE_REL}\`：`,
  '',
  '```markdown',
  '## D1 · <一句话说清决策点>',
  '- 决定：选了什么',
  '- 为什么：依据是什么 / 哪里不确定（人要能复核）',
  '- 影响：改了哪些行为 / 退不退得回去',
  '```',
  '',
  '**只有下面三类必须弹窗**（`ask_followup_question` / `AskUserQuestion`，2~4 个选项、推荐项放第一）：',
  '',
  '1. **退不回去的动作**：删数据 / 改存档或数据格式 / 改公开接口 / 强制推送 / 改写已发布的东西；',
  '2. **只有用户知道的信息**：预算、外部账号、合规要求、产品取舍、他个人的偏好；',
  '3. **规矩要求他签字**：里程碑验收、`[阻塞]` 条目的处置、**增删用户提的需求**。',
  '',
  '⚠️ 下面两条**不是**弹窗理由（旧版把它们错列成"必须问"，那是错的）：',
  '- **"有多种合理做法"** → 自己选一个，把放弃的那个和理由写进「为什么」；',
  '- **"条目有歧义"** → 按最保守、最容易撤回的解释做，并记一条决策；',
  '  只有两种解释的代价**都**退不回去时，才升级成上面第 1 类。',
  '',
  '判断口诀：**"问他是为了拿到我拿不到的信息，还是只是不敢负责？"** 后者一律自己决定。',
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
  `队列：${DOING_REL}/${queueFileName(sid)}]`,
]
  .filter(Boolean)
  .join(' · ');

/**
 * 队列没声明批次号 → 必须显式告警，**不能静默拿个值糊过去**。
 * 旧设计在这里回退成"当前提交数"，结果每提交一次批次号就变一次，
 * 而 AI 完全不知道自己在用一个会漂的编号。
 */
const noBatchWarning = batch
  ? ''
  : [
      '',
      '## ⚠️ 这个队列没有声明批次号，编号不可靠',
      '',
      `队列头部缺 \`> 批次：<批次号>\`。本轮**不要**自己编一个，也不要用提交数代替——`,
      `请在队列头部补上这一行，号从 \`queue-init\` 注入里抄（形如 \`> 批次：20261022-1046\`）。`,
      '补完之后 commit message 和 `DONE.md` 都统一用它。',
    ].join('\n');

/**
 * commit message 前缀：`批次 <号> · [T12] `。
 *
 * 带需求号是框架的要求（README §0 原理 1）：ID 是提交、队列、文档之间唯一的连接点，
 * 有了它 `git log --grep '\[T12\]'` 就是这个需求的完整时间线；只带批次号的话
 * 只能按"哪一批"找，按"哪个需求"找不到。条目没挂 `T`（如 `[发现]`）就省略。
 */
const taskIds = pick ? [...new Set(pick.raw.match(/\[T\d+\]/g) ?? [])].join('') : '';
const commitPrefix = `${batch ? `批次 ${batch} · ` : ''}${taskIds ? `${taskIds} ` : ''}`;

const feedback = [
  header,
  noBatchWarning,
  '',
  `## 这一轮做这一条${resumedNow ? '（它已经标了 `[~]`，接着做完）' : ''}`,
  `  · 第 ${pick.entry.seq}/${pick.entry.total} 条：${fingerprint(pick.raw)}`,
  '',
  '> 这个 `第 N/总数` 是**条目序号**（按队列文件顺序算），本轮引用它、报进度都用它；',
  '> 它不是任务号——任务号是条目里的 `[T12]`，指向 `TASKS.md` 的需求。',
  '',
  '## 动手前（30 秒，省掉一次重新踩坑）',
  '先看 `.continue/OVERVIEW.md` 里**本条所属模块**的那一节：已经实现什么、有哪些坑；',
  '需要细节再按模块名 grep `.continue/TIPS.md`（**别整份读**，很贵）；',
  '撞到已经记过的坑，直接用上面写的处置，不要重新试错；',
  '真踩到新坑且解决了 → 现在就在 `TIPS.md` 对应模块下补一条（不必等到收尾）。',
  '',
  '## 要求',
  '1. **只做这一条**，做完就停；下一条由下一轮脚本注入。',
  '2. **标记由你自己写**：开始做这条时把 `- [ ]` 改成 `- [~]`（进行中），',
  '   做完改成 `- [x]`。`[阻塞]` 只有脚本会写，**你不要自己写，也不要手动删除它**。',
  '3. **做完先在条目下方补完成说明，再打勾**（缩进两格、普通列表，**不要用复选框**）：',
  '   做了什么 / 为什么这么做 / 怎么验证的 / 批次号。收尾时这段会原样搬进 `DONE.md`。',
  '4. 然后连同队列文件一起单独提交',
  `   （中文 commit message：${commitPrefix}改了什么 + 怎么验证的）。`,
  '5. **自测通过才算完成**：按条目里写的验证方式跑一遍（项目测试 / 断言 / 构建 / 明确的手动步骤，',
  '   具体机制由项目决定；配了 `.continue/config.json` 的 `checks.fast` 就照它跑，提交守卫还会亲自再跑一次）；',
  '   不通过就先修，**别急着把 `[~]` 改成 `[x]`**；命令跑不起来就如实写"未验证"，这条不算完成，交用户定。',
  '6. 遇到困难自己解决并把结论记下来——**只有命中「必须弹窗」的三类**才停（见本节最后），',
  '   其余取舍一律自己决定并写进 decision 文件；**不要为了"有多种做法"或"怕做错"来问用户**。',
  '7. 判断某条不该做（比如核对后发现已经实现）→ 在回复里说明理由，让用户决定',
  '   （把它删掉或改描述）；**不要自己把它改成 `[~]` 或删掉**——`[~]` 现在是"进行中"。',
  '8. **回复末尾留一行进度**：做完并提交后队列还有条目就写 `队列还剩 N 条 · 说「继续」接着做`',
  '   （宿主可能只采纳一次 Stop 反馈，这是它被丢掉时用户唯一能看到的信号；队列已空则不用写）。',
  '',
  DECISION_RULE,
  '',
  justBlocked
    ? [
        `## ⚠️ 刚有一条连续 ${justBlocked.streak} 轮没做完，已标 [阻塞] 隔离`,
        '',
        '上面「这一条」里**已经不含它**——脚本隔离了它，你现在做的是下一条。',
        '你要**在回复里如实上报**：',
        '',
        `1. **是哪一条**：第 ${justBlocked.seq}/${justBlocked.total} 条 · ${justBlocked.text}`,
        '2. **试过什么、卡在哪**（具体到报错 / 断言 / 文件行号，不要写"做不动"）；',
        '3. **给用户的三个选项**：改这条的描述继续做 / 直接删除 / 先留着后面处理。',
        '   用户会自己决定，你不要替他决定，也不要自行删除或改描述。',
        '',
        `它会被标成 \`- [阻塞] ...\`，之后不再被选中；用户处理完（改回 \`- [ ]\`）才会重试。`,
        '',
      ].join('\n')
    : '',
  blockedCount > 0 ? `> 队列里已有 ${blockedCount} 条 \`[阻塞]\`（卡住），收尾时一起交给用户确认。\n` : '',
  milestoneLine,
  longQueueLine,
  discoveredBlock,
].join('\n');

emitBlock(feedback);

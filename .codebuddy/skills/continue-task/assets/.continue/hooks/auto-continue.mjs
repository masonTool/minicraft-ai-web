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
 *   2. 刹车开着（`.continue/auto.off` 存在）；
 *   3. 本会话没有队列（纯问答会话不打扰，也不为它建日志文件）；
 *   4. 队列头部（前 5 行）是 `> 状态：讨论中`；
 *   5. 队列里没有 `[ ]` / `[~]`，且**自动收尾指令已下发过**（或已请用户拍板过）。
 *
 * 每一次 Stop 都会在日志里留痕：递任务记一条，空转放行记 `空转 · <原因>`，
 * 状态行里有累计的 `stopSeen`。没有这一层，"钩子放行了"和"钩子没跑"在日志里长得一样。
 *
 * 收尾：`[ ]` / `[~]` 都没了 → **默认自动收尾**（不弹窗、不等确认）：
 *   由 AI 把整份队列（含每条下方的完成说明）搬进 `DONE.md`、更新 `OVERVIEW.md`、
 *   把 `TASKS.md` 里对应条目改成 `[x]`、视情况补 `TIPS.md`、把队列归档到 `logs/<会话ID>/`。
 *   **只有**出现 `[阻塞]`，或"打完勾但缺验证说明 / 自述未验证、没跑"的条目时才弹窗问用户
 *   ——那两类人没看过就等于悄悄丢活。同一份队列只催一次，之后放行（否则每轮重复同一句话）。
 */

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
  loadState,
  markBlocked,
  markEntryDoing,
  milestoneComplete,
  parseBatch,
  planNameFor,
  planPathFor,
  queueFileName,
  queuePath,
  readPlan,
  readLogText,
  readPayload,
  readQueue,
  resolveEvent,
  saveState,
  sessionId,
  shortSid,
  unfinishedCount,
} from './lib.mjs';

/** 连续几轮没做完就判"卡住"。默认 5：够 AI 试错，又不至于把上下文烧光。 */
const BLOCKED_MAX = Number(process.env.CONTINUE_BLOCK_AFTER ?? 5);
const DISCOVERED_LIMIT = Number(process.env.CONTINUE_DISCOVERED_LIMIT ?? 5);

/**
 * 队列还剩这么多条时，提醒"该分阶段了"。
 *
 * 为什么需要：批次号 = 归档单元，而 `archive-done.mjs` 按批次**整节搬**。一批塞 30 条，
 * `DONE.md` 那一节自己就会超过 300 行上限，届时没有更旧的节可搬，归档退化成手工精简。
 * 所以要在队列还长的时候就提示：做完当前阶段就收尾，另开一批（`--new-batch`）。
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
    // 先判断"这个会话值不值得留痕"：有队列，或 queue-init 已经建过日志
    const tracked = readQueue(queuePath(sid)) !== null || readLogText(sid) !== null;
    const resetState = loadState(sid);
    resetState.count = 0;
    resetState.promptSeen = (resetState.promptSeen ?? 0) + 1;
    resetState.lastPromptAt = new Date().toISOString();
    saveState(sid, resetState);
    if (tracked) appendLog(sid, `收到用户消息 · 第 ${resetState.promptSeen} 次 · 轮次归零`);
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
 * 收尾五步（自动收尾与"用户拍板后收尾"共用同一段，避免两份文案分叉）。
 *
 * 这五步都是"把已经发生的事实搬进文档"，没有取舍空间——所以默认不需要人拍板。
 *
 * `keepQueue` 是**计划模式**唯一的差异：队列头部写了 `> 计划：` 时，队列是
 * "可复用的当前批次载体"，收尾后要接着装下一阶段，所以第 5 步从"删除"变成"重置"。
 * 这一步不能省成"先删了再说"：删掉之后钩子下一轮按会话 ID 找不到队列，
 * 计划链在第一批收尾处**无声断掉**——现象是"它不往下取下一批了"，没有任何报错。
 */
/**
 * 收尾五步。`keepQueue=true` 表示计划模式下队列要**重置**；`includeFifth=false` 表示
 * **先不做第 5 步**（硬停时用：用户还没拍板，此时重置队列会把"下一阶段"塞进去，
 * 用户若选"调整计划 / 先收在这里"，队列里就是一堆从没做过的条目）。
 */
function wrapSteps(keepQueue = false, includeFifth = true) {
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
    ...(includeFifth
      ? [keepQueue
      ? '5. **不要删除队列文件**：计划模式下它是"当前批次"的载体，下一阶段还要用它。' +
        ' 把 `> 批次：` 换成新号、条目整段换成下一阶段的 5~6 条。' +
        ' 删掉的话钩子下一轮按会话 ID 就找不到这个队列了，计划链在这里无声断掉。'
      : `5. **归档队列文件**（不要 \`rm\`）：跑 \`node .continue/hooks/archive-queue.mjs ${sid}\`，` +
        '   它把队列**追加**到 `.continue/logs/<会话ID>/queue.md` 的最上面（一个批次一节、`----------` 分隔），原文不会丢。' +
        '   队列原文已经整份进了 `DONE.md`，备份只是"想翻原文时还在"，不进仓库、不进提交。' +
        '   **决策记录与计划会跟着队列一起归档**，不用再单独跑 `--decision` / `--plan`。']
      : []),
    '',
    '**做完在回复里逐条回执**：五步各自"做了 / 没做（原因）"，让用户一眼看出收尾是否完整；',
    '漏掉的当场补，不要让用户自己去翻文档核对。',
  ];
}
/** 非计划模式的五步——行为与改造前**逐字一致**（自检里钉着这条）。 */
const WRAP_STEPS = wrapSteps(false);

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
    /**
     * **计划模式**：本会话存在 `doing/plan-<本会话ID>.md` 时，收尾之前先问计划"下一步是什么"。
     *
     * 绑定不靠声明、靠**文件名配对**：队列 `<sid>.md` ↔ 计划 `plan-<sid>.md`。
     * 所以这里没有"引用写错"这种状态——文件在就是有计划，不在就是没有，
     * 少了一整类"写了但读不到"的静默失效。
     *
     * 三个分支（都在"这一批的条目已经全勾完"这个时刻判定）：
     *   · 未到边界 → 续批：收尾本批（**重置队列，不删**）+ 勾阶段 + 取下一阶段；
     *   · 到边界   → **硬停**：收尾 + 勾阶段 + 跑里程碑验收 + 弹窗等开发者拍板；
     *   · 计划做完 → 正常收尾 + 归档计划（和队列同一套规则，不删）。
     *
     * "到边界"的判据是 `milestoneComplete(plan, ms, 当前阶段)` —— 即**做完这一条之后**
     * 该里程碑就齐了，所以是"完成到里程碑才停"，不是"取到里程碑就停"。
     * 少了 `alsoDone` 这个参数就会永远差一条、边界从不触发（见 lib.mjs 的注释）。
     */
    const planName = planNameFor(sid);
    const plan = readPlan(planPathFor(sid));
    const planKey = plan ? `${planName}:${plan.cursor?.id ?? 'done'}` : null;

    if (plan) {
      const step = plan.cursor;
      const ms = step ? plan.milestones.find((m) => m.id === step.ms) : null;

      /**
       * 同一把"钥匙"（计划 + 当前阶段）连续出现 = **上一轮下发的指令没有落实**。
       *
       * 为什么必须计数：队列条目有 `BLOCKED_MAX` 隔离兜底（连续 5 轮没做完就标 `[阻塞]`），
       * 而计划分支走的是"下过指令就放行"——一旦 AI 忘了勾阶段/重置队列，`planKey` 永远不变，
       * 这里就会**永久空转**：不隔离、不弹窗、不升级，连用户催一句也解不开，
       * 而现象只是"它不动了"。实测过一次，最难查的一类。
       */
      if (state.planKey === planKey) {
        state.planStreak = (state.planStreak ?? 0) + 1;
      } else {
        state.planKey = planKey;
        state.planStreak = 0;
        state.planStuck = null;
      }
      saveState(sid, state);

      /** 重复下发：先按"卡住"升级，没到阈值就照旧只放行一次。 */
      const repeatOrStuck = (reason, message) => {
        if (state.planStreak >= BLOCKED_MAX && state.planStuck !== planKey) {
          state.planStuck = planKey;
          saveState(sid, state);
          appendLog(sid, `计划卡住 · ${planKey} 连续 ${state.planStreak} 轮没推进`);
          emitBlock(
            [
              '[auto-continue · 计划卡住了，需要人看一眼]',
              '',
              `\`${planKey}\` 连续 **${state.planStreak} 轮**没有推进：指令下发过，但计划文件没变化。`,
              '',
              '**这不是"没事可做"，是上一轮该做的事没做成。**继续空转会一直停在这里、而且不会有新提示。',
              '',
              '## 现在要做的事',
              '',
              `1. 打开 \`${DOING_REL}/${planName}\` 和本会话队列，核对指令卡在哪一步`,
              '   （勾阶段？挂批次号？重置队列？写确认行？）；',
              '2. 直接把它做掉——这些记账动作不产生新事实，没有取舍空间；',
              '3. 如果连指令都读不懂，`touch .continue/auto.off` 停下并告诉用户，',
              '   **不要**把"卡住"伪装成"完成"（比如把阶段勾成 `[x]` 却什么都没做）。',
            ].join('\n'),
          );
        }
        idleAllow(reason, message);
      };

      // ---- 计划已无未完成阶段：整体收尾，队列走归档（和普通批一样）
      if (!step) {
        /**
         * **0 个阶段 ≠ 做完了**。`cursor` 为 null 有两种来源：全部勾完，或者一条阶段都没写
         * （计划刚建没填 / 阶段行漏了反引号）。后者若按"完成"处理，会**把整批悄悄收尾**：
         * 队列归档、计划归档，什么痕迹都不留——比报错糟得多。
         */
        if (plan.stages.length === 0) {
          const emptyKey = `${planKey}:empty`;
          if (state.planStep === emptyKey) {
            repeatOrStuck(
              '计划是空的，已提醒补阶段',
              `\`${planName}\` 一条阶段都没有，上一轮已经提醒过：要么补阶段，要么归档掉它。`,
            );
          }
          state.planStep = emptyKey;
          state.count = 0;
          saveState(sid, state);
          appendLog(sid, `计划为空 · ${planName} 没有任何阶段行`);
          emitBlock(
            [
              '[auto-continue · 这个计划一条阶段都没有]',
              '',
              `\`${planName}\` 里没有任何阶段行。\`cursor\` 为空有两种意思：**全部做完了**，或者**一条都没写**。`,
              '',
              '现在看起来是后者——所以**不能当成"计划已完成"收尾**（那会把整批悄悄归档，什么都不留）。',
              '',
              '## 二选一',
              '',
              '1. **计划还要用** → 按这个格式补阶段（阶段号两侧的反引号是解析锚点，漏了就不算阶段）：',
              '',
              '```markdown',
              '## MS1 · <里程碑名>',
              '- 验收：`<做完要跑的命令>`',
              '- [ ] `MS1.1` <这一阶段做什么> → 验收 `<命令>`',
              '```',
              '',
              '2. **不要计划了** → 跑 `node .continue/hooks/archive-queue.mjs ' +
                `${sid} --plan\` 把它归档，然后按普通五步收尾。`,
              '',
              '⚠️ 不要为了"让流程走下去"随手补一个假阶段——计划的价值全在阶段边界是真的。',
            ].join('\n'),
          );
        }
        /**
         * 收尾前必须有人验收过**最后一个**里程碑。
         *
         * 为什么现在才补这一条：`- 确认：已验收` 从落地起就只被**解析**、没有任何判定读它
         * （`plan.open` 是同一类死字段，已在 审1 删掉）。结果是"计划悄悄归档了，却没人跑过
         * 最后一个里程碑的验收"——而"里程碑是不是真的达成了"正是这套关卡存在的唯一理由。
         * 现在它成为整体收尾的前置条件，和"打完勾却缺 `验证：` 就请用户拍板"同一口径。
         *
         * 只查最后一个：前面的里程碑在各自边界停下时已经被要求确认过，
         * 再回头查一遍只会制造噪音（而且用户可能中途改过计划）。
         */
        const lastMs = plan.milestones[plan.milestones.length - 1] ?? null;
        if (lastMs && !lastMs.confirm) {
          const askKey = `${planKey}:last-unconfirmed`;
          if (state.planStep === askKey) {
            repeatOrStuck(
              '计划收尾缺少里程碑验收记录，已请用户拍板',
              `\`${lastMs.id}\` 还没有 \`- 确认：已验收\` 行，上一轮已经问过用户了，等回复。`,
            );
          }
          state.planStep = askKey;
          state.count = 0;
          saveState(sid, state);
          appendLog(sid, `计划完成但缺里程碑验收 · ${lastMs.id} 没有确认行`);
          emitBlock(
            [
              '[auto-continue · 计划做完了，但最后一个里程碑没有验收记录]',
              '',
              `\`${planName}\` 的阶段全部完成，但最近一个里程碑 \`${lastMs.id} · ${lastMs.title}\` 的小节里` +
                '没有 `- 确认：已验收` 行。',
              '',
              '**这意味着没人跑过这个里程碑的验收**——计划就这么归档，等于关卡白设了。',
              '',
              '## 现在要做的事',
              '',
              '1. 先判断是**漏写**还是**真的没验**，跑一遍它的验收命令：',
              ...(lastMs.acceptance.length > 0
                ? lastMs.acceptance.map((a) => `   - \`${a.replace(/`/g, '')}\``)
                : ['   - ⚠️ 这个里程碑连 `- 验收：` 都没写，先补一行能跑的命令']),
              '2. 把输出贴给用户，然后弹窗问（选项按顺序）：',
              '   **验收通过** → 在 `## ' + lastMs.id + '` 小节补 `- 确认：已验收 · 批次 ' + (batch ?? '<n>') + '`，再走到 3；',
              '   **有问题** → 把阶段改回 `[ ]` 并写清哪一条不对，按续批处理；',
              '   **先收在这里** → 队列头部改 `> 状态：讨论中`。',
              '3. **不要替用户写确认行**，也不要跳过这一步直接收尾。',
            ].join('\n'),
          );
        }
        if (state.planStep === planKey) {
          repeatOrStuck(
            '计划完成指令已下发，队列文件还在',
            '计划已经全部完成了，上一轮已经给过收尾指令。照五步补完并把队列归档即可。',
          );
        }
        state.planStep = planKey;
        state.count = 0;
        saveState(sid, state);
        appendLog(sid, `计划完成 · ${planName} 已无未完成阶段`);
        emitBlock(
          [
            '[auto-continue · 计划已全部完成]',
            '',
            `\`${planName}\` 里已经没有 \`[ ]\` / \`[~]\` 了，最后一个里程碑 \`${lastMs?.id ?? '?'}\` 也已验收。`,
            '',
            '## 现在要做的事',
            '',
            '### ① 收尾本批（五步，**这次队列要归档**）',
            '',
            ...wrapSteps(false),
            '',
            '### ② 计划同样**归档**（不要 `rm`）',
            '',
            `「已达成」那一行先同步挂进 \`OVERVIEW\` 的对应模块，然后跑`,
            `\`node .continue/hooks/archive-queue.mjs ${sid} --plan\` 把 \`${DOING_REL}/${planName}\` 归档；`,
            '和队列一样落在 `.continue/logs/<会话ID>/plan.md`（累积式，一个会话一份），',
            '想复看"当初这活是怎么排的"就去那儿——删掉就真没了。',
            '',
            '### ③ 回复里报一句',
            '',
            `"计划 ${planName} 已全部完成（${plan.milestones.length} 个里程碑，最后一个是 ${lastMs?.id ?? '?'}）"`,
          ].join('\n'),
        );
      }

      const stages = plan.stages;
      const atBoundary = milestoneComplete(plan, step.ms, step.id);
      const next = stages[stages.findIndex((s) => s.id === step.id) + 1] ?? null;

      // ---- 到边界：完成到里程碑 → 硬停，等开发者验收
      if (atBoundary) {
        if (state.planStep === planKey) {
          repeatOrStuck(
            `里程碑 ${step.ms} 已请开发者验收，等回复`,
            `\`${step.ms}\` 已经全部做完、上一轮已经请你验收并在等回复。` +
              '用户答复之前不要往下开新阶段，也不要重复弹窗。',
          );
        }
        state.planStep = planKey;
        state.count = 0;
        saveState(sid, state);
        appendLog(sid, `里程碑完成 · ${step.ms} 阶段全了 · 硬停等验收`);
        emitBlock(
          [
            `[auto-continue · 里程碑完成，停下等验收]`,
            '',
            `\`${step.ms} · ${ms?.title ?? ''}\` 的阶段全部做完了（这一批是最后一条：\`${step.id}\`）。`,
            '',
            '## 现在要做的事：记账 → 验收 → 问人 → **拿到答复才继续**',
            '',
            '⚠️ **顺序不能反**：先做 ①②③，再问用户（④），用户答"继续"之后才做 ⑤。',
            '以前是先重置队列再问——用户若选"调整计划 / 先收在这里"，队列里已经塞满了',
            '下一阶段、从没做过的条目，状态与事实不符。',
            '',
            '### ① 勾计划 + 挂批次号',
            '',
            `把 \`${step.id}\` 那行改成 \`[x]\`，并在行尾挂上批次号。形如：`,
            `- [x] \`${step.id}\` <原文> · 批次 \`${batch ?? '<n>'}\``,
            '',
            '⚠️ 阶段号两侧的**反引号是解析锚点**：漏了它这一行不会被当成阶段，',
            '阶段会从计划里**静默消失**（计划被误判成"已经做完"）。照抄上面的格式。',
            '',
            '### ② 收尾这一批（前四步，**第 5 步先别做**）',
            '',
            '把事实记账，但**先不要动队列文件**——队列留到用户拍板之后。',
            '',
            ...wrapSteps(true, false),
            '',
            '### ③ 真跑一遍这个里程碑的验收',
            '',
            ...(ms && ms.acceptance.length > 0
              ? ms.acceptance.map((a) => `- \`${a.replace(/`/g, '')}\``)
              : ['- ⚠️ 这个里程碑在小节里**没写 `- 验收：`**。现在补一行能跑的命令，再执行它。']),
            '',
            '把输出贴给用户。**跑不起来就如实写"未验证"，不要编一个结果。**',
            '',
            '### ④ 弹窗问用户',
            '',
            '用 `ask_followup_question` 给三个选项（第一个是推荐）：',
            '',
            '1. **继续下一个里程碑** —— 用户选这个之后，才做 ⑤：在 plan 的',
            `   \`## ${step.ms}\` 小节写一行 \`- 确认：已验收 · 批次 ${batch ?? '<n>'}\`，`,
            '   然后**重置队列**（`> 批次：` 换新号、条目换成下一阶段的 5~6 条）再开下一阶段；',
            '2. **调整计划** —— 用户改 plan 的阶段/里程碑，改完再继续（此时队列还没动，正是原样）；',
            '3. **先收在这里** —— 只把队列头部改成 `> 状态：讨论中`（钩子会停），**队列条目原样保留**；',
            '   **不要**写 `确认：已验收`（那等于替用户验收了）。',
            '',
            '### ⑤ 只有用户选了"继续"才重置队列',
            '',
            '`> 批次：` 换成 `node .continue/hooks/queue-init.mjs --new-batch` 给的新号，',
            '条目整段换成下一阶段的 5~6 条。**用户没答复之前，一个字都不要改队列。**',
            '',
            '### ⚠️ 三条不许',
            '',
            '1. **不要跳过 ③④**：这个关卡存在的唯一理由就是"里程碑是不是真的达成了"；',
            '   少了验收和拍板，它就只剩一句"我完成了"，防跑偏的功能等于没有。',
            '2. **不要替用户写 `确认：已验收`**：那一行是"人验收过"的凭证，写它的人必须是收到过答复的你。',
            '3. **不要在 ④ 之前动下一个里程碑**：一个字都不改。',
          ].join('\n'),
        );
      }

      // ---- 未到边界：续批（不收尾就停，而是取下一阶段继续）
      if (state.planStep === planKey) {
        repeatOrStuck(
          '续批指令已下发，等队列被重置',
          `上一轮已经下令"从 \`${planName}\` 取下一阶段了"。` +
            '把队列重置成下一阶段的条目（新批次号）即可继续，不要重复问用户。',
        );
      }
      state.planStep = planKey;
      state.count = 0;
      saveState(sid, state);
      appendLog(sid, `续批 · ${planName} · 当前 ${step.id} → 下一条 ${next?.id ?? '（没有下一条）'}`);
      emitBlock(
        [
          `[auto-continue · 这一批做完了，计划里还有下一阶段]`,
          '',
          `\`${planName}\` 的当前阶段是 \`${step.id}\`，下一个是 \`${next?.id ?? '（无）'}\`。`,
          '**不要停在这里，也不要问用户**——计划里还有没做的阶段，接着做。',
          '',
          '## 按顺序做完这三步，然后直接开始干',
          '',
          '### ① 收尾本批',
          '',
          `先看 \`.continue/DONE.md\` 里有没有 \`## 批次 ${batch ?? '<n>'}\`：有就说明收尾过了，跳过这次；`,
          '没有就按五步收尾——',
          '',
          ...wrapSteps(true),
          '',
          '### ② 勾计划',
          '',
          `把 \`${step.id}\` 那行改成 \`[x]\`，并在行尾挂上批次号。形如：`,
          `- [x] \`${step.id}\` <原文> · 批次 \`${batch ?? '<n>'}\``,
          '',
          '⚠️ 反引号不能漏：它是"这一行是阶段"的解析锚点，漏了会让这个阶段从计划里消失，',
          '后面的游标直接跳到下一条（计划会被误判成"做完了"）。',
          '',
          '### ③ 取下一阶段、拆条目、重置队列',
          '',
          ...(next
            ? [
                `1. 读 \`${next.id}\` 那一行的描述和行尾的「验收」命令，把它改成 \`[~]\`（计划里同一时间只有一条 \`[~]\`）；`,
              ]
            : [
                '1. ⚠️ 计划里已经没有下一条阶段了，但这一批做完了：回到计划头部核对，',
                '   是不是漏写了阶段（这种情况先别开新批，把缺的阶段补进 plan）；',
              ]),
          '2. 按它拆 **5~6 条可独立验证的条目**（一条一个提交；超过 8~12 条说明这一阶段还得再切）；',
          '3. 跑 `node .continue/hooks/queue-init.mjs --new-batch` 拿新批次号，',
          '   写进队列头部 `> 批次：`；`> 计划：` 那一行**保留不动**；',
          '4. 条目整段换成新阶段的那几条，然后**直接开始做第一条**，不要来问用户"要不要继续"。',
        ].join('\n'),
      );
    }

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
        '## 五步都要做完（做完才停）',
        '',
        ...WRAP_STEPS,
        '',
        '## 收尾之后',
        '',
        '1. 把 `DONE.md` / `OVERVIEW.md` / `TASKS.md` / `TIPS.md` 的改动和"队列归档（doing 里那份被移走）"**一起提交**，',
        `   commit message：\`批次 ${batch ?? '<n>'} · 收尾 · <这批做了什么>\`；`,
        '2. 回复末尾写一句"收尾已自动完成"（五步各自做了还是没做）；',
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
      '## 用户拍板之后（五步都要做完）',
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
// 计划模式下同理：队列重新有了条目，说明续批/验收已经推进过，下一道关卡要重新判定。
state.planStep = null;

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
    ? `> 这批还剩 ${remaining} 条。如果它其实是几个阶段拼起来的，做完当前阶段就收尾，再跑 ` +
      '`node .continue/hooks/queue-init.mjs --new-batch` 拿新号开下一阶段——别硬塞同一批' +
      '（`DONE.md` 一节到 300 行就搬不动了）。\n'
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
  '6. 遇到困难自己解决并把结论记下来——**除非命中下面五条风险**，那时必须弹窗。',
  '7. 判断某条不该做（比如核对后发现已经实现）→ 在回复里说明理由，让用户决定',
  '   （把它删掉或改描述）；**不要自己把它改成 `[~]` 或删掉**——`[~]` 现在是"进行中"。',
  '8. **回复末尾留一行进度**：做完并提交后队列还有条目就写 `队列还剩 N 条 · 说「继续」接着做`',
  '   （宿主可能只采纳一次 Stop 反馈，这是它被丢掉时用户唯一能看到的信号；队列已空则不用写）。',
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
  longQueueLine,
  discoveredBlock,
].join('\n');

emitBlock(feedback);

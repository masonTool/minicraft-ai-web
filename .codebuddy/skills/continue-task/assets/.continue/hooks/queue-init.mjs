#!/usr/bin/env node
/**
 * UserPromptSubmit 钩子 · 会话初始化（每个会话只注入一次）
 *
 * 做三件事：
 *   1. 把「会话 ID + 本会话队列路径 + 队列协议」注入给 AI；
 *   2. 列出**其他会话的未完成队列**，但明确要求"不要擅自接管，先问用户"（用户选的 B 方案）；
 *   3. 之后每条消息都静默放行。
 *
 * 两个必须跳过的输入，否则会变成"每轮都重置一次"的死循环：
 *   · 钩子自己回灌的反馈（Stop 的 stderr 会作为一条新的 UserPromptSubmit 回来）；
 *   · 本会话已经注入过（记在 `.logs/<sid>.md` 的 `<!-- s:init … -->` 状态行里）。
 */

import { existsSync, statSync } from 'node:fs';
import {
  setLogTag,
  ACTIVE_WINDOW_MIN,
  adoptTodoHandoff,
  adoptWorktreeHandoff,
  isInsideWorktree,
  isSessionActive,
  PROJECT_ROOT,
  DOING_DIR,
  DOING_REL,
  appendLog,
  nextBatch,
  emitAllow,
  listQueues,
  loadState,
  migrateLegacyLayout,
  parseBatch,
  protocolFingerprint,
  queueFileName,
  queuePath,
  readPayload,
  readQueue,
  readTodo,
  resolveEvent,
  saveState,
  sessionId,
  TODO_CONTEXT_NAME,
  TODO_QUEUE_NAME,
  TODO_REL,
  unfinishedCount,
  WORKTREE_HANDOFF_NAME,
  worktreeConfig,
  writeFd,
} from './lib.mjs';

/**
 * 手动取一个**新批次号**：`node .continue/hooks/queue-init.mjs --new-batch`
 *
 * 为什么需要（挡的是哪个结构缺口）：批次号只在会话**第一次**收到消息时注入一次，
 * 于是"长任务做完一个阶段 → 收尾 → 再开下一阶段"时，AI 拿不到新号，只能沿用旧号，
 * 整条长任务被动压成一个批次：`DONE.md` 一节越滚越大，而 `archive-done.mjs` 按批次
 * **整节搬**，一节自己超 300 行就搬不动（只能手工精简）；`OVERVIEW.md` 的批次索引
 * 也会退化成"一大坨改了哪些模块"，失去信息量。
 *
 * 号仍然由脚本生成：`nextBatch()` 会扫 `DONE.md` 与 `doing/` 判重、撞号顺延一分钟。
 * 协议里明确禁止 AI 自己编号——编号必须是"派生得到且唯一"的。
 *
 * 放在最前面：手动调用时没有 payload、也没有 stdin，不能先等 `readPayload()`。
 */
if (process.argv.includes('--new-batch')) {
  writeFd(1, `${nextBatch()}\n`);
  process.exit(0);
}

const payload = readPayload();
const event = resolveEvent(payload);
setLogTag('queue-init', event);

if (event !== 'UserPromptSubmit') emitAllow();

const sid = sessionId(payload);
if (!sid) emitAllow();

/**
 * 对齐老版本的目录 / 文件名（`queues/` → `doing/`、`EXPERIENCE.md` → `TIPS.md`）。
 *
 * 放在闸门**之前**：即使本会话已经注入过、下面会静默放行，也要先把磁盘布局摆正——
 * 否则老项目升级后队列还躺在 `queues/` 里，钩子读 `doing/` 读不到，表现成"不递任务了"。
 * 幂等，已迁移过的项目在这里什么都不做。
 */
const migrated = migrateLegacyLayout();

const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';

// ① 钩子回灌的消息：内容里带轮次标记，说明这是 auto-continue 递进来的任务，不是用户说话。
//    这里刻意不写日志——它每轮都会命中，记下来只会把关键事件淹掉。
if (/auto-continue\s*第\s*\d+\s*轮/.test(prompt)) emitAllow();

// ② 本会话已经注入过 → 静默；**但框架被换过就再注入一次**。
// 状态文件用 'init' 命名空间：UserPromptSubmit 上 auto-continue 也会写状态，
// 两个进程并行整份覆盖同一个 JSON 会互相抹字段。
/**
 * **协议指纹**（`lib.mjs` 的 `protocolFingerprint()`：hooks 内容哈希）。
 *
 * 为什么不能"注入过一次就永远静默"（2026-10-24 用户实测的事故）：技能升级 + 重跑安装器后，
 * 钩子文件已经换新，而本会话的上下文里还是**旧协议**（旧路径 / 旧收尾步数 / 旧的合并要求）。
 * AI 照着旧协议把队列写到新钩子不读的位置，或做完多跑一步合并——**全程没有任何报错**，
 * 用户看到的是"队列生成了却不动"。所以协议一变，这里必须重新注入一次，
 * 并明确告诉 AI"早先那段已经过期"。
 */
const protocol = protocolFingerprint();
const state = loadState(sid, 'init');
const staleProtocol = Boolean(state.initialized) && state.protocol !== protocol;
if (state.initialized && !staleProtocol) emitAllow();
if (staleProtocol) appendLog(sid, `协议已变更（${state.protocol ?? '未知'} → ${protocol}）：重新注入`);

state.initialized = true;
state.startedAt = state.startedAt ?? new Date().toISOString();
state.protocol = protocol;
if (staleProtocol) state.reinjectedAt = new Date().toISOString();
saveState(sid, state, 'init');

/**
 * 接管收件箱（新流程）：主工作区的 `todo/queue.md` → 本会话队列。
 *
 * **只在工作树里接管**，主工作区一律不碰：
 *   · 主工作区是"规划区"，todo 刚刚写下、等 Stop 派发；在这里接管等于把执行拉回主树，
 *     规划/执行分离当场破功（而且重启一次会话就会发生）；
 *   · 已经派发过的 todo 更不该回主树——树都建好了，去那个窗口接管才对。
 *
 * 为什么排在 `worktree.md` 之前：todo 是这条链的新凭据，`worktree.md` 是手工
 * `worktree.mjs` 的旧凭据；两条链不会同时产出，但 todo 更新，先认它能让旧凭据残留时仍走新流程。
 *
 * **必须早于所有读队列的逻辑**：接管之后 `existingQueue` / 批次号才有东西可读。
 */
const inWorktree = isInsideWorktree();
const todoHandoff = inWorktree ? adoptTodoHandoff(sid) : null;

/**
 * 接管待接管队列：`doing/worktree.md` → `doing/<sid6>.md`（`worktree.mjs` 建树时写的那份）。
 *
 * 必须先于下面所有「列队列」的逻辑：改名之前它是个不在会话命名规则里的文件，
 * 改名之后它才是**本会话的队列**（`existingQueue` 与批次号都要靠它）。
 */
const handoff = adoptWorktreeHandoff(sid);

// ---------------------------------------------------------------- 其他会话的未完成队列

const others = listQueues()
  /**
   * `listQueues()` 已经排掉了决策记录与历史遗留的旧计划文件（`<sid>-plan.md`），
   * 这里只剩真正的会话队列——不会再把别人的"计划"当成未完成队列来催接管。
   */
  .filter((item) => item.sid !== sid)
  .map((item) => {
    const queue = readQueue(item.file);
    let mtime = '';
    try {
      mtime = new Date(statSync(item.file).mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      mtime = '';
    }
    return { ...item, left: unfinishedCount(queue), mtime, active: isSessionActive(item.sid) };
  })
  .filter((item) => item.left > 0)
  .slice(0, 5);

/**
 * 「别的会话还有未完成队列」这一段，只在**本会话还没有队列**时出现。
 *
 * 为什么加这个前提：本会话已经在做自己的队列时，别人的队列与它无关，
 * 提一句只会诱导 AI 去接管/分心；而这条提示每次会话启动都会出现，
 * 频率高到足以改变行为（见 TIPS「同一策略写在两处、频率不同」）。
 *
 * 为什么按活跃度分档：一份 5 分钟前还在写日志的队列，和一份停在昨天的队列，
 * 处置方式完全相反——前者要并行（开工作树），后者才轮到"接管/忽略"。
 * 旧版把两者写成同一句"先问用户"，于是"正在跑"的场景被引导成"要不要接管"。
 */
const hasOwnQueue = existsSync(queuePath(sid));
const activeOthers = others.filter((item) => item.active);
const othersBlock =
  others.length > 0 && !hasOwnQueue && !inWorktree
    ? [
        '',
        '## ⚠️ 其他会话还有未完成队列（**不要擅自接管**）',
        '',
        ...others.map(
          (item) =>
            `- \`${DOING_REL}/${item.sid}.md\` · 剩 ${item.left} 条 · 最近更新 ${item.mtime}` +
            (item.active ? ` · 🟢 ${ACTIVE_WINDOW_MIN} 分钟内有写入（可能还在跑）` : ' · ⚪ 已停（可接管）'),
        ),
        '',
        ...(activeOthers.length > 0
          ? [
              '**你要开工新任务、而上面还有活跃会话时：不要在同一棵树里干**，开一棵工作树并行：',
              '',
              '```bash',
              'node .continue/hooks/worktree.mjs <单词> --task="<一句话任务>"',
              '```',
              '',
              '`<单词>` 由你按这一批的需求取一个英文词（`export` / `auth` / `perf` 这类，2~16 位）；',
              '目录与分支都叫 `worktree_<单词>_<YYYYMMDD>`（日期脚本自己加，不用你写）。',
              '它会在 `.continue/doing/.worktree/worktree_<单词>_<YYYYMMDD>` 建树、写好交接队列，并尝试拉一个新窗口；',
              '**必须在新路径里另开会话**（钩子按 cwd 读写，原会话里跑等于没隔离）。',
              '树里的第一个会话会自动把 `doing/worktree.md` 改名接管，任务不用再粘贴一遍。',
              '',
            ]
          : []),
        '处理规则（对**已停**的那些）：**先问用户**（弹窗：接管 / 只读参考 / 忽略）。',
        '用户同意接管后，把那边未完成的条目搬进本会话队列，再删除原队列文件；',
        '没同意就一律不碰——同一份队列被两个会话同时改会导致条目状态错乱。',
      ].join('\n')
    : '';

/**
 * 树里为什么要单独说一句：`doing/` 里那些队列确实存在（随 HEAD 检出带过来的），
 * 但一条都不该被当成"这棵树的任务"。不说清，AI 会怀疑"注入是不是漏了"，
 * 转而手工去读父树的队列——那正是把两棵树的任务混在一起的开端。
 */
const treeNote =
  inWorktree && others.length > 0
    ? [
        '',
        '## ℹ️ 这是一棵并行工作树',
        '',
        `\`doing/\` 里另有 ${others.length} 份队列，它们属于父树 / 祖先树（随 HEAD 检出带过来的），` +
          '**不是本树的任务**，已忽略。本树只认自己的 `<会话 ID 前 6 位>.md`。',
      ].join('\n')
    : '';

/**
 * 待接管队列（`doing/worktree.md`）的处理结果，写进注入。
 *
 * 三种结果都要说出来，没有一种可以静默：
 *   · 已接管 → 告诉它"任务已经在你的队列里，别重建"（否则 AI 会再建一份，覆盖交接）；
 *   · 冲突   → 两条并存时**不覆盖**，交给人工合并（自动覆盖等于丢进度）；
 *   · 失败   → 给出可照抄的命令（改名失败时文件还在原名下，下次会话还能接上）。
 */
const handoffBlock = (() => {
  if (handoff?.renamed) {
    return [
      '',
      `## 📥 已接管交接队列 → \`${DOING_REL}/${handoff.target}\``,
      '',
      '父会话建树时写下的任务已经在你的队列里了：**接着做，别重建队列、别改批次号**。',
    ].join('\n');
  }
  if (handoff?.conflict) {
    return [
      '',
      '## ⚠️ 待接管队列与本会话队列同时存在（没有自动覆盖）',
      '',
      `\`${DOING_REL}/${WORKTREE_HANDOFF_NAME}\`（父会话的交接）和 \`${DOING_REL}/${handoff.target}\`（本会话）都在。`,
      '先把两份内容合并成一份、删掉另一份，再开工——两条并行会让条目状态互相错乱。',
    ].join('\n');
  }
  if (handoff?.error) {
    return [
      '',
      `## ⚠️ 待接管队列改名失败：${handoff.error}`,
      '',
      `手工执行：\`git mv ${DOING_REL}/${WORKTREE_HANDOFF_NAME} ${DOING_REL}/${queueFileName(sid)}\`，`,
      '再把第一行的会话 ID 改成**完整**会话 ID（`audit-docs` 会核对"前 6 位 == 文件名"）。',
    ].join('\n');
  }
  return '';
})();

/**
 * 收件箱（`todo/`）的处理结果，写进注入。四种结果都不能静默：
 *   · 已接管 → 附上 context 全文（截断到 6KB，全文在 `.logs/<sid>/handoff.md`）；
 *   · 冲突   → 本会话已有队列，收件箱那份**没动**，交给人合并；
 *   · 失败   → 给手工命令，收件箱内容还在，下次会话还能接上；
 *   · 有内容但没接管（主工作区刚写完 / 被别的会话抢了）→ 说清该去哪干活。
 */
const todoHandoffBlock = (() => {
  if (todoHandoff?.adopted) {
    const context = (todoHandoff.context ?? '').trim();
    const clipped = context.length > 6000;
    return [
      '',
      `## 📥 已接管收件箱 → \`${DOING_REL}/${todoHandoff.target}\``,
      '',
      '主工作区交给你的任务已经在你的队列里：**接着做，别重建队列、别改批次号**。',
      ...(todoHandoff.batch ? [`批次号沿用 \`${todoHandoff.batch}\`。`] : []),
      ...(context
        ? [
            '',
            '### 交接上下文（主工作区写下的讨论结论，原文在 `.logs/<本会话前 6 位>/handoff.md`）',
            '',
            '````markdown',
            clipped ? `${context.slice(0, 6000)}\n…（已截断，全文看 logs）` : context,
            '````',
          ]
        : ['', `收件箱里没有 \`${TODO_CONTEXT_NAME}\`：上下文只能从队列条目推，缺的先问用户。`]),
    ].join('\n');
  }
  if (todoHandoff?.conflict) {
    return [
      '',
      '## ⚠️ 收件箱待派发队列与本会话队列同时存在（没有自动覆盖）',
      '',
      `主工作区的 \`${TODO_REL}/${TODO_QUEUE_NAME}\` 还在，而本会话已经有 \`${DOING_REL}/${todoHandoff.target}\`。`,
      '先把两份合并成一份、再删掉收件箱那份，否则同一批任务会被两个会话各做一遍。',
    ].join('\n');
  }
  if (todoHandoff?.error) {
    return [
      '',
      `## ⚠️ 收件箱接管失败：${todoHandoff.error}`,
      '',
      `内容仍在 \`${TODO_REL}/${TODO_QUEUE_NAME}\`；手工搬进 \`${DOING_REL}/${queueFileName(sid)}\`，`,
      '并把首行会话 ID 改成**完整**会话 ID。',
    ].join('\n');
  }
  const pending = readTodo();
  if (!pending) return '';
  const tree = pending.state?.tree;
  /**
   * 比**路径**而不是比 sid：`listQueues()` 给的是文件名（sid 前 6 位），
   * 拿它跟完整会话 ID 比永远不等——本会话自己的队列会被当成"别人在跑"，
   * 于是注入说"Stop 会建树"，而 `dispatch` 的守卫又说"本会话已在干、不派发"：两边打架。
   */
  const othersRunning = listQueues().some((item) => item.file !== queuePath(sid));
  return [
    '',
    '## 📮 收件箱里还有一份待派发队列',
    '',
    `\`${TODO_REL}/${TODO_QUEUE_NAME}\` 有内容${pending.context.trim() ? `（另有 \`${TODO_CONTEXT_NAME}\`）` : ''}。`,
    ...(tree && existsSync(tree)
      ? [
          `已经派发到执行树：\`${tree}\`（分支 \`${pending.state.branch}\`）。**去那个窗口干活**，不要在这棵树里开工。`,
        ]
      : othersRunning
        ? ['Stop 时会自动基于 HEAD 建工作树并拉新窗口；**不要覆盖它**，也不要在这棵树里开工。']
        : [
            `但 \`${DOING_REL}/\` 里没有别的会话队列——**交接不触发**（\`dispatch\` 只在有别人在跑时才建树）。`,
            `把这份内容搬进 \`${DOING_REL}/${queueFileName(sid)}\`（首行会话 ID 换成本会话完整 ID），`,
            `然后删掉 \`${TODO_REL}/\` 里的文件，在本会话直接干完。`,
          ]),
  ].join('\n');
})();

/**
 * 批次号：`YYYYMMDD-HHmm` 时间戳，开工这一刻生成，**本批恒定不变**。
 *
 * 为什么不用"开工时的提交总数"（旧设计）：提交数会撞（两个会话同点开工拿到同一个号，
 * 本项目实测出现过两个「批次 1」）、会漂（没写就回退，提交一次变一格）、
 * 语义也不对（提交数是"第几个提交"，批次是"第几批改动"）。
 *
 * 时间戳唯一、可排序、零维护。已被占用时 `nextBatch()` 自动顺延一分钟，不会撞。
 */
/**
 * 已有的队列**必须沿用它的批次号**：`nextBatch()` 生成的是"新批次"。
 * 同一份队列续做时换了号，`DONE` / `OVERVIEW` / commit message 会被拆成两批，
 * 而"一批一个号、恒定不变"正是收尾与 `git log --grep` 的前提。
 */
const existingQueue = existsSync(queuePath(sid)) ? readQueue(queuePath(sid)) : null;
const batch = (existingQueue && parseBatch(existingQueue.text)) ?? nextBatch();


const injection = [
  ...(staleProtocol
    ? [
        '【continue-do · ⚠️ 框架已升级：本会话早先收到的协议作废】',
        '',
        '本会话启动之后，`.continue/hooks/` 被换成了新版本（协议指纹变了）。',
        '**你之前在这个会话里读到的协议 / 技能说明已经过期**，两边冲突时一律**以本次注入为准**：',
        '',
        '- 队列、收件箱、归档的**路径与文件名**以本次注入为准（旧路径可能已经不读了）；',
        '- 收尾步数、合并要求以本次注入为准（旧版要求"合回父分支"的，现在已经取消）；',
        '- 如果本会话已经按旧协议写了队列，先 `ls .continue/doing/` 核对真实文件名，',
        '  **改名搬进下面这个路径**，不要重建一份（重建会丢已写好的条目）；',
        '- 钩子注册在会话启动时拍快照：**新版本新增的钩子本会话不会跑**。',
        '  会话里出现"该动却没动"的现象时，让用户重启会话，别自己猜机制坏了。',
        '',
      ]
    : []),
  '【continue-do · 会话初始化】',
  '',
  `- 会话 ID：\`${sid}\``,
  // 会话重启后同一个 sid 可能已经有队列（上一轮建的）→ 说"尚未创建"会让 AI 覆盖掉进度。
  `- 本会话队列：\`${DOING_REL}/${queueFileName(sid)}\`${existsSync(queuePath(sid)) ? '（**已存在，接着做，别重建**）' : '（**尚未创建**：文件名必须精确等于这个，**不要用完整会话 ID**）'}`,
  `- 批次号：\`${batch}\` —— **一批一个号，开工定下就不再变**（时间戳，天然唯一）`,
  `- 机制说明：\`.continue/README.md\`（文件分工 / 编号 / 队列格式 / 收尾流程）`,
  `- 项目根：\`${PROJECT_ROOT}\``,
  ...(migrated.length > 0
    ? ['', '## 已自动对齐旧版布局（本次会话首次启动时做的，幂等）', '', ...migrated.map((note) => `- ${note}`)]
    : []),
  '',
  '## 队列协议（必须遵守）',
  '',
  /**
   * 交接模式只对**主工作区**说：树里就是执行区，照常规协议干活；
   * `worktree.auto=false` 时也不说，否则 AI 会写出没人派发的队列、然后停在那里。
   *
   * **条件写进正文**：这个模式只在"`doing/` 里已经有别的会话在跑"时触发。
   * 空树时也甩一段"写 todo、停手"的指令，AI 会把本来一条命令能做完的事拆成
   * "建树 + 新窗口 + 接管"，用户每次都得关掉一个多余窗口。
   */
  ...(isInsideWorktree() || !worktreeConfig().auto
    ? []
    : [
        '## 交接模式（**只在 `doing/` 里已经有别的会话队列时**）',
        '',
        `现在 \`${DOING_REL}/\` 里${others.length > 0 ? '**有**别的会话的未完成队列' : '**没有**别的会话队列'}。`,
        '',
        ...(others.length > 0
          ? [
              '这时你只做规划，执行放到独立工作树里。用户确认要做之后：',
              `1. 把**整份队列**写进 \`${TODO_REL}/${TODO_QUEUE_NAME}\`（格式与下面的队列完全一致：头部状态 / 批次、条目），`,
              '   并在 `> 批次：` 那行下面**加一行** `> 树名：<单词>` —— 单词由你按这一批的需求取（`export` / `auth` / `perf` 这类英文词，2~16 位）；',
              '   执行树与分支都会叫 `worktree_<单词>_<YYYYMMDD>`（日期由钩子加）。不写也能派发，但树名会退化成 `worktree_task_<日期>`；',
              `2. 把这一轮上下文用中文写进 \`${TODO_REL}/${TODO_CONTEXT_NAME}\`（目标、已定方案、否决过的方案、关键文件、验收方式）；`,
              '3. **停手**：不建 `doing/<sid>.md`、不改业务代码。Stop 钩子会基于 HEAD 建',
              `   \`${DOING_REL}/.worktree/worktree_<单词>_<YYYYMMDD>\` 并拉新窗口，新窗口的第一个会话自动接管队列与上下文，那时才开工。`,
              `收件箱已有内容时不要覆盖——先停手让它派发，或问用户。`,
            ]
          : [
              '没有人在跑，**不要走交接**：按下面的常规协议直接建 `doing/<sid>.md`，在本会话把活干完。',
              '多开一个窗口只会把"一条命令能做完的事"拆成两步。',
              '（用户明确说"开个树并行做"时才用 `node .continue/hooks/worktree.mjs <单词>`。）',
            ]),
        '',
      ]),
  '1. **写队列 = 规划，干活由钩子注入**。讨论阶段不要建队列；',
  '   只有用户明确要做某事、且你能把它拆成"可独立验证、能单独提交"的条目时，才创建队列文件。',
  '   **一棵树上只有一个会话在干活**：`doing/` 里已有别的会话队列时，按上面的交接模式写 todo、交给新树；',
  '   也可以自己起名字手工开树：`node .continue/hooks/worktree.mjs <单词>`（目录与分支都是',
  '   `worktree_<单词>_<YYYYMMDD>`），**然后在那个新路径另开会话**',
  '   （钩子按 cwd 判断读写哪棵树，在原会话里跑等于没隔离）。',
  '   **收尾不合并**：工作树里这一批做完、文档收尾提交完就结束了；',
  '   `rebase` / `merge` / 删树都由用户自己处理，框架既不自动做、也不要你顺手做。',
  '2. **四态标记，三个由你写**（与参考项目一致）：',
  '   `- [ ]` 待办（规划时写）· `- [~]` **进行中**（**钩子递给你时已自动标好，别自己改**）·',
  '   `- [x]` 完成（做完写）。',
  '   `- [阻塞]` **只有钩子会写**（连续 5 轮没做完就隔离），你不要写、也不要删。',
  '   判断某条不该做 → 在回复里说明理由交给用户决定，',
  '   **不要蹭 `[~]` 假装做完了**（它表示"进行中"，不是"跳过"）。',
  '3. 队列格式（文件名必须是上面那个路径，钩子靠会话 ID 推导，改名就读不到）：',
  '',
  '```markdown',
  `# 队列 · 会话 ${sid}`,
  '',
  '> 状态：执行中',
  '> 创建：YYYY-MM-DD',
  `> 批次：${batch}`,
  '',
  '- [ ] [T1] <一句话说清做什么>：<改哪个文件> → <怎么验证（写成能跑的命令或断言）>',
  '- [ ] [T2] …',
  '```',
  '',
  '   - 只想先和用户确认方案、还不想开工：把 `> 状态：执行中` 写成 `> 状态：讨论中`，钩子就不会递任务。',
  '     这一行只在**文件头部 6 行**内有效，正文里提到这几个字不影响。',
  '   - 确认开工后，把那一行改回 `> 状态：执行中`。',
  `   - \`> 批次：\` 抄上面给的值。**这个号在整批里恒定**，一批提交三次也还是同一个号`,
  '     （钩子只读这一行；**缺了它钩子不会替你猜**，会明确告警要求补上）。',
  '     收尾时写进 `DONE.md` 标题与 `OVERVIEW.md` 条目，形如 `## 批次 20261022-1046 · 2026-10-22 · 会话 xxxxxxxx`。',
  '     **标题里不要写 `提交 n→m`**（`m` 会因收尾提交自身而永远追不上，是自指死结）。',
  '   - 条目号不用手写：钩子每轮会告诉你"第 N/总数 条"，那是按文件顺序算的序号。',
  '4. **每条任务做完，先在条目下方就地写完成说明，再改成 `[x]`**',
  '   （缩进两格、用普通列表，**不要用复选框**——`- [ ]` 会被解析成新任务）：',
  '',
  '```markdown',
  '- [x] [T1] 给设置页加导入导出：`src/settings/io.ts` → `npm test` 全绿',
  '  - 做了什么：抽出 exportSettings() / importSettings()，旧的内联逻辑删掉',
  '  - 为什么：导入要校验 schema，散在组件里得改三处才能对齐',
  '  - 验证：`npm test` 12 条通过；手点了一遍导入旧版本配置文件',
  `  - 批次：${batch}`,
  '```',
  '',
  '   写清"怎么做的 / 为什么这么做 / 怎么验证的"。这段收尾时**原样搬进 `DONE.md`**；',
  '   不写就得在收尾时凭记忆补，也正是要避免的事。',
  '   **`验证` 是完成的凭证**：自测没通过、或命令没跑起来，就不要把条目改成 `[x]`；',
  '   项目怎么自测由项目自己定——配了 `.continue/config.json` 的 `checks.fast` 就照它跑。',
  '5. 钩子一次只递**一条**，你一次也只做一条。',
  '6. `[ ]` / `[~]` 都没有了 → 钩子下令**自动收尾**，按顺序做完这五步',
  '   （**不要弹窗问"要不要收尾"**——收尾是记账，没有取舍空间）：',
  '   ① 整份队列**原样**写进 `.continue/DONE.md`（含每条下方的完成说明与 `[阻塞]`，',
  '      标题带 `批次 n`，**不要写 `提交 n→m`**），不再二次总结；',
  '   ② 更新 `.continue/OVERVIEW.md`：完成项按模块挂 `T` 编号 + 批次号，批次索引加一行；',
  '      这批新踩的坑在对应模块下加一行摘要（细节仍写在 `TIPS.md`）；',
  '   ③ 整份队列在 `TASKS.md` 里落地（已有条目改 `[x]`；当场任务补到**项目的已完成分节**——',
  '      默认 `C. 已完成`；若项目是 A~O 之类自己的分节，就落在它自己的「当场任务」节）；',
  '   ④ 自问一次「这轮有没有会重复踩的坑」→ 有就补 `.continue/TIPS.md`（按模块分节）；',
  '      门槛：调很久才定位 / 改了 A 红了 B / 工具隐蔽默认值。语法记错、漏读文档导致的误判',
  '      不算坑——写进去会稀释真正有价值的条目，**宁可少写**；',
  '   ⑤ **归档**队列文件：跑 `node .continue/hooks/archive-queue.mjs <本会话ID>`，',
  '      它把队列**追加**到 `.continue/.logs/<会话ID>/queue.md` 的最上面（一个批次一节、`----------` 分隔），',
  '      原文不会丢（**不要 `rm`**）。',
  '   **例外**：队列里有 `[阻塞]`，或有打了 `[x]` 却缺 `验证` 说明 / 自述"未验证、跳过"的条目，',
  '   钩子会先让你弹窗逐条问用户（改描述继续做 / 直接删除 / 先留着并收尾）——那类拍板之前不要动这五样。',
  '   边界：用户新提的需求当场落成 `- [ ] T<n>` 并编号（递增、永不复用），收尾只补 `[x]`，',
  '   **不自创需求**；`OVERVIEW` / `TIPS` 没内容就跳过，**不写占位**。',
  '7. 目录分工：`.logs/<会话ID>/` 放本会话的运行日志（`run.md`）与**归档**（`queue.md` / `decision.md`，一个会话一份、累积式），',
  '   **已 gitignore**：不要提交、不要改；想翻"当时队列原文怎么写的"就去那儿看）；',
  '   `doing/` 里住着两类文件：**会话队列**（`<session_id>.md`）与**决策记录**（`decision-<session_id>.md`），\n' +
  '   后者按会话 ID 与队列同名配对，连同 `TASKS.md` / `DONE.md` / `OVERVIEW.md` / `TIPS.md` / `README.md` 都是要 review 的文档；',
  '   `OVERVIEW.md` = 按模块的实现 + 坑摘要（做某个模块前先看它）；',
  '   `TIPS.md` = 坑的细节（按模块分节，要细节再 grep）。',
  '8. **一批多长看行数，不看条数**：判据是「预计这批的完成说明（每条 4~6 行）超过 ~80 行」',
  '   或「队列本身 > 500 行」或「这一阶段的目标变了」——**条数只是经验值**（通常 8~12 条），',
  '   不是上限。想再往里塞就说明该拆阶段了。同一会话里要拿新批次号跑：',
  '   `node .continue/hooks/queue-init.mjs --new-batch`（**不要自己编号**）。',
  '9. **长任务在队列里插里程碑节点**（不另建计划文件）：如果任务预计 > 16 条、或能明显切成几段，',
  '   在**同一份队列**里每 8~12 条之后插一个节点：',
  '',
  '```markdown',
  '## 里程碑 MS1 · <里程碑名>',
  '- 验收：`<这一段做完要跑的命令>`',
  '```',
  '',
  '   - 里程碑是**队列里的一个位置**，不是第二份进度文件：顺序、批次、完成状态都只有一份；',
  '   - 走到它（前面的条目全 `[x]`）时钩子**硬停**：要你跑它的 `- 验收：` 并把结果贴出来，',
  '     再弹窗问用户"继续下一段 / 调整队列 / 先收在这里"；',
  '   - 只有用户答复"继续"之后，才在该小节补 `- 确认：已验收 · 批次 <号>`、收尾本段、换新批次号、',
  '     删掉已完成的条目，然后接着往下做。**替用户写确认行 = 自己给自己验收**；',
  '   - 最后一个里程碑验收完，钩子会下发正常的五步收尾（这时才归档队列文件）。',
  '10. **该自己决定，还是要问用户**（与每轮注入同一套口径，两处必须一致）：',
  '    **默认自己决定并留底，不要弹窗**——怎么实现、选哪种写法、拆不拆文件、用哪个**已在依赖里**的库、',
  '    命名与目录、先做哪一半，都按你的判断做。每一处实质取舍写进 `doing/<本会话ID>-decision.md`：',
  '    `## D<n> · <一句话说清决策点>` + 三行 `- 决定：` / `- 为什么：` / `- 影响：`',
  '    （「为什么」写依据 + 哪里不确定；「影响」写改了哪些行为、退不退得回去。格式由 `audit-ids` 校验，缺行会红）。',
  '    **只有下面三类必须弹窗**：① 退不回去的动作（删数据 / 改数据格式 / 改公开接口 / 强推）；',
  '    ② 只有用户知道的信息（预算 / 外部账号 / 合规 / 产品取舍）；③ 规矩要求他签字（里程碑验收 / `[阻塞]` 处置 / 增删需求）。',
  '    "有多种合理做法""条目有歧义"**不是**弹窗理由：自己选一个、把放弃的写进「为什么」，',
  '    不确定就挑最可撤回的那个；两种解释的代价都退不回去时才升级成第 ① 类。',
  '    收尾时和队列一起归档：`node .continue/hooks/archive-queue.mjs <本会话ID> --decision`。',
  othersBlock,
  treeNote,
  todoHandoffBlock,
  handoffBlock,
].join('\n');

appendLog(sid, `注入会话信息 · 其他未完成队列 ${others.length} 份`);

/**
 * 注入方式留了开关：默认走 hookSpecificOutput.additionalContext（Claude Code 兼容写法），
 * 若这个平台不认，改 `QUEUE_INIT_STYLE=text` 直接输出纯文本。
 * 无论哪种生效不了，Stop 每轮都会重申队列路径，机制不会因此断掉。
 */
if (process.env.QUEUE_INIT_STYLE === 'text') {
  writeFd(1, `${injection}\n`);
  process.exit(0);
}

// `writeFd` 而不是 `process.stdout.write`：内容 ~5KB，异步写 + 紧跟 exit 会在中间截断，
// 宿主拿到坏 JSON 就静默丢掉整个注入（见 lib.mjs 的 writeFd 注释）。
writeFd(
  1,
  `${JSON.stringify({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: injection },
    systemMessage: `continue-do：本会话队列 = ${DOING_REL}/${queueFileName(sid)}（${DOING_DIR}）`,
  })}\n`,
);
process.exit(0);

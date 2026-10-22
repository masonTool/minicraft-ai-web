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
 *   · 本会话已经注入过（记在 `logs/<sid>.md` 的 `<!-- s:init … -->` 状态行里）。
 */

import { existsSync, statSync } from 'node:fs';
import {
  setLogTag,
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
  queuePath,
  readPayload,
  readQueue,
  resolveEvent,
  saveState,
  sessionId,
  unfinishedCount,
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

// ② 本会话已经注入过 → 静默。
// 状态文件用 'init' 命名空间：UserPromptSubmit 上 auto-continue 也会写状态，
// 两个进程并行整份覆盖同一个 JSON 会互相抹字段。
const state = loadState(sid, 'init');
if (state.initialized) emitAllow();

state.initialized = true;
state.startedAt = new Date().toISOString();
saveState(sid, state, 'init');

// ---------------------------------------------------------------- 其他会话的未完成队列

const others = listQueues()
  /**
   * **计划文件不是"别人的队列"**：`plan-*.md` 里全是 `[ ]` 阶段，不排掉的话每次注入
   * 都会多一条"其他会话还有未完成队列（剩 N 条）"，指着 `plan-x.md` 要你去接管——
   * 那是本会话正在用的计划，接管提示纯属噪音，还会诱导 AI 去删自己的计划。
   */
  .filter((item) => !item.sid.startsWith('plan-'))
  .filter((item) => item.sid !== sid)
  .map((item) => {
    const queue = readQueue(item.file);
    let mtime = '';
    try {
      mtime = new Date(statSync(item.file).mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      mtime = '';
    }
    return { ...item, left: unfinishedCount(queue), mtime };
  })
  .filter((item) => item.left > 0)
  .slice(0, 5);

const othersBlock = others.length
  ? [
      '',
      '## ⚠️ 其他会话还有未完成队列（**不要擅自接管**）',
      '',
      ...others.map((item) => `- \`${DOING_REL}/${item.sid}.md\` · 剩 ${item.left} 条 · 最近更新 ${item.mtime}`),
      '',
      '处理规则：**先问用户**（用弹窗提问工具给选项：接管 / 只读参考 / 忽略）。',
      '用户同意接管后，把那边未完成的条目搬进本会话队列，再删除原队列文件；',
      '没同意就一律不碰——同一份队列被两个会话同时改会导致条目状态错乱。',
    ].join('\n')
  : '';

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
  '【continue-do · 会话初始化】',
  '',
  `- 会话 ID：\`${sid}\``,
  // 会话重启后同一个 sid 可能已经有队列（上一轮建的）→ 说"尚未创建"会让 AI 覆盖掉进度。
  `- 本会话队列：\`${DOING_REL}/${sid}.md\`${existsSync(queuePath(sid)) ? '（**已存在，接着做，别重建**）' : '（**尚未创建**）'}`,
  `- 批次号：\`${batch}\` —— **一批一个号，开工定下就不再变**（时间戳，天然唯一）`,
  `- 机制说明：\`.continue/README.md\`（文件分工 / 编号 / 队列格式 / 收尾流程）`,
  `- 项目根：\`${PROJECT_ROOT}\``,
  ...(migrated.length > 0
    ? ['', '## 已自动对齐旧版布局（本次会话首次启动时做的，幂等）', '', ...migrated.map((note) => `- ${note}`)]
    : []),
  '',
  '## 队列协议（必须遵守）',
  '',
  '1. **写队列 = 规划，干活由钩子注入**。讨论阶段不要建队列；',
  '   只有用户明确要做某事、且你能把它拆成"可独立验证、能单独提交"的条目时，才创建队列文件。',
  '   **串行开发**：同一时间只让一个会话有进行中的队列；看到别的会话有未完成队列，先问用户，不要同时开工。',
  '2. **四态标记，三个由你写**（与参考项目一致）：',
  '   `- [ ]` 待办（规划时写）· `- [~]` **进行中**（开始做这条时自己改）·',
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
  '- [x] [T1] 给地形加分块生成：`src/world/chunk.ts` → `npm run test:chunk` 通过',
  '  - 做了什么：抽出 ChunkBuilder，按 16×16 分块生成',
  '  - 为什么：整图生成内存峰值 2.1G，分块后 300M',
  '  - 验证：`npm run test:chunk` 12 条通过',
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
  '      它把队列移到 `.continue/logs/doing-archive/<会话ID>-<年月日时分秒>.md` 备查（**不要 `rm`**）。',
  '   **例外**：队列里有 `[阻塞]`，或有打了 `[x]` 却缺 `验证` 说明 / 自述"未验证、跳过"的条目，',
  '   钩子会先让你弹窗逐条问用户（改描述继续做 / 直接删除 / 先留着并收尾）——那类拍板之前不要动这五样。',
  '   边界：用户新提的需求当场落成 `- [ ] T<n>` 并编号（递增、永不复用），收尾只补 `[x]`，',
  '   **不自创需求**；`OVERVIEW` / `TIPS` 没内容就跳过，**不写占位**。',
  '7. 目录分工：`logs/` 是钩子的运行日志与**队列备份**（`logs/doing-archive/<会话ID>-<时间戳>.md`，',
  '   **已 gitignore**：不要提交、不要改；想翻"当时队列原文怎么写的"就去那儿看）；',
  '   `doing/` 里同时住着**会话队列**（`<session_id>.md`）与**计划**（`plan-<session_id>.md`，同名配对），',
  '   这两类连同 `TASKS.md` / `DONE.md` / `OVERVIEW.md` / `TIPS.md` / `README.md` 都是要 review 的文档；',
  '   `OVERVIEW.md` = 按模块的实现 + 坑摘要（做某个模块前先看它）；',
  '   `TIPS.md` = 坑的细节（按模块分节，要细节再 grep）。',
  '8. **一批多长看行数，不看条数**：判据是「预计这批的完成说明（每条 4~6 行）超过 ~80 行」',
  '   或「队列本身 > 500 行」或「这一阶段的目标变了」——**条数只是经验值**（通常 8~12 条），',
  '   不是上限。想再往里塞就说明该拆阶段了。同一会话里要拿新批次号跑：',
  '   `node .continue/hooks/queue-init.mjs --new-batch`（**不要自己编号**）。',
  '9. **任务预计 > 16 条队列条目时，才写计划**（≤16 条直接做完、**不设里程碑**）：',
  '   计划文件名必须叫 `doing/plan-<本会话ID>.md`——**和队列 `<本会话ID>.md` 同名配对**，',
  '   钩子靠文件名找它（队列头**不要**再写 `> 计划：`，那是同一件事的第二份副本）。',
  '   用里程碑把任务切成若干**阶段**，**每个里程碑至少 2 个阶段**（= 至少两批）：',
  '',
  '```markdown',
  '## MS1 · <里程碑名>',
  '- 验收：`<这个里程碑做完要跑的命令>`',
  '- [ ] `MS1.1` <这一阶段做什么> → 验收 `<命令>`',
  '```',
  '',
  '   然后把**当前阶段**拆成本批条目。之后每做完一批：**自动从计划取下一阶段**（收尾时队列是"重置"而不是删除）；',
  '   **完成到里程碑就停**——钩子会硬停，要你跑该里程碑的 `- 验收：` 并把结果贴出来，',
  '   再弹窗问开发者"继续下一个 / 调整计划 / 先收在这里"。',
  '   计划里同一时间只有一条 `[~]`（它就是游标）；`- 确认：已验收 · 批次 <号>` 是"人验收过"的凭证，',
  '   **只在真的收到用户答复之后才写**，替用户写它等于自己给自己验收。',
  othersBlock,
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
    systemMessage: `continue-do：本会话队列 = ${DOING_REL}/${sid}.md（${DOING_DIR}）`,
  })}\n`,
);
process.exit(0);

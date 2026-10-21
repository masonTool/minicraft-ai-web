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
 *   · 本会话已经注入过（记在 `logs/<sid>.state.json` 的 initialized）。
 */

import { statSync } from 'node:fs';
import {
  PROJECT_ROOT,
  QUEUES_DIR,
  appendLog,
  detectEvent,
  emitAllow,
  listQueues,
  loadState,
  readPayload,
  readQueue,
  saveState,
  sessionId,
  unfinishedCount,
} from './lib.mjs';

const payload = readPayload();
const event = detectEvent(payload);

if (event !== 'UserPromptSubmit') emitAllow();

const sid = sessionId(payload);
if (!sid) emitAllow();

const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';

// ① 钩子回灌的消息：内容里带轮次标记，说明这是 auto-continue 递进来的任务，不是用户说话。
if (/auto-continue\s*第\s*\d+\s*轮/.test(prompt)) {
  appendLog(sid, 'Init · 跳过 · 这是钩子回灌的任务反馈');
  emitAllow();
}

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
      ...others.map((item) => `- \`.continue/queues/${item.sid}.md\` · 剩 ${item.left} 条 · 最近更新 ${item.mtime}`),
      '',
      '处理规则：**先问用户**（用 AskUserQuestion 弹窗给选项：接管 / 只读参考 / 忽略）。',
      '用户同意接管后，把那边未完成的条目搬进本会话队列，再删除原队列文件；',
      '没同意就一律不碰——同一份队列被两个会话同时改会导致条目状态错乱。',
    ].join('\n')
  : '';

const injection = [
  '【continue-do · 会话初始化】',
  '',
  `- 会话 ID：\`${sid}\``,
  `- 本会话队列：\`.continue/queues/${sid}.md\`（**尚未创建**）`,
  `- 机制说明：\`.continue/HANDOFF.md\``,
  `- 项目根：\`${PROJECT_ROOT}\``,
  '',
  '## 队列协议（必须遵守）',
  '',
  '1. **写队列 = 规划，干活由钩子注入**。讨论阶段不要建队列；',
  '   只有用户明确要做某事、且你能把它拆成"可独立验证、能单独提交"的条目时，才创建队列文件。',
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
  '',
  '- [ ] T1 <一句话说清做什么>：<改哪个文件> → <怎么算做完>',
  '- [ ] T2 …',
  '```',
  '',
  '   - 只想先和用户确认方案、还不想开工：把 `> 状态：执行中` 写成 `> 状态：讨论中`，钩子就不会递任务。',
  '     这一行只在**文件头部 5 行**内有效，正文里提到这几个字不影响。',
  '   - 确认开工后，把那一行改回 `> 状态：执行中`。',
  '4. 钩子一次只递**一条**，你一次也只做一条。',
  '5. `[ ]` / `[~]` 都没有了 → 钩子会拦住，让你用弹窗请用户确认收尾；',
  '   **确认之后**才做：整份队列写进 `.continue/DONE.md`（含 `[阻塞]`）、',
  '   `.continue/TASKS.md` 里对应条目改成 `[x]`、删除队列文件。用户没确认之前不要动这三样。',
  '6. 目录分工：`logs/` 是钩子的运行日志（**已 gitignore**，你不要提交、不要改）；',
  '   `queues/` 与 `TASKS.md` / `DONE.md` / `HANDOFF.md` 是要 review 的文档。',
  othersBlock,
].join('\n');

appendLog(sid, `Init · 注入会话信息（其他未完成队列 ${others.length} 份）`);

/**
 * 注入方式留了开关：默认走 hookSpecificOutput.additionalContext（Claude Code 兼容写法），
 * 若这个平台不认，改 `QUEUE_INIT_STYLE=text` 直接输出纯文本。
 * 无论哪种生效不了，Stop 每轮都会重申队列路径，机制不会因此断掉。
 */
if (process.env.QUEUE_INIT_STYLE === 'text') {
  process.stdout.write(`${injection}\n`);
  process.exit(0);
}

process.stdout.write(
  `${JSON.stringify({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: injection },
    systemMessage: `continue-do：本会话队列 = .continue/queues/${sid}.md（${QUEUES_DIR}）`,
  })}\n`,
);
process.exit(0);

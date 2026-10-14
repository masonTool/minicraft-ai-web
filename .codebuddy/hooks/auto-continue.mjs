#!/usr/bin/env node
/**
 * Stop 钩子：让 AI 完成一轮后自动按队列继续，而不是停下来等用户确认。
 *
 * 官方规范依据（CodeBuddy Hooks 文档，完全兼容 Claude Code Hooks）：
 *   - Stop 事件在 Agent 完成响应时触发，不使用 matcher；
 *   - 退出码 2 = 阻止/反馈：stdout 被忽略，**stderr 会传递给 Agent**，因此可驱动它继续；
 *   - 官方给出的 Stop 输出样例正是 {"continue": false, "stopReason": "..."} + exit 2。
 *
 * 安全设计（避免无限循环烧 token）：
 *   1. 队列文件里没有未完成条目 → 放行；
 *   2. 存在开关文件 .codebuddy/auto-continue.off → 放行（紧急刹车）；
 *   3. 每会话最多自动继续 AUTO_CONTINUE_MAX 次（默认 12）；
 *   4. 用户主动发言（UserPromptSubmit）重置额度，人工介入后又能继续跑。
 *
 * 每次调用都会往 .codebuddy/auto-continue.log 追加一行 JSON 记录，
 * 用于确认"钩子到底有没有被触发、收到了什么事件、做了什么决定"。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_CONTINUATIONS = Number(process.env.AUTO_CONTINUE_MAX ?? 12);

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const rawInput = readStdinSync();

let payload = {};
try {
  payload = JSON.parse(rawInput || '{}');
} catch {
  payload = {};
}

const projectDir = process.env.CODEBUDDY_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const codebuddyDir = join(projectDir, '.codebuddy');
const stateFile = join(codebuddyDir, 'auto-continue.state.json');
const offFile = join(codebuddyDir, 'auto-continue.off');
const queueFile = join(codebuddyDir, 'auto-continue.md');
const logFile = join(codebuddyDir, 'auto-continue.log');

const sessionId = payload.session_id ?? payload.conversation_id ?? null;

/**
 * 事件名兜底推断：如果 hook_event_name 字段名与预期不一致，也能识别出事件类型。
 * （这次排查就是靠日志确认事件到底有没有到达，所以这里同时兼容几种常见字段。）
 */
function detectEvent() {
  const name = payload.hook_event_name ?? payload.hookEventName;
  if (typeof name === 'string' && name.length > 0) return name;
  if (payload.stop_hook_active !== undefined) return 'Stop';
  if (typeof payload.prompt === 'string') return 'UserPromptSubmit';
  if (payload.tool_name !== undefined) return 'PreToolUse';
  return '(unknown)';
}

const event = detectEvent();

function log(decision, extra = {}) {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(
      logFile,
      `${JSON.stringify({
        at: new Date().toISOString(),
        event,
        sessionId,
        decision,
        rawInputLength: rawInput.length,
        rawInputHead: rawInput.slice(0, 400),
        ...extra,
      })}\n`,
    );
  } catch {
    /* 日志写不进去不能影响主流程 */
  }
}

function allowStop(reason, systemMessage) {
  const output = { continue: true, suppressOutput: true };
  if (systemMessage) output.systemMessage = systemMessage;
  log(reason);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(0);
}

/**
 * 阻止停止并让 Agent 继续。
 *
 * ⚠️ 这里有坑：官方 Stop 章节给的样例是 stdout 输出 {"continue": false, "stopReason": "..."} + exit 2，
 * 但附录里 continue 的通用定义是「是否继续执行（默认 true）」——也就是说 false 在实现层
 * 很容易被当成"硬停止"，结果就是 Agent 真的停了（这正是最初没自动继续的原因）。
 * 而附录 D 明确写了：**退出码 2 时 stdout 被忽略，stderr 才是传给 Agent 的内容**。
 *
 * 因此这里改用「stdout 声明 continue: true + stderr 承载反馈 + exit 2」，
 * 两种解读下都能得到正确行为：若 stdout 被忽略，则靠 exit 2 + stderr 驱动；
 * 若 stdout 被读取，continue: true 也不会把 Agent 硬停下来。
 */
function blockStop(feedback, extra = {}) {
  log('block', extra);
  process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
  process.stderr.write(`${feedback}\n`);
  process.exit(2);
}

function loadState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return { sessionId: null, count: 0 };
  }
}

function saveState(state) {
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    /* 状态写不进去也不该影响主流程 */
  }
}

// ---------------------------------------------------------------- 分支

// 用户主动发言 → 重置额度，保证人工介入后还能继续自动推进
if (event === 'UserPromptSubmit') {
  saveState({ sessionId, count: 0 });
  allowStop('user-prompt-reset');
}

if (event !== 'Stop') {
  allowStop(`skip-event:${event}`);
}

if (existsSync(offFile)) {
  allowStop('disabled-by-off-file', '自动继续已关闭（存在 .codebuddy/auto-continue.off），删除该文件即可恢复。');
}

if (!existsSync(queueFile)) {
  allowStop('no-queue-file', '未找到 .codebuddy/auto-continue.md，自动继续未启用。');
}

const pending = readFileSync(queueFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^-\s*\[[ ~]\]\s*\S/.test(line));

if (pending.length === 0) {
  allowStop('queue-empty', '自动继续队列已全部完成，正常停止。');
}

const state = loadState();
if (state.sessionId !== sessionId) {
  state.sessionId = sessionId;
  state.count = 0;
}
if (state.count >= MAX_CONTINUATIONS) {
  allowStop(
    'max-continuations',
    `自动继续已达上限 ${MAX_CONTINUATIONS} 次，本次停止。如需继续：删除 ${stateFile}，或调大环境变量 AUTO_CONTINUE_MAX。`,
  );
}
state.count += 1;
saveState(state);

const next = pending
  .slice(0, 3)
  .map((line) => `  · ${line.replace(/^-\s*\[[ ~]\]\s*/, '')}`)
  .join('\n');

const feedback = [
  `[auto-continue ${state.count}/${MAX_CONTINUATIONS}] 不要询问我，直接继续执行。`,
  '',
  '请先读取 .codebuddy/auto-continue.md 与 TASKS.md，然后立即开始实现下面这些未完成条目：',
  next,
  '',
  '要求：',
  '1. 每完成一条就把该条从 [ ] 改为 [x]（开始做时先改成 [~]），并同步更新 TASKS.md；',
  '2. 每个独立改动单独 git 提交（中文 commit message），不要攒成一个巨型提交；',
  '3. 改完必须自测：npx tsc --noEmit 通过 + 用脚本或浏览器实测，并把实测数据写进 commit message；',
  '4. 遇到困难不要停下来问我，自己找办法解决并把结论记录下来；',
  '5. 队列全部清空后，在回复里明确写"队列已清空"再停止。',
].join('\n');

blockStop(feedback, { count: state.count, pendingCount: pending.length });

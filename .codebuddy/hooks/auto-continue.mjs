#!/usr/bin/env node
/**
 * Stop 钩子：让 AI 完成一轮后自动按队列继续，而不是停下来等用户确认。
 *
 * 机制（依据 CodeBuddy Hooks 规范，与 Claude Code Hooks 兼容）：
 *   - Stop 事件在 Agent 即将结束响应时触发；
 *   - 退出码 2 表示"提供反馈"，stderr 内容会被注入为下一条消息，从而驱动 Agent 继续；
 *   - 退出码 0 表示放行，Agent 正常停止。
 *
 * 安全设计（避免无限循环烧 token）：
 *   1. 队列文件 .codebuddy/auto-continue.md 里没有未完成条目 → 直接放行；
 *   2. 存在开关文件 .codebuddy/auto-continue.off → 直接放行（紧急刹车）；
 *   3. 每个会话最多自动继续 AUTO_CONTINUE_MAX 次（默认 12）；
 *   4. 用户主动发言（UserPromptSubmit）会重置次数额度，所以人工介入后又能继续跑。
 *
 * 调试方式：
 *   echo '{"hook_event_name":"Stop","session_id":"t","cwd":"'$PWD'"}' \
 *     | node .codebuddy/hooks/auto-continue.mjs ; echo "exit=$?"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_CONTINUATIONS = Number(process.env.AUTO_CONTINUE_MAX ?? 12);

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function allowStop(systemMessage) {
  const payload = { continue: true, suppressOutput: true };
  if (systemMessage) payload.systemMessage = systemMessage;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(0);
}

/** 阻止停止：stdout 给出 stopReason，stderr 的内容会被注入为下一条消息 */
function blockStop(feedback) {
  process.stdout.write(`${JSON.stringify({ continue: false, stopReason: feedback })}\n`);
  process.stderr.write(`${feedback}\n`);
  process.exit(2);
}

let payload = {};
try {
  payload = JSON.parse(readStdinSync() || '{}');
} catch {
  payload = {};
}

const projectDir = process.env.CODEBUDDY_PROJECT_DIR || payload.cwd || process.cwd();
const codebuddyDir = join(projectDir, '.codebuddy');
const stateFile = join(codebuddyDir, 'auto-continue.state.json');
const offFile = join(codebuddyDir, 'auto-continue.off');
const queueFile = join(codebuddyDir, 'auto-continue.md');

const event = payload.hook_event_name ?? '';
const sessionId = payload.session_id ?? null;

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

// 用户主动发言 → 重置额度，保证人工介入后还能继续自动推进
if (event === 'UserPromptSubmit') {
  saveState({ sessionId, count: 0 });
  allowStop();
}

if (event !== 'Stop') allowStop();

if (existsSync(offFile)) {
  allowStop('自动继续已关闭（存在 .codebuddy/auto-continue.off），删除该文件即可恢复。');
}

if (!existsSync(queueFile)) {
  allowStop('未找到 .codebuddy/auto-continue.md，自动继续未启用。');
}

const pending = readFileSync(queueFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^-\s*\[[ ~]\]\s*\S/.test(line));

if (pending.length === 0) {
  allowStop('自动继续队列已全部完成，正常停止。');
}

const state = loadState();
if (state.sessionId !== sessionId) {
  state.sessionId = sessionId;
  state.count = 0;
}
if (state.count >= MAX_CONTINUATIONS) {
  allowStop(
    `自动继续已达上限 ${MAX_CONTINUATIONS} 次，本次停止。` +
      `如需继续：删除 ${stateFile}，或调大环境变量 AUTO_CONTINUE_MAX。`,
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

blockStop(feedback);

#!/usr/bin/env node
/**
 * Stop 钩子：让 AI 完成一轮后自动按队列继续，而不是停下来等用户确认。
 *
 * 官方规范依据（CodeBuddy Hooks 文档，完全兼容 Claude Code Hooks）：
 *   - Stop 事件在 Agent 完成响应时触发，不使用 matcher；
 *   - 退出码 2 = 阻止/反馈：stdout 被忽略，**stderr 会传递给 Agent**，因此可驱动它继续；
 *   - 官方给出的 Stop 输出样例正是 {"continue": false, "stopReason": "..."} + exit 2。
 *
 * 安全设计：
 *   1. 队列文件里没有未完成条目 → 放行（这是**唯一的正常退出条件**）；
 *   2. 存在开关文件 `.codebuddy/auto-continue.off` → 放行（紧急刹车）；
 *   3. 用户主动发言（UserPromptSubmit）→ 重置轮次计数，人工介入后重新计。
 *
 * **没有轮次上限**（用户明确要求"不要限制会话次数"）：只要队列里还有 `- [ ]`，
 * 就一直一轮一轮做下去，做一条勾一条。想停就三选一：
 *   `touch .codebuddy/auto-continue.off` / 清空队列 / 直接中断。
 *
 * 每次调用都会往 `.codebuddy/hooks/logs/auto-continue.log` 追加一行 JSON 记录，
 * 用于确认"钩子到底有没有被触发、收到了什么事件、做了什么决定"。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 定位项目根目录（跨机器、跨 cwd 都成立）。
 *
 * 本脚本固定在 `<项目根>/.codebuddy/hooks/` 下，所以"脚本自己的位置"就是最可靠的锚点：
 * 从 `import.meta.url` 往上退 3 层即可，不依赖任何环境变量或当前工作目录。
 *
 * 为什么不用相对路径（`./.codebuddy/hooks/xxx.mjs`）：
 * 钩子进程的 cwd 是 `getWorkDir()` / session cwd，在子目录里发起会话时会指错。
 * 为什么不用绝对路径：换机器、改目录名（本仓库就被挪进过 `About-minecraft/`）立刻失效。
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');

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

/**
 * 状态文件放哪：优先脚本反推的项目根（唯一可靠锚点）。
 * payload.cwd 只在项目根不可用时兜底——它可能是子目录，届时状态会写进子目录。
 */
const projectDir = PROJECT_ROOT;
const codebuddyDir = join(projectDir, '.codebuddy');
/**
 * 目录分工（长跑任务列表用），都在 `hooks/` 下：
 *   · `hooks/process/` —— 进度文档（队列 + 归档），进仓库、要 review；
 *   · `hooks/logs/`    —— 运行时产物（日志 + 计数状态），**不进仓库**（.gitignore 掉）。
 */
const hooksDir = join(codebuddyDir, 'hooks');
const processDir = join(hooksDir, 'process');
const logsDir = join(hooksDir, 'logs');
const stateFile = join(logsDir, 'auto-continue.state.json');
const offFile = join(codebuddyDir, 'auto-continue.off');
const queueFile = join(processDir, 'auto-continue.md');
const logFile = join(logsDir, 'auto-continue.log');

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

/**
 * 日志轮转：长跑队列会跑几百上千轮，日志不能无限长。
 * 超过上限就改名成 `.1` 再重开——保留最近一段，且不删数据。
 * （本脚本每行还存 400B 的原始输入，比 auto-commit 更容易长大，所以上限小一档。）
 */
const LOG_MAX_BYTES = Number(process.env.AUTO_CONTINUE_LOG_MAX ?? 512 * 1024);

function rotateIfNeeded() {
  try {
    if (statSync(logFile).size <= LOG_MAX_BYTES) return;
    renameSync(logFile, `${logFile}.1`);
  } catch {
    /* 文件不存在或改不动都无所谓，照常往下写 */
  }
}

function log(decision, extra = {}) {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    rotateIfNeeded();
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

/**
 * 读当前会话的上下文用量（回答"一直跑 token 会不会满"）。
 *
 * 数据来源：钩子输入里的 `transcript_path` 指向会话 JSONL，每轮 assistant 消息的
 * `message.usage.input_tokens` 就是**这一轮实际喂进去的上下文长度**。
 * 取最后一条有 usage 的记录即可（它最能代表"现在上下文有多满"）。
 *
 * 返回 null 表示读不到（文件不存在 / 格式变了）——此时不阻断，只是不提示。
 */
function readContextTokens() {
  const transcript = payload.transcript_path;
  if (typeof transcript !== 'string' || !existsSync(transcript)) return null;
  try {
    const lines = readFileSync(transcript, 'utf8').split('\n');
    // 从尾部往前找，避免把几十 MB 的 transcript 全解析一遍
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 400; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = row?.message?.usage ?? row?.providerData?.usage;
      const input = Number(usage?.input_tokens ?? usage?.inputTokens);
      if (Number.isFinite(input) && input > 0) return input;
    }
  } catch {
    return null;
  }
  return null;
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
  allowStop('no-queue-file', '未找到 .codebuddy/process/auto-continue.md，自动继续未启用。');
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
state.count += 1;
saveState(state);

const next = pending
  .slice(0, 3)
  .map((line) => `  · ${line.replace(/^-\s*\[[ ~]\]\s*/, '')}`)
  .join('\n');

/**
 * 上下文水位。默认阈值 150k：这个量级之后模型的注意力与压缩风险都明显上升，
 * 与其硬撑不如主动收尾——但**收尾不是放弃**，而是把"交接"落到文件里，下一轮换个会话接着跑。
 * 可用 `AUTO_CONTINUE_CONTEXT_LIMIT` 覆盖。
 */
const contextTokens = readContextTokens();
const CONTEXT_LIMIT = Number(process.env.AUTO_CONTINUE_CONTEXT_LIMIT ?? 150_000);
const contextLine =
  contextTokens === null
    ? '（读不到上下文用量，忽略此条）'
    : `当前上下文约 ${Math.round(contextTokens / 1000)}k tokens（阈值 ${Math.round(CONTEXT_LIMIT / 1000)}k）`;

const mustHandOff = contextTokens !== null && contextTokens >= CONTEXT_LIMIT;

const feedback = mustHandOff
  ? [
      `[auto-continue 第${state.count}轮 · 上下文 ${Math.round(contextTokens / 1000)}k 已过阈值] 先收尾，不要开新任务。`,
      '',
      '## 这一轮只做三件事（不要做新任务）',
      '',
      '1. **把手上的活收干净**：该提交的提交（中文 message），该勾的勾 `[x]`；',
      '2. **如果某条做到一半**，把它改成 `[~]` 并在条目下面补一行"当前卡在哪 / 下一步具体做什么"，',
      '   写清到"换个会话的人不用问我也能接着做"的程度；',
      '3. **在回复里给出交接摘要**：本会话做完哪几条（编号）、还剩几条、下一条从哪开始。',
      '',
      '然后**明确停止**（不要再读队列、不要开始新条目）。用户会开一个新会话继续——',
      '上下文已经满了，硬撑只会让后半程质量下降、还会触发压缩丢细节。',
    ].join('\n')
  : [
      `[auto-continue 第${state.count}轮 · 队列还剩 ${pending.length} 条 · ${contextLine}] 不要询问我，直接继续执行。`,
      '',
      '请先读取 .codebuddy/hooks/process/auto-continue.md 与 TASKS.md，然后开始实现**下面第一条**：',
      next,
      '',
      '要求：',
      '1. **这一轮只做一条**：做完就停，不要连着做两三条。下一条由我下一轮递给你。',
      '2. 开始做时把该条 `[ ]` 改成 `[~]`，做完改成 `[x]`，并同步更新 TASKS.md；',
      '3. 该条做完立刻单独 git 提交（中文 commit message），不要攒成一个巨型提交；',
      '4. 改完必须自测：`npx tsc --noEmit` 通过 + 用脚本或浏览器实测，把实测数据写进 commit message；',
      '5. 遇到困难不要停下来问我，自己找办法解决并把结论记录下来；',
      '6. 队列全部清空后，在回复里明确写"队列已清空"再停止。',
    ].join('\n');

blockStop(feedback, { count: state.count, pendingCount: pending.length, contextTokens });

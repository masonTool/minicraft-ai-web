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
    return { sessionId: null, count: 0, attempts: {} };
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

/**
 * 扫描待办。
 *
 * ⚠️ 必须**先剥掉围栏代码块**再匹配，不能对着裸文件逐行 trim 后匹配。
 * 真实踩过：队列文件里写着格式模板
 *     ```\n- [ ] [发现] <一句话说清是什么>…\n```
 * 那是给人看的示例，但 trim 之后行首就是 `- [ ]`，钩子把它当成了真待办，
 * 于是"队列明明已清空"却一直自动继续，还把模板当成任务递出去。
 *
 * 规则：``` 围栏之间的内容一律不算待办；`- [x]` 已完成的不算（正则只认空格和 ~）。
 */
function readPending(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (/^-\s*\[[ ~]\]\s*\S/.test(trimmed)) out.push(trimmed);
  }
  return out;
}

const pending = readPending(queueFile);

if (pending.length === 0) {
  allowStop('queue-empty', '自动继续队列已全部完成，正常停止。');
}

const state = loadState();
if (state.sessionId !== sessionId) {
  state.sessionId = sessionId;
  state.count = 0;
}
state.count += 1;
if (!state.attempts || typeof state.attempts !== 'object') state.attempts = {};
saveState(state);

/**
 * ---- 卡死保护：同一个任务连续多轮没做完 → 隔离上报，不再重试 ----
 *
 * 问题：`[~]` 也算待办（正则认 `[ ~]`），所以一条做不完的任务会被**无限递回来**。
 * 没有这道闸，一条做不动的任务会烧光上下文、交接、再烧，永远走不到后面的条目。
 *
 * 判据：条目的**指纹**（去掉勾选标记后的正文）连续出现在多少轮的"第一条"位置。
 *   · 换了一条 → 说明上一条做完了（或至少推进了），计数归零；
 *   · 同一指纹再次被选中 → 说明它上一轮没做完，计数 +1；
 *   · 达到上限（默认 5）→ 标 `[阻塞]`，跳过去做下一条，并提示上报给用户决策。
 *
 * 为什么用"连续"而不是"累计"：一条任务做了一半、下一轮继续，是正常推进；
 * 只有**连续几轮都停在同一条且没有勾掉**才是真的卡住。
 *
 * 隔离而不是删除：用户的决策权不能被脚本替掉。标 `[阻塞]` 的条目不再被选中，
 * 但仍留在文件里等人处理——要重试就把标记去掉，要删就自己删。
 */
const BLOCKED_MAX = Number(process.env.AUTO_CONTINUE_BLOCK_AFTER ?? 5);
const BLOCKED_TAG = '[阻塞]';

const fingerprint = (line) =>
  line
    .replace(/^-\s*\[[ ~]\]\s*/, '')
    .replace(BLOCKED_TAG, '')
    .trim()
    .slice(0, 120);

// 选下一条：跳过 [阻塞]，优先用户排的（非 [发现]）
const selectable = pending.filter((line) => !line.includes(BLOCKED_TAG));
const blockedNow = pending.filter((line) => line.includes(BLOCKED_TAG));

const firstScheduledSel = selectable.find((line) => !/^-\s*\[[ ~]\]\s*\[发现\]/.test(line));
const chosen = firstScheduledSel ?? selectable[0] ?? null;

let justBlocked = null;
if (chosen) {
  const fp = fingerprint(chosen);
  if (state.currentFingerprint === fp) {
    state.currentStreak = (state.currentStreak ?? 0) + 1;
  } else {
    state.currentFingerprint = fp;
    state.currentStreak = 1;
  }
  state.attempts[fp] = state.currentStreak;

  if (state.currentStreak >= BLOCKED_MAX) {
    justBlocked = { fp, streak: state.currentStreak };
    // 标记原文：把 `- [ ]` / `- [~]` 换成 `- [阻塞]`，其余一字不动
    try {
      const raw = readFileSync(queueFile, 'utf8');
      const lines = raw.split(/\r?\n/);
      let inFence = false;
      let hit = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        if (fingerprint(lines[i].trim()) === fp && /^\s*-\s*\[[ ~]\]/.test(lines[i])) {
          lines[i] = lines[i].replace(/^(\s*-\s*)\[[ ~]\]/, `$1${BLOCKED_TAG}`);
          hit += 1;
          break;
        }
      }
      if (hit > 0) writeFileSync(queueFile, lines.join('\n'));
    } catch {
      /* 改不动文件也不影响本轮：至少这次会跳过它 */
    }
    // 重置计数，避免下一轮又把同一条算进"连续"
    state.currentFingerprint = null;
    state.currentStreak = 0;
    saveState(state);
  } else {
    // ⚠️ 正常累加也必须落盘：不存的话下一轮读回来又是初始值，
    // 连续次数永远是 1，永远到不了上限（这个漏写实测踩过一次）
    saveState(state);
  }
}

// 重新扫描：刚才可能刚把某条改成 [阻塞]
const remaining = justBlocked ? readPending(queueFile).filter((l) => !l.includes(BLOCKED_TAG)) : selectable;

if (remaining.length === 0 && blockedNow.length === 0 && pending.length > 0) {
  // 全是阻塞项
  allowStop(
    'all-blocked',
    `队列里 ${pending.length} 条全部标记为 ${BLOCKED_TAG}，没有可做的了。请处理这些条目：改掉卡点、去掉标记重试，或直接删除。`,
  );
}
if (remaining.length === 0) {
  allowStop('queue-empty', '自动继续队列已全部完成，正常停止。');
}

const next = remaining
  .slice(0, 3)
  .map((line) => `  · ${line.replace(/^-\s*\[[ ~]\]\s*/, '')}`)
  .join('\n');

/**
 * AI 自己插入的任务（`- [ ] [发现] ...`）。
 *
 * 为什么允许：干活时撞见的问题往往比排好的任务更值钱——改物理时发现水里没断言、
 * 写界面时发现某个分支一直是死代码。这类信息**只在动手时才能拿到**，排期时想不到。
 *
 * 为什么要管：不设边界的话，AI 会为了"有活干"而发明任务（本项目真实踩过），
 * 看起来一直在推进，其实在空转。所以给三条硬规则（见下方 feedback）+ 一个总额度。
 */
const discovered = pending.filter((line) => /^-\s*\[[ ~]\]\s*\[发现\]/.test(line));
const DISCOVERED_LIMIT = Number(process.env.AUTO_CONTINUE_DISCOVERED_LIMIT ?? 5);
const discoveredFull = discovered.length >= DISCOVERED_LIMIT;

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

/**
 * 是否进入交接模式。
 *
 * 除了"用量过阈值"，还有一条**强制开关** `AUTO_CONTINUE_FORCE_HANDOFF=1`：
 *   ① 兜底——万一哪天平台不再传 `transcript_path`，读不到用量就永远进不了交接模式，
 *      那上下文满了也没人提醒，这个开关是最后一道保险；
 *   ② 手动——用户想主动收尾换个会话时，可以直接开它，不必等到 150k。
 */
const mustHandOff =
  process.env.AUTO_CONTINUE_FORCE_HANDOFF === '1' ||
  (contextTokens !== null && contextTokens >= CONTEXT_LIMIT);

/**
 * 交接用的一句话。
 *
 * 钩子**开不了新会话**（`Stop` 事件只允许返回 `additionalContext`，见实现里的
 * 字段白名单；`SessionStart` 的 4 个 source 都由外部动作触发），
 * 所以退而求其次：把"新会话第一句话"直接生成好，让用户复制粘贴就能接上。
 *
 * 这句话必须**自包含**——新会话看不到旧会话的任何东西，只能靠它 + 仓库文件。
 * 所以它要带上：读哪几份文件、当前第一条是什么、做完一条就停的约定。
 */
/**
 * 交接单里的"下一条"优先取**用户排的任务**，没有才取 `[发现]`。
 *
 * 这条优先级不是小事：如果 AI 插的 `[发现]` 总被排到最前，那就等于
 * 它自己给自己派活、把用户排的任务一直往后推——"只插不改"的承诺就落空了。
 */
// ⚠️ 必须跳过 [阻塞]：否则新会话第一句话就把卡死的任务又捡回来，白白再烧一轮
const firstScheduled = remaining.find((line) => !/^-\s*\[[ ~]\]\s*\[发现\]/.test(line));
const firstPending = firstScheduled ?? remaining[0];
const firstPendingText = firstPending
  ? firstPending.replace(/^-\s*\[[ ~]\]\s*/, '').trim().slice(0, 80)
  : null;

const handoffPrompt = firstPendingText
  ? `读 AGENTS.md、HANDOFF.md 和 .codebuddy/hooks/process/auto-continue.md，按队列继续推进。先做第一条：${firstPendingText}`
  : `读 AGENTS.md、HANDOFF.md 和 .codebuddy/hooks/process/auto-continue.md，按队列继续推进（队列里还有 ${remaining.length} 条待办）。`;

const handoffFile = join(logsDir, 'handoff-prompt.txt');

const feedback = mustHandOff
  ? [
      `[auto-continue 第${state.count}轮 · ${
        contextTokens === null ? '收到强制交接指令' : `上下文 ${Math.round(contextTokens / 1000)}k 已过阈值`
      }] 先收尾，不要开新任务。`,
      '',
      '## 这一轮只做四件事（不要做新任务）',
      '',
      '1. **把手上的活收干净**：该提交的提交（中文 message），该勾的勾 `[x]`；',
      '2. **如果某条做到一半**，把它改成 `[~]`，并在条目下面补一行"当前卡在哪 / 下一步具体做什么"，',
      '   写清到"换个会话的人不用问我也能接着做"的程度；',
      '3. **在回复里给出交接摘要**：本会话做完哪几条（编号）、还剩几条、下一条从哪开始；',
      '4. **在回复的最后，原样输出下面这个代码块**（用户要复制它到新会话）：',
      '',
      '   ┌───────────── 复制这段 ─────────────',
      '   │ ' + handoffPrompt,
      '   └───────────────────────────────',
      '',
      '   这一行已经同时写进 `.codebuddy/hooks/logs/handoff-prompt.txt`（钩子生成，不用你维护）。',
      '',
      '然后**明确停止**（不要再读队列、不要开始新条目）。用户会开一个新会话继续——',
      '上下文已经满了，硬撑只会让后半程质量下降、还会触发压缩丢细节。',
    ].join('\n')
  : [
      `[auto-continue 第${state.count}轮 · 队列还剩 ${remaining.length} 条 · ${contextLine}] 不要询问我，直接继续执行。`,
      '',
      '## 这一轮做这一条（不用读整个队列文件，做这条够用的部分即可）',
      next,
      '',
      '要求：',
      '1. **这一轮只做一条**：做完就停，不要连着做两三条。下一条由我下一轮递给你。',
      '2. 开始做时把该条 `[ ]` 改成 `[~]`，做完改成 `[x]`，并同步更新 TASKS.md；',
      '3. 该条做完立刻单独 git 提交（中文 commit message），不要攒成一个巨型提交；',
      '4. 改完必须自测：`npx tsc --noEmit` 通过 + 用脚本或浏览器实测，把实测数据写进 commit message；',
      '5. 遇到困难不要停下来问我，自己找办法解决并把结论记录下来；',
      '6. 队列全部清空后，在回复里明确写"队列已清空"再停止。',
      '',
      justBlocked
        ? [
            `## ⚠️ 刚有一条卡住，已标 ${BLOCKED_TAG}（连续 ${justBlocked.streak} 轮没做完）`,
            '',
            '上面「这一条」里**已经不含它**——脚本把它跳过了，你现在做的是下一条。',
            '但你必须**在回复里如实上报**，不要默默略过：',
            '',
            '1. **是哪一条**（原样抄一下条目内容）；',
            `2. **试过什么、卡在哪**（具体到报错/断言/文件行号），不要写"做不动"这种废话；`,
            `3. **给用户的三个选项**：改这条的描述继续做 / 直接删除 / 先跳过留后面处理。`,
            '   用户会自己决定，**你不要替他决定**，也不要自行删除或改描述。',
            '',
            `条目已被标成 \`- ${BLOCKED_TAG} ...\`，之后不会再被选中；用户处理完（去掉标记）才会重试。`,
            '',
          ].join('\n')
        : '',
      blockedNow.length > 0
        ? `> 另有 ${blockedNow.length} 条此前已标 ${BLOCKED_TAG}，都在等你决策（改描述重试 / 删除 / 保留）。\n`
        : '',
      '## 你可以在队列里插任务——但有硬条件',
      '',
      `做完这条后，如果**在动手过程中**发现了更该先做的事，可以往队列**插一条**（现有 ${discovered.length}/${DISCOVERED_LIMIT} 条）。`,
      '格式（行首必须是这个，钩子靠它识别）：',
      '',
      '```',
      '- [ ] [发现] <一句话说清是什么>：<哪个文件/哪条断言暴露的> → <怎么算做完>',
      '```',
      '',
      '**三条硬条件，缺一条就不要写**：',
      '',
      '1. **必须是你这一轮真实撞见的**，并在条目里写明证据（文件行号 / 断言失败 / 实测现象）。',
      '   不许写"我觉得""可能""顺便优化一下"这类没有证据的东西。',
      '2. **只能插，不能删改用户排的任务**。已有的 `[ ]` 一条都不许动、不许重排、不许合并。',
      '3. **插完在你的回复里明确说一句**："我插了一条：[发现] …，因为 …"，让用户能看见并否决。',
      discoveredFull
        ? `\n⚠️ 本轮**不要再插**：`[发现]` 已满 ${DISCOVERED_LIMIT} 条。先把手上的活干完，让用户过一遍已有发现。`
        : '',
    ].join('\n');

// 只在交接时落盘：平时不写，免得让人以为随时都有待用的交接单
if (mustHandOff) {
  try {
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(handoffFile, `${handoffPrompt}\n`);
  } catch {
    /* 写不进去不影响主流程，反馈里已经带了这句话 */
  }
}

blockStop(feedback, {
  count: state.count,
  pendingCount: pending.length,
  contextTokens,
  handoffPrompt: mustHandOff ? handoffPrompt : undefined,
});

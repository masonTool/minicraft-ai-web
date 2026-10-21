#!/usr/bin/env node
/**
 * Stop 钩子：一轮回复结束时，如果工作区还有未提交的改动，就**不许停**。
 *
 * 设计要点（重要，别改成"脚本直接 commit"）：
 *   这个脚本**自己不做任何 git 写操作**（不 add / 不 commit / 不 push）。
 *   它只负责"拦人"：把改动清单塞进反馈里，要求 AI 自己 review diff、自己判定
 *   哪些是它改的、自己写中文 commit message、自己提交。
 *   理由：commit message 的质量取决于"知不知道自己为什么这么改"，
 *   脚本拿 diff 拼出来的 message 只能是 `update files`，等于丢掉了版本历史的价值。
 *
 * 生命周期：
 *   每轮 Stop → 有脏文件 → 阻止停止 + 给要求 → AI 提交 → 再 Stop → 干净 → 放行。
 *
 * 安全阀（少一个就可能把仓库搞坏或烧光 token）：
 *   1. `.codebuddy/auto-commit.off` 存在 → 完全放行（紧急刹车）；
 *   2. merge / rebase / cherry-pick 进行中、detached HEAD、有冲突 → 放行并提醒，
 *      这一类状态下自动提交极容易把别人的活搅乱；
 *   3. 同一会话最多拦 AUTO_COMMIT_MAX 次（默认 5）→ 防止 AI 改不干净时无限循环；
 *   4. 用户主动发言（UserPromptSubmit）重置计数 → 人工介入后重新计。
 *
 * 两种输出风格（官方文档与实测存在冲突，所以留开关）：
 *   默认 AUTO_COMMIT_STYLE=json  → stdout `{"continue": false, "reason": "..."}` + exit 0
 *   AUTO_COMMIT_STYLE=exit2      → stdout `{"continue": true}` + 反馈走 stderr + exit 2
 *   若发现 AI 不理会、直接停了，把环境变量切成 exit2 再试（详见 HANDOFF §3）。
 *
 * 排查：每次调用都往 `.codebuddy/logs/auto-commit.log` 追加一行 JSON。
 *   `decision=block` 说明钩子生效且拦住了；`decision=allow:*` 里的原因是放行依据。
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ROUNDS = Number(process.env.AUTO_COMMIT_MAX ?? 5);
const STYLE = process.env.AUTO_COMMIT_STYLE === 'exit2' ? 'exit2' : 'json';

/**
 * 定位项目根目录：从脚本自身位置往上退 3 层（本文件在 `<项目根>/.codebuddy/hooks/`）。
 * 不依赖 CODEBUDDY_PROJECT_DIR（它是条件注入的）、也不依赖 cwd（可能是子目录）。
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

const projectDir = PROJECT_ROOT;
const codebuddyDir = join(projectDir, '.codebuddy');
/** 运行时产物（日志 + 计数状态）统一放 logs/，不进仓库；刹车文件留在 .codebuddy/ 根便于 touch。 */
const logsDir = join(codebuddyDir, 'logs');
const stateFile = join(logsDir, 'auto-commit.state.json');
const offFile = join(codebuddyDir, 'auto-commit.off');
const logFile = join(logsDir, 'auto-commit.log');

const sessionId = payload.session_id ?? payload.conversation_id ?? null;

function detectEvent() {
  const name = payload.hook_event_name ?? payload.hookEventName;
  if (typeof name === 'string' && name.length > 0) return name;
  if (payload.stop_hook_active !== undefined) return 'Stop';
  if (typeof payload.prompt === 'string') return 'UserPromptSubmit';
  return '(unknown)';
}

const event = detectEvent();

/**
 * 日志轮转：长时间运行的队列会跑几百上千轮，日志只 app 不截会无限长
 * （每轮一行 JSON，约 200~400B；5000 轮就是 2MB）。
 * 超过上限就把旧文件改名成 `.1` 再重开——保留最近一段用于排查，且**永不删数据**。
 */
const LOG_MAX_BYTES = Number(process.env.AUTO_COMMIT_LOG_MAX ?? 512 * 1024);

function rotateIfNeeded() {
  try {
    const size = statSync(logFile).size;
    if (size <= LOG_MAX_BYTES) return;
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
        style: STYLE,
        ...extra,
      })}\n`,
    );
  } catch {
    /* 日志写不进去不能影响主流程 */
  }
}

function allowStop(decision, systemMessage) {
  const output = { continue: true, suppressOutput: true };
  if (systemMessage) output.systemMessage = systemMessage;
  log(`allow:${decision}`);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(0);
}

function blockStop(feedback, extra = {}) {
  log('block', extra);
  if (STYLE === 'exit2') {
    // 实测派写法：不声明硬停止，靠 exit 2 + stderr 把要求递进去。
    process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
    process.stderr.write(`${feedback}\n`);
    process.exit(2);
  }
  // 文档派写法：continue=false 表示"阻止当前流程"，reason 会注入对话历史。
  process.stdout.write(
    `${JSON.stringify({ continue: false, reason: feedback, suppressOutput: true })}\n`,
  );
  process.exit(0);
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

/** 跑 git，失败返回 null（不抛）。 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 分支

// 用户主动发言 → 重置额度，保证人工介入后还能继续自动提交
if (event === 'UserPromptSubmit') {
  saveState({ sessionId, count: 0 });
  allowStop('user-prompt-reset');
}

if (event !== 'Stop') {
  allowStop(`skip-event:${event}`);
}

if (existsSync(offFile)) {
  allowStop(
    'disabled-by-off-file',
    '自动提交检查已关闭（存在 .codebuddy/auto-commit.off），删除该文件即可恢复。',
  );
}

// 不是 git 仓库 → 放行（不要对非仓库做任何事）
if (git(['rev-parse', '--is-inside-work-tree']) === null) {
  allowStop('not-a-git-repo');
}

// 危险状态：进行中的合并/变基/挑拣，或 detached HEAD，或存在未解决冲突。
// 这些情况下"自动提交"会把别人（或自己）的历史搅乱，一律放行 + 提醒。
const gitDirRaw = git(['rev-parse', '--git-dir']);
const gitDir = gitDirRaw ? gitDirRaw.trim() : null;
if (gitDir) {
  const inProgress = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'BISECT_LOG'].find((name) =>
    existsSync(join(projectDir, gitDir, name)),
  );
  if (inProgress) {
    allowStop(
      `git-in-progress:${inProgress}`,
      `检测到 ${inProgress}，正在进行合并/变基/挑拣，已跳过自动提交检查，请手动收尾。`,
    );
  }
}

const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
if (branch === 'HEAD') {
  allowStop('detached-head', '当前处于 detached HEAD，已跳过自动提交检查。');
}

const conflicted = (git(['diff', '--name-only', '--diff-filter=U']) ?? '').trim();
if (conflicted) {
  allowStop('unmerged-conflicts', '存在未解决的合并冲突，已跳过自动提交检查。');
}

// 工作区是否干净
const porcelain = git(['status', '--porcelain']) ?? '';
const changed = porcelain
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0);

if (changed.length === 0) {
  allowStop('clean');
}

// 计数：同一个会话里最多拦这么多次
const state = loadState();
if (state.sessionId !== sessionId) {
  state.sessionId = sessionId;
  state.count = 0;
}
if (state.count >= MAX_ROUNDS) {
  allowStop(
    'max-rounds',
    `自动提交检查已达上限 ${MAX_ROUNDS} 次，本次放行。工作区仍有 ${changed.length} 个未提交改动，`
      + `请手动确认。继续可用：删除 ${stateFile}，或调大环境变量 AUTO_COMMIT_MAX。`,
  );
}
state.count += 1;
saveState(state);

// ---------------------------------------------------------------- 组装反馈

const LIST_LIMIT = 25;
const shown = changed.slice(0, LIST_LIMIT);
const more = changed.length - shown.length;

const diffstat = (git(['diff', '--stat']) ?? '').trim();
const untrackedCount = changed.filter((line) => line.startsWith('??')).length;

const feedback = [
  `[auto-commit ${state.count}/${MAX_ROUNDS}] 先别停：工作区还有 ${changed.length} 个未提交改动。`,
  '',
  '## 当前改动（git status --porcelain）',
  ...shown.map((line) => `  ${line}`),
  ...(more > 0 ? [`  …还有 ${more} 个`] : []),
  ...(diffstat ? ['', '## 已跟踪文件的改动量（git diff --stat）', ...diffstat.split('\n').map((l) => `  ${l}`)] : []),
  ...(untrackedCount > 0
    ? ['', `其中 ${untrackedCount} 个是未跟踪的新文件——新文件最容易漏提交，逐个确认。`]
    : []),
  '',
  '## 现在要做的（按顺序，全部由你自己执行，不要问我）',
  '',
  '1. **逐个文件判定归属**：只有你这一轮**亲手改的**才提交。',
  '   不是你改的（用户手改的实验代码、临时调试产物、禁用的开关）→ **不要提交**，',
  '   在回复里单列一节「用户未提交改动」说明它们是什么，替用户做主提交会造成误伤。',
  '2. **提交粒度**：一个功能点 / 一个修复 = 一条提交。',
  '   不要把多个不相关的改动攒成一条巨型提交（仓库硬性约定，见 HANDOFF.md §2）。',
  '3. **提交前自测**：`npm run check:fast`（秒级，只跑被改动命中的套件）。',
  '   如果你正准备把队列跑空 / 收尾这一批，再跑一次全量 `npm run check`。',
  '   测试没过就不要提交，先修。',
  '4. **commit message 用中文**，跟着这个仓库已有的风格：',
  '   - 功能 / 修复：`批次 NNN：<模块> <做了什么>`',
  '   - 文档 / 记忆：`docs: <改了什么>`、`memory: <记了什么>`',
  '   - 正文写清两件事：**改了什么**、**怎么验证的**（断言数、实测数据、测试套数）。',
  '5. **只 add 具体文件路径**：`git add src/a.ts src/b.ts`。',
  '   禁止 `git add -A` / `git add .`（会把别人的改动和临时文件一起卷进来），',
  '   禁止 `git commit --amend`（优先新提交），禁止跳过钩子（`--no-verify`）。',
  '6. **提交后 `git push`**。push 失败（网络、远端有新提交）就记录原因、',
  '   用普通 merge 或新提交解决，**不要 force push、不要 rewrite 历史**；',
  '   push 失败不阻塞你继续干活，但要在回复里说清楚。',
  '7. 全部处理完再停。注意：停下后我会**再检查一次**；',
  '   若工作区仍有你认定不该提交的改动，我会重复提醒，直到达到次数上限才放行。',
  '   所以不要指望"解释一句就过去"——要么提交，要么在回复里明确列出这些文件并说明归属。',
].join('\n');

blockStop(feedback, {
  count: state.count,
  changedCount: changed.length,
  untrackedCount,
  branch,
});

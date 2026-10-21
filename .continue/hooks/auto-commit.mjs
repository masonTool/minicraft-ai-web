#!/usr/bin/env node
/**
 * Stop 钩子 · 提交守卫
 *
 * **脚本自己不做任何 git 写操作**（不 add / 不 commit / 不 push）。
 * 它只负责"拦人"：把变更清单和提交要求注入回去，由 AI 自己 review、自己写 message、自己提交。
 * 理由：commit message 的质量取决于"知不知道自己为什么这么改"，
 * 脚本拿 diff 拼出来只能是 `update files`，等于把版本历史的价值丢掉。
 *
 * 生命周期：Stop → 有脏文件 → 拦住给要求 → AI 提交 → 再 Stop → 干净 → 放行。
 *
 * **自测门禁（可选，按需开启）**：`.continue/config.json` 配了 `checks.fast` 时，
 * 拦人之前先由脚本**亲自跑一遍**检查：
 *   · 失败 → 改发"先修，不要提交"（附输出末尾 30 行）；
 *   · 通过 → 正常要求提交，并把"已验证"写进反馈；
 *   · 命令不存在 / 超时 → fail-open（框架跑不动不能把活卡死），但要求 AI 如实说明。
 * 结果按工作区指纹缓存，同一份改动不重复跑。没配 `config.json` 时行为与以前完全一致。
 *
 * 四道放行（后三道是危险 git 状态，拦人反而会掩盖问题）：
 *   1. 不是 git 仓库；
 *   2. merge / rebase / cherry-pick / bisect 进行中；
 *   3. detached HEAD；
 *   4. 存在未解决冲突。
 *
 * ⚠️ 第 3 道**不能**用 `.git/REBASE_HEAD` 是否存在来判断：rebase 结束后它常常留在原地，
 * 旧项目就因为这个残留文件让守卫**永久静默失效**（日志里每轮都是 `allow:git-in-progress`），
 * 而且没人发现。只认 `rebase-merge/` / `rebase-apply/` 这类目录与进行中的标记文件。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CONTINUE_DIR,
  PROJECT_ROOT,
  appendLog,
  detectEvent,
  emitAllow,
  loadConfig,
  loadState,
  readPayload,
  runCheck,
  saveState,
  sessionId,
  tail,
} from './lib.mjs';

const STYLE = process.env.AUTO_COMMIT_STYLE === 'json' ? 'json' : 'exit2';

const payload = readPayload();
const event = detectEvent(payload);
const sid = sessionId(payload);

if (event !== 'Stop') emitAllow();

/** 紧急刹车（沿用本项目旧钩子的约定）：提交守卫同样有一个独立的开关。 */
if (existsSync(join(CONTINUE_DIR, 'auto-commit.off'))) {
  if (sid) appendLog(sid, 'Commit · 放行 · 存在刹车文件 auto-commit.off');
  emitAllow('提交守卫已关闭（存在 .continue/auto-commit.off），删除该文件即可恢复。');
}

/** 跑 git，失败返回 null（不抛）。 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

if (git(['rev-parse', '--is-inside-work-tree']) === null) emitAllow('当前目录不是 git 仓库，跳过。');

const gitDirRaw = git(['rev-parse', '--git-dir']);
const gitDir = gitDirRaw ? gitDirRaw.trim() : null;

if (gitDir) {
  /**
   * git-dir 可能是相对路径（`.git`）也可能是绝对路径（worktree / submodule），
   * 用 resolve 统一——`join(root, '/abs')` 会拼成 `root/abs`，那是错的。
   */
  const gitPath = (name) => join(resolve(PROJECT_ROOT, gitDir), name);
  const inProgressDir = ['rebase-merge', 'rebase-apply'].find((name) => existsSync(gitPath(name)));
  const inProgressFile = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'BISECT_LOG'].find((name) =>
    existsSync(gitPath(name)),
  );
  const inProgress = inProgressDir ?? inProgressFile;
  if (inProgress) {
    if (sid) appendLog(sid, `Commit · 放行 · git 进行中（${inProgress}）`);
    emitAllow(`检测到 ${inProgress}，正在合并/变基/挑拣，已跳过提交检查，请手动收尾。`);
  }
}

const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
if (branch === 'HEAD') {
  if (sid) appendLog(sid, 'Commit · 放行 · detached HEAD');
  emitAllow('当前处于 detached HEAD，已跳过提交检查。');
}

if ((git(['diff', '--name-only', '--diff-filter=U']) ?? '').trim()) {
  if (sid) appendLog(sid, 'Commit · 放行 · 存在未解决冲突');
  emitAllow('存在未解决的合并冲突，已跳过提交检查。');
}

const changed = (git(['status', '--porcelain']) ?? '')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0);

if (changed.length === 0) {
  if (sid) appendLog(sid, 'Commit · 放行 · 工作区干净');
  emitAllow();
}

const LIST_LIMIT = 25;
const shown = changed.slice(0, LIST_LIMIT);
const more = changed.length - shown.length;
const untracked = changed.filter((line) => line.startsWith('??')).length;

if (sid) appendLog(sid, `Commit · 拦截 · ${changed.length} 个未提交改动（未跟踪 ${untracked}）`);

// ---------------------------------------------------------------- 自测门禁（可选）

/**
 * 配置了 `.continue/config.json` 的 `checks.fast` 才启用；没配就完全跳过。
 *
 * 为什么由**钩子**跑，而不是让 AI 自证："我已经跑过了"这句话没法验证，
 * 而钩子跑出来的退出码可以。这也正是参考项目缺的那一环——它只在提示词里
 * 要求自测，靠自觉。
 *
 * 缓存键是**工作区指纹**（`git diff HEAD` + 未跟踪文件清单的 sha1）：
 * 同一份改动只跑一次，AI 改完再 Stop 时指纹变了才重跑。不缓存的话
 * 每轮 Stop 都跑一遍检查，长队列会被拖成龟速。
 */
const config = loadConfig();
const fastCmd = String(config?.checks?.fast ?? '').trim();
const checkTimeout = Number(config?.checks?.timeoutSec ?? 180);

function workspaceFingerprint(cmd) {
  const diff = git(['diff', 'HEAD', '--binary']) ?? '';
  // 未跟踪文件只在 `git diff` 里缺席，光列文件名不够——改了内容指纹也不变，
  // 结果就是"上次的失败结论被一直复用"。这里补上 路径:大小:修改时间。
  const untrackedFiles = (git(['ls-files', '-o', '--exclude-standard']) ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const untrackedStats = untrackedFiles.map((rel) => {
    try {
      const s = statSync(join(PROJECT_ROOT, rel));
      return `${rel}:${s.size}:${s.mtimeMs}`;
    } catch {
      return `${rel}:?`;
    }
  });
  return createHash('sha1')
    .update(String(cmd)) // 换了检查命令必须重跑，不能复用旧结论
    .update('\u0000')
    .update(diff.slice(0, 4 * 1024 * 1024))
    .update('\u0000')
    .update(untrackedStats.join('\n'))
    .digest('hex');
}

let check = null;
if (fastCmd) {
  const stateKey = sid ?? 'shared';
  const commitState = loadState(stateKey, 'commit');
  const fp = workspaceFingerprint(fastCmd);
  const cached = commitState.check;

  if (cached && cached.fp === fp && cached.cmd === fastCmd) {
    check = { ...cached, cached: true };
  } else {
    const res = runCheck(fastCmd, checkTimeout);
    check = {
      fp,
      ok: res.ok,
      ms: res.ms,
      timedOut: res.timedOut,
      error: res.error,
      output: tail(res.output, 30),
      cmd: fastCmd,
      at: new Date().toISOString(),
    };
    commitState.check = check;
    saveState(stateKey, commitState, 'commit');
  }

  const verdict = check.ok === true ? '通过' : check.ok === false ? '失败' : '无法执行';
  if (sid) {
    appendLog(
      sid,
      `Commit · 自测${verdict} · ${Math.round((check.ms ?? 0) / 1000)}s · ${fastCmd}${check.cached ? '（缓存）' : ''}`,
    );
  }
}

const checkLine =
  check === null
    ? ''
    : check.ok === true
      ? `> 自测已通过（\`${check.cmd}\`，${Math.round(check.ms / 1000)}s${check.cached ? '，本轮改动未变、复用上次结果' : ''}）。提交时把这条写进 commit message 的"验证"部分。`
      : check.timedOut
        ? `> ⚠️ 自测命令超时（${checkTimeout}s）未拿到结论，**不要谎称测过**；要么调大 \`checks.timeoutSec\`，要么在回复里说明"检查超时未验证"。`
        : `> ⚠️ 自测命令无法执行（${check.error ?? '未知原因'}），本次未做验证；在回复里说明。`;

const checkFailed = check !== null && check.ok === false;

const feedback = checkFailed
  ? [
      `[auto-commit] 自测没通过 —— 先修，**不要提交**：`,
      '',
      `命令：\`${check.cmd}\`（${Math.round(check.ms / 1000)}s）`,
      '',
      '## 输出末尾',
      '```',
      check.output || '(命令没有任何输出，但退出码非 0)',
      '```',
      '',
      '## 现在要做的',
      '1. 先定位并修掉这个失败，**不要**用"跳过测试""注释掉断言""加 --force"糊过去；',
      '2. 修完再跑一次，通过了才会进入提交环节；',
      '3. 如果判断测试本身写错了（断言与需求不符），**弹窗问用户**，不要自己改断言。',
      '',
      '> 门禁规则：工作区有改动且 `checks.fast` 失败时，不许提交。',
      '> 想临时关掉：删掉 `.continue/config.json` 里的 `checks.fast`。',
    ].join('\n')
  : [
      `[auto-commit] 工作区还有 ${changed.length} 个未提交改动：`,
      '',
      ...shown.map((line) => `  ${line}`),
      ...(more > 0 ? [`  …还有 ${more} 个`] : []),
      '',
      '针对当前会话的变更内容执行以下工作流：',
      '1) 自动 review 代码，检查代码合理性、架构合理性、修改有效性；',
      '2) review 通过之后，自动生成简要的提交信息（commit message），',
      '   正文写清"改了什么"和"怎么验证的"（测试命令与结果，不要写"已测试"这种空话）；',
      '3) 自动 commit 并 push 到当前分支。',
      ...(checkLine ? ['', checkLine] : []),
      '',
      '> 只提交本会话的改动：`git add <具体路径>`，不要 `git add -A`；不是你改的文件在回复里单列说明。',
      '> 停不下来就会一直提醒——唯一的放行条件是工作区干净。',
    ].join('\n');

if (STYLE === 'json') {
  process.stdout.write(
    `${JSON.stringify({ continue: false, reason: feedback, suppressOutput: true })}\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `${JSON.stringify({ continue: true, suppressOutput: true })}\n`,
);
process.stderr.write(`${feedback}\n`);
process.exit(2);

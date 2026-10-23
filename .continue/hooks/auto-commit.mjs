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
 *   · 命令不存在 / 超时 → 不当成测试失败（否则会一直催 AI"去修测试"），
 *     照常要求提交，但把"未验证"写进反馈，要求 AI 如实说明。
 * 结果按工作区指纹缓存，同一份改动不重复跑。没配 `config.json` 时行为与以前完全一致。
 *
 * 四道放行（后三道是危险 git 状态，拦人反而会掩盖问题）：
 *   0. 刹车开着（`.continue/auto.off`）；同一份改动已拦满 `AUTO_COMMIT_MAX_BLOCKS` 次；
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
  setLogTag,
  PROJECT_ROOT,
  BRAKE_REL,
  appendLog,
  brakeOn,
  emitAllow,
  loadConfig,
  loadState,
  readPayload,
  resolveEvent,
  runCheck,
  saveState,
  sessionId,
  tail,
} from './lib.mjs';

const STYLE = process.env.AUTO_COMMIT_STYLE === 'json' ? 'json' : 'exit2';

const payload = readPayload();
const event = resolveEvent(payload);
setLogTag('auto-commit', event);
const sid = sessionId(payload);

if (event !== 'Stop') emitAllow();

/**
 * 存活埋点（T16）：每次 Stop 都记一笔 `stopSeen`，**空转放行也留一行**。
 * 没有它，"守卫放行了"和"守卫没跑"在日志里完全一样（见 TIPS「门禁体系」）。
 */
if (sid) {
  const liveState = loadState(sid, 'commit');
  liveState.stopSeen = (liveState.stopSeen ?? 0) + 1;
  liveState.lastStopAt = new Date().toISOString();
  saveState(sid, liveState, 'commit');
}

if (brakeOn()) {
  if (sid) appendLog(sid, '空转 · 刹车已开', 'commit');
  emitAllow(`刹车已开（${BRAKE_REL}），跳过提交检查；删掉该文件即恢复。`);
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
    if (sid) appendLog(sid, `放行 · git 进行中（${inProgress}）`, 'commit');
    emitAllow(`检测到 ${inProgress}，正在合并/变基/挑拣，已跳过提交检查，请手动收尾。`);
  }
}

const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();
if (branch === 'HEAD') {
  if (sid) appendLog(sid, '放行 · detached HEAD', 'commit');
  emitAllow('当前处于 detached HEAD，已跳过提交检查。');
}

if ((git(['diff', '--name-only', '--diff-filter=U']) ?? '').trim()) {
  if (sid) appendLog(sid, '放行 · 存在未解决冲突', 'commit');
  emitAllow('存在未解决的合并冲突，已跳过提交检查。');
}

const changed = (git(['status', '--porcelain']) ?? '')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0)
  /**
   * **排除队列文件**：`auto-continue` 递任务时会把 `[ ]` 改成 `[~]`，那是钩子的正常工作痕迹，
   * 不是"你还有活没提交"。不排掉的话，每轮 Stop 都会因为钩子自己刚改的那一行判脏、
   * 反复催提交——而那次改动本来就不该由人提交（收尾时会整份归档）。
   */
  .filter((line) => !line.includes('.continue/doing/'));

/**
 * 干净就放行。但**不能一声不吭**——旧版在这里直接 return，结果是整个
 * 「提交守卫」日志区永远空白，排查时分不清"守卫正常放行"和"守卫压根没跑起来"
 * （本轮验证时真踩到了：日志区全空，无法判断这段链路是否生效）。
 *
 * 口径（T16 起）：**每次 Stop 都记一行**。状态切换时多带一句"上一轮的改动已提交"，
 * 其余记 `空转 · 工作区干净`。旧口径是"只在状态切换时记"，代价是正常的连续放行
 * 在日志里一片空白——和"守卫没跑"没法区分。每轮回一行、区内 500 行封顶，这个代价可以付。
 */
if (changed.length === 0) {
  if (sid) {
    const commitState = loadState(sid, 'commit');
    appendLog(
      sid,
      commitState.dirty === true
        ? '放行 · 工作区已干净（上一轮的改动已提交）'
        : '空转 · 工作区干净',
      'commit',
    );
    commitState.dirty = false;
    commitState.guard = null; // 干净了就清零拦截计数，下次脏了重新给满额度
    saveState(sid, commitState, 'commit');
  }
  emitAllow();
}

const LIST_LIMIT = 25;
const shown = changed.slice(0, LIST_LIMIT);
const more = changed.length - shown.length;
const untracked = changed.filter((line) => line.startsWith('??')).length;

/**
 * 同一份改动最多拦 `MAX_BLOCKS` 次，之后放行。
 *
 * 为什么存在（挡的是哪种事故）：守卫唯一的放行条件是"工作区干净"，而它又只让 AI 提交
 * 本会话的文件。脏文件不属于本会话（用户自己的未完成改动 / 别的会话）、或检查失败 AI 修不动时，
 * 工作区**永远不会变**，于是每次 Stop 都被拦回去——也就是"无限循环烧钱"。
 * 判据用**工作区指纹**而不是轮次：只要 AI 真的动了文件（提交 / 修复），指纹变化就重新计数。
 */
const MAX_BLOCKS = Math.max(1, Number(process.env.AUTO_COMMIT_MAX_BLOCKS ?? 2));
const guardFp = workspaceFingerprint('guard');
const guardKey = sid ?? 'shared';
const guardState = loadState(guardKey, 'commit');
const sameAsLast = guardState.guard?.fp === guardFp;
const blocksSoFar = sameAsLast ? guardState.guard.n ?? 0 : 0;

if (blocksSoFar >= MAX_BLOCKS) {
  if (sid && guardState.guard?.released !== true) {
    appendLog(sid, `放行 · 同一份改动已拦 ${blocksSoFar} 次未变化，不再拦`, 'commit');
    guardState.guard = { ...guardState.guard, released: true };
    saveState(guardKey, guardState, 'commit');
  }
  emitAllow(
    `工作区还有 ${changed.length} 个未提交改动，但同一份改动已提醒 ${blocksSoFar} 次没有变化，不再拦。` +
      `需要处理的话请人工提交 / 暂存；想彻底关掉守卫：touch ${BRAKE_REL}`,
  );
}
guardState.guard = { fp: guardFp, n: blocksSoFar + 1 };
saveState(guardKey, guardState, 'commit');

if (sid) {
  appendLog(sid, `拦截 · ${changed.length} 个未提交改动（未跟踪 ${untracked}）`, 'commit');
  // 记下"现在有脏文件"，下次干净时才知道该写"已提交"而不是"就绪"（见上面那条分支）
  const dirtyState = loadState(sid, 'commit');
  if (dirtyState.dirty !== true) {
    dirtyState.dirty = true;
    saveState(sid, dirtyState, 'commit');
  }
}

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
      `自测${verdict} · ${Math.round((check.ms ?? 0) / 1000)}s · ${fastCmd}${check.cached ? '（缓存）' : ''}`,
      'commit',
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

/**
 * push 默认**做**（模板 `config.json` 写 `git.push: true`）：提交完顺手推到当前分支，
 * 省掉"本地提交了但远端没有"的半截状态。要回到只提交，把 `git.push` 设成 `false`。
 */
const pushEnabled = config?.git?.push === true;

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
      pushEnabled
        ? '3) 自动 commit 并 push 到当前分支（**不要 force push**；推送失败如实报告，别改写历史）。'
        : '3) 自动 commit（**不要 push**；`.continue/config.json` 里 `git.push` 为 false，推送由用户决定）。',
      ...(checkLine ? ['', checkLine] : []),
      '',
      '> 只提交本会话的改动：`git add <具体路径>`，不要 `git add -A`；不是你改的文件在回复里单列说明。',
      '> 脏文件若确实不属于本会话（别的会话 / 用户的未完成改动），**不要硬提交**：列出来并说明，',
      '  由用户决定怎么处理（提交 / 暂存 / `touch .continue/auto.off` 关守卫）。',
      `> 同一份改动最多提醒 ${MAX_BLOCKS} 次；改动有变化会重新计数。`,
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

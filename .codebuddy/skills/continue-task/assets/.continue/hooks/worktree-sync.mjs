#!/usr/bin/env node
/**
 * 工作树的**收尾同步**：把树分支垫到父树当前分支上，再合回父分支。
 *
 * 用法（一律在**树里**跑）：
 *   node .continue/hooks/worktree-sync.mjs                 探测：打印父子关系、能否同步、下一步命令
 *   node .continue/hooks/worktree-sync.mjs --json          同上，机器可读（e2e / 自检用）
 *   node .continue/hooks/worktree-sync.mjs --run=rebase    当前树：git rebase <父分支>
 *   node .continue/hooks/worktree-sync.mjs --run=merge     父树：  git merge --no-ff <当前树分支>
 *   node .continue/hooks/worktree-sync.mjs --run=push      推当前树分支（force-with-lease）与父分支（普通推）
 *
 * 为什么拆成"一步一条命令"而不是一条命令串到底：
 *   rebase 与 merge 都可能中途停下等人解冲突，而**解冲突必须看语义**（保留哪边、怎么合并），
 *   脚本替人选等于悄悄丢代码。所以脚本只做确定性的那部分：认父树、查前置、执行单步、
 *   冲突时把文件和下一步命令摆出来；谁改哪几行由 AI / 人决定。
 *
 * **冲突不 abort**：退出码 3 把现场原样留着（`rebase-merge/` 或 `MERGE_HEAD` 还在），
 *   上层按注入要求解完 `--continue`；真解不动再 `--abort`。脚本自己 abort 会把"解到一半"变成"白做一遍"。
 *
 * **父树怎么认**（这是本脚本存在的第一个理由）：解析 `git worktree list --porcelain`，
 *   取路径是当前树根**严格祖先**的最长一条。不从 `../../..` 推：`.continue` 改名、手工移动目录、
 *   递归多层都会让路径推断错位，而 worktree 列表是 git 自己维护的事实。
 *   父分支同理取该条目的 `branch` 字段——`continue/<父目录名>-<名字>` 只能推出目录名，
 *   推不出父树此刻停在哪个分支；detached 就停手，不猜。
 *
 * 退出码：0 成功 / 无需同步 · 1 前置条件不满足或执行失败 · 2 用法错误 · 3 有冲突等人解。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { PROJECT_ROOT, appendLog, loadConfig, setLogTag } from './lib.mjs';

/**
 * 路径归一：`git worktree list` 给的是**真实路径**（macOS 上 `/var` 实为 `/private/var`），
 * 而 `process.cwd()` 可能是符号链接形态。不统一就会把"父树就在头顶"判成"没有父树"。
 */
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const args = process.argv.slice(2);
const json = args.includes('--json');
const runArg = args.find((a) => a.startsWith('--run='));
const step = runArg ? runArg.slice('--run='.length) : null;
const STEPS = ['rebase', 'merge', 'push'];

function usage(code = 2) {
  console.error(
    [
      '用法：node .continue/hooks/worktree-sync.mjs [--json] [--run=rebase|merge|push]',
      '',
      '  不带 --run  只看探测结果与下一步该跑什么（主工作区里跑会明确说"无需同步"）',
      '  --run=rebase  当前树 rebase 到父分支（要求当前树干净、非 detached、没有进行中的合并/变基）',
      '  --run=merge   父树 merge --no-ff 当前树分支（要求父树干净、非 detached）',
      '  --run=push    推当前树分支（仅 continue/ 前缀，force-with-lease）；config.json 的 git.push 为 true 时顺带推父分支',
      '',
      '退出码：0 成功 · 1 前置不满足 · 2 用法错误 · 3 有冲突需要解',
    ].join('\n'),
  );
  process.exit(code);
}

if (step && !STEPS.includes(step)) {
  console.error(`不认识的 --run=${step}`);
  usage();
}

/**
 * 跑 git，永不抛；`status` 归一成数字（spawn 失败时是 null）。
 *
 * `ROOT` 用 `let` 并在首次调用后才定稿（见下面），所以默认值在函数体里取——
 * 写成参数默认值会在模块初始化时就被求值，那时 ROOT 还没算出来。
 */
let ROOT = real(PROJECT_ROOT);
function git(list, cwd) {
  const r = spawnSync('git', list, {
    cwd: cwd ?? ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: typeof r.status === 'number' ? r.status : 1,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim(),
  };
}

/**
 * 以 **cwd** 为准，而不是脚本所在位置。
 *
 * 为什么：同一份脚本可能从树外被调用（自检夹具、用户 `cd` 到别的树里跑绝对路径），
 * 而"操作哪棵树"在本框架里一直由 cwd 决定（钩子是相对路径注册的）。
 * 脚本位置只在 cwd 不是 git 仓库时兜底——最坏退化成"按装脚本的那个项目算"。
 */
const CWD = real(process.cwd());
if (git(['rev-parse', '--is-inside-work-tree'], CWD).out === 'true') ROOT = CWD;

/** cwd/指定目录是不是一棵并行工作树（`--git-dir` 与 `--git-common-dir` 不同）。 */
function inWorktreeAt(root = ROOT) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], root).out;
  const commonDir = git(['rev-parse', '--git-common-dir'], root).out;
  if (!gitDir || !commonDir) return false;
  return real(resolve(root, commonDir)) !== real(gitDir);
}

// ---------------------------------------------------------------- 父树与父分支

/**
 * `git worktree list --porcelain` 的条目。
 *
 * 手工解析而不是 `-z`/JSON：porcelain 的输出是逐行 `key value`、空行分隔，
 * 字段就四个（worktree / HEAD / branch / detached|bare），比引 JSON 解析器轻。
 */
function worktrees() {
  const r = git(['worktree', 'list', '--porcelain']);
  if (r.status !== 0) return [];
  const list = [];
  let cur = null;
  for (const line of r.out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: real(line.slice('worktree '.length)), head: null, branch: null, detached: false, bare: false };
      list.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
  }
  return list;
}

/** `child` 是否在 `parent` 之下（严格，不含相等）。 */
function isUnder(child, parent) {
  const base = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child !== parent && child.startsWith(base);
}

/**
 * 直接父树：所有严格祖先里路径最长的那条。
 *
 * 为什么取最长：递归建树时 `<主树>/.worktree/a/.worktree/b` 同时是 a 与主树的祖先，
 * 只认**直接**父树才不会把两层合成一次跳跃（那会绕过中间层的核对）。
 */
function parentWorktree() {
  const all = worktrees();
  const root = real(ROOT);
  return all
    .filter((w) => isUnder(root, w.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

const self = worktrees().find((w) => w.path === real(ROOT)) ?? null;
const parent = parentWorktree();

/** 当前分支（短名）；detached 时是 `HEAD`。 */
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out || 'HEAD';

/** `git rev-parse --git-path <name>` 落在哪个绝对路径（rebase-merge 这类目录不在固定位置）。 */
function gitPath(name, cwd) {
  const r = git(['rev-parse', '--git-path', name], cwd);
  return r.status === 0 ? resolve(cwd, r.out) : null;
}

/** 这个仓库当前是否处在"合并/变基/挑拣/二分"中间。 */
function inProgress(cwd) {
  const dir = ['rebase-merge', 'rebase-apply'].find((name) => {
    const p = gitPath(name, cwd);
    return p && existsSync(p);
  });
  if (dir) return dir;
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'BISECT_LOG'].find((name) => {
    const p = gitPath(name, cwd);
    return p && existsSync(p);
  }) ?? null;
}

function dirty(cwd) {
  return git(['status', '--porcelain'], cwd).out;
}

/** 冲突文件（未合并路径）。 */
function conflicts(cwd) {
  return git(['diff', '--name-only', '--diff-filter=U'], cwd)
    .out.split(/\r?\n/)
    .filter(Boolean);
}

/**
 * 前置条件。返回 `{ problems, parentBranch, branch }`。
 *
 * 分步检查：rebase 只看当前树（父树脏不影响 rebase 到它的分支），merge 只看父树
 * （当前树已 rebase 完、可能还带着未推送的提交，但不影响父树那边合并）。
 */
function preflight(kind) {
  const problems = [];
  if (!inWorktreeAt() || !parent) {
    problems.push('当前目录不是工作树（没有父树可同步）');
    return { problems };
  }
  if (!parent.branch) {
    problems.push(`父树 ${parent.path} 处于 detached HEAD，无法确定父分支`);
  }
  const branch = currentBranch === 'HEAD' ? null : currentBranch;
  if (!branch) problems.push('当前树处于 detached HEAD，无法确定要推的分支');

  if (kind === 'rebase' || kind === 'push') {
    const busy = inProgress(ROOT);
    if (busy) problems.push(`当前树有进行中的操作（${busy}），先收尾或 abort 再来`);
  }
  if (kind === 'rebase') {
    if (dirty(ROOT)) problems.push('当前树工作区不干净：同步要在**收尾提交之后**跑');
  }
  if (kind === 'merge') {
    const target = parent.path;
    const busy = inProgress(target);
    if (busy) problems.push(`父树有进行中的操作（${busy}）`);
    if (dirty(target)) problems.push('父树工作区不干净：先让那边提交或 stash，别把它的改动卷进合并');
  }
  if (kind === 'push' && branch && !/^continue\//.test(branch)) {
    problems.push(`当前分支 ${branch} 不是 continue/ 前缀：本脚本只为自己建的树分支开 force-with-lease 例外`);
  }
  return { problems, parentBranch: parent.branch, branch };
}

// ---------------------------------------------------------------- 输出

const sid =
  [process.env.CODEBUDDY_SESSION_ID, process.env.WORKBUDDY_SESSION_ID].find(
    (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{4,}$/.test(v),
  ) ?? null;
setLogTag('worktree-sync', 'manual');

function report(lines) {
  if (json) return;
  // 两个调用形态都在用：探测分支传的是已 join 好的字符串，执行分支传的是数组。
  console.log(Array.isArray(lines) ? lines.join('\n') : lines);
}

function log(line) {
  if (sid) appendLog(sid, line, 'auto');
}

function fail(code, lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, code, step, tree: ROOT, branch: currentBranch, parent: parent && { path: parent.path, branch: parent.branch }, message: text })}\n`,
    );
  } else {
    console.error(text);
  }
  log(`失败 · ${text.split('\n')[0]}`);
  process.exit(code);
}

// ---------------------------------------------------------------- 探测（无 --run）

if (!step) {
  /**
   * 主工作区不是"前置条件不满足"，而是"这件事跟它无关"：收尾照样是五步。
   * 把它归成错误（退出码 1）会让 `&&` 链与 e2e 断言分不清"正常无需同步"和"树里出了问题"。
   */
  const inTree = inWorktreeAt() && !!parent;
  const p = inTree ? preflight('rebase') : { problems: [] };
  const steps = [];
  if (inTree && parent.branch) {
    steps.push(`node .continue/hooks/worktree-sync.mjs --run=rebase   # 当前树 → ${parent.branch}`);
    steps.push('（rebase 若冲突：解文件 → git add → git rebase --continue；回退用 git rebase --abort）');
    steps.push('node .continue/hooks/worktree-sync.mjs --run=merge    # 合回父分支');
    steps.push('node .continue/hooks/worktree-sync.mjs --run=push');
  }
  const data = {
    ok: p.problems.length === 0,
    kind: inTree ? 'worktree' : 'main',
    tree: { path: PROJECT_ROOT, branch: currentBranch, head: self?.head ?? null },
    parent: parent ? { path: parent.path, branch: parent.branch } : null,
    canSync: inTree && p.problems.length === 0,
    problems: p.problems,
    steps,
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(data)}\n`);
    process.exit(inTree && p.problems.length > 0 ? 1 : 0);
  }
  if (!inTree) {
    report([
      '工作树收尾同步 · 探测',
      '',
      `  当前树：${ROOT}（分支 ${currentBranch}）`,
      '  父  树：（没有——这是主工作区，或父树已不存在）',
      '',
      '状态：无需同步。主工作区没有父分支可合，收尾走正常五步即可。',
    ].join('\n'));
    process.exit(0);
  }
  report([
    '工作树收尾同步 · 探测',
    '',
    `  当前树：${ROOT}`,
    `          分支 ${currentBranch}`,
    `  父  树：${parent.path}`,
    `          分支 ${parent.branch ?? '（detached HEAD）'}`,
    '',
    p.problems.length === 0 ? '状态：可以同步。按顺序执行：' : '状态：现在不能同步——',
    ...p.problems.map((x) => `  · ${x}`),
    ...(steps.length > 0 ? ['', ...steps.map((x) => `  ${x}`)] : []),
    '',
    '说明：冲突时脚本以退出码 3 停下并列出文件，**不自动 abort**；解完再接着走下一步。',
  ].join('\n'));
  process.exit(p.problems.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 执行单步

const pf = preflight(step);
if (pf.problems.length > 0) {
  fail(1, [`[${step}] 前置条件不满足：`, ...pf.problems.map((x) => `  · ${x}`)]);
}

const parentBranch = pf.parentBranch;
const branch = pf.branch;

if (step === 'rebase') {
  // 已经包含父分支 → 不必重写历史（也让重复执行保持幂等）。
  if (git(['merge-base', '--is-ancestor', parentBranch, 'HEAD']).status === 0) {
    log(`跳过 · 树分支已包含 ${parentBranch}`);
    report([`已是最新：${branch} 已经包含 ${parentBranch}，无需 rebase。`]);
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, step, noop: true })}\n`);
    process.exit(0);
  }
  const r = git(['rebase', parentBranch]);
  if (r.status === 0) {
    log(`rebase 成功 · ${branch} → ${parentBranch}`);
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, step, branch, onto: parentBranch })}\n`);
    report([`rebase 成功：${branch} 已垫到 ${parentBranch} 上。下一步：--run=merge`]);
    process.exit(0);
  }
  const files = conflicts(ROOT);
  log(`rebase 冲突 · ${files.length} 个文件`);
  fail(3, [
    `rebase 冲突（${parentBranch} ← ${branch}），${files.length} 个文件要解：`,
    ...files.map((f) => `  · ${f}`),
    '',
    '现在要做的是**看语义**解冲突，不是脚本能替你选：',
    '  1. 逐个改冲突文件（保留两边都需要的改动，删掉冲突标记）；',
    '  2. `git add <文件>`；',
    '  3. `git rebase --continue`（还有下一个冲突会再次停下，重复 1~3）；',
    '  4. 判断解不动（涉及别人未完成的工作 / 拿不准取舍）→ `git rebase --abort` 退回，交给用户。',
    '',
    '不建议 `--skip`：它会让这批改动无声地从历史里消失。',
  ].join('\n'));
}

if (step === 'merge') {
  // 父分支已经包含这条树分支 → 合过了，幂等返回。
  if (git(['merge-base', '--is-ancestor', branch, parentBranch], parent.path).status === 0) {
    log(`跳过 · ${parentBranch} 已包含 ${branch}`);
    report([`已是最新：${parentBranch} 已经包含 ${branch}，无需合并。`]);
    if (json) process.stdout.write(`${JSON.stringify({ ok: true, step, noop: true })}\n`);
    process.exit(0);
  }
  const r = git(['merge', '--no-ff', '--no-edit', branch], parent.path);
  if (r.status === 0) {
    log(`merge 成功 · ${branch} → ${parentBranch}`);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, step, branch, into: parentBranch, parent: parent.path })}\n`);
    }
    report([`合并成功：${branch} 已合进父树的 ${parentBranch}。下一步：--run=push`]);
    process.exit(0);
  }
  const files = conflicts(parent.path);
  log(`merge 冲突 · ${files.length} 个文件`);
  fail(3, [
    `merge 冲突（${parentBranch} ← ${branch}），${files.length} 个文件要解：`,
    ...files.map((f) => `  · ${f}`),
    '',
    `冲突发生在**父树**：${parent.path}`,
    '  1. 到父树目录处理冲突文件，`git add <文件>`；',
    `  2. \`git -C ${parent.path} commit --no-edit\` 收掉这次合并；`,
    `  3. 解不动 → \`git -C ${parent.path} merge --abort\` 退回并交给人。`,
    '',
    '注意：父树可能有别的会话在跑，abort 之前先确认没人在改同一批文件。',
  ].join('\n'));
}

if (step === 'push') {
  const pushed = git(['push', '--force-with-lease', 'origin', branch]);
  if (pushed.status !== 0) {
    fail(1, [
      `推送 ${branch} 失败：`,
      `  ${pushed.err || pushed.out}`,
      '',
      '常见原因：没有 origin / 远端有人又推进了同一条分支（--force-with-lease 会挡住）。',
      '先看一眼远端再决定，别改用 --force 硬推。',
    ].join('\n'));
  }
  log(`push 成功 · ${branch}（force-with-lease）`);

  const cfg = loadConfig();
  const pushParent = cfg?.git?.push === true && !!parentBranch;
  let parentPushed = null;
  if (pushParent) {
    const r = git(['push', 'origin', parentBranch], parent.path);
    parentPushed = r.status === 0;
    if (!parentPushed) {
      fail(1, [
        `父分支 ${parentBranch} 推送失败（本地合并已完成，可以稍后重试）：`,
        `  ${r.err || r.out}`,
        `  重试：git -C ${parent.path} push origin ${parentBranch}`,
      ].join('\n'));
    }
    log(`push 成功 · 父分支 ${parentBranch}`);
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, step, branch, forceWithLease: true, parentBranch, parentPushed })}\n`,
    );
  }
  report([
    `已推送：${branch}（force-with-lease）`,
    pushParent ? `已推送父分支：${parentBranch}` : '父分支未推送（config.json 的 git.push 不为 true，或没有父分支）',
  ]);
  process.exit(0);
}

#!/usr/bin/env node
/**
 * 开一棵**并行工作树**（git worktree），用于"已有队列在跑、新任务不想排队等"的场景。
 *
 * 用法：
 *   npm run continue:worktree -- <名字> [--dry-run]
 *
 * 做什么：
 *   1. 在仓库旁边的 `<仓库名>-wt-<名字>` 建一棵 worktree；
 *   2. 在它上面开分支 `continue/<名字>`（基于当前 HEAD）；
 *   3. 立刻把这条分支推到远程（`git push -u origin continue/<名字>`）。
 *
 * **不做什么**（这些都属于"人拍板"的范围）：
 *   · 不合并、不 rebase、不删除 worktree —— 合并时机由用户决定；
 *   · 不搬任何队列 / 计划文件 —— 新会话自己 `queue-init` 建自己的。
 *
 * ⚠️ **建完之后必须在这个新路径里另开一个会话**。
 *   钩子注册在 `.codebuddy/settings.json`，命令是相对路径，**cwd 决定它操作哪棵树**；
 *   从原来那个会话里跑，读写的永远是原工作区的队列。这不是框架能绕过的，是工具边界。
 *
 * 为什么这里要主动推一次空分支：分支只在本地存在时，别人（或另一台机器上的你）
 * 看不到"这棵树上有人在干活"，而"worktree 里的分支也要提交远程"正是需求本身。
 *
 * 退出码：0 成功（含 push 失败但有明确告示）/ 2 用法错误 / 1 建树失败。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const name = args.find((a) => !a.startsWith('--'));

function usage(code = 2) {
  console.error(
    '用法：npm run continue:worktree -- <名字> [--dry-run]\n' +
      '  名字只能是字母 / 数字 / . _ -（它同时是分支名 `continue/<名字>` 和目录名的一部分）',
  );
  process.exit(code);
}

if (!name) usage();
if (!/^[A-Za-z0-9._-]+$/.test(name)) {
  console.error(`名字不合法：${name}（只允许字母 / 数字 / . _ -）`);
  usage();
}

const git = (...rest) => spawnSync('git', rest, { cwd: ROOT, encoding: 'utf8' });
const branch = `continue/${name}`;
const target = join(dirname(ROOT), `${basename(ROOT)}-wt-${name}`);

const inRepo = git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true';
if (!inRepo) {
  console.error(`${ROOT} 不是 git 仓库（或取不到 git 状态）`);
  process.exit(1);
}

/**
 * 已经在 worktree 里就不再套一层。
 * `--git-dir` 与 `--git-common-dir` 不同 ⇒ 当前目录是一棵 worktree（不是主工作区）。
 */
const gitDir = git('rev-parse', '--absolute-git-dir').stdout?.trim() ?? '';
const commonDir = git('rev-parse', '--git-common-dir').stdout?.trim() ?? '';
if (gitDir && commonDir && resolve(ROOT, commonDir) !== gitDir) {
  console.error(
    `当前目录本身就是一棵 worktree（${gitDir}）。\n` +
      '并行任务请从**主工作区**开新的树，不要在树里再开树。',
  );
  process.exit(1);
}

if (existsSync(target)) {
  console.error(`目录已存在：${target}\n要重开就先移除它（git worktree list 可以查已有哪些树）。`);
  process.exit(1);
}

const branchExists = git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
if (branchExists) {
  console.error(`分支已存在：${branch}\n换个名字，或者先删掉那条分支。`);
  process.exit(1);
}

const step = (text) => console.log(`${dryRun ? '[dry-run] ' : ''}${text}`);

step(`建 worktree：${target}`);
step(`开分支：${branch}（基于当前 HEAD）`);
step(`推到远程：git push -u origin ${branch}`);

if (dryRun) {
  console.log('\n[dry-run] 什么都没做。去掉 --dry-run 才会真的建。');
  process.exit(0);
}

const added = git('worktree', 'add', '-b', branch, target, 'HEAD');
if (added.status !== 0) {
  console.error(`建树失败：\n${added.stderr || added.stdout}`);
  process.exit(1);
}

const pushed = git('push', '-u', 'origin', branch);
if (pushed.status !== 0) {
  console.log(
    `\n⚠️ 分支已建好，但推远程失败（不影响继续干活）：\n${(pushed.stderr || '').trim()}\n` +
      `   稍后可以在那棵树里重试：git push -u origin ${branch}`,
  );
}

console.log(
  [
    '',
    '✅ 可以开工了。**下一步必须在上面那个新路径里另开一个会话**：',
    `   cd ${target}`,
    '',
    '为什么：钩子注册的是相对路径，cwd 决定它读写哪棵树的队列；',
    '从原来那个会话里跑，读写的永远是原工作区。',
    '',
    '收工后：这条分支由你决定什么时候合回主分支（框架不自动合并）；',
    `  git merge --no-ff ${branch}`,
    '合并冲突的处置约定见 `.continue/HANDOFF.md` §4「并行工作树」。',
  ].join('\n'),
);

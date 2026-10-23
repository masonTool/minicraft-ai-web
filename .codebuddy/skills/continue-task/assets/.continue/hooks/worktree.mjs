#!/usr/bin/env node
/**
 * 开一棵**并行工作树**（git worktree），用于"已有队列在跑、新任务不想排队等"的场景。
 *
 * 用法：
 *   node .continue/hooks/worktree.mjs <名字> [--task=<一句话>]... [--dry-run]
 *   （npm 项目装了 `continue:worktree` 别名时，`npm run continue:worktree -- <名字>` 等价）
 *
 * 做什么：
 *   1. 在 `.continue/doing/.worktree/<本会话 sid 前 6 位>` 建一棵 worktree（该目录已被 `.continue/.gitignore` 排除）；
 *   2. 在它上面开分支 `continue/<父目录名>-<名字>`（基于当前 HEAD）；
 *   3. 把任务写进树里的 `.continue/doing/worktree.md`（含批次号与交接说明），
 *      树里的第一个会话（`queue-init`）把它改名接管——队列就是交接载体，不需要第二份文件；
 *   4. 立刻把这条分支推到远程（`git push -u origin <分支>`）。
 *
 * **递归**：树里也可以再建树。目录名永远是"当前会话 sid 前 6 位"（每一层各自不同），
 * 分支前缀是**当前目录名**，于是从分支名就能看出它从哪一层分出去。
 * 不设层数上限：每层都是完整仓库副本，层数只打印出来提醒人（多了容易分不清谁是谁）。
 *
 * **不做什么**：
 *   · 建树时不合并不 rebase —— 但**收尾时**由 `worktree-sync.mjs` 自动把树分支垫到父树分支再合回，
 *     触发点是队列全打勾后的第 6 步（文档收尾提交之后）；
 *   · 不删除 worktree —— 清理时机由用户决定；
 *   · 不改父树的任何文件（`worktree.md` 写在树里，父树只在 git 层面多出一条 worktree 记录）。
 *
 * ⚠️ **建完之后必须在这个新路径里另开一个会话**。
 *   钩子注册在 `.codebuddy/settings.json`，命令是相对路径，**cwd 决定它操作哪棵树**；
 *   从原来那个会话里跑，读写的永远是原工作区的队列。这不是框架能绕过的，是工具边界。
 *
 * 为什么这里要主动推一次空分支：分支只在本地存在时，别人（或另一台机器上的你）
 * 看不到"这棵树上有人在干活"，而"worktree 里的分支也要提交远程"正是需求本身。
 *
 * 退出码：0 成功（含 push 失败但有明确告示）/ 1 建树失败 / 2 用法错误。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideWorktree, nextBatch, shortSid } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
/**
 * 不拉窗口。为什么必须有：自动拉窗口一旦默认开启，e2e / CI / 无 GUI 环境跑一次就会
 * 弹出一个指向临时目录的 IDE 窗口——测试污染桌面，而且没人会去关它。
 */
const noWindow = args.includes('--no-window');
/** `--task=<一句话>` 可重复：父会话知道要做什么，就直接写进交接队列。 */
const tasks = args
  .filter((a) => a.startsWith('--task='))
  .map((a) => a.slice('--task='.length).trim())
  .filter(Boolean);
const name = args.find((a) => !a.startsWith('--'));

function usage(code = 2) {
  console.error(
    '用法：node .continue/hooks/worktree.mjs <名字> [--task=<一句话>]... [--dry-run]\n' +
      '  （npm 项目装了 `continue:worktree` 别名时，`npm run continue:worktree -- <名字>` 等价）\n' +
      '  名字只能是字母 / 数字 / . _ -（它出现在分支名 `continue/<父目录名>-<名字>` 里）\n' +
      '  --task=<一句话>  写进树里的交接队列（可重复）；不给就留一条占位，等人在新会话里补\n' +
      '  --no-window      不拉 IDE 窗口（CI / 无 GUI 环境 / 自动化用例用）',
  );
  process.exit(code);
}

if (!name) usage();
if (!/^[A-Za-z0-9._-]+$/.test(name)) {
  console.error(`名字不合法：${name}（只允许字母 / 数字 / . _ -）`);
  usage();
}

const git = (...rest) => spawnSync('git', rest, { cwd: ROOT, encoding: 'utf8' });

/**
 * 分支前缀 = **当前工作区目录名**。
 *
 * 为什么不用固定前缀：递归建树时，一层层都叫 `continue/<名字>` 就分不清是哪一层分出来的；
 * 用目录名（主工作区 = 项目名，树里 = 那棵树的 sid 前 6 位）就能一眼看出血缘。
 * 非法字符（空格等）替换成 `-`：项目目录叫什么不由我们决定，但分支名必须合法。
 */
const parentName = basename(ROOT).replace(/[^A-Za-z0-9._-]/g, '-');
const branch = `continue/${parentName}-${name}`;

/**
 * 树目录：`.continue/doing/.worktree/<本会话 sid 前 6 位>`。
 *
 * 为什么放进 `doing/`：`.worktree` 是队列的附属物（待派发的队列、派发出去的树），
 * 和 `doing/*.md` 摆在一起才符合"这一批活在哪"的直觉；
 * 为什么必须 gitignore：每层都是完整仓库副本，进版本库等于把整个项目复制一遍。
 * sid 取不到（用户手工在裸终端跑）时用 `nosession`：目录名不合法会直接建树失败，
 * 而这里宁可建出来再提示"这个目录名不代表任何会话"。
 */
const sid = process.env.CODEBUDDY_SESSION_ID ?? process.env.WORKBUDDY_SESSION_ID ?? '';
const sid6 = shortSid(sid) || 'nosession';
const worktreeRoot = join(ROOT, '.continue', 'doing', '.worktree');
const target = join(worktreeRoot, sid6);
const relTarget = relative(ROOT, target);

/** 当前在第几层：路径里出现几次 `.worktree`（主工作区 = 0）。 */
const layer = ROOT.split(/[\\/]/).filter((part) => part === '.worktree').length;

const inRepo = git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true';
if (!inRepo) {
  console.error(`${ROOT} 不是 git 仓库（或取不到 git 状态）`);
  process.exit(1);
}

/**
 * 已经在 worktree 里也允许再建（用户要的递归）。
 *
 * 这里只**打印层数**，不再像旧版本那样硬拦：旧行为把"树里不能再开树"当成安全边界，
 * 但那只是"没人需要"，不是"不能做"——真正需要分层并行时它挡住了正事。
 * 代价是层数多了以后 `git worktree list` 与 IDE 窗口容易分不清，所以层数必须打出来。
 * `--git-dir` 与 `--git-common-dir` 不同 ⇒ 当前目录是一棵 worktree。
 */
const isWorktree = isInsideWorktree();

if (existsSync(target)) {
  console.error(
    `目录已存在：${target}\n` +
      '目录名就是"当前会话 sid 前 6 位"，所以同一会话只能有一棵并行树；' +
      '要么先 `git worktree remove <目录>`，要么换一个会话再建。',
  );
  process.exit(1);
}

const branchExists = git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;
if (branchExists) {
  console.error(`分支已存在：${branch}\n换个名字，或者先删掉那条分支。`);
  process.exit(1);
}

/**
 * 交接队列。**格式必须是一份合法队列**：树里的 `audit-*` 会按队列校验它
 * （文件名合法、最后一条是 `[自审]`、批次号可被 `parseBatch` 取到）。
 * 批次号在这里就用 `nextBatch()` 定下：`queue-init` 改名接管后会沿用它，
 * 于是"一批一个号、恒定不变"在跨树交接时也成立。
 */
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const batch = nextBatch();
const handoffPath = join(target, '.continue', 'doing', 'worktree.md');
const handoffBody = [
  '# 队列 · 会话 worktree（待接管）',
  '',
  '> 状态：执行中',
  `> 创建：${stamp}`,
  `> 批次：${batch}`,
  '',
  `> **待接管**：本文件由父会话 \`${sid6 === 'nosession' ? '（未知）' : sid6}\` 在 \`${ROOT}\` 建树时写下（${stamp}）。`,
  '> 接管两步：`git mv .continue/doing/worktree.md .continue/doing/<本会话 sid 前 6 位>.md`，',
  '> 再把第一行的会话 ID 改成**完整**会话 ID（`audit-docs` 会核对"前 6 位 == 文件名"）。',
  '> 不要重建队列、不要改批次号。',
  '',
  ...(tasks.length > 0
    ? tasks.map((task) => `- [ ] ${task}`)
    : ['- [ ] 父会话没有传任务（`worktree.mjs --task=<一句话>`）：请让用户在这里写下要做什么，再开始']),
  '- [ ] [自审] 本批收尾前按 `.continue/README.md` §8 审三层：`- L1：` / `- L2：` / `- L3：` 各一句 + 证据',
  '',
].join('\n');

/**
 * 拉一个新 IDE 窗口打开新树。
 *
 * 判据是**能力存在**，不是"宿主叫什么"：伪装宿主名容易误判，而"这个路径下有一个
 * 能 `-n` 开窗口的 `code` 命令"是可以直接检查的事实。
 * 找不到就打印可复制的命令——**不假装成功**（用户看不到窗口会以为是建树失败）。
 */
function findIdeCli() {
  const candidates = [
    '/Applications/CodeBuddy CN.app/Contents/Resources/app/bin/code',
    '/Applications/CodeBuddy.app/Contents/Resources/app/bin/code',
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const found = spawnSync('sh', ['-c', 'command -v code'], { encoding: 'utf8' });
  const onPath = (found.stdout ?? '').trim();
  return onPath && existsSync(onPath) ? onPath : null;
}

const ideCli = findIdeCli();
const step = (text) => console.log(`${dryRun ? '[dry-run] ' : ''}${text}`);

step(`当前层数：${layer}${isWorktree ? '（本目录本身是一棵 worktree，允许继续递归）' : '（主工作区）'}`);
step(`建 worktree：${target}`);
step(`开分支：${branch}（基于当前 HEAD）`);
step(`写交接队列：${relTarget}/.continue/doing/worktree.md（批次 ${batch}，${tasks.length > 0 ? tasks.length : 1} 条任务）`);
step(`推到远程：git push -u origin ${branch}`);
step(
  ideCli && !noWindow
    ? `拉新窗口：${ideCli} -n ${target}`
    : `拉新窗口：${noWindow ? '已跳过（--no-window）' : '没找到 CodeBuddy 的 code 入口（会打印手动命令）'}`,
);

if (dryRun) {
  console.log('\n[dry-run] 什么都没做。去掉 --dry-run 才会真的建。');
  process.exit(0);
}

const added = git('worktree', 'add', '-b', branch, target, 'HEAD');
if (added.status !== 0) {
  console.error(`建树失败：\n${added.stderr || added.stdout}`);
  process.exit(1);
}

// 空目录不入库，所以 `doing/` 在新树里可能不存在；缺了就是"交接文件写不进去"
mkdirSync(join(target, '.continue', 'doing'), { recursive: true });
writeFileSync(handoffPath, handoffBody);

/**
 * 拉窗口放在推远程之前：`code -n` 只是把请求转给已运行的 IDE 实例、几毫秒返回，
 * 而这棵树此刻已经能干活了；README 里"必须另开会话"那一步因此少一次手动操作。
 */
const opened =
  ideCli && !noWindow ? spawnSync(ideCli, ['-n', target], { stdio: 'ignore', timeout: 10000 }) : null;

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
    opened && opened.status === 0
      ? '已经让 IDE 开了一个新窗口指向它；窗口没弹出来就按上面的 cd 手动打开。'
      : `没能自动开窗口，手动打开这个目录：${target}`,
    '',
    '为什么：钩子注册的是相对路径，cwd 决定它读写哪棵树的队列；',
    '从原来那个会话里跑，读写的永远是原工作区。',
    '',
    `任务已经写进 \`${relTarget}/.continue/doing/worktree.md\`（批次 ${batch}）：`,
    '新会话第一条消息会看到"发现待接管队列"，改名即为接管，不需要你再粘贴任务。',
    '',
    '收工后：队列全打勾、文档收尾提交之后，跑 `node .continue/hooks/worktree-sync.mjs`，',
    '按 `--run=rebase` → `--run=merge` → `--run=push` 把这条分支同步回父树；',
    '冲突要按语义解（脚本不替你选），解不动就 abort 退回，处置约定见 `.continue/README.md` §7.2。',
    `手工兜底（框架自动同步跑不动时）：git merge --no-ff ${branch}`,
  ].join('\n'),
);

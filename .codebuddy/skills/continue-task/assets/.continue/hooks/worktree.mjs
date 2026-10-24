#!/usr/bin/env node
/**
 * 开一棵**并行工作树**（git worktree），用于"已有队列在跑、新任务不想排队等"的场景。
 *
 * 用法：
 *   node .continue/hooks/worktree.mjs <单词> [--task=<一句话>]... [--dry-run]
 *   （npm 项目装了 `continue:worktree` 别名时，`npm run continue:worktree -- <单词>` 等价）
 *
 * 做什么：
 *   1. 在 `.continue/doing/.worktree/worktree_<单词>_<YYYYMMDD>` 建一棵 worktree
 *      （该目录已被 `.continue/.gitignore` 排除）；单词由 AI 按这一批的需求取；
 *   2. 在它上面开**同名分支** `worktree_<单词>_<YYYYMMDD>`（基于当前 HEAD）；
 *   3. 把任务写进树里的 `.continue/doing/worktree.md`（含批次号与交接说明），
 *      树里的第一个会话（`queue-init`）把它改名接管——队列就是交接载体，不需要第二份文件；
 *   4. 立刻把这条分支推到远程（`git push -u origin <分支>`）。
 *
 * **递归**：树里也可以再建树（同一套命名，日期与单词各自独立）。
 * 不设层数上限：每层都是完整仓库副本，层数只打印出来提醒人（多了容易分不清谁是谁）。
 *
 * **不做什么**：
 *   · **不合并、不 rebase**：这一批做完就结束，合不合、什么时候合由用户自己处理
 *     （2026-10-24 起取消了收尾自动 `rebase → merge` 那一步）；
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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isInsideWorktree,
  loadConfig,
  nextBatch,
  normalizeWorktreeWord,
  shortSid,
  WORKTREE_DIR,
  worktreeName,
} from './lib.mjs';

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
const rawName = args.find((a) => !a.startsWith('--'));

function usage(code = 2) {
  console.error(
    '用法：node .continue/hooks/worktree.mjs <单词> [--task=<一句话>]... [--dry-run]\n' +
      '  （npm 项目装了 `continue:worktree` 别名时，`npm run continue:worktree -- <单词>` 等价）\n' +
      '  <单词>：按这一批的需求取一个英文词（2~16 位、字母开头，如 export / auth / perf）；\n' +
      '          目录与分支都叫 `worktree_<单词>_<YYYYMMDD>`\n' +
      '  --task=<一句话>  写进树里的交接队列（可重复）；不给就留一条占位，等人在新会话里补\n' +
      '  --no-window      不拉 IDE 窗口（CI / 无 GUI 环境 / 自动化用例用）',
  );
  process.exit(code);
}

if (!rawName) usage();
const word = normalizeWorktreeWord(rawName);
if (!word) {
  console.error(
    `单词不合法：${rawName}（要一个英文单词：2~16 位、字母开头、只含字母数字；` +
      '也可以直接给完整树名 worktree_<单词>_<YYYYMMDD>）',
  );
  usage();
}

const git = (...rest) => spawnSync('git', rest, { cwd: ROOT, encoding: 'utf8' });

/**
 * 树目录 = 分支名 = `worktree_<单词>_<YYYYMMDD>`（用户 2026-10-24 定的一处对一处）。
 *
 * 为什么放进 `doing/.worktree/`：`.worktree` 是队列的附属物（待派发的队列、派发出去的树），
 * 和 `doing/*.md` 摆在一起才符合"这一批活在哪"的直觉；
 * 为什么必须 gitignore：每层都是完整仓库副本，进版本库等于把整个项目复制一遍。
 *
 * 撞名兜底（同一天同一个单词建第二棵）：追加 `-2`、`-3`，主形态只有一种。
 * 不直接失败：递归 / 同一天连开两棵树都是正常用法，报错只会逼人来删目录。
 */
const at = new Date();
let seq = 1;
let treeName = worktreeName(word, at, seq);
while (
  seq < 100 &&
  (existsSync(join(WORKTREE_DIR, treeName)) ||
    git('rev-parse', '--verify', '--quiet', `refs/heads/${treeName}`).status === 0)
) {
  seq += 1;
  treeName = worktreeName(word, at, seq);
}
const branch = treeName;
const sid = process.env.CODEBUDDY_SESSION_ID ?? process.env.WORKBUDDY_SESSION_ID ?? '';
const sid6 = shortSid(sid) || 'nosession';
const target = join(WORKTREE_DIR, treeName);
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

/**
 * 交接队列。**格式必须是一份合法队列**：树里的 `audit-*` 会按队列校验它
 * （文件名合法、批次号可被 `parseBatch` 取到）。
 * 批次号在这里就用 `nextBatch()` 定下：`queue-init` 改名接管后会沿用它，
 * 于是"一批一个号、恒定不变"在跨树交接时也成立。
 */
const now = at;
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

/**
 * 推不推远程，听 `config.json` 的 `git.push`（默认 true）。
 *
 * 为什么不再无条件推：那是**同一个开关**——用户设 `git.push=false` 就是"不要替我推"，
 * 建树却偷偷推一条分支，等于绕过他的选择。代价只是分支先只存在本地，
 * 想推随时 `git push -u origin <分支>`。
 */
const pushEnabled = loadConfig()?.git?.push !== false;

step(`当前层数：${layer}${isWorktree ? '（本目录本身是一棵 worktree，允许继续递归）' : '（主工作区）'}`);
step(`建 worktree：${target}`);
step(`开分支：${branch}（基于当前 HEAD）`);
step(`写交接队列：${relTarget}/.continue/doing/worktree.md（批次 ${batch}，${tasks.length > 0 ? tasks.length : 1} 条任务）`);
step(pushEnabled ? `推到远程：git push -u origin ${branch}` : '不推远程：config.json 的 git.push=false');
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

const pushed = pushEnabled ? git('push', '-u', 'origin', branch) : null;
if (pushed && pushed.status !== 0) {
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
    '收工后：**做完就结束**——框架不自动合并、不 rebase、也不删树。',
    `合不合、什么时候合、这棵树什么时候删，全由你决定（分支就是 \`${branch}\`）。`,
  ].join('\n'),
);

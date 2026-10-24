#!/usr/bin/env node
/**
 * Stop 钩子 · 交接派发：把 `todo/` 里的待办队列变成一棵**执行工作树**。
 *
 * 这条链子把"规划"和"执行"分成两段（`.continue/README.md` §9）：
 *
 *   主工作区（规划区）
 *     写 `.continue/doing/.worktree/todo/queue.md` + `context.md`
 *        → 停手（**不建** `doing/<sid>.md`、不在主树开工）
 *        → Stop 触发本钩子
 *     建 worktree `doing/.worktree/worktree_<单词>_<YYYYMMDD>`，分支同名，基于 HEAD
 *        （`<单词>` 由 AI 按这一批的需求取，写在 `queue.md` 头部的 `> 树名：` 里）
 *        → 拉一个 IDE 新窗口指向它
 *
 *   新窗口（执行区）
 *     第一条消息由 `queue-init` 接管：todo → `doing/<新sid6>.md`，上下文附进注入。
 *
 * 为什么建树放在 Stop 而不是让 AI 自己跑 `git worktree add`：
 *   · AI 一旦自己建树，就会顺带在新树里开工，主树的"规划/执行分离"当场破功；
 *   · 建树 + 开窗口是**副作用很重**的动作（多一个完整目录、多一个 IDE 窗口），
 *     由钩子做只有一个入口，出问题也只在一处，且能 `--dry-run` 预演。
 *
 * 放行条件（按顺序，任何一条命中都不建树）：
 *   1. 不是 Stop 事件 / 拿不到会话 ID；
 *   2. 刹车开着（`.continue/auto.off`）；
 *   3. `config.json` 的 `worktree.auto === false`（用户关掉了自动派发）；
 *   4. `todo/queue.md` 不存在或为空（没有待派发内容）；
 *   5. 本会话在 `doing/` 里已有队列（它是执行区，不再派发）；
 *   6. `doing/` 里没有任何别的会话队列（没人在跑，交接不该触发）；
 *   7. `state.json` 记着"同一份内容已派发"且那棵树还在（不重复建树）；
 *   8. 本目录是一棵 worktree（派发只在主工作区做，收件箱是主工作区唯一的）。
 *
 * 失败时**放行而不是拦截**：exit 2 会让 AI 继续在父树里干活，正好把队列做错地方。
 * 所以失败只写日志 + 用 systemMessage 告警，todo 原样保留，人手动重跑即可。
 *
 * 手动用法：`node .continue/hooks/dispatch.mjs --dry-run`（只打印计划）。
 * 退出码：0 永远（除非用法错误）；真正建树失败也是 0 + 告警，见上。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendLog,
  brakeOn,
  BRAKE_REL,
  DOING_REL,
  emitAllow,
  findIdeCli,
  isInsideWorktree,
  listQueues,
  mainWorktreeRoot,
  queueFileName,
  queuePath,
  readPayload,
  readTodo,
  resolveEvent,
  sessionId,
  setLogTag,
  TODO_REL,
  worktreeConfig,
  worktreeName,
  writeTodoState,
  WORKTREE_DIR,
} from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const noWindow = process.argv.includes('--no-window');

/**
 * 手动 `--dry-run` 时 stdin 是终端：`readPayload()` 会一直等输入（看起来像卡死）。
 * 钩子进程里 stdin 永远是管道，`isTTY` 为假，行为不变。
 */
const payload = process.stdin.isTTY ? {} : readPayload();
const event = resolveEvent(payload);
setLogTag('dispatch', event);

function say(text) {
  if (dryRun) console.log(`[dry-run] ${text}`);
}

if (event !== 'Stop' && !dryRun) emitAllow();
if (brakeOn() && !dryRun) emitAllow(`刹车已开（${BRAKE_REL}），不派发。`);

const config = worktreeConfig();
if (!config.auto && !dryRun) {
  emitAllow('自动派发已关闭（config.json 的 worktree.auto=false）；需要时手动跑 node .continue/hooks/dispatch.mjs。');
}

const todo = readTodo();
if (!todo) {
  // 收件箱空着是常态（每次停下都会走到这里），**不写日志**：
  // 空转行每轮一条，会把真正"派发了 / 失败了"的那几行淹掉。
  emitAllow();
}

if (!dryRun && isInsideWorktree()) {
  emitAllow(
    `当前是一棵工作树，派发只在主工作区做：收件箱固定为 \`${mainWorktreeRoot()}/${TODO_REL}\`。\n` +
      '要再切一棵树，请在主工作区里写 todo。',
  );
}

const sid = sessionId(payload);

/**
 * **交接的前提**：`doing/` 里已经有别的会话在跑，或者本会话已经在干。
 *
 * 两条守卫，任一命中都不建树：
 *   · 本会话在 `doing/` 里已有队列 → 它本身就是执行区，再建一棵树等于同一批活开两个地方；
 *   · `doing/` 里一个会话队列都没有 → 没有人在跑，多开一个窗口只是把"一条命令能做完的事"
 *     拆成两步。这种情况该做的是**直接建 `doing/<本会话>.md`**，回到底层协议。
 *
 * 为什么守卫放在钩子里、不只写在注入里：注入只在会话第一条消息说一次，而 Stop 每轮都来；
 * 用户手动往收件箱塞文件、或 AI 判断错时，这里是最后一道闸。
 */
const ownQueue = sid ? queuePath(sid) : '';
const others = listQueues().filter((item) => item.file !== ownQueue);
const blockers = [];
if (ownQueue && existsSync(ownQueue)) {
  blockers.push(`本会话已有队列 \`${DOING_REL}/${queueFileName(sid)}\`（它是执行区，不再派发）`);
}
if (others.length === 0) {
  blockers.push(`\`${DOING_REL}/\` 里没有别的会话队列（交接只在有人并行时才触发）`);
}
if (blockers.length > 0) {
  if (dryRun) {
    say(`不派发：${blockers.join('；')}`);
    console.log('\n[dry-run] 什么都没做。');
    process.exit(0);
  }
  emitAllow(
    [
      '收件箱里有待派发内容，但这次**不建树**：',
      ...blockers.map((item) => `· ${item}`),
      '',
      `没有人在跑时，直接把这份队列写进 \`${DOING_REL}/${queueFileName(sid)}\`（首行会话 ID 用本会话完整 ID），`,
      `然后删掉 \`${TODO_REL}/\` 里的文件，在本会话干完。`,
    ].join('\n'),
  );
}

/**
 * 收件箱内容的指纹：**同一份内容**只派发一次，换了内容必须再派发。
 *
 * 只看"state 里那棵树还在"是不够的：用户在同一会话里派发完第一批、回到主工作区写第二批
 * （覆盖 `queue.md`）时，树 1 还在 → 会被当成"已派发"放行，第二批就永远不派发，
 * 而界面上没有任何报错。指纹一变就说明是**新的**交接，树名自然加 `-2` 后缀。
 */
const sourceHash = createHash('sha1').update(todo.text).digest('hex');

/**
 * 同一份内容已经派发过 → 两种情况都**不重复建树**：
 *
 *   · 树还在：去那个窗口干（否则用户每说一句话就多一棵树）；
 *   · 树没了（被人删掉 / 做完后清理）：**也不重建**（2026-10-24 起）。
 *     内容一个字没变，说明这不是"第二批"而是同一批的残留——再建一棵只会多出
 *     一个同名 `-2` 目录，最糟的情况是把已经做完的活重做一遍。
 *     真要重来就删掉 `state.json`，把"我确定要重跑"变成一次显式动作。
 */
const previous = todo.state?.tree;
const sameContent = Boolean(todo.state?.sourceHash) && todo.state.sourceHash === sourceHash;
if (!dryRun && sameContent) {
  if (previous && existsSync(previous)) {
    emitAllow(
      `已有待接管的执行树：${previous}（分支 ${todo.state.branch ?? '?'}）。\n` +
        '请在**那个窗口**里继续，不要再在主工作区开工；确需重建就先删掉那棵树。',
    );
  }
  emitAllow(
    [
      '这份队列**已经派发过**，但当时的执行树不在了（做完后被清理，或被人删掉）：',
      `· 记录：${previous ?? '（没有记录路径）'}（分支 ${todo.state.branch ?? '?'}）`,
      '',
      '这一轮**不重建**——内容一个字没变，重派只会多一棵同名 `-2` 目录，甚至把做完的活再做一遍。',
      '两条出路：',
      `1. 这批确实做完了 → 删掉 \`${TODO_REL}/\` 里的文件（收件箱是给下一批用的）；`,
      `2. 确实要重跑 → 删掉 \`${TODO_REL}/state.json\`，再停下让钩子重建。`,
    ].join('\n'),
  );
}

const git = (...args) =>
  spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const inRepo = git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true';
if (!inRepo) {
  say('当前目录不是 git 仓库，无法建工作树');
  if (!dryRun) emitAllow('当前目录不是 git 仓库，无法建工作树；交接队列仍留在 todo 里。');
  process.exit(0);
}

const treeRoot = WORKTREE_DIR;

/**
 * 树名 = 分支名 = `worktree_<单词>_<YYYYMMDD>`。
 *
 * `<单词>` 由 AI 在规划时按这一批的需求取，写在 `queue.md` 头部的 `> 树名：<单词>` 里。
 * 钩子**不能替它取名**（它读不懂这一批要干什么），所以取不到时退回中性的 `task`，
 * 并在派发告示里点出来——名字不好看比"派发不了"轻得多。
 *
 * 撞名（同一天同一个单词）追加 `-2`、`-3`，主形态只有一种。
 */
const declared = /^>\s*树名\s*[:：]\s*([A-Za-z][A-Za-z0-9]{0,15})\s*$/m.exec(todo.text);
const word = (declared?.[1] ?? '').toLowerCase() || 'task';
const wordFromQueue = Boolean(declared);
const branchTaken = (name) =>
  git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`).status === 0;
let seq = 1;
let treeName = worktreeName(word, new Date(), seq);
for (let i = 2; i < 100 && (existsSync(join(treeRoot, treeName)) || branchTaken(treeName)); i += 1) {
  seq = i;
  treeName = worktreeName(word, new Date(), seq);
}
const target = join(treeRoot, treeName);
const branch = treeName;

if (dryRun) {
  say(`收件箱：${todo.queuePath}（${todo.text.split(/\r?\n/).length} 行）`);
  if (sameContent) {
    say(`这份内容已经派发过（${previous ?? '未记录路径'}）：树在/不在都不重建，要重跑先删 ${TODO_REL}/state.json`);
  }
  say(`树名来源：${wordFromQueue ? `queue.md 的 \`> 树名：${word}\`` : `没写 \`> 树名：\` → 回退成 \`${word}\``}`);
  say(`建 worktree：${target}`);
  say(`开分支：${branch}（基于当前 HEAD，不含未提交改动）`);
  say(`派发状态：${todo.statePath}`);
  say(config.openWindow && !noWindow ? '拉新窗口：code -n <新树>' : '拉新窗口：已关闭');
  console.log('\n[dry-run] 什么都没做。去掉 --dry-run 才会真的建。');
  process.exit(0);
}

mkdirSync(treeRoot, { recursive: true });
const added = git('worktree', 'add', '-b', branch, target, 'HEAD');

if (added.status !== 0) {
  const detail = (added.stderr || added.stdout || '').trim();
  if (sid) appendLog(sid, `派发失败 · 建树 ${treeName} · ${detail.split('\n')[0] ?? ''}`);
  emitAllow(
    `交接队列还在 \`${TODO_REL}/queue.md\`，但建工作树失败：\n${detail}\n\n` +
      '修好后手动重跑：node .continue/hooks/dispatch.mjs',
  );
}

/**
 * 先记状态再开窗：窗口打开失败时，用户仍能看到"树已建好、去那里开工"，
 * 而记完状态就不怕下一轮 Stop 再建一棵。
 */
writeTodoState({
  dispatchedAt: new Date().toISOString(),
  session: sid ?? null,
  tree: target,
  treeName,
  branch,
  source: todo.queuePath,
  sourceHash,
});

const ideCli = findIdeCli();
const opened =
  ideCli && config.openWindow && !noWindow
    ? spawnSync(ideCli, ['-n', target], { stdio: 'ignore', timeout: 10000 })
    : null;
const windowOk = opened?.status === 0;

if (sid) {
  appendLog(
    sid,
    `派发交接队列 · 建树 ${treeName} · 分支 ${branch} · ` +
      `窗口 ${windowOk ? '已打开' : noWindow || !config.openWindow ? '已关闭（配置）' : '未打开'}`,
  );
}

emitAllow(
  [
    `已按交接队列建好执行树：${target}`,
    `分支：${branch}（基于当前 HEAD，不含主工作区的未提交改动）`,
    ...(wordFromQueue
      ? []
      : [`（\`queue.md\` 头部没写 \`> 树名：<单词>\`、或写的不是英文单词，树名暂用 \`${word}\`；下次在 \`> 批次：\` 下面写一行，名字才有意义）`]),
    windowOk
      ? '已经让 IDE 打开新窗口指向它。'
      : `没能自动开窗口，手动打开这个目录：${target}`,
    '',
    '切到那个窗口继续：新会话的第一条消息会自动接管 todo 里的队列与上下文。',
    '这条主工作区不用再干活——在这里开工等于绕过隔离。',
    '那棵树收尾后**不做任何合并**：做完就结束，合不合、何时合由用户处理。',
  ].join('\n'),
);

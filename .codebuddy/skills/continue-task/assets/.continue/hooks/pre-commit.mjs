#!/usr/bin/env node
/**
 * git pre-commit 门禁：提交前跑 `config.json` 的 `checks.fast`，失败就拒绝提交。
 *
 * 为什么存在（挡的是哪次事故）：
 *   Stop 钩子 `auto-commit` 只在"停下时工作区还脏"才跑检查。而正常流程是 AI 在
 *   同一回合里改完就提交——停下时工作区已经干净，检查**一次都没跑**。
 *   于是"检查由脚本跑、不接受 AI 自证"只在 AI 忘了提交时成立，正常路径上门禁形同虚设
 *   （README §0 原理 4：门禁分三层，"提交前"那一档必须真的挡在提交前）。
 *
 * 由安装器在 `.git/hooks/pre-commit` 写一个三行垫片调用本脚本（见 `scripts/install.mjs`）。
 *
 * 行为：
 *   · 暂存区里一次勾掉多条队列条目 → 拒绝（T17，见下）；
 *   · 没配 `checks.fast` → 放行（与 auto-commit 同一口径：没配 = 不启用门禁）；
 *   · 检查通过 → exit 0；
 *   · 检查失败 → 打印输出末尾 30 行，exit 1（git 拒绝提交）；
 *   · 命令跑不起来（不存在 / 超时）→ **放行**但打印警告：框架自己坏了，
 *     不能反过来把用户的提交卡死（与 `runCheck` 的 fail-open 约定一致）。
 *
 * 注意：检查跑的是**工作区**，不是暂存区快照。部分暂存时两者可能不同；
 * 本框架的检查对象是 `.continue/` 文档，这个差异可以接受。
 * 紧急绕过：`git commit --no-verify`（git 标准做法，不另造开关）。
 */

import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, loadConfig, runCheck, tail } from './lib.mjs';

/**
 * 一次提交最多勾掉几条队列条目（T17）。
 *
 * 为什么存在（挡的是哪次事故）：`auto-continue` 只保证"递一条"，但 AI 完全可以不理会、
 * 在一个回合里把整批做完再一起提交——上一批 7 条就是这么干的，Stop 钩子全程看不见
 * （它只在停下时触发）。于是"一条任务一次提交"只存在于投递层，提交层没有任何约束。
 * 这里补上：暂存区里一次把多条 `[ ]`/`[~]` 改成 `[x]`，就拒绝这次提交。
 *
 * 判据只看**已跟踪队列文件的修改**（`--diff-filter=M`）：
 *   · 新加的队列文件（首次提交整份队列）不算；
 *   · 队列被归档 / 删除（收尾）不算——`doing/` 里那份移走是收尾动作，不是"勾了一条"；
 *   · 同一次提交里重排条目可能被算成"新增 [x]"，宁可少见的误报，
 *     也不要这个约束静默失效——确有需要时用 `--no-verify` 或调大上限。
 */
const MAX_ITEMS = Math.max(1, Number(process.env.CONTINUE_MAX_ITEMS_PER_COMMIT ?? 1));

function completedQueueItems() {
  const res = spawnSync(
    'git',
    [
      'diff',
      '--cached',
      '--unified=0',
      '--diff-filter=M',
      '--',
      '.continue/doing',
      // 决策记录也住在 `doing/`、也用 `- [x]`，但它**不是队列条目**：
      // 不排掉的话，"勾了最后一条队列条目 + 顺手勾掉记录"会被判成"一次勾了 2 条"，
      // 逼人去用 --no-verify（等于削弱门禁）。
      // 文件名是 `<会话ID>-decision.md`（前缀是会话 ID，不是 decision），所以排除串必须用 `*-decision.md`。
      ':(exclude).continue/doing/*-decision.md',
      // 历史遗留：旧版计划文件同样是 `- [x]` 形态，但机制已移除（`migrateLegacyLayout` 会把它归档）。
      // 迁移前万一被改了一行，也不该按"队列条目"算。
      ':(exclude).continue/doing/*-plan.md',
    ],
    { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (res.status !== 0) return null; // 不是 git 仓库 / 没有 diff → 不判
  const done = [];
  for (const line of String(res.stdout ?? '').split(/\r?\n/)) {
    if (/^\+\s*-\s*\[x\]/.test(line)) done.push(line.slice(1).trim());
  }
  return done;
}

const doneItems = completedQueueItems();
if (doneItems && doneItems.length > MAX_ITEMS) {
  console.error(`[continue-do] 这次提交勾掉了 ${doneItems.length} 条队列条目（上限 ${MAX_ITEMS} 条）：\n`);
  for (const item of doneItems) console.error(`  · ${item.slice(0, 110)}`);
  console.error('\n一条任务一次提交：把这次提交拆开，或先只提交其中一条的改动。');
  console.error(
    `确需合并：CONTINUE_MAX_ITEMS_PER_COMMIT=${doneItems.length} git commit …，或 git commit --no-verify（提交信息里说明原因）。`,
  );
  process.exit(1);
}

const config = loadConfig();
const cmd = String(config?.checks?.fast ?? '').trim();
if (!cmd) process.exit(0);

const res = runCheck(cmd, Number(config?.checks?.timeoutSec ?? 180));
const sec = Math.round(res.ms / 1000);

if (res.ok === true) {
  console.error(`[continue-do] 提交前检查通过（${cmd}，${sec}s）`);
  process.exit(0);
}

if (res.ok === null) {
  console.error(
    `[continue-do] ⚠️ 提交前检查没跑起来（${res.timedOut ? '超时' : res.error ?? '未知原因'}），本次放行但**未验证**。`,
  );
  process.exit(0);
}

console.error(`[continue-do] 提交前检查失败，已拒绝提交：${cmd}（${sec}s）\n`);
console.error(tail(res.output, 30) || '(命令没有任何输出，但退出码非 0)');
console.error('\n先修再提交；确需绕过用 `git commit --no-verify`（并在提交信息里说明原因）。');
process.exit(1);

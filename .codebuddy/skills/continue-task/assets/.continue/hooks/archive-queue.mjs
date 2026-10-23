#!/usr/bin/env node
/**
 * 把**本会话的队列文件**从 `doing/` 移到 `logs/doing-archive/`，文件名加时间戳后缀。
 *
 * 用法：
 *   node .continue/hooks/archive-queue.mjs <session_id>                # 归档队列 <sid6>.md
 *   node .continue/hooks/archive-queue.mjs <session_id> --plan         # 归档计划 <sid6>-plan.md
 *   node .continue/hooks/archive-queue.mjs <session_id> --decision     # 归档决策 <sid6>-decision.md
 *
 * 落到 `logs/<会话ID>/<种类>-<YYYYMMDDHHmmss>.md`——按会话分目录，同一会话的东西在一处。
 *
 * 为什么不再直接删：
 *   收尾五步的第 5 步原来是 `rm`。队列原文确实已经整份搬进 `DONE.md`，但那是**加工过的**
 *   ——排版重排、条目合并、错字修正都可能发生；事后想核对"当时那条到底怎么写的"就没有原件了。
 *   代价极低（一个 `mv`，落在 gitignore 里），所以改成归档。
 *
 * 为什么文件名叫 `<会话ID>-<时间戳>.md`：
 *   `logs/` 里已经住着钩子的运行日志 `<会话ID>.md`，同名会撞；加时间戳还能区分
 *   "同一个会话反复开批"（同一个会话可以有多个批次，每个批次都会归档一次）。
 *
 * 为什么由脚本做而不是让 AI 手敲 `mv`：
 *   时间戳格式（`YYYYMMDDHHmmss`、本地时区）手敲必错，而错的时间戳**不会报错**，
 *   只是以后再按时间排序时乱序。这类"派生且必须唯一/有序"的字符串一律交给脚本。
 *
 * 退出码：0 成功（含"本来就没有队列"）/ 1 移动失败。
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { appendLog, archiveDirFor, decisionNameFor, DOING_DIR, planNameFor, PROJECT_ROOT, queueFileName } from './lib.mjs';

const sid = (process.argv[2] ?? '').trim();
/**
 * 三类文件（队列 / 计划 / 决策记录）走**同一套归档规则**，只有前缀不同：
 * `<sid>.md` / `plan-<sid>.md` / `decision-<sid>.md`。
 */
const kind = process.argv.includes('--plan')
  ? 'plan'
  : process.argv.includes('--decision')
    ? 'decision'
    : 'queue';
if (!sid) {
  console.error('用法：node .continue/hooks/archive-queue.mjs <session_id> [--plan|--decision]');
  process.exit(2);
}

const srcName =
  kind === 'plan' ? planNameFor(sid) : kind === 'decision' ? decisionNameFor(sid) : queueFileName(sid);
const src = join(DOING_DIR, srcName);
/** 归档按**会话分目录**：`logs/<会话ID>/`，同一个会话的日志与备份都在一处。 */
const ARCHIVE_DIR = archiveDirFor(sid);

if (!existsSync(src)) {
  console.log(`没有 ${src}（可能已经归档过了），无需处理。`);
  process.exit(0);
}

/** 本地时区的 `YYYYMMDDHHmmss`；不用 ISO，因为文件名要能直接排序且不带分隔符。 */
function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

// 目录里已经有会话 ID 了，文件名只留"种类 + 时间戳"，不再重复一遍 sid
const dest = join(ARCHIVE_DIR, `${kind}-${stamp()}.md`);

try {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  renameSync(src, dest);
} catch (err) {
  console.error(`归档失败：${err.message}`);
  process.exit(1);
}

const rel = dest.slice(PROJECT_ROOT.length + 1);
console.log(`已归档：${rel}`);
appendLog(sid, `${kind === 'plan' ? '计划' : kind === 'decision' ? '决策记录' : '队列'}已归档 · ${rel}`);

/**
 * 不带 flag 时 = 归档**本会话的全部"正在做"文件**：队列 + 决策记录 + 计划（存在才搬）。
 *
 * 为什么改成一条命令：收尾第五步原本要求"归档队列 → 再 `--decision` → 再 `--plan`"，
 * 实测模型只做了第一步就宣布收尾，决策记录留在 `doing/` 里成了孤儿（门禁会红，但那是事后）。
 * 一个会话的东西本来就该一起走，做成一条命令就不存在"漏了第二步"。
 *
 * 单独的 `--plan` / `--decision` 仍然可用（幂等：文件不在就跳过）。
 */
if (kind === 'queue') {
  for (const [k, name, label] of [
    ['decision', decisionNameFor(sid), '决策记录'],
    ['plan', planNameFor(sid), '计划'],
  ]) {
    const from = join(DOING_DIR, name);
    if (!existsSync(from)) continue;
    const to = join(ARCHIVE_DIR, `${k}-${stamp()}.md`);
    try {
      renameSync(from, to);
      const r = to.slice(PROJECT_ROOT.length + 1);
      console.log(`已归档（随队列）：${r}`);
      appendLog(sid, `${label}已归档（随队列） · ${r}`);
    } catch (err) {
      console.error(`附带归档 ${name} 失败：${err.message}`);
      process.exit(1);
    }
  }
}

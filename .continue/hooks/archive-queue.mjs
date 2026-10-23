#!/usr/bin/env node
/**
 * 把**本会话的队列文件**从 `doing/` 移到 `logs/doing-archive/`，文件名加时间戳后缀。
 *
 * 用法：
 *   node .continue/hooks/archive-queue.mjs <session_id>            # 归档队列 <sid>.md
 *   node .continue/hooks/archive-queue.mjs <session_id> --plan     # 归档计划 plan-<sid>.md
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
import { appendLog, CONTINUE_DIR, DOING_DIR, PROJECT_ROOT } from './lib.mjs';

const sid = (process.argv[2] ?? '').trim();
const wantPlan = process.argv.includes('--plan');
if (!sid) {
  console.error('用法：node .continue/hooks/archive-queue.mjs <session_id> [--plan]');
  process.exit(2);
}

/** 队列和计划走同一套归档规则，只是前缀不同（`<sid>.md` / `plan-<sid>.md`）。 */
const base = wantPlan ? `plan-${sid}` : sid;
const src = join(DOING_DIR, `${base}.md`);
const ARCHIVE_DIR = join(CONTINUE_DIR, 'logs', 'doing-archive');

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

const dest = join(ARCHIVE_DIR, `${base}-${stamp()}.md`);

try {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  renameSync(src, dest);
} catch (err) {
  console.error(`归档失败：${err.message}`);
  process.exit(1);
}

const rel = dest.slice(PROJECT_ROOT.length + 1);
console.log(`已归档：${rel}`);
appendLog(sid, `${wantPlan ? '计划' : '队列'}已归档 · ${rel}`);

#!/usr/bin/env node
/**
 * 把**本会话的队列 / 决策记录**从 `doing/` 移进 `.logs/<会话ID>/`。
 *
 * 用法：
 *   node .continue/hooks/archive-queue.mjs <session_id>                # 归档队列（顺带把决策记录一起搬）
 *   node .continue/hooks/archive-queue.mjs <session_id> --decision     # 只归档决策记录
 *
 * ## 归档文件是**累积**的，不按批次新建
 *
 * `.logs/<会话ID>/queue.md`、`decision.md` 各一份，**每个新批次插到最上面**，
 * 批次之间用 `----------` 分隔：
 *
 *   ## 批次 20261023-1141 · 2026-10-23 11:41
 *   <这一批的队列原文>
 *   ----------
 *   ## 批次 20261023-1018 · 2026-10-23 11:18
 *   <上一批的原文>
 *
 * 为什么不再一批一个文件：一个会话跑十几批就会在 `.logs/<会话ID>/` 里堆十几个
 * `queue-20261023114100.md`，想按时间连着看一遍得一个个开。累积成一份之后，
 * "这个会话从头到尾都干了什么"是一个文件、从上往下读。
 *
 * ⚠️ `doing/` 那边的规则**完全不变**：仍然是一批一份文件，收尾时移走。
 *    这里改的只是落盘格式。
 *
 * ## 其它两条仍然成立
 *
 * · **不再直接删**：`DONE.md` 里是**加工过**的版本（重排、合并、改错字），
 *   事后想核对"当时的原文"只有这份归档。（落在 gitignore 里，代价极低。）
 * · **派生的东西交给脚本**：批次号、日期格式手敲必错，而错的日期不会报错，
 *   只是以后按时间查找时乱序。
 *
 * 退出码：0 成功（含"本来就没有队列"）/ 1 写盘失败。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendLog,
  archiveDirFor,
  decisionNameFor,
  DOING_DIR,
  PROJECT_ROOT,
  queueFileName,
  shortSid,
} from './lib.mjs';

const sid = (process.argv[2] ?? '').trim();
const kind = process.argv.includes('--decision') ? 'decision' : 'queue';

if (!sid) {
  console.error('用法：node .continue/hooks/archive-queue.mjs <session_id> [--decision]');
  process.exit(2);
}

const LABEL = { queue: '队列', decision: '决策记录' };
const SRC_NAME = {
  queue: queueFileName(sid),
  decision: decisionNameFor(sid),
};

/** `.logs/<会话ID>/`：同一个会话的日志与归档都在一处。 */
const ARCHIVE_DIR = archiveDirFor(sid);
const SEP = '----------';

/** 本地时区的 `YYYY-MM-DD HH:mm`；批次标题用它，人能直接读。 */
function when(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** 从原文里取 `> 批次：xxx`；取不到就写"未知批次"（不猜）。 */
function batchOf(text) {
  const m = /^>\s*批次\s*[:：]\s*(\S+)/m.exec(text);
  return m ? m[1] : '未知批次';
}

/**
 * 归档标题里用的批次号。
 *
 * `queue` 自己有 `> 批次：` 行，直接读；**`decision` 没有**（它的格式是 `## D<n> · …`），
 * 所以要从别处派生：队列还在 `doing/` 就用它，已归档就用 `.logs/<sid>/queue.md` 最新那节。
 * 旧实现在决策记录上永远拿不到队列文本，于是每份归档都写「未知批次」——
 * "这条决策属于哪一批"这唯一的线索就这么丢了（2026-10-23 实测日志里连着两条都是"未知批次"）。
 */
function batchFor(k, text) {
  if (k === 'queue') return batchOf(text);
  const doingQueue = join(DOING_DIR, SRC_NAME.queue);
  if (existsSync(doingQueue)) return batchOf(readFileSync(doingQueue, 'utf8'));
  const archived = join(ARCHIVE_DIR, 'queue.md');
  if (existsSync(archived)) {
    const m = /^##\s*批次\s*(\S+)/m.exec(readFileSync(archived, 'utf8'));
    if (m) return m[1];
  }
  return '未知批次';
}

function fileHead(k) {
  return [
    `# ${LABEL[k]}归档 · 会话 ${shortSid(sid)}`,
    '',
    '> 本会话所有批次的原文，**新的在最上面**；批次之间用 `----------` 分隔。',
    '> 按 `## 批次 <号>` 可定位某一批；原文已从 `doing/` 移走。',
    '',
    '',
  ].join('\n');
}

/**
 * 把一节插到最上面。
 *
 * 幂等：同一批次号已经存在就跳过（重跑归档不会写重复节）。
 */
function archiveAs(k) {
  const src = join(DOING_DIR, SRC_NAME[k]);
  if (!existsSync(src)) return false;

  const text = readFileSync(src, 'utf8');
  const batch = batchFor(k, text);
  const dest = join(ARCHIVE_DIR, `${k}.md`);
  const old = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
  /**
   * ⚠️ 必须**行锚点**匹配：文件头那段说明里本来就写着 `> 按 \`## 批次 <号>\` 可定位某一批`，
   * 用裸 `indexOf('## 批次 ')` 会把插入点放进引用行中间，把标题写坏（已踩过一次）。
   */
  const firstSection = /^## 批次 /m.exec(old);
  const bodyStart = firstSection ? firstSection.index : -1;

  if (batch !== '未知批次' && bodyStart >= 0 && old.slice(bodyStart).includes(`## 批次 ${batch} `)) {
    rmSync(src, { force: true });
    console.log(`${SRC_NAME[k]} 的批次 ${batch} 已在归档里，跳过`);
    return true;
  }

  const head = bodyStart >= 0 ? old.slice(0, bodyStart) : old || fileHead(k);
  const body = bodyStart >= 0 ? old.slice(bodyStart).trimEnd() : '';
  const section = `## 批次 ${batch} · ${when()}\n\n${text.trimEnd()}\n`;
  const next = body ? `${head}${section}\n${SEP}\n\n${body}\n` : `${head}${section}\n`;

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  writeFileSync(dest, next);
  rmSync(src, { force: true });

  const rel = dest.slice(PROJECT_ROOT.length + 1);
  console.log(`已归档：${rel}（批次 ${batch}）`);
  appendLog(sid, `${LABEL[k]}已归档 · ${rel} · 批次 ${batch}`);
  return true;
}

try {
  const done = archiveAs(kind);
  if (!done) {
    console.log(`没有 ${join(DOING_DIR, SRC_NAME[kind])}（可能已经归档过了），无需处理。`);
    process.exit(0);
  }
} catch (err) {
  console.error(`归档失败：${err.message}`);
  process.exit(1);
}

/**
 * 不带 flag 时 = 归档**本会话的全部"正在做"文件**：队列 + 决策记录（存在才搬）。
 *
 * 为什么做成一条命令：收尾第五步本来要求"归档队列 → 再 `--decision`"，
 * 实测模型只做第一步就宣布收尾，决策记录留在 `doing/` 里成了孤儿。
 * 一个会话的东西本来就该一起走，做成一条命令就不存在"漏了第二步"。
 */
if (kind === 'queue') {
  try {
    archiveAs('decision');
  } catch (err) {
    console.error(`附带归档 ${SRC_NAME.decision} 失败：${err.message}`);
    process.exit(1);
  }
}

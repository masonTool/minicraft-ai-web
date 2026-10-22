#!/usr/bin/env node
/**
 * continue-do · 三个钩子共用的基础设施（零依赖，Node >= 18）。
 *
 * 三条设计约束，每条都是踩过的坑换来的：
 *
 *   1. **项目根用 `import.meta.url` 反推**（本文件在 `<root>/.continue/hooks/lib.mjs`，上退 2 层）。
 *      不依赖 cwd（钩子进程的 cwd 可能是任意子目录，从子目录发起会话时相对路径就指错），
 *      也不依赖环境变量（换机器、改目录名立刻失效）。
 *
 *   2. **解析队列前先剥掉围栏代码块**。队列文件里会写格式模板（`- [ ] 示例…`），
 *      trim 之后行首和真任务一模一样，不剥就会把模板当成待办——
 *      症状是"队列明明清空了却一直在跑"。
 *
 *   3. **钩子只有一处写操作**：连续 N 轮没做完时标 `[阻塞]`。
 *      其余标记（`[ ]` / `[~]` / `[x]`）由 AI 自己写——这样 AI 提交任务时会把
 *      队列文件一起带上，不会出现"提交完工作区又被钩子改脏"的记账噪音。
 *      业务文档（TASKS / DONE / HANDOFF）由 AI 写，脚本不代笔，也不替它编 commit message。
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const CONTINUE_DIR = join(PROJECT_ROOT, '.continue');
export const QUEUES_DIR = join(CONTINUE_DIR, 'queues');
export const LOGS_DIR = join(CONTINUE_DIR, 'logs');
export const TASKS_FILE = join(CONTINUE_DIR, 'TASKS.md');
export const DONE_FILE = join(CONTINUE_DIR, 'DONE.md');
export const HANDOFF_FILE = join(CONTINUE_DIR, 'HANDOFF.md');
export const CONFIG_FILE = join(CONTINUE_DIR, 'config.json');

/**
 * 四态，与参考项目（minicraft-ai-web 的 .codebuddy/hooks）同一套语义：
 *
 *   `[ ]` 待办（AI 规划时写）· `[~]` 进行中（AI 开始做时写）·
 *   `[x]` 完成（AI 做完写）· `[阻塞]` 卡住（**只有钩子会写**，AI 不许自己写）
 *
 * `[-]` 已废弃：它和 `[~]` 表达同一件事，两套符号并存只会让"进行中/跳过"被读反。
 * 也正因为 `[~]` 表示进行中，它必须算"未完成"，不能被当成"跳过"。
 */
export const MARK = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
  blocked: '[阻塞]',
};

/** 顺序有意义：`[阻塞]` 是中括号里带中文的，必须先于其它判断。 */
const MARKER_TESTS = [
  // 容忍 `[ 阻塞 ]`：写成带空格时若认不出，这条会既不算待办也不算阻塞，
  // 从所有统计里消失（表现为"队列明明有条目却被当成空的"）。
  ['blocked', /^-\s*\[\s*阻塞\s*\]/],
  ['done', /^-\s*\[x\]/i],
  ['doing', /^-\s*\[~\]/],
  ['todo', /^-\s*\[\s*\]/],
];

// ------------------------------------------------------------------ 输入

export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * 事件名兜底推断：字段名与预期不一致时也能认出事件类型
 * （旧项目排查"钩子到底有没有被触发"时靠的就是这层兼容）。
 */
export function detectEvent(payload) {
  const name = payload.hook_event_name ?? payload.hookEventName;
  if (typeof name === 'string' && name.length > 0) return name;
  if (payload.stop_hook_active !== undefined) return 'Stop';
  if (typeof payload.prompt === 'string') return 'UserPromptSubmit';
  return '(unknown)';
}

/** 会话 ID：队列文件名直接由它推导，所以要挡住空串与明显非法的值。 */
export function sessionId(payload) {
  const id = payload.session_id ?? payload.conversation_id;
  // 允许 `.`：有些平台给的是 UUID / 带版本号的点分 ID。漏掉一个合法字符的代价是
  // 整个会话静默停摆（返回 null → 所有钩子直接放行，且不报错）。
  return typeof id === 'string' && /^[A-Za-z0-9._-]{4,}$/.test(id) ? id : null;
}

// ------------------------------------------------------------------ 路径

export function queuePath(sid) {
  return join(QUEUES_DIR, `${sid}.md`);
}

/**
 * 每个会话**只有两个运行时文件**（2026-10-22 按用户要求收敛）：
 *
 *   `logs/<sid>.log`        人读的时间线（本地时间 + 来源标签）
 *   `logs/<sid>.state.json` 机器读的状态（按钩子分区）
 *
 * 以前是"一个分区一个文件"（`<sid>.state.json` / `.init.state.json` / `.commit.state.json`），
 * 加上日志一共四个——用户的原话是"我不需要有那么多文件"。分区还留着（并行安全需要），
 * 只是收进同一个 JSON 的 `init` / `continue` / `commit` 三个键里。
 */
export function statePath(sid) {
  return join(LOGS_DIR, `${sid}.state.json`);
}
export function logPath(sid) {
  return join(LOGS_DIR, `${sid}.log`);
}
// ------------------------------------------------------------------ 状态

/** 分区名：`''` 是历史写法（= auto-continue 的地盘），统一映射到 `continue`。 */
const SECTIONS = new Set(['init', 'continue', 'commit']);
function sectionOf(name) {
  const key = String(name || 'continue');
  return SECTIONS.has(key) ? key : key;
}

/** 同步小睡：钩子是短命进程，拿锁失败时宁可旋一下也不要异步。 */
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* 环境不支持就退化成忙等，最多几百毫秒 */
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

/**
 * 读-改-写锁（`mkdir` 是原子的）。
 *
 * 为什么必须有：`queue-init` 与 `auto-continue` 在 UserPromptSubmit 上**并行**跑，
 * 两个进程"读整份 JSON → 改自己那一区 → 写回"时，后写的会把先写的分区抹掉
 * （症状是会话被重复注入、或轮次归零失效）。分区只解决了"字段互相覆盖"，
 * 解决不了"读到旧副本"——加锁才解决。
 *
 * 崩溃残留的锁 2 秒后视为过期（钩子进程本身就活不过几百毫秒）。
 */
function withStateLock(file, fn) {
  const lock = `${file}.lock`;
  let held = false;
  for (let i = 0; i < 60 && !held; i += 1) {
    try {
      mkdirSync(lock);
      held = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 2000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* 锁刚被释放，重试即可 */
      }
      sleepMs(5);
    }
  }
  try {
    return fn();
  } finally {
    if (held) rmSync(lock, { recursive: true, force: true });
  }
}

function readAllState(sid) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sid), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadState(sid, section = '') {
  const value = readAllState(sid)[sectionOf(section)];
  return value && typeof value === 'object' ? value : {};
}

export function saveState(sid, state, section = '') {
  const key = sectionOf(section);
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    withStateLock(statePath(sid), () => {
      const all = readAllState(sid);
      all[key] = state;
      writeFileSync(statePath(sid), `${JSON.stringify(all, null, 2)}\n`);
    });
  } catch {
    /* 状态写不进去不影响主流程 */
  }
}

/**
 * 运行日志（人读的纯文本，`logs/<sid>.log`）。
 *
 * 三条"只留有效信息"的规则（2026-10-22 按用户要求改的）：
 *
 *   1. **只给「有队列的会话」记**：纯问答会话每轮 Stop 也会跑到这里，记下来只有
 *      `放行 · 本会话尚未创建队列` 之类一行一行的噪音，翻日志时还得先认出"哪份是干活的"。
 *      队列文件不存在 → 直接不写（连日志文件都不创建）。
 *      要排查"钩子到底有没有被调用"，手动喂一条事件（HANDOFF §4），别指望这个文件。
 *   2. **同一件事连着重复只写一次**：多轮"等用户回复""队列是空的"内容完全一样，
 *      重复写只会把真正发生的事（拦截 / 隔离 / 自测失败）淹掉。时间戳不参与比较。
 *   3. **一个会话一个文件，不轮转**：超阈值就地砍掉旧的一半（保留尾部），
 *      不产生 `.1` / `.2` —— 用户要的是"每样东西一个文件"。
 *
 * 每行带**来源标签**（`[init]` / `[continue]` / `[commit]`）：三个钩子共用一个文件，
 * 但要能一眼分清这条是排队列的、递任务的，还是提交守卫说的。
 */
const LOG_MAX_BYTES = Number(process.env.CONTINUE_LOG_MAX ?? 512 * 1024);

/** 来源标签：只有这三个脚本会写日志，写错标签说明调用处写错了。 */
export const LOG_TAG = {
  init: 'init',
  continue: 'continue',
  commit: 'commit',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 日志时间戳用**本地时间**（`2026-10-22 08:15:32`）。
 *
 * 以前是 `toISOString()`（UTC）：日志里 `00:15`、屏幕上是 `08:15`，
 * 每次对时间都要在脑子里换算一次。日志是给人看的，就别让人算。
 */
export function localStamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/** 时区偏移（`+08:00`）。只写在日志头，避免每行都拖着。 */
export function localOffset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** 文件头：只在新建/截断后写一次，说明时间口径。 */
function logHeader(sid) {
  return `==== 会话 ${sid} · 运行日志 · 本地时间 ${localOffset()} · 标签 [init]/[continue]/[commit] ====`;
}

/** 把时间戳与标签剥掉，只留正文（去重比较用）。 */
function stripStamp(line) {
  return line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[[a-z]+\] /, '');
}

/**
 * 追加一行：`2026-10-22 09:12:40 [continue] 拦截 · Stop 第1轮 · 递任务：「…」`。
 *
 * @param {string} sid  会话 ID
 * @param {string} tag  来源（`LOG_TAG.init` / `.continue` / `.commit`）
 * @param {string} text 正文
 */
export function appendLog(sid, tag, text) {
  try {
    // 规则 1：没有队列的会话不产生任何日志（连文件都不建）
    if (!existsSync(queuePath(sid))) return;

    mkdirSync(LOGS_DIR, { recursive: true });
    const file = logPath(sid);

    let existed = true;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      existed = false; // 文件还不存在，正常
    }

    // 规则 3：超阈值就砍掉旧的一半（单文件，不产生 .1/.2）
    if (existed && size > LOG_MAX_BYTES) {
      try {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        const body = lines.filter((line) => line && !line.startsWith('===='));
        writeFileSync(file, `${logHeader(sid)}\n${body.slice(Math.ceil(body.length / 2)).join('\n')}\n`);
        size = statSync(file).size;
      } catch {
        /* 截断失败就继续追加，下次再试 */
      }
    }

    // 规则 2：与上一行说的是同一件事 → 跳过（重复的时间点本身没有信息量）
    if (existed && size > 0) {
      try {
        const last = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).pop() ?? '';
        if (stripStamp(last) === text) return;
      } catch {
        /* 读不到就当没有上一行 */
      }
    }

    const header = size > 0 ? '' : `${logHeader(sid)}\n`;
    appendFileSync(file, `${header}${localStamp()} [${tag}] ${text}\n`);
  } catch {
    /* 日志失败绝不影响判定 */
  }
}

// ------------------------------------------------------------------ 自测门禁

/**
 * 项目级配置（可选）。目前只放自测命令：
 *
 *   { "checks": { "fast": "npm run check:fast", "full": "npm run check", "timeoutSec": 180 } }
 *
 * 没有这个文件 = **不启用门禁**，钩子行为和以前完全一致。
 * 之所以做成配置而不是写死：框架要能装到任何项目上，命令因项目而异
 * （npm / cargo / go / 甚至"只做语法检查"）。
 */
export function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

/**
 * 同步跑一条检查命令——门禁必须在钩子返回前拿到结论。
 *
 * 返回 `{ ok, ms, output, timedOut, error }`：
 *   · `ok === true/false` 才是真结论；
 *   · `ok === null` 表示**没跑起来**（命令不存在 / 超时），调用处一律 fail-open：
 *     框架自己跑不动，不能反过来把用户的活卡死。
 */
export function runCheck(command, timeoutSec = 180) {
  const started = Date.now();
  const res = spawnSync(command, {
    shell: true,
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: Math.max(5, Number(timeoutSec) || 180) * 1000,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  if (res.error) {
    return { ok: null, ms, timedOut: res.error.code === 'ETIMEDOUT', error: res.error.message, output: '' };
  }
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;

  /**
   * shell 的 126/127 = "命令存在但不可执行 / 命令不存在"。这**不是**测试失败，
   * 是配置写错了；当成失败会一直催 AI"去修测试"，方向完全跑偏。
   */
  if (res.status === 126 || res.status === 127) {
    const firstLine = output.trim().split(/\r?\n/)[0] ?? '';
    return {
      ok: null,
      ms,
      timedOut: false,
      error: `退出码 ${res.status}${firstLine ? ` · ${firstLine}` : ''}`,
      output,
    };
  }

  return { ok: res.status === 0, ms, timedOut: false, error: null, output };
}

/** 取输出最后 n 行：测试失败时前面几千行 ✓ 没人看，AI 读了只会烧上下文。 */
export function tail(text, n = 30) {
  const lines = String(text ?? '').trimEnd().split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

// ------------------------------------------------------------------ 批次号

/**
 * 批次号 = 当前提交总数（`git rev-list --count HEAD`）。
 *
 * 为什么不自己维护一个自增计数器：手抄的数字一定会漂（参考项目为此专门记过一笔账），
 * 而提交数是**唯一真值**——它天然与"这批动了多少次"一一对应，一个任务多次提交
 * 也能用区间表达（`批次 24（提交 24→27）`）。
 *
 * 取不到就返回 `null`（不是 git 仓库 / 还没有任何提交）：调用处**直接省略**这个数字。
 * 框架要能装到任何项目，不能让一个只用于定位的展示数字把主流程卡住。
 */
export function commitCount() {
  try {
    const res = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status !== 0) return null;
    const count = Number(String(res.stdout ?? '').trim());
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 队列解析

export function isFence(line) {
  return /^\s*(```|~~~)/.test(line);
}

export function classify(trimmed) {
  for (const [kind, re] of MARKER_TESTS) {
    if (re.test(trimmed)) return kind;
  }
  return null;
}

/**
 * 返回 { entries, counts, hold }。
 * `hold` 对应队列头部的 `> 状态：讨论中`——表示"还没打算开工，别催"。
 *
 * ⚠️ 只扫**头部 5 行**，不能扫全文。以前是全文正则，结果正文里随便提一句
 * "状态：讨论中"（写备注、引用模板）就能把整份队列永久冻住，而且只给用户
 * 弹一句提示，AI 那边毫无感觉——排查起来像"钩子不干活"。
 */
export function parseQueue(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (isFence(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const trimmed = line.trim();
    const kind = classify(trimmed);
    if (kind) entries.push({ index, kind, raw: trimmed });
  });
  const counts = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return {
    entries,
    counts,
    hold: /状态\s*[:：]\s*讨论中/.test(lines.slice(0, 5).join('\n')),
  };
}

export function readQueue(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return { file, text, ...parseQueue(text) };
}

/**
 * 把指纹命中的那条改成 `- [阻塞]`（内容其余一字不动）。
 *
 * 这是**钩子唯一的写操作**：连续 N 轮没做完 → 隔离，不再递回来，
 * 但条目留在文件里等用户决策（改描述重试 / 删除 / 保留），脚本不替他删。
 */
export function markBlocked(file, fp) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (isFence(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const kind = classify(lines[i].trim());
    if ((kind === 'todo' || kind === 'doing') && fingerprint(lines[i].trim()) === fp) {
      lines[i] = lines[i].replace(/^(\s*-\s*)\[[^\]]*\]/, `$1${MARK.blocked}`);
      writeFileSync(file, lines.join('\n'));
      return true;
    }
  }
  return false;
}

/** 指纹：去掉标记与首尾空白，压掉连续空格，截 120 字（跨轮比较"是不是同一条"）。 */
export function fingerprint(raw) {
  return raw
    .replace(/^-\s*\[[^\]]*\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function listQueues() {
  try {
    return readdirSync(QUEUES_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ sid: name.slice(0, -3), file: join(QUEUES_DIR, name) }));
  } catch {
    return [];
  }
}

export function unfinishedCount(queue) {
  return queue ? queue.counts.todo + queue.counts.doing : 0;
}

// ------------------------------------------------------------------ 输出

/**
 * 放行。**唯一正常的停止条件**永远写在调用处，别在这里加默认值——
 * 否则"为什么没继续"和"为什么拦住了"都会变得说不清。
 */
export function emitAllow(systemMessage) {
  const out = { continue: true, suppressOutput: true };
  if (systemMessage) out.systemMessage = systemMessage;
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

/**
 * 拦截并让 AI 继续。
 *
 * ⚠️ 官方 Stop 样例是 `{"continue": false}`，但它在实现层容易被当成"硬停止"，
 * 结果 AI 真的停了（旧项目踩过）。而 exit 2 时 stdout 被忽略、**stderr 会传给 AI**，
 * 所以这里用「stdout 声明 continue: true + 反馈走 stderr + exit 2」：
 * 两种解读下行为都正确。
 */
export function emitBlock(feedback) {
  process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
  process.stderr.write(`${feedback}\n`);
  process.exit(2);
}

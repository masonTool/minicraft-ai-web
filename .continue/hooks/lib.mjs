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
 *      业务文档（TASKS / DONE / OVERVIEW / TIPS / README）由 AI 写，
 *      脚本不代笔，也不替它编 commit message。
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const CONTINUE_DIR = join(PROJECT_ROOT, '.continue');
/**
 * 进行中队列目录是 `doing/`（不是 `queues/`）。
 *
 * 名字直接对应状态：`doing/` 里是"正在做"的，收尾后整份搬进 `DONE.md` 并删文件。
 * 只在这一个常量里定义目录名——所有路径都从它推导，改名时只需改这里一行。
 */
export const DOING_DIR = join(CONTINUE_DIR, 'doing');
export const LOGS_DIR = join(CONTINUE_DIR, 'logs');
export const TASKS_FILE = join(CONTINUE_DIR, 'TASKS.md');
export const DONE_FILE = join(CONTINUE_DIR, 'DONE.md');
export const README_FILE = join(CONTINUE_DIR, 'README.md');
export const OVERVIEW_FILE = join(CONTINUE_DIR, 'OVERVIEW.md');
/** 踩坑经验。文件名是 `TIPS.md`：它装的是"下次怎么做"的提示，不是事故档案。 */
export const TIPS_FILE = join(CONTINUE_DIR, 'TIPS.md');
export const CONFIG_FILE = join(CONTINUE_DIR, 'config.json');

/**
 * 文档体量上限（**唯一来源**）。`audit-docs` 用它拦，`archive-done.mjs` 用它决定搬到哪。
 *
 * 为什么抽到这里：两份脚本各写一套数字，迟早不同步——归档搬完了 `audit-docs` 还嫌大，
 * 或者反过来。这正是 README §0 原理 2（派生即计算）在框架自己身上的应用。
 */
export const DOC_LIMITS = {
  README: 400,
  DONE: 300,
  OVERVIEW: 200,
  /**
   * **本项目放宽：600 → 7000（批次 1363）**。
   *
   * 框架默认 600 行是给"轻量需求清单"的；本项目的 `TASKS.md` 不是清单，是**台账**：
   * 每条条目下方挂着实现文件、批次号、⚠️ 与原版差异注记，而这些注记是脚本的输入——
   * `tools/diff-ledger.mjs`（差异台账）、`tools/coverage-report.ts`（覆盖度）、
   * `tools/audit-tasks.mjs`（编号与进度口径）都在解析它。压到 600 行等于删掉它们的输入。
   *
   * 代价与边界：这份文件**不许通读**（按 `[~]` / `T<号>` grep），也不进每轮上下文。
   * 什么时候重看：条目多到 grep 不动了 → 按段字母拆 `notes/tasks-<段>.md` 并同步改那三个脚本。
   * ⚠️ 重装框架会覆盖本文件，`npm run audit:docs` 会当场报出来（见 tools/audit-docs.mjs 的守卫）。
   */
  TASKS: 7000,
  TIPS: 500,
  QUEUE: 500,
};

/**
 * 文档体量的**字节**上限（与行数上限互补，缺一不可）。
 *
 * 为什么需要：行数会被"超长行"绕过——本项目实测 `TIPS.md` 499 行 / 190KB，
 * 按行数看只是"接近 500 行的薄文件"，按 token 看却是 README 的六倍。
 * 行数只适合"条目密度稳定"的文件；带大表格的文档必须同时看字节。
 *
 * 取值都留了余量（当前 → 上限）：README 28KB→40KB、DONE 16KB→40KB、
 * OVERVIEW 7KB→24KB、TASKS 591KB→900KB、TIPS 7KB→60KB、队列 60KB。
 * 超了先删 / 归档；确实要放宽就改这里并写明理由（唯一来源）。
 */
export const DOC_BYTE_LIMITS = {
  README: 40 * 1024,
  DONE: 40 * 1024,
  OVERVIEW: 24 * 1024,
  /** 900KB：TASKS 是脚本输入，不能压，但仍要有个观察点。 */
  TASKS_BYTES: 921600,
  TIPS: 60 * 1024,
  QUEUE: 60 * 1024,
};


/**
 * 刹车开关：`touch .continue/auto.off` → 两个 Stop 钩子都只放行，不递任务、不拦提交；
 * 删掉文件即恢复。"人随时接管"的那个开关（README §0 原理 3）。
 *
 * 为什么另设文件而不是复用 `> 状态：讨论中`：讨论中只作用于**某一份队列**，
 * 管不到提交守卫；而守卫误拦（别人的脏文件、没法提交的改动）恰恰是最需要一键停下的场景。
 * 已 gitignore：开关是本机状态，进版本库会让"开/关"本身变成一次待提交改动。
 */
export const BRAKE_FILE = join(CONTINUE_DIR, 'auto.off');
export const BRAKE_REL = '.continue/auto.off';

export function brakeOn() {
  return existsSync(BRAKE_FILE);
}

/** 队列目录在项目内的相对路径，注入给 AI 的文案统一用它拼，避免各处写死。 */
export const DOING_REL = '.continue/doing';

/**
 * 老版本的目录名 / 文件名，只用于**自动迁移**，不要在任何新文案里出现。
 *
 * 老项目升级后：
 *   · `queues/`（旧队列目录）→ 逐文件搬进 `doing/`；
 *   · `EXPERIENCE.md`（旧踩坑文档）→ 改名为 `TIPS.md`。
 *
 * 为什么在钩子里做而不是让用户手动搬：装到已有项目时，用户手上的队列里可能有
 * 做到一半的进度。新版本读 `doing/`、老队列还在 `queues/`，表现是"钩子不递任务了"
 * ——静默失效最难查。所以每次钩子启动先对齐一次，幂等、无副作用。
 */
const LEGACY_DOING_DIR = join(CONTINUE_DIR, 'queues');
const LEGACY_TIPS_FILE = join(CONTINUE_DIR, 'EXPERIENCE.md');

/**
 * 把老版本的目录 / 文件名对齐到新名字。**幂等**：已经迁移过的项目什么都不做。
 *
 * 规则刻意保守：
 *   · 目标已存在就不覆盖（用户可能已经手动建好了新的）；
 *   · `doing/` 里已有同名文件也跳过（不覆盖正在进行的队列）；
 *   · 迁移完删掉空的 `queues/` 目录，避免"两个目录并存"让人以为队列丢了。
 *
 * 返回描述做了什么，供注入文案告知用户；没做任何事返回 `[]`。
 */
export function migrateLegacyLayout() {
  const notes = [];
  try {
    if (existsSync(LEGACY_DOING_DIR)) {
      mkdirSync(DOING_DIR, { recursive: true });
      const moved = [];
      for (const name of readdirSync(LEGACY_DOING_DIR)) {
        if (!name.endsWith('.md')) continue;
        const from = join(LEGACY_DOING_DIR, name);
        const to = join(DOING_DIR, name);
        if (existsSync(to)) continue; // 目标已有，保留现状
        renameSync(from, to);
        moved.push(name);
      }
      if (moved.length > 0) {
        notes.push(`已把 ${moved.length} 个存量队列从 \`queues/\` 迁到 \`doing/\`：${moved.join('、')}`);
      }
      // 只剩 .gitkeep 时也算空，可以删
      const left = readdirSync(LEGACY_DOING_DIR).filter((name) => name !== '.gitkeep');
      if (left.length === 0) {
        unlinkSync(join(LEGACY_DOING_DIR, '.gitkeep'));
        rmdirSync(LEGACY_DOING_DIR);
        notes.push('已删除空的旧目录 `queues/`');
      }
    }
  } catch {
    /* 迁移失败不影响主流程，最坏情况就是老队列不被读到 */
  }
  try {
    if (existsSync(LEGACY_TIPS_FILE) && !existsSync(TIPS_FILE)) {
      renameSync(LEGACY_TIPS_FILE, TIPS_FILE);
      notes.push('已把 `EXPERIENCE.md` 改名为 `TIPS.md`');
    }
  } catch {
    /* 同上 */
  }
  return notes;
}

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

/**
 * 事件来源：**注册时用命令行参数显式传**（`--event=Stop`），拿不到才退回 payload 推断。
 *
 * 为什么参数优先：同一份日志里混着 Stop 与 UserPromptSubmit 两种事件，而 payload 的字段名
 * 各平台不完全一致（`hook_event_name` / `hookEventName` / 只能靠 `stop_hook_active` 猜）。
 * 推断错的时候日志会把"用户说了句话"记成"停下"，排查方向当场跑偏；
 * 参数写在注册表里、跟着事件走，不依赖 payload 长什么样。
 */
const EVENT_ALIASES = {
  stop: 'Stop',
  prompt: 'UserPromptSubmit',
  userpromptsubmit: 'UserPromptSubmit',
};

/** 从 argv 里取 `--event=<名>` / `--event <名>` / `-e <名>`；没有就返回 null。 */
export function parseEventArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let raw = null;
    if (arg === '--event' || arg === '-e') raw = argv[i + 1] ?? null;
    else if (arg.startsWith('--event=')) raw = arg.slice('--event='.length);
    if (raw === null) continue;
    const text = raw.trim();
    if (!text) continue;
    return EVENT_ALIASES[text.toLowerCase()] ?? text;
  }
  return null;
}

/** 事件名：参数优先，payload 兜底（自检、手动跑脚本时靠它）。 */
export function resolveEvent(payload, argv = process.argv.slice(2)) {
  return parseEventArg(argv) ?? detectEvent(payload);
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
  return join(DOING_DIR, `${sid}.md`);
}
/**
 * 每个会话**一个文件**：`logs/<sid>.md`，里面分两个区：
 *
 *   ## 任务递送（queue-init / auto-continue）
 *   ## 提交守卫（auto-commit）
 *
 * 为什么要分区：Stop 上两个钩子并行跑，交错写进一条时间线后，
 * 排查时得逐行分辨"这行是哪个脚本写的"。分区后各看各的，谁也不用猜。
 *
 * 每区末尾是状态行 `<!-- s:auto … -->`（脚本读，markdown 预览里不可见），
 * 读取时取**最后一条**。
 *
 * 并发：整份重写必须串行化，用 `<sid>.md.lock` 抢锁（持锁 < 10ms）。
 * 抢不到就退化成"追加到文件末尾"——顺序乱一点，但内容不丢、解析照常。
 */
export function logPath(sid) {
  return join(LOGS_DIR, `${sid}.md`);
}

function logHeader(sid) {
  return [
    `# 会话日志 · ${sid}`,
    '',
    '> 钩子在本会话做了什么，只在本机（已 gitignore）。',
    '> `<!-- s:… -->` 是脚本读的状态行（位置不固定，读最后一条），markdown 预览里看不到。',
    '',
    '',
  ].join('\n');
}

export function readLogText(sid) {
  try {
    return readFileSync(logPath(sid), 'utf8');
  } catch {
    return null;
  }
}

const SECTIONS = {
  auto: '任务递送（queue-init / auto-continue）',
  commit: '提交守卫（auto-commit）',
};

/** 按标题把日志拆成「头部 + 两个区」；认不出的标题按头部处理，旧格式也能读。 */
function parseLog(text) {
  const head = [];
  const sections = { auto: [], commit: [] };
  let bucket = head;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim();
      if (title === SECTIONS.auto) {
        bucket = sections.auto;
        continue;
      }
      if (title === SECTIONS.commit) {
        bucket = sections.commit;
        continue;
      }
    }
    bucket.push(line);
  }
  return { head, sections };
}

/** 去掉首尾空行：不然每改写一次，标题下的空行就多一行（累积成一片空白）。 */
function trimBlank(lines) {
  const out = [...lines];
  while (out.length > 0 && out[0].trim() === '') out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function renderLog(sid, head, sections) {
  const headText = trimBlank(head).join('\n') || logHeader(sid);
  const block = (name) => {
    const body = trimBlank(sections[name]).join('\n');
    return body ? `## ${SECTIONS[name]}\n\n${body}` : `## ${SECTIONS[name]}`;
  };
  return `${headText}\n\n${block('auto')}\n\n${block('commit')}\n`;
}

/** 状态命名空间 → 区：`init` 与 `auto` 属任务递送，`commit` 属提交守卫。 */
function sectionKey(ns) {
  return ns === 'commit' ? 'commit' : 'auto';
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 抢 `<sid>.md.lock` 后改写整份日志。
 * 抢不到返回 false，调用处退化成追加——宁可顺序乱，也不要丢内容或卡住钩子。
 */
function withLogLock(sid, fn) {
  const file = logPath(sid);
  const lock = `${file}.lock`;
  const deadline = Date.now() + 400;
  mkdirSync(LOGS_DIR, { recursive: true });
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch {
      try {
        // 进程被杀会留下锁文件：超过 5 秒就当陈旧锁清掉
        if (Date.now() - statSync(lock).mtimeMs > 5000) unlinkSync(lock);
      } catch {
        /* 锁已经没了 */
      }
      if (Date.now() > deadline) return false;
      sleep(5);
    }
  }
  try {
    fn(file);
    return true;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* 忽略 */
    }
  }
}

function parseStateText(text, ns) {
  if (!text) return {};
  const re = new RegExp(`^<!-- s:${ns} (.*) -->$`);
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const matched = re.exec(lines[i].trim());
    if (!matched) continue;
    try {
      return JSON.parse(matched[1]) ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

export function loadState(sid, ns = 'auto') {
  return parseStateText(readLogText(sid), ns);
}

export function saveState(sid, state, ns = 'auto') {
  const json = JSON.stringify(state);
  const stateLine = `<!-- s:${ns} ${json} -->`;
  try {
    // 状态没变就不写：否则每轮都会多一行，日志很快被状态淹没
    if (JSON.stringify(loadState(sid, ns)) === json) return;
    const written = withLogLock(sid, (file) => {
      const { head, sections } = parseLog(readLogText(sid) ?? logHeader(sid));
      const key = sectionKey(ns);
      sections[key] = trimBlank(sections[key]).filter((line) => !line.startsWith(`<!-- s:${ns} `));
      sections[key].push(stateLine);
      writeFileSync(`${file}.tmp`, renderLog(sid, head, sections));
      renameSync(`${file}.tmp`, file);
    });
    // 抢不到锁：直接追加。解析器全文找最后一条状态行，位置不影响正确性
    if (!written) appendFileSync(logPath(sid), `${stateLine}\n`);
  } catch {
    /* 状态写不进去不影响主流程 */
  }
}

/** 每个区最多留 500 行；状态行即使被挤出窗口，也会补回到末尾（丢了状态=丢轮次计数）。 */
const LOG_KEEP_LINES = 500;

function capSection(lines) {
  if (lines.length <= LOG_KEEP_LINES) return lines;
  const kept = lines.slice(-LOG_KEEP_LINES);
  const lastState = new Map();
  for (const line of lines) {
    const matched = /^<!-- s:([^ ]*) /.exec(line);
    if (matched) lastState.set(matched[1], line);
  }
  for (const [ns, line] of lastState) {
    if (!kept.some((item) => item.startsWith(`<!-- s:${ns} `))) kept.push(line);
  }
  return kept;
}

/**
 * 当前钩子的名字 + 触发它的事件，由各钩子启动时登记，写进日志行首：
 * `[auto-continue · Stop]` / `[auto-continue · UserPromptSubmit]`。
 *
 * 事件名一起写进去是必须的：`auto-continue` 同时注册在 Stop 与 UserPromptSubmit 上，
 * 只写脚本名的话，"这一行是用户说话触发的"和"这一行是停下触发的"在日志里长得一模一样。
 */
let logTag = '';
let logEvent = '';

export function setLogTag(tag, event = '') {
  logTag = tag;
  // `(unknown)` 是 detectEvent 的兜底值，写进日志只会多一个没信息量的尾巴
  logEvent = event && event !== '(unknown)' ? event : '';
}

/**
 * 日志时间：**本地时区**，带 UTC 偏移（`2026-10-22 20:58:31 +08:00`）。
 *
 * 为什么不用 ISO（`2026-10-22T12:58:31Z`）：日志是给人看的，排查时脑子里是本地时间，
 * 每次换算 UTC 都在浪费注意力，而且很容易算错一小时。偏移量同时保留，跨时区对时间仍可行。
 */
export function localStamp(date = new Date()) {
  const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${ymd} ${hms} ${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
}

export function appendLog(sid, line, ns = 'auto') {
  const tag = logTag ? `[${logTag}${logEvent ? ` · ${logEvent}` : ''}] ` : '';
  const entry = `- ${localStamp()} · ${tag}${line}`;
  try {
    const written = withLogLock(sid, (file) => {
      const { head, sections } = parseLog(readLogText(sid) ?? logHeader(sid));
      const key = sectionKey(ns);
      // 先去掉区尾的空行（它来自上一个区标题前的分隔行），否则会夹在两条事件中间
      sections[key] = capSection([...trimBlank(sections[key]), entry]);
      writeFileSync(`${file}.tmp`, renderLog(sid, head, sections));
      renameSync(`${file}.tmp`, file);
    });
    if (!written) appendFileSync(logPath(sid), `${entry}\n`);
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
 * 队列**头部声明区**的行数：`# 标题` + 空行 + 4 个声明（状态 / 创建 / 批次 / 计划）。
 *
 * 为什么抽成一个常量、而不是每处各写 5：这扇窗口原来在三个地方各写了一遍
 * （`hold` / `parseBatch` / `parsePlanRef`）。加 `> 计划：` 时只想起前两处，
 * **第三处仍是 5，而标准头部里它正好是第 6 行**——于是"绑定计划"永远读不到，
 * 且没有任何报错（实测：第 6 行返回 `null`，挪到第 5 行才认）。
 * 同一个数字写两遍就会漂，这是本项目的老账。
 *
 * 为什么必须卡窗口、不能扫全文：正文里随便提一句模板（`> 状态：讨论中`、
 * `> 计划：plan-x.md`）就能改变整份队列的行为，而且只给用户弹一句提示，
 * AI 那边毫无感觉——排查起来像"钩子不干活"。
 */
export const QUEUE_HEAD_LINES = 6;

/**
 * 返回 { entries, counts, hold }。
 * `hold` 对应队列头部的 `> 状态：讨论中`——表示"还没打算开工，别催"。
 *
 * ⚠️ 只扫**头部声明区**（`QUEUE_HEAD_LINES`），不能扫全文。
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

  /**
   * 给每条一个**队列内序号**（从 1 起，按文件顺序）。
   *
   * 这个序号是条目的**稳定身份**，取代以前"取正文前 120 字当指纹"的做法：
   * 两条任务正文完全一样（"修 bug" ×2）时，指纹相同，隔离会标错对象；
   * 序号则天然互不相同。序号不落盘、每次解析重算——同一份文件解析结果总是一样的。
   */
  entries.forEach((entry, i) => {
    entry.seq = i + 1;
    entry.total = entries.length;
  });

  return {
    entries,
    counts,
    total: entries.length,
    hold: /状态\s*[:：]\s*讨论中/.test(lines.slice(0, QUEUE_HEAD_LINES).join('\n')),
  };
}

export function readQueue(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return { file, text, ...parseQueue(text) };
}

/**
 * 批次号：`YYYYMMDD-HHmm` 形式的时间戳，**开工那一刻生成，之后不变**。
 *
 * 为什么不再用"开工时的提交总数"当批次号（旧设计，已废弃）：
 *   · **不唯一**：两个会话在同一提交点开工，会拿到同一个号。本项目实测出现过
 *     `DONE.md` 里两个「批次 1」，事后完全分不清哪条属于哪一批；
 *   · **不稳定**：没写 `> 批次：` 时会回退成当前提交数，提交一次就漂一格（3→4）；
 *   · **语义错位**：提交数是"第几个提交"，批次是"第几批改动"，一批里会提交多次。
 *
 * 时间戳天然唯一、天然可排序，并且不需要任何人工维护——这类"派生得到且必须唯一"
 * 的编号，绝不该让人手抄。
 *
 * 精确到分钟：同一分钟内开两个会话仍可能撞。所以生成时由调用处做一次撞号检查
 * （见 `batchTaken`），撞了就顺延到下一分钟，保证全仓库唯一。
 */
export function makeBatch(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  );
}

/**
 * 批次号是否已被占用：扫 `DONE.md` 与 `doing/` 里所有已出现的批次号。
 *
 * 只看**这批还在不在进行中**是不够的——历史批次号必须也参与判重，
 * 否则十分钟后重开一批仍可能撞上归档里的旧号。
 */
export function batchTaken(batch) {
  const sources = [];
  try {
    sources.push(readFileSync(DONE_FILE, 'utf8'));
  } catch {
    /* 还没有 DONE.md：视为没占用 */
  }
  try {
    for (const name of readdirSync(DOING_DIR)) {
      if (!name.endsWith('.md')) continue;
      sources.push(readFileSync(join(DOING_DIR, name), 'utf8'));
    }
  } catch {
    /* 还没有 doing/：同上 */
  }
  const re = /^>\s*批次\s*[:：]\s*([0-9A-Za-z_-]+)/gm;
  return sources.some((text) => {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] === batch) return true;
    }
    return false;
  });
}

/**
 * 生成一个**当前未被占用**的批次号；撞了就往后顺延一分钟，最多试 24 小时。
 *
 * 顺延而不是加随机后缀：时间戳的语义是"这批什么时候开的"，
 * 顺延一分钟仍然能表达这个意思，而且保持可排序；随机后缀会破坏排序。
 */
export function nextBatch() {
  const at = new Date();
  for (let i = 0; i < 60 * 24; i += 1) {
    const candidate = makeBatch(at);
    if (!batchTaken(candidate)) return candidate;
    at.setMinutes(at.getMinutes() + 1);
  }
  return makeBatch(new Date());
}

/**
 * 取队列头部声明的批次号（`> 批次：20261022-1046`），没有就返回 null。
 *
 * **必须优先用它**，因为批次号是"这一批的固定编号"，一批里会提交很多次；
 * 每轮重算就会漂（旧设计 1→2→3 一路变，AI 照着写进 commit message，
 * `git log` 变成自相矛盾的一串）。取不到时**不要偷偷回退**——
 * 由调用处显式告警，见 `auto-continue.mjs`（静默回退是旧设计最隐蔽的坑）。
 *
 * 只看头部声明区（`QUEUE_HEAD_LINES`），与 `hold` 的判定范围保持一致。
 */
export function parseBatch(text) {
  if (!text) return null;
  const head = text.split(/\r?\n/).slice(0, QUEUE_HEAD_LINES).join('\n');
  const matched = /^>\s*批次\s*[:：]\s*([0-9A-Za-z_-]+)\s*$/m.exec(head);
  return matched ? matched[1] : null;
}

/**
 * 把指纹命中的那条改成 `- [阻塞]`（内容其余一字不动）。
 *
 * 这是**钩子唯一的写操作**：连续 N 轮没做完 → 隔离，不再递回来，
 * 但条目留在文件里等用户决策（改描述重试 / 删除 / 保留），脚本不替他删。
 */
/**
 * 把第 `seq` 条改成 `- [阻塞]`（内容其余一字不动）。
 *
 * 这是**钩子唯一的写操作**：连续 N 轮没做完 → 隔离，不再递回来，
 * 但条目留在文件里等用户决策（改描述重试 / 删除 / 保留），脚本不替他删。
 *
 * ⚠️ 必须按**序号**定位，不能按正文指纹。旧实现用"取正文前 120 字"当身份，
 * 队列里有两条一样的任务（`修 bug` ×2）时，两者指纹相同，隔离会标到**第一条**上，
 * 而实际正在做的可能是第二条——标错对象且毫无提示，后续所有统计都跟着错。
 * 序号（`parseQueue` 里按文件顺序算）天然互不相同。
 */
export function markBlocked(file, seq) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inFence = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (isFence(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const kind = classify(lines[i].trim());
    if (!kind) continue;
    seen += 1;
    if (seen !== seq) continue;
    if (kind !== 'todo' && kind !== 'doing') return false;
    lines[i] = lines[i].replace(/^(\s*-\s*)\[[^\]]*\]/, `$1${MARK.blocked}`);
    writeFileSync(file, lines.join('\n'));
    return true;
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
    return readdirSync(DOING_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ sid: name.slice(0, -3), file: join(DOING_DIR, name) }));
  } catch {
    return [];
  }
}

export function unfinishedCount(queue) {
  return queue ? queue.counts.todo + queue.counts.doing : 0;
}

// ------------------------------------------------------------------ 计划（plan-*.md）

/**
 * 计划文件的命名：`doing/plan-<名字>.md`。
 *
 * 为什么要卡这个前缀：`doing/` 里同时住着"会话队列"和"计划"两类文件，
 * 钩子靠前缀区分——队列按会话 ID 推导（`<sid>.md`），计划按 `plan-` 推导。
 * 前缀写错（`Plan-x.md` / `planx.md`）的后果是它被当成**别人的队列**：
 * `audit-ids` 会按队列去解析它、`audit-docs` 按队列体量算它，
 * 而真正的 plan 判定一次都不会触发——静默失效，最难查。
 *
 * 反过来，`plan-xxx` 也能通过"文件名像会话 ID"那条检查（`[A-Za-z0-9._-]{4,}`），
 * 所以不需要为它在 `audit-ids` 里开白名单。
 */
export const PLAN_FILE_RE = /^plan-[A-Za-z0-9._-]+\.md$/;

export function isPlanFile(name) {
  return PLAN_FILE_RE.test(name);
}

export function planPath(name) {
  return join(DOING_DIR, name);
}

/** 所有 `doing/plan-*.md`（不含会话队列）。读失败当作没有。 */
export function listPlans() {
  try {
    return readdirSync(DOING_DIR)
      .filter((name) => isPlanFile(name))
      .map((name) => ({ name, file: join(DOING_DIR, name) }));
  } catch {
    return [];
  }
}

/**
 * 队列头部的 `> 计划：plan-mobile.md` —— 声明"这一批是从哪份计划里取出来的"。
 *
 * 只读**头部声明区**（`QUEUE_HEAD_LINES`），与 `> 状态：讨论中` 同一套口径：
 * 正文里引用一句模板不能把整份队列绑到别的计划上（这个坑 `hold` 已经踩过一次）。
 *
 * 为什么把绑定写在队列里、而不是在计划里记"当前会话"：
 * 队列跟着批次进同一个提交，"这一批属于哪个计划"是**这一批**的事实；
 * 写进计划则一批结束就得回去改它，多一次无谓的写入和一份可能对不上的状态。
 *
 * **只认这一种写法**：`> 计划：<文件名>.md`，后面什么都不能跟。
 * 曾经允许过 `· 阶段 MS2.1`（门禁侧还校验了它），但"当前阶段"本来就是从计划里
 * 派生的（游标 = 第一条 `[~]`），写进队列头就是第二份副本、必然漂。
 * 现在多写一个字的后果是**解析不出来**——所以门禁侧对"有 `计划` 字样却解析不出"
 * 直接判红，不让它静默退化成普通队列。
 */
export function parsePlanRef(text) {
  const head = String(text ?? '').split(/\r?\n/).slice(0, QUEUE_HEAD_LINES).join('\n');
  const m = /^>\s*计划\s*[:：]\s*([A-Za-z0-9._-]+\.md)\s*$/m.exec(head);
  return m ? m[1] : null;
}

const MS_HEAD_RE = /^##\s+(MS\d+)\s*[·:：]\s*(.+?)\s*$/;
const MS_ACCEPT_RE = /^[-*]\s*验收\s*[:：]\s*(.+?)\s*$/;
const MS_CONFIRM_RE = /^[-*]\s*确认\s*[:：]\s*(.+?)\s*$/;
/** 阶段行：`- [x] \`MS2.1\` 描述 → 验收 \`cmd\` · 批次 \`20261022-2338\`` */
const STAGE_RE = /^-\s*\[[^\]]{0,6}\]\s*`(MS\d+\.\d+)`\s*(.*)$/;
const STAGE_BATCH_RE = /批次\s*`?([0-9]{8}-[0-9]{4})`?/;
const STAGE_VERIFY_RE = /→\s*验收\s*`([^`]+)`/;

/**
 * 解析 `doing/plan-*.md`。
 *
 * 结构（细则见 `.continue/notes/plan.md`；`README.md` 只留一句指针，因为它有行数上限）：
 *
 *   ## MS2 · 横屏 HUD          ← 里程碑标题，`MS<n>` 前缀就是归属
 *   - 验收：`npm run test:hud`  ← 这一里程碑做完要跑的命令（硬停时的凭证）
 *   - 确认：已验收 · 批次 `x`    ← 开发者确认过（**写在文件里**，换机器也认）
 *   - [~] `MS2.1` 描述 → 验收 `...` · 批次 `x`
 *
 * **游标不落盘**：它就是"第一条 `[~]`，没有就第一条 `[ ]`"。
 * 与队列条目号同一条原理——能派生的绝不手写，手写的一定会漂。
 *
 * `confirmed` / `acceptance` 只认**当前里程碑小节内**的行：跨小节复用会让
 * "MS1 的确认"被读成"MS2 也确认过了"，那等于自动放行整个里程碑关卡。
 */
export function parsePlan(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const milestones = [];
  let cur = null;
  let inFence = false;

  lines.forEach((line, index) => {
    if (isFence(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const trimmed = line.trim();

    const head = MS_HEAD_RE.exec(trimmed);
    if (head) {
      cur = {
        id: head[1],
        title: head[2],
        index,
        acceptance: [],
        confirm: null,
        stages: [],
      };
      milestones.push(cur);
      return;
    }
    // 任何其它二级标题都意味着"出了里程碑区"——标题下面的行不再归属上一个里程碑
    if (/^##\s/.test(trimmed)) {
      cur = null;
      return;
    }
    if (!cur) return;

    const accept = MS_ACCEPT_RE.exec(trimmed);
    if (accept) {
      cur.acceptance.push(accept[1]);
      return;
    }
    const confirm = MS_CONFIRM_RE.exec(trimmed);
    if (confirm) {
      cur.confirm = confirm[1];
      return;
    }

    const stage = STAGE_RE.exec(trimmed);
    if (!stage) return;
    const id = stage[1];
    const rest = stage[2];
    const verify = STAGE_VERIFY_RE.exec(rest);
    const batch = STAGE_BATCH_RE.exec(rest);
    const title = rest
      .replace(STAGE_VERIFY_RE, '')
      .replace(STAGE_BATCH_RE, '')
      .replace(/[·\s]+$/g, '')
      .trim();
    const entry = {
      id,
      ms: id.slice(0, id.indexOf('.')),
      kind: classify(trimmed) ?? 'todo',
      raw: trimmed,
      index,
      title,
      verify: verify ? verify[1] : null,
      batch: batch ? batch[1] : null,
    };
    cur.stages.push(entry);
  });

  const stages = milestones.flatMap((ms) => ms.stages);
  const cursor = stages.find((s) => s.kind === 'doing') ?? stages.find((s) => s.kind === 'todo') ?? null;

  return {
    milestones,
    stages,
    cursor,
  };
}

export function readPlan(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return { file, text, ...parsePlan(text) };
}

/**
 * 某个里程碑的阶段是否**在做完 `alsoDone` 这一条之后**全部完成。
 *
 * `alsoDone` 是必须的参数：调用点总是"队列已清空、但计划里这一条还没勾"，
 * 直接看计划会永远差一条，永远到不了边界——这个 off-by-one 会让里程碑
 * 关卡**从来不触发**，而现象只是"它自己往下跑了"，没有任何报错。
 */
export function milestoneComplete(plan, msId, alsoDone = null) {
  const stages = plan.stages.filter((s) => s.ms === msId);
  if (stages.length === 0) return false;
  return stages.every((s) => s.kind === 'done' || s.id === alsoDone);
}

// ------------------------------------------------------------------ 输出

/**
 * **同步**写 fd（1 = stdout / 2 = stderr）。
 *
 * 为什么不用 `process.stdout.write`：stdout 是管道时它是**异步**的，紧跟其后的
 * `process.exit()` 会把还没冲出去的尾巴直接丢掉。注入文本一长（协议 + 其他队列提醒 + 计划段），
 * JSON 就在中间被截断——宿主拿到坏 JSON，表现是"这个钩子没反应"，**而且没有任何报错**。
 *
 * 真实踩到：计划机制上线时注入文本涨了约 1.5KB，自检当场红了两条，
 * 但报的是"没有注入会话 ID"（因为 `JSON.parse` 抛了、ctx 变成空串），
 * 差点被当成解析逻辑写错。`writeSync` 直接落到 fd 上，排完才返回，不存在这个问题。
 */
export function writeFd(fd, text) {
  writeSync(fd, text);
}

/**
 * 放行。**唯一正常的停止条件**永远写在调用处，别在这里加默认值——
 * 否则"为什么没继续"和"为什么拦住了"都会变得说不清。
 */
export function emitAllow(systemMessage) {
  const out = { continue: true, suppressOutput: true };
  if (systemMessage) out.systemMessage = systemMessage;
  writeFd(1, `${JSON.stringify(out)}\n`);
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
  writeFd(1, `${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
  writeFd(2, `${feedback}\n`);
  process.exit(2);
}

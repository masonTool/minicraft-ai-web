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
 *      数据文档（TASKS / DONE / OVERVIEW / TIPS）由 AI 写，脚本不代笔，
 *      也不替它编 commit message；机制文档 README 跟着安装器走（真身在技能模板）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const CONTINUE_DIR = join(PROJECT_ROOT, '.continue');
/**
 * 进行中队列目录是 `doing/`（不是 `queues/`）。
 *
 * 名字直接对应状态：`doing/` 里是"正在做"的，收尾后整份搬进 `DONE.md`，原文追加到
 * `.logs/<会话ID>/queue.md`（**累积**：每个批次一节，新的在最上面，`----------` 分隔）。
 * 只在这一个常量里定义目录名——所有路径都从它推导，改名时只需改这里一行。
 */
export const DOING_DIR = join(CONTINUE_DIR, 'doing');
/**
 * 运行日志与归档：`.continue/.logs/<会话ID>/`。
 *
 * 为什么带点：`.continue/` 下不带点的是"给 AI 读的文档"（`README` / `TASKS` / `DONE` /
 * `OVERVIEW` / `TIPS` / `AGENTS`），`.logs/` 混在里面像第七份文档；带上点一眼看出是本机产物。
 * 老项目的 `.logs/` 由 `migrateLegacyLayout()` 整体改名，见下。
 */
export const LOGS_DIR = join(CONTINUE_DIR, '.logs');
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
  /**
   * 460：交接模式（§9）是第十节机制说明，写清楚"规划区 / 执行区"要 ~30 行；
   * 400 行时它会把原有条目挤掉。**上限仍按"一次能读完"定**，不是随内容无限涨——
   * 再加一节之前先想清楚能不能压缩掉旧的一段。
   */
  README: 460,
  DONE: 300,
  OVERVIEW: 200,
  /**
   * `TASKS` 是**台账**（每条需求一个 `T` 号，只 grep 不逐条读），所以比其它入口文档松一档：
   * 600 行 ≈ 几百条需求；再多说明该按分节拆文件了。
   *
   * ⚠️ 这里必须是**中性默认值**——它会跟着框架装进**每一个**项目。
   * 某个项目确有更大的台账时，改这里并写明理由（本文件是唯一来源），
   * 但别把那个项目的实测数字直接当默认值：那等于让新装项目的门禁默认关着。
   */
  TASKS: 600,
  TIPS: 500,
  QUEUE: 500,
};

/**
 * 文档体量的**字节**上限（与行数上限互补，缺一不可）。
 *
 * 为什么需要：行数会被"超长行"绕过——一份 499 行、190KB 的踩坑笔记，按行数看只是
 * "接近 500 行的薄文件"，按 token 看却是 README 的数倍。行数只适合"条目密度稳定"的文件；
 * 带大表格的文档必须同时看字节。
 *
 * 取值按"行数上限 × 每行约 100 字节"估、再留一档余量（TASKS 的条目带说明，所以单独给 60KB）。
 * 超了先删 / 归档；确实要放宽就改这里并写明理由（唯一来源）。
 */
export const DOC_BYTE_LIMITS = {
  README: 40 * 1024,
  DONE: 40 * 1024,
  OVERVIEW: 24 * 1024,
  TASKS: 60 * 1024,
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

/**
 * **协议指纹**：`hooks/` 下所有 `.mjs` 的内容哈希（16 位）。
 *
 * 为什么需要它（挡的是哪次事故）：`queue-init` 的协议只在会话**第一条消息**注入一次，
 * 那段文字一旦进了上下文就一直有效。技能升级 + 重跑安装器之后，钩子文件换新了，
 * 而**老会话里的 AI 手里还是旧协议**（旧路径、旧收尾步数）——它会照着旧规则把队列写到
 * 已经不读的位置，症状是"队列生成了却一点都不动"，而且没有任何报错。
 *
 * 判据用**文件内容**而不是版本号：开发期版本号常年不动（`audit-version` 早写过这条），
 * 版本号一样、协议已经换过的情况才是最常见的那种。
 *
 * 缓存一次：每个钩子进程只跑一次，算 10 来个文件的开销可以忽略。
 */
let protocolCache = null;
export function protocolFingerprint() {
  if (protocolCache) return protocolCache;
  try {
    const dir = join(CONTINUE_DIR, 'hooks');
    const parts = readdirSync(dir)
      .filter((name) => name.endsWith('.mjs'))
      .sort()
      .map((name) => `${name}\n${readFileSync(join(dir, name), 'utf8')}`);
    protocolCache = createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
  } catch {
    protocolCache = 'unknown';
  }
  return protocolCache;
}

/** 队列目录在项目内的相对路径，注入给 AI 的文案统一用它拼，避免各处写死。 */
export const DOING_REL = '.continue/doing';

/**
 * 老版本的目录名 / 文件名，只用于**自动迁移**，不要在任何新文案里出现。
 *
 * 老项目升级后：
 *   · `queues/`（旧队列目录）→ 逐文件搬进 `doing/`；
 *   · `logs/`（旧日志目录）→ 整体改名为 `.logs/`；
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
  /**
   * 日志目录 `logs/` → `.logs/`（2026-10-24 改名，与 `.worktree/` 一致的"本机产物"写法）。
   *
   * 两边都在时**不动**：说明迁过一半，或用户手工建了新的；合并两份日志等于把
   * 两个会话的历史搅在一起，交给人判断更安全。
   */
  try {
    const legacyLogs = join(CONTINUE_DIR, 'logs');
    if (existsSync(legacyLogs) && !existsSync(LOGS_DIR)) {
      renameSync(legacyLogs, LOGS_DIR);
      notes.push('已把日志目录 `logs/` 改名为 `.logs/`');
    }
  } catch {
    /* 迁不动就维持现状：读不到旧日志不影响递任务 */
  }
  /**
   * 旧版计划文件（`doing/<会话ID>-plan.md`）：计划机制已移除，里程碑现在写在队列里。
   * 搬进 `.logs/<会话ID>/plan.md` **归档**（不删）——内容还在，只是不再参与任何判定。
   * 不搬的话它会永远躺在 `doing/` 里，看起来像"还有另一份进度"，还会被当成别人的队列。
   */
  try {
    if (existsSync(DOING_DIR)) {
      for (const name of readdirSync(DOING_DIR)) {
        if (!isLegacyPlanFile(name)) continue;
        const sid = sessionOfLegacyPlan(name);
        if (!sid) continue;
        const dest = join(LOGS_DIR, shortSid(sid), 'plan.md');
        const text = readFileSync(join(DOING_DIR, name), 'utf8');
        mkdirSync(dirname(dest), { recursive: true });
        appendFileSync(dest, `\n## 旧计划（计划机制已移除）· ${localStamp()}\n\n${text.trimEnd()}\n`);
        unlinkSync(join(DOING_DIR, name));
        notes.push(`已把旧计划 \`${name}\` 归档到 \`.logs/${shortSid(sid)}/plan.md\``);
      }
    }
  } catch {
    /* 归档失败不影响主流程：那一份本来也不参与判定 */
  }
  /**
   * 老版交接目录 `.continue/worktree/` → `.continue/doing/.worktree/`（2026-10-24 迁的）。
   *
   * 为什么必须迁：老会话里的协议还指着旧路径，它会把队列写进 `.continue/worktree/todo/`，
   * 而新钩子只读 `doing/.worktree/todo/`——文件在、钩子看不见，表现成"队列不动"。
   * 只搬**收件箱文件**，不搬树目录：树是 git worktree，改路径会让 git 自己的记录失效
   * （那些树由用户按提示手工处理）。
   */
  try {
    const legacyWorktree = join(CONTINUE_DIR, 'worktree');
    const legacyTodo = join(legacyWorktree, 'todo');
    if (existsSync(legacyTodo)) {
      mkdirSync(TODO_DIR, { recursive: true });
      const moved = [];
      for (const name of readdirSync(legacyTodo)) {
        const from = join(legacyTodo, name);
        const to = join(TODO_DIR, name);
        if (existsSync(to)) continue;
        renameSync(from, to);
        moved.push(name);
      }
      if (moved.length > 0) {
        notes.push(
          `已把待派发队列从旧的 \`worktree/todo/\` 迁到 \`.continue/doing/.worktree/todo/\`：${moved.join('、')}`,
        );
      }
      if (readdirSync(legacyTodo).length === 0) rmdirSync(legacyTodo);
    }
  } catch {
    /* 迁不动就维持现状：旧路径的队列还在，人手工搬一次即可 */
  }
  return notes;
}

/**
 * 四态（沿用本框架早期的钩子实现，语义不变）：
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

/**
 * 文件名里用的**短会话 ID**：UUID 形态只取前 6 位。
 *
 * 为什么只截 UUID：真实会话 ID 是 32 位 hex 或带横线的 UUID，前 6 位（24 bit）足够
 * 区分同时在跑的几个人；而 `s-plan-next` 这类**本来就是短标识**的 ID（自检夹具、
 * 某些平台的自定义 ID）一截就会撞车（`s-plan-next` / `s-plan-edge` 都变 `s-plan`），
 * 撞车的后果是两个会话共用一份队列——比文件名长得多严重。
 *
 * 撞车兜底：队列头部仍写**完整** session id（`# 队列 · 会话 <full>`），
 * `audit-docs` 会核对"头部的前 6 位 == 文件名"，对不上就判红。
 */
export function shortSid(sid) {
  const text = String(sid ?? '');
  const isUuid =
    /^[0-9a-f]{32}$/i.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
  return isUuid ? text.slice(0, 6) : text;
}

/** 队列文件名（含扩展名）。三类文件名只在这里定义一次。 */
export function queueFileName(sid) {
  return `${shortSid(sid)}.md`;
}

export function queuePath(sid) {
  return join(DOING_DIR, queueFileName(sid));
}
/**
 * 每个会话**一个文件**：`.logs/<sid>.md`，里面分两个区：
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
  return join(LOGS_DIR, shortSid(sid), 'run.md');
}

/**
 * 「这个会话还在跑吗」：`.logs/<sid6>/run.md` 最近 N 分钟有写入。
 *
 * 为什么不用队列文件的 mtime：它只在**改队列**时更新，而 AI 读代码 / 跑测试的十几分钟里
 * 队列一动不动，会被误判成"这个会话早死了"——判错的代价是两条路都错：
 * 对活会话开工作树（白开），或对死会话串行等（白等）。
 * 钩子每轮都写日志，那才是"活着"的证据。
 * 为什么不在状态里记 pid：宿主重启 / 换机器后 pid 会被复用，时间戳没有这个问题。
 *
 * 判据是"最近 N 分钟"，不是"一定在跑"——所以注入里只写"可能还在跑"，让人来定。
 */
export const ACTIVE_WINDOW_MIN = 15;

export function isSessionActive(sid, minutes = ACTIVE_WINDOW_MIN) {
  try {
    return Date.now() - statSync(logPath(sid)).mtimeMs < minutes * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * 当前工作区是不是一棵**并行工作树**（不是主工作区）。
 *
 * 判据：`git rev-parse --absolute-git-dir` 与 `--git-common-dir` 不同。
 * 主工作区里两者指同一个 `.git`；worktree 里前者是 `.git/worktrees/<名字>`、
 * 后者指回主仓库的 `.git`。
 *
 * 为什么注入需要它：树是从 HEAD 检出的，父树 `doing/` 里**已入库**的队列会一起跟过来，
 * 看起来就像"别的会话正在这棵树里跑"——其实它们属于另一棵树。照旧列出会诱发
 * "要不要接管"的假决策，而正确答案是"那些跟你无关"。
 */
export function isInsideWorktree() {
  const git = (...args) =>
    spawnSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const gitDir = git('rev-parse', '--absolute-git-dir').stdout?.trim() ?? '';
  const commonDir = git('rev-parse', '--git-common-dir').stdout?.trim() ?? '';
  if (!gitDir || !commonDir) return false;
  return resolve(PROJECT_ROOT, commonDir) !== gitDir;
}

/** 归档目录（队列 / 决策记录 / 历史遗留的旧计划都放这儿，按会话分）。 */
export function archiveDirFor(sid) {
  return join(LOGS_DIR, shortSid(sid));
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
  // 日志现在住在 `.logs/<会话ID>/run.md`，锁也在同一层 → 建目录要用 file 的父目录
  mkdirSync(dirname(file), { recursive: true });
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
    if (!written) {
      mkdirSync(dirname(logPath(sid)), { recursive: true });
      appendFileSync(logPath(sid), `${entry}\n`);
    }
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
 * 队列**头部声明区**的行数：`# 标题` + 空行 + 3 个声明（状态 / 创建 / 批次）。
 *
 * 为什么抽成一个常量、而不是每处各写：这扇窗口原来在 `hold` 与 `parseBatch` 里各写一遍，
 * 加第三个读者时漏改了一个——**同一个数字写两遍就会漂**，这是本项目的老账。
 * 数字只有一处，改起来才敢改。
 *
 * 为什么必须卡窗口、不能扫全文：正文里随便提一句模板（`> 状态：讨论中`）
 * 就能改变整份队列的行为，而且只给用户弹一句提示，AI 那边毫无感觉——
 * 排查起来像"钩子不干活"。
 */
export const QUEUE_HEAD_LINES = 5;

/**
 * 里程碑节点：写在**队列文件里**的一行二级标题。
 *
 *   ## 里程碑 MS1 · 横屏 HUD
 *   - 验收：`npm run test:hud`
 *   - 确认：已验收 · 批次 20261023-1018     ← 只在人工验收之后写
 *
 * 为什么放在队列里、而不是另建一份计划文件（旧设计）：
 * 计划文件是"队列之外的第二份进度副本"，两份必然漂——它和队列的顺序、批次号、
 * 完成状态全是同一件事的两种表达。里程碑本来就是"队列里的一个位置"，
 * 写在同一份文件里，顺序与状态天然只有一份。
 *
 * `MS\d+` 前缀是解析锚点；`· <名>` 是给人看的。`- 验收：` 是硬停时要跑的命令，
 * `- 确认：` 是"人验收过"的凭证（**只有收到用户答复之后才能写**）。
 */
const MS_HEAD_RE = /^##\s*里程碑\s*(MS\d+)\s*[·:：]\s*(.+?)\s*$/;
const MS_ACCEPT_RE = /^[-*]\s*验收\s*[:：]\s*(.+?)\s*$/;
const MS_CONFIRM_RE = /^[-*]\s*确认\s*[:：]\s*(.+?)\s*$/;

/** 解析队列里的里程碑节点（围栏代码块里的格式示例不算）。 */
export function parseMilestones(text) {
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
      cur = { id: head[1], title: head[2], index, acceptance: [], confirm: null, line: trimmed };
      milestones.push(cur);
      return;
    }
    // 任何其它二级标题都意味着"出了这个里程碑的小节"
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
    if (confirm) cur.confirm = confirm[1];
  });
  return milestones;
}

/**
 * 返回 { entries, counts, hold, milestones }。
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
    milestones: parseMilestones(text),
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
 * 队列文件的**原子写回**：先写 `<file>.tmp` 再 rename。
 *
 * 为什么不能直接 `writeFileSync(file)`：队列是**唯一事实源**（这一批做到哪一步就在这几行里），
 * 写到一半被杀 / 断电，留下的是半截文件——那是"丢进度"级别的损坏。日志（非事实源）早就在用
 * tmp+rename，事实源没有理由比日志更随便。
 *
 * `eol` 按**原文件**传：`split(/\r?\n/)` 再 `join('\n')` 会把 CRLF 文件整体改写成 LF，
 * 在 Windows 上等于整份队列重写一遍（diff 全红，还容易和别人的改动撞车）。
 */
function writeQueueFile(file, lines, eol) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, lines.join('\n').replace(/\n/g, eol));
  renameSync(tmp, file);
}

/** 原文件的换行风格：有 CRLF 就按 CRLF 写回（只看第一行，不必扫全文）。 */
function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

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
  const text = readFileSync(file, 'utf8');
  const eol = detectEol(text);
  const lines = text.split(/\r?\n/);
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
    writeQueueFile(file, lines, eol);
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

/**
 * 找出"名字写错"的队列文件：前缀和本会话相同、又不是那个精确短名。
 *
 * 为什么需要它：文件名就是契约（钩子按会话 ID 直接算路径），写错一个字符，
 * 整套机制就**静默失效**——队列还在，但钩子永远找不到它，AI 以为自己在按流程走。
 * 实测形态：模型把文件名写成了**完整会话 ID**（`e2e000…e.md` 而不是 `e2e000.md`）。
 *
 * 只报不改：前缀相同也可能是**另一个会话**（6 位撞车），自动改名会踩别人。
 * 这里只负责把"你可能写错了"摆到明面上，改不改由 AI 判断。
 */
/**
 * 认领"用完整会话 ID 命名"的队列文件：`<full-sid>.md` → `<sid6>.md`。
 *
 * 只认**完整 ID 完全相等**这一种：那个名字全局唯一，一定是本会话写的；
 * 而"前缀相同"的其它文件可能是另一个会话（6 位撞车），绝不动。
 *
 * 为什么是改名而不是"让 AI 自己改"：实测模型建完就往下走了，拦截提示它看得到、
 * 但不一定回头改；而这一步**没有任何歧义**（完整 ID 就是我们自己），脚本做掉最省事。
 */
export function adoptStrayQueue(sid) {
  const from = join(DOING_DIR, `${sid}.md`);
  const to = queuePath(sid);
  if (from === to || !existsSync(from) || existsSync(to)) return null;
  try {
    renameSync(from, to);
    return queueFileName(sid);
  } catch {
    return null;
  }
}

export function findStrayQueue(sid) {
  const want = shortSid(sid);
  try {
    return (
      readdirSync(DOING_DIR)
        .filter(
          (name) =>
            name.endsWith('.md') &&
            !isLegacyPlanFile(name) &&
            !isDecisionFile(name) &&
            !isWorktreeHandoffFile(name),
        )
        .find((name) => {
          const stem = name.slice(0, -3);
          return stem !== want && stem.startsWith(want) && stem.length > want.length;
        }) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * 只列**会话队列**：`doing/` 里还可能有历史遗留的计划文件、`<sid>-decision.md`
 * 与待接管的 `worktree.md`。
 */
export function listQueues() {
  try {
    return readdirSync(DOING_DIR)
      .filter((name) => name.endsWith('.md'))
      .filter((name) => !isLegacyPlanFile(name) && !isDecisionFile(name) && !isWorktreeHandoffFile(name))
      .map((name) => ({ sid: name.slice(0, -3), file: join(DOING_DIR, name) }));
  } catch {
    return [];
  }
}

/**
 * 把某条 `[ ]` **就地**改成 `[~]`（钩子在递任务时调用）。
 *
 * 为什么由钩子改而不是等 AI 自己勾：实测经常看到"正在做的那条还挂着 `[ ]`"——
 * AI 改队列的时机不稳定（有时做完才一起改，有时压根不改）。而"当前在做什么"是**钩子自己知道**的
 * 事实（它就是发这条指令的人），由它落盘最可靠。
 *
 * 用 `entry.index`（行号）定位，只替换那一行的勾选框，不动行尾的批注与缩进。
 */
export function markEntryDoing(file, entry) {
  if (!entry || entry.kind !== 'todo') return false;
  try {
    const text = readFileSync(file, 'utf8');
    const eol = detectEol(text);
    // 与 `parseQueue` 同一套切分（`\r?\n`）：`entry.index` 就是这么算出来的，
    // 两边切法不一致时行号会错位（CRLF 队列上表现为"标到了别的条目"）。
    const lines = text.split(/\r?\n/);
    const i = entry.index;
    if (i < 0 || i >= lines.length) return false;
    const next = lines[i].replace(/- \[ \]/, '- [~]');
    if (next === lines[i]) return false;
    lines[i] = next;
    writeQueueFile(file, lines, eol);
    return true;
  } catch {
    return false;
  }
}

export function unfinishedCount(queue) {
  return queue ? queue.counts.todo + queue.counts.doing : 0;
}

/**
 * **历史遗留**：旧版本把长任务拆到 `doing/<会话ID>-plan.md`（独立的计划文件）。
 * 该机制已移除，计划节点现在写在队列文件里（见 `parseMilestones`）。
 *
 * 这里只保留"认出它们"的能力，用途有两个：
 *   · `listQueues` / `findStrayQueue` 别把旧计划当成别人的队列（否则注入里会
 *     反复提示"其他会话还有未完成队列"，诱导 AI 去接管一份早就作废的计划）；
 *   · `migrateLegacyLayout()` 把它们搬进 `.logs/`（归档，不删），免得 forever 留在 `doing/`。
 */
const LEGACY_PLAN_RE = /^[A-Za-z0-9._-]+-plan\.md$/;

export function isLegacyPlanFile(name) {
  return LEGACY_PLAN_RE.test(name);
}

/** 旧计划文件名 → 它属于哪个会话（前缀）。 */
export function sessionOfLegacyPlan(name) {
  const m = /^([A-Za-z0-9._-]+?)-plan\.md$/.exec(name);
  return m ? m[1] : null;
}

/**
 * 会话**决策记录**：`doing/decision-<session_id>.md`。
 *
 * 用户的规则：需要拍板的地方**以 AI 的意见为准**，但每一处都要记成人能看懂的形式留底。
 * 于是它和队列一样是"正在做"的文件，收尾时同样**追加**进 `.logs/<会话ID>/decision.md`
 * （累积、按批次分节，新的在最上面）。
 *
 * 为什么也叫 `<sid>` 结尾：两类文件（队列 / 决策）靠前缀区分、靠会话 ID 配对，
 * 归档后还能一眼看出属于同一轮工作。
 */
export const DECISION_FILE_RE = /^([A-Za-z0-9._-]+?)-decision\.md$/;
export function isDecisionFile(name) {
  return DECISION_FILE_RE.test(name);
}
export function decisionNameFor(sid) {
  return `${shortSid(sid)}-decision.md`;
}
export function decisionPathFor(sid) {
  return join(DOING_DIR, decisionNameFor(sid));
}
export function sessionOfDecision(name) {
  const m = DECISION_FILE_RE.exec(name);
  return m ? m[1] : null;
}

/**
 * **待接管队列**：`.continue/doing/worktree.md`。
 *
 * 谁写的：`worktree.mjs` 建树时，把父会话的交接任务写进树里的这个文件名。
 * 谁接管：树里的第一个会话（`queue-init`）把它改名成 `doing/<sid6>.md`，
 * 改名那一刻它才成为"某个会话的队列"。
 *
 * 为什么必须从 `listQueues` / `findStrayQueue` 里排掉（挡的是哪次事故）：
 * 实测（2026-10-23）建完树第一件事就是自己催自己——`listQueues()` 返回
 * `['042a8b', 'worktree']`，注入里于是出现两条"其他会话还有未完成队列"：
 * 一条是父树的真队列（随 HEAD 带过来的），另一条就是这份**还没被接管**的交接队列。
 * 后果不是"少做一件事"，而是把 AI 引向"要不要接管 worktree 这个会话"—
 * 正确答案却是"改名，然后干活"。
 *
 * 这也解释了为什么它不能被当成 `<sid>` 队列：`worktree` 不是会话 ID，
 * 拿它去比 `findStrayQueue()` 的前缀还会误判成"本会话队列名字写错了"。
 */
export const WORKTREE_HANDOFF_NAME = 'worktree.md';

export function isWorktreeHandoffFile(name) {
  return name === WORKTREE_HANDOFF_NAME;
}

/** 待接管队列的绝对路径（`queue-init` 改名接管时用）。 */
export function worktreeHandoffPath() {
  return join(DOING_DIR, WORKTREE_HANDOFF_NAME);
}

/**
 * 接管待接管队列：`doing/worktree.md` → `doing/<sid6>.md`，并把头部会话 ID 补成**完整**的。
 *
 * 为什么由钩子做、不等 AI 手工 `git mv`：手工版有三步（改名、补头部、保住批次号），
 * 漏第三步不会被任何检查发现——批次号一换，`DONE.md` / `OVERVIEW.md` / commit message
 * 会被拆成两批，"一批一个号"当场失效。这里返回分支明确的结果，让注入把
 * 「已接管 / 冲突 / 失败」三种情况都写出来，没有一种会静默。
 *
 * 冲突时**不覆盖**：目标队列已存在说明本会话已经有一份队列（重复开会话 / 手工建过），
 * 覆盖等于丢进度——交给注入告警，由人合并。
 */
export function adoptWorktreeHandoff(sid) {
  const from = worktreeHandoffPath();
  if (!existsSync(from)) return null;
  const to = queuePath(sid);
  if (existsSync(to)) return { conflict: true, target: queueFileName(sid) };
  try {
    const text = readFileSync(from, 'utf8');
    const eol = detectEol(text);
    const lines = text.split(/\r?\n/);
    // 只动**第一行**（`# 队列 · 会话 <id>`）：`audit-docs` 用它核对"前 6 位 == 文件名"
    const i = lines.findIndex((line) => /^#\s*队列\s*·\s*会话\s+/.test(line));
    if (i >= 0) lines[i] = `# 队列 · 会话 ${sid}`;
    // 先原子写内容（保住原换行风格），再改名：改名失败时文件仍在原名下，下次还能接上
    writeQueueFile(from, lines, eol);
    renameSync(from, to);
    return { renamed: true, target: queueFileName(sid) };
  } catch (err) {
    return { error: err.message };
  }
}

// ------------------------------------------------------------------ 交接收件箱（dispatch）

/**
 * 交接收件箱：`<主工作区>/.continue/doing/.worktree/todo/`。
 *
 * 工作流（2026-10-24 定）分成两段，**规划区与执行区分离**：
 *
 *   1. 主工作区里规划完，把**整份队列**写进 `todo/queue.md`、把这一轮的上下文（中文）
 *      写进 `todo/context.md`，然后停手——**不建** `doing/<sid>.md`，也不在本树干活；
 *   2. Stop 钩子 `dispatch.mjs` 看到待派发内容 → 基于 HEAD 建工作树
 *      `doing/.worktree/<sid6>`（分支 `continue/<sid6>`）并拉一个新 IDE 窗口；
 *   3. 新窗口里第一个会话由 `queue-init` 接管：读 todo → 写成 `doing/<新sid6>.md`
 *      （批次沿用）→ 把 context 附进注入并存档，然后清空 todo。
 *
 * **前提：`doing/` 里已经有别的会话队列**。主工作区空着（没人在跑）时不该派发——
 * 那种情况直接写 `doing/<sid>.md` 在本会话干，多开一个窗口只是把简单事情拆成两步。
 * 门在协议层（`queue-init` 注入），`dispatch` 再挡一次。
 *
 * 为什么放在 `doing/` 下：`.worktree` 是**队列的附属物**（待派发的队列、派发出去的树），
 * 和 `doing/*.md` 放在一起才符合"这一批活在哪"的直觉；`.continue/.gitignore` 里的
 * `.worktree/` 规则对任意层级生效，仍然不会进版本库。`listQueues()` 只扫 `*.md`，
 * 目录不会被当成会话队列。
 */
export const WORKTREE_DIR = join(DOING_DIR, '.worktree');

/**
 * 工作树命名：`worktree_<单词>_<YYYYMMDD>`，**分支同名**。
 *
 * 为什么是这个形状（用户 2026-10-24 定的）：目录名与分支名要能一眼看出"这棵树干什么的、
 * 哪天的"。单词由 AI 按**这一批的需求**取（`export` / `auth` / `perf` 这类），
 * 日期由脚本算——日期交给模型生成一定会漂，单词交给脚本只能得到 `task`。
 *
 * 为什么分支名不再带父目录前缀（旧形态 `continue/<父目录名>-<名字>`）：用户要求两处同名，
 * 且收尾不再自动合并（见 README §9），所以不需要从分支名反推血缘。
 *
 * 同一天同一个单词撞了的兜底是 `-2`、`-3`（追加在日期后面），主形态不变。
 */
export const WORKTREE_NAME_RE = /^worktree_([a-z][a-z0-9]{0,15})_(\d{8})(?:-\d+)?$/;
/** 单词本身：字母开头、字母/数字、2~16 字符。下划线不行——它会让名字切分有歧义。 */
const WORKTREE_WORD_RE = /^[a-z][a-z0-9]{1,15}$/;

/** `YYYYMMDD`（本地时区：用户看的是自己的今天）。 */
export function dateStamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
}

/**
 * 从参数里取"单词"。
 *
 * 接受两种写法：`<单词>`（AI / 人正常用法）与完整树名 `worktree_<单词>_<日期>`（照抄旧名字
 * 重跑时不该报错）。取不出返回 null，由调用处报用法——**不猜**（猜错就是把树建在别的名字下，
 * 用户按提示 `cd` 会找不到）。
 */
export function normalizeWorktreeWord(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (WORKTREE_WORD_RE.test(text)) return text;
  const full = WORKTREE_NAME_RE.exec(text);
  if (full) return full[1];
  return null;
}

/** 树名（= 分支名）：`worktree_<单词>_<YYYYMMDD>`；`seq` > 1 时追加 `-<seq>`。 */
export function worktreeName(word, at = new Date(), seq = 1) {
  return `worktree_${word}_${dateStamp(at)}${seq > 1 ? `-${seq}` : ''}`;
}
export const TODO_DIR = join(WORKTREE_DIR, 'todo');
export const TODO_REL = '.continue/doing/.worktree/todo';
export const TODO_QUEUE_NAME = 'queue.md';
export const TODO_CONTEXT_NAME = 'context.md';
export const TODO_STATE_NAME = 'state.json';

/**
 * 主工作区根目录（收件箱永远在**主工作区**，不在某棵树里）。
 *
 * 判据用 `git rev-parse --git-common-dir`：worktree 里它指回主仓库的 `.git`，
 * 主工作区里它就是 `.git`。为什么不让每棵树自己维护一份 todo：队列是一份交接凭据，
 * 复制到树里就变成两份，谁先认领、谁作废会立刻说不清。
 *
 * 拿不到 git（不是仓库 / 没装 git）时退回 `PROJECT_ROOT`：最坏是"在树里读不到收件箱"，
 * 而抛异常会让所有钩子崩掉——那连队列都不会递。
 */
let mainRootCache;
export function mainWorktreeRoot() {
  if (mainRootCache !== undefined) return mainRootCache;
  const git = (...args) =>
    spawnSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const common = git('rev-parse', '--git-common-dir').stdout?.trim() ?? '';
  if (!common) return (mainRootCache = PROJECT_ROOT);
  const abs = resolve(PROJECT_ROOT, common);
  mainRootCache = basename(abs) === '.git' ? dirname(abs) : PROJECT_ROOT;
  return mainRootCache;
}

/** 收件箱三个文件的绝对路径（主工作区）。 */
export function todoPaths(root = mainWorktreeRoot()) {
  const dir = join(root, '.continue', 'doing', '.worktree', 'todo');
  return {
    dir,
    queue: join(dir, TODO_QUEUE_NAME),
    context: join(dir, TODO_CONTEXT_NAME),
    state: join(dir, TODO_STATE_NAME),
  };
}

/**
 * 读收件箱。**只看 queue.md**：没有它就等于"没有待派发内容"，
 * context 单独存在没有意义（不知道要做什么），不驱动任何行为。
 *
 * 字段名刻意分成「路径」与「内容」两组（`queuePath` / `text`）：
 * 早先把内容直接叫 `queue`、又用 `...paths` 铺开，路径当场被内容覆盖，
 * dry-run 打印"收件箱："时把整份队列吐了出来。
 */
export function readTodo(root = mainWorktreeRoot()) {
  const paths = todoPaths(root);
  if (!existsSync(paths.queue)) return null;
  let text = '';
  try {
    text = readFileSync(paths.queue, 'utf8');
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  let context = '';
  try {
    context = readFileSync(paths.context, 'utf8');
  } catch {
    context = '';
  }
  let state = null;
  try {
    state = JSON.parse(readFileSync(paths.state, 'utf8'));
  } catch {
    state = null;
  }
  return {
    dir: paths.dir,
    queuePath: paths.queue,
    contextPath: paths.context,
    statePath: paths.state,
    text,
    context,
    state,
  };
}

/** 派发状态：记下"这次已经派发过"，Stop 每次触发时据此避免重复建树。 */
export function writeTodoState(state, root = mainWorktreeRoot()) {
  const paths = todoPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * 原子认领：`queue.md` → `queue.md.claim-<sid6>`。
 *
 * 为什么必须用 rename 而不是"先读再删"：两个新窗口同时收到第一条消息时，
 * 两边都会看到同一个 `queue.md`；`rename` 只有一个能成功，另一个拿到 ENOENT
 * 后退化成"已被别的会话接管，别重复做"——这正是要的结果。
 */
export function claimTodo(sid, root = mainWorktreeRoot()) {
  const paths = todoPaths(root);
  const claim = join(paths.dir, `${TODO_QUEUE_NAME}.claim-${shortSid(sid)}`);
  try {
    renameSync(paths.queue, claim);
    return { ...paths, claim };
  } catch {
    return null;
  }
}

/**
 * 新会话接管收件箱：todo/queue.md → `doing/<sid6>.md`，并把 context 存档。
 *
 * 返回三种结果（注入要把三种都说出来，没有一种能静默）：
 *   · `{ adopted }`  接管成功；`context` 原文交给注入使用，`batch` 让批次号延续；
 *   · `{ conflict }` 本会话已有队列——**不动 todo**（覆盖等于丢进度），交给人合并；
 *   · `{ error }`    认领/写入失败；认领文件会放回原名，下次会话还能接上。
 */
export function adoptTodoHandoff(sid) {
  const root = mainWorktreeRoot();
  const paths = todoPaths(root);
  if (!existsSync(paths.queue)) return null;
  const target = queuePath(sid);
  if (existsSync(target)) return { conflict: true, target: queueFileName(sid) };

  const claimed = claimTodo(sid, root);
  if (!claimed) return { error: '认领失败（另一个会话可能刚接管，或磁盘不可写）' };

  try {
    const text = readFileSync(claimed.claim, 'utf8');
    const eol = detectEol(text);
    const lines = text.split(/\r?\n/);
    // 只动第一行的会话 ID：`audit-docs` 用它核对"前 6 位 == 文件名"
    const i = lines.findIndex((line) => /^#\s*队列\s*·\s*会话\s+/.test(line));
    if (i >= 0) lines[i] = `# 队列 · 会话 ${sid}`;
    else lines.unshift(`# 队列 · 会话 ${sid}`, '');
    // 新树是 `git worktree add` 检出的：git 不跟踪空目录，`doing/` 在这里通常不存在
    mkdirSync(DOING_DIR, { recursive: true });
    writeQueueFile(target, lines, eol);

    let context = '';
    try {
      context = readFileSync(claimed.context, 'utf8');
    } catch {
      context = '';
    }
    if (context.trim()) {
      mkdirSync(archiveDirFor(sid), { recursive: true });
      writeFileSync(join(archiveDirFor(sid), 'handoff.md'), context);
    }

    unlinkSync(claimed.claim);
    for (const file of [claimed.context, claimed.state]) {
      try {
        unlinkSync(file);
      } catch {
        /* 没有就没有 */
      }
    }
    return { adopted: true, target: queueFileName(sid), context, batch: parseBatch(text) };
  } catch (err) {
    // 写队列失败必须把认领文件放回去：留在 `.claim-<sid>` 下，下次会话读不到、也不会自己恢复
    try {
      renameSync(claimed.claim, paths.queue);
    } catch {
      /* 放不回去时至少保留文件，人工可捞 */
    }
    return { error: err.message };
  }
}

/**
 * 找 IDE 的命令行入口（`code -n <目录>` 开新窗口）。
 *
 * 判据是**能力存在**，不是"宿主叫什么"：伪装宿主名容易误判，而"这个路径下有一个
 * 能 `-n` 开窗口的 `code` 命令"是可以直接检查的事实。找不到返回 null，
 * 调用方必须打印可复制的命令——**不假装成功**（用户看不到窗口会以为是建树失败）。
 */
export function findIdeCli() {
  const candidates = [
    '/Applications/CodeBuddy CN.app/Contents/Resources/app/bin/code',
    '/Applications/CodeBuddy.app/Contents/Resources/app/bin/code',
    '/Applications/WorkBuddy.app/Contents/Resources/app/bin/code',
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const found = spawnSync('sh', ['-c', 'command -v code'], { encoding: 'utf8' });
  const onPath = (found.stdout ?? '').trim();
  return onPath && existsSync(onPath) ? onPath : null;
}

/** 交接派发的配置（`config.json` 的 `worktree` 段）；缺省全开，缺键按默认值。 */
export function worktreeConfig() {
  const config = loadConfig();
  const section = config?.worktree ?? {};
  return {
    auto: section.auto !== false,
    openWindow: section.openWindow !== false,
  };
}

// ------------------------------------------------------------------ 输出

/**
 * **同步**写 fd（1 = stdout / 2 = stderr）。
 *
 * 为什么不用 `process.stdout.write`：stdout 是管道时它是**异步**的，紧跟其后的
 * `process.exit()` 会把还没冲出去的尾巴直接丢掉。注入文本一长（协议 + 其他队列提醒 + 里程碑提示），
 * JSON 就在中间被截断——宿主拿到坏 JSON，表现是"这个钩子没反应"，**而且没有任何报错**。
 *
 * 真实踩到：注入文本涨了约 1.5KB 时自检当场红了两条，
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

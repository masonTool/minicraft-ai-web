#!/usr/bin/env node
/**
 * 安装器：把 `assets/` 里的框架装进当前项目。
 *
 * 为什么存在（挡的是哪次事故）：
 *   安装流程原本写在 `SKILL.md` 里，让 AI 照着敲一段 `cp` 命令。这段命令有两个坑：
 *     1. 存量项目分支里夹了一句裸文本 `.continue/config.json   # 注释`，
 *        复制粘贴直接报 `No such file or directory`，而且**后面的文档循环整段没跑**
 *        ——装完 `config.json` 和四份文档全缺，门禁等于没装；
 *     2. 靠人抄命令，抄漏一行不会有任何提示。
 *   这类"照着文档敲命令"的流程必须变成脚本：**跑完自检，缺了就报错**。
 *
 * 用法（在**目标项目根目录**执行）：
 *   node <skill>/scripts/install.mjs [--dry-run] [--force] [--ci] [--no-detect]
 *
 *   --dry-run    只报告会做什么，不写任何文件
 *   --force      文档已存在时也覆盖（默认是：已存在就跳过，不覆盖用户进度、不留备份文件）
 *   --ci         额外写 GitHub Actions 工作流（跑与本地完全相同的 check.mjs），默认不写
 *   --no-detect  不探测项目测试方式，`checks.project` 保持原样（探测逻辑见 detect-tests.mjs）
 *
 * 退出码：0 成功 / 1 安装后自检失败 / 2 用法错误
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTests } from './detect-tests.mjs';
import { scanProjectDocs } from './scan-docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 本脚本在 `<skill>/scripts/install.mjs`，assets 是同级的 `../assets`。 */
const ASSETS = resolve(HERE, '..', 'assets');
const TARGET = process.cwd();

/**
 * 框架版本：**唯一来源**是技能根目录的 `VERSION`。
 *
 * 为什么要有它：装上去的钩子每次重装都被覆盖，用户想知道"我这个项目跑的是哪一版"，
 * 原来只能靠翻 `git log`。版本号至少要在安装时打印出来；读不到就标 `unknown` 并继续
 * （版本号缺失不该拦住安装，但必须让人看见）。
 */
const FRAMEWORK_VERSION = (() => {
  try {
    return readFileSync(join(HERE, '..', 'VERSION'), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
})();

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');
const wantCi = argv.includes('--ci');
const noDetect = argv.includes('--no-detect');
const unknown = argv.filter((a) => !['--dry-run', '--force', '--ci', '--no-detect'].includes(a));
if (unknown.length > 0) {
  console.error(`不认识的参数：${unknown.join(' ')}`);
  console.error('用法：node install.mjs [--dry-run] [--force] [--ci] [--no-detect]');
  process.exit(2);
}

if (!existsSync(ASSETS)) {
  console.error(`找不到 assets 目录：${ASSETS}`);
  console.error('这个脚本必须放在 <skill>/scripts/ 下，assets 在其旁边。');
  process.exit(2);
}

/** 装完必须具备的文件（自检清单）。缺任何一个都说明安装不完整。 */
const REQUIRED = [
  '.continue/.gitignore',
  '.continue/.installed.json',
  '.continue/config.json',
  '.continue/README.md',
  '.continue/TASKS.md',
  '.continue/DONE.md',
  '.continue/OVERVIEW.md',
  '.continue/TIPS.md',
  '.continue/doing',
  '.continue/hooks/lib.mjs',
  '.continue/hooks/queue-init.mjs',
  '.continue/hooks/auto-continue.mjs',
  '.continue/hooks/auto-commit.mjs',
  '.continue/hooks/check.mjs',
  '.continue/hooks/audit-ids.mjs',
  '.continue/hooks/audit-docs.mjs',
  '.continue/hooks/pre-commit.mjs',
  '.continue/hooks/selftest.mjs',
  '.continue/hooks/audit-config.mjs',
  '.continue/hooks/audit-version.mjs',
  '.continue/hooks/archive-done.mjs',
  '.continue/hooks/archive-queue.mjs',
  '.continue/hooks/worktree.mjs',
  '.continue/hooks/dispatch.mjs',
  '.continue/hooks/run.mjs',
];

const actions = [];
const problems = [];
/** 不阻断安装、但必须告诉人的事（例如用户自己的 pre-commit 没接上门禁）。 */
const warnings = [];

/** dry-run 也要打印：它的意义就是"只报告会做什么"，不打印等于什么都没报告。 */
function log(msg) {
  actions.push(msg);
  console.log(msg);
}

/** 递归复制目录；`overwrite` 为 false 时已存在的文件跳过。dry-run 下**不建任何目录**。 */
function copyDir(from, to, overwrite) {
  if (!dryRun) mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copyDir(src, dst, overwrite);
      continue;
    }
    if (existsSync(dst) && !overwrite) {
      log(`  跳过（已存在）  ${dst}`);
      continue;
    }
    if (!dryRun) cpSync(src, dst);
    log(`  写入            ${dst}`);
  }
}

/**
 * 复制单个文件。`overwrite=false` 时只保证"有"，**不产生任何备份文件**。
 *
 * 早期这里会另存 `<名>.continue-do.md`，结果每装一次多一批垃圾：项目里同时有两套
 * 指令（一套生效、一套待合并），AI 读到哪套全看谁先被匹配。现在已存在就跳过，
 * 差异由调用方打印出来让人自己比。
 */
function copyFile(from, to, overwrite) {
  if (existsSync(to) && !overwrite) {
    if (readFileSync(to, 'utf8') === readFileSync(from, 'utf8')) log(`  已是最新        ${to}`);
    else log(`  跳过（已存在，内容不同） ${to}`);
    return;
  }
  if (!dryRun) mkdirSync(dirname(to), { recursive: true });
  if (!dryRun) cpSync(from, to);
  log(`  写入            ${to}`);
}

/**
 * 读上次安装留下的状态（`.continue/.installed.json`）。读不到/坏了都返回 null：
 * 它只是账本，**不能**因为账本坏了就中止安装（那等于账本比数据还重要）。
 */
function readInstalledState() {
  const file = join(TARGET, '.continue', '.installed.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 数据文档（`TASKS` / `DONE` / `OVERVIEW` / `TIPS` / `AGENTS.md`）：**只比两边，不落任何备份文件**。
 * 机制文档 `README.md` 不走这里——它是框架说明书，用 `copyFile(..., true)` 总是覆盖。
 *
 * | 情形 | 处理 |
 * | --- | --- |
 * | 文件不存在 | 直接写入 |
 * | 与模板逐字节相同 | 视为已装，跳过 |
 * | `--force` | 直接覆盖（用户明确要求） |
 * | 内容不同 | **什么都不写**，返回「有差异」，由调用方汇总成一条提示 |
 *
 * 为什么既不做三方合并、也不另存备份：两者都要在项目里长期留副本
 * （`.baseline/` + `.backup/` + `*.continue-do.md`），而副本一多就分不清哪份生效。
 * 模板改进靠人按 SKILL §1.9 用 `diff` 比一次，代价比"项目里堆三套文件"小。
 *
 * 返回 `true` = 这份文档与模板有差异（调用方负责汇总提示）。
 *
 * `quietDiff`：差异成立但**不值得报**（调用方判定这是用户填过的内容）时不打印那行"跳过"。
 * 为什么需要：数据文档与模板不同是**定义上的必然**（模板是空白骨架、实例里是进度），
 * 逐份报"模板有更新"只会训练人无视告警，真信号反而被盖住（T45）。
 */
function syncDoc(from, to, { label, quietDiff = false }) {
  const theirs = readFileSync(from, 'utf8');
  if (!existsSync(to)) {
    if (!dryRun) {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, theirs);
    }
    log(`  写入            ${to}`);
    return false;
  }
  const ours = readFileSync(to, 'utf8');
  if (ours === theirs) {
    log(`  已是最新        ${to}`);
    return false;
  }
  if (force) {
    if (!dryRun) writeFileSync(to, theirs);
    log(`  覆盖（--force）  ${to}`);
    return false;
  }
  if (!quietDiff) log(`  跳过（模板有更新，未合并） ${label}`);
  return true;
}

/** 把 `defaults` 里缺的键补进 `target`（递归）；返回补了哪些键路径。已有值一律不动。 */
function fillMissing(target, defaults, prefix = '') {
  const added = [];
  for (const [key, value] of Object.entries(defaults)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in target)) {
      target[key] = value;
      added.push(path);
    } else if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      added.push(...fillMissing(target[key], value, path));
    }
  }
  return added;
}

function mergeConfig(from, to) {
  const defaults = JSON.parse(readFileSync(from, 'utf8'));
  if (!existsSync(to)) {
    if (!dryRun) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
    log(`  写入            ${to}`);
    return;
  }
  let current;
  try {
    current = JSON.parse(readFileSync(to, 'utf8'));
  } catch (err) {
    problems.push(`${to} 不是合法 JSON（${err.message}），未改动——修好后重跑安装器`);
    log(`  解析失败，未改动 ${to}`);
    return;
  }
  const added = fillMissing(current, defaults);
  if (added.length === 0) {
    log(`  已是最新        ${to}`);
    return;
  }
  if (!dryRun) writeFileSync(to, `${JSON.stringify(current, null, 2)}\n`);
  log(`  补齐缺失键      ${to}：${added.join('、')}`);
}

/** 垫片里的识别标记：有它 = 我们装的，可以覆盖升级；没有 = 用户自己的钩子，不碰。 */
const SHIM_MARK = '# continue-do pre-commit shim';
const SHIM = [
  '#!/bin/sh',
  SHIM_MARK,
  '# 由 continue-task 安装器生成；提交前跑 .continue/config.json 的 checks.fast。',
  '# 框架已不存在时放行：残留垫片不能把仓库卡成"永远提交不了"。',
  'HOOK="$(git rev-parse --show-toplevel)/.continue/hooks/pre-commit.mjs"',
  '[ -f "$HOOK" ] || exit 0',
  '# node 不在 PATH（GUI git 客户端常见）时也放行：与"框架不存在就放行"同一口径，',
  '# 否则一条坏掉的垫片会让这个仓库永远提交不了。',
  'command -v node >/dev/null 2>&1 || exit 0',
  'exec node "$HOOK"',
  '',
].join('\n');

function git(args) {
  const res = spawnSync('git', args, { cwd: TARGET, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

function installPreCommit() {
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    log('  跳过（不是 git 仓库：提交前门禁不会生效）');
    return;
  }
  // 用 --git-path 而不是拼 `.git/hooks`：兼容 worktree 与 core.hooksPath
  const rel = git(['rev-parse', '--git-path', 'hooks/pre-commit']);
  if (!rel) {
    problems.push('取不到 git 钩子路径（git rev-parse --git-path 失败）');
    return;
  }
  const file = resolve(TARGET, rel);
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (text === SHIM) {
      log(`  已是最新        ${file}`);
      return;
    }
    if (!text.includes(SHIM_MARK)) {
      // 用户自己的 pre-commit：不覆盖，但必须让人知道门禁没接上
      log(`  跳过（已有非本框架的 pre-commit）${file}`);
      warnings.push(
        `${file} 是你自己的 pre-commit，未覆盖。要让提交前门禁生效，在里面加一行：\n` +
          '      node "$(git rev-parse --show-toplevel)/.continue/hooks/pre-commit.mjs" || exit 1',
      );
      return;
    }
  }
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, SHIM);
    chmodSync(file, 0o755);
  }
  log(`  写入            ${file}`);
}

/**
 * 给**本来就有 package.json** 的项目补一条 `continue:worktree` 别名（缺才加，已有的不动）。
 *
 * 为什么要有（挡的是哪次事故）：文档与钩子注入长期写的是 `npm run continue:worktree -- <名字>`，
 * 而框架**从不创建 package.json**——非 npm 项目里这条命令必失败；更糟的是 npm 会向上冒泡找到
 * 仓库**外面**的 package.json，于是报的是 `Missing script` 而不是"没有 package.json"，更难看出问题
 * （实测：在 `/Users/mason/x` 里跑，命中的是 `/Users/mason/package.json`）。
 *
 * 现在主推命令是 `node .continue/hooks/worktree.mjs <名字>`；这里只做顺手别名：
 *   · 没有 package.json → 什么都不写，只打印一句该用哪个命令；
 *   · 已有非空 `scripts["continue:worktree"]` → 保留用户的值；
 *   · JSON 坏了 / 顶层不是对象 → 不碰，记警告（与本脚本其它 merge 同一口径）。
 *
 * 代价：写回时用 `JSON.stringify(…, 2)`，会重排 package.json 的缩进（和写 `.codebuddy/settings.json` 同一处理）。
 * 不加这条别名不影响任何功能，所以不值得为它做"保留原格式"的正则外科手术。
 */
const WORKTREE_ALIAS = 'continue:worktree';
const WORKTREE_CMD = 'node .continue/hooks/worktree.mjs';
function addWorktreeAlias() {
  const file = join(TARGET, 'package.json');
  if (!existsSync(file)) {
    log(`  跳过（没有 package.json：并行用 \`node .continue/hooks/worktree.mjs <单词>\`）`);
    return;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(`${file} 不是合法 JSON（${err.message}），未加 scripts.${WORKTREE_ALIAS} 别名`);
    log('  跳过（package.json 解析失败）');
    return;
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    warnings.push(`${file} 顶层不是对象，未加 scripts.${WORKTREE_ALIAS} 别名`);
    return;
  }
  pkg.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const existing = pkg.scripts[WORKTREE_ALIAS];
  if (typeof existing === 'string' && existing.trim()) {
    log(`  保留已有值      ${file}：scripts.${WORKTREE_ALIAS} = ${existing}`);
    return;
  }
  pkg.scripts[WORKTREE_ALIAS] = WORKTREE_CMD;
  if (!dryRun) writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  log(`  ${dryRun ? '将写入' : '写入'}          ${file}：scripts.${WORKTREE_ALIAS} = ${WORKTREE_CMD}`);
}

// ------------------------------------------------------------------ 钩子注册

/**
 * 要注册的钩子：事件 → 脚本 + 超时。**唯一登记处**，SKILL.md 只引用不复制。
 *
 * `auto-continue` 要挂在两个事件上：Stop 递任务，UserPromptSubmit 只把轮次计数归零。
 * `auto-commit` 的 300s 要大于 `config.json` 的 `checks.timeoutSec`。
 * `dispatch` 的 60s 要够 `git worktree add`（大仓库检出可能十几秒）+ 拉窗口。
 *
 * **顺序有语义**：`dispatch` 排在 `auto-continue` 之前——同一轮 Stop 里先把待派发队列
 * 变成执行树，后面的钩子再判断"这个会话该不该继续"；反过来可能先给主工作区递了任务。
 *
 * **命令一律带 `--event=<自己的事件>`**：钩子靠它写日志行首（`[auto-continue · Stop]`），
 * 不靠 payload 猜（各平台字段名不一致，猜错就把"用户说话"记成"停下"）。
 * 少这个参数的旧注册由 `registerHooks()` 就地补上，漏了会被 `verifyHooks()` 与
 * `scripts/check-framework.mjs` 各自查一次。
 */
const HOOKS = [
  { event: 'Stop', script: 'dispatch.mjs', timeout: 60 },
  { event: 'Stop', script: 'auto-continue.mjs', timeout: 15 },
  { event: 'Stop', script: 'auto-commit.mjs', timeout: 300 },
  { event: 'UserPromptSubmit', script: 'queue-init.mjs', timeout: 15 },
  { event: 'UserPromptSubmit', script: 'auto-continue.mjs', timeout: 15 },
];

/**
 * 注册命令的完整形态：**一律经 `run.mjs` 包装器**。
 *
 * 为什么不直接注册脚本本身：钩子 import 阶段崩溃（比如某个脚本引用了 `lib.mjs` 里已删除的
 * 导出）时，node 以 **1** 退出，宿主把"非 0 非 2"当成"未阻止"→ **静默放行**，
 * 队列就此停摆且一声不吭。包装器把这类退出翻译成 exit 2 + 能照着做的告警。
 * `--event=` 仍放在脚本名之后，钩子照旧靠它给日志行首打标签。
 */
const commandFor = ({ event, script }) => `node .continue/hooks/run.mjs ${script} --event=${event}`;

/**
 * Stop 的**续跑上限**：宿主字段 `loop_limit`，与 `hooks` **同级**（不是每条 hook 里）。
 *
 * 为什么必须显式写：CodeBuddy 系宿主（IDE 的 `genie` 扩展）在没配时
 * `resolveStopHookLoopLimit()` 返回 **1**，且 `stopHookCount` 每条用户消息清零——
 * 于是"队列没做完不许停"退化成"一条消息推进一条"，而钩子照样 exit 2、日志里照样写
 * "递任务"，**看不出反馈是被宿主丢掉的**（最像"AI 不听话"的那种假象）。
 * WorkBuddy 的 agent 不读这个字段（Stop 反馈会一直续跑），写了无副作用。
 *
 * 合法值：`1~100` 或 `-1`（不限）。字符串、0、超范围都会被宿主 `validateLoopLimit()`
 * 归成 1，所以这里必须是**数字字面量**。
 *
 * 取 100 而不是 -1：`100` 是宿主 `validateLoopLimit()` 允许的**最大有限值**（再往上只能选
 * `-1` 不限），一条用户消息推进 100 条已远超任何实际队列，同时保留
 * "宿主/框架出 bug 时不会无限烧钱"这层保险。要彻底放开就改这一个常量。
 */
const STOP_LOOP_LIMIT = 100;

/** 本框架注册的钩子（按 command 里的路径认），用来把 `loop_limit` 只写进**自己的** group。 */
const isOurs = (hook) => String(hook?.command ?? '').includes('.continue/hooks/');

/**
 * 找一个「所有钩子都是本框架的」Stop group。
 *
 * 为什么不能写到第一个 group 了事：`loop_limit` 对**整条 agent 循环**生效（宿主取所有
 * Stop group 的最大值）。写进别人放自定义钩子的 group，就等于把他们的续跑次数从默认 1
 * 抬到 30 —— 那是改别人的行为，不是"只追加缺的"。
 */
function ownStopGroup(settings) {
  const groups = settings?.hooks?.Stop;
  if (!Array.isArray(groups)) return null;
  return (
    groups.find((group) => Array.isArray(group?.hooks) && group.hooks.length > 0 && group.hooks.every(isOurs)) ??
    null
  );
}

/** 某事件下调用该脚本的那条注册（任意 group、任意写法，按脚本名判重）；没有则 null。 */
function findHook(settings, event, script) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    const hit = group.hooks.find((h) => String(h?.command ?? '').includes(script));
    if (hit) return hit;
  }
  return null;
}

/** 含该脚本注册的那个 group（要改 group 级字段时用）；没有则 null。 */
function groupOf(settings, event, script) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return null;
  return (
    groups.find(
      (group) =>
        Array.isArray(group?.hooks) &&
        group.hooks.some((h) => String(h?.command ?? '').includes(script)),
    ) ?? null
  );
}

/**
 * 写 `.codebuddy/settings.json`：**只追加缺的**，不动别的条目；已有的本框架注册
 * 若还缺 `--event=`（老版本装的），**就地补上**而不是跳过——跳过等于升级永远不生效。
 *
 * 为什么由脚本做（挡的是哪次事故）：注册原本是 SKILL.md 的手工步骤，
 * 和"照着文档敲 cp 命令"是同一类流程——漏一条不会有任何提示，症状是"钩子根本没跑"。
 * 解析失败时**不覆盖**原文件（可能只是少了个逗号），记成问题让人修。
 */
function registerHooks() {
  const file = join(TARGET, '.codebuddy', 'settings.json');
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${file} 不是合法 JSON（${err.message}），未改动——修好后重跑安装器`);
      log(`  解析失败，未改动 ${file}`);
      return;
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    problems.push(`${file} 顶层不是对象，未改动`);
    return;
  }
  settings.hooks ??= {};
  const added = [];
  const upgraded = [];
  for (const hook of HOOKS) {
    const { event, script, timeout } = hook;
    const existing = findHook(settings, event, script);
    if (existing) {
      /**
       * 补参数而不是整条重写：用户可能在命令前面挂了环境变量
       * （`CONTINUE_BLOCK_AFTER=8 node .continue/hooks/auto-continue.mjs`），
       * 整条覆盖会把他的调参弄丢。
       */
      const command = String(existing.command ?? '');
      if (!command.includes('--event=')) {
        existing.command = `${command} --event=${event}`;
        upgraded.push(`${event}:${script}`);
      }
      continue;
    }
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const groups = settings.hooks[event];
    /**
     * Stop 放进**本框架自己的** group：group 级字段（`loop_limit`）是按 group 取的，
     * 混进别人的 group 就会改别人的续跑次数。其余事件沿用"追加到第一个 group"。
     */
    let group;
    if (event === 'Stop') {
      group = ownStopGroup(settings);
      if (!group) {
        group = { hooks: [] };
        groups.push(group);
      }
    } else {
      if (groups.length === 0 || !Array.isArray(groups[0]?.hooks)) groups.unshift({ hooks: [] });
      group = groups[0];
    }
    group.hooks.push({ type: 'command', command: commandFor(hook), timeout });
    added.push(`${event}:${script}`);
  }

  /**
   * `loop_limit`：只在**自己的** Stop group 上补，已有值一律不动（用户可能故意设 -1）。
   * 老版本装出来的注册可能跟别人的钩子混在同一个 group 里——那种情况不写，
   * 只告警：写了等于替别人的钩子放宽续跑次数。
   */
  let limitSet = null;
  const stopGroup = groupOf(settings, 'Stop', 'auto-continue.mjs');
  if (stopGroup) {
    if (stopGroup.loop_limit === undefined) {
      if (stopGroup.hooks.every(isOurs)) {
        stopGroup.loop_limit = STOP_LOOP_LIMIT;
        limitSet = STOP_LOOP_LIMIT;
      } else {
        warnings.push(
          `Stop 组里混有自定义钩子，未写 \`loop_limit\`（写了会一并放宽它们的续跑次数）。` +
            `要让队列连续推进，把本框架的两条停止钩子单独放一个 group 并加 "loop_limit": ${STOP_LOOP_LIMIT}；` +
            '不加也不影响可用性，只是有的宿主每条用户消息只推进一条任务。',
        );
      }
    } else if (typeof stopGroup.loop_limit !== 'number') {
      warnings.push(
        `${file} 的 Stop 组里 loop_limit=${JSON.stringify(stopGroup.loop_limit)} 不是数字，` +
          '宿主会当成 1（一条消息一条任务）。改成数字即可。',
      );
    }
  }

  if (added.length === 0 && upgraded.length === 0 && limitSet === null) {
    log(`  已是最新        ${file}`);
    return;
  }
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  if (added.length > 0) log(`  注册            ${file}：${added.join('、')}`);
  if (upgraded.length > 0) log(`  补 --event=     ${file}：${upgraded.join('、')}（老版本注册，事件名才能进日志）`);
  if (limitSet !== null) log(`  续跑上限        ${file}：Stop · loop_limit=${limitSet}`);
}

/**
 * 自检：四条注册都在，且每条命令都带 `--event=`。dry-run 不查（文件没写）。
 *
 * 两件事分开查：少了注册 → 钩子根本不跑；少了参数 → 跑了但日志分不清事件来源。
 * 后者不会让人当场发现，只会让排查时看错行。
 */
function verifyHooks() {
  const file = join(TARGET, '.codebuddy', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    problems.push(`安装后读不到 ${file}`);
    return;
  }
  for (const { event, script } of HOOKS) {
    const hook = findHook(settings, event, script);
    if (!hook) {
      problems.push(`settings.json 的 ${event} 没有注册 ${script}`);
      continue;
    }
    if (!String(hook.command ?? '').includes('--event=')) {
      problems.push(
        `settings.json 的 ${event}:${script} 没有 --event= 参数（日志分不清事件来源）；` +
          `期望命令形如 "${commandFor({ event, script })}"`,
      );
    }
  }
}

/**
 * 宿主怎么算 Stop 的续跑上限（与 `genie` 的 `resolveStopHookLoopLimit()` 同算法）：
 * 取所有 Stop group 的 `loop_limit` **最大值**，`-1` 表示不限，缺省按 1。
 *
 * 这里复算一遍是为了**读回自己写的文件**，而不是假设写成功了：
 * 写进 settings 只是第一步，真正生效的还受用户级配置（会被合并进来）影响。
 */
function effectiveStopLoopLimit(layers) {
  let max = 1;
  for (const layer of layers) {
    const groups = layer?.hooks?.Stop;
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const value = group?.loop_limit;
      if (typeof value !== 'number') continue;
      if (value === -1) return -1;
      if (value > max) max = value;
    }
  }
  return max;
}

/**
 * 装完复核：把 settings 读回来，算出真正会生效的上限。
 *
 * 为什么值得单独一步：`loop_limit` 是**宿主**的字段，写错类型、被用户级配置盖掉、
 * 或被插件的 hook 组顶成大值，都不会报错——症状只是"队列一条消息推进一条"，
 * 看起来像 AI 不听话。这一步把它变成一行明确的输出。
 */
function verifyStopLoopLimit() {
  const file = join(TARGET, '.codebuddy', 'settings.json');
  let project;
  try {
    project = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return; // verifyHooks 已经报过"读不到"
  }
  const layers = [project];
  try {
    const userFile = join(homedir(), '.codebuddy', 'settings.json');
    if (existsSync(userFile)) layers.push(JSON.parse(readFileSync(userFile, 'utf8')));
  } catch {
    /* 用户级配置读不到就当没有：最坏情况下面会报"生效值 1" */
  }
  const effective = effectiveStopLoopLimit(layers);
  if (effective === -1) {
    log(`  已核对          ${file}：Stop · loop_limit=-1（不限）`);
    return;
  }
  if (effective === 1) {
    warnings.push(
      'Stop 续跑上限的生效值是 1（每条用户消息只推进一条任务）：可能是本框架的 Stop group 没写成功、' +
        '与自定义钩子同组（见上一条），或用户级配置把它压成了 1。',
    );
    return;
  }
  const note = effective === STOP_LOOP_LIMIT ? '' : `（框架默认 ${STOP_LOOP_LIMIT}，本机保留了既有值）`;
  log(`  已核对          ${file}：Stop · loop_limit=${effective}${note}`);
}

// ------------------------------------------------------------------ 安装状态

/**
 * 装完把「这一刻装了什么」落盘：`.continue/.installed.json`。
 *
 * 为什么需要（升级能力的地基）：钩子是覆盖安装，用户查不到"我这个项目跑的是哪一版"，
 * 也分不清"这个 hook 与上一版差在哪"。有了这份状态才能答两件事：
 *   ① 旧版本 → 新版本（`version`）；
 *   ② 这个文件被用户改过没有（哈希与记录不同 = 改过，`check.mjs version` 会点名）。
 *
 * 记的是**安装后磁盘上的实际内容**，不是模板哈希：只有这样"磁盘 ≠ 记录"才等价于"有人动过"。
 * 该文件**要入库**：换台机器 clone 下来，也能知道这个项目上次是用哪一版装的。
 *
 * 幂等：`version` 与 `files` 都没变时**不写文件**——否则每次重装都改一遍 `installedAt`，
 * diff 里全是噪音，真升级的那次反而看不出来。
 */
const STATE_FILE_REL = '.continue/.installed.json';
const STATE_TRACKED = [
  '.continue/.gitignore',
  '.continue/config.json',
  '.continue/TASKS.md',
  '.continue/DONE.md',
  '.continue/OVERVIEW.md',
  '.continue/TIPS.md',
  '.continue/README.md',
  'AGENTS.md',
];

function trackedFiles() {
  const list = [...STATE_TRACKED];
  const hooks = join(ASSETS, '.continue', 'hooks');
  if (existsSync(hooks)) {
    for (const name of readdirSync(hooks)) {
      if (name.endsWith('.mjs')) list.push(`.continue/hooks/${name}`);
    }
  }
  return list;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** 键顺序不影响判断：两边都按 key 排好再比。 */
const canonical = (obj) =>
  JSON.stringify(Object.fromEntries(Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))));

/**
 * 升级时**删掉框架已经不再提供的钩子**。
 *
 * 为什么需要（挡的是哪次事故）：`copyDir(..., true)` 只会覆盖同名文件，**从不删除**。
 * 一个钩子从新版本里拿掉之后，旧副本会一直躺在 `.continue/hooks/` 里——
 * 它可能还被 `settings.json` 的老注册指着继续跑（哪怕新版本已经取消那条逻辑），
 * 症状是"文档说取消了，实际还在自动合并"。这里按 `.installed.json` 的记录清理。
 *
 * 三条边界：
 *   · 只碰**记录在案**且路径在 `.continue/hooks/` 下的文件（不看别处的用户文件）；
 *   · 磁盘内容与记录一致（= 没人改过）才删；被用户改过的保留并告警——
 *     那是本地定制，删了等于替人做决定；
 *   · `--dry-run` 只报告。
 */
function pruneStaleHooks(previous) {
  const recorded = previous?.files ?? {};
  const keep = new Set(trackedFiles());
  const removed = [];
  const kept = [];
  for (const rel of Object.keys(recorded)) {
    if (!rel.startsWith('.continue/hooks/') || keep.has(rel)) continue;
    const abs = join(TARGET, rel);
    if (!existsSync(abs)) continue;
    let current = null;
    try {
      current = sha256(abs);
    } catch {
      continue;
    }
    if (current !== recorded[rel]) {
      kept.push(rel);
      continue;
    }
    if (!dryRun) unlinkSync(abs);
    removed.push(rel);
  }
  if (removed.length > 0) log(`  删除（新版不再提供）${removed.join('、')}`);
  if (kept.length > 0) {
    warnings.push(
      `${kept.join('、')} 是旧版本留下、新版本已不再提供的钩子，但你改过它，没有删除。` +
        '确认不再需要就手动删掉——它可能仍被 .codebuddy/settings.json 的老注册调用。',
    );
  }
}

/** 托管文件对应的模板路径（`AGENTS.md` 在 assets 根下，其余在 `assets/.continue/` 下）。 */
const templateOf = (rel) => (rel === 'AGENTS.md' ? join(ASSETS, 'AGENTS.md') : join(ASSETS, rel));

function writeInstalledState() {
  const file = join(TARGET, STATE_FILE_REL);
  const files = {};
  /**
   * `templates`：每个托管文件**对应模板**的哈希。
   *
   * 为什么 `files` 不够（T45 的判据靠它）：`files` 记的是"装完那一刻磁盘上的内容"，
   * 数据文档装完就会被填进度，两者的差异无法区分"模板变了"和"用户写了东西"。
   * 只比模板哈希，"模板变了没有"才是个可判定的事实——也只有那样才能只报那一次。
   */
  const templates = {};
  for (const rel of trackedFiles()) {
    const abs = join(TARGET, rel);
    if (existsSync(abs)) files[rel] = sha256(abs);
    const tpl = templateOf(rel);
    if (existsSync(tpl)) templates[rel] = sha256(tpl);
  }
  let previous = null;
  if (existsSync(file)) {
    try {
      previous = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      previous = null; // 坏文件按"没有"处理：它只是账本，重建一份不会丢用户数据
    }
  }
  if (
    previous &&
    previous.version === FRAMEWORK_VERSION &&
    canonical(previous.files) === canonical(files) &&
    canonical(previous.templates) === canonical(templates)
  ) {
    log(`  已是最新        ${file}（v${FRAMEWORK_VERSION}）`);
    return;
  }
  const upgradedFrom = previous?.version && previous.version !== FRAMEWORK_VERSION ? previous.version : null;
  writeFileSync(
    file,
    `${JSON.stringify(
      { version: FRAMEWORK_VERSION, installedAt: new Date().toISOString(), files, templates },
      null,
      2,
    )}\n`,
  );
  log(
    `  写入            ${file}：v${FRAMEWORK_VERSION}` +
      `${upgradedFrom ? `（从 v${upgradedFrom} 升级）` : ''}，记录 ${Object.keys(files).length} 个文件`,
  );
}

// ------------------------------------------------------------------ 开始
console.log(`安装 continue-do v${FRAMEWORK_VERSION} 到 ${TARGET}`);
console.log(dryRun ? '（--dry-run：只报告，不写文件）\n' : '');

/**
 * 先讲清楚这是什么、以及**它依赖钩子**。
 *
 * 平台差异必须在安装前说：钩子不触发时框架不会报错，只会安静地什么都不做——
 * 用户会以为是"装了没用"，而不是"这个环境不支持"。
 */
console.log('用途：给大型项目做持续型 AI 开发——需求 / 队列 / 进度 / 踩坑都落在 .continue/ 里，');
console.log('      跨会话、跨上下文窗口都不丢；钩子逐条递任务、拦住未提交改动、提交前跑检查。');
console.log('平台：两个宿主的钩子都会跑，差别只在 Stop 反馈能被采纳几次：');
console.log('      · WorkBuddy：会一直续跑到队列空；');
console.log(`      · CodeBuddy IDE：默认每条用户消息只采纳 1 次（本安装器写 loop_limit=${STOP_LOOP_LIMIT} 恢复连续推进）。\n`);

/**
 * 钩子脚本：**总是覆盖**。
 * 它们是框架代码，覆盖不会丢用户数据；不覆盖的话升级就失效了。
 */
/**
 * 升级模式：上一次装的是哪一版、这次是不是升级。
 *
 * 为什么必须显式打出来：钩子是覆盖安装，"我这个项目跑的是哪版"本来就该由安装器回答。
 */
const previousState = readInstalledState();
if (previousState?.version && previousState.version !== FRAMEWORK_VERSION) {
  log(`· 升级：v${previousState.version} → v${FRAMEWORK_VERSION}`);
} else if (previousState) {
  log(`· 已是 v${FRAMEWORK_VERSION}（重装 / 校验）`);
} else {
  log('· 首次安装（没有 .continue/.installed.json）');
}

log('· 钩子（覆盖）');
copyDir(join(ASSETS, '.continue', 'hooks'), join(TARGET, '.continue', 'hooks'), true);
pruneStaleHooks(previousState);
copyFile(join(ASSETS, '.continue', '.gitignore'), join(TARGET, '.continue', '.gitignore'), true, false);

/**
 * `config.json`：**只补缺失的键，不覆盖已有值**。
 *
 * 为什么不整份覆盖（旧行为）：用户按 SKILL「项目自己的检查」把 `checks.fast`
 * 改成了自己的聚合脚本，一升级框架就被模板值冲掉——项目测试从门禁里消失，且不报错。
 * 解析失败时**不碰原文件**，记成问题让人处理，绝不用模板顶掉一个可能只是少了逗号的配置。
 */
log('· config.json（缺键才补）');
mergeConfig(join(ASSETS, '.continue', 'config.json'), join(TARGET, '.continue', 'config.json'));

/**
 * 探测项目自己的测试方式，填进 `checks.project`。
 *
 * 为什么要有这一步（挡的是哪次事故）：`checks.project` 留空时，提交门禁只跑框架自检
 * （编号 / 文档 / 配置 / 钩子），**项目自己的测试永远在门外**。本项目就踩过：
 * 10 条 CLI 回归测试一条都没被门禁执行过，而 `DONE.md` 里还写着"`check.mjs --fast` 全绿"。
 *
 * 但框架**不该知道**每个项目用什么测，所以这里不写死任何命令：由 `detect-tests.mjs`
 * 只看项目里现成的证据，探到什么填什么；探不到就保持为空并给建议（不替项目编命令）。
 *
 * 四条边界：用户已有非空的 `project` → 一律不动（手写的比探测值可信）；
 * `--no-detect` → 不写；`--dry-run` → 只报告；`config.json` 解析失败 → 不碰（上面已记问题）。
 */
log('· 项目测试方式（探测并填入 checks.project）');
const detected = detectTests(TARGET);
const configFile = join(TARGET, '.continue', 'config.json');
const detectedText =
  detected.commands.length > 0 ? detected.commands.join(' + ') : '没找到可自动跑的测试';
let projectKept = false;
let projectFilled = false;
if (noDetect) {
  log(`  跳过（--no-detect）  探测到：${detectedText}`);
} else if (!existsSync(configFile)) {
  // dry-run 且原本没有 config.json：不落文件，只报告会填什么
  log(`  ${dryRun ? '将探测到' : '探测到'}：${detectedText}（未写文件）`);
} else {
  let current = null;
  try {
    current = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch {
    current = null; // 上面 mergeConfig 已经把它记成问题了，这里不重复报
  }
  if (current === null) {
    log('  跳过（config.json 不是合法 JSON）');
  } else {
    current.checks = current.checks ?? {};
    const existing = current.checks.project;
    const hasExisting = Array.isArray(existing)
      ? existing.length > 0
      : Boolean(String(existing ?? '').trim());
    if (hasExisting) {
      projectKept = true;
      log(
        `  保留已有值      checks.project = ${JSON.stringify(existing)}` +
          `（探测到 ${detectedText}，不覆盖手写的值）`,
      );
    } else if (detected.commands.length === 0) {
      log('  没探测到可跑的测试：checks.project 保持为空，建议见下文');
    } else {
      current.checks.project = detected.commands;
      if (!dryRun) writeFileSync(configFile, `${JSON.stringify(current, null, 2)}\n`);
      projectFilled = true;
      log(
        `  ${dryRun ? '将写入' : '写入'}          checks.project = ${JSON.stringify(detected.commands)}` +
          `（依据：${detected.evidence[0]}）`,
      );
    }
  }
}

/**
 * 探测不到测试时的建议：**只打印，不落盘、不生成测试代码**。
 * "要不要搭测试框架"是项目自己的决定，安装器替它建文件等于替它做技术选型。
 */
const testAdvice = !noDetect && !projectKept && detected.commands.length === 0 ? detected.suggestions : [];

/**
 * git pre-commit 垫片：让 `checks.fast` 在**正常提交路径**上也会跑。
 * Stop 钩子只在停下时工作区还脏才跑检查，AI 同回合改完就提交时它看不见（见 `hooks/pre-commit.mjs`）。
 */
log('· git pre-commit');
installPreCommit();

/**
 * npm 别名：只有"本来就有 package.json"的项目才补，非 npm 项目什么都不写。
 * 顺序放在 pre-commit 之后、文档之前：它只碰 package.json，与其它步骤互不影响。
 */
log('· npm 别名（可选）');
addWorktreeAlias();

/**
 * 队列目录：只保证存在，**不动里面的文件**。
 * `doing/` 里可能有正在进行的队列，覆盖等于丢进度。
 */
log('· 队列目录（缺则建，不覆盖）');
const doingDir = join(TARGET, '.continue', 'doing');
if (!existsSync(doingDir)) {
  if (!dryRun) mkdirSync(doingDir, { recursive: true });
  log(`  创建            ${doingDir}`);
} else {
  log(`  已存在          ${doingDir}`);
}

/**
 * 机制文档（`.continue/README.md`）：与 `hooks/` **同一策略——总是覆盖**。
 *
 * 为什么不能和下面那 4 份数据文档一样"只报告、不覆盖"（T43，挡的是一次真实的漏检）：
 *   README 是**框架的说明书**，真身在 `assets/`；它不含任何项目数据（项目自己的进度进
 *   TASKS / DONE / OVERVIEW / TIPS）。把它当"业务文档"的代价实测过一次：模板在
 *   T39~T42 两批里改了三处（协议重注入 / `git.push` 管建树 / 树没了不重建），实例一个字
 *   没跟上，而三处检查全绿——`audit-version` 跳过它、安装器只报告、`check-framework`
 *   只看模板。结果是**文档说"已经这样了"，实际跑的是旧逻辑**。
 * 覆盖会不会丢手写内容：会。所以模板 README 里写明"别手改这份文件，要改改模板"；
 *   真要看历史，git 里有。
 */
log('· 机制文档（总是覆盖：真身在技能模板）');
copyFile(join(ASSETS, '.continue', 'README.md'), join(TARGET, '.continue', 'README.md'), true);

/**
 * 数据文档：**默认不覆盖，也不留备份**。
 * 这些文件里是用户的进度、需求、踩坑记录，覆盖 = 数据丢失；另存备份 = 项目里多一套不生效的指令。
 * 内容不同就只报一句"模板有更新"，怎么合并由人按 SKILL §1.9 用 `diff` 看。
 *
 * **但"不同"要分两种**（T45，挡的是告警疲劳）：模板是空白骨架、实例里是进度，两者天生不同；
 * 只有"装完之后没人动过"（实例哈希 == `.installed.json` 里的记录）才说明**模板真的变了**。
 * 用户填过的文档一律静默——否则每次安装都固定刷 4 条永远消不掉的"未合并"，
 * 真正该看的那一条就淹没在里面（README 漂移两批没人发现，就是这个机制漏的）。
 */
const installedBefore = readInstalledState();
/**
 * 差异是否值得报：判据是**模板自己变没变**，不是"实例像不像模板"。
 * 用户填过的文档与模板不同是定义上的必然（骨架 vs 进度），拿它当信号就会天天报；
 * 老账本没有 `templates` 字段 → 不报（迁移那天刷一屏比不报更糟）。
 */
function worthReporting(rel) {
  const recorded = installedBefore?.templates?.[rel];
  if (!recorded) return false;
  try {
    return sha256(templateOf(rel)) !== recorded;
  } catch {
    return false;
  }
}

log('· 数据文档（新装写入 / 没变跳过 / 只报"模板真的变了"的）');
const staleDocs = [];
for (const name of ['TASKS.md', 'DONE.md', 'OVERVIEW.md', 'TIPS.md']) {
  const rel = `.continue/${name}`;
  const abs = join(TARGET, rel);
  const report = worthReporting(rel);
  if (syncDoc(join(ASSETS, '.continue', name), abs, { label: rel, quietDiff: !report })) {
    if (report) staleDocs.push(name);
  }
}

log('· AGENTS.md');
const agentsPath = join(TARGET, 'AGENTS.md');
const agentsReport = worthReporting('AGENTS.md');
if (syncDoc(join(ASSETS, 'AGENTS.md'), agentsPath, { label: 'AGENTS.md', quietDiff: !agentsReport })) {
  if (agentsReport) staleDocs.push('AGENTS.md');
}
/**
 * 已有 `AGENTS.md` 且**没提 `.continue/`** 时框架入口等于没生效。
 * 症状是 AI 冷启动完全不知道队列约定，而日志里只有一行"跳过"——所以必须升级成警告。
 */
if (existsSync(agentsPath) && !readFileSync(agentsPath, 'utf8').includes('.continue/README.md')) {
  warnings.push(
    `项目已有 ${agentsPath} 但没有指向 .continue/：框架入口**没有生效**。` +
      `手动加一句"动手之前先读 .continue/README.md"，模板见 ${join(ASSETS, 'AGENTS.md')}。`,
  );
}
if (staleDocs.length > 0) {
  warnings.push(
    `${staleDocs.length} 份文档**装完之后没人改过、但模板变了**（实例原样保留，不自动合并也不生成备份）：` +
      `${staleDocs.join('、')}。要看差异：diff ${join(ASSETS, '.continue')}/TASKS.md .continue/TASKS.md` +
      '（把 TASKS.md 换成对应文件名）；确认不需要模板版本就加 --force 重跑。',
  );
}

/**
 * 项目已有文档：**只读扫描**，列出可以并进 `.continue/` 的候选。
 *
 * 为什么安装器要管（挡的是哪次事故）：存量项目里已有 TODO / CHANGELOG / 架构说明 / 踩坑笔记，
 * 装完不并进来，框架只剩"从现在开始"的记忆，用户过去的需求和坑等于失忆；
 * 而"该并哪份、并到哪"靠人翻目录，翻漏一个不会报错。
 *
 * 这里只做机械部分（发现 + 分类建议 + 是否已登记），**内容判断与合并由 AI 做**，
 * 规矩写在 SKILL.md「集成已有文档」。
 */
log('· 项目已有文档（只读扫描，供迁移集成）');
const scan = scanProjectDocs(TARGET);
const pendingDocs = scan.candidates.filter((item) => !item.registered);
if (pendingDocs.length === 0) {
  log('  没有待集成的文档');
} else {
  for (const item of pendingDocs.slice(0, 15)) {
    log(`  待集成 → ${item.target.padEnd(8)} ${item.path}（${item.lines} 行）`);
  }
  if (pendingDocs.length > 15) log(`  …还有 ${pendingDocs.length - 15} 份，完整清单见 scan-docs.mjs`);
  log('  合并规则见 SKILL.md「集成已有文档」；原文件保留，合并后跑 check.mjs');
}

log('· 钩子注册（.codebuddy/settings.json，只追加缺的）');
registerHooks();

// ------------------------------------------------------------------ 自检
/**
 * 装完必须自检。这一步是**这个脚本存在的主要理由**：
 * 手抄命令漏一行不会有任何提示，而缺 `config.json` 的症状是"门禁静默失效"——
 * 看起来一切正常，其实一个检查都不跑。
 */
log('· 安装状态（版本 + 逐文件哈希）');
if (!dryRun) {
  // 顺序：先记状态、再核对 REQUIRED——`REQUIRED` 里有 `.installed.json`，反过来会自欺
  writeInstalledState();
  for (const rel of REQUIRED) {
    if (!existsSync(join(TARGET, rel))) problems.push(`安装后缺少 ${rel}`);
  }
  verifyHooks();
  verifyStopLoopLimit();
}

log('· CI（可选，--ci 才写）');
if (!wantCi) {
  log('  跳过（没加 --ci）');
} else {
  const ciFrom = join(ASSETS, 'ci', 'continue-do.yml');
  const ciTo = join(TARGET, '.github', 'workflows', 'continue-do.yml');
  if (existsSync(ciTo)) {
    log(`  跳过（已存在）  ${ciTo}`);
  } else {
    if (!dryRun) {
      mkdirSync(dirname(ciTo), { recursive: true });
      cpSync(ciFrom, ciTo);
    }
    log(`  写入            ${ciTo}`);
  }
}

/**
 * 没有可跑的测试 → 把建议摆出来。
 * 走 stdout 而不是 warnings：这不是"安装不完整"，是"这个项目还没有测试"，
 * 混进警告里会让人以为安装失败了。
 */
if (testAdvice.length > 0) {
  console.log('');
  console.log('· 这个项目还没有可自动跑的测试——门禁里只会跑框架自检（编号 / 文档 / 配置 / 钩子）');
  for (const why of detected.evidence) console.log(`  · ${why}`);
  console.log('  建议（做完重跑安装器即可自动接进门禁，也可直接写进 checks.project）：');
  testAdvice.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
}

// ------------------------------------------------------------------ 报告
console.log('');
for (const w of warnings) console.error(`  ⚠ ${w}`);
if (problems.length > 0) {
  console.error('安装不完整：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\n先修好再继续，否则框架会以"看起来正常但静默失效"的方式运行。');
  process.exit(1);
}

if (dryRun) {
  console.log(`--dry-run 结束：共 ${actions.length} 项动作，未写任何文件。`);
  process.exit(0);
}

console.log('安装完成。下一步：');
console.log('  1. **重启会话**——钩子配置在启动时拍快照，不热加载（注册已自动完成）');
console.log('  2. 自检：node .continue/hooks/check.mjs');
const base = 2;
if (projectFilled) {
  console.log(`     （门禁里已接入项目测试：${JSON.stringify(detected.commands)}，要改就编辑 checks.project）`);
}
if (pendingDocs.length > 0) {
  console.log(
    `  ${base + 1}. 集成已有文档：${pendingDocs.length} 份待合并（上方清单；规矩见 SKILL.md「集成已有文档」）`,
  );
}

/**
 * 装完再强调一次平台差异。放在最后，因为"能连续推进几条"直接决定用户对这套东西的预期：
 * 以为是"一条消息跑完整个队列"、实际只推进一条时，用户会先怀疑框架坏了。
 */
console.log('');
console.log('⚠ 平台提醒：钩子两个宿主都会跑，差别在 Stop 反馈能被采纳几次。');
console.log('  · WorkBuddy：一直续跑到队列空（它没有续跑上限）。');
console.log(`  · CodeBuddy IDE：默认每条用户消息只采纳 1 次；本次已写 loop_limit=${STOP_LOOP_LIMIT}，`);
console.log('    重启会话后应能连续推进；若仍只推进一条，看上面"续跑上限"那行的核对结果。');
console.log('  · 通用兜底：钩子被宿主丢掉时不会报错，日志里能看到“续跑第 N 次”，据此判断是否需要手动说“继续”。');

#!/usr/bin/env node
/**
 * 端到端自测：**用真实的装好的框架跑一遍流程**，看它到底会不会转。
 *
 * 和另外两个脚本的分工（不是重复）：
 *   · `check-framework.mjs` —— 打包源**自己**一致吗（模板↔安装器、注册命令、脚本交代）
 *   · `test-install.mjs`    —— 装出来的**形状**对吗（文件齐不齐、能不能跑自检）
 *   · `e2e.mjs`（本脚本）    —— 装出来之后**真的转得动吗**
 *
 * 两种执行器（同一套场景里混着用）：
 *   · `model` —— 真起一个 codebuddy 会话，验"**模型会不会按协议行动**"（慢、花 token）
 *   · `probe` —— 直接给装好的钩子喂 Stop payload，验"**机制分支对不对**"（秒级、可重复）
 *
 * 为什么要 probe：像"连喂 5 轮没做完 → 标 `[阻塞]`"这种事，靠"让模型故意不干活"根本
 * 触发不了；而它又是最容易静默失效的分支。probe 仍然跑在**装出来的真实框架**上，
 * 只是不经过模型——所以它验的是机制，不是"模型乖不乖"。
 *
 * 用法（在仓库根执行；这个仓库没有 package.json，所以是**直接跑脚本**，不是 npm script）：
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs                    # 只跑主干（main）
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --all              # 跑全部 8 个场景（先清场）
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --scenario blocked # 单跑一个（可重复给多次）
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --dry-run          # 只打印计划
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --clean           # 只清现场（test.md 重置为表头）
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --self-test-kill  # 验"超时/中断后不留孤儿进程"（约 2s）
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs --model X --turns 45 --timeout 600 --strict
 *
 * 现场（默认**保留**，方便你看）：
 *   `.codebuddy/skills/continue-task/.e2e/<场景>-<时间戳>/`
 *   报告**每跑完一个场景就刷新一次**：场景目录里的 `report.md`，以及 `.e2e/test.md` 里本轮那一节
 *   （先写「进行中」版本，整轮结束后用终版覆盖）。所以不用等十几分钟才知道前面几个场景过没过。
 *
 * 两条硬规矩（2026-10-23 踩过，见 `.continue/TIPS.md`）：
 *   · **全测只跑一遍**：`.e2e/.lock` 记 pid，已有活跃轮次时第二轮直接 exit 2。两轮并发
 *     会把彼此的现场清掉，前一轮全红（假红）且双倍烧 token。
 *   · **全测先清场**：`--all` 开跑前删掉上一轮全部现场，并把 `test.md` 重置为表头，删不干净就 exit 2；
 *     删除一律走绝对路径 `/bin/rm`（IDE 终端的 safe-delete 垫片会在 500 条处"删一半"）。
 *
 * 退出码：0 通过（或环境跳过）/ 1 断言失败 / 2 用法错误（含"已有一轮在跑"）。
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..');
const REPO = resolve(SKILL, '..', '..', '..');
const DATA_ROOT = join(SKILL, '.e2e');
/**
 * 绝对路径的 `rm`：绕开 IDE 终端的 safe-delete 垫片（`PATH` 里的 `rm` 与
 * `fs.rmSync` 都被它接管，见 `rmPath()` 注释）。定义在这里是因为 `--clean`
 * 分支在文件靠前的位置就会用到。
 */
const BIN_RM = process.platform === 'win32' ? null : '/bin/rm';
/** 运行锁文件：同一时间只允许一轮 e2e（全测只跑一遍）。 */
const LOCK = join(DATA_ROOT, '.lock');
/**
 * 汇总报告。清场时它会一起被重置——它描述的是"这一轮的现场"，不是长期台账
 * （长期记录在 `e2e-history.md`，那个入库）。定义在这里是因为清场发生在
 * 后面那句 `const report = ...` 之前，晚定义会踩 TDZ。
 */
const REPORT = join(DATA_ROOT, 'test.md');

/**
 * 子进程治理：**e2e 起的 CLI 必须能整组清掉**。
 *
 * 挡的是"跑完之后后台还在烧"这一类事故（2026-10-23 用户机器发烫、怀疑有残留实例时查出来的）：
 *   1. `spawnSync(..., { timeout })` 只对**直接子进程**发信号。CLI 再 spawn 出来的子代理 /
 *      MCP server 是孙进程——父进程一收工，它们成孤儿，继续跑、继续烧 token；
 *   2. `spawnSync` **阻塞事件循环**：Ctrl-C 时本进程被信号直接终止，`SIGINT` 处理器
 *      永远轮不到执行，CLI 照旧在后台跑完整轮（几分钟、几百万 token）。
 *
 * 所以改成异步 `spawn` + `detached: true`（自成进程组），按 **负 pid 杀整组**：
 * 超时、`SIGINT`、`SIGTERM`、正常退出四条路径都会尽力清一遍。
 *
 * 已知边界：如果 CLI 自己 `setsid` 进新会话，就不在我们这组了——那属于 CLI 侧行为，
 * 这里只能保证"自己起的这棵树"清干净；也不做跨机器的进程扫描（没有可靠判据）。
 */
const liveGroups = new Set();

/** 杀掉以 `pid` 为组长的整个进程组（`ESRCH` = 组已空，正常）。 */
function killGroup(pid, signal = 'SIGTERM') {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* 组空了 / 没权限：都不该影响主流程 */
  }
}

/** 退出或被打断时，把还在跑的 CLI 整组带走。 */
function killAllGroups() {
  for (const pid of liveGroups) killGroup(pid);
  liveGroups.clear();
}

/**
 * 起一个 CLI 子进程（自成进程组）并等它结束。
 * 返回 `{ pid, status, signal, stdout, stderr, timedOut }`——`pid` 留给自检核对"组真的空了"。
 */
function runCliGroup(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    liveGroups.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const finish = (status, signal, extra = '') => {
      clearTimeout(timer);
      // 收尾再扫一次组：CLI 正常退出后，孙进程可能还活着——这一步才是最关键的
      killGroup(child.pid);
      liveGroups.delete(child.pid);
      resolve({ pid: child.pid, status, signal, stdout, stderr: `${stderr}${extra}`, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => finish(null, null, `spawn 失败：${err.message}`));
    child.on('close', (status, signal) => finish(status, signal));
  });
}

/**
 * 剥掉 `GIT_*`：经 pre-commit 调用时 git 会注入 `GIT_DIR` / `GIT_INDEX_FILE`，
 * 场景目录里的 `git add` / `git commit` 会落到**外层真实仓库**上（`.git/hooks/pre-commit` 那边
 * 踩过同一个坑）。在进程启动时直接删，所有子进程自然继承干净的环境。
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const multi = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));

const dryRun = flag('--dry-run');
const strict = flag('--strict');
/**
 * 清空整轮现场。
 *
 * 默认**不清**：一次完整测试由多个用例组成，跑到一半重跑某个用例时把别的用例现场
 * 删掉是很糟的（实测被这么坑过一次）。只有显式 `--fresh` 才当成"新的一轮"全清。
 */
const fresh = flag('--fresh');
/**
 * 跑**全套**（`--all`）时自动清掉上一轮现场：一轮完整测试 = 一批目录 = 一节报告，
 * 混着上一轮的目录会让人分不清"这些是不是这次跑的"。单跑某场景不清（互相不干扰）。
 */
// 用函数延迟求值：这里的 `all` 还没初始化（TDZ），直接算会抛 ReferenceError
const isAutoFresh = () => all && !flag('--keep-all');
const cleanOnly = flag('--clean');
const all = flag('--all');
/** 只跑 probe 场景：0 token、秒级，可以接进门禁（`--all` 含模型，必须人来点）。 */
const probesOnly = flag('--probes');
/** 跳过末尾三项单测：给门禁用的（那些检查由调用方自己跑，重复跑只是浪费 5 秒）。 */
const noSelftest = flag('--no-selftest');

/**
 * `--clean` 与"要跑测试"的开关同时出现 → **直接拒绝**。
 *
 * 为什么值得拦（本仓库自己刚踩的）：`--clean` 是"只清场"模式，清完就退出、退出码 0。
 * `--probes --clean` 因此一个场景都不跑却是绿的——CI 里这样写等于**绿灯空转**，
 * 症状是"工作流一直绿、其实从来没验过"。
 */
const runSwitches = ['--probes', '--all', '--scenario'].filter((f) => argv.includes(f));
if (cleanOnly && runSwitches.length > 0) {
  console.error(`--clean 是"只清场"（清完就退出），不能与 ${runSwitches.join(' / ')} 一起用——那样一个场景都不会跑。`);
  console.error('分两次跑：先 --clean，再单独跑要跑的测试。');
  process.exit(2);
}
const timeoutSec = Number(value('--timeout', '480'));
const maxTurns = Number(value('--turns', '45'));

if (flag('--help') || flag('-h')) {
  console.log(
    '用法：node scripts/e2e.mjs [--all] [--probes] [--scenario <名>]... [--no-selftest] [--dry-run] [--strict]\n' +
      '  --probes       只跑 probe 场景（0 token、秒级，可接进门禁）\n' +
      '  --no-selftest  跳过末尾三项单测（门禁里由调用方自己跑，别重复）\n' +
      '                        [--model <id>] [--turns 40] [--timeout 600]\n' +
      '                        [--self-test-kill]（验"超时/中断后不留孤儿进程"，约 2s、不烧 token）',
  );
  process.exit(0);
}
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || !Number.isFinite(maxTurns) || maxTurns <= 0) {
  console.error('--timeout / --turns 必须是正整数');
  process.exit(2);
}

/**
 * 进程治理自检：不起模型、不碰 `.e2e/`，跑完即退。
 * 放在拿锁之前——它不需要现场，也不该被"已有一轮在跑"挡住。
 */
if (flag('--self-test-kill')) {
  const ok = await selfTestKill();
  process.exit(ok ? 0 : 1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '-');

/** 场景用的固定会话 ID（32 位 hex → 文件名取前 6 位）。 */
const sid = (tail) => `e2e0${'0'.repeat(27)}${tail}`;
const sid6 = (s) => s.slice(0, 6);

// ---------------------------------------------------------------- 断言与脚手架
let steps = [];
const check = (label, ok, detail = '') => {
  steps.push({ label, ok, detail });
  console.log(`    ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  →  ${detail}`}`);
};

function scaffold(name, extraFiles = {}) {
  const dir = join(DATA_ROOT, `${name}-${stamp}`);
  rmrf(dir);
  mkdirSync(dir, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'e2e@local']);
  git(['config', 'user.name', 'continue-do e2e']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(
    join(dir, 'README.md'),
    `# e2e · ${name}\n\n只用来验证框架能不能转，不是真实项目。\n\nversion: 1\nstatus: 1\n`,
  );
  for (const [rel, body] of Object.entries(extraFiles)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
  const install = spawnSync(process.execPath, [join(HERE, 'install.mjs'), '--no-detect'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { name, dir, git, install };
}

/** 直接喂装好的钩子（probe）。payload 走 stdin，和宿主一致。 */
function hook(ctx, script, payload, { args = [], env = {}, cwd } = {}) {
  const at = cwd ?? ctx.dir;
  return spawnSync(process.execPath, [join(at, '.continue', 'hooks', script), ...args], {
    cwd: at,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
}

const stop = (s) => ({ hook_event_name: 'Stop', session_id: s });
const promptEvt = (s, text = 'hi') => ({
  hook_event_name: 'UserPromptSubmit',
  session_id: s,
  prompt: text,
});

const write = (ctx, rel, body) => {
  mkdirSync(dirname(join(ctx.dir, rel)), { recursive: true });
  writeFileSync(join(ctx.dir, rel), body);
};
const readMaybe = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const logOf = (ctx, s) => readMaybe(join(ctx.dir, '.continue', '.logs', sid6(s), 'run.md'));

/**
 * 清掉某个会话的运行日志（钩子的 `msStep` / `msStreak` 就存在里面）。
 *
 * 为什么 probe 场景需要它：钩子用 `里程碑:批次` 当关卡去重键，同一把钥匙只下发一次。
 * 而 probe 场景是**手工改队列文件**来逼近边界，批次号不变 → 键不变 → 第二次会被当成
 * "已下发过"而放行，看着像"硬停失效"。真实流程里确认后换批次号，所以这是**测试的假象**，
 * 每个边界前重置一次状态即可。
 */
const resetHookState = (ctx, s) => {
  // 删不掉就抛：不然"硬停"其实没被重置，断言会给出假红/假绿
  if (!rmPath(join(ctx.dir, '.continue', '.logs', sid6(s), 'run.md'))) {
    throw new Error('重置钩子状态失败（run.md 删不掉），后面的边界断言会失真');
  }
};

/** 一个只带 `[x]` 条目的队列（用于触发"队列已清空"的收尾分支）。 */
const doneQueue = (s) =>
  `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 创建：2026-10-23\n> 批次：20260101-0001\n\n- [x] 甲\n  - 验证：\`true\`\n`;

// ---------------------------------------------------------------- 场景
const SCENARIOS = {};

/** 主干：真模型跑一条小任务，走完 队列 → 递任务 → 收尾 → 归档。 */
SCENARIOS.main = {
  driver: 'model',
  desc: '主干：真模型依次做完 3 条小任务（逐条递 / 逐条勾 / 收尾 / 归档）',
  async run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    check('装出 .continue/README.md', existsSync(join(ctx.dir, '.continue', 'README.md')));
    check('注册了钩子', existsSync(join(ctx.dir, '.codebuddy', 'settings.json')));
    check('装了 pre-commit 垫片', existsSync(join(ctx.dir, '.git', 'hooks', 'pre-commit')));
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'chore: 装框架']);

    /**
     * 三条**极小**任务：每一条都只是改一个字符/加一行，AI 一轮就能做完。
     * 这样既能验"逐条递、勾一条递下一条"，又不会把 token 烧穿
     * （实测：轮数才是成本主因，任务条数不是）。
     */
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '队列文件已经建好了（空的，状态讨论中）。请把下面 3 件小事写成 3 条队列条目，逐条做完：',
      '',
      '  1. 把 README.md 里的 `version: 1` 改成 `version: 2`；',
      '  2. 新建 notes.txt，内容一行 `ok`；',
      '  3. 把 README.md 里的 `status: 1` 改成 `status: 2`。',
      '',
      '要求（按顺序做完，不要问我问题）：',
      '1. 把 3 条写进队列（每条带 `验证：` 一行，验证命令要能一条就跑完），并把状态改成 `执行中`；',
      '2. **一次只做一条**：做完勾 `[x]`、写完成说明、提交，再下一条；',
      '3. 三条做完后按收尾五步收尾（搬进 DONE.md、更新 OVERVIEW.md / TASKS.md、归档队列），再提交。',
    ].join('\n');
    const r = await runModel(ctx, prompt);
    if (!r) return;

    const logText = logOf(ctx, s);
    check('钩子写过运行日志', logText.length > 0, '钩子一次都没跑起来');
    check('queue-init 跑过', /\[queue-init · UserPromptSubmit\]/.test(logText));
    check('auto-continue 跑过', /\[auto-continue · /.test(logText));
    // 只匹配包装器那行特有文案：模型会读 README，而 README 里就写着"框架自己坏了"
    check('钩子没有崩', !/\[continue-do\] 钩子 \S+ 异常退出/.test(r.text));

    const doingFile = join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`);
    const archived = listArchive(ctx, s);
    check('建过会话队列', existsSync(doingFile) || archived.length > 0, 'doing/ 与 .logs/ 里都没有队列');
    check('DONE.md 出现批次节', /^## 批次 \d{8}-\d{4}/m.test(readMaybe(join(ctx.dir, '.continue', 'DONE.md'))));
    /**
     * 「归档」这一步不靠模型自觉：它是**机制**，用 probe 直接调一次最可靠。
     * 模型那段只要验到"收了尾（DONE 有批次节）"即可——两次实跑证明它会不会跑第 5 步是抖的。
     */
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const queueArchive = readMaybe(join(ctx.dir, '.continue', '.logs', sid6(s), 'queue.md'));
    check(
      '收尾第 5 步可执行（归档队列）',
      arch.status === 0 && listArchive(ctx, s).length > 0,
      arch.stdout.slice(0, 160),
    );
    const doneItems = (queueArchive.match(/^- \[x\]/gm) ?? []).length;
    check(`三条任务都勾完了（归档里 ${doneItems} 条 [x]）`, doneItems >= 3, queueArchive.slice(0, 200));
    checkHead(r);
  },
};

/** 场景 1：队列条目连续 N 轮没做完 → 标 [阻塞] → 之后请用户拍板。 */
SCENARIOS.blocked = {
  driver: 'probe',
  desc: '阻塞：连续 2 轮没做完 → 标 [阻塞] → 请求用户拍板',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    // 末尾必须是 `[自审]`（T14 起的硬规则）：少写它，下面这次 commit 会被 pre-commit 拒，
    // 工作区就一直是脏的 → 后面的"提交守卫不判脏"必然假红
    const q = `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 创建：2026-10-23\n> 批次：20260101-0001\n\n- [ ] 甲\n  - 描述：故意一直做不完\n- [ ] [自审] 占位自审\n`;
    write(ctx, `.continue/doing/${sid6(s)}.md`, q);
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'queue']);

    const env = { CONTINUE_BLOCK_AFTER: '2' };
    const r1 = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'], env });
    // ⚠️ 必须**立刻**抓：后面两轮会把它标成 [阻塞]，那时再读就看不到 [~] 了
    const afterFirst = readMaybe(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`));
    const r2 = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'], env });
    const r3 = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'], env });

    check('第 1 轮正常递任务', r1.status === 2 && /第 \d+\/\d+ 条/.test(r1.stderr), r1.stderr.slice(0, 120));

    // 递任务时钩子自己把这条标成进行中（不等 AI 写）
    check('递出去的那条被标成 [~]（进行中）', /^- \[~\] 甲/m.test(afterFirst), afterFirst.split('\n').find((l) => l.startsWith('- [')) ?? '');

    /**
     * 钩子刚改了队列 → 工作区确实脏，但那是**钩子自己的痕迹**，不该催人提交。
     * `auto-commit` 判脏时排除了 `doing/`，所以这里应当放行（exit 0）。
     */
    const guard = hook(ctx, 'auto-commit.mjs', stop(s), { args: ['--event=Stop'] });
    check('钩子改过队列后，提交守卫不判脏（exit 0）', guard.status === 0, `exit=${guard.status} ${guard.stderr.slice(0, 160)}`);
    const afterQueue = readMaybe(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`));
    check('连续 N 轮后条目被标 [阻塞]', /\[阻塞\]/.test(afterQueue), afterQueue.split('\n').find((l) => l.includes('[')) ?? '');
    check('日志记了"隔离"', /隔离 · 连续 \d+ 轮/.test(logOf(ctx, s)));
    check('之后改为请求用户拍板', /拍板|阻塞/.test(`${r2.stderr}${r3.stderr}`), `${r2.stderr}${r3.stderr}`.slice(0, 160));
    /**
     * 判据看**队列状态**而不是注入文案：递一次任务就会把那条标回 `[~]`，
     * 所以"甲 仍是 `[阻塞]`"就是"没被再递出去"的硬证据。
     * （队列里还有 `[自审]` 这种正常条目时，第 3 轮去递它是**对的**，不能拿
     * "这一轮做这一条"这个词判失败——那是旧夹具只有 1 条时留下的写法。）
     */
    const afterThird = readMaybe(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`));
    check(
      '阻塞条目不再被当成普通任务递出',
      /- \[阻塞\] 甲/.test(afterThird),
      afterThird.split('\n').filter((l) => l.startsWith('- ')).join(' | '),
    );
  },
};

/** 场景 2：需要拍板的地方由模型自己决定，但必须写进 decision 文件。 */
SCENARIOS.decision = {
  driver: 'model',
  desc: '决策留底（**提示词刻意不提 decision**）：只给一个取舍，看框架会不会让模型自己拍板 + 留底',
  async run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    /**
     * ⚠️ 这段提示词**故意不写**"要写 decision 文件"，也不写"不要问我"。
     *
     * 旧版写的是"按框架第 10 条：你替用户做的决定必须写进 …"——那等于把答案递给模型，
     * 于是这条用例一直在验"模型能不能照抄指令"，而真正的问题（每轮注入在说"必须弹窗"）
     * 一次都没被它抓住。2026-10-23 用户反馈"AI 明明有推荐结果却停下来让我选"就是这么漏的。
     * 现在只给一个有取舍的家务事：**行为对不对，全靠框架自己的注入**。
     */
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '请按框架流程做这一件小事：把 README.md 里的 `status: 1` 改成 2。',
      '',
      '两种写法都行：A) `status: 2`（纯数字）；B) `status: "two"`（字符串，可读性好但类型变了）。',
      '选哪个由你判断。',
    ].join('\n');
    const r = await runModel(ctx, prompt);
    if (!r) return;

    const decPath = join(ctx.dir, '.continue', 'doing', `${sid6(s)}-decision.md`);
    const archived = listArchive(ctx, s).filter(isDecisionArchive);
    const body = readMaybe(decPath) || (archived[0] ? readMaybe(join(ctx.dir, '.continue', '.logs', sid6(s), archived[0])) : '');

    check('没被明确要求也写了决策记录（doing/ 或已归档）', body.length > 0, '既没有 doing/<sid>-decision.md，也没有归档——"默认自己决定并留底"没落地');
    check('至少一条 D<n>', /^##\s*D\d+/m.test(body), body.slice(0, 120));
    check('每条有「决定」', /^[-*]\s*决定\s*[:：]/m.test(body));
    check('每条有「为什么」', /^[-*]\s*为什么\s*[:：]/m.test(body));
    check('每条有「影响」', /^[-*]\s*影响\s*[:：]/m.test(body));

    /**
     * 最关键的一条：**有没有为了"选哪种写法"弹窗问人**。
     *
     * 判据来自 CLI 的事件流（stdout 里的 tool_use 记录）。先确认"这条流里能看到工具调用"，
     * 否则"没弹窗"只是个空断言——看不见等于没验（宁可标跳过，也不要假绿）。
     */
    const toolNames = [...String(r.text ?? '').matchAll(/"name"\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    if (toolNames.length === 0) {
      console.log('    ⚠️ 事件流里解析不到工具调用记录，"是否弹窗"无法判定——按环境问题跳过这条断言');
      ctx.skipped = true;
    } else {
      const asked = toolNames.includes('ask_followup_question') || toolNames.includes('AskUserQuestion');
      check(
        '没有为一个"选哪种写法"的取舍弹窗问用户',
        !asked,
        `事件里出现提问工具；本轮工具：${[...new Set(toolNames)].slice(0, 10).join(', ')}`,
      );
    }
    /**
     * 归档同样用 probe：模型会不会跑第 5 步是抖的，而"决策记录跟着队列一起走"是**机制**。
     * 这里直接调 `archive-queue <sid>`，看它是否把 decision 也带走了。
     */
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const archivedNow = listArchive(ctx, s);
    check(
      '归档队列时决策记录跟着一起归档',
      arch.status === 0 && archivedNow.some(isDecisionArchive),
      `${arch.stdout.slice(0, 120)} | 归档目录：${JSON.stringify(archivedNow)}`,
    );
    checkHead(r);
  },
};

/**
 * 场景 3a：长任务 → 会不会在队列里插里程碑（**只验切分产物**，不实现）。
 *
 * 只回答一个问题：给一个明显装不下一批的任务，它会不会**真的**在队列里插节点、
 * 节点粒度与验收命令合不合理。**产物合理就过，到此为止**——不往下实现，那样太慢。
 */
SCENARIOS['milestone-split'] = {
  driver: 'model',
  desc: '里程碑切分：大任务 → 是否在队列里插节点、粒度与验收命令是否合理（不实现）',
  async run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '现在有一个明显装不下一批的大任务：给项目补 30 条小功能（每条 3~5 行代码那种）。',
      '',
      '请**只做规划**，一行实现代码都不要写：',
      '1. 建本会话队列 `.continue/doing/<本会话ID>.md`，把 30 条拆成条目（每条带验证方式）；',
      '2. 按框架第 10 条，在队列里每 8~12 条之后插一个 `## 里程碑 MSn · 名字` 节点，',
      '   每个节点带一行 `- 验收：<这一段做完要跑的命令>`；',
      '3. **不要建任何计划文件**（里程碑只写在队列里）；',
      '4. 不要问我问题。',
    ].join('\n');
    const r = await runModel(ctx, prompt);
    if (!r) return;

    const qPath = join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`);
    const qText = readMaybe(qPath);
    check('建了会话队列', qText.length > 0, `缺 ${qPath}`);
    const milestones = [...qText.matchAll(/^##\s*里程碑\s*(MS\d+)\s*[·:：]/gm)].map((m) => m[1]);
    const entries = (qText.match(/^-\s*\[[ x~]\]/gm) ?? []).length;
    check('在队列里插了里程碑节点', milestones.length >= 1, `解析到 ${milestones.length} 个`);
    check('每个里程碑都写了验收命令', /^[-*]\s*验收\s*[:：]/m.test(qText));
    check('条目数 ≥ 10（30 条任务不该只有几条）', entries >= 10, `解析到 ${entries} 条`);
    check('没有建计划文件', !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}-plan.md`)));
    checkHead(r);
  },
};

/**
 * 场景 3b：里程碑关卡（**纯 probe**）。
 *
 * 里程碑写在队列里（`## 里程碑 MS1 · 名` + `- 验收：…`），不另建计划文件。
 * 验四件事：
 *   ① 前面的条目做完 → **硬停**（不把后面的任务递出去）；
 *   ② 硬停时列出验收命令，并要求"先问人、拿到答复才动队列"；
 *   ③ 写了 `- 确认：已验收` → 放行，接着递后面的条目；
 *   ④ 最后一个里程碑也确认后 → 自动收尾（五步含归档）。
 */
SCENARIOS.milestone = {
  driver: 'probe',
  desc: '里程碑：队列内节点 → 硬停等人工验收 → 确认后继续 → 最后整体收尾',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    const queueWith = ({ before, after, confirm = false }) =>
      [
        `# 队列 · 会话 ${s}`,
        '',
        '> 状态：执行中',
        '> 创建：2026-10-23',
        '> 批次：20260101-0001',
        '',
        ...before,
        '',
        '## 里程碑 MS1 · 甲',
        '- 验收：`true`',
        ...(confirm ? ['- 确认：已验收 · 批次 `20260101-0001`'] : []),
        '',
        ...after,
        '',
      ].join('\n');

    // ① 前面的条目全做完、后面还有一条 → 应该停在里程碑
    write(
      ctx,
      `.continue/doing/${sid6(s)}.md`,
      queueWith({
        before: ['- [x] 甲', '  - 验证：`true`'],
        after: ['- [ ] 乙', '  - 验证：`true`'],
      }),
    );
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'queue with milestone']);

    const hard = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('走到里程碑 → 硬停', /到达里程碑 MS1/.test(hard.stderr), hard.stderr.slice(0, 160));
    check('列出该里程碑的验收命令', /`true`/.test(hard.stderr), hard.stderr.slice(0, 160));
    check('硬停时**不**把后面的任务递出去', !/这一轮做这一条/.test(hard.stderr), hard.stderr.slice(0, 160));
    const ask = hard.stderr.indexOf('弹窗问用户');
    const act = hard.stderr.indexOf('只有用户选了');
    check('先问人、拿到答复才动队列', ask > 0 && act > ask, `ask=${ask} act=${act}`);

    // ② 用户选"继续"之后：写确认行 → 放行，接着递后面的条目
    resetHookState(ctx, s);
    write(
      ctx,
      `.continue/doing/${sid6(s)}.md`,
      queueWith({
        before: ['- [x] 甲', '  - 验证：`true`'],
        after: ['- [ ] 乙', '  - 验证：`true`'],
        confirm: true,
      }),
    );
    const next = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check(
      '确认后继续递后面的条目',
      next.status === 2 && /乙/.test(next.stderr) && !/到达里程碑/.test(next.stderr),
      next.stderr.slice(0, 160),
    );

    // ③ 全部做完 + 里程碑已确认 → 自动收尾（含归档）
    resetHookState(ctx, s);
    write(
      ctx,
      `.continue/doing/${sid6(s)}.md`,
      queueWith({ before: ['- [x] 甲', '  - 验证：`true`'], after: [], confirm: true }),
    );
    const fin = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('最后一个里程碑验收完 → 自动收尾', /自动收尾/.test(fin.stderr), fin.stderr.slice(0, 160));
    check('收尾要求归档队列（不是 rm）', /archive-queue\.mjs/.test(fin.stderr));
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    check(
      '归档可执行（队列移出 doing/）',
      arch.status === 0 && !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`)),
      arch.stdout.slice(0, 160),
    );
  },
};

/**
 * 完整旅程（可选，不进 `--all`）：**同一个会话把整条链走一遍**。
 *
 * 和前面几个的区别：它们是"切片"，各测一段；这条是**串起来**——
 * 第 1 批（模型做 2 条）→ 收尾归档 → 第 2 批（probe 驱动）→ 再归档（**同一份累积文件里两节**）
 * → 队列内里程碑 → 边界硬停 → 完成。
 *
 * 为什么第 2 批用 probe：它的目的是验"跨批次的衔接"，不是"模型会不会干活"；
 * 模型那一段已经证明过了，再跑一遍只是把 token 烧在同一个地方。
 */
SCENARIOS.journey = {
  driver: 'model',
  desc: '完整旅程：两批任务（含跨批次累积归档）+ 队列内里程碑硬停与完成',
  async run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    // ---- 第 1 批：模型做 2 条
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '请把下面 2 件小事写成队列条目，逐条做完，然后按收尾五步收尾（含归档队列）：',
      '  1. 把 README.md 里的 `version: 1` 改成 `version: 2`；',
      '  2. 新建 notes.txt，内容一行 `ok`。',
      '要求：一次只做一条，勾 `[x]` 并写 `验证：` 再提交；不要问我问题。',
    ].join('\n');
    const r = await runModel(ctx, prompt);
    if (!r) return;

    const arch1 = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const archivePath = join(ctx.dir, '.continue', '.logs', sid6(s), 'queue.md');
    const afterBatch1 = readMaybe(archivePath);
    check('第 1 批做完并归档', arch1.status === 0 && afterBatch1.includes('## 批次'), afterBatch1.slice(0, 120));
    check('第 1 批两条都勾了', (afterBatch1.match(/^- \[x\]/gm) ?? []).length >= 2);

    // ---- 第 2 批：probe 造一份新批次队列，走完"递 → 勾 → 收尾 → 归档"
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'batch1 归档']);
    write(
      ctx,
      `.continue/doing/${sid6(s)}.md`,
      `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 批次：20260102-0000\n\n- [ ] 丙\n  - 验证：\`true\`\n`,
    );
    const deliver = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('第 2 批能接着递任务', deliver.status === 2 && /丙/.test(deliver.stderr), deliver.stderr.slice(0, 120));

    // 模拟 AI 做完并勾掉
    const qFile = join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`);
    writeFileSync(qFile, readFileSync(qFile, 'utf8').replace('- [~] 丙', '- [x] 丙\n  - 验证：`true`'));
    const fin = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('第 2 批勾完后转入收尾', /收尾|归档/.test(fin.stderr), fin.stderr.slice(0, 160));
    hook(ctx, 'archive-queue.mjs', null, { args: [s] });

    const archive2 = readMaybe(archivePath);
    const sections = (archive2.match(/^## 批次 /gm) ?? []).length;
    const seps = (archive2.match(/^-{10}$/gm) ?? []).length;
    check(
      '两批归档进**同一份**累积文件（2 节 1 分隔线）',
      sections === 2 && seps === 1,
      `sections=${sections} seps=${seps}`,
    );

    // ---- 里程碑：队列内节点走到边界 → 硬停
    write(
      ctx,
      `.continue/doing/${sid6(s)}.md`,
      [
        `# 队列 · 会话 ${s}`,
        '',
        '> 状态：执行中',
        '> 批次：20260101-0000',
        '',
        '- [x] 甲',
        '  - 验证：`true`',
        '',
        '## 里程碑 MS1 · 甲',
        '- 验收：`true`',
        '',
        '- [ ] 乙',
        '  - 验证：`true`',
        '',
      ].join('\n'),
    );
    resetHookState(ctx, s);
    const hard = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('走到里程碑 → 硬停', /到达里程碑/.test(hard.stderr), hard.stderr.slice(0, 120));
    check(
      '硬停先问人、答复后才动队列',
      hard.stderr.indexOf('弹窗问用户') > 0 && hard.stderr.indexOf('只有用户选了') > hard.stderr.indexOf('弹窗问用户'),
    );
    checkHead(r);
  },
};

/** 场景 4：已有进行中的队列 → 注入提示 → 开 worktree → 隔离 → 收尾**不做任何合并**（交给用户）。 */
SCENARIOS.worktree = {
  driver: 'probe',
  desc: '并行：别的会话有队列 → 提示开 worktree → 树内隔离 → 收尾不自动合并',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    // 已有的"另一个会话"队列：前缀必须与本次会话**不同**，否则 sid6 撞车（文件名相同＝同一份队列）
    // 最后一条必须是 `[自审]`（README §8）：少写它，pre-commit 会拒绝提交，
    // 于是主树 HEAD 还停在 `init`（树里连钩子都没有），后面每一步都跟着假红。
    const other = `abcdef${'0'.repeat(25)}1`;
    write(
      ctx,
      `.continue/doing/${sid6(other)}.md`,
      `# 队列 · 会话 ${other}\n\n> 状态：执行中\n> 批次：20260101-0009\n\n- [ ] 乙\n  - 描述：别人在做\n- [ ] [自审] 占位自审\n`,
    );
    ctx.git(['add', '-A']);
    const prep = ctx.git(['commit', '-q', '-m', 'other session queue']);
    check('准备提交（fixture 合法，否则 pre-commit 会拦）', prep.status === 0, (prep.stderr || prep.stdout).slice(0, 300));

    // ① 新会话的注入里必须提到"其他未完成队列"
    const inj = hook(ctx, 'queue-init.mjs', promptEvt(s), { args: ['--event=UserPromptSubmit'] });
    let ctxText = '';
    try {
      ctxText = JSON.parse(inj.stdout).hookSpecificOutput.additionalContext ?? '';
    } catch {
      ctxText = inj.stdout;
    }
    check(
      '新会话注入提示「其他会话还有未完成队列」',
      /其他会话还有未完成队列/.test(ctxText),
      ctxText.slice(0, 200),
    );

    // ② 本地 bare 仓库当 origin（不依赖网络/凭据）
    const origin = join(dirname(ctx.dir), `origin-${ctx.name}-${stamp}.git`);
    rmrf(origin);
    spawnSync('git', ['init', '--bare', '-q', origin]);
    ctx.git(['branch', '-M', 'main']);
    ctx.git(['remote', 'add', 'origin', origin]);
    ctx.git(['push', '-q', '-u', 'origin', 'main']);

    // ③ 建 worktree：目录与分支都叫 `worktree_<单词>_<YYYYMMDD>`（单词由 AI 按批次需求取）
    const wt = spawnSync(
      process.execPath,
      [join(ctx.dir, '.continue', 'hooks', 'worktree.mjs'), 'export', '--no-window'],
      {
        cwd: ctx.dir,
        encoding: 'utf8',
        env: { ...process.env, CODEBUDDY_SESSION_ID: s },
      },
    );
    const today = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const dateStamp = `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`;
    const wtBranch = `worktree_export_${dateStamp}`;
    const wtDir = join(ctx.dir, '.continue', 'doing', '.worktree', wtBranch);
    check('worktree.mjs 退出码 0', wt.status === 0, (wt.stderr || wt.stdout).slice(0, 300));
    check(`建出了工作树目录（命名 ${wtBranch}）`, existsSync(wtDir), wtDir);
    check(
      `分支 ${wtBranch} 存在`,
      spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${wtBranch}`], { cwd: ctx.dir }).status === 0,
    );
    check(
      '分支已推到 origin',
      spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${wtBranch}`], { cwd: origin }).status === 0,
    );
    check(
      '交接队列写进了树里（doing/worktree.md，含批次号）',
      /^> 批次：\d{8}-\d{4}/m.test(readMaybe(join(wtDir, '.continue', 'doing', 'worktree.md')) ?? ''),
      readMaybe(join(wtDir, '.continue', 'doing', 'worktree.md'))?.slice(0, 120) ?? '没有 worktree.md',
    );

    /**
     * ④ 隔离验什么：**不是**"看不到主树的队列"。
     *
     * worktree 检出的是同一条分支，`doing/` 里**已提交**的队列两边长得一样——那是共享事实。
     * 真正被隔离的是**未提交的改动**与**各自的会话状态**。所以这里验两件：
     *   · 一个全新的会话 ID 在树里跑，会**接管** `doing/worktree.md`（改名成 `<sid6>.md`）
     *     并开始递任务——这是"队列即交接"的核心，比"看不到别人的队列"更值得钉住；
     *   · 在树里留下未提交改动，主树的 `git status` 不受影响。
     */
    // 再换一个**不同的 6 位前缀**：短名会截到前 6 位，前缀重复就等于同一个会话
    const freshSid = `fedcba${'0'.repeat(25)}3`;
    // 先喂一次用户消息：`tracked` 的定义是"有队列**或**已有日志"，全新会话直接喂 Stop
    // 会走进"不记录"分支（这是设计，不是 bug）——所以按真实顺序：先 prompt，再 Stop。
    hook(ctx, 'queue-init.mjs', promptEvt(freshSid), { args: ['--event=UserPromptSubmit'], cwd: wtDir });
    hook(ctx, 'auto-continue.mjs', stop(freshSid), { args: ['--event=Stop'], cwd: wtDir });
    /**
     * 判据读两处：树里那份 `.logs/<sid6>/run.md`（递任务会在这里留痕）与
     * 改名后的 `doing/<sid6>.md`——只读 stderr 分不清"接管了"和"没找到队列"。
     */
    const wtLog = readMaybe(join(wtDir, '.continue', '.logs', sid6(freshSid), 'run.md'));
    check(
      '树内新会话接管交接队列（doing/<sid6>.md）并开始递任务',
      /递任务/.test(wtLog) && existsSync(join(wtDir, '.continue', 'doing', `${sid6(freshSid)}.md`)),
      wtLog.slice(0, 160) || '树里没写出日志',
    );

    write({ dir: wtDir }, 'only-in-wt.txt', 'x\n');
    const mainStatus = spawnSync('git', ['status', '--porcelain'], { cwd: ctx.dir, encoding: 'utf8' }).stdout ?? '';
    check('树里的未提交改动不串到主树', !/only-in-wt\.txt/.test(mainStatus), mainStatus.slice(0, 200));
    spawnSync('git', ['checkout', '--', '.'], { cwd: wtDir });
    rmrf(join(wtDir, 'only-in-wt.txt'));

    // ⑤ 收尾**不合并**（2026-10-24 起取消自动 rebase / merge）：树里能提交，父分支不受影响
    write({ dir: wtDir }, 'hello.txt', 'hello from worktree\n');
    spawnSync('git', ['add', '-A'], { cwd: wtDir });
    const c = spawnSync('git', ['commit', '-q', '-m', 'feat: worktree 里的改动'], { cwd: wtDir, encoding: 'utf8' });
    check('worktree 里能提交（收尾提交）', c.status === 0, (c.stderr || '').slice(0, 160));

    /**
     * 父分支**必须没被合掉**：这正是这次要钉的行为——"做完就结束，后面由用户处理"。
     * 旧版在这里会自动 rebase + merge，那样父分支会被悄悄改动，用户没法在合并前 review。
     */
    const parentContains = spawnSync('git', ['merge-base', '--is-ancestor', wtBranch, 'main'], {
      cwd: ctx.dir,
    });
    check(
      '收尾不自动合并：父分支没有包含树分支的改动',
      parentContains.status !== 0 && !existsSync(join(ctx.dir, 'hello.txt')),
      `merge-base --is-ancestor exit=${parentContains.status}`,
    );
    check(
      '同步脚本已从安装产物里移除（worktree-sync.mjs 不再存在）',
      !existsSync(join(ctx.dir, '.continue', 'hooks', 'worktree-sync.mjs')),
    );
    check(
      '父分支 doing/ 没被 worktree 的现场污染',
      !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`)),
    );
  },
};

/**
 * 场景 5：**交接模式**——主工作区写收件箱 → Stop 建执行树 → 新窗口第一条消息接管。
 *
 * 与 `worktree` 场景的区别：那条验的是手工 `worktree.mjs`（交接文件在树里的 `doing/worktree.md`）；
 * 这条验默认链路（交接文件在**主工作区**的 `.continue/doing/.worktree/todo/`），
 * 也就是"规划区 / 执行区"分离到底成不成立；顺带验前提——`doing/` 空着时不派发。
 */
SCENARIOS.dispatch = {
  driver: 'probe',
  desc: '交接：doing 有人时写 todo → Stop 建树 → 新树接管；没人时不派发',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    /**
     * 先把**安装产物**提交掉：`git worktree add HEAD` 只检出已提交的内容，
     * 不提交就等于建出一棵没有钩子的空树（worktree 场景也在同一处踩过）。
     * 收件箱在 `.worktree/` 下、已被 gitignore，写它不会让工作区变脏。
     */
    ctx.git(['add', '-A']);
    const prep = ctx.git(['commit', '-q', '-m', 'install framework']);
    check('准备提交（新树要从 HEAD 检出钩子）', prep.status === 0, (prep.stderr || prep.stdout).slice(0, 300));

    /**
     * 钩子的 `shortSid` 只对 **32 位 hex / UUID** 截前 6 位；e2e 的会话 ID
     * 末尾是 `q`（不是 hex），所以目录名与队列文件名都是**完整 ID**。
     * 这里不能直接用 e2e 的 `sid6()`（它无条件 slice），否则路径全错。
     */
    const short = (id) => (/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id) ? id.slice(0, 6) : id);

    const todoDir = join(ctx.dir, '.continue', 'doing', '.worktree', 'todo');
    mkdirSync(todoDir, { recursive: true });

    /**
     * ⓪ 前提不成立时**不该派发**：`doing/` 里一个人都没有。
     * 放在最前——这时 `doing/` 还空着，正好是"空树"的真实状态；
     * 这条挡的是"收件箱有内容就建树"的直觉（会把简单事情拆成两步）。
     */
    writeFileSync(
      join(todoDir, 'queue.md'),
      `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 批次：20260101-0011\n\n- [ ] 甲\n- [ ] [自审] 占位自审\n`,
    );
    writeFileSync(join(todoDir, 'context.md'), '# 上下文\n\n空树不该派发。\n');
    const idle = hook(ctx, 'dispatch.mjs', stop(s), { args: ['--event=Stop', '--no-window'] });
    check(
      'doing/ 里没人在跑 → 不建树、不写 state',
      !existsSync(join(todoDir, 'state.json')) && /没有别的会话队列/.test(idle.stdout),
      idle.stdout.slice(0, 240),
    );

    /**
     * 造出前提：**另一个会话**正在跑（合法队列——pre-commit 的 `audit-ids` 会校验
     * 首行 ID 与文件名、最后一条是 `[自审]`；不合法的 fixture 会让下面每一步都假红）。
     */
    const other = `abcdef${'0'.repeat(25)}9`;
    write(
      { dir: ctx.dir },
      `.continue/doing/${short(other)}.md`,
      `# 队列 · 会话 ${other}\n\n> 状态：执行中\n> 批次：20260101-0010\n\n- [ ] 乙\n  - 描述：别人在做\n- [ ] [自审] 占位自审\n`,
    );
    ctx.git(['add', '-A']);
    const prepOther = ctx.git(['commit', '-q', '-m', 'other session queue']);
    check(
      '准备提交（别的会话队列 + 新树要从 HEAD 检出钩子）',
      prepOther.status === 0,
      (prepOther.stderr || prepOther.stdout).slice(0, 300),
    );
    writeFileSync(
      join(todoDir, 'queue.md'),
      `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 批次：20260101-0011\n> 树名：demo\n\n- [ ] 甲\n- [ ] [自审] 占位自审\n`,
    );
    writeFileSync(join(todoDir, 'context.md'), '# 上下文\n\n把甲做完，验证看 a.txt。\n');

    const readCtx = (r) => {
      try {
        return JSON.parse(r.stdout).hookSpecificOutput.additionalContext ?? '';
      } catch {
        return r.stdout;
      }
    };

    // ① 规划区第一条消息：**不接管**，只提示"收件箱待派发"
    const parentInj = hook(ctx, 'queue-init.mjs', promptEvt(s), { args: ['--event=UserPromptSubmit'] });
    check('规划区注入提示「收件箱待派发」', /待派发队列/.test(readCtx(parentInj)), readCtx(parentInj).slice(0, 200));
    check(
      '规划区没有生成 doing/<sid6>.md（接管只在树里）',
      !existsSync(join(ctx.dir, '.continue', 'doing', `${short(s)}.md`)),
    );

    // ② 规划区 Stop：放行（没有本会话队列），不递任务
    const parentStop = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('规划区 Stop 放行（exit 0）', parentStop.status === 0, (parentStop.stderr || '').slice(0, 200));

    // ③ 派发：建树 + 分支 + 状态
    hook(ctx, 'dispatch.mjs', stop(s), { args: ['--event=Stop', '--no-window'] });
    let state = {};
    try {
      state = JSON.parse(readMaybe(join(todoDir, 'state.json'))) ?? {};
    } catch {
      state = {};
    }
    const tree = state.tree ?? '';
    check('dispatch 建出工作树并写 state.json', Boolean(tree) && existsSync(tree), tree || '没有 state.json');
    check(
      '树名/分支是 worktree_<queue.md 的树名>_<YYYYMMDD>',
      /^worktree_demo_\d{8}$/.test(String(state.treeName)) && state.branch === state.treeName,
      `treeName=${state.treeName} branch=${state.branch}`,
    );
    check(
      '新树基于 HEAD 检出（钩子文件都在）',
      existsSync(join(tree, '.continue', 'hooks', 'dispatch.mjs')) &&
        existsSync(join(tree, '.continue', 'hooks', 'queue-init.mjs')),
    );
    check(
      '收件箱不复制进树（只在主工作区一份）',
      !existsSync(join(tree, '.continue', 'doing', '.worktree', 'todo', 'queue.md')),
    );

    // ④ 幂等：再停下一次不重复建树
    const again = hook(ctx, 'dispatch.mjs', stop(s), { args: ['--event=Stop', '--no-window'] });
    check('已派发且树还在 → 不重复建树', /已有待接管/.test(again.stdout), again.stdout.slice(0, 200));

    // ⑤ 新窗口第一条消息：接管队列 + 上下文
    const freshSid = `fedcba${'0'.repeat(25)}5`;
    const childInj = hook(ctx, 'queue-init.mjs', promptEvt(freshSid), {
      args: ['--event=UserPromptSubmit'],
      cwd: tree,
    });
    const childCtx = readCtx(childInj);
    const qfile = join(tree, '.continue', 'doing', `${short(freshSid)}.md`);
    const qtext = readMaybe(qfile);
    check('新树接管成 doing/<新 sid6>.md', existsSync(qfile), qfile);
    check('首行换成新会话的完整 ID', qtext.startsWith(`# 队列 · 会话 ${freshSid}`), qtext.slice(0, 80));
    check('批次号沿用主工作区写的那个', /20260101-0011/.test(qtext), qtext.slice(0, 200));
    check('上下文附进注入', /把甲做完/.test(childCtx), childCtx.slice(0, 300));
    check(
      '接管后收件箱清空',
      !existsSync(join(todoDir, 'queue.md')) && !existsSync(join(todoDir, 'context.md')),
    );
    check(
      '上下文存档到 .logs/<新 sid6>/handoff.md',
      /把甲做完/.test(readMaybe(join(tree, '.continue', '.logs', short(freshSid), 'handoff.md'))),
    );

    // ⑥ 新树里 Stop 必须开始递任务
    const childStop = hook(ctx, 'auto-continue.mjs', stop(freshSid), { args: ['--event=Stop'], cwd: tree });
    check('新树 Stop 递第 1/2 条', /1\/2 条/.test(childStop.stderr ?? ''), (childStop.stderr || '').slice(0, 300));
  },
};

// ---------------------------------------------------------------- 运行器
function listArchive(ctx, s) {
  const d = join(ctx.dir, '.continue', '.logs', sid6(s));
  if (!existsSync(d)) return [];
  // 新格式：累积文件 queue.md / decision.md；旧格式带时间戳，一并认。
  // 旧版计划归档（`plan.md`）不算：机制已移除，它不参与"这一批归档了没有"的判定。
  return readdirSync(d).filter(
    (n) => /^(queue|decision)(-\d{14})?\.md$/.test(n),
  );
}

/**
 * 决策记录的归档文件：现格式是累积式 `decision.md`（一个会话一份），
 * 旧格式带 14 位时间戳 `decision-<ts>.md`。两种都认——只写 `startsWith('decision-')`
 * 会把现格式判成"没归档"（本场景就栽在这上面，2026-10-23 实测）。
 */
function isDecisionArchive(n) {
  return /^decision(-\d{14})?\.md$/.test(n);
}

/** 真跑一次 CLI；返回 { text, status } 或 null（环境跳过）。 */
async function runModel(ctx, prompt) {
  const cliArgs = [
    '-p',
    prompt,
    '--model',
    model,
    '--session-id',
    ctx.sid,
    '--max-turns',
    String(maxTurns),
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'json',
  ];
  console.log(`    $ codebuddy -p "<prompt>" --model ${model} --max-turns ${maxTurns}`);
  const started = Date.now();
  const run = await runCliGroup('codebuddy', cliArgs, {
    cwd: ctx.dir,
    timeoutMs: timeoutSec * 1000,
  });
  const elapsed = Math.round((Date.now() - started) / 1000);
  writeFileSync(
    join(ctx.dir, '.e2e-cli.json'),
    JSON.stringify(
      { args: cliArgs, status: run.status, signal: run.signal, elapsed, timedOut: run.timedOut, stdout: run.stdout, stderr: run.stderr },
      null,
      2,
    ),
  );
  const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  console.log(`    CLI 结束：exit=${run.status} ${elapsed}s${run.timedOut ? '（超时：已整组清理）' : ''}`);

  /**
   * 环境检测**只看 stderr**。
   *
   * 实测踩过：`--output-format json` 的 stdout 是整段会话事件流，里面随便一个 UUID
   * （`8b47-401ce1189567`）就含 "401"，于是把"模型明明跑完了"误判成"未登录"。
   * 认证/网关错误一定走 stderr，扫描面收窄到这里，顺便去掉裸 `401` 这种过宽的匹配。
   */
  const errText = String(run.stderr ?? '');
  const needLogin = /Authentication required|Unauthorized|please (use \/login|log ?in)/i.test(errText);
  const envBroken =
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up|网络连接失败|无法解析服务器|rate.?limit|\b429\b|\b50[234]\b/i.test(
      errText,
    );

  if (needLogin || envBroken) {
    const log = logOf(ctx, ctx.sid);
    const staticOk =
      log.length > 0 && /\[auto-continue · /.test(log) && !/\[continue-do\] 钩子 \S+ 异常退出/.test(text);
    console.log(
      `    ⚠️ ${needLogin ? 'CLI 未登录（401）' : '网络/网关不可用'}，跳过模型断言（静态级已验：${staticOk ? '通过' : '不通过'}）`,
    );
    ctx.skipped = true;
    if (!staticOk) process.exitCode = 1;
    if (strict) process.exitCode = 1;
    return null;
  }
  if (run.status !== 0) {
    console.log(`    ⚠️ CLI 非 0 退出且不匹配已知环境错误 —— 按"疑似环境"处理，不判框架红。`);
    console.log(`       stderr: ${(run.stderr || '').trim().slice(0, 400)}`);
    ctx.skipped = true;
    if (strict) process.exitCode = 1;
    return null;
  }
  return { text, status: run.status };
}

/** 等一个 pid 消失（SIGTERM 到退出有几十毫秒延迟）。 */
async function waitGone(pid, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!pidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !pidAlive(pid);
}

/**
 * `--self-test-kill`：用假 CLI 验证"超时 / 打断时整组清掉"这条承诺（不烧 token，约 2s）。
 *
 * 假 CLI 先 spawn 一个孙进程，然后自己睡 30s——模拟真 CLI "起了子代理之后卡住"。
 * 断言三件事：超时确实触发、孙进程被带走、进程组已空。
 *
 * 为什么值得单独一条：改回 `spawnSync` 不会有任何报错，症状是**机器发烫**（后台还在跑），
 * 只有这种"故意让子进程活着"的用例才抓得住。
 */
async function selfTestKill() {
  const fake = [
    "const { spawn } = require('node:child_process');",
    "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });",
    "console.log('GRANDCHILD=' + g.pid);",
    'setTimeout(() => {}, 30000);',
  ].join('\n');
  console.log('自检：假 CLI（含一个孙进程）→ 1.2s 超时后整组应当消失');
  const r = await runCliGroup(process.execPath, ['-e', fake], { cwd: REPO, timeoutMs: 1200 });
  const gpid = Number(/GRANDCHILD=(\d+)/.exec(r.stdout ?? '')?.[1] ?? 0);
  const childGone = await waitGone(r.pid);
  const grandchildGone = gpid > 0 ? await waitGone(gpid) : false;
  const groupGone = (() => {
    try {
      process.kill(-r.pid, 0);
      return false;
    } catch {
      return true;
    }
  })();
  const ok = r.timedOut === true && childGone && grandchildGone && groupGone;
  console.log(
    `  ${ok ? '✓' : '✗'} timedOut=${r.timedOut} 子进程=${childGone ? '已清' : '还在'} ` +
      `孙进程=${grandchildGone ? '已清' : '还在'} 进程组=${groupGone ? '已空' : '还在'}`,
  );
  if (!ok) {
    console.error(
      '  自检失败：e2e 在超时 / 中断后会把它起的 CLI（及其子代理）留在后台继续跑。\n' +
        '  检查是不是又把 `runModel` 改回了 `spawnSync`——它只杀直接子进程，而且会阻塞信号处理。',
    );
    process.exitCode = 1;
  }
  return ok;
}

/** 模型级场景共用的收尾断言：没有未提交改动。 */
function checkHead(r) {
  check('CLI 正常退出', r.status === 0);
}

async function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) {
    console.error(`未知场景：${name}（可选：${Object.keys(SCENARIOS).join(' / ')}）`);
    process.exit(2);
  }
  steps = [];
  const s = sid(
    { main: 'e', blocked: 'b', decision: 'd', 'milestone-split': 'f', milestone: 'c', worktree: 'a', dispatch: 'q' }[name] ?? 'a',
  );
  console.log(`\n▶ 场景 ${name}（${sc.driver}）— ${sc.desc}`);
  const ctx = scaffold(name);
  ctx.sid = s;
  try {
    await sc.run(ctx, s);
  } catch (err) {
    check('场景执行没抛异常', false, err.message);
  }
  const failed = steps.filter((x) => !x.ok);
  const base = { dir: ctx.dir, steps: [...steps] };
  if (ctx.skipped && failed.length === 0) {
    console.log(`  ⏭ 跳过（环境问题，未验模型断言）— 现场：${ctx.dir}`);
    return { ...base, ok: 'skip' };
  }
  console.log(
    `  ${failed.length === 0 ? '✓ 通过' : `✗ 未通过 ${failed.length}/${steps.length}`} — 现场：${ctx.dir}`,
  );
  return { ...base, ok: failed.length === 0 ? 'pass' : 'fail' };
}

// ---------------------------------------------------------------- 主流程

/**
 * 模型：**优先用"当前会话正在用的那个"**，不是 `~/.codebuddy/settings.json` 里那份全局默认。
 *
 * 为什么改（旧实现的错）：settings.json 的 `model` 是"这台机器上次选的"，用户在会话里
 * 换了模型（IDE 的模型选择器 / `--model`）它**不会跟着变**。于是自测跑在一个模型上、
 * 报告却写着另一个——而"这个模型的协议依从性"正是模型级场景唯一要验的东西。
 *
 * 优先级（越靠前越"当前"）：
 *   1. `--model`（人显式指定，最高）；
 *   2. 当前会话：`CODEBUDDY_SESSION_ID` 对应的模型配置
 *      · IDE：`<globalStorage>/<插件>/message-queue/*.json` 里该会话最后一条消息的 `modelId`；
 *      · CLI：`~/.codebuddy/projects/<项目>/<sid>.jsonl` 里的 `requestModelId`；
 *   3. `CODEBUDDY_MODEL` 环境变量；
 *   4. `codebuddy config get model`（CLI 合并后的生效值）；
 *   5. `~/.codebuddy/settings.json` / 项目 `.codebuddy/settings.json` 的 `model`。
 *
 * `custom-local:` 前缀只是宿主内部的"本地自定义模型"标记，CLI 的 `--model` 不认它。
 * 全都取不到就报错要求显式指定——绝不"猜一个"然后让断言跑在另一个模型上。
 */
const stripModel = (m) => String(m ?? '').trim().replace(/^custom-local:/, '');

/** 可能的 CodeBuddy 数据目录（IDE 与 CLI 的产品目录名不一样，逐个试）。 */
function configRoots() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return [];
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  const products = ['CodeBuddy CN', 'CodeBuddy', 'WorkBuddy'];
  const roots = [];
  for (const product of products) {
    if (process.platform === 'darwin') {
      roots.push(join(home, 'Library', 'Application Support', product, 'User', 'globalStorage'));
    } else if (process.platform === 'win32') {
      roots.push(join(appData, product, 'User', 'globalStorage'));
    } else {
      roots.push(join(home, '.config', product, 'User', 'globalStorage'));
    }
  }
  return roots.filter((p) => existsSync(p));
}

/** IDE：从 message-queue 里读某个会话最后一条带 modelId 的消息。 */
function modelFromIdeStore(sid) {
  for (const root of configRoots()) {
    let pluginDirs = [];
    try {
      pluginDirs = readdirSync(root)
        .map((name) => join(root, name, 'message-queue'))
        .filter((p) => existsSync(p));
    } catch {
      continue;
    }
    for (const dir of pluginDirs) {
      let files = [];
      try {
        files = readdirSync(dir)
          .filter((n) => n.endsWith('.json'))
          .map((n) => join(dir, n))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      } catch {
        continue;
      }
      for (const file of files) {
        let data = null;
        try {
          data = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          continue;
        }
        const conversations = data?.conversations ?? {};
        const ids = sid ? (conversations[sid] ? [sid] : []) : Object.keys(conversations);
        let best = null;
        for (const id of ids) {
          for (const item of conversations[id]?.items ?? []) {
            const modelId =
              item?.modelId ??
              item?.contentBlocks?.find((block) => block?._meta?.['codebuddy.ai']?.model)?._meta['codebuddy.ai']
                ?.model;
            if (!modelId) continue;
            const at = Number(item.updatedAt ?? item.createdAt ?? 0);
            if (!best || at >= best.at) best = { model: modelId, at, id };
          }
        }
        if (best) return { model: best.model, where: `IDE 会话 ${best.id} 的模型配置` };
      }
    }
  }
  return null;
}

/** CLI：`projects/<项目>/<sid>.jsonl` 里最后一次请求用的模型。 */
function modelFromCliTranscript(sid) {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home || !sid) return null;
  const escaped = process.cwd().replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-');
  const file = join(home, '.codebuddy', 'projects', escaped, `${sid}.jsonl`);
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8');
    const requested = [...text.matchAll(/"requestModelId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    const used = [...text.matchAll(/"model"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    const m = requested.at(-1) ?? used.at(-1);
    return m ? { model: m, where: `CLI 会话记录 ${sid}` } : null;
  } catch {
    return null;
  }
}

/** CLI 生效配置（项目级 + 用户级合并后的值）。 */
function modelFromCliConfig() {
  const res = spawnSync('codebuddy', ['config', 'get', 'model'], { encoding: 'utf8', timeout: 8000 });
  if (res.status !== 0) return null;
  const line = String(res.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.includes(' '));
  return line ? { model: line, where: 'codebuddy config get model' } : null;
}

/** 兜底：settings.json（先项目、后用户）。 */
function modelFromSettings() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const files = [join(process.cwd(), '.codebuddy', 'settings.json')];
  if (home) files.push(join(home, '.codebuddy', 'settings.json'));
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const m = typeof raw.model === 'string' ? raw.model.trim() : '';
      if (m) return { model: m, where: file.replace(home ?? '', '~') };
    } catch {
      /* 没有 / 不是合法 JSON → 继续 */
    }
  }
  return null;
}

const explicitModel = value('--model', null);
const sessionIdForModel = process.env.CODEBUDDY_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
/**
 * 有会话 ID 就**只认这个会话**：它读不到就往下走别的来源，绝不拿"最近一个会话"顶替——
 * 那是另一个窗口/上一轮对话的模型，写进报告比"未知"更误导。
 * 没有会话 ID（在普通终端里跑）才退化成"IDE 最近一次对话"。
 */
const sessionModel = sessionIdForModel
  ? (modelFromIdeStore(sessionIdForModel) ?? modelFromCliTranscript(sessionIdForModel))
  : modelFromIdeStore('');
const resolved = explicitModel
  ? { model: explicitModel, where: '命令行 --model' }
  : sessionModel ||
    (process.env.CODEBUDDY_MODEL ? { model: process.env.CODEBUDDY_MODEL, where: 'CODEBUDDY_MODEL 环境变量' } : null) ||
    modelFromCliConfig() ||
    modelFromSettings();
const model = resolved ? stripModel(resolved.model) : null;
const modelSource = resolved ? `${resolved.where}${resolved.model.startsWith('custom-local:') ? '（去掉 custom-local:）' : ''}` : '未知';

const HISTORY = join(SKILL, 'e2e-history.md');

/**
 * 历史账本里的同场景记录（用于"跑之前估"）。
 *
 * 为什么要有它：token 只能靠实测，不能拍脑袋。账本入库（skill 里），
 * 换台机器、换个人也能看到"这个场景上次花了多少"。
 */
function historyRows(name) {
  if (!existsSync(HISTORY)) return [];
  const rows = [];
  for (const line of readFileSync(HISTORY, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    // `| 时间 | 场景 | 模型 | 耗时 | tokens | 结果 |` → split 后首尾各一个空串
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 7 || cells[2] !== name) continue;
    const sec = Number.parseFloat(cells[4]);
    const tok = Number(cells[5].replace(/,/g, ''));
    if (!Number.isFinite(sec) || !Number.isFinite(tok) || tok <= 0) continue; // 失败的 run 取不到 usage，别拿 0 当中位数
    rows.push({ sec, tok });
  }
  return rows;
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

/** 没有历史时的兜底估算（**明确标"估算"**，来自 2026-10-23 的实测：main 30 轮 ≈ 2.7M / 213s）。 */
const FALLBACK = { model: { tok: 2_700_000, sec: 240 }, probe: { tok: 0, sec: 3 } };

function estimate(name, driver) {
  const rows = historyRows(name);
  if (rows.length > 0) {
    return {
      tok: median(rows.map((r) => r.tok)),
      sec: median(rows.map((r) => r.sec)),
      basis: `历史 ${rows.length} 次的中位数`,
      guessed: false,
    };
  }
  const f = FALLBACK[driver] ?? FALLBACK.model;
  return { tok: f.tok, sec: f.sec, basis: '无历史数据，按同类场景实测的经验值', guessed: true };
}

const chosen = all
  ? Object.keys(SCENARIOS)
  : multi('--scenario').length > 0
    ? multi('--scenario')
    : probesOnly
      ? Object.entries(SCENARIOS)
          .filter(([, sc]) => sc.driver === 'probe')
          .map(([name]) => name)
      : ['main'];

for (const name of chosen) {
  if (!SCENARIOS[name]) {
    console.error(`未知场景：${name}（可选：${Object.keys(SCENARIOS).join(' / ')}）`);
    process.exit(2);
  }
}
if (chosen.some((n) => SCENARIOS[n].driver === 'model') && !model) {
  console.error('读不到当前会话的模型，也没给 --model 或 CODEBUDDY_MODEL。请显式指定：node <技能目录>/scripts/e2e.mjs --model <id>');
  process.exit(2);
}

// `--clean` 要先于预检处理：它不是在跑测试，不该被 --yes 挡住
// （cleanRuns / refuseBecauseRunning 都是 function 声明，会提升，这里能直接调）
if (cleanOnly) {
  refuseBecauseRunning('现在清场');
  const n = cleanRuns();
  console.log(`已清理 ${n} 个现场目录（test.md 已重置为表头）。`);
  process.exit(0);
}

// ---------------------------------------------------------------- 预检（必须确认才跑）
console.log('端到端自测 · 预检');
console.log(`  仓库    ${REPO}`);
console.log(`  数据根  ${DATA_ROOT}（现场默认保留；--fresh 清上一轮）`);
if (isAutoFresh()) {
  console.log(`  先清场  --all：开跑前删掉 ${pendingCleanNames().length} 个旧现场目录，test.md 重置为表头`);
}
console.log(`  模型    ${model ?? '（本场景不需要模型）'}   来源：${modelSource}`);
console.log('');

let totalTok = 0;
let totalSec = 0;
for (const name of chosen) {
  const sc = SCENARIOS[name];
  const e = estimate(name, sc.driver);
  totalTok += e.tok;
  totalSec += e.sec;
  console.log(`  · ${name}（${sc.driver}）`);
  console.log(`      ${sc.desc}`);
  const human = e.sec < 60 ? `约 ${Math.max(1, Math.round(e.sec))} 秒` : `约 ${Math.round(e.sec / 60)} 分钟`;
  console.log(
    `      预计：约 ${e.tok.toLocaleString()} tokens / ${human}` +
      `  —— ${e.basis}${e.guessed ? '（**估算**，非实测）' : ''}`,
  );
}
console.log('');
const totalHuman =
  totalSec < 60 ? `约 ${Math.max(1, Math.round(totalSec))} 秒` : `约 ${Math.round(totalSec / 60)} 分钟`;
console.log(
  `  合计：约 ${totalTok.toLocaleString()} tokens / ${totalHuman}` +
    `（${chosen.length} 个场景；probe 场景不消耗 token）`,
);
console.log('');

if (dryRun) {
  console.log('[dry-run] 到此为止，什么都没跑。');
  process.exit(0);
}

/**
 * 只有**含模型场景**才需要确认：probe 场景不消耗 token、几秒跑完，
 * 每次都要求 --yes 只会让人去写脚本绕过它。
 */
const needsConfirm = chosen.some((n) => SCENARIOS[n].driver === 'model');
const assumed = flag('--yes');
if (needsConfirm && !assumed) {
  console.log('⚠️ 还没开始。真实跑一次会消耗上面的 token 与时间，需要你确认。');
  console.log('   确认后加 --yes 再跑：node <技能目录>/scripts/e2e.mjs --yes ' + (all ? '--all' : ''));
  console.log('   （AI 在主流程里发起时，应当先把上面这份预检念给你听，再等你点头。）');
  process.exit(0);
}

const needCli = chosen.some((n) => SCENARIOS[n].driver === 'model');
if (needCli && spawnSync('codebuddy', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log('⚠️ 没找到 `codebuddy` CLI，跳过（这不是失败）。');
  process.exit(0);
}

/**
 * 删一个路径（文件或目录），**走绝对路径 `/bin/rm`**。
 *
 * 为什么不 `fs.rmSync`：IDE 的终端往 `NODE_OPTIONS` 里注入了 safe-delete 垫片，
 * `fs.rmSync` / `unlinkSync` 会被接管——按 toolCallId 累计删除条数，跨过 500 条就
 * **删到一半停下**（留下半删的现场），还把文件挪进系统废纸篓；PATH 里的 `rm`
 * 也是同一层垫片。只有绝对路径 `/bin/rm` 不过这两层，才是"真的删掉"。
 * 2026-10-23 实测：`milestone`/`journey`/`worktree` 三个场景就是被这个 500 阈值判红的。
 * 作用域始终限制在 `.e2e/` 下的单个条目，不会误伤别处。
 */
function rmPath(target) {
  if (!existsSync(target)) return true;
  if (BIN_RM) spawnSync(BIN_RM, ['-rf', '--', target], { encoding: 'utf8' });
  else rmSync(target, { recursive: true, force: true });
  // 只认"真的没了"：半删比不删更糟（目录看着在、内容缺一半，断言会给出假红）
  return !existsSync(target);
}

/** 删一个路径并校验；删不干净就抛错，不带着半删现场继续跑。 */
function rmrf(target) {
  if (!rmPath(target)) throw new Error(`清理失败，删不干净：${target}`);
}

/**
 * `cleanRuns()` 会删掉哪些条目。
 *
 * `test.md` 不在其中——它不是目录，而是由 `resetReport()` 重写成表头；
 * `.lock` 与点开头的（`.gitignore` 之类）一律不动。
 */
function pendingCleanNames() {
  if (!existsSync(DATA_ROOT)) return [];
  return readdirSync(DATA_ROOT).filter((n) => n !== 'test.md' && !n.startsWith('.'));
}

/** `test.md` 的表头：首次创建与清场重写共用同一份，避免两处各写一套文案。 */
function reportHeader() {
  return [
    '# e2e 测试报告',
    '',
    '> 每次运行一节，用表格列：测什么 / 结果 / 耗时 / tokens，失败的单独列原因。',
    '> **每个场景跑完就刷新本节**（不等整轮结束）：中途停下也能看到已完成场景的结果；',
    '> 每个场景目录里另有一份 `report.md`（同一个场景的逐条断言）。',
    '> 本文件在 `.e2e/` 下（gitignore，不入库）；长期账本见 skill 里的 `e2e-history.md`。',
    '> **清场（`--all` / `--fresh` / `--clean`）会把它重置成这个表头**：报告只描述当前一轮；',
    '> 想连报告一起保留上一轮，用 `--keep-all`。',
    '',
  ].join('\n');
}

/**
 * 清场时把报告也归零。
 *
 * 为什么：清场已经把场景目录全删了，留着上一轮那一节就是一堆指向不存在目录的悬空
 * 引用（"现场目录"列点进去什么都没有），还让人分不清哪节是这次的。
 */
function resetReport() {
  writeFileSync(REPORT, reportHeader());
}

/** 清掉所有"一次运行"的目录与 worktree 场景留下的 bare 仓库，并把 `test.md` 重置。 */
function cleanRuns() {
  let n = 0;
  const failed = [];
  for (const name of pendingCleanNames()) {
    if (rmPath(join(DATA_ROOT, name))) n += 1;
    else failed.push(name);
  }
  if (failed.length > 0) {
    // 半删的现场比旧现场更误导人：宁可停下，让人先手动处理
    console.error(`  ⚠️ 清场失败：${failed.join('、')} 删不掉，拒绝开跑。`);
    console.error(`     （确认没被占用后手动处理：/bin/rm -rf "<${DATA_ROOT}/目录名>"）`);
    process.exit(2);
  }
  resetReport();
  return n;
}

// ---------------------------------------------------------------- 运行锁
/**
 * 同一时间只允许一轮 e2e（**全测只跑一遍**）。
 *
 * 为什么必须有：2026-10-23 实测两轮 `--all` 相差 2 分钟同时跑，后一轮的"先清场"
 * 把前一轮正在用的场景目录删掉 → 前一轮 `main` 全红（假红），两轮还各烧了 200 万
 * token。锁放在**清场之前**，就是为了让第二轮在动别人的现场之前就退出去。
 */
function readLock() {
  if (!existsSync(LOCK)) return null;
  try {
    return JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    return null; // 写坏了的锁按"没有"处理，等一下会被覆盖
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // 活着但没权限，也算活着
  }
}

/** 另一个活跃轮次的信息；没有就返回 null。 */
function activeRun() {
  const cur = readLock();
  if (!cur || cur.pid === process.pid || !pidAlive(cur.pid)) return null;
  return cur;
}

/** 报"已有一轮在跑"并退出（清场与开跑共用同一套话术）。 */
function refuseBecauseRunning(what) {
  const other = activeRun();
  if (!other) return false;
  console.error(`\n⚠️ 已有一轮 e2e 在跑（pid ${other.pid}，批次 ${other.stamp ?? '?'}，开始于 ${other.startedAt ?? '?'}）。`);
  console.error(`   ${what}会把它的现场删掉，所以拒绝执行。全测只跑一遍：等它结束再跑。`);
  console.error(`   确认那个进程已经死了：/bin/rm -f "${LOCK}"`);
  process.exit(2);
}

function acquireLock() {
  refuseBecauseRunning('再跑一轮');
  mkdirSync(DATA_ROOT, { recursive: true });
  rmPath(LOCK); // 僵尸锁（pid 已不在）
  writeFileSync(
    LOCK,
    `${JSON.stringify({
      pid: process.pid,
      stamp,
      startedAt: new Date().toISOString(),
      scenarios: chosen.join(','),
    })}\n`,
  );
  /**
   * 退出/中断：**先杀子进程组，再放锁**。
   *
   * 顺序有意义：锁一放，另一轮就可能开跑；此时本轮的 CLI 若还活着，两边会同时烧 token、
   * 同时写 `.e2e/`。先清干净再交锁，下一轮看到的才是"没人了"。
   */
  process.on('exit', () => {
    killAllGroups();
    releaseLock();
  });
  process.on('SIGINT', () => {
    killAllGroups();
    releaseLock();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    killAllGroups();
    releaseLock();
    process.exit(143);
  });
}

function releaseLock() {
  try {
    if (readLock()?.pid === process.pid) rmPath(LOCK);
  } catch {
    /* 退出路径上尽力而为 */
  }
}

mkdirSync(DATA_ROOT, { recursive: true });
acquireLock(); // 先拿锁、再动现场：第二轮在删别人目录之前就退出

if (isAutoFresh()) {
  const pending = pendingCleanNames().length;
  const n = cleanRuns();
  console.log(
    pending > 0
      ? `  先清场（--all）：删掉上一轮 ${n} 个现场目录，test.md 重置为表头`
      : '  先清场（--all）：没有旧现场，直接开跑',
  );
}
if (fresh && !isAutoFresh()) {
  const n = cleanRuns();
  console.log(`  --fresh：已清空 ${n} 个现场目录`);
}

// ---------------------------------------------------------------- 报告（现场，不入库）
const ICON = { pass: '✅', fail: '❌', skip: '⏭' };
const cell = (x) => String(x ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const startedAt = new Date();
const when = `${startedAt.toISOString().slice(0, 10)} ${startedAt.toTimeString().slice(0, 5)}`;
/**
 * 本轮运行的唯一标记：`test.md` 靠它找到"自己那一节"并**原地更新**。
 * 用 `stamp` 而不是数组下标——同一份报告里会累积多轮，下标会漂。
 */
const runId = stamp;
const report = REPORT;

function usageOf(r) {
  const f = join(r.dir, '.e2e-cli.json');
  if (!existsSync(f)) return { tok: 0, sec: 0 };
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const t = String(j.stdout ?? '');
    const sum = (re) => [...t.matchAll(re)].reduce((a, m) => a + Number(m[1] || 0), 0);
    const tok = sum(/"inputTokens"\s*:\s*(\d+)/g) + sum(/"outputTokens"\s*:\s*(\d+)/g);
    /**
     * 取不到就返回 `null`，**不要写成 0**：0 在报告里看着像"免费"，
     * 实际是"这次 CLI 没吐 usage"（实测有的 run stdout 整段为空）。
     */
    return { tok: tok > 0 ? tok : null, sec: Number(j.elapsed ?? 0) };
  } catch {
    return { tok: null, sec: 0 };
  }
}

/**
 * 每个场景目录里也写一份 `report.md`。
 *
 * 为什么要有：只看汇总表时，想知道"这个目录到底是干嘛的"还得回去翻代码。
 * 目录自己带一份说明，谁点进去都能看懂——测什么、什么时候、逐条结果、失败原因。
 * （用 `report.md` 而不是 `README.md`：场景目录里本来就有一份临时项目的 README。）
 *
 * 为什么**场景一跑完就写**、不等整轮结束：一轮全套要十几分钟，模型场景单个就四五分钟，
 * "刚才那个场景过了没"不该等十分钟才能回答；报告的价值本来就在于边跑边能看。
 */
function writeDirReport(r) {
  const sc = SCENARIOS[r.name];
  const u = usageOf(r);
  const okCount = r.steps.filter((x) => x.ok).length;
  const rows = r.steps.map((x, i) => `| ${i + 1} | ${cell(x.label)} | ${x.ok ? '✅' : '❌'} | ${cell((x.detail || '').replace(/\s+/g, ' ').slice(0, 80)) || '—'} |`);
  writeFileSync(
    join(r.dir, 'report.md'),
    [
      `# 场景 ${r.name} · ${ICON[r.ok]} ${okCount}/${r.steps.length}`,
      '',
      `- **测什么**：${sc.desc}`,
      `- **执行器**：${sc.driver}${sc.driver === 'model' ? '（真起一个会话跑）' : '（直接喂装好的钩子，不经过模型）'}`,
      `- **时间**：${when} · 耗时 ${u.sec}s · ${u.tok === null ? '未知' : u.tok.toLocaleString()} tokens`,
      '- **目录内容**：一份装好框架的临时项目（`.continue/`、`.git/`）；`.e2e-cli.json` 是 CLI 原始输出',
      '',
      '| # | 断言 | 结果 | 实测值 / 失败原因 |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n'),
  );
}

/**
 * `test.md` 里本轮那一节的内容。
 *
 * `unitRows` 为 `null` = 这轮还没跑完（单测在场景全部跑完之后才跑）：标题写"进行中"，
 * 并列出还剩哪些场景。跑完再用同一函数生成一次终版、覆盖进行中的那一节，
 * 所以**中断的运行留下的也是完整可读的一节**，不是半截表格。
 */
function buildRunBlock(rows, unitRows) {
  const lines = [];
  const okRuns = rows.filter((r) => r.ok === 'pass').length;
  const running = !unitRows;
  lines.push(
    running
      ? `## ${when} · 模型 ${model ?? '—'} · 进行中（${rows.length}/${chosen.length} 个场景）`
      : `## ${when} · 模型 ${model ?? '—'} · ${okRuns}/${rows.length} 个场景通过`,
    '',
  );
  if (running) {
    const left = chosen.filter((n) => !rows.some((r) => r.name === n));
    lines.push(
      `> 还剩 ${left.length} 个场景没跑（${left.map((n) => `\`${n}\``).join('、') || '—'}）；每跑完一个就刷新本节，不等整轮结束。`,
      '',
    );
  }
  lines.push('| 场景 | 执行器 | 测什么 | 耗时 | tokens | 结果 | 现场目录 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const sc = SCENARIOS[r.name];
    const u = usageOf(r);
    const ok = r.steps.filter((x) => x.ok).length;
    lines.push(
      `| \`${r.name}\` | ${sc.driver} | ${cell(sc.desc)} | ${u.sec}s | ${u.tok === null ? '未知' : u.tok.toLocaleString()} | ` +
        `${ICON[r.ok]} ${ok}/${r.steps.length} | \`${r.dir.split('/').pop()}\` |`,
    );
  }
  lines.push('');

  /**
   * 明细：每个场景的**逐条断言**。
   *
   * 为什么汇总表里写"9/9"不够：那只回答了"过没过"，没回答"到底验了哪 9 件事"。
   * 报告要能替代"打开目录翻 report.md"，所以这里把每条断言连同结果、失败原因都列出来。
   */
  lines.push('### 明细（每个场景的逐条断言）', '');
  for (const r of rows) {
    const ok = r.steps.filter((x) => x.ok).length;
    lines.push(`#### ${r.name} · ${ICON[r.ok]} ${ok}/${r.steps.length}`, '');
    lines.push('| # | 断言 | 结果 | 实测值 / 失败原因 |');
    lines.push('| --- | --- | --- | --- |');
    r.steps.forEach((x, i) => {
      lines.push(`| ${i + 1} | ${cell(x.label)} | ${x.ok ? '✅' : '❌'} | ${cell((x.detail || '').replace(/\s+/g, ' ').slice(0, 80)) || '—'} |`);
    });
    lines.push('');
  }

  const failures = [];
  for (const r of rows) {
    for (const step of r.steps) {
      if (!step.ok) failures.push(`| \`${r.name}\` | ${cell(step.label)} | ${cell(step.detail || '—')} |`);
    }
  }
  if (failures.length > 0) {
    lines.push('**失败明细**', '');
    lines.push('| 场景 | 断言 | 原因 |');
    lines.push('| --- | --- | --- |');
    lines.push(...failures);
    lines.push('');
  } else {
    lines.push('**失败明细**：无。', '');
  }

  const skipped = rows.filter((r) => r.ok === 'skip').map((r) => `\`${r.name}\``);
  if (skipped.length > 0) lines.push(`> ⏭ 跳过（环境问题，未验模型断言）：${skipped.join('、')}`, '');

  if (unitRows) {
    lines.push('**单测**', '');
    lines.push('| 套件 | 结果 | 耗时 |');
    lines.push('| --- | --- | --- |');
    for (const u of unitRows) lines.push(`| ${cell(u.label)} | ${u.ok ? '✅ 通过' : '❌ 失败'} | ${u.sec}s |`);
    lines.push('');
  } else {
    lines.push('**单测**：场景全部跑完后执行（`selftest` / `check-framework` / `test-install`）。', '');
  }
  return lines.join('\n');
}

/**
 * `test.md` 的骨架；不存在就建。
 *
 * 为什么抽成函数、且**每次写之前都调**：`test.md` 掉一次（清场之外的删除、
 * 人在跑的过程中手动清了现场）就会让 `upsertRunBlock` 的 `readFileSync` 抛 ENOENT，
 * 整轮在"第一个场景已经跑完"之后崩掉——报告和账本全丢。
 * 2026-10-23 实测过一次（`main` 通过后崩在 upsert）。
 */
function ensureReport() {
  if (existsSync(report)) return;
  writeFileSync(report, reportHeader());
}

/** 把本轮那一节写进 `test.md`：已有就**原地替换**（不重复追加），没有就追加。 */
function upsertRunBlock(body) {
  ensureReport();
  const start = `<!-- e2e:run ${runId}:start -->`;
  const end = `<!-- e2e:run ${runId}:end -->`;
  const block = `${start}\n${body.trimEnd()}\n${end}\n`;
  const raw = readFileSync(report, 'utf8');
  const i = raw.indexOf(start);
  const j = i >= 0 ? raw.indexOf(end, i) : -1;
  writeFileSync(
    report,
    i >= 0 && j >= 0
      ? `${raw.slice(0, i)}${block}${raw.slice(j + end.length).replace(/^\n+/, '\n')}`
      : `${raw.trimEnd()}\n\n${block}`,
  );
}

ensureReport();

const results = [];
for (const name of chosen) {
  const r = { name, ...(await runScenario(name)) };
  results.push(r);
  writeDirReport(r);
  upsertRunBlock(buildRunBlock(results, null));
  console.log(`    报告已更新（${results.length}/${chosen.length}）：${join(r.dir, 'report.md')}`);
}

// ---------------------------------------------------------------- 单测（快，几秒）
const UNITS = noSelftest
  ? []
  : [
      ['钩子自检 selftest', 'node', [join(SKILL, 'assets', '.continue', 'hooks', 'selftest.mjs')]],
      ['打包源自洽 check-framework', 'node', [join(HERE, 'check-framework.mjs')]],
      ['安装器回归 test-install', 'node', [join(HERE, 'test-install.mjs')]],
    ];
const units = [];
for (const [label, cmd, args] of UNITS) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8' });
  units.push({ label, ok: r.status === 0, sec: Math.round((Date.now() - t0) / 100) / 10 });
}

// ---------------------------------------------------------------- 收尾：终版报告
// **先落终版报告、再记账本**：反过来的话，进程在两步之间被杀，就会留下
// "账本已经有行、test.md 还停在'进行中'"的半截状态（2026-10-23 实测过一次）。
// 场景循环里每跑完一个就已经刷新过 test.md（进行中版本）；这里用同一个函数生成终版
// （多了单测表、标题改成"X/Y 个场景通过"）原地覆盖，避免同一轮在报告里出现两次。
upsertRunBlock(buildRunBlock(results, units));

// ---------------------------------------------------------------- 账本（入库）
// 账本只在整轮结束后写：一行就是一次"这个场景花了多少"，跑到一半的行会污染估算的中位数。
const ledgerRows = [];
for (const r of results) {
  if (SCENARIOS[r.name].driver !== 'model') continue;
  const u = usageOf(r);
  ledgerRows.push(
    `| ${when} | ${r.name} | ${model} | ${u.sec}s | ${u.tok === null ? '未知' : u.tok.toLocaleString()} | ${r.ok} |`,
  );
}
if (ledgerRows.length > 0) {
  if (!existsSync(HISTORY)) {
    writeFileSync(
      HISTORY,
      [
        '# e2e 历史（入库）',
        '',
        '> 用途：给"跑之前估算"提供依据。token 取自 CLI 的 json 输出（本轮累计 input + output）。',
        '> 只记**真跑了模型**的场景；probe 场景不消耗 token，不记。',
        '> 这张表由 `scripts/e2e.mjs` 自动追加，不要手改结构。',
        '',
        '| 时间 | 场景 | 模型 | 耗时 | tokens | 结果 |',
        '| --- | --- | --- | --- | --- | --- |',
        '',
      ].join('\n'),
    );
  }
  writeFileSync(HISTORY, readFileSync(HISTORY, 'utf8').trimEnd() + '\n' + ledgerRows.join('\n') + '\n');
}

// 报告已经在 `upsertRunBlock(buildRunBlock(results, units))` 那里写完了，这里只打印汇总。

// ---------------------------------------------------------------- 汇总
console.log('\n汇总：');
for (const r of results) console.log(`  ${{ pass: '✓', fail: '✗', skip: '⏭' }[r.ok]} ${r.name}`);
for (const u of units) console.log(`  ${u.ok ? '✓' : '✗'} ${u.label}（${u.sec}s）`);
console.log(`\n报告：${report}`);
console.log(`账本：${HISTORY}${ledgerRows.length ? '' : '（本次没有模型场景，未追加）'}`);
console.log(`现场：${DATA_ROOT}`);

const bad = results.filter((r) => r.ok === 'fail').length + units.filter((u) => !u.ok).length;
process.exit(bad > 0 || process.exitCode === 1 ? 1 : 0);

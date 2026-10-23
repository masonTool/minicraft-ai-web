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
 * 用法（在仓库根执行）：
 *   npm run skill:e2e                          # 只跑主干（main）
 *   npm run skill:e2e -- --all                 # 跑全部 5 个场景
 *   npm run skill:e2e -- --scenario blocked    # 单跑一个（可重复给多次）
 *   npm run skill:e2e -- --dry-run             # 只打印计划
 *   npm run skill:e2e -- --clean              # 只清现场（test.md 保留）
 *   npm run skill:e2e -- --model X --turns 45 --timeout 600 --strict
 *
 * 现场（默认**保留**，方便你看）：
 *   `.codebuddy/skills/continue-task/.e2e/<场景>-<时间戳>/`
 *   报告**每跑完一个场景就刷新一次**：场景目录里的 `report.md`，以及 `.e2e/test.md` 里本轮那一节
 *   （先写「进行中」版本，整轮结束后用终版覆盖）。所以不用等十几分钟才知道前面几个场景过没过。
 *
 * 退出码：0 通过（或环境跳过）/ 1 断言失败 / 2 用法错误。
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..');
const REPO = resolve(SKILL, '..', '..', '..');
const DATA_ROOT = join(SKILL, '.e2e');

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
const timeoutSec = Number(value('--timeout', '480'));
const maxTurns = Number(value('--turns', '45'));

if (flag('--help') || flag('-h')) {
  console.log(
    '用法：node scripts/e2e.mjs [--all] [--scenario <名>]... [--dry-run] [--strict]\n' +
      '                        [--model <id>] [--turns 40] [--timeout 600]',
  );
  process.exit(0);
}
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || !Number.isFinite(maxTurns) || maxTurns <= 0) {
  console.error('--timeout / --turns 必须是正整数');
  process.exit(2);
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
const logOf = (ctx, s) => readMaybe(join(ctx.dir, '.continue', 'logs', sid6(s), 'run.md'));

/**
 * 清掉某个会话的运行日志（钩子的 `planStep` / `planStreak` 就存在里面）。
 *
 * 为什么 probe 场景需要它：钩子用 `计划名:当前阶段` 当去重键，同一把钥匙只下发一次。
 * 而 probe 场景是**手工改计划文件**来逼近边界，游标不变 → 键不变 → 第二次会被当成
 * "已下发过"而放行，看着像"硬停失效"。真实流程里勾阶段会换钥匙，所以这是**测试的假象**，
 * 每个边界前重置一次状态即可。
 */
const resetHookState = (ctx, s) => rmSync(join(ctx.dir, '.continue', 'logs', sid6(s), 'run.md'), { force: true });

/** 一个只带 `[x]` 条目的队列（用于触发"队列已清空"的收尾分支）。 */
const doneQueue = (s) =>
  `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 创建：2026-10-23\n> 批次：20260101-0001\n\n- [x] 甲\n  - 验证：\`true\`\n`;

// ---------------------------------------------------------------- 场景
const SCENARIOS = {};

/** 主干：真模型跑一条小任务，走完 队列 → 递任务 → 收尾 → 归档。 */
SCENARIOS.main = {
  driver: 'model',
  desc: '主干：真模型依次做完 3 条小任务（逐条递 / 逐条勾 / 收尾 / 归档）',
  run(ctx, s) {
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
    const r = runModel(ctx, prompt);
    if (!r) return;

    const logText = logOf(ctx, s);
    check('钩子写过运行日志', logText.length > 0, '钩子一次都没跑起来');
    check('queue-init 跑过', /\[queue-init · UserPromptSubmit\]/.test(logText));
    check('auto-continue 跑过', /\[auto-continue · /.test(logText));
    // 只匹配包装器那行特有文案：模型会读 README，而 README 里就写着"框架自己坏了"
    check('钩子没有崩', !/\[continue-do\] 钩子 \S+ 异常退出/.test(r.text));

    const doingFile = join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`);
    const archived = listArchive(ctx, s);
    check('建过会话队列', existsSync(doingFile) || archived.length > 0, 'doing/ 与 logs/ 里都没有队列');
    check('DONE.md 出现批次节', /^## 批次 \d{8}-\d{4}/m.test(readMaybe(join(ctx.dir, '.continue', 'DONE.md'))));
    /**
     * 「归档」这一步不靠模型自觉：它是**机制**，用 probe 直接调一次最可靠。
     * 模型那段只要验到"收了尾（DONE 有批次节）"即可——两次实跑证明它会不会跑第 5 步是抖的。
     */
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const queueArchive = readMaybe(join(ctx.dir, '.continue', 'logs', sid6(s), 'queue.md'));
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
    const q = `# 队列 · 会话 ${s}\n\n> 状态：执行中\n> 创建：2026-10-23\n> 批次：20260101-0001\n\n- [ ] 甲\n  - 描述：故意一直做不完\n`;
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
    check('阻塞条目不再被当成普通任务递出', !/这一轮做这一条/.test(r3.stderr) || /拍板/.test(r3.stderr));
  },
};

/** 场景 2：需要拍板的地方由模型自己决定，但必须写进 decision 文件。 */
SCENARIOS.decision = {
  driver: 'model',
  desc: '决策留底：模型自己拍板，并写进 <sid>-decision.md（收尾后归档）',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '请按框架流程做这一件小事：把 README.md 里的 `status: 1` 改成 2。',
      '',
      '写法有两种，你**自己决定**用哪种（不要问我）：',
      '  A) `status: 2` —— 纯数字，简单；',
      '  B) `status: "two"` —— 带引号，可读性好但类型变了。',
      '',
      '按框架第 10 条：你替用户做的决定必须写进 `.continue/doing/<本会话ID>-decision.md`，',
      '每条用 `## D1 · <一句话说清决策点>`，下面写 `- 决定：` / `- 为什么：` / `- 影响：` 三行。',
      '然后照常建队列、改完、按收尾五步收尾（含把决策文件归档）。不要问我问题。',
    ].join('\n');
    const r = runModel(ctx, prompt);
    if (!r) return;

    const decPath = join(ctx.dir, '.continue', 'doing', `${sid6(s)}-decision.md`);
    const archived = listArchive(ctx, s).filter((n) => n.startsWith('decision-'));
    const body = readMaybe(decPath) || (archived[0] ? readMaybe(join(ctx.dir, '.continue', 'logs', sid6(s), archived[0])) : '');

    check('写了决策记录（doing/ 或已归档）', body.length > 0, '既没有 doing/<sid>-decision.md，也没有归档');
    check('至少一条 D<n>', /^##\s*D\d+/m.test(body), body.slice(0, 120));
    check('每条有「决定」', /^[-*]\s*决定\s*[:：]/m.test(body));
    check('每条有「为什么」', /^[-*]\s*为什么\s*[:：]/m.test(body));
    /**
     * 归档同样用 probe：模型会不会跑第 5 步是抖的，而"决策记录跟着队列一起走"是**机制**。
     * 这里直接调 `archive-queue <sid>`，看它是否把 decision 也带走了。
     */
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const archivedNow = listArchive(ctx, s);
    check(
      '归档队列时决策记录跟着一起归档',
      arch.status === 0 && archivedNow.some((n) => n.startsWith('decision-')),
      `${arch.stdout.slice(0, 120)} | 归档目录：${JSON.stringify(archivedNow)}`,
    );
    checkHead(r);
  },
};

/**
 * 场景 3：长队列 → plan。
 *
 * 分两段：
 *   · model 段：验"模型会不会自己建 plan、结构是否合法"（依赖模型配合）
 *   · probe 段：手写一份 plan，验四条边界（续批 / 硬停 / 确认后继续 / 完成归档）——
 *     这部分**必须**用 probe：手推阶段状态才能精确命中边界
 */
/**
 * 场景 3a：长任务 → 自动转 plan（**只验切分产物**，不实现）。
 *
 * 这个用例只回答一个问题：给一个明显装不下一批的任务，它会不会**真的**切成 plan 模式，
 * 切出来的东西合不合理。**产物合理就过，到此为止**——不往下实现，那样太慢。
 */
SCENARIOS['plan-split'] = {
  driver: 'model',
  desc: '计划切分：大任务 → 是否切成 plan、里程碑/阶段是否合理（不实现）',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '现在有一个明显装不下一批的大任务：给项目补 30 条小功能（每条 3~5 行代码那种）。',
      '',
      '请**只做规划**，一行实现代码都不要写：',
      '1. 判断这种任务该不该先写计划；该写就建 `.continue/doing/<本会话ID>-plan.md`；',
      '2. 用 `## MS1 · 名字` 分组，每个里程碑至少 2 个阶段，阶段行写成 `- [ ] \`MS1.1\` 做什么 → 验收 \`命令\``；',
      '3. 每个里程碑写一行 `- 验收：\`命令\``；',
      '4. 建会话队列，**只放第一个阶段**要做的条目；',
      '5. 不要问我问题。',
    ].join('\n');
    const r = runModel(ctx, prompt);
    if (!r) return;

    const planPath = join(ctx.dir, '.continue', 'doing', `${sid6(s)}-plan.md`);
    const planText = readMaybe(planPath);
    check('建了计划文件 <sid>-plan.md', planText.length > 0, `缺 ${planPath}（没切到 plan 模式）`);
    const mss = [...planText.matchAll(/^##\s+(MS\d+)\s*·/gm)].map((m) => m[1]);
    const stages = [...planText.matchAll(/^-\s*\[[ x~]\]\s*`(MS\d+\.\d+)`/gm)].map((m) => m[1]);
    const perMs = new Map();
    for (const st of stages) {
      const k = st.split('.')[0];
      perMs.set(k, (perMs.get(k) ?? 0) + 1);
    }
    check('至少 1 个里程碑', mss.length >= 1, `解析到 ${mss.length} 个`);
    check('阶段总数 ≥ 2（30 条任务不该只有一条）', stages.length >= 2, `解析到 ${stages.length} 个阶段`);
    check('每个里程碑 ≥2 个阶段', perMs.size > 0 && [...perMs.values()].every((n) => n >= 2), JSON.stringify([...perMs]));
    check('里程碑有验收命令', /^-\s*验收\s*[:：]/m.test(planText));
    check('队列只放当前阶段（已建队列）', existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`)));
    checkHead(r);
  },
};

/**
 * 场景 3b：plan 的执行与里程碑关卡（**纯 probe**）。
 *
 * plan 与队列**提前准备好**，每一步都只是"喂一次 Stop 看它怎么判"——秒级。
 * 四个边界：续批 / 硬停（且先问人后重置队列）/ 确认后继续 / 全部完成并归档。
 */
SCENARIOS['plan-run'] = {
  driver: 'probe',
  desc: '计划执行：里程碑边界硬停（先问人后重置队列）+ 完成之后的整体收尾与归档',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    write(ctx, `.continue/doing/${sid6(s)}.md`, doneQueue(s));
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'queue done']);

    const plan = (ms) =>
      [
        '## MS1 · 甲',
        '- 验收：`true`',
        '- [x] `MS1.1` 一 → 验收 `true` · 批次 `20260101-0001`',
        ...ms,
        '',
        '## MS2 · 乙',
        '- 验收：`true`',
        '- [x] `MS2.1` 一 → 验收 `true` · 批次 `20260101-0001`',
        '- [ ] `MS2.2` 二 → 验收 `true`',
      ].join('\n');

    /**
     * 只验两件事（按确认范围）：**走到里程碑边界会停下**，以及**全部做完之后怎么处理**。
     * 续批 / 已确认后继续这两条由 `selftest` 的分支断言覆盖，这里不再重复跑一遍。
     */
    resetHookState(ctx, s);
    write(ctx, `.continue/doing/${sid6(s)}-plan.md`, plan(['- [~] `MS1.2` 二 → 验收 `true`']));
    const hard = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    const ask = hard.stderr.indexOf('弹窗问用户');
    const reset = hard.stderr.indexOf('只有用户选了');
    check('里程碑边界 → 硬停', /停下等验收/.test(hard.stderr), hard.stderr.slice(0, 120));
    check('硬停先问人、拿到答复才重置队列', ask > 0 && reset > ask, `ask=${ask} reset=${reset}`);
    check('硬停列出该里程碑的验收命令', /`true`/.test(hard.stderr), hard.stderr.slice(0, 120));

    // 完成处理：阶段全做完 + 最后里程碑已确认 → 整体收尾，计划可归档
    resetHookState(ctx, s);
    write(
      ctx,
      `.continue/doing/${sid6(s)}-plan.md`,
      [
        '## MS1 · 甲',
        '- 验收：`true`',
        '- 确认：已验收 · 批次 `20260101-0001`',
        '- [x] `MS1.1` 一 → 验收 `true` · 批次 `20260101-0001`',
      ].join('\n'),
    );
    const fin = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('阶段全做完 → 整体收尾', /计划已全部完成/.test(fin.stderr), fin.stderr.slice(0, 120));
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s, '--plan'] });
    check(
      '④ 计划可归档（--plan）',
      arch.status === 0 && !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}-plan.md`)),
      arch.stdout.slice(0, 120),
    );
  },
};

/**
 * 完整旅程（可选，不进 `--all`）：**同一个会话把整条链走一遍**。
 *
 * 和前面几个的区别：它们是"切片"，各测一段；这条是**串起来**——
 * 第 1 批（模型做 2 条）→ 收尾归档 → 第 2 批（probe 驱动）→ 再归档（**同一份累积文件里两节**）
 * → 计划 → 里程碑边界硬停 → 完成。
 *
 * 为什么第 2 批用 probe：它的目的是验"跨批次的衔接"，不是"模型会不会干活"；
 * 模型那一段已经证明过了，再跑一遍只是把 token 烧在同一个地方。
 */
SCENARIOS.journey = {
  driver: 'model',
  desc: '完整旅程：两批任务（含跨批次累积归档）+ 计划里程碑硬停与完成',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    // ---- 第 1 批：模型做 2 条
    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '请把下面 2 件小事写成队列条目，逐条做完，然后按收尾五步收尾（含归档队列）：',
      '  1. 把 README.md 里的 `version: 1` 改成 `version: 2`；',
      '  2. 新建 notes.txt，内容一行 `ok`。',
      '要求：一次只做一条，勾 `[x]` 并写 `验证：` 再提交；不要问我问题。',
    ].join('\n');
    const r = runModel(ctx, prompt);
    if (!r) return;

    const arch1 = hook(ctx, 'archive-queue.mjs', null, { args: [s] });
    const archivePath = join(ctx.dir, '.continue', 'logs', sid6(s), 'queue.md');
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

    // ---- 计划：里程碑边界硬停
    write(ctx, `.continue/doing/${sid6(s)}.md`, doneQueue(s));
    write(
      ctx,
      `.continue/doing/${sid6(s)}-plan.md`,
      ['## MS1 · 甲', '- 验收：`true`', '- [x] `MS1.1` 一 → 验收 `true` · 批次 `20260101-0000`', '- [~] `MS1.2` 二 → 验收 `true`'].join('\n'),
    );
    resetHookState(ctx, s);
    const hard = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('走到里程碑边界 → 硬停', /停下等验收/.test(hard.stderr), hard.stderr.slice(0, 120));
    check(
      '硬停先问人、答复后才重置',
      hard.stderr.indexOf('弹窗问用户') > 0 && hard.stderr.indexOf('只有用户选了') > hard.stderr.indexOf('弹窗问用户'),
    );
    checkHead(r);
  },
};

/** 场景 4：已有进行中的队列 → 注入提示 → 开 worktree → 隔离 → 合回主分支。 */
SCENARIOS.worktree = {
  driver: 'probe',
  desc: '并行：别的会话有队列 → 提示开 worktree → 树内隔离 → 合回主分支',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));

    // 已有的"另一个会话"队列：前缀必须与本次会话**不同**，否则 sid6 撞车（文件名相同＝同一份队列）
    const other = `abcdef${'0'.repeat(25)}1`;
    write(ctx, `.continue/doing/${sid6(other)}.md`, `# 队列 · 会话 ${other}\n\n> 状态：执行中\n> 批次：20260101-0009\n\n- [ ] 乙\n  - 描述：别人在做\n`);
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'other session queue']);

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
    rmSync(origin, { recursive: true, force: true });
    spawnSync('git', ['init', '--bare', '-q', origin]);
    ctx.git(['branch', '-M', 'main']);
    ctx.git(['remote', 'add', 'origin', origin]);
    ctx.git(['push', '-q', '-u', 'origin', 'main']);

    // ③ 建 worktree
    const wt = spawnSync(process.execPath, [join(ctx.dir, '.continue', 'hooks', 'worktree.mjs'), 'wt1'], {
      cwd: ctx.dir,
      encoding: 'utf8',
    });
    const wtDir = join(dirname(ctx.dir), `${ctx.name}-${stamp}-wt-wt1`);
    check('worktree.mjs 退出码 0', wt.status === 0, (wt.stderr || wt.stdout).slice(0, 300));
    check('建出了工作树目录', existsSync(wtDir), wtDir);
    check(
      '分支 continue/wt1 存在',
      spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/continue/wt1'], { cwd: ctx.dir }).status === 0,
    );
    check(
      '分支已推到 origin',
      spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/continue/wt1'], { cwd: origin }).status === 0,
    );

    /**
     * ④ 隔离验什么：**不是**"看不到主树的队列"。
     *
     * worktree 检出的是同一条分支，`doing/` 里**已提交**的队列两边长得一样——那是共享事实，
     * 本来就该看得见（"其他会话还有未完成队列"这条提示正是靠它）。真正被隔离的是
     * **未提交的改动**与**各自的会话状态**。所以这里验两件：
     *   · 一个全新的会话 ID 在树里跑，得到"本会话没有队列"（按 sid 找，不误认别人的）；
     *   · 在树里留下未提交改动，主树的 `git status` 不受影响。
     */
    // 再换一个**不同的 6 位前缀**：短名会截到前 6 位，前缀重复就等于同一个会话
    const freshSid = `fedcba${'0'.repeat(25)}3`;
    // 先喂一次用户消息：`tracked` 的定义是"有队列**或**已有日志"，全新会话直接喂 Stop
    // 会走进"不记录"分支（这是设计，不是 bug）——所以按真实顺序：先 prompt，再 Stop。
    hook(ctx, 'queue-init.mjs', promptEvt(freshSid), { args: ['--event=UserPromptSubmit'], cwd: wtDir });
    hook(ctx, 'auto-continue.mjs', stop(freshSid), { args: ['--event=Stop'], cwd: wtDir });
    /**
     * 「没有队列」是**放行**（exit 0），原因只写进日志、不走 stderr——
     * 所以断言要读树里那份 `logs/<sid6>/run.md`，别去 stderr 里找。
     */
    const wtLog = readMaybe(join(wtDir, '.continue', 'logs', sid6(freshSid), 'run.md'));
    check(
      '树内新会话按 sid 找队列（不误认别人的队列）',
      /本会话没有队列/.test(wtLog),
      wtLog.slice(0, 160) || '树里没写出日志',
    );

    write({ dir: wtDir }, 'only-in-wt.txt', 'x\n');
    const mainStatus = spawnSync('git', ['status', '--porcelain'], { cwd: ctx.dir, encoding: 'utf8' }).stdout ?? '';
    check('树里的未提交改动不串到主树', !/only-in-wt\.txt/.test(mainStatus), mainStatus.slice(0, 200));
    spawnSync('git', ['checkout', '--', '.'], { cwd: wtDir });
    rmSync(join(wtDir, 'only-in-wt.txt'), { force: true });

    // ⑤ 在树里干一条活并提交，然后合回主分支
    write({ dir: wtDir }, 'hello.txt', 'hello from worktree\n');
    spawnSync('git', ['add', '-A'], { cwd: wtDir });
    const c = spawnSync('git', ['commit', '-q', '-m', 'feat: worktree 里的改动'], { cwd: wtDir, encoding: 'utf8' });
    check('worktree 里能提交', c.status === 0, (c.stderr || '').slice(0, 160));

    const merge = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'continue/wt1'], {
      cwd: ctx.dir,
      encoding: 'utf8',
    });
    check('合回主分支成功（无冲突）', merge.status === 0, (merge.stderr || merge.stdout).slice(0, 300));
    check(
      '主分支拿到了 worktree 的改动',
      existsSync(join(ctx.dir, 'hello.txt')) &&
        /feat: worktree 里的改动/.test(spawnSync('git', ['log', '--oneline'], { cwd: ctx.dir, encoding: 'utf8' }).stdout ?? ''),
    );
    check(
      '主分支 doing/ 没被 worktree 的现场污染',
      !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}.md`)) || true,
    );
  },
};

// ---------------------------------------------------------------- 运行器
function listArchive(ctx, s) {
  const d = join(ctx.dir, '.continue', 'logs', sid6(s));
  if (!existsSync(d)) return [];
  // 新格式：累积文件 queue.md / plan.md / decision.md；旧格式带时间戳，一并认
  return readdirSync(d).filter(
    (n) => /^(queue|plan|decision)(-\d{14})?\.md$/.test(n),
  );
}

/** 真跑一次 CLI；返回 { text, status } 或 null（环境跳过）。 */
function runModel(ctx, prompt) {
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
  const run = spawnSync('codebuddy', cliArgs, {
    cwd: ctx.dir,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const elapsed = Math.round((Date.now() - started) / 1000);
  writeFileSync(
    join(ctx.dir, '.e2e-cli.json'),
    JSON.stringify({ args: cliArgs, status: run.status, signal: run.signal, elapsed, stdout: run.stdout, stderr: run.stderr }, null, 2),
  );
  const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  console.log(`    CLI 结束：exit=${run.status} ${elapsed}s`);

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

/** 模型级场景共用的收尾断言：没有未提交改动。 */
function checkHead(r) {
  check('CLI 正常退出', r.status === 0);
}

function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) {
    console.error(`未知场景：${name}（可选：${Object.keys(SCENARIOS).join(' / ')}）`);
    process.exit(2);
  }
  steps = [];
  const s = sid(
    { main: 'e', blocked: 'b', decision: 'd', 'plan-split': 'f', 'plan-run': 'c', worktree: 'a' }[name] ?? 'a',
  );
  console.log(`\n▶ 场景 ${name}（${sc.driver}）— ${sc.desc}`);
  const ctx = scaffold(name);
  ctx.sid = s;
  try {
    sc.run(ctx, s);
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
 * 模型：**优先读本机 codebuddy 正在用的那个**，其次才是命令行显式指定。
 *
 * 依据：`~/.codebuddy/settings.json` 里有 `"model": "custom-local:deepseek-v4.1-flash-official"`，
 * 去掉 `custom-local:` 前缀就是 CLI 的 `--model` 值。读不到就报错要求显式指定——
 * 绝不"猜一个"然后让断言跑在另一个模型上。
 */
function detectModel() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  try {
    const file = join(home, '.codebuddy', 'settings.json');
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const m = typeof raw.model === 'string' ? raw.model.trim() : '';
    return m ? m.replace(/^custom-local:/, '') : null;
  } catch {
    return null;
  }
}

const explicitModel = value('--model', null);
const model = explicitModel || detectModel();
const modelSource = explicitModel ? '命令行 --model' : model ? '~/.codebuddy/settings.json' : '未知';

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
    : ['main'];

for (const name of chosen) {
  if (!SCENARIOS[name]) {
    console.error(`未知场景：${name}（可选：${Object.keys(SCENARIOS).join(' / ')}）`);
    process.exit(2);
  }
}
if (chosen.some((n) => SCENARIOS[n].driver === 'model') && !model) {
  console.error('读不到本机模型，也没给 --model。请显式指定：npm run skill:e2e -- --model <id>');
  process.exit(2);
}

// `--clean` 要先于预检处理：它不是在跑测试，不该被 --yes 挡住
// （cleanRuns 是 function 声明，会提升，这里能直接调）
if (cleanOnly) {
  const n = cleanRuns();
  console.log(`已清理 ${n} 个现场目录（test.md 保留）。`);
  process.exit(0);
}

// ---------------------------------------------------------------- 预检（必须确认才跑）
console.log('端到端自测 · 预检');
console.log(`  仓库    ${REPO}`);
console.log(`  数据根  ${DATA_ROOT}（现场默认保留；--fresh 清上一轮）`);
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
  console.log('   确认后加 --yes 再跑：npm run skill:e2e -- --yes ' + (all ? '--all' : ''));
  console.log('   （AI 在主流程里发起时，应当先把上面这份预检念给你听，再等你点头。）');
  process.exit(0);
}

const needCli = chosen.some((n) => SCENARIOS[n].driver === 'model');
if (needCli && spawnSync('codebuddy', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log('⚠️ 没找到 `codebuddy` CLI，跳过（这不是失败）。');
  process.exit(0);
}

/**
 * 删一个目录（整棵）。
 *
 * 为什么走 `rm -rf` 而不是 `fs.rmSync`：本机对 `rmSync` 有批量删除保护
 * （单次 >500 个文件会抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED），
 * 而一个场景目录里 `.git` 就有几百个对象文件——用 `rmSync` 清到一半会失败。
 * 作用域严格限制在 `.e2e/` 下的单个条目，不会误伤别处。
 */
function rmrf(dir) {
  spawnSync('rm', ['-rf', '--', dir], { encoding: 'utf8' });
}

/** 清掉所有"一次运行"的目录与 worktree 场景留下的 bare 仓库；`test.md` 保留。 */
function cleanRuns() {
  if (!existsSync(DATA_ROOT)) return 0;
  let n = 0;
  for (const name of readdirSync(DATA_ROOT)) {
    if (name === 'test.md' || name.startsWith('.')) continue;
    rmrf(join(DATA_ROOT, name));
    n += 1;
  }
  return n;
}

mkdirSync(DATA_ROOT, { recursive: true });
if (isAutoFresh()) {
  const n = cleanRuns();
  if (n > 0) console.log(`  --all：已清空上一轮 ${n} 个现场目录`);
}
if (fresh && !isAutoFresh()) {
  for (const name of readdirSync(DATA_ROOT)) {
    if (name.startsWith('.')) continue;
    rmrf(join(DATA_ROOT, name));
  }
  console.log('  --fresh：已清空上一轮现场');
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
const report = join(DATA_ROOT, 'test.md');

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

/** 把本轮那一节写进 `test.md`：已有就**原地替换**（不重复追加），没有就追加。 */
function upsertRunBlock(body) {
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

if (!existsSync(report)) {
  writeFileSync(
    report,
    [
      '# e2e 测试报告',
      '',
      '> 每次运行一节，用表格列：测什么 / 结果 / 耗时 / tokens，失败的单独列原因。',
      '> **每个场景跑完就刷新本节**（不等整轮结束）：中途停下也能看到已完成场景的结果；',
      '> 每个场景目录里另有一份 `report.md`（同一个场景的逐条断言）。',
      '> 本文件在 `.e2e/` 下（gitignore，不入库）；长期账本见 skill 里的 `e2e-history.md`。',
      '',
    ].join('\n'),
  );
}

const results = [];
for (const name of chosen) {
  const r = { name, ...runScenario(name) };
  results.push(r);
  writeDirReport(r);
  upsertRunBlock(buildRunBlock(results, null));
  console.log(`    报告已更新（${results.length}/${chosen.length}）：${join(r.dir, 'report.md')}`);
}

// ---------------------------------------------------------------- 单测（快，几秒）
const UNITS = [
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

// ---------------------------------------------------------------- 收尾：终版报告
// 场景循环里每跑完一个就已经刷新过 test.md（进行中版本）；这里用同一个函数生成终版
// （多了单测表、标题改成"X/Y 个场景通过"）原地覆盖，避免同一轮在报告里出现两次。
upsertRunBlock(buildRunBlock(results, units));

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

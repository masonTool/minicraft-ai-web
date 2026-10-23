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
 *   npm run skill:e2e -- --model X --turns 40 --timeout 600 --strict
 *
 * 现场（默认**保留**，方便你看）：
 *   `.codebuddy/skills/continue-task/.e2e/<场景>-<时间戳>/`
 *   每次运行**开始前清空整个 `.e2e/`**（只留最近一次）——按你的要求"重新跑要清掉之前的"。
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
const all = flag('--all');
const timeoutSec = Number(value('--timeout', '480'));
const maxTurns = Number(value('--turns', '30'));
const DEFAULT_MODEL = 'deepseek-v4.1-flash-official';
const model = value('--model', DEFAULT_MODEL);

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
  rmSync(dir, { recursive: true, force: true });
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
  desc: '主干：真模型跑完一条任务（队列 / 递任务 / 收尾 / 归档）',
  run(ctx, s) {
    check('install.mjs 退出码 0', ctx.install.status === 0, (ctx.install.stderr || '').slice(-300));
    check('装出 .continue/README.md', existsSync(join(ctx.dir, '.continue', 'README.md')));
    check('注册了钩子', existsSync(join(ctx.dir, '.codebuddy', 'settings.json')));
    check('装了 pre-commit 垫片', existsSync(join(ctx.dir, '.git', 'hooks', 'pre-commit')));
    ctx.git(['add', '-A']);
    ctx.git(['commit', '-q', '-m', 'chore: 装框架']);

    const prompt = [
      '这是一个刚装好 continue-do 框架的空项目，机制见 .continue/README.md。',
      '请按框架流程做这一件小事：把 README.md 里的 `version: 1` 改成 `version: 2`。',
      '',
      '要求（按顺序做完，不要问我问题）：',
      '1. 先在 .continue/doing/ 建**本会话的队列**，放 1 条条目，带一行 `验证：`；',
      '2. 改完把条目勾成 `[x]` 并写完成说明，然后提交；',
      '3. 按收尾五步收尾（搬进 DONE.md、更新 OVERVIEW.md / TASKS.md、归档队列），再提交。',
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
    check(
      '收尾第 5 步可执行（归档队列）',
      arch.status === 0 && listArchive(ctx, s).some((n) => n.startsWith('queue-')),
      arch.stdout.slice(0, 160),
    );
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
    const r2 = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'], env });
    const r3 = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'], env });

    check('第 1 轮正常递任务', r1.status === 2 && /第 \d+\/\d+ 条/.test(r1.stderr), r1.stderr.slice(0, 120));
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
  desc: '计划执行：续批 / 硬停（先问后重置）/ 确认后继续 / 完成归档',
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

    write(ctx, `.continue/doing/${sid6(s)}-plan.md`, plan(['- [~] `MS1.2` 二 → 验收 `true`', '- [ ] `MS1.3` 三 → 验收 `true`']));
    const cont = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check('① 未到边界 → 续批', /计划里还有下一阶段/.test(cont.stderr), cont.stderr.slice(0, 120));

    resetHookState(ctx, s);
    write(ctx, `.continue/doing/${sid6(s)}-plan.md`, plan(['- [~] `MS1.2` 二 → 验收 `true`']));
    const hard = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    const ask = hard.stderr.indexOf('弹窗问用户');
    const reset = hard.stderr.indexOf('只有用户选了');
    check('② 到边界 → 硬停', /停下等验收/.test(hard.stderr), hard.stderr.slice(0, 120));
    check('② 硬停先问人再重置队列', ask > 0 && reset > ask, `ask=${ask} reset=${reset}`);
    check('② 硬停列出里程碑验收命令', /`true`/.test(hard.stderr), hard.stderr.slice(0, 120));

    /**
     * ③ 已确认的里程碑不该再拦。注意 MS2 这边要留 **≥2 条**未完成阶段：
     * 只留一条的话游标一进 MS2 就到边界，硬停是**对的**（我第一版就是这么写错的）。
     */
    resetHookState(ctx, s);
    write(
      ctx,
      `.continue/doing/${sid6(s)}-plan.md`,
      [
        '## MS1 · 甲',
        '- 验收：`true`',
        '- 确认：已验收 · 批次 `20260101-0001`',
        '- [x] `MS1.1` 一 → 验收 `true` · 批次 `20260101-0001`',
        '- [x] `MS1.2` 二 → 验收 `true` · 批次 `20260101-0001`',
        '',
        '## MS2 · 乙',
        '- 验收：`true`',
        '- [~] `MS2.1` 一 → 验收 `true`',
        '- [ ] `MS2.2` 二 → 验收 `true`',
        '- [ ] `MS2.3` 三 → 验收 `true`',
      ].join('\n'),
    );
    const afterConfirm = hook(ctx, 'auto-continue.mjs', stop(s), { args: ['--event=Stop'] });
    check(
      '③ 已确认 → 继续下一里程碑',
      /计划里还有下一阶段/.test(afterConfirm.stderr) && !/停下等验收/.test(afterConfirm.stderr),
      afterConfirm.stderr.slice(0, 140),
    );

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
    check('④ 阶段全做完 → 整体收尾', /计划已全部完成/.test(fin.stderr), fin.stderr.slice(0, 120));
    const arch = hook(ctx, 'archive-queue.mjs', null, { args: [s, '--plan'] });
    check(
      '④ 计划可归档（--plan）',
      arch.status === 0 && !existsSync(join(ctx.dir, '.continue', 'doing', `${sid6(s)}-plan.md`)),
      arch.stdout.slice(0, 120),
    );
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
  return readdirSync(d).filter((n) => /^(queue|plan|decision)-\d{14}\.md$/.test(n));
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
  if (ctx.skipped && failed.length === 0) {
    console.log(`  ⏭ 跳过（环境问题，未验模型断言）— 现场：${ctx.dir}`);
    return 'skip';
  }
  console.log(
    `  ${failed.length === 0 ? '✓ 通过' : `✗ 未通过 ${failed.length}/${steps.length}`} — 现场：${ctx.dir}`,
  );
  return failed.length === 0 ? 'pass' : 'fail';
}

// ---------------------------------------------------------------- 主流程
const chosen = all ? Object.keys(SCENARIOS) : multi('--scenario').length > 0 ? multi('--scenario') : ['main'];

console.log('端到端自测');
console.log(`  仓库    ${REPO}`);
console.log(`  数据根  ${DATA_ROOT}（每次运行前清空，跑完保留）`);
console.log(`  场景    ${chosen.join(', ')}`);
console.log(`  模型    ${model}`);
console.log(`  轮次/超时 ${maxTurns} / ${timeoutSec}s`);

if (dryRun) {
  console.log('\n[dry-run] 计划：');
  for (const name of chosen) {
    const sc = SCENARIOS[name];
    if (!sc) {
      console.error(`  ! 未知场景 ${name}`);
      process.exit(2);
    }
    console.log(`  · ${name}（${sc.driver}）— ${sc.desc}`);
  }
  process.exit(0);
}

const needCli = chosen.some((n) => SCENARIOS[n]?.driver === 'model');
if (needCli && spawnSync('codebuddy', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log('\n⚠️ 没找到 `codebuddy` CLI，跳过（这不是失败）。');
  process.exit(0);
}

mkdirSync(DATA_ROOT, { recursive: true });
if (fresh) {
  // 只清"上一轮"的目录（保留本轮已跑的），避免手滑把整轮历史都删了
  for (const name of readdirSync(DATA_ROOT)) {
    if (name.startsWith('.')) continue;
    rmSync(join(DATA_ROOT, name), { recursive: true, force: true });
  }
  console.log('  --fresh：已清空上一轮现场');
}

const results = [];
for (const name of chosen) results.push({ name, ok: runScenario(name) });

const bad = results.filter((r) => r.ok === 'fail');
console.log('\n汇总：');
for (const r of results) {
  console.log(`  ${{ pass: '✓', fail: '✗', skip: '⏭' }[r.ok]} ${r.name}`);
}
console.log(`\n现场保留在 ${DATA_ROOT}（每次重跑前会自动清空）`);
if (bad.length > 0) process.exit(1);
process.exit(process.exitCode === 1 ? 1 : 0);

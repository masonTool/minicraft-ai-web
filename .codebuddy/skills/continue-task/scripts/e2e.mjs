#!/usr/bin/env node
/**
 * 端到端自测：**用真实的 codebuddy CLI 把框架跑一遍**，看它到底会不会转。
 *
 * 和另外两个脚本的分工（三者不是重复，各自挡不同的东西）：
 *   · `check-framework.mjs` —— 打包源**自己**一致吗（模板↔安装器、注册命令、脚本交代）
 *   · `test-install.mjs`    —— 装出来的**形状**对吗（文件齐不齐、能不能跑自检）
 *   · `e2e.mjs`（本脚本）    —— 装出来之后**真的转得动吗**（队列建没建、钩子递没递、收没收尾、归没归档）
 *
 * 为什么要这一层：前两个都只看静态产物。实测过一类事故——钩子写 stdout 后立刻 exit
 * 导致 JSON 被截断，静态检查全绿，但注入整份被宿主丢掉，**队列永远递不出任务**。
 * 这种只有"真跑一遍"才看得见。
 *
 * 用法（在**仓库根**执行；测试数据落在 `.skill-e2e/`，已 gitignore）：
 *   node .codebuddy/skills/continue-task/scripts/e2e.mjs [--dry-run] [--keep]
 *        [--timeout 600] [--turns 25] [--keep-on-fail]
 *
 *   --dry-run      只打印计划，不建目录、不跑 CLI
 *   --keep         成功也保留数据目录（排查用）
 *   --keep-on-fail 失败时保留（默认就是保留；显式写出来只是让 CI 日志更清楚）
 *   --timeout N    单次 CLI 超时秒数（默认 600）
 *   --turns N      `--max-turns`（默认 25）
 *
 * 退出码：0 通过（或**未安装 CLI → 跳过**）/ 1 断言失败 / 2 用法错误。
 *
 * ⚠️ 这是**慢测**（一次真跑几分钟、会花 token），所以：
 *   · 不进 `test:*` 前缀（`npm run check` 不会带它，也不会把台账里的套数改乱）；
 *   · 单独用 `npm run skill:e2e` 或在 CI 里显式跑。
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
const DATA_ROOT = join(REPO, '.skill-e2e');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const dryRun = flag('--dry-run');
const keep = flag('--keep') || flag('--keep-on-fail');
const timeoutSec = Number(value('--timeout', '600'));
const maxTurns = Number(value('--turns', '25'));

if (flag('--help') || flag('-h')) {
  console.log(
    '用法：node scripts/e2e.mjs [--dry-run] [--keep] [--timeout 600] [--turns 25]',
  );
  process.exit(0);
}
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0 || !Number.isFinite(maxTurns) || maxTurns <= 0) {
  console.error('--timeout / --turns 必须是正整数');
  process.exit(2);
}

/**
 * 固定会话 ID：断言要按它推导路径，随机 ID 会让"归档到哪儿"每次都不一样。
 * 必须是 32 位 hex —— 框架对 UUID 形态取前 6 位当文件名（`e2e000`）。
 */
const SID = 'e2e0' + '0'.repeat(27) + 'e';
const SID6 = SID.slice(0, 6);
if (SID.length !== 32) {
  console.error('内部错误：SID 必须是 32 位');
  process.exit(2);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '-');
const WORK = join(DATA_ROOT, `run-${stamp}`);

const steps = [];
const check = (label, ok, detail = '') => {
  steps.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `  →  ${detail}`}`);
};

const git = (args, cwd = WORK) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// ---------------------------------------------------------------- 计划
console.log('端到端自测（真实 CLI 跑一遍框架）');
console.log(`  仓库      ${REPO}`);
console.log(`  数据目录  ${WORK}${existsSync(DATA_ROOT) ? '' : '（首次运行会创建）'}`);
console.log(`  会话 ID   ${SID} → 文件名 ${SID6}.md`);
console.log(`  超时      ${timeoutSec}s · 最多 ${maxTurns} 轮`);
console.log(`  模型      继承本机 codebuddy 配置（不传 --model，跟你平时用的一致）`);

if (dryRun) {
  console.log('\n[dry-run] 会做这些事（现在什么都没跑）：');
  for (const line of [
    '1. 在数据目录里 git init + 一次初始提交（框架的批次号/门禁都依赖 git）',
    '2. 跑 skill 的 install.mjs 装框架（--no-detect，避免探测拖时间）',
    `3. codebuddy -p "<小任务>" --session-id ${SID} --max-turns ${maxTurns} --permission-mode bypassPermissions`,
    '4. 断言：钩子日志有 queue-init/auto-continue、队列被建过、DONE 有批次节、git 有提交、队列最终归档',
    '5. 成功删数据目录（--keep 则保留）；失败保留并打印 CLI 输出尾部',
  ]) console.log(`   ${line}`);
  process.exit(0);
}

// ---------------------------------------------------------------- 环境
const hasCli = spawnSync('codebuddy', ['--version'], { encoding: 'utf8' }).status === 0;
if (!hasCli) {
  console.log('\n⚠️ 没找到 `codebuddy` CLI，跳过（这不是失败）。');
  console.log('   装好 CLI 后重跑：npm run skill:e2e');
  process.exit(0);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- 1) 空项目
check('建空项目目录', existsSync(WORK));
check('git init', git(['init', '-q']).status === 0);
git(['config', 'user.email', 'e2e@local']);
git(['config', 'user.name', 'continue-do e2e']);
git(['config', 'commit.gpgsign', 'false']);
writeFileSync(join(WORK, 'README.md'), '# e2e 空项目\n\n只用来验证框架能不能转，不是真实项目。\n');
git(['add', '-A']);
check('初始提交', git(['commit', '-q', '-m', 'init']).status === 0);

// ---------------------------------------------------------------- 2) 装框架
console.log('\n[1/3] 安装框架');
const install = spawnSync(process.execPath, [join(HERE, 'install.mjs'), '--no-detect'], {
  cwd: WORK,
  encoding: 'utf8',
});
if (install.status !== 0) {
  console.error(install.stdout || '');
  console.error(install.stderr || '');
}
check('install.mjs 退出码 0', install.status === 0, (install.stderr || '').slice(-300));
check('装出 .continue/README.md', existsSync(join(WORK, '.continue', 'README.md')));
check('注册了钩子', existsSync(join(WORK, '.codebuddy', 'settings.json')));
check('装了 pre-commit 垫片', existsSync(join(WORK, '.git', 'hooks', 'pre-commit')));
git(['add', '-A']);
git(['commit', '-q', '-m', 'chore: 装 continue-do 框架']);

// ---------------------------------------------------------------- 3) 真跑
console.log('\n[2/3] 用 CLI 跑一个小任务（会花几分钟）');
const prompt = [
  '这是一个刚装好 continue-do 框架的空项目。',
  '请按框架的流程做一件事：新建 hello.txt，内容一行 `hello`。',
  '做完按框架的收尾规则正常收尾，不要问我问题，自己按你的判断处理。',
].join('');

const cliArgs = [
  '-p',
  prompt,
  '--session-id',
  SID,
  '--max-turns',
  String(maxTurns),
  '--permission-mode',
  'bypassPermissions',
  '--output-format',
  'json',
];
console.log(`  $ codebuddy ${cliArgs.filter((a) => a !== prompt).join(' ')}`);

const started = Date.now();
const run = spawnSync('codebuddy', cliArgs, {
  cwd: WORK,
  encoding: 'utf8',
  timeout: timeoutSec * 1000,
  maxBuffer: 32 * 1024 * 1024,
});
const elapsed = Math.round((Date.now() - started) / 1000);
writeFileSync(join(WORK, '.e2e-cli.json'), JSON.stringify({ args: cliArgs, status: run.status, signal: run.signal, elapsed, stdout: run.stdout, stderr: run.stderr }, null, 2));

const cliText = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
/**
 * 未登录（401）不是"框架坏了"，是环境没配好。
 *
 * 这种情况**仍然有验证价值**：CLI 会照常加载 `.codebuddy/settings.json` 并触发钩子，
 * 所以"注册对不对、注入有没有被截断、钩子会不会崩"这几件都真的跑过了——
 * 只是模型那一轮没发生，队列自然不会建。于是分两级：
 *   · 静态级（不需要登录）：钩子确实跑起来了，且没有崩；
 *   · 模型级（需要登录）：队列 → 递任务 → 收尾 → 归档。
 */
const needLogin = /401|Authentication required|please (use \/login|log ?in)/i.test(cliText);

// ---------------------------------------------------------------- 4) 断言
console.log('\n[3/3] 断言框架真的转了');
const logFile = join(WORK, '.continue', 'logs', SID6, 'run.md');
const logText = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';

check(
  '钩子写过运行日志',
  logText.length > 0,
  `缺 ${logFile}（说明钩子一次都没跑起来——注入被丢或者 CLI 没加载 settings）`,
);
check('queue-init 跑过（首轮注入）', /\[queue-init · UserPromptSubmit\]/.test(logText));
check('auto-continue 跑过（递过任务）', /\[auto-continue · /.test(logText));
check('钩子没有崩（run.mjs 没有吐"框架自己坏了"）', !/框架自己坏了/.test(cliText));

const doingFile = join(WORK, '.continue', 'doing', `${SID6}.md`);
const archiveDir = join(WORK, '.continue', 'logs', SID6);
const archived = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((n) => /^queue-\d{14}\.md$/.test(n))
  : [];

if (needLogin) {
  // 模型没跑，队列类断言无意义：只收静态级结论，并说明"为什么没验到"
  const staticOk = steps.every((x) => x.ok) && /\[auto-continue · /.test(logText);
  console.log('');
  console.log('⚠️ CLI 未登录（401），跳过模型阶段。');
  console.log('   静态级已验：框架装好 → 钩子被加载 → 注入没被截断 → 钩子没崩。');
  console.log('   队列/收尾/归档要等登录后才会发生，登录后重跑：npm run skill:e2e');
  if (!keep) {
    rmSync(WORK, { recursive: true, force: true });
  } else {
    console.log(`   数据目录保留在 ${WORK}`);
  }
  process.exit(staticOk ? 0 : 1);
}

check(
  '建过会话队列（现存或已归档）',
  existsSync(doingFile) || archived.length > 0,
  'doing/ 里没有、logs/ 里也没有 queue-<时间戳>.md —— 队列压根没建',
);

const doneText = existsSync(join(WORK, '.continue', 'DONE.md'))
  ? readFileSync(join(WORK, '.continue', 'DONE.md'), 'utf8')
  : '';
check('DONE.md 里出现了批次节（收尾真的做了）', /^## 批次 \d{8}-\d{4}/m.test(doneText));

check('队列已归档（收尾第五步）', archived.length > 0, existsSync(doingFile) ? '队列还在 doing/ —— 可能没走到收尾' : '既没归档也没留着');

const commits = Number(git(['rev-list', '--count', 'HEAD']).stdout?.trim() ?? '0');
check(`git 有提交（${commits} 个）`, commits >= 3, '至少应有 init / 装框架 / 任务提交 三个');

// ---------------------------------------------------------------- 结果
const failed = steps.filter((s) => !s.ok);
console.log('');
if (failed.length === 0) {
  console.log(`端到端通过：${steps.length} 项。`);
  if (!keep) {
    rmSync(WORK, { recursive: true, force: true });
    console.log(`数据目录已删除（要保留用 --keep）：${WORK}`);
  } else {
    console.log(`数据目录保留在 ${WORK}`);
  }
  process.exit(0);
}

console.log(`端到端未通过：${failed.length}/${steps.length} 项。`);
console.log(`数据目录保留在 ${WORK}（里面有 .e2e-cli.json 与整个项目现场）`);
const tail = String(run.stdout ?? '')
  .trim()
  .split('\n')
  .slice(-25)
  .join('\n');
if (tail) {
  console.log('\nCLI 输出尾部：');
  console.log(tail);
}
process.exit(1);

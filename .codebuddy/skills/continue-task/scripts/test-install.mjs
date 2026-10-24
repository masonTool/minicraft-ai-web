#!/usr/bin/env node
/**
 * 安装器回归测试：六种项目形态全部在系统临时目录里造，跑完即删。
 *
 * 为什么存在（挡的是哪次事故）：安装器的每个分支都是"悄悄少装一样东西"，
 * 症状要等到 AI 干活时才发现（钩子没跑 / 检查没生效）。这些分支以前靠人工
 * 一个个搭临时目录验证——想起来才测，改了别处就忘了。现在一条命令全跑。
 *
 * 覆盖：全新 git 项目 · 非 git 目录 · 已有同名文档 · 已有自定义 config ·
 *       已有别的钩子 · 已有别人的 pre-commit · 重复安装幂等 · `--dry-run` · `--ci` ·
 *       老版本注册（命令缺 `--event=`）升级 · 已有项目文档扫描 · 来源登记幂等 ·
 *       npm 项目补 `continue:worktree` 别名（非 npm 项目不凭空造 package.json）·
 *       升级删掉新版不再提供的旧钩子 · 工作树命名 `worktree_<单词>_<YYYYMMDD>`（目录与分支同名）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALLER = join(SKILL_DIR, 'scripts', 'install.mjs');

/** 剥掉 git 注入的变量：经 pre-commit 调用时，否则会操作外层仓库。 */
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

const results = [];
function check(name, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'continue-install-'));
  try {
    const why = fn(dir);
    results.push({ name, ok: why === true, why: why === true ? '' : String(why) });
  } catch (err) {
    results.push({ name, ok: false, why: `抛异常：${err.message}` });
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

const run = (cwd, args = []) =>
  spawnSync(process.execPath, [INSTALLER, ...args], { cwd, env: baseEnv, encoding: 'utf8' });
const scan = (cwd, args = []) =>
  spawnSync(process.execPath, [join(SKILL_DIR, 'scripts', 'scan-docs.mjs'), ...args], {
    cwd,
    env: baseEnv,
    encoding: 'utf8',
  });
const git = (cwd, args) => spawnSync('git', args, { cwd, env: baseEnv, encoding: 'utf8' });
const expect = (cond, msg, detail) => (cond ? true : `${msg}${detail ? `（实际：${detail}）` : ''}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hookCommands = (settings) =>
  Object.values(settings.hooks ?? {})
    .flatMap((groups) => groups.flatMap((group) => group.hooks ?? []))
    .map((h) => String(h.command ?? ''));

// ------------------------------------------------------------------ 1. 全新 git 项目
check('全新 git 项目：文档 / 钩子 / 注册 / pre-commit 全到位', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  for (const rel of ['.continue/TASKS.md', '.continue/README.md', '.continue/config.json']) {
    if (!existsSync(join(dir, rel))) return expect(false, `缺少 ${rel}`);
  }
  // 队列目录只要求存在：不放 `.gitkeep` 占位，空目录由安装器 mkdir 出来
  const doingPath = join(dir, '.continue', 'doing');
  if (!existsSync(doingPath) || !statSync(doingPath).isDirectory()) {
    return expect(false, '缺少 .continue/doing 目录');
  }
  const hooks = readdirSync(join(dir, '.continue', 'hooks')).filter((n) => n.endsWith('.mjs'));
  if (hooks.length < 8) return expect(false, `钩子只装了 ${hooks.length} 个`);
  const commands = hookCommands(readJson(join(dir, '.codebuddy', 'settings.json')));
  for (const script of ['auto-continue.mjs', 'auto-commit.mjs', 'queue-init.mjs']) {
    if (!commands.some((c) => c.includes(script))) return expect(false, `settings 未注册 ${script}`);
  }
  // 命令必须带 --event=：少了它日志行首只有钩子名，分不清是 Stop 还是用户说话触发的
  for (const event of ['Stop', 'UserPromptSubmit']) {
    if (!commands.some((c) => c.includes(`--event=${event}`))) {
      return expect(false, `注册命令缺 --event=${event}`, commands.join(' | '));
    }
  }
  // 版本号必须在安装时打印出来：装上去的钩子每次重装都被覆盖，用户只能靠这一行知道跑的是哪版
  if (!/安装 continue-do v\d+\.\d+\.\d+/.test(r.stdout)) {
    return expect(false, '安装输出没有打印框架版本', (r.stdout || '').split('\n')[0]);
  }
  const shim = join(dir, '.git', 'hooks', 'pre-commit');
  if (!existsSync(shim)) return expect(false, '没有写 pre-commit 垫片');
  // node 缺失时必须放行：GUI git 客户端没有 nvm 的 PATH，fail-closed 会让所有提交失败
  if (!readFileSync(shim, 'utf8').includes('command -v node')) {
    return expect(false, '垫片没有 node 缺失时的放行保护');
  }
  return expect(statSync(shim).mode & 0o111, 'pre-commit 垫片没有可执行位');
});

// ------------------------------------------------------------------ 1.5 已有文档扫描
check('已有文档：安装时列出待集成文档与目标，原文件不动', (dir) => {
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const sources = {
    'TODO.md': '# TODO\n\n- [ ] 登录\n- [ ] 支付\n',
    'docs/architecture.md': '# 架构\n\n## 模块\n\n说明。\n',
    // 故意很短：验证"小文件也不能被大小阈值漏掉"
    'CHANGELOG.md': '# 变更\n\n## 1.0\n',
  };
  for (const [rel, body] of Object.entries(sources)) writeFileSync(join(dir, rel), body);

  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  for (const rel of Object.keys(sources)) {
    if (!r.stdout.includes(rel)) {
      return expect(false, `安装输出应列出待集成的 ${rel}`, r.stdout.slice(-400));
    }
    if (readFileSync(join(dir, rel), 'utf8') !== sources[rel]) {
      return expect(false, `扫描不该改动 ${rel}`);
    }
  }
  if (!r.stdout.includes('TASKS') || !r.stdout.includes('OVERVIEW')) {
    return expect(false, '应给出目标文档建议', r.stdout.slice(-400));
  }
  return true;
});

check('scan-docs：来源登记后不再待集成，扫描只读', (dir) => {
  git(dir, ['init', '-q']);
  const install = run(dir);
  if (install.status !== 0) return expect(false, 'install 应 exit 0', install.stderr.slice(0, 300));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'arch.md'), '# 架构\n\n## 模块\n');

  const beforeFiles = readdirSync(join(dir, '.continue')).sort().join(',');
  const first = JSON.parse(scan(dir, ['--json']).stdout);
  const before = first.candidates.find((c) => c.path === 'docs/arch.md');
  if (!before) return expect(false, '应列出 docs/arch.md');
  if (before.registered !== false) return expect(false, '未登记时 registered 应为 false');
  const afterFiles = readdirSync(join(dir, '.continue')).sort().join(',');
  if (beforeFiles !== afterFiles) return expect(false, '扫描不该在 .continue 里新增文件');

  // 按 SKILL.md 的约定写一行来源标注 → 扫描器应视为已登记
  const overview = join(dir, '.continue', 'OVERVIEW.md');
  writeFileSync(overview, `${readFileSync(overview, 'utf8')}\n> 来源：docs/arch.md\n`);
  const second = JSON.parse(scan(dir, ['--json']).stdout);
  const after = second.candidates.find((c) => c.path === 'docs/arch.md');
  return expect(after && after.registered === true, '已登记来源应标记 registered=true');
});

// ------------------------------------------------------------------ 2. 非 git 目录
check('非 git 目录：装得下来，只是没有提交守卫', (dir) => {
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (existsSync(join(dir, '.git'))) return expect(false, '不该凭空建 .git');
  if (!existsSync(join(dir, '.continue', 'hooks', 'auto-continue.mjs'))) return expect(false, '钩子没装');
  return expect(r.stdout.includes('跳过'), '应说明跳过了 pre-commit', r.stdout.slice(-200));
});

// ------------------------------------------------------------------ 3. 已有同名文档
check('已有同名文档：原文件不动、不产生备份，也不报"模板变了"（它本来就不是模板）', (dir) => {
  mkdirSync(join(dir, '.continue'), { recursive: true });
  writeFileSync(join(dir, '.continue', 'TASKS.md'), '# 我自己的需求\n- [ ] T1 别动我\n');
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (!readFileSync(join(dir, '.continue', 'TASKS.md'), 'utf8').includes('别动我')) {
    return expect(false, '原文件被覆盖了');
  }
  if (existsSync(join(dir, '.continue', 'TASKS.md.continue-do.md'))) {
    return expect(false, '不该再产生 *.continue-do.md（要求是项目里少一点文件）');
  }
  // 首次安装没有账本 → 无从判断"模板变没变"，不报（差异报告由下面那条正向用例覆盖）
  return expect(!/模板变了/.test(r.stderr), '首次装到已有文档的项目里，不该报"模板变了"', r.stderr.slice(0, 300));
});

// ------------------------------------------------------------------ 4. 已有自定义 config
check('升级：用户改过的 checks.fast 保留，只补缺失的键', (dir) => {
  mkdirSync(join(dir, '.continue'), { recursive: true });
  writeFileSync(join(dir, '.continue', 'config.json'), JSON.stringify({ checks: { fast: 'npm test' } }));
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  if (cfg.checks.fast !== 'npm test') return expect(false, `checks.fast 被覆盖成 ${cfg.checks.fast}`);
  return expect(
    'full' in cfg.checks && 'timeoutSec' in cfg.checks,
    '应补回缺失的 full / timeoutSec',
    JSON.stringify(cfg),
  );
});

// ------------------------------------------------------------------ 4.5 探测项目测试方式
/**
 * 门禁只跑框架自检时，项目自己的测试永远在门外（本项目踩过：10 条回归测试从未进过门禁）。
 * 四条用例钉住探测的边界：探到要填、`--no-detect` 不填、探不到给建议且不瞎填、
 * 用户手写的值不能被探测值覆盖。
 */
check('npm 项目：自动把 scripts.test 填进 checks.project', (dir) => {
  git(dir, ['init', '-q']);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'p', scripts: { test: 'node --test test/*.test.mjs' } }),
  );
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  return expect(
    JSON.stringify(cfg.checks.project) === '["npm test"]',
    `checks.project 应填 ["npm test"]，实际 ${JSON.stringify(cfg.checks.project)}`,
  );
});

check('--no-detect：不探测，checks.project 保持为空', (dir) => {
  git(dir, ['init', '-q']);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const r = run(dir, ['--no-detect']);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  return expect(
    Array.isArray(cfg.checks.project) && cfg.checks.project.length === 0,
    '不该写入探测值',
    JSON.stringify(cfg.checks),
  );
});

check('没有测试框架：project 保持为空，并打印搭建建议', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  if (!Array.isArray(cfg.checks.project) || cfg.checks.project.length !== 0) {
    return expect(false, `不该凭空填 project，实际 ${JSON.stringify(cfg.checks.project)}`);
  }
  return expect(
    r.stdout.includes('没有可自动跑的测试') && r.stdout.includes('建议'),
    '应打印建议清单',
    r.stdout.slice(-500),
  );
});

check('npm 占位脚本（npm init 默认）：判成没有测试，不填 project', (dir) => {
  git(dir, ['init', '-q']);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
  );
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  if (!Array.isArray(cfg.checks.project) || cfg.checks.project.length !== 0) {
    return expect(false, `占位脚本不该被填进 project，实际 ${JSON.stringify(cfg.checks.project)}`);
  }
  return expect(r.stdout.includes('占位脚本'), '建议里应点明"这是 npm 占位脚本"', r.stdout.slice(-400));
});

check('用户已有 checks.project：探测结果不覆盖手写值', (dir) => {
  mkdirSync(join(dir, '.continue'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  writeFileSync(
    join(dir, '.continue', 'config.json'),
    JSON.stringify({ checks: { project: ['make my-check'] } }),
  );
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const cfg = readJson(join(dir, '.continue', 'config.json'));
  const kept = JSON.stringify(cfg.checks.project) === '["make my-check"]';
  return expect(kept && r.stdout.includes('保留已有值'), '手写的 project 被覆盖了', JSON.stringify(cfg.checks));
});

check('--dry-run 时探测结果不落盘（config.json 根本不该被创建）', (dir) => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const r = run(dir, ['--dry-run']);
  if (r.status !== 0) return expect(false, 'exit 0', r.stderr.slice(0, 300));
  if (existsSync(join(dir, '.continue'))) return expect(false, '.continue 不该被创建');
  return expect(r.stdout.includes('npm test'), 'dry-run 也应报告会填哪条命令', r.stdout.slice(-300));
});

// ------------------------------------------------------------------ 5. 已有别的钩子 + 幂等
check('已有别的钩子：只追加缺的，别的配置不动，重装字节不变', (dir) => {
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, '.codebuddy'), { recursive: true });
  const settingsFile = join(dir, '.codebuddy', 'settings.json');
  writeFileSync(
    settingsFile,
    JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    }),
  );
  if (run(dir).status !== 0) return expect(false, 'install 应 exit 0');
  const after = readJson(settingsFile);
  if (after.permissions?.allow?.[0] !== 'Bash(npm test)') return expect(false, 'permissions 被动过');
  const commands = hookCommands(after);
  if (!commands.includes('echo mine')) return expect(false, '用户自己的钩子被删了');
  for (const script of ['auto-continue.mjs', 'auto-commit.mjs', 'queue-init.mjs']) {
    if (!commands.some((c) => c.includes(script))) return expect(false, `未补上 ${script}`);
  }
  const before = readFileSync(settingsFile, 'utf8');
  run(dir);
  return expect(readFileSync(settingsFile, 'utf8') === before, '重装后 settings 应字节不变');
});

// ------------------------------------------------------------------ 5.5 Stop 续跑上限
check('Stop 续跑上限：只写进本框架自己的 group，用户自己的 group 不碰', (dir) => {
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, '.codebuddy'), { recursive: true });
  const settingsFile = join(dir, '.codebuddy', 'settings.json');
  writeFileSync(
    settingsFile,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }),
  );
  if (run(dir).status !== 0) return expect(false, 'install 应 exit 0');
  const after = readJson(settingsFile);
  const groups = after.hooks?.Stop ?? [];
  const ours = groups.find((g) => (g.hooks ?? []).some((h) => String(h.command).includes('auto-continue.mjs')));
  if (!ours) return expect(false, '没找到本框架的 Stop group');
  if (typeof ours.loop_limit !== 'number') {
    return expect(false, '本框架的 Stop group 缺 loop_limit（宿主缺省 1，队列推不动）', JSON.stringify(ours));
  }
  const foreign = groups.find((g) => (g.hooks ?? []).some((h) => h.command === 'echo mine'));
  if (foreign && foreign.loop_limit !== undefined) {
    return expect(false, '用户自己的 Stop group 被写了 loop_limit（会连带放宽它的续跑次数）', JSON.stringify(foreign));
  }
  // 重装字节不变：loop_limit 只补一次
  const before = readFileSync(settingsFile, 'utf8');
  run(dir);
  return expect(readFileSync(settingsFile, 'utf8') === before, '重装后 settings 应字节不变');
});

// ------------------------------------------------------------------ 5.8 已有 AGENTS.md
check('已有 AGENTS.md：不覆盖，并明确警告入口指引没生效', (dir) => {
  writeFileSync(join(dir, 'AGENTS.md'), '# 我自己的约定\n');
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (!readFileSync(join(dir, 'AGENTS.md'), 'utf8').includes('我自己的约定')) {
    return expect(false, 'AGENTS.md 被覆盖了');
  }
  return expect(
    r.stderr.includes('没有生效') && !existsSync(join(dir, 'AGENTS.md.continue-do.md')),
    '入口指引没生效必须告警，且不该靠"另存备份"来表示',
    r.stderr.slice(0, 300),
  );
});

// ------------------------------------------------------------------ 6. 已有别人的 pre-commit
check('已有别人的 pre-commit：不覆盖，只提示怎么接门禁', (dir) => {
  git(dir, ['init', '-q']);
  const shim = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(shim, '#!/bin/sh\necho mine\n');
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (!readFileSync(shim, 'utf8').includes('echo mine')) return expect(false, '别人的 pre-commit 被覆盖了');
  return expect(
    r.stderr.includes('pre-commit') && r.stderr.includes('.continue/hooks/pre-commit.mjs'),
    '应提示在哪加一行',
    r.stderr.slice(0, 300),
  );
});

// ------------------------------------------------------------------ 7. --dry-run 不写文件
check('--dry-run：只报告，不落任何文件', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir, ['--dry-run']);
  if (r.status !== 0) return expect(false, 'exit 0', r.stderr.slice(0, 300));
  if (existsSync(join(dir, '.continue'))) return expect(false, '.continue 不该被创建');
  return expect(r.stdout.includes('写入'), '应逐条列出会做什么', r.stdout.slice(-200));
});

// ------------------------------------------------------------------ 8. --ci
check('--ci：写 GitHub Actions 工作流；重复执行不覆盖', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, '不带 --ci 时 install 应 exit 0');
  if (existsSync(join(dir, '.github'))) return expect(false, '不该凭空写 .github');
  const r = run(dir, ['--ci']);
  if (r.status !== 0) return expect(false, '带 --ci 时 install 应 exit 0', r.stderr.slice(0, 300));
  const wf = join(dir, '.github', 'workflows', 'continue-do.yml');
  if (!existsSync(wf)) return expect(false, '没有写工作流文件');
  if (!readFileSync(wf, 'utf8').includes('node .continue/hooks/check.mjs')) {
    return expect(false, '工作流里没有跑 check.mjs');
  }
  writeFileSync(wf, '# 我自己的\n');
  run(dir, ['--ci']);
  return expect(readFileSync(wf, 'utf8') === '# 我自己的\n', '已有工作流被覆盖了');
});

// ------------------------------------------------------------------ 9. 升级老注册
check('升级老注册：缺 --event= 的命令就地补上，条数不变、env 前缀保留', (dir) => {
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, '.codebuddy'), { recursive: true });
  const settingsFile = join(dir, '.codebuddy', 'settings.json');
  // 老版本装的形态：没有 --event=，其中一条前面挂了用户自己的环境变量
  writeFileSync(
    settingsFile,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'node .continue/hooks/auto-continue.mjs', timeout: 15 },
              { type: 'command', command: 'CONTINUE_BLOCK_AFTER=8 node .continue/hooks/auto-commit.mjs', timeout: 300 },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: 'command', command: 'node .continue/hooks/queue-init.mjs', timeout: 15 },
              { type: 'command', command: 'node .continue/hooks/auto-continue.mjs', timeout: 15 },
            ],
          },
        ],
      },
    }),
  );
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  const commands = hookCommands(readJson(settingsFile));
  // 不重复注册：原有 4 条保留 + 新增的 dispatch 1 条 = 5 条
  if (commands.length !== 5) return expect(false, `应仍是 5 条注册，实际 ${commands.length}`, commands.join(' | '));
  // 新增的派发钩子也要注册进来（老项目升级时最容易漏这一个）
  if (!commands.includes('node .continue/hooks/run.mjs dispatch.mjs --event=Stop')) {
    return expect(false, '没有注册 dispatch.mjs', commands.join(' | '));
  }
  // auto-continue 在两个事件上，各自补自己的事件名
  if (!commands.includes('node .continue/hooks/auto-continue.mjs --event=Stop')) {
    return expect(false, 'Stop 上的 auto-continue 没补 --event=Stop', commands.join(' | '));
  }
  if (!commands.includes('node .continue/hooks/auto-continue.mjs --event=UserPromptSubmit')) {
    return expect(false, 'UserPromptSubmit 上的 auto-continue 没补 --event=UserPromptSubmit', commands.join(' | '));
  }
  if (!commands.includes('CONTINUE_BLOCK_AFTER=8 node .continue/hooks/auto-commit.mjs --event=Stop')) {
    return expect(false, '用户挂的 env 前缀被覆盖了', commands.join(' | '));
  }
  // 老注册没有 loop_limit：升级时要补上，否则宿主缺省 1，队列推不动
  if (typeof readJson(settingsFile).hooks.Stop[0].loop_limit !== 'number') {
    return expect(false, '升级没有补 Stop 的 loop_limit');
  }
  // 再装一次：参数已在，命令字节不变
  const before = readFileSync(settingsFile, 'utf8');
  run(dir);
  return expect(readFileSync(settingsFile, 'utf8') === before, '重复安装后 settings 应字节不变');
});

check('npm 项目：补 continue:worktree 别名，已有 scripts 不动，重复安装幂等', (dir) => {
  git(dir, ['init', '-q']);
  // 用户的 package.json：已有自己的 script，且缩进是 4 空格（写入后会被重排成 2 空格，这是已声明的代价）
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { test: 'node --test', lint: 'echo lint' } }, null, 4),
  );
  const first = run(dir);
  if (first.status !== 0) return expect(false, 'install 应 exit 0', first.stderr.slice(0, 300));
  const pkg = readJson(join(dir, 'package.json'));
  if (pkg.scripts?.['continue:worktree'] !== 'node .continue/hooks/worktree.mjs') {
    return expect(false, '别名没写进 scripts', JSON.stringify(pkg.scripts));
  }
  if (pkg.scripts.test !== 'node --test' || pkg.scripts.lint !== 'echo lint') {
    return expect(false, '用户的 scripts 被改了', JSON.stringify(pkg.scripts));
  }
  if (!pkg.name || pkg.name !== 'demo') return expect(false, 'package.json 其它字段被改了');
  // 别名要能真的跑起来：走 node 直跑，不进 git 操作（--dry-run 只打印计划）
  const alias = spawnSync('node', ['.continue/hooks/worktree.mjs', 'demo', '--dry-run'], {
    cwd: dir,
    env: baseEnv,
    encoding: 'utf8',
  });
  if (alias.status !== 0) return expect(false, 'worktree.mjs --dry-run 应 exit 0', (alias.stderr || '').slice(0, 300));
  // 目录与分支同名 = `worktree_<单词>_<YYYYMMDD>`（用户 2026-10-24 定的形状；日期由脚本加）
  const planned = /建 worktree：(.+)/.exec(alias.stdout || '')?.[1].trim() ?? '';
  const branchLine = /开分支：([A-Za-z0-9._-]+)/.exec(alias.stdout || '')?.[1] ?? '';
  if (!/worktree_demo_\d{8}$/.test(branchLine) || !planned.endsWith(branchLine)) {
    return expect(
      false,
      '--dry-run 应打印 `worktree_demo_<YYYYMMDD>`，且目录与分支同名',
      (alias.stdout || '').slice(0, 240),
    );
  }
  // 重复安装：字节不变（"已存在就不重写"）
  const before = readFileSync(join(dir, 'package.json'), 'utf8');
  const second = run(dir);
  if (second.status !== 0) return expect(false, '重复 install 应 exit 0', second.stderr.slice(0, 300));
  return expect(
    readFileSync(join(dir, 'package.json'), 'utf8') === before &&
      (second.stdout || '').includes('保留已有值'),
    '重复安装后 package.json 应字节不变并打印"保留已有值"',
    (second.stdout || '').split('\n').filter((l) => l.includes('continue:worktree')).join(' | '),
  );
});

check('升级：删掉新版不再提供的旧钩子（记录在案且没人改过才删）', (dir) => {
  git(dir, ['init', '-q']);
  const first = run(dir);
  if (first.status !== 0) return expect(false, '首次 install 应 exit 0', first.stderr.slice(0, 300));

  // 模拟"上一版装过 worktree-sync.mjs"：文件在、`.installed.json` 也记着它的哈希
  const legacyRel = '.continue/hooks/worktree-sync.mjs';
  const legacy = join(dir, legacyRel);
  writeFileSync(legacy, '// 旧版钩子（新版已删）\n');
  const stateFile = join(dir, '.continue', '.installed.json');
  const state = readJson(stateFile);
  state.files[legacyRel] = createHash('sha256').update(readFileSync(legacy)).digest('hex');
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const second = run(dir);
  if (second.status !== 0) return expect(false, '升级 install 应 exit 0', second.stderr.slice(0, 300));
  if (existsSync(legacy)) {
    return expect(false, `${legacyRel} 应被删掉（留着的话老注册仍可能调用它）`);
  }
  return expect(
    /删除（新版不再提供）/.test(second.stdout || ''),
    '输出应点名删了哪个文件（静默删除等于下次又要猜）',
    (second.stdout || '').slice(0, 300),
  );
});

check('安装状态：落盘 .installed.json（版本 + 每文件哈希），重装字节不变', (dir) => {
  git(dir, ['init', '-q']);
  const first = run(dir);
  if (first.status !== 0) return expect(false, 'install 应 exit 0', first.stderr.slice(0, 300));

  const stateFile = join(dir, '.continue', '.installed.json');
  if (!existsSync(stateFile)) return expect(false, '没有写 .installed.json');
  const state = readJson(stateFile);
  if (!/^\d+\.\d+\.\d+$/.test(String(state.version ?? ''))) {
    return expect(false, `version 不是 semver：${state.version}`);
  }
  const hash = createHash('sha256').update(readFileSync(join(dir, '.continue', 'hooks', 'lib.mjs'))).digest('hex');
  if (state.files?.['.continue/hooks/lib.mjs'] !== hash) {
    return expect(false, 'lib.mjs 的哈希与记录不一致（记录的不是装完时的实际内容）');
  }

  // 幂等：什么都没变时不该刷新 installedAt——否则每次重装都产生一行无意义的 diff
  const before = readFileSync(stateFile, 'utf8');
  const second = run(dir);
  if (second.status !== 0) return expect(false, '重装应 exit 0', second.stderr.slice(0, 300));
  return expect(
    readFileSync(stateFile, 'utf8') === before && second.stdout.includes('已是最新'),
    '重装后 .installed.json 应字节不变并打印"已是最新"',
    second.stdout.split('\n').filter((l) => l.includes('installed.json')).join(' | '),
  );
});

// ------------------------------------------------------------------ 升级（只比两边）
check('升级：用户填过的数据文档不覆盖、不备份，也不再报"模板有更新"（那是必然差异）', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, '首次安装应 exit 0');

  const ours = '# 需求\n\n用户自己的内容\n';
  writeFileSync(join(dir, '.continue', 'TASKS.md'), ours);

  const r = run(dir);
  if (r.status !== 0) return expect(false, '升级应 exit 0', r.stderr.slice(0, 300));
  if (readFileSync(join(dir, '.continue', 'TASKS.md'), 'utf8') !== ours) {
    return expect(false, '实例被改写了（用户进度丢了，这是最不能接受的）');
  }
  if (existsSync(join(dir, '.continue', 'TASKS.md.continue-do.md'))) {
    return expect(false, '不该产生备份文件（要求是项目里少一点文件）');
  }
  // T45：实例与模板不同是定义上的必然（模板是骨架、实例是进度），报出来只是噪音
  return expect(
    !/模板有更新/.test(r.stdout) && !/模板变了/.test(r.stderr),
    '用户填过的文档不该再报"未合并"（4 条永久噪音会盖住真信号）',
    `${r.stdout.slice(-300)} ${r.stderr.slice(0, 300)}`,
  );
});

/**
 * 与上一条配对的**真信号**：模板自己变了 —— 这才是要报的。
 *
 * 造法：把 `.installed.json` 里这份的 `templates` 哈希改成一个别的值，
 * 等价于"上一版装的模板和这一版不一样"。判据不看实例内容，只看模板哈希。
 */
check('升级：模板自己变了要报（真信号不能被一起静音）', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, '首次安装应 exit 0');

  // 上一版模板 = `fake`（实例装的就是它、之后没人动过），这一版模板 = 技能的 DONE.md
  const rel = '.continue/DONE.md';
  const fake = '# DONE\n\n上一版模板的样子\n';
  writeFileSync(join(dir, rel), fake);
  const statePath = join(dir, '.continue', '.installed.json');
  const state = readJson(statePath);
  state.files[rel] = createHash('sha256').update(Buffer.from(fake, 'utf8')).digest('hex');
  state.templates[rel] = state.files[rel];
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const r = run(dir);
  if (r.status !== 0) return expect(false, '升级应 exit 0', r.stderr.slice(0, 300));
  if (!/跳过（模板有更新，未合并）/.test(r.stdout)) {
    return expect(false, '应报告这一份（模板变了、实例还没合并）', r.stdout.slice(-400));
  }
  return expect(
    /模板变了/.test(r.stderr) && /--force/.test(r.stderr),
    '汇总告警里要点名并给出 --force 出路',
    r.stderr.slice(0, 400),
  );
});

check('升级：hooks 覆盖成最新版，且不产生 .baseline / .backup 目录', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, '首次安装应 exit 0');

  const libPath = join(dir, '.continue', 'hooks', 'lib.mjs');
  writeFileSync(libPath, `${readFileSync(libPath, 'utf8')}\n// 用户自己的调试开关\n`);
  const r = run(dir);
  if (r.status !== 0) return expect(false, '升级应 exit 0', r.stderr.slice(0, 300));

  if (
    readFileSync(libPath, 'utf8') !==
    readFileSync(join(SKILL_DIR, 'assets', '.continue', 'hooks', 'lib.mjs'), 'utf8')
  ) {
    return expect(false, '框架代码应被覆盖成最新版');
  }
  for (const name of ['.baseline', '.backup']) {
    if (existsSync(join(dir, '.continue', name))) {
      return expect(false, `不该再产生 .continue/${name}/（要求是项目里少一点文件）`);
    }
  }
  return expect(true, '');
});

/**
 * 机制文档与数据文档**分开**（T43）。
 *
 * 挡的是真实发生过的漏检：模板 README 在 T39~T42 两批里改了三处，实例一个字没跟上，
 * 而三处检查全绿——README 被当成"用户数据"跳过、安装器只报告、`check-framework` 只看模板。
 * 判据只有一条：重装之后实例必须与模板逐字节相同。
 */
check('升级：README（机制文档）覆盖成模板版，手改内容不保留', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, '首次安装应 exit 0');

  const readme = join(dir, '.continue', 'README.md');
  writeFileSync(readme, '# 我手改的说明书\n');
  const r = run(dir);
  if (r.status !== 0) return expect(false, '升级应 exit 0', r.stderr.slice(0, 300));

  const template = readFileSync(join(SKILL_DIR, 'assets', '.continue', 'README.md'), 'utf8');
  if (readFileSync(readme, 'utf8') !== template) {
    return expect(false, 'README 应被覆盖成模板版（否则模板改了、实例还在说旧话）');
  }
  return expect(
    !/模板有更新/.test(r.stderr),
    '覆盖之后不该再把 README 报成"模板有更新、未合并"',
    r.stderr.slice(0, 300),
  );
});

check('非 npm 项目：不凭空创建 package.json', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (existsSync(join(dir, 'package.json'))) {
    return expect(false, '没有 package.json 的项目不该被凭空造一个');
  }
  return expect(
    (r.stdout || '').includes('node .continue/hooks/worktree.mjs'),
    '应提示并行命令用 node 直跑',
    (r.stdout || '').split('\n').filter((l) => l.includes('worktree')).join(' | '),
  );
});

check('队列最后一条必须是 [自审]：缺它判红、补上转绿', (dir) => {
  git(dir, ['init', '-q']);
  const inst = run(dir);
  if (inst.status !== 0) return expect(false, 'install 应 exit 0', inst.stderr.slice(0, 300));
  const queue = join(dir, '.continue', 'doing', 'aaaa0001.md');
  const head = '# 队列 · 会话 aaaa0001\n\n> 状态：执行中\n> 创建：2026-10-23\n> 批次：20260101-0000\n\n';
  writeFileSync(queue, `${head}- [ ] 随便一条任务\n`);
  const runCheck = () =>
    spawnSync('node', ['.continue/hooks/check.mjs', 'ids'], { cwd: dir, env: baseEnv, encoding: 'utf8' });

  const bad = runCheck();
  if (bad.status === 0) return expect(false, '最后一条不是 [自审] 时应判红', `${bad.stdout}${bad.stderr}`.slice(-300));
  if (!String(bad.stderr).includes('自审')) {
    return expect(false, '报错要点名 [自审]，否则没人知道该补什么', bad.stderr.slice(-300));
  }

  // 补上自审条目 → 转绿（`[ ]` 状态不要求三层凭证）
  writeFileSync(queue, `${head}- [ ] 随便一条任务\n- [ ] [自审] 审三层目标\n`);
  const good = runCheck();
  if (good.status !== 0) return expect(false, '补上 [自审] 后应转绿', `${good.stdout}${good.stderr}`.slice(-300));

  // 勾成 [x] 但没写三层凭证 → 仍要红；补三行 → 转绿
  writeFileSync(queue, `${head}- [ ] 随便一条任务\n- [x] [自审] 审三层目标\n  - 做了什么：看过三层\n`);
  const noProof = runCheck();
  if (noProof.status === 0) return expect(false, '自审缺 L1/L2/L3 三行应判红', `${noProof.stdout}`.slice(-300));
  writeFileSync(
    queue,
    `${head}- [ ] 随便一条任务\n- [x] [自审] 审三层目标\n` +
      '  - L1：check.mjs 全绿\n  - L2：probe 场景 7 个\n  - L3：无外部反馈\n',
  );
  const withProof = runCheck();
  if (withProof.status !== 0) {
    return expect(false, '补三层凭证后应转绿', `${withProof.stdout}${withProof.stderr}`.slice(-300));
  }

  // 归档侧：收尾是"整份队列原样搬进 DONE"，但搬运没有机器核对——
  // 最新批次里丢了自审条目，就等于这批的自省记录凭空消失（DONE 是判断收敛的唯一凭据）。
  // 历史豁免靠"锚点"派生：DONE 是新→旧，比最上面那个带自审的批次更靠上的，都必须带自审。
  const done = join(dir, '.continue', 'DONE.md');
  const before = readFileSync(done, 'utf8');
  const reviewBlock = '- [x] [自审] 审三层目标\n  - L1：有检查\n  - L2：先红后绿的用例\n  - L3：无外部\n';
  const newest = `## 批次 20260101-0002 · 2026-10-23 · 会话 aaaa0001\n\n`;
  const older = `## 批次 20260101-0001 · 2026-10-23 · 会话 aaaa0001\n\n- [x] 随便一条任务\n${reviewBlock}`;
  writeFileSync(done, `${before}\n${newest}- [x] 随便一条任务\n\n${older}`);
  // 批次索引补两行，把"索引对不上"这条无关的红排除掉，只留自审这一条在考
  const overview = join(dir, '.continue', 'OVERVIEW.md');
  writeFileSync(
    overview,
    readFileSync(overview, 'utf8').replace(
      '| --- | --- | --- | --- | --- |',
      '| --- | --- | --- | --- | --- |\n' +
        '| 20260101-0002 | 2026-10-23 | 自检 | - | 回归夹具 |\n' +
        '| 20260101-0001 | 2026-10-23 | 自检 | - | 回归夹具 |',
    ),
  );
  const noReview = runCheck();
  if (noReview.status === 0) {
    return expect(false, 'DONE 最新批次缺 [自审] 应判红', `${noReview.stdout}`.slice(-300));
  }
  if (!String(noReview.stderr).includes('20260101-0002')) {
    return expect(false, '报错要点名是哪个批次缺的，否则不知道该补哪节', noReview.stderr.slice(-300));
  }
  return expect(
    (() => {
      writeFileSync(done, `${before}\n${newest}- [x] 随便一条任务\n${reviewBlock}\n${older}`);
      return runCheck().status === 0;
    })(),
    'DONE 最新批次补上 [自审] 后应转绿',
  );
});

// ------------------------------------------- 28. version 项按文件哈希判落后
/**
 * 挡的是 T25 那个坑：只比版本号时，开发期不 bump 就等于永远"一致"，
 * 而它唯一要抓的场景（技能目录被新版覆盖、实例没重装）恰好就是这么漏掉的。
 * 这条用例自己造一个技能目录，**只改模板、不动实例**，看结论会不会变。
 */
check('version 项按文件哈希判落后（版本号不动也看得出来）', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));

  // 造技能目录：audit-version 只读 VERSION 与 assets 下的托管文件
  const skillDir = join(dir, '.codebuddy', 'skills', 'continue-task');
  mkdirSync(join(skillDir, 'assets'), { recursive: true });
  cpSync(join(SKILL_DIR, 'VERSION'), join(skillDir, 'VERSION'));
  cpSync(join(SKILL_DIR, 'assets'), join(skillDir, 'assets'), { recursive: true });

  const version = () =>
    spawnSync(process.execPath, [join(dir, '.continue', 'hooks', 'audit-version.mjs')], {
      cwd: dir,
      env: baseEnv,
      encoding: 'utf8',
    }).stdout ?? '';

  const base = version();
  if (!base.includes('一致')) return expect(false, '刚装完、模板没动时应报告一致', base.trim());

  // 只改模板（等价于技能目录被新版覆盖），实例一个字节都不动
  const target = join(skillDir, 'assets', '.continue', 'hooks', 'lib.mjs');
  const original = readFileSync(target, 'utf8');
  writeFileSync(target, `${original}\n// 故意改一行\n`);
  const stale = version();
  if (!stale.includes('落后')) return expect(false, '模板改了、实例没重装 → 应报告落后', stale.trim());
  if (!stale.includes('lib.mjs')) return expect(false, '报告要点名是哪个文件落后', stale.trim());

  // 改回来必须恢复一致：判定不能是"报过一次就永远报"
  writeFileSync(target, original);
  return expect(version().includes('一致'), '模板改回后应恢复一致', version().trim());
});

// ---------------------------------- 29. project / projectSlow 的分档口径
/**
 * 挡的是 T23 那个机制**没人守**：分档全靠 `check.mjs` 里一行 `g.fast` 判定，
 * 改错（比如把慢档也当成 fast）不会报错，症状只是"pre-commit 又慢了 20 秒"。
 * 这条用例不跑内置检查（只点名 project / projectSlow 两个组 + --list），所以是毫秒级。
 */
check('check.mjs 分档：project 是快档、projectSlow 是慢档', (dir) => {
  git(dir, ['init', '-q']);
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));

  const cfg = join(dir, '.continue', 'config.json');
  const j = readJson(cfg);
  j.checks.project = ['echo FAST-TIER'];
  j.checks.projectSlow = ['echo SLOW-TIER'];
  writeFileSync(cfg, JSON.stringify(j, null, 2));

  const checkIn = (args) =>
    spawnSync(process.execPath, [join(dir, '.continue', 'hooks', 'check.mjs'), ...args], {
      cwd: dir,
      env: baseEnv,
      encoding: 'utf8',
    });
  const out = (res) => `${res.stdout ?? ''}${res.stderr ?? ''}`;

  // --list 不执行任何命令，只打印档位标签：档位映射错了这里立刻看得见
  const list = out(checkIn(['--list']));
  if (!/^fast\s+project\s/m.test(list)) return expect(false, '--list 应把 project 标成 fast', list);
  if (!/^slow\s+projectSlow\s/m.test(list)) return expect(false, '--list 应把 projectSlow 标成 slow', list);

  // 点名某一档：只跑它，不顺带另一档
  const slow = out(checkIn(['projectSlow']));
  if (!slow.includes('SLOW-TIER')) return expect(false, '点名 projectSlow 应真的跑它', slow);
  if (slow.includes('FAST-TIER')) return expect(false, '点名 projectSlow 不该顺带跑快档', slow);
  const fast = out(checkIn(['project']));
  if (!fast.includes('FAST-TIER') || fast.includes('SLOW-TIER')) {
    return expect(false, '点名 project 不该顺带跑慢档', fast);
  }

  /**
   * 真正跑一次 `--fast`（不带点名）：**只有这条默认路径**能发现"慢档被算成快档"，
   * 点名路径走的是 `explicit.includes()` 分支，改坏默认分支它照样绿。
   * 代价 ~3.5 秒（内置 hooks 自检跑一遍）：这个脚本只在技能仓库自己跑，
   * 维护者多等几秒，换"分档退化一定被抓住"——值。
   */
  const fastDefault = out(checkIn(['--fast']));
  if (fastDefault.includes('SLOW-TIER')) return expect(false, '--fast 默认路径不该跑 projectSlow', fastDefault.slice(-300));
  return expect(fastDefault.includes('FAST-TIER'), '--fast 默认路径应跑 project', fastDefault.slice(-300));
});

// ---------------------------------- 30. 慢检查不许进快档
/**
 * 挡的是 T44 那次：分档机制明明在（T23 造的），本仓库还是把 13 秒的安装器回归放回了
 * `checks.project`——所有检查全绿，代价摊在每一次 `git commit` 上，没人会去查。
 * 负向、正向各一次：放快档必须红，挪到慢档必须绿。
 */
check('audit-config：慢脚本放进 checks.project 要报错，挪到 projectSlow 才通过', (dir) => {
  git(dir, ['init', '-q']);
  if (run(dir).status !== 0) return expect(false, 'install 应 exit 0');

  const cfg = join(dir, '.continue', 'config.json');
  const slowCmd = 'node .codebuddy/skills/continue-task/scripts/test-install.mjs';
  const audit = () =>
    spawnSync(process.execPath, [join(dir, '.continue', 'hooks', 'audit-config.mjs')], {
      cwd: dir,
      env: baseEnv,
      encoding: 'utf8',
    });

  const j = readJson(cfg);
  j.checks.project = [slowCmd];
  writeFileSync(cfg, JSON.stringify(j, null, 2));
  const bad = audit();
  if (bad.status === 0) return expect(false, '慢脚本在快档里应判红', `${bad.stdout}${bad.stderr}`);
  if (!/projectSlow/.test(bad.stderr)) return expect(false, '报错要指出该放 projectSlow', bad.stderr);

  j.checks.project = [];
  j.checks.projectSlow = [slowCmd];
  writeFileSync(cfg, JSON.stringify(j, null, 2));
  const ok = audit();
  return expect(ok.status === 0, '挪进 projectSlow 后应通过', `${ok.stdout}${ok.stderr}`);
});

// ------------------------------------------------------------------ 输出
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.error(`  ✗ ${r.name}\n      ${r.why}`);
if (failed.length > 0) {
  console.error(`\n安装器回归未通过：${failed.length}/${results.length} 项。`);
  process.exit(1);
}
console.log(`安装器回归通过：${results.length} 项。`);

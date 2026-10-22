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
 *       老版本注册（命令缺 `--event=`）升级 · 已有项目文档扫描 · 来源登记幂等。
 */

import { spawnSync } from 'node:child_process';
import {
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
check('已有同名文档：原文件不动，另存 *.continue-do.md', (dir) => {
  mkdirSync(join(dir, '.continue'), { recursive: true });
  writeFileSync(join(dir, '.continue', 'TASKS.md'), '# 我自己的需求\n- [ ] T1 别动我\n');
  const r = run(dir);
  if (r.status !== 0) return expect(false, 'install 应 exit 0', r.stderr.slice(0, 300));
  if (!readFileSync(join(dir, '.continue', 'TASKS.md'), 'utf8').includes('别动我')) {
    return expect(false, '原文件被覆盖了');
  }
  return expect(existsSync(join(dir, '.continue', 'TASKS.md.continue-do.md')), '应另存一份模板供合并');
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
    existsSync(join(dir, 'AGENTS.md.continue-do.md')) && r.stderr.includes('没有生效'),
    '只另存备份不够：入口指引没生效必须告警',
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
  // 不重复注册：还是 4 条
  if (commands.length !== 4) return expect(false, `应仍是 4 条注册，实际 ${commands.length}`, commands.join(' | '));
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

// ------------------------------------------------------------------ 输出
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.error(`  ✗ ${r.name}\n      ${r.why}`);
if (failed.length > 0) {
  console.error(`\n安装器回归未通过：${failed.length}/${results.length} 项。`);
  process.exit(1);
}
console.log(`安装器回归通过：${results.length} 项。`);

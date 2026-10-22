#!/usr/bin/env node
/**
 * 聚合检查入口：`node .continue/hooks/check.mjs`
 *
 * 为什么存在（挡的是哪次事故）：
 *   各项检查分散成多个脚本后，`checks.fast` 只能写其中一条，
 *   剩下的等于"写了但没人跑"——正是"踩坑的产出是脚本、不是决心"要杜绝的（README §0 原理 3）。
 *   所以对外**只暴露一条命令**，各检查在 `CHECKS` 里登记一次。
 *
 * 用法：
 *   node .continue/hooks/check.mjs          # 跑全部（框架内置 + 项目自己的）
 *   node .continue/hooks/check.mjs ids      # 只跑某几项（按 name）
 *   node .continue/hooks/check.mjs --list   # 列出登记了哪些检查
 *
 * 项目自己的检查登记在 `.continue/config.json` 的 `checks.project`（字符串或数组），
 * **不要改这个文件的 `CHECKS`**——那是框架的登记处，改它等于升级时被覆盖。
 *
 * 退出码（契约 5）：0 全过 / 1 有检查失败 / 2 用法错误
 * 幂等（契约 9）：所有子检查都只读，不改工作区
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 项目自己的检查：`config.json` 的 `checks.project`。
 *
 * 为什么做成配置项、而不是让用户把 `checks.fast` 改成一个 shell 脚本：
 * 那样用户得自己拼"先跑框架检查、再跑项目测试"，**删掉框架那一行不会有任何提示**，
 * 编号审计和体量门禁就悄悄失效了。这里由框架保证内置检查一定先跑。
 */
const config = loadConfig();
const projectCmds = (Array.isArray(config?.checks?.project)
  ? config.checks.project
  : config?.checks?.project
    ? [config.checks.project]
    : []
)
  .map((cmd) => String(cmd).trim())
  .filter(Boolean);

/**
 * 登记处。加一条检查 = 在这里加一行（契约 2：解析而不复制，
 * 所以别在别处再维护一份清单）。
 *
 * `fast` 决定它是否属于"每次提交前都愿意跑"的那一档（秒级）。
 */
const CHECKS = [
  {
    name: 'ids',
    script: 'audit-ids.mjs',
    fast: true,
    why: '编号唯一性 + 跨文件引用完整性（队列引用的 T 必须存在）',
  },
  {
    name: 'docs',
    script: 'audit-docs.mjs',
    fast: true,
    why: '文档体量上限（入口文档是每轮都要付的上下文成本）',
  },
  {
    name: 'config',
    script: 'audit-config.mjs',
    fast: true,
    why: '配置一致性：开关表与代码双向核对、config.json 的键都有文档',
  },
  {
    name: 'hooks',
    script: 'selftest.mjs',
    fast: true,
    why: '钩子离线自检（临时副本里灌事件，断言退出码与输出）',
  },
];

const argv = process.argv.slice(2);

if (argv.includes('--list')) {
  for (const c of CHECKS) {
    console.log(`${c.fast ? 'fast' : 'full'}  ${c.name.padEnd(6)} ${c.why}`);
  }
  for (const cmd of projectCmds) console.log(`fast   project  ${cmd}`);
  process.exit(0);
}

// `--fast` 只跑快档；不带参数跑全部（全档 = 快档 + 慢档，目前没有慢档）
const onlyFast = argv.includes('--fast');
const explicit = argv.filter((a) => !a.startsWith('--'));
const knownNames = [...CHECKS.map((c) => c.name), ...(projectCmds.length > 0 ? ['project'] : [])];
const unknown = explicit.filter((name) => !knownNames.includes(name));
if (unknown.length > 0) {
  console.error(`不认识这些检查名：${unknown.join('、')}`);
  console.error(`可用：${knownNames.join(' / ')}`);
  process.exit(2);
}

const targets = CHECKS.filter((c) => {
  if (explicit.length > 0) return explicit.includes(c.name);
  return onlyFast ? c.fast : true;
});
const willRunProject = explicit.length > 0 ? explicit.includes('project') : projectCmds.length > 0;

let failed = 0;
const started = Date.now();

function report(name, why, ms, ok, out) {
  if (!ok) failed += 1;
  // 契约 4：一单元一行输出，失败才倒全文
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(6)} ${String(ms).padStart(4)}ms  ${why}`);
  if (!ok && out) {
    console.error(out.split(/\r?\n/).map((line) => `    ${line}`).join('\n'));
  }
}

for (const c of targets) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [join(HERE, c.script)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  report(c.name, c.why, Date.now() - t0, res.status === 0, `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd());
}

// 项目自己的检查：显式点名时只在点名命中「project」才跑
const wantProject = explicit.length > 0 ? explicit.includes('project') : true;
if (wantProject) {
  const timeout = Number(config?.checks?.timeoutSec ?? 180) * 1000;
  for (const cmd of projectCmds) {
    const t0 = Date.now();
    const res = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    const ok = res.status === 0;
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd();
    report(
      'project',
      `${cmd}（config.json → checks.project）`,
      Date.now() - t0,
      ok,
      ok ? '' : res.error?.code === 'ETIMEDOUT' ? `超时（checks.timeoutSec=${timeout / 1000}s）` : out,
    );
  }
}

const total = Date.now() - started;
if (failed > 0) {
  console.error(`\n${failed}/${targets.length + (willRunProject ? projectCmds.length : 0)} 项检查失败（${total}ms）。先修，别提交。`);
  process.exit(1);
}
console.log(`\n全部通过：${targets.length + (willRunProject ? projectCmds.length : 0)} 项 · ${total}ms`);

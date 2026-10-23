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
 * 项目自己的检查：`config.json` 的 `checks.project`（快档）与 `checks.projectSlow`（慢档）。
 *
 * 为什么做成配置项、而不是让用户把 `checks.fast` 改成一个 shell 脚本：
 * 那样用户得自己拼"先跑框架检查、再跑项目测试"，**删掉框架那一行不会有任何提示**，
 * 编号审计和体量门禁就悄悄失效了。这里由框架保证内置检查一定先跑。
 *
 * 为什么必须分两档（T23，挡的是本仓库自己踩的坑）：
 *   `--fast` 原来对 project **无差别全跑**，于是"挂一条 20 秒的 e2e"就等于每条提交等 20 秒——
 *   文档写着"project 必须秒级"，机制却不给分档，用户只剩两个坏选择：每次提交都等，或者不开门禁。
 *   分档后：`--fast`（pre-commit / Stop 守卫）只跑快档，全档才跑慢档。
 *   单条命令的归属由**键**决定，不靠命令内容猜（猜不准，也不可解释）。
 */
const config = loadConfig();
/** 字符串或数组都收；空值、非字符串项一律丢掉（配置写错不该让检查自己崩）。 */
const cmdList = (value) =>
  (Array.isArray(value) ? value : value ? [value] : []).map((cmd) => String(cmd).trim()).filter(Boolean);
const projectCmds = cmdList(config?.checks?.project);
const slowCmds = cmdList(config?.checks?.projectSlow);

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
  {
    /**
     * 版本项：**永远 exit 0**（不判红），但结论要打在那一行里。
     *
     * 为什么值得占一行：技能目录被新版覆盖后钩子还是旧的，"新功能装了没生效"就出在这里；
     * 为什么不判红：技能目录常常不在版本库里，CI 上没有它，判红等于对所有 CI 施加无解要求。
     * `note: true` 让通过的脚本也能把一句话带到输出里（其余检查通过时不打印 stdout）。
     */
    name: 'version',
    script: 'audit-version.mjs',
    fast: true,
    why: '框架版本 + 逐文件哈希：实例是否落后于技能模板（只提示，不拦提交）',
    note: true,
  },
];

const argv = process.argv.slice(2);

/** 两档项目检查合成一个列表：`fast` 决定它是否在 `--fast` 里跑。 */
const projectGroups = [
  ...(projectCmds.length > 0 ? [{ name: 'project', fast: true, cmds: projectCmds }] : []),
  ...(slowCmds.length > 0 ? [{ name: 'projectSlow', fast: false, cmds: slowCmds }] : []),
];

if (argv.includes('--list')) {
  for (const c of CHECKS) {
    console.log(`${c.fast ? 'fast' : 'full'}  ${c.name.padEnd(6)} ${c.why}`);
  }
  for (const g of projectGroups) {
    for (const cmd of g.cmds) console.log(`${g.fast ? 'fast' : 'slow'}  ${g.name.padEnd(6)} ${cmd}`);
  }
  process.exit(0);
}

// `--fast` 只跑快档；不带参数跑全部（全档 = 快档 + 慢档）
const onlyFast = argv.includes('--fast');
const explicit = argv.filter((a) => !a.startsWith('--'));
const knownNames = [...CHECKS.map((c) => c.name), ...projectGroups.map((g) => g.name)];
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

/**
 * 点名的照点名跑；没点名时慢档**只在全档**跑。
 * 这一行就是 T23 的全部：判据是键（`project` / `projectSlow`），不是命令内容。
 */
const wantGroups = projectGroups.filter((g) => (explicit.length > 0 ? explicit.includes(g.name) : !onlyFast || g.fast));
const planned = targets.length + wantGroups.reduce((n, g) => n + g.cmds.length, 0);

let failed = 0;
const started = Date.now();

function report(name, why, ms, ok, out, note = '') {
  if (!ok) failed += 1;
  // 契约 4：一单元一行输出，失败才倒全文；`note` 只给显式声明了 `note: true` 的检查用
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(6)} ${String(ms).padStart(4)}ms  ${why}${note ? ` · ${note}` : ''}`);
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
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd();
  const note = c.note ? String(res.stdout ?? '').trim().split(/\r?\n/)[0] : '';
  report(c.name, c.why, Date.now() - t0, res.status === 0, out, note);
}

for (const g of wantGroups) {
  const timeout = Number(config?.checks?.timeoutSec ?? 180) * 1000;
  for (const cmd of g.cmds) {
    const t0 = Date.now();
    const res = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    const ok = res.status === 0;
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd();
    report(
      g.name,
      `${cmd}（config.json → checks.${g.name}）`,
      Date.now() - t0,
      ok,
      ok ? '' : res.error?.code === 'ETIMEDOUT' ? `超时（checks.timeoutSec=${timeout / 1000}s）` : out,
    );
  }
}

const total = Date.now() - started;
if (failed > 0) {
  console.error(`\n${failed}/${planned} 项检查失败（${total}ms）。先修，别提交。`);
  process.exit(1);
}
console.log(`\n全部通过：${planned} 项 · ${total}ms`);

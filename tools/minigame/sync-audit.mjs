#!/usr/bin/env node
/**
 * main → wxminigame(-v2) 同步审计
 *
 * 目标：每次把 main merge 过来后，用同一套流程判断：
 *   1. 哪些文件是 core/render/world，可以自动同步；
 *   2. 哪些是 Web UI，必须用 Canvas UI Kit / 共享 Spec 重做；
 *   3. 哪些是 v2 自己的平台层，绝不能被 main 覆盖；
 *   4. 新代码有没有引入 adapter 尚未覆盖的浏览器 API。
 *
 * 用法：
 *   npm run sync:audit                 # 只审计
 *   npm run sync:audit -- --run        # 审计 + typecheck + 小游戏构建 + 离线门禁
 *   npm run sync:audit -- --strict     # 有风险项时返回非 0（CI 用）
 *   npm run sync:audit -- --json       # 机器可读输出
 *
 * 约定：
 *   - main 是 Web 唯一源码源；
 *   - core/render/world 尽量零改动，适配放 src/platform；
 *   - src/ui + index.html 的变更不会自动出现在 Canvas UI，必须人工迁；
 *   - src/platform、vendor、minigame 构建文件属于 v2 专属，merge 时保留 v2。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const explicitBase = valueOf('--base');
const run = has('--run');
const strict = has('--strict');
const json = has('--json');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseDiff(raw) {
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      return { status, path: paths[paths.length - 1] };
    });
}

/**
 * merge commit 自动用 HEAD^1..HEAD^2：
 *   HEAD^1 = merge 前的 v2，HEAD^2 = 被 merge 进来的 main
 * 这样审到的是“main 这次带进来的变更”，而不是 v2 自身的历史差异。
 * 非 merge 状态则退回 main...HEAD，用于查看当前分支与 main 的总体差异。
 */
function resolveRange() {
  const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1);
  if (!explicitBase && parents.length >= 2) {
    const left = parents[0];
    const right = parents[1];
    return {
      base: git('rev-parse', '--short', left),
      target: git('rev-parse', '--short', right),
      label: `merge ${git('rev-parse', '--short', left)}..${git('rev-parse', '--short', right)}`,
      raw: git('diff', '--name-status', `${left}..${right}`),
      merge: true,
    };
  }
  const base = explicitBase ?? 'main';
  return {
    base,
    target: git('rev-parse', '--abbrev-ref', 'HEAD'),
    label: `${base}...HEAD`,
    raw: git('diff', '--name-status', `${base}...HEAD`),
    merge: false,
  };
}

function categoryOf(path) {
  if (
    path.startsWith('src/ui/') ||
    path === 'index.html' ||
    path.startsWith('src/styles/') ||
    path.startsWith('src/theme/')
  ) {
    return 'UI';
  }
  if (
    path.startsWith('src/core/') ||
    path.startsWith('src/render/') ||
    path.startsWith('src/world/') ||
    path.startsWith('src/worker/') ||
    path.startsWith('src/data/')
  ) {
    return 'CORE';
  }
  if (
    path.startsWith('src/platform/') ||
    path.startsWith('src/minigame/') ||
    path.startsWith('vendor/') ||
    path.startsWith('tools/minigame/') ||
    path.startsWith('minigame-world/')
  ) {
    return 'PLATFORM';
  }
  if (
    path === 'package.json' ||
    path === 'package-lock.json' ||
    path.startsWith('tsconfig') ||
    path.startsWith('vite.config') ||
    path.startsWith('.github/')
  ) {
    return 'BUILD';
  }
  return 'OTHER';
}

const RISK_PATTERNS = [
  { label: 'DOM/document', re: /\bdocument\.(createElement|createElementNS|body|documentElement|addEventListener|querySelector)/ },
  { label: 'localStorage', re: /\blocalStorage\b/ },
  { label: 'IndexedDB', re: /\b(indexedDB|IDBKeyRange)\b/ },
  { label: 'navigator', re: /\bnavigator\./ },
  { label: 'Canvas 2D/ImageData', re: /\b(HTMLCanvasElement|ImageData|createImageBitmap|OffscreenCanvas)\b/ },
  { label: 'Worker', re: /\bnew\s+Worker\b|\bcreateWorker\b/ },
  { label: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/ },
  { label: 'AudioContext', re: /\bAudioContext\b/ },
  { label: 'PointerLock', re: /\bpointerLock|requestPointerLock\b/ },
  { label: 'Fullscreen', re: /\brequestFullscreen|fullscreenElement\b/ },
];

function scanRisks(files) {
  const hits = [];
  for (const file of files) {
    const absolute = join(ROOT, file.path);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, 'utf8');
    const lines = text.split('\n');
    for (const rule of RISK_PATTERNS) {
      lines.forEach((line, index) => {
        if (rule.re.test(line)) {
          hits.push({ file: file.path, line: index + 1, label: rule.label, code: line.trim().slice(0, 120) });
        }
      });
    }
  }
  return hits;
}

function npmScripts() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function runCheck(label, command) {
  process.stdout.write(`\n▶ ${label}\n`);
  try {
    execFileSync('npm', ['run', command], { cwd: ROOT, stdio: 'inherit' });
    return { label, command, ok: true };
  } catch {
    return { label, command, ok: false };
  }
}

const range = resolveRange();
const files = parseDiff(range.raw);
const groups = { CORE: [], UI: [], PLATFORM: [], BUILD: [], OTHER: [] };
for (const file of files) groups[categoryOf(file.path)].push(file);
const adapterRisks = scanRisks(groups.CORE);
const scripts = npmScripts();

const report = {
  base: range.base,
  target: range.target,
  range: range.label,
  merge: range.merge,
  counts: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])),
  groups,
  adapterRisks,
  checks: [],
};

if (run) {
  if (scripts.typecheck) report.checks.push(runCheck('typecheck', 'typecheck'));
  if (scripts['test:v2-core']) report.checks.push(runCheck('v2 core smoke', 'test:v2-core'));
  if (scripts['build:minigame:v2']) {
    report.checks.push(runCheck('minigame v2 build', 'build:minigame:v2'));
  } else if (scripts['build:minigame:world']) {
    report.checks.push(runCheck('minigame build', 'build:minigame:world'));
  }
  if (scripts['check:fast']) report.checks.push(runCheck('offline fast check', 'check:fast'));
}

const failedChecks = report.checks.filter((check) => !check.ok);
const hasRisks = adapterRisks.length > 0;

if (json) {
  console.log(JSON.stringify({ ...report, failedChecks, hasRisks }, null, 2));
} else {
  console.log(`\n=== main → ${report.target} 同步审计 ===`);
  console.log(`range: ${range.label}   files: ${files.length}`);
  console.log(
    `CORE ${report.counts.CORE} · UI ${report.counts.UI} · PLATFORM ${report.counts.PLATFORM} · BUILD ${report.counts.BUILD} · OTHER ${report.counts.OTHER}`,
  );

  const printGroup = (title, key, hint) => {
    const list = groups[key];
    if (list.length === 0) return;
    console.log(`\n[${key}] ${title} (${list.length})`);
    console.log(`  ${hint}`);
    list.slice(0, 40).forEach((file) => console.log(`  - ${file.status} ${file.path}`));
    if (list.length > 40) console.log(`  ... 还有 ${list.length - 40} 个`);
  };

  printGroup('核心/渲染/世界', 'CORE', '优先保持零改动；变更交给 adapter 兼容，不要手改两套。');
  printGroup('Web UI / CSS', 'UI', 'Canvas UI Kit 不会自动同步；必须按 Web 结构人工迁移或抽共享 Spec。');
  printGroup('v2 平台层', 'PLATFORM', 'v2 专属，merge 时保留 v2 版本，不要用 main 覆盖。');
  printGroup('构建/门禁', 'BUILD', '需要人工确认构建脚本与依赖。');
  printGroup('其他', 'OTHER', '逐个人工判断。');

  if (adapterRisks.length > 0) {
    console.log(`\n[ADAPTER RISK] ${adapterRisks.length} 处浏览器 API`);
    const byLabel = new Map();
    for (const hit of adapterRisks) {
      byLabel.set(hit.label, (byLabel.get(hit.label) ?? 0) + 1);
    }
    byLabel.forEach((count, label) => console.log(`  - ${label}: ${count}`));
    console.log('  先补 src/platform / vendor 垫片，再谈 core 改动。');
  } else {
    console.log('\n[ADAPTER RISK] 无新增浏览器 API');
  }

  if (report.checks.length > 0) {
    console.log('\n[CHECKS]');
    report.checks.forEach((check) => {
      console.log(`  ${check.ok ? '✓' : '✗'} ${check.label}`);
    });
  }

  console.log('\n[下一步清单]');
  console.log('  1. CORE：解决冲突 → 跑 adapter 风险扫描 → 补垫片');
  console.log('  2. UI：按上面清单在 UI Kit / 共享 Spec 中迁移，不要直接采用 main 的 DOM 文件');
  console.log('  3. PLATFORM：确认 v2 的 adapter/构建/微信工程未被覆盖');
  console.log('  4. 跑 npm run sync:audit -- --run');
  console.log('  5. 跑 Web 回归 + npm run test:minigame:flow');
  console.log('  6. 更新 WXMINIGAME.md 的同步记录');
}

if (strict && (failedChecks.length > 0 || hasRisks)) {
  process.exitCode = 1;
}

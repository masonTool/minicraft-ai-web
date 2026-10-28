#!/usr/bin/env node
/**
 * 离线测试聚合 runner（`npm run test:offline`）
 *
 * 为什么要有这个：`npm test` 原先是一条 **91 段 `&&` 的长链**，每段都是
 *   `npm run test:x` → `npm` 进程 → `sh` → `esbuild`（把整个 src 从头打包一遍）→ `node`。
 * 实测一轮 **32.0s**，但每套真正干活的只有 0.12~0.25s——**绝大部分时间花在
 * 91 次进程启动与 91 次重复的模块图解析上**（重头是 structure 6.6s / village 3.3s）。
 *
 * 这里做三件事：
 *   1. **一次 esbuild 构建全部入口**（esbuild JS API，多 entryPoints，模块图只解析一遍）；
 *   2. **多进程并行执行**（CPU 密集，默认 `核数 - 1`，重的先跑，减少尾部空闲）；
 *   3. 收走每套的 stdout，**只打印一行结果；失败的那套才把完整输出倒出来**
 *      （原来一轮会刷几千行 ✓，人看不见、AI 读着也费 token）。
 *
 * ⚠️ 产物必须输出到 `.tmp/<名字>.mjs`（**与老脚本同一层**）：
 * `tools/theme-test.ts` / `tools/ui-test.ts` 用 `new URL('../web/index.html', import.meta.url)`
 * 读仓库根的 `index.html`，深度一变就读不到了。
 *
 * 用法：
 *   node tools/run-tests.mjs                  # 全部套件
 *   node tools/run-tests.mjs --changed        # 只跑与本次改动相关的套件（内循环）
 *   node tools/run-tests.mjs --only reach,perf
 *   node tools/run-tests.mjs --jobs 6
 *   node tools/run-tests.mjs --verbose        # 打印每套的完整输出
 *   node tools/run-tests.mjs --list           # 只列出套件与入口，不执行
 *
 * **套件清单的唯一来源是 `package.json` 的 `test:*` 脚本**（解析命令里的入口文件），
 * 不另外维护一份列表——`npm run audit:tasks` 也是数同一批 key，两处不会漂。
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ 参数

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const changedOnly = has('--changed');
const verbose = has('--verbose');
const listOnly = has('--list');
const only = (valueOf('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const jobs = Math.max(1, Number(valueOf('--jobs')) || Math.max(1, cpus().length - 1));

/**
 * 这几个 key 不是"一套离线测试"：
 *  - `test:unit` / `test:unit:watch`：vitest，自带 runner；
 *  - `test:offline` / `test:offline:changed`：就是本脚本。
 *    ⚠️ `tools/audit-tasks.mjs` 里有**同一份**排除名单（它要数"91 套"这个数）。
 */
const NON_SUITE_KEYS = new Set([
  'test:unit',
  'test:unit:watch',
  'test:offline',
  'test:offline:changed',
  'test:hooks',
]);

// ------------------------------------------------------------------ 套件清单

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * 从 `test:x` 的命令里挖出入口文件，而不是另立一张表：
 *  · `esbuild tools/x-test.ts --bundle ... --outfile=.tmp/x-test.mjs && node .tmp/x-test.mjs`
 *  · `node tools/net-test.mjs`（本来就不需要打包）
 */
function parseSuite(key, command) {
  const esbuildMatch = /esbuild\s+(\S+)/.exec(command);
  if (esbuildMatch) {
    const entry = esbuildMatch[1];
    const outMatch = /--outfile=(\S+)/.exec(command);
    return { key, name: key.slice('test:'.length), entry, outfile: outMatch?.[1], bundle: true };
  }
  const nodeMatch = /^node\s+(\S+)/.exec(command.trim());
  if (nodeMatch) {
    const entry = nodeMatch[1];
    return { key, name: key.slice('test:'.length), entry, outfile: entry, bundle: false };
  }
  return null;
}

const allSuites = Object.entries(pkg.scripts ?? {})
  .filter(([key]) => key.startsWith('test:') && !NON_SUITE_KEYS.has(key))
  .map(([key, command]) => parseSuite(key, command))
  .filter(Boolean);

const unknown = Object.entries(pkg.scripts ?? {})
  .filter(([key, command]) => key.startsWith('test:') && !NON_SUITE_KEYS.has(key) && !parseSuite(key, command))
  .map(([key]) => key);
if (unknown.length > 0) {
  console.error(`✗ 认不出这些测试脚本的入口（本脚本只认 esbuild / node 两种写法）：\n  ${unknown.join('\n  ')}`);
  process.exit(2);
}

// ------------------------------------------------------------------ 选套件

const gitOut = (gitArgs) => {
  try {
    return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
};

/** 本次改动涉及的文件（相对仓库根）；不在 git 仓库里时返回 null = 当作"全都改了" */
function changedFiles() {
  const tracked = gitOut(['diff', '--name-only', 'HEAD']);
  const untracked = gitOut(['ls-files', '--others', '--exclude-standard']);
  if (tracked === null || untracked === null) return null;
  return [...new Set([...tracked, ...untracked])];
}

/**
 * 不走 esbuild 打包的套件（`node tools/x.mjs`）没有 metafile，`--changed` 里按依赖图
 * 匹配不到它们，所以**必须显式登记触发范围**。
 *
 * 为什么要登记、而不是像旧版那样"一律跑"：这几套恰好是最慢的——
 * `net` 12s（真起服务端 + 真 WebSocket）、`guard` 10s（真起浏览器），
 * 而它们要么只在 `server/node/` 改动时才可能失败，要么只测 `tools/` 里那几份工具本身。
 * 一律跑的代价是**每次提交都白等 22s**（实测 `--changed` 在干净工作区也要 22.3s，
 * 全是这两套），内循环直接失去意义。
 *
 * 没登记的非打包套件仍然**照旧全跑**（认不出依赖时保守，宁可慢也不要漏）。
 */
const NON_BUNDLE_TRIGGERS = {
  /** 真起服务端 + 真连 WebSocket，测的是 `server/node/**` 的协议行为 */
  net: ['server/node/'],
  /**
   * 下面四套是"工具自检"，**逐个列出它们真正读的东西**，不用 `tools/` 一把抓：
   * `tools/*-test.ts` 那 170 多份离线套件也住在 `tools/` 下，一把抓等于"随便改个测试
   * 文件就要起 10 秒浏览器"（实测 guard 一套就 10s）。
   */
  guard: ['tools/console-guard.mjs', 'tools/console-guard-test.mjs', 'tools/browser.mjs'],
  screenshot: ['tools/screenshot.mjs', 'tools/screenshot-test.mjs', 'tools/browser.mjs'],
  shotdiff: ['tools/shot-diff.mjs', 'tools/shot-diff-test.mjs', 'tools/browser.mjs'],
  'browser-check': ['tools/browser-check.mjs', 'tools/browser-check-test.mjs'],
};

/**
 * 这几个文件一动，结论就不再是"改哪个模块测哪套"了——它们会改变**所有**套件的
 * 打包方式或类型环境，所以直接全跑。
 */
const GLOBAL_TRIGGERS = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.tools.json',
  'vite.config.ts',
  'tools/run-tests.mjs',
]);

let suites = allSuites;
let skippedNote = null;

if (only.length > 0) {
  suites = allSuites.filter((s) => only.includes(s.name));
  const missing = only.filter((n) => !suites.some((s) => s.name === n));
  if (missing.length > 0) {
    console.error(`✗ 没有这些套件：${missing.join(', ')}（用 --list 看全部）`);
    process.exit(2);
  }
}

if (listOnly) {
  for (const s of suites) console.log(`${s.name.padEnd(14)} ${s.bundle ? s.entry : `${s.entry}（直接跑）`}`);
  console.log(`共 ${suites.length} 套`);
  process.exit(0);
}

// ------------------------------------------------------------------ 构建（一次打包全部入口）

mkdirSync(join(ROOT, '.tmp'), { recursive: true });

let metafile = null;

if (suites.some((s) => s.bundle)) {
  const banner = `离线测试 ${suites.length} 套 · 并发 ${Math.min(jobs, suites.length)}`;
  console.log(banner);

  const t0 = Date.now();
  const result = await esbuild.build({
    entryPoints: suites.filter((s) => s.bundle).map((s) => s.entry),
    bundle: true,
    platform: 'node',
    format: 'esm',
    // 必须是 `.tmp/`（见文件头注释：两套测试按 `../index.html` 找仓库根）
    outdir: '.tmp',
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
    metafile: true,
  });
  metafile = result.metafile;
  console.log(`  构建 ${Object.keys(metafile.inputs).length} 个模块 → ${(Date.now() - t0)}ms`);
}

/** entry（仓库相对路径）→ 它引用的所有文件（仓库相对路径），给 `--changed` 用 */
const depsByEntry = new Map();
/** entry → 打包产物路径。⚠️ 由 metafile 反查，不按名字拼：
 *  esbuild 的 `outdir` 会保留入口的原文件名（`tools/mob-test.ts` → `.tmp/mob-test.mjs`），
 *  而套件名是 `mob`（来自 `test:mob`）——按名字拼会全部 MODULE_NOT_FOUND。 */
const outfileByEntry = new Map();
if (metafile) {
  for (const [out, output] of Object.entries(metafile.outputs)) {
    const entryPoint = output.entryPoint;
    if (!entryPoint) continue;
    outfileByEntry.set(entryPoint, out);
    // metafile 的 `outputs[x].inputs` 是 **对象**（path → {bytesInOutput}），不是数组
    depsByEntry.set(entryPoint, Object.keys(output.inputs));
  }
}

if (changedOnly) {
  const touched = changedFiles();
  if (touched === null) {
    console.log('  （不在 git 仓库里，--changed 退化成全量）');
  } else if (touched.some((f) => GLOBAL_TRIGGERS.has(f))) {
    console.log('  （构建/配置文件有改动 → 全量）');
  } else {
    const set = new Set(touched);
    const hit = suites.filter((s) => {
      /**
       * 不走打包的套件按 `NON_BUNDLE_TRIGGERS` 的**路径前缀**匹配，不再一律跑（见那张表的注释）。
       * 没登记 = 认不出依赖 → 保守全跑。
       */
      if (!s.bundle) {
        const triggers = NON_BUNDLE_TRIGGERS[s.name];
        if (!triggers) return true;
        return touched.some((file) => triggers.some((prefix) => file.startsWith(prefix)));
      }
      const deps = depsByEntry.get(s.entry) ?? [s.entry];
      return deps.some((d) => set.has(d));
    });
    if (hit.length === 0) {
      console.log(
        `\n本次改了 ${touched.length} 个文件，但**没有任何离线套件覆盖它们**：\n  ${touched.slice(0, 12).join('\n  ')}${
          touched.length > 12 ? `\n  …还有 ${touched.length - 12} 个` : ''
        }\n` +
          '（多为 `src/main.ts` / `src/ui` / `src/render` 这类只在浏览器里才能验证的路径。）\n' +
          '提交前请跑 `npm run check` 全量。',
      );
      process.exit(0);
    }
    suites = hit;
    console.log(`  改动命中 ${suites.length} / ${allSuites.length} 套 → ${suites.map((s) => s.name).join(' ')}`);
  }
}

// ------------------------------------------------------------------ 执行

/** 重的先跑：并发的尾部不会卡在一套 6 秒的测试上 */
const sizeOf = (s) => {
  const deps = depsByEntry.get(s.entry);
  if (deps) return deps.length;
  try {
    return readFileSync(join(ROOT, s.entry), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
};
suites = [...suites].sort((a, b) => sizeOf(b) - sizeOf(a));

const results = [];

const runOne = (suite) =>
  new Promise((done) => {
    if (!suite.bundle && !existsSync(join(ROOT, suite.entry))) {
      results.push({ suite, code: 1, ms: 0, output: `找不到入口 ${suite.entry}` });
      return done();
    }
    const relative = suite.bundle ? outfileByEntry.get(suite.entry) : suite.entry;
    if (!relative) {
      results.push({ suite, code: 1, ms: 0, output: `esbuild 没有产出 ${suite.entry} 的产物` });
      return done();
    }
    const script = join(ROOT, relative);
    const t0 = Date.now();
    const child = spawn(process.execPath, [script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (err) => {
      results.push({ suite, code: 1, ms: Date.now() - t0, output: `启动失败：${String(err)}` });
      done();
    });
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      const ok = code === 0;
      results.push({ suite, code, ms, output });
      const line = `  ${ok ? '✓' : '✗'} ${suite.name.padEnd(14)} ${(ms / 1000).toFixed(2)}s`;
      if (!ok) {
        console.log(line);
        console.log(
          output
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n'),
        );
      } else if (verbose) {
        console.log(line);
        console.log(
          output
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n'),
        );
      }
      done();
    });
  });

/** 按给定并发跑一批（各批互不重叠，`cursor` 是批内共享的） */
const runBatch = async (list, concurrency) => {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, async () => {
      while (cursor < list.length) {
        await runOne(list[cursor++]);
      }
    }),
  );
};

const t0 = Date.now();
// ⚠️ 这里曾经有个"安静阶段"（把带绝对耗时预算的几套单独串行跑）——批次 103 的 B103-5
// 把那些断言改成**比值**之后就不需要了：比值在同一次运行里量分子分母，与争用无关。
// 见 `perf-bench.ts` / `decor-test.ts` / `nether-test.ts` 里各自的判据说明。
/*
 * `net` 独占跑（不与其它套件并发）。
 *
 * 它要 spawn 真实服务端、等广播、按毫秒级的窗口确认"应该没收到"，是唯一对**时序**
 * 敏感的套件；与别的套件抢 CPU 时会出现假红（本批撞见过两次：单跑 120 通过，
 * 并发时红一次、重跑又绿）。而它本来也是最慢的一套（~14s），独占几乎不增加总时长
 * ——瓶颈一直是它，其它套件并发着跑完也到不了 14s。
 */
const exclusive = suites.filter((s) => s.name === 'net');
const shared = suites.filter((s) => s.name !== 'net');
await runBatch(exclusive, 1);
await runBatch(shared, jobs);
const wall = Date.now() - t0;

// ------------------------------------------------------------------ 汇总

const failed = results.filter((r) => r.code !== 0);
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);

console.log(
  `\n离线测试：通过 ${results.length - failed.length} / ${results.length} 套 · 总耗时 ${(wall / 1000).toFixed(1)}s` +
    `（并发 ${Math.min(jobs, suites.length)}）`,
);
console.log(`最慢：${slowest.map((r) => `${r.suite.name} ${(r.ms / 1000).toFixed(2)}s`).join(' · ')}`);

if (failed.length > 0) {
  console.log(`\n✗ 失败 ${failed.length} 套：${failed.map((r) => r.suite.name).join(', ')}`);
  process.exit(1);
}
console.log('✓ 全绿');

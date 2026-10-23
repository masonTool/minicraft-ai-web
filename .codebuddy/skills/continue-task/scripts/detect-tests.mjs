#!/usr/bin/env node
/**
 * 探测「这个项目怎么测试」——**只读**，不改任何文件。
 *
 * 为什么存在（挡的是哪次事故）：
 *   安装器把 `checks.project` 留成空数组时，提交门禁只跑框架自检（ids / docs / config / hooks），
 *   项目自己的测试**从来没进过门禁**。本项目就踩过：10 条 CLI 回归测试一条没跑，
 *   而 `DONE.md` 里还写着"`check.mjs --fast` 全绿"——那句话当时不含这些测试。
 *
 *   但框架**不应该知道**每个项目用什么测（npm / cargo / go / pytest…），那正是"通用框架"的边界。
 *   所以这个脚本只做一件框架能做的事：**看项目里现成的证据**，把项目**自己的**测试命令找出来。
 *   找不到就如实说"没有可自动跑的测试"，交建议清单——绝不替项目编一个命令。
 *
 * 输出契约（`install.mjs` 与 `test-install.mjs` 读它）：
 *   { root, stack, commands, confidence, evidence, suggestions }
 *   · `commands` 为空 = 没找到可跑的测试。**这不是错误**，安装器据此保持 `project` 为空；
 *   · `suggestions` 只在 `commands` 为空时才有内容：要补什么才算"有测试可跑"。
 *
 * 一条刻意的取舍：**命中第一个生态就停**，不合并多栈（monorepo 里 node + go 并存时不并跑）。
 * 理由：门禁是每次提交都跑的东西，塞两条测试命令等于让每条提交都慢一倍；
 * 真需要多栈就把另一条手写进 `checks.project`，而不是让探测器猜。
 *
 * 用法：
 *   node scripts/detect-tests.mjs          # 人读（给用户 / AI 看）
 *   node scripts/detect-tests.mjs --json   # 机器读（安装器用）
 * 退出码恒为 0：探测不到不是失败，是结论。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 扫描时直接跳过的目录：测试文件探测只需要看源码区，进这些目录既慢又会误判。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.continue',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
]);

const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const isDir = (file) => {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
};

/**
 * 浅层递归找文件。**带深度与数量上限**：探测发生在安装时，不能因为用户仓库大
 * 就把安装拖成几十秒；到上限就当"没找到"，宁可漏也不卡。
 */
function findFiles(root, match, { maxDepth = 3, limit = 4000 } = {}) {
  const found = [];
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= limit) return;
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (found.length >= limit) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
        continue;
      }
      visited += 1;
      if (visited > limit) return;
      if (match(entry.name)) found.push(join(dir, entry.name));
    }
  };
  walk(root, 1);
  return found;
}

const TEST_FILE_RE = /(\.|-|_)(test|spec)\.[cm]?[jt]sx?$/i;

/** 默认测试文件长什么样（只用来判断"有没有测试"，不用来推断命令）。 */
const looksLikeNodeTest = (name) => TEST_FILE_RE.test(name) || /^test-.*\.[cm]?[jt]s$/i.test(name);

// ------------------------------------------------------------------ 各生态

function detectNode(root) {
  const pkgFile = join(root, 'package.json');
  if (!isFile(pkgFile)) return null;
  const raw = read(pkgFile);
  let pkg = null;
  try {
    pkg = JSON.parse(raw ?? '');
  } catch {
    return {
      stack: ['node'],
      commands: [],
      confidence: 'none',
      evidence: ['package.json 存在但解析失败（JSON 语法错误）'],
      suggestions: ['先修 `package.json` 的 JSON 语法，再跑一次安装（现在探测器读不到 scripts.test）'],
    };
  }

  const scripts = pkg.scripts ?? {};
  const test = typeof scripts.test === 'string' ? scripts.test.trim() : '';
  /**
   * npm 初始化时写的那条占位脚本要当成"没有测试"：
   * 它**退出码非 0**（`exit 1`），真接进门禁会把每次提交都判红，
   * 症状是"装完框架就提交不了了"——比没接上更糟。
   */
  const placeholder = !test || /no test specified/i.test(test);
  if (!placeholder) {
    return {
      stack: ['node'],
      commands: ['npm test'],
      confidence: 'high',
      evidence: [`package.json → scripts.test = ${test}`],
      suggestions: [],
    };
  }

  for (const alt of ['test:unit', 'test:ci', 'check:test']) {
    if (typeof scripts[alt] === 'string' && scripts[alt].trim()) {
      return {
        stack: ['node'],
        commands: [`npm run ${alt}`],
        confidence: 'medium',
        evidence: [`package.json → scripts["${alt}"]（scripts.test 是空的）`],
        suggestions: [],
      };
    }
  }

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const runner = [
    ['vitest', 'npx vitest run'],
    ['jest', 'npx jest --ci'],
    ['mocha', 'npx mocha'],
    ['ava', 'npx ava'],
  ].find(([name]) => deps[name]);
  if (runner) {
    return {
      stack: ['node'],
      commands: [runner[1]],
      confidence: 'medium',
      evidence: [`package.json → devDependencies 里有 ${runner[0]}，但没有 scripts.test`],
      suggestions: [],
    };
  }

  const tests = findFiles(root, looksLikeNodeTest, { maxDepth: 3 });
  if (tests.length > 0) {
    const rel = tests[0].slice(root.length + 1);
    return {
      stack: ['node'],
      commands: ['node --test'],
      confidence: 'low',
      evidence: [`有测试文件（如 ${rel}）但没有 scripts.test / 测试依赖`],
      suggestions: [],
    };
  }

  return {
    stack: ['node'],
    commands: [],
    confidence: 'none',
    evidence: [
      // 占位脚本和"根本没有脚本"要分开说：前者是**看着有、一跑就红**，比没有更坑
      test
        ? `package.json → scripts.test 是 npm 的占位脚本（${test}），等于没有测试`
        : 'package.json 存在，但没有 scripts.test、没有测试依赖、也没有测试文件',
    ],
    suggestions: [
      '加一个能跑的测试入口：`package.json` 的 `scripts.test` 指向 `node --test test/*.test.mjs`（Node 18+ 自带，零依赖）',
      '再放一个 `test/smoke.test.mjs`：`import test from "node:test"; import assert from "node:assert"; test("冒烟", () => assert.equal(1 + 1, 2));`',
      '然后重新跑一次安装，`checks.project` 会自动填上 `npm test`',
    ],
  };
}

function detectRust(root) {
  if (!isFile(join(root, 'Cargo.toml'))) return null;
  return {
    stack: ['rust'],
    commands: ['cargo test'],
    confidence: 'high',
    evidence: ['Cargo.toml'],
    suggestions: [],
  };
}

function detectGo(root) {
  if (!isFile(join(root, 'go.mod'))) return null;
  return {
    stack: ['go'],
    commands: ['go test ./...'],
    confidence: 'high',
    evidence: ['go.mod'],
    suggestions: [],
  };
}

function detectPython(root) {
  const markers = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pytest.ini', 'tox.ini'];
  const present = markers.filter((name) => isFile(join(root, name)));
  const pyTests = findFiles(root, (name) => /^test_.*\.py$|.*_test\.py$/.test(name), { maxDepth: 3 });
  if (present.length === 0 && pyTests.length === 0) return null;

  const blob = present.map((name) => read(join(root, name)) ?? '').join('\n');
  const hasPytest = /pytest/i.test(blob) || isFile(join(root, 'pytest.ini'));
  if (hasPytest || pyTests.some((file) => /import pytest|from pytest/.test(read(file) ?? ''))) {
    return {
      stack: ['python'],
      commands: ['pytest -q'],
      confidence: hasPytest ? 'high' : 'medium',
      evidence: [
        ...(hasPytest ? [`${present.find((n) => /pytest/i.test(read(join(root, n)) ?? '')) ?? 'pytest.ini'} 里提到 pytest`] : []),
        ...(pyTests.length > 0 ? [`找到 ${pyTests.length} 个 pytest 风格的测试文件`] : []),
      ],
      suggestions: [],
    };
  }
  if (pyTests.length > 0) {
    return {
      stack: ['python'],
      commands: ['python3 -m unittest discover -q'],
      confidence: 'medium',
      evidence: [`找到 ${pyTests.length} 个 test_*.py，但依赖里没有 pytest`],
      suggestions: [],
    };
  }
  return {
    stack: ['python'],
    commands: [],
    confidence: 'none',
    evidence: [`有 Python 项目标记（${present.join('、')}），但没找到测试文件`],
    suggestions: [
      '装 `pytest`（写进 `requirements-dev.txt` 或 `pyproject.toml` 的 dev 依赖）',
      '建 `tests/test_smoke.py`：`def test_smoke(): assert 1 + 1 == 2`',
      '然后重新跑一次安装，`checks.project` 会自动填上 `pytest -q`',
    ],
  };
}

function detectMaven(root) {
  if (!isFile(join(root, 'pom.xml'))) return null;
  return {
    stack: ['java'],
    commands: ['mvn -q test'],
    confidence: 'high',
    evidence: ['pom.xml'],
    suggestions: [],
  };
}

function detectGradle(root) {
  const build = ['build.gradle', 'build.gradle.kts'].find((name) => isFile(join(root, name)));
  if (!build) return null;
  const wrapper = isFile(join(root, 'gradlew'));
  return {
    stack: ['java'],
    commands: [wrapper ? './gradlew test' : 'gradle test'],
    confidence: wrapper ? 'high' : 'medium',
    evidence: [build, ...(wrapper ? ['gradlew（用 wrapper，不依赖本机 gradle 版本）'] : ['没有 gradlew，退回本机 gradle'])],
    suggestions: [],
  };
}

function detectDotnet(root) {
  const projects = findFiles(root, (name) => /\.(sln|csproj)$/i.test(name), { maxDepth: 2 });
  if (projects.length === 0) return null;
  return {
    stack: ['dotnet'],
    commands: ['dotnet test'],
    confidence: 'high',
    evidence: [projects[0].slice(root.length + 1)],
    suggestions: [],
  };
}

function detectPhp(root) {
  const config = ['phpunit.xml', 'phpunit.xml.dist'].find((name) => isFile(join(root, name)));
  if (!config) return null;
  return {
    stack: ['php'],
    commands: ['vendor/bin/phpunit'],
    confidence: 'high',
    evidence: [config],
    suggestions: [],
  };
}

function detectRuby(root) {
  if (!isFile(join(root, 'Gemfile'))) return null;
  if (isDir(join(root, 'spec'))) {
    return {
      stack: ['ruby'],
      commands: ['bundle exec rspec'],
      confidence: 'high',
      evidence: ['Gemfile', 'spec/'],
      suggestions: [],
    };
  }
  const rakefile = read(join(root, 'Rakefile')) ?? '';
  if (/^test\b/m.test(rakefile)) {
    return {
      stack: ['ruby'],
      commands: ['rake test'],
      confidence: 'medium',
      evidence: ['Gemfile', 'Rakefile 里有 test 任务'],
      suggestions: [],
    };
  }
  return {
    stack: ['ruby'],
    commands: [],
    confidence: 'none',
    evidence: ['Gemfile 存在，但既没有 spec/ 也没有 Rakefile 的 test 任务'],
    suggestions: [
      '建 `spec/smoke_spec.rb` 并加 `rspec` 到 Gemfile 的 test 组',
      '然后重新跑一次安装，`checks.project` 会自动填上 `bundle exec rspec`',
    ],
  };
}

/** 兜底：Makefile 里有 `test:` 目标。放最后——有正经生态时不该被它抢先。 */
function detectMake(root) {
  const text = read(join(root, 'Makefile'));
  if (!text || !/^test\s*:/m.test(text)) return null;
  return {
    stack: ['make'],
    commands: ['make test'],
    confidence: 'low',
    evidence: ['Makefile 里有 test: 目标'],
    suggestions: [],
  };
}

/**
 * 规则表：**顺序即优先级**。放在前面的是"证据最强、最不可能是误判"的形态。
 * `make test` 排最后：它经常只是 `npm test` 的转发，先命中它会把生态判错。
 */
const DETECTORS = [
  detectNode,
  detectRust,
  detectGo,
  detectPython,
  detectMaven,
  detectGradle,
  detectDotnet,
  detectPhp,
  detectRuby,
  detectMake,
];

/** 探测本身：纯函数式，只读文件系统，不写任何东西。 */
export function detectTests(root = process.cwd()) {
  const at = resolve(root);
  for (const detector of DETECTORS) {
    const hit = detector(at);
    if (hit) return { root: at, ...hit };
  }
  return {
    root: at,
    stack: [],
    commands: [],
    confidence: 'none',
    evidence: ['没有识别出任何测试生态（package.json / Cargo.toml / go.mod / pyproject.toml / pom.xml / *.csproj / phpunit.xml …）'],
    suggestions: [
      '先做一个最小的可执行断言：哪怕只有一条"启动不报错"，也比"没有测试"强——门禁才有东西可跑',
      '按项目语言选最省事的入口：Node → `node --test`；Python → `pytest -q`；Go → `go test ./...`；Rust → `cargo test`',
      '把命令写进 `.continue/config.json` 的 `checks.project`，或重新跑一次安装让探测器自动填',
    ],
  };
}

/** 人读输出：一行结论 + 逐条依据 / 建议。 */
export function formatReport(result) {
  const lines = [];
  if (result.commands.length > 0) {
    lines.push(`探测到测试命令（${result.stack.join(' + ') || '未知生态'} · 把握 ${result.confidence}）：`);
    for (const cmd of result.commands) lines.push(`  ✓ ${cmd}`);
    for (const why of result.evidence) lines.push(`    · 依据：${why}`);
    lines.push('');
    lines.push('要接进提交门禁，写进 `.continue/config.json` 的 `checks.project`；安装器会自动填。');
    return lines.join('\n');
  }
  lines.push('没找到可自动跑的测试命令。');
  for (const why of result.evidence) lines.push(`  · ${why}`);
  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('建议（按顺序做，做完重新跑安装即可自动接进门禁）：');
    result.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  return lines.join('\n');
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = detectTests(process.cwd());
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(result)}\n`);
  }
  process.exit(0);
}

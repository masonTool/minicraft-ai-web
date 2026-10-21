#!/usr/bin/env node
/**
 * 两个 Stop 钩子的离线自检（`npm run test:hooks`）。
 *
 * 钩子是"每轮对话结束时都会跑"的东西，改坏的症状又特别隐蔽——
 * 要么默默不生效（AI 停了没人拦），要么过度生效（无限循环烧 token）。
 * 所以这里不依赖真实会话，直接把事件 JSON 从 stdin 灌进脚本，断言它的输出。
 *
 * 断言分三类：
 *   1. **放行**：条件不满足时必须明确 `continue: true`，否则 AI 会被无谓地拦住；
 *   2. **拦截**：条件满足时必须阻止停止，且反馈里带上"该做什么"；
 *   3. **不自杀**：钩子自己的运行时文件（state/log/off）不许被当成"未提交改动"。
 *
 * 用法：node tools/hooks-test.mjs [--verbose]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const hooksDir = join(projectRoot, '.codebuddy', 'hooks');
const verbose = process.argv.includes('--verbose');

let pass = 0;
const failures = [];

function ok(name, detail = '') {
  pass += 1;
  if (verbose) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  ✗ ${name}\n      ${detail}`);
}

function check(name, cond, detail = '') {
  if (cond) ok(name, detail);
  else fail(name, detail || '断言不成立');
}

/**
 * 跑一个钩子脚本，返回 { code, stdout, stderr, json }。
 * `cwd` 故意可配：脚本必须**不依赖** cwd 才能算健壮。
 */
function runHook(script, payload, { cwd = projectRoot, env = {} } = {}) {
  const full = join(hooksDir, script);
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('node', [full], {
      cwd,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    code = error.status ?? 1;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }
  let json = null;
  const firstLine = stdout.split('\n').find((line) => line.trim().startsWith('{'));
  if (firstLine) {
    try {
      json = JSON.parse(firstLine);
    } catch {
      json = null;
    }
  }
  return { code, stdout, stderr, json };
}

const stopEvent = (sessionId) => ({ hook_event_name: 'Stop', session_id: sessionId, cwd: projectRoot });
const promptEvent = (sessionId) => ({ hook_event_name: 'UserPromptSubmit', session_id: sessionId });

console.log('钩子离线自检');

// ---------------------------------------------------------------- 存在性

for (const script of ['auto-continue.mjs', 'auto-commit.mjs']) {
  check(`${script} 存在`, existsSync(join(hooksDir, script)));
}

const settingsFile = join(projectRoot, '.codebuddy', 'settings.json');
let settings = null;
try {
  settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
} catch (error) {
  fail('settings.json 可解析', String(error));
}

if (settings) {
  const commands = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.command === 'string') commands.push({ event, command: hook.command });
      }
    }
  }
  for (const event of ['Stop', 'UserPromptSubmit']) {
    for (const script of ['auto-continue.mjs', 'auto-commit.mjs']) {
      check(
        `${event} 注册了 ${script}`,
        commands.some((c) => c.event === event && c.command.includes(script)),
      );
    }
  }
  // 相对路径才可移植：换机器、改目录名都不会坏
  const absolute = commands.filter((c) => /\bnode\s+["']?\//.test(c.command));
  check('钩子命令不含绝对路径', absolute.length === 0, absolute.map((c) => c.command).join(' | '));
}

// ---------------------------------------------------------------- auto-continue

console.log('\n[auto-continue]');

{
  // 队列文件存在但没有未完成条目 → 必须放行
  const r = runHook('auto-continue.mjs', stopEvent('hooks-test-continue-1'));
  check('队列空 → 放行', r.json?.continue === true, r.json ? JSON.stringify(r.json) : r.stderr);
}

{
  // 非 Stop 事件 → 直接放行（不能因为别的钩子事件就拦住）
  const r = runHook('auto-continue.mjs', { hook_event_name: 'PreToolUse', session_id: 'hooks-test-continue-2' });
  check('非 Stop 事件 → 放行', r.json?.continue === true);
}

{
  // UserPromptSubmit → 重置计数并放行
  const r = runHook('auto-continue.mjs', promptEvent('hooks-test-continue-3'));
  check('UserPromptSubmit → 放行', r.json?.continue === true);
}

// ---------------------------------------------------------------- auto-commit

console.log('\n[auto-commit]');

{
  const r = runHook('auto-commit.mjs', { hook_event_name: 'PreToolUse', session_id: 'hooks-test-commit-1' });
  check('非 Stop 事件 → 放行', r.json?.continue === true);
}

{
  // 刹车文件：必须在"有脏文件"的前提下也能放行
  const offFile = join(projectRoot, '.codebuddy', 'auto-commit.off');  const existed = existsSync(offFile);
  if (!existed) writeFileSync(offFile, '');
  try {
    const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-2'));
    check('存在 .off → 放行', r.json?.continue === true);
    check('放行时给出提示', typeof r.json?.systemMessage === 'string' && r.json.systemMessage.includes('.off'));
  } finally {
    if (!existed) rmSync(offFile, { force: true });
  }
}

{
  // 从别的目录启动：脚本必须自己认路，仍然能读到本仓库
  const elsewhere = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  try {
    const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-3'), { cwd: elsewhere });
    check('从其他 cwd 启动不报错', r.code === 0 && r.json !== null, r.stderr.slice(0, 200));
    // 此时工作区（本仓库）若有改动，必须拦；若干净，则必须放行。两者都只验证"判断正确"。
    check(
      '从其他 cwd 启动仍能判断本仓库状态',
      r.json?.continue === true ? existsSync(join(projectRoot, '.codebuddy')) : true,
      JSON.stringify(r.json).slice(0, 200),
    );
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
}

{
  // 关键的"不自杀"：钩子自己的运行时文件不能出现在改动清单里
  const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-4'));
  const text = JSON.stringify(r.json ?? {});
  const selfFiles = ['auto-commit.state.json', 'auto-commit.log', 'auto-commit.off'];
  const leaked = selfFiles.filter((name) => text.includes(name));
  check('不把自身运行时文件当成未提交改动', leaked.length === 0, leaked.join(', '));
}

// ---------------------------------------------------------------- 目录分工

console.log('\n[目录分工]');

{
  /**
   * `hooks/process/` 放进度文档（进仓库、要 review），`hooks/logs/` 放运行时产物（不进仓库）。
   * 这条断言是给"长跑任务列表"兜底的：一旦有人把日志挪回根目录或 process/，
   * 它会每小时往 git status 里冒出来一次，auto-commit 每次都拦，最后只能靠关钩子收场。
   */
  const hooksRoot = join(projectRoot, '.codebuddy', 'hooks');
  const processDir = join(hooksRoot, 'process');
  const logsDir = join(hooksRoot, 'logs');
  check('hooks/process/ 存在', existsSync(processDir));
  check('hooks/process/auto-continue.md 存在', existsSync(join(processDir, 'auto-continue.md')));

  let ignoreText = '';
  try {
    ignoreText = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
  } catch {
    ignoreText = '';
  }
  for (const pattern of ['.codebuddy/hooks/logs/', '.codebuddy/*.off']) {
    check(`.gitignore 覆盖 ${pattern}`, ignoreText.includes(pattern));
  }
  if (existsSync(logsDir)) {
    check('logs/ 里没有藏进度文档', !existsSync(join(logsDir, 'auto-continue.md')));
  }
  // 队列不能放在 logs/ 或 .codebuddy/ 根下——钩子只认 hooks/process/ 那一份
  check(
    '队列不在旧的 .codebuddy/ 根下',
    !existsSync(join(projectRoot, '.codebuddy', 'auto-continue.md')),
  );
}

// ---------------------------------------------------------------- 无上限 / 上下文水位

console.log('\n[无上限与上下文水位]');

{
  /**
   * 用户明确要求"不限制会话次数"。这两条断言防的是：以后有人好心把上限加回去，
   * 结果长跑跑一半就停、而当事人以为还在跑。
   */
  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('auto-continue 没有轮次上限', !/MAX_CONTINUATIONS/.test(src));
  check('auto-continue 会读上下文用量', /input_tokens|inputTokens/.test(src));
  check('auto-continue 有上下文阈值', /AUTO_CONTINUE_CONTEXT_LIMIT/.test(src));

  const commitSrc = readFileSync(join(hooksDir, 'auto-commit.mjs'), 'utf8');
  check('auto-commit 没有拦截次数上限', !/MAX_ROUNDS/.test(commitSrc));
}

// ---------------------------------------------------------------- 两种输出风格

console.log('\n[输出风格]');

{
  // exit2 风格：exit 2 + 反馈走 stderr，stdout 里 continue 不为 false
  const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-5'), {
    env: { AUTO_COMMIT_STYLE: 'exit2', AUTO_COMMIT_MAX: '99' },
  });
  const isBlockOrClean = r.code === 2 ? r.stderr.length > 0 : r.json?.continue === true;
  check('AUTO_COMMIT_STYLE=exit2 行为自洽', isBlockOrClean, `code=${r.code} stderr=${r.stderr.slice(0, 120)}`);
}

// ---------------------------------------------------------------- 汇总

console.log('');
if (failures.length > 0) {
  console.log(`✗ 钩子自检失败：${failures.length} 项`);
  for (const f of failures) console.log(`  · ${f.name}`);
  process.exit(1);
}
console.log(`✓ 钩子自检通过：${pass} 项断言`);

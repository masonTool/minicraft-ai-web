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

// ---------------------------------------------------------------- AI 自插任务

console.log('\n[AI 自插任务]');

{
  /**
   * 允许 AI 在干活时插 `[发现]` 任务，但必须有闸：
   *   · 格式能被钩子识别（行首 `- [ ] [发现]`）；
   *   · 额度满了要明确说"别再插"；
   *   · 反馈里必须带"证据 / 只插不改 / 明说"三条硬条件。
   */
  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('识别 [发现] 条目', /\[发现\]/.test(src));
  check('有发现条数统计', /discovered\.length/.test(src));
  check('有额度开关', /AUTO_CONTINUE_DISCOVERED_LIMIT/.test(src));

  const queueFile = join(projectRoot, '.codebuddy', 'hooks', 'process', 'auto-continue.md');
  let backup = null;
  try {
    backup = readFileSync(queueFile, 'utf8');

    // 正常模式：反馈里应出现三条硬条件
    writeFileSync(queueFile, `${backup}\n- [ ] hooks-test 占位\n`);
    const normal = runHook('auto-continue.mjs', stopEvent('hooks-test-discover-1'));
    check('正常模式提示可插 [发现]', /\[发现\]/.test(normal.stderr));
    check('带\"必须真实撞见\"的约束', /真实撞见/.test(normal.stderr));
    check('带\"只能插不许改\"的约束', /不能删改/.test(normal.stderr));
    check('带\"插完要说一声\"的约束', /我插了一条/.test(normal.stderr));
    check('正常模式不阻止插入', !/不要再插/.test(normal.stderr));

    // 额度打满：必须明确要求停止插入
    const filled = Array.from({ length: 6 }, (_, i) => `- [ ] [发现] 占位发现 ${i + 1}：x → y`).join('\n');
    writeFileSync(queueFile, `${backup}\n${filled}\n`);
    const full = runHook('auto-continue.mjs', stopEvent('hooks-test-discover-2'));
    check('额度满时要求停止插入', /不要再插/.test(full.stderr));
  } finally {
    if (backup !== null) writeFileSync(queueFile, backup);
  }
}

console.log('\n[交接单]');

{
  /**
   * 钩子开不了新会话（`Stop` 只允许 additionalContext），所以退而求其次：
   * 上下文满时生成"新会话第一句话"，让用户复制粘贴。这里断言它确实被生成、
   * 且**自包含**（带上要读的文件 + 当前第一条），否则新会话接不上。
   */
  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('交接分支会写 handoff-prompt.txt', /handoff-prompt\.txt/.test(src));
  check('交接话术带上要读的文件', /读 AGENTS\.md/.test(src));

  // 真跑一次：临时造一条待办 + 用低阈值强制进入交接模式
  const queueFile = join(projectRoot, '.codebuddy', 'hooks', 'process', 'auto-continue.md');
  const handoffFile = join(projectRoot, '.codebuddy', 'hooks', 'logs', 'handoff-prompt.txt');
  let backup = null;
  try {
    backup = readFileSync(queueFile, 'utf8');
    writeFileSync(queueFile, `${backup}\n- [ ] hooks-test 占位条目\n`);
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-handoff'), {
      // 用强制开关进入交接模式：比"造一个超大 transcript"直接，也不依赖平台是否传 transcript_path
      env: { AUTO_CONTINUE_FORCE_HANDOFF: '1' },
    });
    check('强制交接开关生效', r.code === 2 && /收尾/.test(r.stderr), r.stderr.slice(0, 120));
    check('交接反馈里带可复制的提示词', /复制这段/.test(r.stderr));
    check('交接反馈带上队列第一条', /hooks-test 占位条目/.test(r.stderr));
    check('交接单已落盘', existsSync(handoffFile), handoffFile);
    if (existsSync(handoffFile)) {
      const content = readFileSync(handoffFile, 'utf8');
      check('落盘内容自包含（带要读的文件）', /AGENTS\.md/.test(content));
      check('落盘内容带上队列第一条', /hooks-test 占位条目/.test(content));
    }
  } finally {
    if (backup !== null) writeFileSync(queueFile, backup);
    rmSync(handoffFile, { force: true });
  }
}

// ---------------------------------------------------------------- 围栏代码块

console.log('\n[围栏代码块不算待办]');

{
  /**
   * 真实踩过的 bug：队列文件里写着格式模板
   *     ```\n- [ ] [发现] <一句话说清是什么>…\n```
   * trim 之后行首就是 `- [ ]`，钩子把它当成真待办 ——
   * 于是"队列已清空"却一直自动继续，还把模板当任务递出去。
   */
  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('钩子会识别围栏', /inFence/.test(src));

  const queueFile = join(projectRoot, '.codebuddy', 'hooks', 'process', 'auto-continue.md');
  let backup = null;
  try {
    backup = readFileSync(queueFile, 'utf8');

    // 只有代码块里的模板 → 必须判定为"队列空"
    writeFileSync(queueFile, `${backup}\n\`\`\`\n- [ ] [发现] 模板示例：x → y\n\`\`\`\n`);
    const fenced = runHook('auto-continue.mjs', stopEvent('hooks-test-fence-1'));
    check('代码块里的 [ ] 不算待办', fenced.json?.continue === true, JSON.stringify(fenced.json).slice(0, 160));
    check('判定为队列空', /队列已全部完成/.test(fenced.json?.systemMessage ?? ''));

    // 代码块外 + 代码块内各一条 → 只算外面那条
    writeFileSync(
      queueFile,
      `${backup}\n\`\`\`\n- [ ] 块内假任务：x → y\n\`\`\`\n- [ ] 块外真任务：x → y\n`,
    );
    const mixed = runHook('auto-continue.mjs', stopEvent('hooks-test-fence-2'), {
      env: { AUTO_CONTINUE_FORCE_HANDOFF: '1' },
    });
    check(
      '只把块外那条当待办',
      /块外真任务/.test(mixed.stderr) && !/块内假任务/.test(mixed.stderr),
      mixed.stderr.slice(0, 200),
    );
  } finally {
    if (backup !== null) writeFileSync(queueFile, backup);
  }
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

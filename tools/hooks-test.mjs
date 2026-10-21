#!/usr/bin/env node
/**
 * 四个钩子的离线自检（`npm run test:hooks`）。
 *
 * 钩子是"每轮对话结束时都会跑"的东西，改坏的症状又特别隐蔽——
 * 要么默默不生效（AI 停了没人拦），要么过度生效（无限循环烧 token）。
 * 所以这里不依赖真实会话，直接把事件 JSON 从 stdin 灌进脚本，断言它的输出。
 *
 * 断言分四类：
 *   1. **放行**：条件不满足时必须明确 `continue: true`，否则 AI 会被无谓地拦住；
 *   2. **拦截**：条件满足时必须阻止停止（exit 2），且反馈里带上"该做什么"；
 *   3. **不自杀**：钩子自己的运行时文件（logs/、*.off）不许被当成"未提交改动"；
 *   4. **单一机制**：旧版 `.codebuddy/hooks/*.mjs` 必须已经下线，不能再被注册。
 *
 * 2026-10-22：钩子从 `.codebuddy/hooks/`（单队列）迁到 `.continue/hooks/`（continue-do，
 * 会话级队列）。用例随之改写：队列路径不再固定，每个用例用它自己的 session_id 建临时队列，
 * 跑完删掉——所以**永远不会碰真实队列**。
 *
 * 用法：node tools/hooks-test.mjs [--verbose]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const continueDir = join(projectRoot, '.continue');
const hooksDir = join(continueDir, 'hooks');
const queuesDir = join(continueDir, 'queues');
const logsDir = join(continueDir, 'logs');
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

const queuePath = (sid) => join(queuesDir, `${sid}.md`);
const statePath = (sid, ns = '') => join(logsDir, `${sid}${ns ? `.${ns}` : ''}.state.json`);

/**
 * 用一份临时队列跑一段，结束后原样还原（原本不存在就删掉）。
 *
 * ⚠️ 为什么不能直接改"真实队列"：队列现在按会话 ID 分文件，用例自己造 sid
 * 就不会碰到用户手上的进度；`finally` 保证哪怕断言抛错也不残留。
 */
function withQueue(sid, content, fn) {
  const file = queuePath(sid);
  const had = existsSync(file);
  const backup = had ? readFileSync(file, 'utf8') : null;
  try {
    writeFileSync(file, content);
    return fn(file);
  } finally {
    if (had && backup !== null) writeFileSync(file, backup);
    else rmSync(file, { force: true });
    // 用例自己的轮次/缓存状态也一起清掉，避免下一轮读回旧计数
    // （`statePath` 自己会补一个点，所以命名空间写 `init` / `commit`，不要写成 `.init`）
    for (const suffix of ['', 'init', 'commit']) rmSync(statePath(sid, suffix), { force: true });
  }
}

/** 一份最小的、不依赖真实队列的队列内容（只有一条待办） */
const MIN_QUEUE = '# 队列 · 测试用临时内容\n\n> 状态：执行中\n\n- [ ] hooks-test 占位条目：x → y\n';

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

// ---------------------------------------------------------------- 存在性与注册

console.log('\n[存在性与注册]');

for (const script of ['lib.mjs', 'queue-init.mjs', 'auto-continue.mjs', 'auto-commit.mjs']) {
  check(`.continue/hooks/${script} 存在`, existsSync(join(hooksDir, script)));
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

  const registered = (event, script) =>
    commands.some((c) => c.event === event && c.command.includes(script));

  // auto-continue 必须挂在两个事件上：Stop 递任务、UserPromptSubmit 只把轮次归零
  check('Stop 注册了 auto-continue.mjs', registered('Stop', 'auto-continue.mjs'));
  check('Stop 注册了 auto-commit.mjs', registered('Stop', 'auto-commit.mjs'));
  check('UserPromptSubmit 注册了 auto-continue.mjs', registered('UserPromptSubmit', 'auto-continue.mjs'));
  check('UserPromptSubmit 注册了 queue-init.mjs', registered('UserPromptSubmit', 'queue-init.mjs'));

  // 单一机制：旧钩子已经下线，不能再被注册（否则一轮会收到两份反馈）
  check(
    '没有残留旧钩子注册（.codebuddy/hooks）',
    !commands.some((c) => c.command.includes('.codebuddy/hooks')),
    commands.map((c) => c.command).join(' | '),
  );

  // 相对路径才可移植：换机器、改目录名都不会坏
  const absolute = commands.filter((c) => /\bnode\s+["']?\//.test(c.command));
  check('钩子命令不含绝对路径', absolute.length === 0, absolute.map((c) => c.command).join(' | '));

  // 注册的脚本必须真的存在（路径从项目根解析）
  const missing = commands
    .map((c) => /node\s+(?:'|")?([^\s'"]+\.mjs)/.exec(c.command)?.[1])
    .filter((target) => target && !existsSync(resolve(projectRoot, target)));
  check('注册的脚本都存在', missing.length === 0, missing.join(' | '));
}

// ---------------------------------------------------------------- auto-continue 放行

console.log('\n[auto-continue · 放行]');

{
  // 没有队列文件 = 用户只是在问问题 → 一次都不要拦
  const sid = 'hooks-test-allow-1';
  rmSync(queuePath(sid), { force: true });
  const r = runHook('auto-continue.mjs', stopEvent(sid));
  check('没有队列 → 放行', r.json?.continue === true, r.json ? JSON.stringify(r.json) : r.stderr);
}

{
  const r = runHook('auto-continue.mjs', { hook_event_name: 'PreToolUse', session_id: 'hooks-test-allow-2' });
  check('非 Stop 事件 → 放行', r.json?.continue === true);
}

{
  const r = runHook('auto-continue.mjs', promptEvent('hooks-test-allow-3'));
  check('UserPromptSubmit → 放行（只复位轮次）', r.json?.continue === true);
}

{
  // 头部「讨论中」= 还没和用户确认方案，别催
  withQueue('hooks-test-allow-4', '# 队列\n\n> 状态：讨论中\n\n- [ ] 讨论中的条目：x → y\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-allow-4'));
    check('队列是「讨论中」→ 放行', r.json?.continue === true);
    check('说明为什么不递任务', /讨论中/.test(r.json?.systemMessage ?? ''));
  });
}

{
  withQueue('hooks-test-allow-5', '# 队列\n\n> 状态：执行中\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-allow-5'));
    check('队列没有任何条目 → 放行', r.json?.continue === true);
    check('提示可以删掉空队列', /没有要做的|删掉/.test(r.json?.systemMessage ?? ''));
  });
}

{
  // 全部完成 → 拦住请用户确认收尾；同一份队列只问一次
  withQueue('hooks-test-allow-6', '# 队列\n\n- [x] 已经做完的条目：x → y\n', () => {
    const first = runHook('auto-continue.mjs', stopEvent('hooks-test-allow-6'));
    check('全部完成 → 拦下请用户确认收尾（exit 2）', first.code === 2, String(first.code));
    check('反馈里给出三个收尾选项', /确认完成/.test(first.stderr) && /还要补充/.test(first.stderr));
    check('要求先问用户再动 DONE/TASKS', /AskUserQuestion/.test(first.stderr) && /DONE\.md/.test(first.stderr));

    const second = runHook('auto-continue.mjs', stopEvent('hooks-test-allow-6'));
    check('收尾只问一次（第二次放行）', second.json?.continue === true, second.stderr.slice(0, 160));
  });
}

// ---------------------------------------------------------------- auto-continue 递任务

console.log('\n[auto-continue · 递任务]');

{
  withQueue('hooks-test-pick-1', MIN_QUEUE, () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-pick-1'));
    check('有待办 → 拦停（exit 2）', r.code === 2, String(r.code));
    check('递出的就是这条', /hooks-test 占位条目/.test(r.stderr));
    check('给队列文件的准确路径', r.stderr.includes(`.continue/queues/hooks-test-pick-1.md`), r.stderr.split('\n')[0]);
    check('要求只做一条', /只做这一条/.test(r.stderr));
    check('要求自己写 [~] / [x]', /\[~\]/.test(r.stderr) && /\[x\]/.test(r.stderr));
    check('说明 [阻塞] 由脚本写、AI 不许动', /\[阻塞\]/.test(r.stderr) && /不要自己写/.test(r.stderr));
  });
}

{
  // `[~]` = 进行中 → 优先接着做完，而不是跳过它
  withQueue('hooks-test-pick-2', '- [ ] 后面的条目：x → y\n- [~] 进行中的条目：x → y\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-pick-2'));
    check('[~] 优先于 [ ]', /进行中的条目/.test(r.stderr) && !/  · 后面的条目/.test(r.stderr));
    check('说明这是接着做', /接着做完/.test(r.stderr));
  });
}

{
  // 用户排的条目优先于 AI 自插的 [发现]
  withQueue('hooks-test-pick-3', '- [ ] [发现] 发现占位：x → y\n- [ ] 用户排的条目：x → y\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-pick-3'));
    check('[发现] 排在用户排的条目之后', /用户排的条目/.test(r.stderr) && !/发现占位/.test(r.stderr), r.stderr.slice(0, 200));
  });
}

{
  // 队列按会话隔离：别的会话有队列，不影响本会话
  const sid = 'hooks-test-pick-4';
  rmSync(queuePath(sid), { force: true });
  // queue-init 每个会话只注入一次，用例要复现"第一次"就得先清掉它的标记
  rmSync(statePath(sid, 'init'), { force: true });
  withQueue('hooks-test-other-4', '- [ ] 别人的条目：x → y\n', () => {
    try {
      const r = runHook('auto-continue.mjs', stopEvent(sid));
      check('别人的队列不会被本会话接手', r.json?.continue === true, r.stderr.slice(0, 160));

      const init = runHook('queue-init.mjs', promptEvent(sid));
      const text = JSON.stringify(init.json ?? {});
      check('queue-init 会提示其他会话的未完成队列', /其他会话/.test(text), init.stdout.slice(0, 200));
      check('并且明确要求不要擅自接管', /不要擅自接管/.test(text));
    } finally {
      rmSync(statePath(sid, 'init'), { force: true });
    }
  });
}

// ---------------------------------------------------------------- 批次号 / 收尾五步

console.log('\n[批次号与收尾五步]');

{
  /**
   * 批次号 = **开工时的提交总数**（不用自增计数器）。钩子算好塞进模板，
   * AI 建队列时照抄——手抄的数字一定会漂，提交数是唯一真值。
   */
  const sid = 'hooks-test-batch-1';
  rmSync(statePath(sid, 'init'), { force: true });
  try {
    const r = runHook('queue-init.mjs', promptEvent(sid));
    const text = JSON.stringify(r.json ?? {});
    check('queue-init 注入批次号', /批次号/.test(text), r.stdout.slice(0, 160));
    check('模板里带 `> 批次：`', /> 批次：/.test(text));
    check('说明批次 = 提交总数', /rev-list --count HEAD/.test(text));
    check('说明 DONE 标题格式（提交 n→m）', /批次 24（提交 24→27）/.test(text));
    check('说明收尾五步（DONE→TASKS→NOTES→EXPERIENCE→删队列）', /① /.test(text) && /⑤ /.test(text));
  } finally {
    rmSync(statePath(sid, 'init'), { force: true });
  }

  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('auto-continue 递任务时带批次号', /批次 \$\{batch\}/.test(src));
  check('收尾提示要求走五步（含 NOTES / EXPERIENCE）', /NOTES\.md/.test(src) && /EXPERIENCE\.md/.test(src));
  check('提示按关键词 grep 两份长文档', /grep 一次/.test(src));
}

// ---------------------------------------------------------------- 卡死保护

console.log('\n[卡死保护]');

{
  /**
   * 一条做不完的任务会被无限递回来（`[~]` 也算待办）。连续 N 轮做不完必须
   * 打 `[阻塞]` 隔离、跳过去做下一条、并要求 AI 上报给用户决策——而不是静默重试。
   *
   * ⚠️ 这里踩过一个坑：计数累加后忘了 saveState，导致每轮读回来都是初始值，
   * 连续次数永远停在 1、永远不会触发。所以下面是"连跑 N 次看它到底变没变"，
   * 光查源码字符串是抓不到这个 bug 的。
   */
  const sid = 'hooks-test-block';
  rmSync(statePath(sid), { force: true });

  withQueue(sid, '- [ ] 卡死测试条目：故意做不完\n- [ ] 卡死测试后一条：应该能被轮到\n', (file) => {
    let lastStderr = '';
    for (let round = 1; round <= 4; round += 1) {
      lastStderr = runHook('auto-continue.mjs', stopEvent(sid)).stderr;
    }
    check('前 4 轮仍在重试同一条', /卡死测试条目/.test(lastStderr));
    check('前 4 轮还没打阻塞标记', !/已标/.test(lastStderr));
    /**
     * ⚠️ 这条断言原来查的是 `state.attempts['…']`——那是**旧版钩子**的字段。
     * v3（会话级队列）改成"指纹 + 连续计数"（`currentFingerprint` / `currentStreak`），
     * 钩子改了、自测没跟着改，于是 `npm run check` 从那次迁移起一直是红的
     * （批次 1355 的 [发现] 就是它）。现在改成查**当前实现**的字段，
     * 而且**仍然守原来那个 bug**：计数必须累加并逐轮落盘，否则永远触发不了隔离。
     */
    const midState = JSON.parse(readFileSync(statePath(sid), 'utf8'));
    check('前 4 轮把连续次数累加并逐轮落盘', midState.currentStreak === 4, String(midState.currentStreak));
    check('连续计数挂在这一条上', /卡死测试条目/.test(midState.currentFingerprint ?? ''));

    const fifth = runHook('auto-continue.mjs', stopEvent(sid));
    check('第 5 轮打出阻塞标记', /已标.*阻塞/.test(fifth.stderr), fifth.stderr.slice(0, 160));
    check('第 5 轮跳过卡住的那条', !/^  · 卡死测试条目/m.test(fifth.stderr));
    check('第 5 轮改递下一条', /卡死测试后一条/.test(fifth.stderr));
    check('要求 AI 上报而非自行处理', /上报/.test(fifth.stderr) && /不要替他决定/.test(fifth.stderr));

    const queueNow = readFileSync(file, 'utf8');
    check('队列文件里已写成 [阻塞]', /- \[阻塞\] 卡死测试条目/.test(queueNow));

    const state = JSON.parse(readFileSync(statePath(sid), 'utf8'));
    check(
      '隔离之后计数归零（改回 [ ] 能重新得到 N 次机会）',
      state.currentStreak === 0,
      String(state.currentStreak),
    );
    check(
      '计数已经移到下一条（不再算在被隔离的那条头上）',
      !/卡死测试条目/.test(state.currentFingerprint ?? ''),
      String(state.currentFingerprint),
    );
  });
}

// ---------------------------------------------------------------- 围栏代码块

console.log('\n[围栏代码块不算待办]');

{
  // 只有代码块里的模板 → 必须判定为"没有待办"
  withQueue('hooks-test-fence-1', '```\n- [ ] [发现] 模板示例：x → y\n```\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-fence-1'));
    check('代码块里的 [ ] 不算待办', r.json?.continue === true, JSON.stringify(r.json).slice(0, 160));
  });

  // 代码块外 + 代码块内各一条 → 只算外面那条
  withQueue('hooks-test-fence-2', '```\n- [ ] 块内假任务：x → y\n```\n- [ ] 块外真任务：x → y\n', () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-fence-2'));
    check('只把块外那条当待办', /块外真任务/.test(r.stderr) && !/块内假任务/.test(r.stderr), r.stderr.slice(0, 200));
  });
}

// ---------------------------------------------------------------- AI 自插任务

console.log('\n[AI 自插任务]');

{
  withQueue('hooks-test-discover-1', MIN_QUEUE, () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-discover-1'));
    check('正常模式提示可插 [发现]', /\[发现\]/.test(r.stderr));
    check('带"必须真实撞见"的约束', /真实撞见/.test(r.stderr));
    check('带"只能插不许改"的约束', /不能删改/.test(r.stderr));
    check('带"插完要说一声"的约束', /我插了一条/.test(r.stderr));
    check('正常模式不阻止插入', !/不要再插/.test(r.stderr));
  });

  // 额度打满（5 条）→ 必须明确要求停止插入
  const filled = Array.from({ length: 5 }, (_, i) => `- [ ] [发现] 占位发现 ${i + 1}：x → y`).join('\n');
  withQueue('hooks-test-discover-2', `- [ ] 用户条目：x → y\n${filled}\n`, () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-discover-2'));
    check('额度满时要求停止插入', /不要再插/.test(r.stderr), r.stderr.slice(0, 160));
  });
}

// ---------------------------------------------------------------- 无上限 / 风险弹窗

console.log('\n[无上限与风险弹窗]');

{
  /**
   * 用户明确要求"不限制会话次数"，而且**上下文用量不能当停下来的理由**。
   * 这两条防的是"以后有人好心把上限加回去"——症状是长跑跑一半就停、
   * 当事人还以为仍在跑；以及"按 token 打断 → 钩子反馈被当成用户发言 →
   * 轮次清零 → 又判超限"的自我死锁（旧版实测连撞 20 轮）。
   */
  const src = readFileSync(join(hooksDir, 'auto-continue.mjs'), 'utf8');
  check('auto-continue 没有轮次上限', !/MAX_CONTINUATIONS/.test(src));
  check('没有上下文水位开关', !/AUTO_CONTINUE_CONTEXT_LIMIT/.test(src));
  check('交接模式整块删除（没有 mustHandOff）', !/mustHandOff/.test(src));
  check('不再生成"复制这段"的交接提示词', !/handoff-prompt\.txt/.test(src));

  // 替代方案：发现风险 → 弹窗让用户决策
  check('反馈里要求"发现风险就弹窗"', /发现风险就弹窗问用户/.test(src));
  check('明确点名 AskUserQuestion', /AskUserQuestion/.test(src));
  check(
    '列出 5 类该弹窗的风险',
    (src.match(/不可逆的破坏|会波及其他队列|多种合理做法|需求本身有歧义|超出这条的范围/g) ?? []).length >= 5,
  );
  check('弹窗要求给具体选项而不是"继续/停止"', /2~4 个/.test(src) && /\*\*具体选项\*\*/.test(src));

  const commitSrc = readFileSync(join(hooksDir, 'auto-commit.mjs'), 'utf8');
  check('auto-commit 没有拦截次数上限', !/MAX_ROUNDS/.test(commitSrc));
  check('auto-commit 不替 AI 提交（无 git commit 调用）', !/execFileSync\('git', \['commit'/.test(commitSrc));
}

// ---------------------------------------------------------------- 刹车开关

console.log('\n[刹车开关]');

{
  const offFile = join(continueDir, 'auto-continue.off');
  writeFileSync(offFile, '');
  try {
    withQueue('hooks-test-off-1', MIN_QUEUE, () => {
      const r = runHook('auto-continue.mjs', stopEvent('hooks-test-off-1'));
      check('auto-continue.off → 放行', r.json?.continue === true, r.stderr.slice(0, 160));
      check('放行时说明刹车文件', /auto-continue\.off/.test(r.json?.systemMessage ?? ''));
    });
  } finally {
    rmSync(offFile, { force: true });
  }

  withQueue('hooks-test-off-2', MIN_QUEUE, () => {
    const r = runHook('auto-continue.mjs', stopEvent('hooks-test-off-2'));
    check('删掉刹车文件后恢复递任务', r.code === 2, String(r.code));
  });
}

// ---------------------------------------------------------------- auto-commit

console.log('\n[auto-commit]');

{
  const r = runHook('auto-commit.mjs', { hook_event_name: 'PreToolUse', session_id: 'hooks-test-commit-1' });
  check('非 Stop 事件 → 放行', r.json?.continue === true);
}

{
  // 刹车文件：必须在"有脏文件"的前提下也能放行
  const offFile = join(continueDir, 'auto-commit.off');
  writeFileSync(offFile, '');
  try {
    const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-2'));
    check('auto-commit.off → 放行', r.json?.continue === true);
    check('放行时给出提示', /auto-commit\.off/.test(r.json?.systemMessage ?? ''));
  } finally {
    rmSync(offFile, { force: true });
  }
}

{
  // 从别的目录启动：脚本必须自己认路，仍然能读到本仓库
  const elsewhere = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  try {
    const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-3'), { cwd: elsewhere });
    // exit 0 = 工作区干净放行；exit 2 = 有改动拦住（stdout 里仍有 continue:true）。两者都算正常。
    check('从其他 cwd 启动不报错', (r.code === 0 || r.code === 2) && r.json !== null, r.stderr.slice(0, 200));
    check(
      '从其他 cwd 启动仍能判断本仓库状态',
      r.json?.continue === true ? existsSync(continueDir) : true,
      JSON.stringify(r.json).slice(0, 200),
    );
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
}

{
  // 关键的"不自杀"：钩子自己的运行时文件不能出现在改动清单里
  const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-4'));
  const text = `${JSON.stringify(r.json ?? {})}${r.stderr}`;
  const leaked = ['.continue/logs/', 'commit.state.json', 'auto-commit.off'].filter((name) => text.includes(name));
  check('不把自身运行时文件当成未提交改动', leaked.length === 0, leaked.join(', '));
}

{
  /**
   * 自测门禁：门禁命令由**脚本亲自跑**（AI 自证没法验证，退出码可以）。
   * 这里把 `.continue/config.json` 临时换成一个极快的假命令，两种情况都要能分辨：
   * 通过 → 正常要求提交并注明"自测已通过"；失败 → 明确"先修，不要提交"。
   */
  const configFile = join(continueDir, 'config.json');
  const hadConfig = existsSync(configFile);
  const backup = hadConfig ? readFileSync(configFile, 'utf8') : null;
  try {
    writeFileSync(configFile, `${JSON.stringify({ checks: { fast: 'node -e "process.exit(0)"', timeoutSec: 30 } })}\n`);
    const passRun = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-5'));
    const passText = `${passRun.stderr}`;
    check('门禁通过 → 要求提交并注明已验证', /自测已通过/.test(passText), passText.slice(0, 160));
    check('通过时不说不许提交', !/不要提交/.test(passText));

    writeFileSync(configFile, `${JSON.stringify({ checks: { fast: 'node -e "process.exit(1)"', timeoutSec: 30 } })}\n`);
    const failRun = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-6'));
    check('门禁失败 → 先修，不要提交', /自测没通过/.test(failRun.stderr) && /不要提交/.test(failRun.stderr), failRun.stderr.slice(0, 200));
    check('失败时附上输出末尾（不是只说一句"失败了"）', /输出末尾/.test(failRun.stderr));
  } finally {
    if (hadConfig && backup !== null) writeFileSync(configFile, backup);
    else rmSync(configFile, { force: true });
  }
}

{
  // exit2 风格：exit 2 + 反馈走 stderr，stdout 里 continue 不为 false
  const r = runHook('auto-commit.mjs', stopEvent('hooks-test-commit-7'), {
    env: { AUTO_COMMIT_STYLE: 'exit2' },
  });
  const isBlockOrClean = r.code === 2 ? r.stderr.length > 0 : r.json?.continue === true;
  check('AUTO_COMMIT_STYLE=exit2 行为自洽', isBlockOrClean, `code=${r.code} stderr=${r.stderr.slice(0, 120)}`);
}

// ---------------------------------------------------------------- 目录分工

console.log('\n[目录分工]');

{
  /**
   * `queues/` 放队列（进仓库、要 review），`logs/` 放运行时产物（不进仓库）。
   * 这条断言给"长跑任务列表"兜底：一旦有人把日志写回项目根或 queues/，
   * 它会每轮往 git status 里冒出来一次，提交守卫每次都拦，最后只能靠关钩子收场。
   */
  check('queues/ 存在', existsSync(queuesDir));
  check('logs/ 存在（钩子跑过至少一次）', existsSync(logsDir));

  let ignoreText = '';
  try {
    ignoreText = readFileSync(join(continueDir, '.gitignore'), 'utf8');
  } catch {
    ignoreText = '';
  }
  check('.continue/.gitignore 覆盖 logs/', /^logs\/$/m.test(ignoreText), ignoreText.trim());

  if (existsSync(logsDir)) {
    const stray = readdirSync(logsDir).filter((name) => name.endsWith('.md') && !name.includes('.state'));
    check('logs/ 里没有藏队列（只有 <sid>.md 运行日志）', stray.every((name) => !name.includes('queue')));
  }

  // 旧机制必须彻底下线：再出现两份队列文件，钩子会各读一份、互相打脸
  check('旧队列文件已迁移', !existsSync(join(projectRoot, '.codebuddy', 'hooks', 'process', 'auto-continue.md')));
  check('旧钩子脚本已删除', !existsSync(join(projectRoot, '.codebuddy', 'hooks', 'auto-continue.mjs')));
}

// ---------------------------------------------------------------- 汇总

console.log('');
if (failures.length > 0) {
  console.log(`✗ 钩子自检失败：${failures.length} 项`);
  for (const f of failures) console.log(`  · ${f.name}`);
  process.exit(1);
}
console.log(`✓ 钩子自检通过：${pass} 项断言`);

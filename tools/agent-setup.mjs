#!/usr/bin/env node
/**
 * 跨机器接手指引脚本（`npm run agent:setup`）。
 *
 * 换一台电脑 clone 之后，只有"仓库里的东西"跟着走；AI 的记忆、hooks 的绝对路径、
 * 依赖目录都在本机。这个脚本把三者检查/补齐一遍，让新机器一键回到可工作状态：
 *
 *   1. 记忆恢复：把仓库内 `.codebuddy/memory/*.md` 拷回本机
 *      `~/.codebuddy/projects/<项目路径派生 slug>/memory/`（不同机器路径不同，这里按规则现算）；
 *   2. hooks 自检：`.codebuddy/settings.json` 里的钩子命令如果指向"不存在的路径"
 *      （典型是从别的机器带过来的绝对路径），自动改写为本机绝对路径；
 *   3. 环境自检：Node 版本、依赖、远程仓库、各会话队列剩余条目、紧急刹车文件。
 *
 * 参数：
 *   --force       记忆文件无条件用仓库版本覆盖本机
 *   --fix-hooks   即便路径看起来正常，也把钩子命令改写为本机绝对路径
 *   --quiet       只输出问题与结论
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const fixHooks = args.has('--fix-hooks');
const quiet = args.has('--quiet');

const problems = [];
const notes = [];

const say = (line = '') => {
  if (!quiet) console.log(line);
};

say('=== 跨机器接手自检 (agent:setup) ===');
say(`项目根目录: ${projectRoot}`);
say();

// ---------------------------------------------------------------- 1. 记忆恢复

/** CodeBuddy 按项目绝对路径派生项目目录名（`/a/b` → `a-b`）。 */
function slugFor(path) {
  return path.replace(/^[/\\]+/, '').replace(/[/\\:]+/g, '-');
}

const memorySrc = join(projectRoot, '.codebuddy', 'memory');
const memoryDst = join(homedir(), '.codebuddy', 'projects', slugFor(projectRoot), 'memory');

say(`[1/3] AI 记忆: ${memorySrc}`);
say(`        目标: ${memoryDst}`);

if (!existsSync(memorySrc)) {
  problems.push('仓库里没有 .codebuddy/memory/，无法恢复 AI 记忆。');
} else {
  mkdirSync(memoryDst, { recursive: true });
  const files = readdirSync(memorySrc).filter((name) => name.endsWith('.md') && name !== 'README.md');
  let copied = 0;
  let kept = 0;

  for (const name of files) {
    const from = join(memorySrc, name);
    const to = join(memoryDst, name);
    if (existsSync(to) && !force) {
      // 本机已有同名记忆：只在仓库版本更新时才覆盖，避免抹掉本机更近的修改。
      const localNewer = statSync(to).mtimeMs > statSync(from).mtimeMs;
      const same = readFileSync(to, 'utf8') === readFileSync(from, 'utf8');
      if (!same && localNewer) {
        kept += 1;
        continue;
      }
      if (same) {
        continue;
      }
    }
    copyFileSync(from, to);
    copied += 1;
  }

  say(`        ${copied} 个文件已写入，${files.length - copied - kept} 个已是最新，${kept} 个本机更新（保留本机，--force 可强覆盖）`);
}

// ---------------------------------------------------------------- 2. hooks 自检

say();
say('[2/3] 自动继续 hooks: .codebuddy/settings.json');

const settingsFile = join(projectRoot, '.codebuddy', 'settings.json');
/** 钩子已迁到 `.continue/hooks/`（continue-do 框架），见 .continue/HANDOFF.md */
const hooksDir = join(projectRoot, '.continue', 'hooks');
const hookScript = join(hooksDir, 'auto-continue.mjs');

if (!existsSync(settingsFile)) {
  problems.push('缺少 .codebuddy/settings.json，Stop 钩子未配置，AI 不会自动按队列继续。');
} else if (!existsSync(hookScript)) {
  problems.push(`缺少钩子脚本 ${hookScript}。`);
} else {
  const raw = readFileSync(settingsFile, 'utf8');
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    problems.push(`settings.json 不是合法 JSON：${String(error)}`);
  }

  if (settings) {
    const commands = [];
    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      for (const group of groups ?? []) {
        for (const hook of group.hooks ?? []) {
          if (typeof hook.command === 'string') commands.push({ event, hook });
        }
      }
    }

    if (commands.length === 0) {
      problems.push('settings.json 里没有任何 hooks 命令。');
    }

    // 两个脚本各管一件事：auto-continue 推进队列、auto-commit 拦住漏提交。
    // 少挂任何一个都还能跑，但对应的保护就没了，这里明确指出来。
    const commitScript = join(hooksDir, 'auto-commit.mjs');
    if (!existsSync(commitScript)) {
      problems.push(`缺少 ${commitScript}，改完代码不会被检查是否漏提交。`);
    } else if (!commands.some(({ hook }) => hook.command.includes('auto-commit.mjs'))) {
      problems.push('settings.json 里没有注册 auto-commit.mjs，漏提交不会被拦住。');
    }

    let rewritten = 0;
    for (const { event, hook } of commands) {
      const match = hook.command.match(/node\s+(?:'|")?([^\s'"]+\.mjs)(?:'|")?/);
      const target = match?.[1];
      // 相对路径（相对项目根）是跨机器可移植的默认写法；
      // 绝对路径只有在"确实指向本机文件"时才算正常，否则就是别的机器留下的死路径。
      const isRelative = Boolean(target) && !target.startsWith('/') && !/^[A-Za-z]:/.test(target);
      const absolute = target ? resolve(projectRoot, target) : null;
      const absoluteOk = absolute ? existsSync(absolute) : false;

      if (isRelative && !fixHooks) continue;

      if (!isRelative && absoluteOk && !fixHooks) {
        say(`        ${event}: 绝对路径且存在 → ${target}`);
        continue;
      }

      if (!isRelative && !absoluteOk) {
        problems.push(`${event} 钩子指向不存在的路径：${target}（多半来自另一台机器）`);
      }

      // 只把「路径」改成本机绝对路径，**保留原来的脚本文件名**。
      // （早期版本这里无条件写成 auto-continue.mjs，配置里一旦有第二个钩子就会被它覆写掉。）
      const scriptName = target ? basename(target) : 'auto-continue.mjs';
      const fixed = join(hooksDir, scriptName);
      hook.command = `node ${fixed}`;
      rewritten += 1;
      notes.push(`${event} 钩子命令已改写为本机绝对路径：node ${fixed}`);
      if (!existsSync(fixed)) {
        problems.push(`${event} 钩子指向的脚本不存在：${fixed}`);
      }
    }

    if (rewritten > 0) {
      writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      for (const note of notes) say(`        ${note}`);
      say('        （该文件会因此出现本地改动，属正常现象，不要提交这台机器的绝对路径）');
    } else {
      say('        钩子命令可移植，无需修改');
    }
  }
}

// ---------------------------------------------------------------- 3. 环境自检

say();
say('[3/3] 环境与进度');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) problems.push(`Node ${process.versions.node} 过旧，需要 >= 18（Vite 8 / esbuild 要求）。`);

if (!existsSync(join(projectRoot, 'node_modules'))) {
  problems.push('缺少 node_modules，先执行 npm install。');
}

/**
 * 队列是**会话级**的（`.continue/doing/<session_id>.md`），所以这里逐个文件扫，
 * 不再假设"只有一份 auto-continue.md"。
 *
 * 与钩子同一套规则：**围栏代码块里的 `- [ ]` 是给人看的模板，不算待办**。
 * 曾经漏了这条，队列明明清空却报"剩余 1 条"，还把那行模板当成任务。
 */
const queueDir = join(projectRoot, '.continue', 'doing');
let queueFiles = [];
try {
  queueFiles = readdirSync(queueDir).filter((name) => name.endsWith('.md'));
} catch {
  problems.push('缺少 .continue/doing/，会话队列目录不存在（钩子会读不到队列）。');
}

if (queueFiles.length === 0) {
  notes.push('当前没有会话队列（.continue/doing/ 为空）——纯问答会话属正常，要排长跑任务时再建。');
}
for (const name of queueFiles) {
  const pending = [];
  let inFence = false;
  for (const line of readFileSync(join(queueDir, name), 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (/^-\s*\[[ ~]\]\s*\S/.test(trimmed)) pending.push(trimmed);
  }
  say(`        队列 ${name} 剩余 ${pending.length} 条待办`);
  for (const line of pending.slice(0, 3)) say(`          · ${line.replace(/^-\s*\[[ ~]\]\s*/, '')}`);
}

if (existsSync(join(projectRoot, '.continue', 'auto-continue.off'))) {
  notes.push('存在紧急刹车文件 .continue/auto-continue.off，自动继续当前是关闭的（删除该文件恢复）。');
}

// 远程仓库：没有远程就没法在机器之间同步，这是换电脑最大的坑。
try {
  const { execFileSync } = await import('node:child_process');
  const remote = execFileSync('git', ['remote'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  if (remote.length === 0) {
    problems.push(
      '仓库没有配置远程（git remote 为空）→ 代码只在当前这台机器上，换电脑 clone 不到。' +
        '请先 git remote add origin <地址> && git push -u origin main。',
    );
  } else {
    say(`        git 远程: ${remote}`);
  }
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  if (dirty.length > 0) notes.push(`工作区有未提交改动 ${dirty.split('\n').length} 处，接手前先提交。`);
} catch {
  problems.push('git 不可用或当前目录不是 git 仓库。');
}

// ---------------------------------------------------------------- 结论

say();
if (problems.length === 0) {
  say('结论: 一切就绪 ✅');
} else {
  say('结论: 需要处理以下问题 ❌');
  for (const problem of problems) say(`  · ${problem}`);
}
for (const note of notes) say(`  提示: ${note}`);

say();
say('下一步：npm run dev（http://localhost:5173），然后让 AI 读 AGENTS.md 与 .continue/HANDOFF.md 继续推进。');

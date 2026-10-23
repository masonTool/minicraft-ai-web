#!/usr/bin/env node
/**
 * 钩子包装器：`node .continue/hooks/run.mjs <脚本名> --event=<事件>`
 *
 * 为什么需要它（挡的是一次真实事故）：
 *   改机制时 `lib.mjs` 先删了一个导出、`auto-continue.mjs` 还没来得及改 import，
 *   那条钩子在下一次 Stop 就 **import 阶段 SyntaxError** 直接崩了。
 *   宿主对"非 0 且非 2"的退出码按**未阻止**处理 —— 于是队列卡住、任务不再下发、
 *   收尾指令也不发，而**整个对话里一声不吭**：现象只是"它不动了"，
 *   看上去像"没有待办"或"AI 不听话"，唯独不像"框架自己坏了"。
 *
 * 它做什么：把真钩子放进子进程跑，**退出码 0 / 2 原样透传**（这两个是契约），
 *   其余一切（崩溃 / 超时 / 被信号杀）都**翻译成 exit 2 + 一段能照着做的告警**——
 *   让"框架坏了"变成一次明确的拦截，而不是静默放行。
 *
 * 为什么自己不 import `lib.mjs`：这份包装器的存在理由之一就是"lib.mjs 坏了"，
 *   它再去 import 同一棵树就没有兜底意义了。所以这里只用 `node:fs` / `node:child_process`。
 *
 * ⚠️ 必须转发 stdin：宿主的钩子 payload 走 stdin（`readPayload()` 读它）。
 *   不转发的话子进程拿到空输入，会把"有队列"看成"没有队列"。
 *
 * ⚠️ 必须转发**信号**（2026-10-23 补）：宿主在超时或用户中断时杀掉的是**本包装器**。
 *   原实现用 `spawnSync`，它阻塞事件循环、且只对直接子进程发信号——
 *   包装器一死，子钩子就变成孤儿继续跑（检查还在跑、队列可能还在被改），
 *   而日志里看不出任何异常。改成异步 `spawn` + 信号转发后，子进程跟着一起收工。
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [target, ...rest] = process.argv.slice(2);

/** 同步写 fd：`process.stdout.write` 紧跟 `process.exit` 会截断长内容（踩过）。 */
const out = (fd, text) => {
  if (text) writeSync(fd, text);
};

if (!target) {
  out(2, '用法：node .continue/hooks/run.mjs <脚本名> [--event=<事件>]\n');
  process.exit(2);
}

/** 转发 stdin（宿主把事件 JSON 从这里送进来）。TTY 下手动跑时没有输入，跳过。 */
let payload = '';
try {
  if (!process.stdin.isTTY) payload = readFileSync(0, 'utf8');
} catch {
  // 读不到就当没有输入：绝不因此拦住整轮，子进程自己会按"没有 payload"处理
}

const child = spawn(process.execPath, [join(HERE, target), ...rest], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdin.end(payload);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

/**
 * 收到信号 → 转发给子钩子，并在宽限期后强制退出。
 *
 * 为什么要"宽限期"而不是立刻 exit：子钩子可能需要几毫秒把 stderr 写完（那是给 AI 的反馈）。
 * 但也不能无限等——宿主已经决定让我们死了，赖着不走只会被 SIGKILL，子进程反而更容易被漏掉。
 */
let bailCode = null;
function flushBail() {
  out(1, stdout);
  out(2, stderr);
  process.exit(bailCode ?? 130);
}
function bail(signal, code) {
  if (bailCode !== null) return;
  bailCode = code;
  try {
    child.kill(signal);
  } catch {
    /* 子进程已经没了 */
  }
  setTimeout(flushBail, 1500);
}
process.on('SIGINT', () => bail('SIGINT', 130));
process.on('SIGTERM', () => bail('SIGTERM', 143));

child.on('error', (err) => {
  out(2, `[continue-do] 钩子 ${target} 起不来：${err.message}\n`);
  process.exit(2);
});

child.on('close', (code, signal) => {
  // 已经因为信号收工了：子进程一关就把攒下的输出冲出去，不必等宽限期
  if (bailCode !== null) flushBail();

  // 契约里的两个退出码：原样透传（0 = 放行，2 = 拦住并把 stderr 交给 AI）
  if (code === 0 || code === 2) {
    out(1, stdout);
    out(2, stderr);
    process.exit(code);
  }

  /**
   * 走到这里 = 框架自己坏了（或被宿主/信号杀掉）。**不能放行**：放行的后果是
   * "整条队列静默停摆"，比一次显眼的红灯贵得多。
   */
  out(1, stdout);
  out(
    2,
    [
      `[continue-do] 钩子 ${target} 异常退出（code=${code ?? 'null'}，signal=${signal ?? '—'}）。`,
      '',
      '**这是框架自己坏了，不是"本轮无事"。**如果放行，队列会静默停摆、且不会有任何提示。',
      '',
      '它的原始输出：',
      ...(stderr.trim() ? stderr.trimEnd().split('\n').slice(-12).map((l) => `  ${l}`) : ['  （空）']),
      '',
      '## 现在要做的事',
      '',
      '1. 修掉上面报的东西。最常见的是**某个脚本 import 了 `lib.mjs` 里已删除的导出**',
      '   （改机制时先删导出、后改引用，中间那段窗口就长这样）；',
      '2. 跑 `node .continue/hooks/check.mjs hooks` 确认恢复；',
      '3. 想先绕开就用 `touch .continue/auto.off`（会让整条队列停下），',
      '   **但不要放着不管**——那是把"看得见的红"换成"看不见的停"。',
    ].join('\n'),
  );
  process.exit(2);
});

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
 *   它再去 import 同一棵树就没有兜底意义了。所以这里只用 `node:fs` 的 `writeSync`。
 *
 * ⚠️ 必须转发 stdin：宿主的钩子 payload 走 stdin（`readPayload()` 读它）。
 *   不转发的话子进程拿到空输入，会把"有队列"看成"没有队列"。
 */
import { spawnSync } from 'node:child_process';
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

const res = spawnSync(process.execPath, [join(HERE, target), ...rest], {
  input: payload,
  encoding: 'utf8',
});

const code = res.status;
const stdout = res.stdout ?? '';
const stderr = res.stderr ?? '';

// 契约里的两个退出码：原样透传（0 = 放行，2 = 拦住并把 stderr 交给 AI）
if (code === 0 || code === 2) {
  out(1, stdout);
  out(2, stderr);
  process.exit(code);
}

/**
 * 走到这里 = 框架自己坏了。**不能放行**：放行的后果是"整条队列静默停摆"，
 * 比一次显眼的红灯贵得多。
 */
out(1, stdout);
out(
  2,
  [
    `[continue-do] 钩子 ${target} 异常退出（code=${code ?? 'null'}，signal=${res.signal ?? '—'}）。`,
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

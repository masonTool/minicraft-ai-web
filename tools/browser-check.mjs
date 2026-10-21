#!/usr/bin/env node
/**
 * 把控制台零错误门禁挂进 `npm run check`（Q10）。
 *
 * 用法：
 *   npm run check                     # 默认**不跑**浏览器（脚本立刻返回 0）
 *   BROWSER_CHECK=1 npm run check     # 跑：开 dev server → guard → 收工
 *
 * 为什么默认不跑（而不是"跑了但忽略失败"）：
 *   1. `npm run check` 现在是**纯离线、约 12 秒**，这是它被高频使用的根本原因。
 *      塞进一个要起浏览器 + 起 dev server 的环节，轻则变成 40 秒，重则在不稳定的
 *      机器上偶发变红——而"偶发红"会把门禁变成噪音（O15 记过这条教训）。
 *   2. CI 容器里通常没有 Chrome。虽然 guard 自己"没浏览器就 exit 0"，
 *      但"每次都白跑一遍探测"没有意义。
 *   所以它是一个**显式开启**的增强项：本地想验视觉/控制台时开，CI 与日常保持轻快。
 *
 * 为什么由这个脚本自己起 dev server（而不是要求用户先 `npm run dev`）：
 *   一个"需要先手动准备环境"的门禁，实际使用率会接近零。这里自己拉起、自己关掉，
 *   并且**故意换一个端口**——本机 5173 经常被别的东西占着（实测被 CodeBuddy 的
 *   nginx 占用，导致 Vite 只抢到 IPv6，curl 直接 404）。
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 用一个不常见端口，避开 5173 被占的情况 */
const PORT = Number(process.env.BROWSER_CHECK_PORT ?? 5199);

/**
 * 检查这个端口上**已经有服务**在听。
 *
 * ⚠️ 为什么不能只靠 `vite --strictPort`（实测踩到）：Vite 在本机绑的是
 * **IPv6 的 `[::1]`**，而别的进程（实测是 CodeBuddy 的 nginx、或上一次跑剩的
 * vite）可能绑着 **IPv4 的 `127.0.0.1`**——两个地址不冲突，于是 strictPort
 * 认为"端口可用"照常启动。结果 guard 连上的是**别人的服务**，
 * 测出来的是旧代码，却报"通过"。这比报错更危险：**假绿**。
 *
 * 所以先自己探一次（IPv4 与 localhost 各试一遍），有任何响应就拒绝继续。
 */
async function portAlreadyInUse(port) {
  const probes = [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`];
  for (const url of probes) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1500) });
      if (response.status > 0) return url;
    } catch {
      /* 这个地址没人在听 */
    }
  }
  return null;
}

/** 等 URL 可访问（最多 timeout 毫秒） */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      // 任何响应（含 3xx/4xx）都说明服务器已经在听端口了
      if (response.status > 0) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return false;
}

/** 起 vite，返回 { stop } */
function startDevServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const stop = () =>
    new Promise((done) => {
      if (child.exitCode !== null || child.killed) {
        done();
        return;
      }
      child.on('close', () => done());
      child.kill('SIGTERM');
      // 兜底：3 秒还没退就强杀
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已经没了 */
        }
        done();
      }, 3000);
    });
  return { child, stop };
}

async function main() {
  if (process.env.BROWSER_CHECK !== '1') {
    console.log('[skip] 浏览器控制台门禁未开启（BROWSER_CHECK=1 才跑）。');
    console.log('       本地想验的时候：BROWSER_CHECK=1 npm run check');
    return 0;
  }

  const url = `http://localhost:${PORT}/`;

  // 先探端口：有别人在听就直接失败，绝不"连上去测别人的服务"
  const occupied = await portAlreadyInUse(PORT);
  if (occupied !== null) {
    console.error(`[fail] 端口 ${PORT} 上已经有服务在响应（${occupied}）`);
    console.error('       继续跑会连到那个实例上，测出来的不是这次改动的代码（假绿）。');
    console.error(`       换一个端口：BROWSER_CHECK_PORT=5299 BROWSER_CHECK=1 npm run check`);
    return 1;
  }

  console.log(`[browser-check] 起 dev server（:${PORT}）…`);
  const server = startDevServer();

  let exitCode = 0;
  try {
    const ready = await waitForServer(url, 30000);
    if (!ready) {
      // dev server 起不来是**真失败**（不是缺浏览器）：端口被占或构建报错
      console.error(`[fail] dev server 30 秒内没起来（${url}）`);
      console.error('       端口可能被占用，换一个：BROWSER_CHECK_PORT=5299 BROWSER_CHECK=1 npm run check');
      return 1;
    }

    console.log('[browser-check] 跑控制台零错误门禁…');
    exitCode = await new Promise((done) => {
      const child = spawn('node', [join(projectRoot, 'tools', 'console-guard.mjs'), '--url', url, '--wait', '15000', '--enter-world'], {
        cwd: projectRoot,
        stdio: 'inherit',
      });
      child.on('close', (code) => done(code ?? 0));
    });
  } finally {
    await server.stop();
  }

  if (exitCode === 0) console.log('[browser-check] 通过');
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[fail] 浏览器门禁自身出错：', error?.message ?? error);
    process.exit(1);
  });

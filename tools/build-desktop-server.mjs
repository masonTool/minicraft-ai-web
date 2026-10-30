/**
 * 把 Node 版服务端打成**单文件**，给桌面壳当子进程跑（2026-10-30）。
 *
 * ## 为什么是 CJS 而不是 ESM
 * `ws` 是 CommonJS，打包成 ESM 后 esbuild 会把它的 `require('events')` 变成
 * `__require` 动态调用，运行时报 `Dynamic require of "events" is not supported`。
 * 实测踩过一次，所以这里固定 CJS。
 *
 * ## 为什么要 banner
 * 父进程被强杀（`kill -9`、崩溃、任务管理器结束进程）时，子进程会被 init 收养并**继续占着端口**——
 * 局域网里就留了一台连不进的空服务器，正是"网络残留"。Electron 的 `before-quit`
 * 只在优雅退出时跑得到，所以这里给子进程加一段看门狗：父进程没了（被收养 → ppid 变了）就自杀。
 *
 * 只在**桌面打包**这条链路注入，改不到服务端源码，也不影响 `npm run server` 的开发用法。
 */
import { build } from 'esbuild';

const WATCHDOG = `
/* --- 父进程看门狗（tools/build-desktop-server.mjs 注入） ---
 * 桌面壳把服务端当子进程跑。父进程被强杀后本进程会被 init 收养，
 * 端口一直占着、房间表却是空的，队友会扫到一台进不去的服务器。
 * 每 2 秒看一眼父进程还在不在，不在就退出。 */
(function () {
  var parent = Number(process.env.MINICRAFT_PARENT_PID || 0);
  if (!parent) return;
  setInterval(function () {
    if (process.ppid !== parent) process.exit(0);
  }, 2000).unref();
})();
`;

await build({
  entryPoints: ['server/node/index.mjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // `import.meta.url` 在 CJS 里不存在；只有 DATA_DIR 没传时才会用到这个兜底
  define: { 'import.meta.url': '"file:///minicraft-server.cjs"' },
  banner: { js: WATCHDOG },
  outfile: 'build/rt/minicraft-server.cjs',
  logLevel: 'error',
});

console.log('  服务端单文件  build/rt/minicraft-server.cjs');

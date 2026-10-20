#!/usr/bin/env node
/**
 * 微信小游戏正式构建（WX-010）
 *
 * 当前入口是 `tools/minigame/formal-entry.mjs`（压力场景占位）；
 * WX-020 抽出 `UiPort` 后换成 `src/minigame/main.ts`，构建脚本本身不变。
 *
 * 约定：
 *   - 单文件 IIFE（小游戏没有 ESM 入口）
 *   - target 必须是 es2017 或更低（真机 JSCore 不支持 `??` / `?.`）
 *   - 产物 `minigame/game.js` + `minigame/workers/chunk.worker.js`
 *   - 两者合计受 4MB 主包上限约束
 *
 * 用法：`npm run build:minigame:formal`
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapterEntry = join(root, 'vendor', 'minigame-adapter', 'index.js');
const outfile = join(root, 'minigame', 'game.js');
const workerOutfile = join(root, 'minigame', 'workers', 'chunk.worker.js');

if (!existsSync(adapterEntry)) {
  console.error(
    '[minigame] ✗ 找不到 vendored 适配器：\n' +
      `  ${adapterEntry}\n` +
      '  适配器应当在 vendor/minigame-adapter/（随仓库提交）。',
  );
  process.exit(1);
}

mkdirSync(join(root, 'minigame'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['tools/minigame/formal-entry.mjs'],
  bundle: true,
  format: 'iife',
  target: ['es2017'],
  platform: 'browser',
  outfile,
  define: {
    __WX_LABEL__: JSON.stringify('WX-010 FORMAL'),
  },
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

mkdirSync(join(root, 'minigame', 'workers'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['tools/minigame/worker-entry/entry.mjs'],
  bundle: true,
  format: 'iife',
  target: ['es2017'],
  platform: 'browser',
  outfile: workerOutfile,
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

const code = readFileSync(outfile, 'utf8');
const workerCode = readFileSync(workerOutfile, 'utf8');
const bytes = statSync(outfile).size;
const workerBytes = statSync(workerOutfile).size;
const totalBytes = bytes + workerBytes;
const gzip = gzipSync(code).length;
const workerGzip = gzipSync(workerCode).length;
const kb = (value) => `${(value / 1024).toFixed(0)} KB`;

console.log(`[minigame] formal game.js ${kb(bytes)}（gzip ${kb(gzip)}）`);
console.log(`[minigame] worker chunk.worker.js ${kb(workerBytes)}（gzip ${kb(workerGzip)}）`);
console.log(`[minigame] 主包合计 ${kb(totalBytes)}`);

// 真机语法闸门：ES2020 的 ?? / ?. 在模拟器能跑、真机会报 Unexpected token ?
// 这里只做“可疑残留”提示（字符串里也可能出现），正式目标由 esbuild target 保证。
for (const [label, source] of [
  ['game.js', code],
  ['chunk.worker.js', workerCode],
]) {
  const suspicious = (source.match(/\?\?|\?\./g) ?? []).length;
  if (suspicious > 0) {
    console.warn(
      `[minigame] ⚠️ ${label} 里仍有 ${suspicious} 处 ??/?.，确认是否字符串/注释；真机可能报语法错误`,
    );
  }
}

if (totalBytes > 4 * 1024 * 1024) {
  console.error('[minigame] ✗ 主包 + worker 超过微信小游戏主包 4MB 上限');
  process.exit(1);
}

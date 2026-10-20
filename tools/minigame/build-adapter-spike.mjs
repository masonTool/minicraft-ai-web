#!/usr/bin/env node
/**
 * WX-006 构建：minigame-adapter + three r186
 *
 * 与 `build-spike.mjs` 的区别：
 *   - 入口是 `tools/minigame/spike-adapter/entry.mjs`
 *   - 引入 `vendor/minigame-adapter`（vendored 870d66f + 本分支补丁）
 *   - 产物输出到独立目录 `minigame-adapter-spike/`，不覆盖正式 `minigame/`
 *
 * 用法：`npm run build:minigame:adapter`
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapterEntry = join(root, 'vendor', 'minigame-adapter', 'index.js');
const outDir = join(root, 'minigame-adapter-spike');
const outfile = join(outDir, 'game.js');

if (!existsSync(adapterEntry)) {
  console.error(
    '[minigame] ✗ 找不到 vendored 适配器：\n' +
      `  ${adapterEntry}\n` +
      '  适配器应当在 vendor/minigame-adapter/（随仓库提交）。',
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['tools/minigame/spike-adapter/entry.mjs'],
  bundle: true,
  format: 'iife',
  // ⚠️ 同 build-spike：真机不支持 ES2020 的 `??` / `?.`，必须降到 es2017
  target: ['es2017'],
  platform: 'browser',
  outfile,
  define: {
    __WX_LABEL__: JSON.stringify('WX-006 ADAPTER'),
  },
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

const bytes = statSync(outfile).size;
const gzip = gzipSync(readFileSync(outfile)).length;
const kb = (value) => `${(value / 1024).toFixed(0)} KB`;
console.log(`[minigame] adapter game.js ${kb(bytes)}（gzip ${kb(gzip)}）`);

if (bytes > 4 * 1024 * 1024) {
  console.error('[minigame] ✗ 超过微信小游戏主包 4MB 上限');
  process.exit(1);
}

#!/usr/bin/env node
/**
 * WX-001 spike 构建（临时）
 *
 * 为什么用 esbuild 而不是 Vite：
 *   小游戏不需要 HTML/PWA/静态资源管线，只需要「一个 IIFE 的 game.js」。
 *   esbuild 已经在仓库里（所有离线测试都用它），依赖最少、产物最直白。
 *   等 WX-010 做正式构建时，再把这里替换成多入口（主包 + worker）。
 *
 * 产物：
 *   minigame/game.js   —— 微信开发者工具直接加载的入口
 *
 * 用法：`npm run build:minigame`
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outfile = join(root, 'minigame', 'game.js');

mkdirSync(join(root, 'minigame'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['src/minigame/spike/main.ts'],
  bundle: true,
  // 小游戏没有 ES module 入口，必须是单文件 IIFE
  format: 'iife',
  // ⚠️ 真机 JSCore 不支持 ES2020 的 `??` / `?.`（模拟器支持，真机报
  // "SyntaxError: Unexpected token ?"）。target 必须 ≤ es2017；
  // three r186 里也有现代语法，会一起被降级。
  target: ['es2017'],
  platform: 'browser',
  outfile,
  legalComments: 'none',
  sourcemap: false,
  // 先不压缩：真机报错时堆栈可读；正式构建再开 minify
  minify: false,
  logLevel: 'info',
});

const bytes = statSync(outfile).size;
const gzip = gzipSync(readFileSync(outfile)).length;
const kb = (value) => `${(value / 1024).toFixed(0)} KB`;
console.log(`[minigame] game.js ${kb(bytes)}（gzip ${kb(gzip)}）`);

// 微信小游戏主包上限 4MB；spike 就守住这条线，避免到 WX-050 才发现超了
if (bytes > 4 * 1024 * 1024) {
  console.error('[minigame] ✗ 超过微信小游戏主包 4MB 上限');
  process.exit(1);
}

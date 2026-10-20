#!/usr/bin/env node
/**
 * WX-020 真实世界构建
 *
 * 入口：src/minigame/world-boot.ts
 * 产物：minigame-world/game.js + minigame-world/workers/chunk.worker.js
 *
 * 与 build.mjs（压力场景）分开，避免把“真实地形”与“性能基线”混在一个工程里。
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapterEntry = join(root, 'vendor', 'minigame-adapter', 'index.js');
const outDir = join(root, 'minigame-world');
const outfile = join(outDir, 'game.js');
const workerOutfile = join(outDir, 'workers', 'chunk.worker.js');

if (!existsSync(adapterEntry)) {
  console.error('[minigame-world] ✗ 找不到 vendored 适配器：' + adapterEntry);
  process.exit(1);
}

mkdirSync(join(outDir, 'workers'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['src/minigame/world-boot.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2017'],
  platform: 'browser',
  outfile,
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

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
const total = bytes + workerBytes;
const kb = (value) => `${(value / 1024).toFixed(0)} KB`;

console.log(`[minigame-world] game.js ${kb(bytes)}（gzip ${kb(gzipSync(code).length)}）`);
console.log(
  `[minigame-world] chunk.worker.js ${kb(workerBytes)}（gzip ${kb(gzipSync(workerCode).length)}）`,
);
console.log(`[minigame-world] 主包合计 ${kb(total)}`);

for (const [label, source] of [
  ['game.js', code],
  ['chunk.worker.js', workerCode],
]) {
  const suspicious = (source.match(/\?\?|\?\./g) ?? []).length;
  if (suspicious > 0) {
    console.warn(`[minigame-world] ⚠️ ${label} 仍有 ${suspicious} 处 ??/?.`);
  }
}

if (total > 4 * 1024 * 1024) {
  console.error('[minigame-world] ✗ 主包 + worker 超过 4MB');
  process.exit(1);
}

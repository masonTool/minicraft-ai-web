#!/usr/bin/env node
/** v2 最小世界渲染构建：只证明 main core/render 能出包、能启动。 */
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = join(root, 'minigame-v2');
const outfile = join(outDir, 'game.js');

if (!existsSync(join(root, 'vendor', 'minigame-adapter', 'index.js'))) {
  console.error('[minigame-v2] 缺少 vendored adapter');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['src/minigame-v2/index.ts'],
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

const code = readFileSync(outfile, 'utf8');
const bytes = statSync(outfile).size;
console.log(`[minigame-v2] game.js ${(bytes / 1024).toFixed(0)} KB（gzip ${(gzipSync(code).length / 1024).toFixed(0)} KB）`);
if (bytes > 4 * 1024 * 1024) {
  console.error('[minigame-v2] 超过 4MB');
  process.exit(1);
}

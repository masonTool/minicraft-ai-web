#!/usr/bin/env node
/**
 * WX-006 构建：minigame-adapter + three r186
 *
 * 与 `build-spike.mjs` 的区别：
 *   - 入口是 `tools/minigame/spike-adapter/entry.mjs`
 *   - 引入 `references/minigame-publisher/minigame-adapter`（本地参考，gitignored）
 *   - 产物输出到独立目录 `minigame-adapter-spike/`，不覆盖 WX-001 的 `minigame/`
 *
 * 用法：`npm run build:minigame:adapter`
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapterEntry = join(root, 'references', 'minigame-publisher', 'minigame-adapter', 'index.js');
const outDir = join(root, 'minigame-adapter-spike');
const outfile = join(outDir, 'game.js');

if (!existsSync(adapterEntry)) {
  console.error(
    '[minigame] ✗ 找不到参考适配器：\n' +
      `  ${adapterEntry}\n` +
      '  请先把 minigame-publisher 放到 references/ 下（该目录已 gitignore）。',
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

/**
 * 适配器的 `HTMLScriptElement.js` 里有一句动态 require：
 *   require(`../${url.host + url.pathname}`)
 * esbuild 会把它当成“可能加载任意文件”，于是把 references 下的
 * node_modules/.git/README 全都扫进来，直接爆几千个错误。
 *
 * 我们的 spike 不使用 script 标签，替换成运行时报错即可；
 * 正式移植时这一块会直接删掉（小游戏用打包期静态入口）。
 */
const stubDynamicScriptRequire = {
  name: 'stub-dynamic-script-require',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /minigame-adapter[\\/]HTMLScriptElement\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const patched = source.replace(
        /require\(`\.\.\/\$\{url\.host \+ url\.pathname\}`\);/,
        'throw new Error("适配器动态脚本加载未实现（spike 不使用 script 标签）");',
      );
      return { contents: patched, loader: 'js' };
    });
  },
};

await build({
  absWorkingDir: root,
  entryPoints: ['tools/minigame/spike-adapter/entry.mjs'],
  bundle: true,
  format: 'iife',
  // ⚠️ 同 build-spike：真机不支持 ES2020 的 `??` / `?.`，必须降到 es2017
  target: ['es2017'],
  platform: 'browser',
  outfile,
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  plugins: [stubDynamicScriptRequire],
});

const bytes = statSync(outfile).size;
const gzip = gzipSync(readFileSync(outfile)).length;
const kb = (value) => `${(value / 1024).toFixed(0)} KB`;
console.log(`[minigame] adapter game.js ${kb(bytes)}（gzip ${kb(gzip)}）`);

if (bytes > 4 * 1024 * 1024) {
  console.error('[minigame] ✗ 超过微信小游戏主包 4MB 上限');
  process.exit(1);
}

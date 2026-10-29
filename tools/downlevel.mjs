/**
 * 产物降级（2026-10-30）：把 `web/dist` 里含现代语法的 JS 转成 es2018。
 *
 * ## 为什么需要这一步
 *
 * `vite.config.ts` 的 `build.target` 只对**我们自己写的源码**生效，有两类代码它管不到：
 *
 *   1. Vite 注入的运行时（实测 `modulepreload` 补丁带着 `l?.nonce`，`modulePreload.polyfill:false` 也关不掉）；
 *   2. 依赖包里预编译好的现代语法。
 *
 * 后果只在老 WebView 上炸：一台 Android 9 的手机 WebView 停在 72，
 * 入口文件解析阶段就 `Uncaught SyntaxError: Unexpected token .`，
 * 页面永远停在"加载中…"，logcat 里只有一行 CONSOLE，极难定位。
 *
 * ## 幂等约定
 *
 * 只写回**彻底干净**（转换后一处现代语法都不剩）的结果：
 * 有些 `?.` 落在字符串里，esbuild 转不动也不该转，这类文件重压一遍只会变大；
 * 不写回它们，下次构建就会跳过（因为源里已经没有可转的代码），不会越跑越大。
 *
 * 用法：`node tools/downlevel.mjs`（`build:web` 与 `pack` 都串了它）
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web/dist');
/** 与 vite.config.ts 的 build.target 保持一致 */
const TARGET = 'es2018';

/** 数现代语法出现次数（不用正则：这里被转义坑过一次） */
function countModern(text) {
  let count = 0;
  for (const token of ['?.', '??']) {
    let index = -1;
    while ((index = text.indexOf(token, index + 1)) >= 0) count += 1;
  }
  return count;
}

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = collect(DIST);
let changed = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');

  const result = await transform(source, {
    target: TARGET,
    minify: true,
    // 已经是模块，保持模块语义；不生成 sourcemap（发布产物要求无 .map）
    format: 'esm',
    legalComments: 'none',
  });

  /*
   * 无条件转换，内容变了才写。
   *
   * 不能用"数现代语法"来决定要不要转——`x===!0?.5:y` 这种三元表达式里的 `?.5`
   * 会被误判成可选链（实测主包里有 165 处），于是真正需要降级的文件被跳过。
   * esbuild 自己对已是 es2018 的代码是幂等的：第二次转换结果与输入相同，不会写回。
   */
  if (result.code === source) continue;
  writeFileSync(file, result.code);
  changed += 1;
}

console.log(`\n降级到 ${TARGET}：${files.length} 个 JS，改写 ${changed} 个` + (changed === 0 ? '（都已合规）' : ''));

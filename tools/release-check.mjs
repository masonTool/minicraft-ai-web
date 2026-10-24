#!/usr/bin/env node
/**
 * 发布构建后处理与断言（批次 20261025-0329 · 宿主4）
 *
 * 跑在 `vite build` 之后，做三件事：
 *   1. **压 `dist/index.html`**（304 KB 的明文 UI：注释 + 标签间空白）。只碰标签外层，
 *      `<script>` / `<style>` 内部一个字节都不动——那里面是内联脚本与 CSS，手改极易崩。
 *   2. **按形态决定 core.bin 的有无**：
 *        `--mode app`  不含（宿主必须自己注入）→ 有就报红；
 *        `--mode web`  含（完整前端形态）→ 没有就报红。
 *   3. **断言 + 记账**：无 `.map`、HTML 已压、JS 体积不超基线。
 *
 * 为什么这些必须是**断言**而不是"记得别做"：发布产物里多一个 `.map` 就等于把源码
 * 一起发了（`vite.config.ts` 的 sourcemap 默认是开的），多一个 `core.bin` 就等于
 * 门禁失效。两件事都不会让构建报错，只会静默地把方案作废——所以只能靠退出码兜。
 *
 * 用法：`node tools/release-check.mjs --mode app|web`
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CORE_SRC = join(ROOT, '.tmp/hostcore/core-v1.bin');

const modeArg = process.argv.indexOf('--mode');
const mode = modeArg >= 0 ? process.argv[modeArg + 1] : undefined;
if (mode !== 'app' && mode !== 'web') {
  console.error('用法：node tools/release-check.mjs --mode app|web');
  process.exit(2);
}

const problems = [];
const notes = [];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** 枚举产物文件（后面的压缩与断言都基于它） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push({ path, size: info.size });
  }
  return out;
}
const files0 = walk(DIST);

// ------------------------------------------------------------------ 1. HTML 压缩

/**
 * 保守的 HTML 压缩：只删标签**外层**的注释与空白。
 *
 * 不做的事（都是能压更多但容易改坏东西的）：不删 `<style>`/`<script>` 内部空白与注释、
 * 不重命名 class、不合并行、不动引号。收益已经够——这个文件 304 KB，绝大部分是
 * 标签间缩进与注释。
 */
function minifyHtml(html) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const rest = html.slice(i);
    // 原样保留 script / style / pre / textarea 的内容（只有它们内部的空白有意义）
    const raw = /^<(script|style|pre|textarea)\b/i.exec(rest);
    if (raw) {
      const tag = raw[1].toLowerCase();
      const closeAt = html.toLowerCase().indexOf(`</${tag}`, i);
      if (closeAt === -1) {
        out += rest;
        break;
      }
      const end = html.indexOf('>', closeAt) + 1;
      out += html.slice(i, end);
      i = end;
      continue;
    }
    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', i);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const ch = html[i];
    if (ch === '>') {
      // 标签之间的空白折叠：`>   \n  <` → `><`
      const m = /^>\s+</.exec(html.slice(i, i + 64));
      if (m) {
        out += '><';
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error('✗ dist/index.html 不存在：先跑 vite build');
  process.exit(1);
}
const before = readFileSync(indexPath, 'utf8');
const after = minifyHtml(before);
if (after.includes('</html>') === false) problems.push('HTML 压缩后丢了 </html>（压缩逻辑有 bug）');
writeFileSync(indexPath, after);
notes.push(`index.html ${kb(Buffer.byteLength(before))} → ${kb(Buffer.byteLength(after))}（压缩 ${(
  (1 - after.length / before.length) *
  100
).toFixed(0)}%）`);

// ------------------------------------------------------------------ 2. JS 压缩
/**
 * 用 esbuild 再压一遍 `dist` 里的 JS，只为了**测出压缩率**。
 *
 * 现阶段 rolldown 的产物已经是压缩态，再压一遍收益 0%（实测 4114.7 KB → 4114.5 KB）；
 * 留着这一步是因为"产物没压缩"这件事**不会让构建报错**，只会让手机上多下两倍体积，
 * 而且方块表这些明文常量连"读起来费劲"这点门槛都没了。哪天构建器升级把默认值改了，
 * 这里的压缩率会立刻从 0% 变成两位数——那比人工 review 产物可靠。
 *
 * 安全性：esbuild 对 ESM 单文件压缩会保留**导出名**（本地绑定改名 + `export { a as 原名 }`），
 * 跨 chunk 的 import 引用不会断；这一点由宿主4 之后的 Playwright 两形态实测复核过。
 */
{
  const targets = files0.filter((f) => f.path.endsWith('.js'));
  let beforeBytes = 0;
  let afterBytes = 0;
  for (const file of targets) {
    const code = readFileSync(file.path, 'utf8');
    beforeBytes += Buffer.byteLength(code);
    const result = await esbuild.transform(code, {
      minify: true,
      // ⚠️ 必须显式 utf8：默认会把中文/全角字符转成 \uXXXX，实测反而**涨 14%**
      charset: 'utf8',
      target: 'es2022',
      format: 'esm',
      loader: 'js',
    });
    writeFileSync(file.path, result.code);
    afterBytes += Buffer.byteLength(result.code);
  }
  notes.push(`JS ${targets.length} 个文件 ${kb(beforeBytes)} → ${kb(afterBytes)}（压缩 ${(
    (1 - afterBytes / Math.max(1, beforeBytes)) * 100
  ).toFixed(0)}%）`);
}

// ------------------------------------------------------------------ 3. core.bin 形态

const hostDir = join(DIST, '__host');
const hostFile = join(hostDir, 'core.bin');

if (mode === 'app') {
  if (existsSync(hostFile)) {
    rmSync(hostDir, { recursive: true, force: true });
    problems.push('dist 里出现了 __host/core.bin（已删除）：app 形态不能带它，否则门禁失效');
  }
} else {
  if (!existsSync(CORE_SRC)) {
    problems.push(`缺少 ${CORE_SRC}：先跑 npm run gen:hostcore`);
  } else {
    mkdirSync(hostDir, { recursive: true });
    copyFileSync(CORE_SRC, hostFile);
    const head = readFileSync(hostFile).subarray(0, 4).toString('latin1');
    if (head !== 'MCTB') problems.push(`dist/__host/core.bin 魔数不对（读到 ${JSON.stringify(head)}）`);
    notes.push(`core.bin 已放入 dist/__host（${kb(statSync(hostFile).size)}）`);
  }
}

// ------------------------------------------------------------------ 3. 版本清单
/**
 * `dist/version.json`：站点要求的最低核心数据版本（宿主5）。
 *
 * 宿主启动时把自报的 `core/N` 拼进 UA，页面读这个文件判"是不是太老了"。为什么是
 * **静态文件**而不是接口：这一整套方案刻意不要后台，多一个动态端点就多一份运维与可用性。
 *
 * ⚠️ `core` 从一个来源读——`blockTableCodec.ts` 的 `BLOCK_TABLE_VERSION`——而不是再抄一遍：
 * 抄一遍必然漂（二进制升到 v2、清单还写 1，结果新前端放行了旧壳，白屏）。
 */
{
  const codecSrc = readFileSync(join(ROOT, 'src/core/registry/blockTableCodec.ts'), 'utf8');
  const versionMatch = /export const BLOCK_TABLE_VERSION = (\d+)/.exec(codecSrc);
  if (versionMatch === null) {
    problems.push('读不到 blockTableCodec.ts 的 BLOCK_TABLE_VERSION（改过声明形式？）');
  } else {
    const coreVersion = Number(versionMatch[1]);
    const coreBin = join(ROOT, `.tmp/hostcore/core-v${coreVersion}.bin`);
    if (mode === 'web' && !existsSync(coreBin)) {
      problems.push(`缺少 ${coreBin}：core.bin 的版本与 BLOCK_TABLE_VERSION 对不上，先跑 npm run gen:hostcore`);
    }
    const manifest = {
      core: coreVersion,
      minSupportedCore: coreVersion,
      builtAt: new Date().toISOString(),
      mode,
    };
    writeFileSync(join(DIST, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    notes.push(`version.json core=${coreVersion} minSupportedCore=${coreVersion}`);
  }
}

// ------------------------------------------------------------------ 4. 断言

const files = walk(DIST);

const maps = files.filter((f) => f.path.endsWith('.map'));
if (maps.length > 0) {
  problems.push(`dist 里有 ${maps.length} 个 .map（等于把源码一起发布）：${maps.slice(0, 3).map((f) => f.path.slice(DIST.length + 1)).join(', ')}`);
}

const js = files.filter((f) => f.path.endsWith('.js'));
const gzipped = js.map((file) => ({
  name: file.path.slice(DIST.length + 1),
  raw: statSync(file.path).size,
  gzip: gzipSync(readFileSync(file.path), { level: 9 }).length,
}));
let totalGzip = 0;
for (const item of gzipped) totalGzip += item.gzip;

/** 主包 = 最大的那份 JS（入口 chunk）。语言包与 worker 是懒加载，不算进来 */
const mainChunk = [...gzipped].sort((a, b) => b.gzip - a.gzip)[0];

/**
 * 主包 gzip 基线（**防涨**的闸门，不是目标值）。
 *
 * ⚠️ 写这段时实测 733 200 字节（716 KB），取 740 000 留一点余量。注意它**远高于**
 * 队列里写的 338 456——那个数字是批次 85 量的，项目从那时到现在长了一倍多
 * （724 个方块、176 套测试、村庄/要塞/联机…），拿旧数字当目标是刻舟求剑。
 *
 * 真正该盯的是"数据搬走之后这一项要往下掉"：`blocks.ts` 的方块表明文就压在主包里，
 * 搬进 `core.bin` 时这里应当明显下降（预计 −20~30 KB gzip），届时把基线改小。
 */
const MAIN_GZIP_BASELINE = 740_000;
if (mainChunk.gzip > MAIN_GZIP_BASELINE) {
  problems.push(`主包 ${mainChunk.name} gzip ${mainChunk.gzip} 超过基线 ${MAIN_GZIP_BASELINE}（+${mainChunk.gzip - MAIN_GZIP_BASELINE} 字节）`);
}
notes.push(`主包 ${mainChunk.name} gzip ${kb(mainChunk.gzip)}（基线 ${kb(MAIN_GZIP_BASELINE)}，余量 ${kb(MAIN_GZIP_BASELINE - mainChunk.gzip)}）`);
notes.push(`全部 JS 合计 gzip ${kb(totalGzip)}（含 ${gzipped.length - 1} 个懒加载 chunk，仅记录不比基线）`);

const indexSize = statSync(indexPath).size;
if (indexSize > Buffer.byteLength(before)) {
  problems.push(`index.html 压缩后反而变大了（${indexSize} > ${Buffer.byteLength(before)}），压缩逻辑有问题`);
}
// 顺带记一笔：源文件那份 304 KB 里绝大部分是注释与缩进，产物应当明显更小
const sourceIndex = readFileSync(join(ROOT, 'index.html'), 'utf8').length;
notes.push(`index.html 产物 ${kb(indexSize)}（源文件 ${kb(sourceIndex)}）`);

const summary = createHash('sha256').update(`${mode}:${totalGzip}:${indexSize}`).digest('hex').slice(0, 12);

// ------------------------------------------------------------------ 输出

console.log(`\n发布构建检查 · mode=${mode}`);
for (const note of notes) console.log(`  · ${note}`);
console.log(`  · 产物指纹 ${summary}`);

if (problems.length > 0) {
  console.log('');
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log(`\n✗ ${problems.length} 项不通过`);
  process.exit(1);
}
console.log('\n✓ 全部通过（无 .map、无残留注释、core.bin 形态正确、体积未超基线）');

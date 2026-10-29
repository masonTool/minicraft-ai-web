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
const DIST = join(ROOT, 'web/dist');
const CORE_SRC = join(ROOT, '.tmp/hostcore/core-v1.bin');

const modeArg = process.argv.indexOf('--mode');
const mode = modeArg >= 0 ? process.argv[modeArg + 1] : undefined;
/**
 * `--android`：额外校验 APK 的封存体（A23）。
 *
 * 为什么不是一个新 `--mode`：`mode` 决定"这批产物该长什么样"（app / web 两种形态），
 * 而"要不要检查 Android 工程"是**正交**的——出 APK 时仍然是 app 形态的产物。
 * 用独立开关就不用把 mode 的每个分支都再分叉一次。
 */
const checkAndroid = process.argv.includes('--android');
if (mode !== 'app' && mode !== 'web') {
  console.error('用法：node tools/release-check.mjs --mode app|web [--android]');
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

/**
 * ⚠️ **两种形态的 dist 里都不该有 `core.bin`**（批次 20261025-1032 重新划清）：
 *
 *   · app（分离形态）：数据被桩掉，门禁要求它只来自安卓宿主 → 发了等于门禁失效；
 *   · web（自足形态）：数据**编进 JS 包里**，压根不需要这个文件。
 *
 * 也就是说 `core.bin` 只有两个去处：**APK 的 assets**，或者根本不生成（`npm run gen:hostcore`
 * 生成它就是给 APK 打包用的）。线上站点永远不带它——这条比"带一份给 web 用"简单得多，
 * 也顺带消掉了"web 站要跟着核心数据版本走"这层没必要的耦合。
 */
if (existsSync(hostDir)) {
  rmSync(hostDir, { recursive: true, force: true });
  problems.push('dist 里出现了 __host/：两种形态都不该带 core.bin（它的去处只有 APK），已删除');
}

// ------------------------------------------------------------------ 3.1 整包（A36）
/**
 * 发布产物里**不许**再出现明文游戏内容或旧封存形态。
 *
 * 整包加密之后，APK 里只该有 `assets/rt/libmcrt.so` 一个加密文件；
 * 旧形态（`assets/public`、`assets/sealed`）如果还在，说明有人走了老路，
 * 而这三种失败都不会让构建报错——只会让保护白做。
 */
{
  const ASSETS = join(ROOT, 'android/app/src/main/assets');
  for (const [rel, why] of [
    ['public', '整包加密后不该再有明文素材目录'],
    ['sealed', '旧的方块表封存形态已废弃'],
    ['public/__host/core.bin', '明文核心数据的旧路径'],
  ]) {
    const target = join(ASSETS, rel);
    if (existsSync(target)) problems.push(`assets 里还有废弃产物：${rel}（${why}）`);
  }
  if (mode === 'app') {
    const pkg = join(ASSETS, 'rt/libmcrt.so');
    if (!existsSync(pkg)) {
      problems.push('缺 assets/rt/libmcrt.so：先跑 npm run pack（需要先 build:web）');
    } else {
      const head = readFileSync(pkg).subarray(0, 8);
      if (!head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]))) {
        problems.push('libmcrt.so 不是预期的加密包（假 ELF 头不对）');
      }
    }
  }
}

// ------------------------------------------------------------------ 2.4 基线台账
/**
 * `host/baseline.json` 与 `host/core-baseline.bin` 必须**自洽**（批次 20261025-1627）。
 *
 * 台账记的是"线上 App 里装的是哪一版基线"。它一旦和 bin 对不上，后面所有增量都会
 * 基于错误的前提计算——而且不会有任何报错，只会表现为"发了增量但玩家看不到新方块"。
 * 所以每次发布都验一遍：条数 + 指纹都对得上才算数。
 */
{
  const MANIFEST = join(ROOT, 'host/baseline.json');
  const BIN = join(ROOT, 'host/core-baseline.bin');
  if (!existsSync(MANIFEST)) {
    if (existsSync(BIN)) {
      problems.push('有 host/core-baseline.bin 但没有 host/baseline.json：先跑 npm run release:baseline 补台账');
    } else {
      notes.push('尚无基线（还没封过版）：首次打包 APK 时跑 npm run release:baseline');
    }
  } else {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    if (!existsSync(BIN)) {
      problems.push('有 host/baseline.json 但缺 host/core-baseline.bin：台账与文件不成对');
    } else {
      const bin = readFileSync(BIN);
      const count = new DataView(bin.buffer, bin.byteOffset, bin.byteLength).getUint16(6, true);
      if (manifest.blockCount !== count) {
        problems.push(`台账记着 ${String(manifest.blockCount)} 个方块，基线文件里是 ${count} 个：两者不成对`);
      } else {
        notes.push(`基线 v${String(manifest.baselineVersion)}（${count} 条 / 指纹 ${String(manifest.fingerprint)} / 截止 ${String(manifest.cutAt)}）`);
      }
    }
  }
}

// ------------------------------------------------------------------ 2.5 方块表增量
/**
 * `dist/core-delta.json`：线上那份"改方块不用发版"的增量（批次 20261025-1032）。
 *
 * 只有 app 形态需要它（web 形态的数据编在包里，没有基线可套）。
 * 文件由 `npm run gen:delta` 产出；**没有变化时不存在**——这是正常状态，不是错误。
 *
 * 所以这里的检查重点不是"必须存在"，而是"如果存在，它必须能被解析、且 baseCount
 * 与 App 内置的基线一致"。发一份套不上的增量出去，等于所有老用户白跑一趟
 * （客户端会拒绝并降级，但新方块看不到又没人知道）。
 */
{
  const DELTA_SRC = join(ROOT, '.tmp/hostcore/core-delta.json');
  const BASE_FILE = join(ROOT, 'host/core-baseline.bin');
  if (mode === 'web') {
    notes.push('web 形态：不产出方块增量（数据编在包里，无基线可套）');
  } else if (!existsSync(DELTA_SRC)) {
    notes.push('没有方块增量（基线未变）——正常状态');
  } else {
    const raw = JSON.parse(readFileSync(DELTA_SRC, 'utf8'));
    let baseCount = -1;
    if (existsSync(BASE_FILE)) {
      const bin = readFileSync(BASE_FILE);
      baseCount = new DataView(bin.buffer, bin.byteOffset, bin.byteLength).getUint16(6, true);
    }
    let baselineVersion;
    const MANIFEST = join(ROOT, 'host/baseline.json');
    if (existsSync(MANIFEST)) baselineVersion = JSON.parse(readFileSync(MANIFEST, 'utf8')).baselineVersion;
    if (raw.baseVersion !== undefined && baselineVersion !== undefined && raw.baseVersion !== baselineVersion) {
      problems.push(
        `core-delta.json 基于基线 v${String(raw.baseVersion)}，而台账是 v${String(baselineVersion)}：` +
          '这份增量是对着旧基线算的，重新跑 npm run gen:delta',
      );
    }
    if (raw.baseCount !== baseCount) {
      problems.push(
        `core-delta.json 的 baseCount=${String(raw.baseCount)} 与 host/core-baseline.bin 的 ${baseCount} 不一致：` +
          '这份增量套不到 App 里的基线（客户端会拒绝），要么重新 gen:delta，要么换基线',
      );
    } else {
      copyFileSync(DELTA_SRC, join(DIST, 'core-delta.json'));
      notes.push(
        `方块增量已放入 dist：改 ${raw.patches.length} 条 / 增 ${raw.appends.length} 条` +
          `（基线 ${raw.baseCount}，指纹 ${raw.baseFingerprint}）`,
      );
    }
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
if (mode === 'web') {
  // 自足形态：数据在包里，页面不取 core.bin、也不看版本清单 —— 生成一份会误导（"web 也有版本契约？"）
  notes.push('web 形态：不生成 version.json（数据自足，不做宿主版本判定）');
} else {
  const codecSrc = readFileSync(join(ROOT, 'web/src/core/registry/blockTableCodec.ts'), 'utf8');
  const versionMatch = /export const BLOCK_TABLE_VERSION = (\d+)/.exec(codecSrc);
  if (versionMatch === null) {
    problems.push('读不到 blockTableCodec.ts 的 BLOCK_TABLE_VERSION（改过声明形式？）');
  } else {
    const coreVersion = Number(versionMatch[1]);
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

// ------------------------------------------------------------------ 3.5 方块表数据在不在产物里
/**
 * 探针：**只在 `blockSpecs.ts` 里出现的方块名**。
 *
 * ⚠️ 这个字符串选错过两次，两次都让断言变成"永远通过"的摆设：
 *   ① `dragon_egg_top` —— 方块表里压根没有这个贴图名（只有 `dragon_egg`），探针永远找不到；
 *   ② `bee_nest_top`   —— 它同时出现在图集清单（`render/atlasLayout.ts`），不带数据也在包里。
 * 现在用"只存在于 spec 的方块全名"，并保留了选型注释；换探针前请先
 * `grep -rl <候选> src` 确认只有 `blockSpecs.ts` 一处（外加本文件）。
 */
const PROBE = 'minicraft:amethyst_cluster';

// ------------------------------------------------------------------ 3.5 数据不在产物里
/**
 * 断言之"方块表数据必须不在主包里"（批次 20261025-1032 · 宿主9）。
 *
 * 为什么用**贴图名**当探针而不是方块名：`dragon_egg` 这种名字在物品表、多语言里也有，
 * grep 得到是正常的；而 `dragon_egg_top` 只出现在方块表的 `tiles` 里（`blockSpecs.ts`），
 * 生产构建换上空桩之后它必定消失。用错探针会得到"永远通过"的假断言。
 *
 * ⚠️ 这是**唯一**能证明"数据真的没进包"的检查：体积只降 6.8 KB（gzip），
 * 光看体积很容易被其它改动淹没，看不出是省了数据还是省了别的。
 */
{
  // 扫**全部** chunk，不只 `index-*`：两段式入口之后游戏体在 `main-*.js` 里，
  // 只盯入口会得到"数据不在包里"的假结论（这条踩过）。
  const assetsDir = join(DIST, 'assets');
  const chunks = (existsSync(assetsDir) ? readdirSync(assetsDir) : []).filter((n) => n.endsWith('.js'));
  if (chunks.length === 0) {
    problems.push('dist/assets 里没有 JS，无法确认方块表数据的位置');
  } else {
    const hit = chunks.find((n) => readFileSync(join(assetsDir, n), 'utf8').includes(PROBE));
    if (mode === 'app') {
      if (hit !== undefined) {
        problems.push(`app 形态的 ${hit} 里仍有方块表数据（探针 ${PROBE}）——blockSpecs 桩没生效`);
      } else {
        notes.push(`app 形态：方块表数据不在产物里（探针 ${PROBE} 不在任何 chunk）`);
      }
    } else if (hit === undefined) {
      problems.push(`web 形态的产物里找不到方块表数据（探针 ${PROBE} 消失）——数据没编进包，浏览器将无法游玩`);
    } else {
      notes.push(`web 形态：方块表数据已编进 ${hit}（自足，不需要 core.bin）`);
    }
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
/**
 * 主包 gzip 基线（字节）。
 *
 * 2026-10-25（批次 20261025-1032）方块表数据移出产物后实测 709.9 KB → 按"实测 + 一点余量"取 712 KB。
 * 数值调低是**显式动作**：把闸门收紧，别让这 12 KB 的收益被后续提交悄悄吃回去。
 * 想复现"带数据的对照"用 `SPECS_STUB=0 npm run build:app`（那时基线不适用）。
 */
const MAIN_GZIP_BASELINE = 712 * 1024;
if (mainChunk.gzip > MAIN_GZIP_BASELINE) {
  problems.push(`主包 ${mainChunk.name} gzip ${mainChunk.gzip} 超过基线 ${MAIN_GZIP_BASELINE}（+${mainChunk.gzip - MAIN_GZIP_BASELINE} 字节）`);
}
notes.push(`主包 ${mainChunk.name} gzip ${kb(mainChunk.gzip)}（基线 ${kb(MAIN_GZIP_BASELINE)}，余量 ${kb(MAIN_GZIP_BASELINE - mainChunk.gzip)}）`);
/**
 * 首屏成本看**合计**，不是单个 chunk。
 *
 * 两段式入口之后 `index-*.js` 只是引导器、游戏体在 `main-*.js`，单看任何一块都会漏掉另一半。
 *
 * ⚠️ 口径：这里把 `dist` 里**所有** JS 加在一起（含六语言包、worker 这些懒加载 chunk）。
 * 之所以不是"真首屏"：懒加载清单要靠构建清单才数得准，多一层解析就多一个会漂的口径；
 * 而语言包增长（加一句 UI 文案 = 六份文案同时长）恰恰是最容易被忽略的那部分成本。
 * 代价是这个名字有点误导：它是"全部 JS 合计"，不是"首屏"。
 *
 * 2026-10-25 实测 1199.1 KB → 取 1215 KB（实测 + 16 KB 余量）。
 * 2026-10-26 实测 1218.0 KB → 取 1230 KB（CI 红过一次：那天只留了 16 KB 余量，
 *   一天的内网/联网功能（main +19.4、语言包 +3.0、worker +3.1）就吃光了）。
 * 这个数**包含**拆包重复的那部分，将来用共享 chunk 收回来时应当把它调低（显式动作）。
 */
/**
 * 全部 JS 合计 gzip 基线（字节）。
 *
 * 2026-10-28（用户拍板）：**1230 → 1536 KB（1.5 MB）**。
 * 理由：这个项目实测合计 1230 KB、真实首屏约 1 MB，本来就不大；为了几百字节
 * 的波动反复调基线、卡发布，投入产出不成比例。用户原话"项目已经很小了，
 * 没有必要费那么大劲"。
 *
 * 放宽是**显式动作**，不是让闸门失效：它仍然拦"突然暴涨"（比如误把整个资源包
 * 编进产物）。真到 1.5 MB 时再谈拆 chunk——那时才值得花力气。
 * 另保留 0.5% 容差吸收正常迭代抖动，见下面 `TOTAL_SLACK`。
 */
const TOTAL_GZIP_BASELINE = 1536 * 1024;
/**
 * 容差（2026-10-28，用户报 GitHub Pages 发布失败）。
 *
 * 那天只超了 **255 字节**（1259775 vs 1259520），卡住了整个发布。这不是"代码膨胀"，
 * 是"上次留的 12 KB 余量被日常提交慢慢吃光了"——用 255 字节的溢出否决一次发布，
 * 和用 255 字节的"通过"掩盖真膨胀，一样没信息量。
 *
 * 所以基线改成"基线 + 容差"：
 *  - 落在容差内 → 通过，但打一条 note **把余量消耗显式写出来**（别让它无声无息）；
 *  - 超容差 → 红。0.5% ≈ 6 KB，够吸收一次正常迭代，又拦得住真的失控。
 * 基线本身仍然是"显式收紧/放宽"的动作，不随构建自动漂移。
 */
const TOTAL_SLACK = Math.round(TOTAL_GZIP_BASELINE * 0.005);
if (totalGzip > TOTAL_GZIP_BASELINE + TOTAL_SLACK) {
  problems.push(
    `全部 JS 合计 gzip ${totalGzip} 超过基线 ${TOTAL_GZIP_BASELINE} + 容差 ${TOTAL_SLACK}` +
      `（超 ${totalGzip - TOTAL_GZIP_BASELINE - TOTAL_SLACK} 字节）`,
  );
} else if (totalGzip > TOTAL_GZIP_BASELINE) {
  notes.push(
    `⚠️ 全部 JS 合计已用掉容差 ${totalGzip - TOTAL_GZIP_BASELINE}/${TOTAL_SLACK} 字节——` +
      `下次再涨就红了，该收一收（拆共享 chunk / 删冗余文案）`,
  );
}
notes.push(`全部 JS 合计 gzip ${kb(totalGzip)}（基线 ${kb(TOTAL_GZIP_BASELINE)}，含 ${gzipped.length - 1} 个懒加载 chunk 也计入）`);

const indexSize = statSync(indexPath).size;
if (indexSize > Buffer.byteLength(before)) {
  problems.push(`index.html 压缩后反而变大了（${indexSize} > ${Buffer.byteLength(before)}），压缩逻辑有问题`);
}
// 顺带记一笔：源文件那份 304 KB 里绝大部分是注释与缩进，产物应当明显更小
const sourceIndex = readFileSync(join(ROOT, 'web/index.html'), 'utf8').length;
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

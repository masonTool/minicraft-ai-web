#!/usr/bin/env node
/**
 * 构建体积预算（A11，批次 85）
 *
 * 为什么要有这个：`npm run build` 以前只打印"✓ built in 543ms"，**体积没有任何门禁**——
 * 手机上的首屏体验全靠自觉。而体积是那种"每次只多几 KB、半年后发现要 40 秒才能玩"的东西，
 * 光看构建日志是看不出来的（Vite 那句"chunks are larger than 500 kB"的警告也从第一版开始
 * 就在刷，刷久了就没人看了）。
 *
 * 这份脚本做三件事：
 *   1. 量出**每种产物**的原始体积与 gzip 体积（gzip 才是手机上真正的下载量）；
 *   2. 与预算表逐项比对，超了就**非零退出**；
 *   3. 把"预算值"与"量出来的值"一起打印——**改预算必须是一个显式的动作**，
 *      而不是"把数字改大直到变绿"（所以这里把上一次实测值写在注释里当参照）。
 *
 * ⚠️ 预算的取法：**实测值 + 一点余量**（不是"拍一个好看的数字"）。
 * 它是一道"别悄悄涨上去"的闸门，不是性能目标——真要减体积请改代码，
 * 而不是来这里把 1.40 改成 1.60（那等于把这道闸门拆了）。
 *
 * 用法：`npm run audit:bundle`（先跑 `npm run build`）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/assets/', import.meta.url);

/**
 * 预算表（单位：字节）。
 *
 * `measured` 是**写下这份预算时**的实测值（批次 85），留作参照：
 * 一旦某次提交把它顶到接近上限，看这里的差值就知道是不是自己干的。
 */
const BUDGETS = [
  {
    name: '主包（index-*.js）',
    match: /^index-.*\.js$/,
    raw: 1_400_000,
    gzip: 400_000,
    measured: { raw: 1_188_681, gzip: 338_456 },
    why: '首屏必须下载并执行的那一份（含 three 与整个游戏逻辑）',
  },
  {
    name: 'Worker 包（chunk.worker-*.js）',
    match: /^chunk\.worker-.*\.js$/,
    raw: 400_000,
    gzip: 120_000,
    measured: { raw: 291_663, gzip: 84_505 },
    why: '地形生成与网格化的 worker（首屏之后异步拉，但仍是必需下载）',
  },
];

/** 全部 JS 合计（防止"把主包拆成 20 个小块"这种把戏绕过上面的单项预算） */
const TOTAL = { raw: 1_900_000, gzip: 520_000, measured: { raw: 1_480_344, gzip: 422_961 } };

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const over = (value, limit) => value > limit;

let files;
try {
  files = readdirSync(DIST).filter((name) => name.endsWith('.js'));
} catch {
  console.error('✗ 找不到 dist/assets/ —— 先跑 `npm run build`');
  process.exit(1);
}
if (files.length === 0) {
  console.error('✗ dist/assets/ 里没有 .js 产物 —— 先跑 `npm run build`');
  process.exit(1);
}

let failed = false;
let totalRaw = 0;
let totalGzip = 0;

console.log('产物'.padEnd(34) + '原始'.padStart(10) + 'gzip'.padStart(10) + '  预算（原始 / gzip）');
for (const file of files.sort()) {
  const bytes = statSync(new URL(file, DIST)).size;
  // 源码映射不算进预算：它只在调试时下载（而且比产物本身还大，混进来会淹没真正的数字）
  if (file.endsWith('.map')) continue;
  const gzip = gzipSync(readFileSync(new URL(file, DIST))).length;
  totalRaw += bytes;
  totalGzip += gzip;

  const budget = BUDGETS.find((item) => item.match.test(file));
  const limits = budget ? `${kb(budget.raw)} / ${kb(budget.gzip)}` : '（无单项预算）';
  if (budget && (over(bytes, budget.raw) || over(gzip, budget.gzip))) failed = true;
  const mark = budget && (over(bytes, budget.raw) || over(gzip, budget.gzip)) ? ' ✗ 超预算' : '';
  console.log(file.padEnd(34) + kb(bytes).padStart(10) + kb(gzip).padStart(10) + `  ${limits}${mark}`);
}

console.log(
  '合计（不含 sourcemap）'.padEnd(30) +
    kb(totalRaw).padStart(10) +
    kb(totalGzip).padStart(10) +
    `  ${kb(TOTAL.raw)} / ${kb(TOTAL.gzip)}`,
);

// ---- 逐项说明（预算超了的时候，人要能立刻知道"这一项是什么、为什么重要"）
for (const budget of BUDGETS) {
  const file = files.find((name) => budget.match.test(name));
  if (!file) continue;
  const bytes = statSync(new URL(file, DIST)).size;
  const gzip = gzipSync(readFileSync(new URL(file, DIST))).length;
  console.log(`\n· ${budget.name}：${budget.why}`);
  console.log(
    `  实测 ${kb(bytes)} / gzip ${kb(gzip)}（写下预算时是 ${kb(budget.measured.raw)} / ` +
      `${kb(budget.measured.gzip)}，余量 ${kb(budget.raw - bytes)} / ${kb(budget.gzip - gzip)}）`,
  );
}

if (over(totalRaw, TOTAL.raw) || over(totalGzip, TOTAL.gzip)) failed = true;

if (failed) {
  console.log('\n✗ 构建体积超预算：请**减体积**（或显式地在 tools/bundle-budget.mjs 里抬预算并说明原因）');
  process.exit(1);
}
console.log('\n✓ 构建体积在预算内');

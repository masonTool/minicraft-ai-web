/**
 * 生成方块表二进制（批次 20261025-0329）
 *
 * 产物：`.tmp/hostcore/core-v<版本>.bin`（不提交，构建期生成）
 *
 * 这个文件是"**同一个文件、放哪决定形态**"的那个文件：
 *   · 放进 APK 的 assets → 宿主经 `shouldInterceptRequest` 交给页面，浏览器拿不到；
 *   · 放进静态服务器 → 完整前端方案（浏览器可玩）。
 *
 * 为什么源数据仍然是 `blocks.ts` 里的 SPECS：那是唯一真源，两千多行手写数据
 * 不可能反过来从二进制维护。这个脚本只做"从真源导出"，不参与运行时。
 *
 * 运行：`npm run gen:hostcore`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlockTable } from '../web/src/core/registry/blocks.ts';
import { BLOCK_TABLE_VERSION, encodeBlockTable } from '../web/src/core/registry/blockTableCodec.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, `.tmp/hostcore/core-v${BLOCK_TABLE_VERSION}.bin`);

const blocks = buildBlockTable();
const bytes = encodeBlockTable(blocks);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);

const gzip = gzipSync(bytes, { level: 9 });
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

// 字符串表占多少（用来判断"数据真的在二进制里"而不是被重复内联了）
const distinctStrings = new Set<string>();
for (const block of blocks) {
  distinctStrings.add(block.name);
  distinctStrings.add(block.tiles[0]);
  distinctStrings.add(block.tiles[1]);
  distinctStrings.add(block.tiles[2]);
  distinctStrings.add(block.shape);
}
const stringBytes = [...distinctStrings].reduce((sum, value) => sum + 2 + Buffer.byteLength(value, 'utf8'), 0);
const distinctShapes = new Set(blocks.map((block) => block.shape));

const behaviorBlocks = blocks.filter(
  (block) => block.stateTiles !== undefined || block.faceTile !== undefined || block.stateLight !== undefined,
);

console.log(`\n方块表二进制 · v${BLOCK_TABLE_VERSION}`);
console.log(`  文件        ${OUT}`);
console.log(`  方块数      ${blocks.length}`);
console.log(`  原始体积    ${kb(bytes.length)}（${bytes.length} 字节）`);
console.log(`  gzip 体积   ${kb(gzip.length)}`);
console.log(`  字符串表    ${distinctStrings.size} 段 / ${kb(stringBytes)}（去重后）`);
console.log(`  方块区      ${blocks.length} × 14 字节 = ${kb(blocks.length * 14)}`);
console.log(`  形状种类    ${distinctShapes.size}`);
console.log(`  带行为的块  ${behaviorBlocks.length}（这些的 stateTiles/faceTile/stateLight 不进文件，留在代码里）`);

if (behaviorBlocks.length > 0) {
  console.log(`  行为块示例  ${behaviorBlocks.slice(0, 6).map((block) => block.name.replace('minicraft:', '')).join(', ')}…`);
}

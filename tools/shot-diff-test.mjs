#!/usr/bin/env node
/**
 * 像素差的自检（Q11）。
 *
 * 分两块：
 *  ① **PNG 解码**——这块是自己实现的（5 种行 filter），最容易出错，所以要逐种验：
 *     造一个已知像素值的图 → 分别用 5 种 filter 编码 → 解回来必须与原图逐字节相同。
 *     "解码出来能显示"不代表对；只有"往返一致"才说明 filter 还原是对的。
 *  ② **比对判据**——同图必须 0 差异（否则门禁天天假红）；改一块必须精确检出，
 *     并且差异区域要对得上（差 1 像素也算错，因为那说明阈值逻辑写歪了）。
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {
  decodePng,
  encodePng,
  comparePng,
  makeDiffImage,
} = await import(join(projectRoot, 'tools', 'shot-diff.mjs'));

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

/**
 * 造一张指定尺寸的 RGBA 图，并按指定 filter 编码成 PNG。
 *
 * 这里**故意不复用 `encodePng`**：那个只写 filter=0，
 * 用它造测试数据就永远测不到 1~4 号 filter 的还原逻辑。
 */
function encodeWithFilter(width, height, rgba, filter) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = previous[i];
      const upLeft = i >= 4 ? previous[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw[y * (stride + 1) + 1 + i] = (row[i] - predictor) & 0xff;
    }
    previous = row;
  }

  // 组 PNG（只写必要的三个 chunk）
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, body])), 0);
    return Buffer.concat([length, typeBuffer, body, crcBuffer]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log('像素差自检');

// ---------------------------------------------------------------- PNG 解码：5 种 filter
{
  const width = 5;
  const height = 4;
  // 造点有起伏的像素值（纯色会让 sub/up 的预测值恒等于原值，测不出还原错误）
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37 + 11) & 0xff;
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  for (const [filter, name] of [
    [0, 'None'],
    [1, 'Sub'],
    [2, 'Up'],
    [3, 'Average'],
    [4, 'Paeth'],
  ]) {
    const decoded = decodePng(encodeWithFilter(width, height, rgba, filter));
    check(
      `filter=${filter}（${name}）解回来逐字节一致`,
      Buffer.compare(Buffer.from(decoded.data), Buffer.from(rgba)) === 0,
    );
  }

  // 编码往返（我们自己写的 encodePng）
  const roundTrip = decodePng(encodePng({ width, height, data: rgba }));
  check('encodePng → decodePng 往返一致', Buffer.compare(Buffer.from(roundTrip.data), Buffer.from(rgba)) === 0);

  // 拒绝不支持的格式要明确报错，而不是算出垃圾
  let threw = false;
  try {
    decodePng(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  } catch {
    threw = true;
  }
  check('非 PNG 明确抛错', threw);

  const badDepth = Buffer.from(encodeWithFilter(width, height, rgba, 0));
  badDepth[24] = 16; // 改 IHDR 的位深
  let depthThrew = false;
  try {
    decodePng(badDepth);
  } catch (error) {
    depthThrew = /位深/.test(String(error?.message));
  }
  check('16 位深明确抛错（不静默算错）', depthThrew);
}

// ---------------------------------------------------------------- 比对判据
{
  const width = 10;
  const height = 10;
  const make = (fill) => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill;
      data[i + 1] = fill;
      data[i + 2] = fill;
      data[i + 3] = 255;
    }
    return { width, height, data };
  };

  const a = make(100);
  const same = make(100);
  const diff = make(100);
  // 改其中 2×2 = 4 个像素
  for (const [x, y] of [
    [3, 4],
    [4, 4],
    [3, 5],
    [4, 5],
  ]) {
    const index = (y * width + x) * 4;
    diff.data[index] = 200;
    diff.data[index + 1] = 200;
    diff.data[index + 2] = 200;
  }

  const zero = comparePng(a, same);
  check('同一张图 0 差异（否则门禁天天假红）', zero.different === 0 && zero.ratio === 0);

  const changed = comparePng(a, diff);
  check('改 4 个像素就精确检出 4 个', changed.different === 4, `实际 ${changed.different}`);
  check('比例算对（4/100 = 4%）', Math.abs(changed.ratio - 4) < 1e-9, String(changed.ratio));
  check('差异区域框住那 2×2', changed.box?.minX === 3 && changed.box?.minY === 4 && changed.box?.maxX === 4 && changed.box?.maxY === 5);
  check('首个差异像素是 (3,4)', changed.firstDiff?.x === 3 && changed.firstDiff?.y === 4);

  // 容差内的小差异不算（抗锯齿噪音）
  const tiny = make(100);
  tiny.data[0] = 100 + 5; // 差 5，低于默认容差 8
  check('容差内的差异不计（抗锯齿噪音不误报）', comparePng(a, tiny).different === 0);

  // 尺寸不同要明确报错
  let sizeThrew = false;
  try {
    comparePng(a, { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4) });
  } catch {
    sizeThrew = true;
  }
  check('尺寸不同明确抛错', sizeThrew);

  // 差异图：变的地方涂红，没变的地方压暗
  const diffImage = makeDiffImage(a, diff);
  let red = 0;
  for (let i = 0; i < diffImage.data.length; i += 4) {
    if (diffImage.data[i] === 255 && diffImage.data[i + 1] === 0) red += 1;
  }
  check('差异图把变更处涂红，数量与检出数一致', red === 4, `实际 ${red}`);
}

// ---------------------------------------------------------------- 脚本契约
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(projectRoot, 'tools', 'shot-diff.mjs'), 'utf8');
  check('没有基线时建立基线、不报失败', /首次运行，已把这一张作为基线/.test(src));
  check('有 --update 接受新基线', src.includes('--update'));
  check('有 --threshold 可调', src.includes('--threshold'));
  check('差异图落盘供肉眼看', src.includes('.diff.png'));
  check('没浏览器时跳过（环境问题不算失败）', /\[skip\]/.test(src));
  // 只查**代码行**（注释里提到 pngjs 是在解释"为什么不用它"，不是依赖）
  const codeOnly = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/*'))
    .join('\n');
  check('不引第三方 PNG 库（用 node:zlib）', !/from 'pngjs'|require\('pngjs'\)|from 'sharp'/.test(codeOnly));

  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  check('有 npm run shotdiff', typeof pkg.scripts?.shotdiff === 'string');
}

console.log(`\n像素差测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

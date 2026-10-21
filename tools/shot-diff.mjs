#!/usr/bin/env node
/**
 * 截图像素差（Q11，A7 的第三块）。
 *
 * 用法：
 *   npm run shot -- --out world.png            # 先截一张，作为基线
 *   npm run shotdiff -- --name world.png       # 再截一张，与基线比
 *   npm run shotdiff -- --name world.png --update    # 把当前这张提升为新基线
 *   npm run shotdiff -- --name world.png --threshold 0.5   # 允许 0.5% 像素不同
 *
 * 目录约定（都在 `.tmp`，不进仓库）：
 *   `.tmp/shots/<name>`         当前这一张
 *   `.tmp/shots/<name>.base.png` 上一次认可的基线
 *   `.tmp/shots/<name>.diff.png` 差异可视化（只画不同处，方便肉眼看哪里变了）
 *
 * ⚠️ 为什么要自己解 PNG（不引 pngjs / sharp）：
 *   `node:zlib` 已经能做全部工作（PNG 是 zlib 压缩的扫描行 + 每行一个 filter 字节），
 *   为了一张图再拉一个原生依赖不划算——这个仓库的门禁刻意保持"纯离线、12 秒"。
 *   代价是要自己实现 5 种 filter 的还原，这部分有单独的测试盯着（见 shot-diff-test）。
 *
 * ⚠️ 与 screenshot / guard 同一条契约：**没有可比的基线时不算失败**。
 *   第一次跑必然没有基线（那是"建立基线"，不是"回归"）。把它当红，
 *   会让第一次使用的人立刻遇到一个假失败——这正是最容易劝退的门禁写法。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { openPage } from './browser.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = join(projectRoot, '.tmp', 'shots');

function parseArgs(argv) {
  const out = {
    name: 'home.png',
    url: 'http://localhost:5173/',
    wait: 6000,
    threshold: 0.1, // 允许不同的像素占比（%）
    update: false,
    width: 1280,
    height: 720,
    noShot: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (key === 'update') {
      out.update = true;
      continue;
    }
    if (key === 'no-shot') {
      out.noShot = true;
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) continue;
    if (key === 'name') out.name = value;
    else if (key === 'url') out.url = value;
    else if (key === 'wait') out.wait = Number(value);
    else if (key === 'threshold') out.threshold = Number(value);
    else if (key === 'width') out.width = Number(value);
    else if (key === 'height') out.height = Number(value);
  }
  return out;
}

// ------------------------------------------------------------------ PNG 解码

/** PNG 每行的 filter 类型 */
const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

/**
 * 把一个 PNG（8-bit，颜色类型 2=RGB / 6=RGBA，非隔行）解成 `{ width, height, data }`。
 *
 * `data` 是 RGBA 四通道的 `Uint8Array`（RGB 图会把 alpha 补成 255），
 * 这样比较时不用到处判断通道数。
 *
 * 只支持这几种格式是**故意的**：playwright 的截图固定是这几种，
 * 支持更多格式意味着更多没被验证过的分支。遇到别的格式直接抛错、让人知道要换图，
 * 比"悄悄算出一堆 0"好。
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('不是 PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // 长度(4) + 类型(4) + 数据 + CRC(4)

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`只支持 8 位深（这张是 ${bitDepth}）`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`只支持 RGB/RGBA（颜色类型 ${colorType}）`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  // 上一行（还原 filter 时要读它）；第一行按全 0 处理
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const source = raw.subarray(rowStart + 1, rowStart + 1 + stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const rawByte = source[i];

      let value;
      switch (filter) {
        case FILTER_NONE:
          value = rawByte;
          break;
        case FILTER_SUB:
          value = rawByte + left;
          break;
        case FILTER_UP:
          value = rawByte + up;
          break;
        case FILTER_AVERAGE:
          value = rawByte + (left + up) / 2;
          break;
        case FILTER_PAETH: {
          // Paeth 预测器：取三个邻居里"最接近"的那个
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default:
          throw new Error(`未知的行 filter：${filter}`);
      }
      current[i] = value & 0xff;
    }

    // 写进 RGBA
    for (let x = 0; x < width; x += 1) {
      const source0 = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = current[source0];
      pixels[target + 1] = current[source0 + 1];
      pixels[target + 2] = current[source0 + 2];
      pixels[target + 3] = channels === 4 ? current[source0 + 3] : 255;
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  return { width, height, data: pixels };
}

/** PNG 编码（只写 RGBA、无 filter，够用于 diff 图） */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = FILTER_NONE;
    Buffer.from(data.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  const chunks = [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  chunks.push(signature);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', deflateSync(raw)));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

/** 组一个 PNG chunk（长度 + 类型 + 数据 + CRC32） */
function makeChunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, body])), 0);
  return Buffer.concat([length, typeBuffer, body, crcBuffer]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ 比对

/**
 * 比较两张同尺寸图。
 *
 * 判据是**通道差超过 `tolerance` 的像素占比**（0~255 的绝对差）。
 * 为什么不用"逐字节完全相等"：同一段 DOM 在不同次渲染里，抗锯齿与
 * 字体次像素会差 1~2，那属于噪音；而"整块变黑"这种真回归差的是几十上百。
 *
 * @returns `{ total, different, ratio, firstDiff, box }`
 */
export function comparePng(a, b, tolerance = 8) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const total = a.width * a.height;
  let different = 0;
  let firstDiff = null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const index = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[index] - b.data[index]);
      const dg = Math.abs(a.data[index + 1] - b.data[index + 1]);
      const db = Math.abs(a.data[index + 2] - b.data[index + 2]);
      const da = Math.abs(a.data[index + 3] - b.data[index + 3]);
      if (dr > tolerance || dg > tolerance || db > tolerance || da > tolerance) {
        different += 1;
        if (!firstDiff) firstDiff = { x, y };
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    total,
    different,
    ratio: total === 0 ? 0 : (different / total) * 100,
    firstDiff,
    box: different > 0 ? { minX, minY, maxX, maxY } : null,
  };
}

/** 生成差异可视化：不同处涂红，其余压暗，方便一眼看出改了哪里 */
export function makeDiffImage(base, next, tolerance = 8) {
  const data = new Uint8Array(base.data.length);
  for (let i = 0; i < base.data.length; i += 4) {
    const dr = Math.abs(base.data[i] - next.data[i]);
    const dg = Math.abs(base.data[i + 1] - next.data[i + 1]);
    const db = Math.abs(base.data[i + 2] - next.data[i + 2]);
    const changed = dr > tolerance || dg > tolerance || db > tolerance;
    if (changed) {
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    } else {
      // 未变的部分压成深灰，红色会更显眼
      const grey = Math.round((base.data[i] + base.data[i + 1] + base.data[i + 2]) / 3 / 4);
      data[i] = grey;
      data[i + 1] = grey;
      data[i + 2] = grey;
      data[i + 3] = 255;
    }
  }
  return { width: base.width, height: base.height, data };
}

// ------------------------------------------------------------------ 主流程

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(SHOTS_DIR, { recursive: true });

  const shotPath = isAbsolute(args.name) ? args.name : join(SHOTS_DIR, args.name);
  const basePath = `${shotPath}.base.png`;
  const diffPath = `${shotPath}.diff.png`;

  // 1) 取当前这一张：先用浏览器截一张新的（除非明确说不要）
  if (!args.noShot) {
    const opened = await openPage({ viewport: { width: args.width, height: args.height } });
    if (!opened.ok) {
      console.log(`[skip] ${opened.reason}，跳过像素差。`);
      console.log('       （环境问题，退出码仍然是 0）');
      return 0;
    }
    const { page, close } = opened;
    try {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(args.wait);
      await page.screenshot({ path: shotPath });
    } finally {
      await close();
    }
    console.log(`[ok] 当前截图：${shotPath}`);
  }

  if (!existsSync(shotPath)) {
    console.error(`[fail] 找不到当前截图：${shotPath}`);
    return 1;
  }

  // 2) 没有基线 → 建立基线，不算失败
  if (!existsSync(basePath)) {
    writeFileSync(basePath, readFileSync(shotPath));
    console.log(`[base] 首次运行，已把这一张作为基线：${basePath}`);
    console.log('       下次再跑就会与它比较（要重新建立就加 --update）');
    return 0;
  }

  const base = decodePng(readFileSync(basePath));
  const next = decodePng(readFileSync(shotPath));
  const result = comparePng(base, next, 8);

  if (args.update) {
    writeFileSync(basePath, readFileSync(shotPath));
    console.log(`[base] 已更新基线（差异 ${result.ratio.toFixed(3)}% 被接受）：${basePath}`);
    return 0;
  }

  console.log(`[info] 尺寸 ${base.width}×${base.height}`);
  console.log(`[info] 不同像素 ${result.different} / ${result.total} = ${result.ratio.toFixed(3)}%（阈值 ${args.threshold}%）`);

  if (result.ratio > args.threshold) {
    writeFileSync(diffPath, encodePng(makeDiffImage(base, next)));
    console.error(`[fail] 像素差 ${result.ratio.toFixed(3)}% 超过阈值 ${args.threshold}%`);
    if (result.box) {
      console.error(
        `       差异区域：x ${result.box.minX}~${result.box.maxX}, y ${result.box.minY}~${result.box.maxY}`,
      );
    }
    if (result.firstDiff) console.error(`       第一个不同的像素：(${result.firstDiff.x}, ${result.firstDiff.y})`);
    console.error(`       差异图：${diffPath}`);
    console.error('       确认这是预期改动就加 --update 更新基线');
    return 1;
  }

  console.log('[ok] 像素差在阈值内');
  return 0;
}

// 只在直接执行时跑主流程（被测试 import 时不跑）
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('[fail] 像素差脚本出错：', error?.message ?? error);
      process.exit(1);
    });
}

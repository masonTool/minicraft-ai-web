#!/usr/bin/env node
/**
 * PNG 像素取样工具（验收用）
 *
 * 用途：把"看起来偏暗"这类主观判断变成可对比的数字。
 * 用法：node tools/pixel-probe.mjs <png> <x1,y1> [x2,y2 ...]
 *
 * 只支持非隔行、8 位、RGB/RGBA 的 PNG——截图工具输出的就是这种。
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 格式：bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));

  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知的 PNG 过滤器 ${filter}`);
      }
      out[i] = value & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

const [path, ...points] = process.argv.slice(2);
if (!path || points.length === 0) {
  console.error('用法: node tools/pixel-probe.mjs <png> <x,y> [x,y ...]');
  process.exit(1);
}

const image = decodePng(path);
console.log(`${path}  ${image.width}×${image.height}`);

for (const point of points) {
  const [xs, ys] = point.split(',');
  const x = Number(xs);
  const y = Number(ys);
  const i = (y * image.width + x) * image.channels;
  const r = image.pixels[i];
  const g = image.pixels[i + 1];
  const b = image.pixels[i + 2];
  const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  console.log(`  (${x},${y})  rgb(${r},${g},${b})  亮度 ${luma}`);
}

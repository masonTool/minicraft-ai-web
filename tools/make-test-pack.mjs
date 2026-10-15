/**
 * 生成一个用于验收的最小资源包（.mcpack）
 *
 * 里面放三张 16×16 纯色 PNG，分别替换 stone / dirt / grass_block_top，
 * 这样在浏览器里导入后，画面上的石头/泥土/草顶会变成醒目的纯色，一眼能看出替换生效。
 *
 * 运行：node tools/make-test-pack.mjs [输出路径]
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? '.tmp/test-pack.mcpack';

/** 造一张纯色 PNG（16×16，8 位 RGBA，无滤波） */
function makePng(r, g, b, size = 16) {
  // 原始像素：每行前面加一个滤波类型字节（0 = None）
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      // 加点棋盘格纹理，避免"纯色块"看起来像渲染错误
      const checker = (x + y) % 4 === 0 ? 28 : 0;
      raw[px] = Math.min(255, r + checker);
      raw[px + 1] = Math.min(255, g + checker);
      raw[px + 2] = Math.min(255, b + checker);
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);

  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 打包成 stored（不压缩）zip：内容已经压过了，再压没必要 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

const manifest = Buffer.from(
  JSON.stringify({
    format_version: 2,
    header: { name: '验收用测试材质包', description: '把石头/泥土/草顶换成纯色，用于验证资源包替换生效', version: [1, 0, 0] },
    modules: [{ type: 'resources', uuid: '00000000-0000-4000-8000-000000000001', version: [1, 0, 0] }],
  }),
  'utf8',
);

const pack = buildZip([
  ['pack_manifest.json', manifest],
  ['textures/blocks/stone.png', makePng(230, 60, 60)], // 红
  ['textures/blocks/dirt.png', makePng(60, 90, 230)], // 蓝
  ['textures/blocks/grass_top.png', makePng(240, 220, 60)], // 黄（图集里的名字是 grass_top）
  ['textures/blocks/not_a_real_tile.png', makePng(0, 0, 0)], // 名字对不上图集，用来验证 skipped
  ['models/block/stone.json', Buffer.from('{"parent":"block/cube_all"}', 'utf8')], // 应当被忽略
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, pack);
console.log(`已生成 ${OUT}（${pack.length} 字节，6 个条目，其中 3 张会被替换）`);

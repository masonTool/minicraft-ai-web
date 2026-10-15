/**
 * 资源包（K4）单元测试
 *
 * 这里测的是 zip 解析与 tile 名匹配——真正"画到图集上"的那一步需要 Canvas，
 * 只能在浏览器里验收（见 tools/pack-acceptance.js）。
 *
 * zip 样例是**手工拼出来的**：这样测试不依赖任何外部文件，
 * 也能精确覆盖 stored / deflate 两种压缩方式与各种路径写法。
 */

import { describe, expect, it } from 'vitest';
import { readZipEntries, tileNameOf } from '../src/core/resourcepack/ResourcePack.ts';

/** 拼一个只有中央目录 + 本地头的最小 zip（stored，不压缩） */
function buildStoredZip(files: Array<{ name: string; content: string }>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 版本
    lv.setUint16(6, 0, true); // 标志
    lv.setUint16(8, 0, true); // 方法 = stored
    lv.setUint16(10, 0, true); // 时间
    lv.setUint16(12, 0, true); // 日期
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); // 方法 = stored
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // 本地头偏移
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of locals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(eocd, cursor);
  return out.buffer;
}

/** 标准 CRC-32（zip 校验用；这里只在构造测试数据时用得到） */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

describe('zip 解析', () => {
  it('能读出 stored 条目的内容', async () => {
    const zip = buildStoredZip([
      { name: 'pack_manifest.json', content: '{"name":"测试包"}' },
      { name: 'textures/blocks/stone.png', content: 'PNG-DATA-STONE' },
    ]);

    const entries = await readZipEntries(zip, () => true);
    expect(entries).toHaveLength(2);
    const stone = entries.find((entry) => entry.name === 'textures/blocks/stone.png');
    expect(stone).toBeDefined();
    expect(new TextDecoder().decode(stone!.data)).toBe('PNG-DATA-STONE');
  });

  it('只解压 accept 认可的条目（其余直接跳过）', async () => {
    const zip = buildStoredZip([
      { name: 'models/block/stone.json', content: '{"model":1}' },
      { name: 'textures/blocks/dirt.png', content: 'PNG-DIRT' },
      { name: 'lang/zh_cn.json', content: '{"block":"石头"}' },
    ]);

    const entries = await readZipEntries(zip, (name) => tileNameOf(name) !== null);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('textures/blocks/dirt.png');
  });

  it('能解压 deflate 压缩的条目', async () => {
    const content = 'PNG'.repeat(200); // 够长，压缩后明显更小
    const compressed = new Uint8Array(
      await new Response(
        new Blob([encoder.encode(content)]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );

    // 手工拼一个 method=8 的条目（本地头 + 数据 + 中央目录 + EOCD）
    const nameBytes = encoder.encode('textures/blocks/grass_block_side.png');
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true); // method = deflate
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, content.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, content.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, 0, true);
    central.set(nameBytes, 46);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length + compressed.length, true);

    const zip = new Uint8Array(local.length + compressed.length + central.length + eocd.length);
    let cursor = 0;
    for (const part of [local, compressed, central, eocd]) {
      zip.set(part, cursor);
      cursor += part.length;
    }

    const entries = await readZipEntries(zip.buffer, () => true);
    expect(entries).toHaveLength(1);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(content);
  });

  it('不是 zip 时抛出明确错误', async () => {
    const notZip = encoder.encode('这不是一个 zip 文件，只是一段普通文本').buffer;
    await expect(readZipEntries(notZip, () => true)).rejects.toThrow(/zip|中央目录/);
  });
});

describe('tile 名匹配', () => {
  it('认识 textures/blocks/<名字>.png', () => {
    expect(tileNameOf('textures/blocks/stone.png')).toBe('stone');
    expect(tileNameOf('textures/blocks/oak_planks.png')).toBe('oak_planks');
    expect(tileNameOf('my_pack/textures/blocks/glass.png')).toBe('glass');
  });

  it('也认识直接放在 textures/ 下的写法', () => {
    expect(tileNameOf('textures/dirt.png')).toBe('dirt');
  });

  it('大小写不敏感', () => {
    expect(tileNameOf('textures/blocks/STONE.PNG')).toBe('stone');
  });

  it('不相关路径返回 null（模型、语言文件不该被当成贴图）', () => {
    expect(tileNameOf('models/block/stone.json')).toBeNull();
    expect(tileNameOf('textures/blocks/stone.png.mcmeta')).toBeNull();
    expect(tileNameOf('lang/zh_cn.json')).toBeNull();
    expect(tileNameOf('pack_manifest.json')).toBeNull();
  });
});

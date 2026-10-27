import { describe, expect, it } from 'vitest';
import { unzipStore, zipStore } from '../src/core/save/McPack.ts';

describe('.mc 存档包（zip）', () => {
  it('打包再解包内容一致', () => {
    const files = [
      { name: 'world.json', data: new TextEncoder().encode('{"name":"我的 世界","seed":42}') },
      { name: 'thumbnail.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
    ];
    const packed = unzipStore(zipStore(files));
    expect([...packed.keys()]).toEqual(['world.json', 'thumbnail.jpg']);
    // 中文与空格必须原样回来（文件名走 UTF-8 flag，内容不走任何转义）
    expect(new TextDecoder().decode(packed.get('world.json')!)).toContain('我的 世界');
    expect([...(packed.get('thumbnail.jpg') ?? [])]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  });

  it('生成的字节是合法 zip（本地文件头 + 中央目录 + EOCD）', () => {
    const packed = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // EOCD 在末尾 22 字节（无注释）
    expect(view.getUint32(packed.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(packed.length - 22 + 10, true)).toBe(1);
  });

  it('不是 zip 的字节解出来是空表（不抛错）', () => {
    expect(unzipStore(new Uint8Array([1, 2, 3, 4])).size).toBe(0);
  });
});

/**
 * `.mc` 存档包（用户 2026-10-27）。
 *
 * 格式：**标准 zip**，只是后缀改成 `.mc`。所以玩家用系统的解压工具也能打开看里面有什么
 * （`world.json` + `thumbnail.jpg` + 其余资源），这对"存档坏了想抢救"很重要。
 *
 * 只用 **store（不压缩）**：
 *  - 存档里的大头是区块数据，本来就是紧凑的二进制/JSON，deflate 收益有限；
 *  - 不压缩就不用自己实现 deflate（浏览器有 `CompressionStream`，但它异步、
 *    而且在老 Safari 上不可用）；体积靠"只在包内存一份"来控制。
 * 生成的文件仍然完全符合 ZIP 规范，任何工具都能解。
 */

/* ---------------------------------------------------------------- CRC32 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------------- 写 */

export interface PackEntry {
  /** 包内路径，例如 `world.json` */
  name: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
/** bit 11：文件名是 UTF-8（中文世界名必须置这个位，否则解压工具会按 cp437 显示乱码） */
const FLAG_UTF8 = 0x0800;

const encoder = new TextEncoder();

/** 把若干文件打成 zip（store） */
export function zipStore(entries: PackEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_SIG, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, FLAG_UTF8, true);
    localView.setUint16(8, 0, true); // method = store
    localView.setUint16(10, 0, true); // time
    localView.setUint16(12, 0x21, true); // date = 1980-01-01（固定的，保证同样内容打出来字节一致）
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_SIG, true);
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, FLAG_UTF8, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x21, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_SIG, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const total =
    locals.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/* ---------------------------------------------------------------- 读 */

/**
 * 解 zip（只认 store；deflate 的条目直接跳过）。
 *
 * 走中央目录而不是从头顺序扫：中央目录是权威索引，能跳过数据区里偶然出现的
 * `PK\x03\x04` 字节序列（压缩数据里很常见）。
 */
export function unzipStore(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 从尾部往前找 EOCD（末尾可能有注释，最多 65535 字节）
  let endOffset = -1;
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === END_SIG) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) return files;

  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (method === 0 && view.getUint32(localOffset, true) === LOCAL_SIG) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      files.set(name, bytes.subarray(start, start + size));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

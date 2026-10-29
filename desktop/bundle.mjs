/**
 * `game.pkg` 的读取端（桌面 / 测试共用）。
 *
 * 与 `tools/pack-bundle.ts` 的格式一一对应。刻意不 import electron：
 * 这样它能被纯 Node 测试直接跑（`npm run test:pack`），格式对不对不靠人肉推断。
 *
 * 用法：
 *   const bundle = openBundle(pkgBuffer, signerDigestHex);
 *   bundle.get('/index.html')  → Buffer | null
 */

import { createDecipheriv, hkdfSync } from 'node:crypto';

const MAGIC = Buffer.from('MCPK', 'ascii');
const VERSION = 1;
const INFO = Buffer.from('minicraft/bundle/v1', 'utf8');
const NONCE_LEN = 12;
const TAG_LEN = 16;

/**
 * 打开整包。
 *
 * @param {Buffer} pkg 包字节
 * @param {string} signerHex **实际**安装签名摘要（十六进制）；用它派生 KEK 试开包裹
 * @returns {{ get(path: string): Buffer | null, readonly paths: string[] } | null}
 */
export function openBundle(pkg, signerHex) {
  if (!Buffer.isBuffer(pkg) || pkg.length < 64) return null;
  if (!pkg.subarray(0, 4).equals(MAGIC)) return null;
  if (pkg.readUInt8(4) !== VERSION) return null;

  try {
    const wrapCount = pkg.readUInt8(5);
    if (wrapCount < 1) return null;

    let p = 8;
    const salt = pkg.subarray(p, p + 32);
    p += 32;
    const fileNonce = pkg.subarray(p, p + NONCE_LEN);
    p += NONCE_LEN;
    const wrapAad = pkg.subarray(0, 8 + 32 + NONCE_LEN);

    const kek = Buffer.from(hkdfSync('sha256', Buffer.concat([Buffer.from(signerHex, 'hex'), salt]), salt, INFO, 32));

    let cek = null;
    for (let i = 0; i < wrapCount; i++) {
      const len = pkg.readUInt16LE(p);
      const start = p + 2;
      const end = start + len;
      if (len < TAG_LEN || end > pkg.length) return null;
      if (cek === null) cek = gcmOpen(kek, fileNonce, wrapAad, pkg.subarray(start, end));
      p = end;
    }
    if (cek === null) return null;

    const count = pkg.readUInt16LE(p);
    p += 2;

    const entries = new Map();
    for (let i = 0; i < count; i++) {
      const pathLen = pkg.readUInt16LE(p);
      p += 2;
      const path = pkg.subarray(p, p + pathLen).toString('utf8');
      p += pathLen;
      const offset = pkg.readUInt32LE(p);
      p += 4;
      const length = pkg.readUInt32LE(p);
      p += 4;
      const nonce = pkg.subarray(p, p + NONCE_LEN);
      p += NONCE_LEN;
      entries.set(path, { offset, length, nonce });
    }

    const dataStart = p;
    const cache = new Map();

    return {
      get(path) {
        const cached = cache.get(path);
        if (cached !== undefined) return cached;
        const entry = entries.get(path);
        if (entry === undefined) return null;
        const aad = Buffer.concat([Buffer.from(path, 'utf8'), Buffer.from([0])]);
        const box = pkg.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length);
        const plain = gcmOpen(cek, entry.nonce, aad, box);
        if (plain === null) return null;
        cache.set(path, plain);
        return plain;
      },
      get paths() {
        return [...entries.keys()];
      },
    };
  } catch {
    return null;
  }
}

function gcmOpen(key, iv, aad, box) {
  if (box.length <= TAG_LEN) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(box.subarray(box.length - TAG_LEN));
    return Buffer.concat([decipher.update(box.subarray(0, box.length - TAG_LEN)), decipher.final()]);
  } catch {
    return null;
  }
}

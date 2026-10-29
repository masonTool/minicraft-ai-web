/**
 * `libmcrt.so` 的读取端（桌面壳与测试共用）。
 *
 * 与 `tools/pack-bundle.ts` 一一对应：假 ELF 头 → 头/盐/包裹 → 整段 AES-GCM 解密 →
 * gunzip → 内层容器（索引 + 文件）。
 *
 * 刻意不 import electron：这样它能被纯 Node 测试直接跑（`npm run test:pack`），
 * 三端解密实现"是否逐字节对齐"靠这套测试守。
 *
 *   const bundle = openBundle(pkgBuffer, signerDigestHex);
 *   bundle.get('index.html')  → Buffer | null
 */

import { createDecipheriv, hkdfSync } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const FAKE_ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);
const VERSION = 1;
const CODEC_GZIP = 1;
const INFO = Buffer.from('minicraft/bundle/v1', 'utf8');
const NONCE_LEN = 12;
const TAG_LEN = 16;

/**
 * @param {Buffer} pkg 整包字节
 * @param {string} signerHex **实际**安装签名摘要（十六进制）
 * @returns {{ get(path: string): Buffer | null, readonly paths: string[], readonly bytes: number } | null}
 */
export function openBundle(pkg, signerHex) {
  if (!Buffer.isBuffer(pkg) || pkg.length < 128) return null;
  if (!pkg.subarray(0, 8).equals(FAKE_ELF)) return null;

  try {
    let p = 8;
    const head = pkg.subarray(p, p + 4);
    p += 4;
    if (head.readUInt8(0) !== VERSION) return null;
    if (head.readUInt8(1) !== CODEC_GZIP) return null;
    const wrapCount = head.readUInt8(2);
    if (wrapCount < 1) return null;

    const salt = pkg.subarray(p, p + 32);
    p += 32;
    const fileNonce = pkg.subarray(p, p + NONCE_LEN);
    p += NONCE_LEN;
    const wrapAad = Buffer.concat([head, salt, fileNonce]);

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

    const bodyLen = pkg.readUInt32LE(p);
    const bodyStart = p + 4;
    if (bodyLen <= TAG_LEN || bodyStart + bodyLen > pkg.length) return null;

    // 整段 AAD 覆盖头部与全部包裹：改任何一个字节都解不开
    const payloadAad = pkg.subarray(8, bodyStart - 4); // 不含假 ELF 头，与打包端一致
    const compressed = gcmOpen(cek, fileNonce, payloadAad, pkg.subarray(bodyStart, bodyStart + bodyLen));
    if (compressed === null) return null;

    const container = gunzipSync(compressed);
    if (container.subarray(0, 4).toString('ascii') !== 'MCB1') return null;

    const count = container.readUInt16LE(4);
    let q = 6;
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      const pathLen = container.readUInt16LE(q);
      q += 2;
      const path = container.subarray(q, q + pathLen).toString('utf8');
      q += pathLen;
      const offset = container.readUInt32LE(q);
      q += 4;
      const length = container.readUInt32LE(q);
      q += 4;
      entries.set(path, { offset, length });
    }
    const dataStart = q;

    return {
      get(path) {
        const entry = entries.get(path);
        if (entry === undefined) return null;
        return container.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length);
      },
      get paths() {
        return [...entries.keys()];
      },
      get bytes() {
        return container.length;
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

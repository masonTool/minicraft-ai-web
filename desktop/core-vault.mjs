/**
 * 桌面端核心数据保险柜（Windows / macOS 共用）。
 *
 * 与 Android 的 `SealedCore.java`、iOS 的 `CoreVault.swift` 是**同一份格式**：
 * 验身份 → HKDF 派生 KEK → 解 CEK → 解载荷 → 逆形态变换。
 *
 * 刻意不 import electron：这一份要能在纯 Node 里跑单测（`npm run test:desktop`），
 * 否则"格式对不对"又只能靠人肉推断。
 *
 * ⚠️ 身份判据在两个桌面平台上都**不是**密码学意义上的锁：
 *   · macOS 读 codesign 的 Team ID；
 *   · Windows 读 Authenticode 证书指纹。
 * 两者都是公开信息，作用是把"改包重签名"这件事从"改一个字节"变成"得同时改校验"。
 * 开发态（未打包）直接放行，否则本地没法跑。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDecipheriv, hkdfSync } from 'node:crypto';

const INFO = Buffer.from('minicraft/core/v1', 'utf8');
const VERSION = 2;
const NONCE_LEN = 12;
const TAG_LEN = 16;

/** 读一个小文本文件并去掉首尾空白；读不到返回空串 */
function readText(dir, name) {
  try {
    return readFileSync(join(dir, name), 'utf8').trim();
  } catch {
    return '';
  }
}

function readBin(dir, name) {
  try {
    return readFileSync(join(dir, name));
  } catch {
    return null;
  }
}

/**
 * 判断当前进程是否由我们的签名构建启动。
 *
 * @param {{dir: string, packaged: boolean, bundlePath?: string}} options
 * @returns {boolean}
 */
export function verifyIdentity({ dir, packaged, bundlePath }) {
  // 开发态放行：`electron desktop` 跑的是未签名的源码目录
  if (!packaged) return true;

  if (process.platform === 'darwin') return identityMatches(readText(dir, 'team.txt'), macTeamId(bundlePath));
  if (process.platform === 'win32') {
    return identityMatches(readText(dir, 'win-cert.txt').toUpperCase(), windowsThumbprint(bundlePath));
  }

  // 其它平台没有可信判据 → 拒绝（fail-closed）
  return false;
}

/**
 * 身份比对规则（四象限，每一格都有明确后果）：
 *
 * | 期望（配置） | 实际（安装包） | 结果 | 为什么 |
 * | --- | --- | --- | --- |
 * | 空 | 未签名 | **放行** | 本地/无证书构建，否则应用直接打不开 |
 * | 空 | 有签名 | 拒绝 | 没配置却带着别人的签名 = 改包重签 |
 * | 有值 | 未签名 | 拒绝 | 正式包被剥掉签名 |
 * | 有值 | 有签名 | 相同才放行 | 正常路径 |
 *
 * 注意"有值 / 未签名 → 拒绝"这一格：正式发版必须签名，否则运行时一律解不开。
 */
function identityMatches(expected, actual) {
  if (expected === '') return actual === null;
  return actual !== null && actual === expected;
}

/** `codesign -dv --verbose=4 <App.app>` 的 stderr 里有 `TeamIdentifier=XXXX` */
function macTeamId(bundlePath) {
  try {
    const output = execFileSync('/usr/bin/codesign', ['-dv', '--verbose=4', bundlePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return /TeamIdentifier=([A-Z0-9]+)/.exec(output)?.[1] ?? null;
  } catch (error) {
    // codesign 把这些信息写在 stderr 且退出码非 0 是常见情况
    const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}`;
    return /TeamIdentifier=([A-Z0-9]+)/.exec(text)?.[1] ?? null;
  }
}

/** `Get-AuthenticodeSignature` 拿签名证书指纹；未签名返回 null */
function windowsThumbprint(exePath) {
  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-AuthenticodeSignature '${String(exePath).replace(/'/g, "''")}').SignerCertificate.Thumbprint`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const value = output.replace(/\s/g, '').toUpperCase();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/**
 * 解封核心数据。
 *
 * @param {{dir: string, packaged: boolean, bundlePath?: string}} options
 * @returns {Buffer | null} 解不开就返回 null（调用方一律按"没有核心数据"处理）
 */
export function unsealCore(options) {
  try {
    if (!verifyIdentity(options)) return null;
    const sealed = readBin(options.dir, 'core.sealed');
    const salt = readBin(options.dir, 'salt.bin');
    const signer = readText(options.dir, 'signers.txt').split('\n')[0]?.trim() ?? '';
    if (sealed === null || salt === null || salt.length !== 32 || !/^[0-9a-fA-F]{64}$/.test(signer)) {
      return null;
    }
    return decrypt(sealed, signer, salt);
  } catch {
    return null;
  }
}

function decrypt(sealed, signerHex, salt) {
  let p = 0;
  if (sealed.length < 34) return null;
  const version = sealed[p++];
  const wrapCount = sealed[p++];
  if (version !== VERSION || wrapCount < 1) return null;

  const permK = sealed.readUInt16LE(p);
  p += 2;
  const plainLen = sealed.readUInt32LE(p);
  p += 4;
  p += 2; // reserved

  const header = sealed.subarray(0, p);
  const nonce = sealed.subarray(p, p + NONCE_LEN);
  p += NONCE_LEN;

  // v2：每个允许的签名各一份包裹。桌面端拿不到"自身签名摘要"，
  // 只能用 signers.txt[0] 派生——与它对应的那份包裹能打开，其余打不开。
  const kek = Buffer.from(hkdfSync('sha256', Buffer.concat([Buffer.from(signerHex, 'hex'), salt]), salt, INFO, 32));
  const wrapAad = Buffer.concat([header, nonce]);

  let cek = null;
  for (let i = 0; i < wrapCount; i++) {
    const len = sealed.readUInt16LE(p);
    const start = p + 2;
    const end = start + len;
    if (len < TAG_LEN || end > sealed.length) return null;
    if (cek === null) cek = open(kek, nonce, wrapAad, sealed.subarray(start, end));
    p = end;
  }
  if (cek === null) return null;

  const payloadLen = sealed.readUInt32LE(p);
  const payloadStart = p + 4;
  if (payloadLen <= TAG_LEN || payloadStart + payloadLen > sealed.length) return null;
  const payload = sealed.subarray(payloadStart, payloadStart + payloadLen);

  // AAD 绑上"全部包裹体"（header + nonce + wraps）
  const transformed = open(cek, nonce, sealed.subarray(0, p), payload);
  if (transformed === null || transformed.length !== plainLen) return null;

  const n = transformed.length;
  const plain = Buffer.alloc(n);
  let position = 0;
  for (let i = 0; i < n; i++) {
    plain[position] = transformed[i];
    position = (position + permK) % n;
  }
  return plain;
}

function open(key, iv, aad, box) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(box.subarray(box.length - TAG_LEN));
    return Buffer.concat([decipher.update(box.subarray(0, box.length - TAG_LEN)), decipher.final()]);
  } catch {
    return null;
  }
}

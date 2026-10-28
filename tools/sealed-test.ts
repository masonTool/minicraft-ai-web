/**
 * 封存格式往返测试（A23）
 *
 * 为什么需要这一套：`CoreVault.java` 在这台机器上**编译不了**（没有 Android SDK），
 * 于是"两边格式对齐"这件事没有编译器帮忙。这里把 Java 的每一步**照着实现一遍**：
 *
 *   解析头部 → HKDF 派生 KEK → 解包裹取 CEK → 解载荷 → 逆形态变换
 *
 * 能还原出逐字节相同的明文，格式就是对的；Java 只要严格照同一份步骤写就不会错。
 * 反过来，任何一侧改了字段顺序 / AAD 范围 / info 字符串，这里立刻红。
 *
 * 另外三条负面断言（改一个字节、换签名、换盐）才是保护真正在意的东西：
 * 它们证明"签名不符 → 解不开"不是靠一层可以被跳过 if 判出来的。
 */

import { createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INFO = Buffer.from('minicraft/core/v1', 'utf8');
const SEALED_VERSION = 1;
const NONCE_LEN = 12;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

/** 与 `seal-core.ts` / `CoreVault.java` 同一套派生 */
function hkdf(salt: Buffer, ikm: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, INFO, 32));
}

function aesGcmOpen(key: Buffer, iv: Buffer, aad: Buffer, cipherText: Buffer): Buffer | null {
  try {
    const body = cipherText.subarray(0, cipherText.length - 16);
    const tag = cipherText.subarray(cipherText.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
}

/** 逐字节照抄 `CoreVault.open()` */
function unseal(sealed: Buffer, signerHex: string, salt: Buffer): Buffer | null {
  let p = 0;
  const version = sealed[p];
  p += 1;
  const wrapCount = sealed[p];
  p += 1;
  if (version !== SEALED_VERSION || wrapCount !== 1) return null;

  const permK = sealed.readUInt16LE(p);
  p += 2;
  const plainLen = sealed.readUInt32LE(p);
  p += 4;
  p += 2;

  const header = sealed.subarray(0, p);
  const nonce = sealed.subarray(p, p + NONCE_LEN);
  p += NONCE_LEN;

  const wrapLen = sealed.readUInt16LE(p);
  const wrapStart = p + 2;
  const wrapEnd = wrapStart + wrapLen;
  if (wrapLen < 16 || wrapEnd > sealed.length) return null;
  const wrapped = sealed.subarray(wrapStart, wrapEnd);

  const kek = hkdf(salt, Buffer.concat([Buffer.from(signerHex, 'hex'), salt]));
  const cek = aesGcmOpen(kek, nonce, Buffer.concat([header, nonce]), wrapped);
  if (cek === null) return null;

  const payloadLen = sealed.readUInt32LE(wrapEnd);
  const payloadStart = wrapEnd + 4;
  if (payloadLen <= 16 || payloadStart + payloadLen > sealed.length) return null;
  const payload = sealed.subarray(payloadStart, payloadStart + payloadLen);

  const transformed = aesGcmOpen(cek, nonce, sealed.subarray(0, wrapEnd), payload);
  if (transformed === null) return null;
  if (transformed.length !== plainLen) return null;

  const n = transformed.length;
  const plain = Buffer.alloc(n);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    plain[pos] = transformed[i];
    pos = (pos + permK) % n;
  }
  return plain;
}

const plain = readFileSync(join(ROOT, 'host/core-baseline.bin'));
const sealed = readFileSync(join(ROOT, 'android/app/src/main/assets/sealed/core.sealed'));
const salt = readFileSync(join(ROOT, 'android/app/src/main/assets/sealed/salt.bin'));
const signers = readFileSync(join(ROOT, 'android/app/src/main/assets/sealed/signers.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const signer = signers[0] ?? '';

console.log('\n[封存体基本形态]');
check('封存体不空', sealed.length > 0);
check('不以明文魔数 MCTB 开头', sealed.subarray(0, 4).toString('ascii') !== 'MCTB');
check('不是明文本身', !sealed.equals(plain), `${sealed.length} vs ${plain.length}`);
check('盐是 32 字节', salt.length === 32, String(salt.length));
check('白名单至少一条', signers.length > 0);

console.log('\n[往返：能还原逐字节相同的明文]');
const restored = unseal(sealed, signer, salt);
check('解封成功', restored !== null);
check('长度一致', restored?.length === plain.length);
check(
  '内容一致',
  restored !== null && createHash('sha256').update(restored).digest('hex') === createHash('sha256').update(plain).digest('hex'),
);
check('还原结果就是合法方块表（魔数 MCTB）', restored?.subarray(0, 4).toString('ascii') === 'MCTB');

console.log('\n[负面：任何一处改动都必须解不开]');
{
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 20] ^= 0xff;
  check('载荷翻一个字节 → 解不开', unseal(tampered, signer, salt) === null);
}
{
  const tampered = Buffer.from(sealed);
  tampered[2] ^= 0x01; // permK 低位
  check('改形态步长 → 载荷 AAD 对不上，解不开', unseal(tampered, signer, salt) === null);
}
{
  const otherSigner = randomBytes(32).toString('hex');
  check('换签名（别人的证书）→ KEK 不同，解不开', unseal(sealed, otherSigner, salt) === null);
}
{
  const otherSalt = randomBytes(32);
  check('换盐 → 解不开', unseal(sealed, signer, otherSalt) === null);
}
{
  check('截断 → 解不开', unseal(sealed.subarray(0, 40), signer, salt) === null);
}
{
  const emptySigner = '';
  check('白名单为空 → 解不开（fail-closed）', unseal(sealed, emptySigner, salt) === null);
}

console.log(`\n封存往返测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

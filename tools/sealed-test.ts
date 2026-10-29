/**
 * 封存格式往返测试（A23 / v2 · A30）
 *
 * 为什么需要这一套：`SealedCore.java` 在这台机器上**编译不了**（没有 Android SDK），
 * 于是"两边格式对齐"这件事没有编译器帮忙。这里把 Java 的每一步**照着实现一遍**：
 *
 *   解析头部 → 用**实际签名**派生 KEK → 逐个尝试包裹体取 CEK → 解载荷 → 逆形态变换
 *
 * 能还原出逐字节相同的明文，格式就是对的；Java 只要严格照同一份步骤写就不会错。
 *
 * 负面断言才是保护真正在意的东西：**换签名解不开**、**改一个字节解不开**。
 * 它们证明"签名不符就进不去"靠的不是一个能被 patch 的 if，而是密钥本身对不上。
 */

import { createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INFO = Buffer.from('minicraft/core/v1', 'utf8');
const VERSION = 2;
const NONCE_LEN = 12;
const TAG_LEN = 16;

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

/** 与 `seal-core.ts` / `SealedCore.java` 同一套派生 */
function hkdf(salt: Buffer, ikm: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, INFO, 32));
}

function aesGcmOpen(key: Buffer, iv: Buffer, aad: Buffer, cipherText: Buffer): Buffer | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(cipherText.subarray(cipherText.length - TAG_LEN));
    return Buffer.concat([decipher.update(cipherText.subarray(0, cipherText.length - TAG_LEN)), decipher.final()]);
  } catch {
    return null;
  }
}

/** 逐字节照抄 `SealedCore.decrypt()` */
function unseal(sealed: Buffer, signerHex: string, salt: Buffer): Buffer | null {
  let p = 0;
  if (sealed.length < 34) return null;
  const version = sealed[p];
  p += 1;
  const wrapCount = sealed[p];
  p += 1;
  if (version !== VERSION || wrapCount < 1) return null;

  const permK = sealed.readUInt16LE(p);
  p += 2;
  const plainLen = sealed.readUInt32LE(p);
  p += 4;
  p += 2;

  const header = sealed.subarray(0, p);
  const nonce = sealed.subarray(p, p + NONCE_LEN);
  p += NONCE_LEN;
  const wrapBlockStart = p;

  const kek = hkdf(salt, Buffer.concat([Buffer.from(signerHex, 'hex'), salt]));
  const wrapAad = Buffer.concat([header, nonce]);

  let cek: Buffer | null = null;
  for (let i = 0; i < wrapCount; i++) {
    const len = sealed.readUInt16LE(p);
    const start = p + 2;
    const end = start + len;
    if (len < TAG_LEN || end > sealed.length) return null;
    if (cek === null) cek = aesGcmOpen(kek, nonce, wrapAad, sealed.subarray(start, end));
    p = end;
  }
  if (cek === null) return null;

  const payloadLen = sealed.readUInt32LE(p);
  const payloadStart = p + 4;
  if (payloadLen <= TAG_LEN || payloadStart + payloadLen > sealed.length) return null;

  const payloadAad = sealed.subarray(0, p); // header + nonce + 全部包裹体
  const transformed = aesGcmOpen(cek, nonce, payloadAad, sealed.subarray(payloadStart, payloadStart + payloadLen));
  if (transformed === null || transformed.length !== plainLen) return null;

  const n = transformed.length;
  const plain = Buffer.alloc(n);
  let position = 0;
  for (let i = 0; i < n; i++) {
    plain[position] = transformed[i];
    position = (position + permK) % n;
  }
  void wrapBlockStart;
  return plain;
}

const SEALED_PATH = join(ROOT, 'android/app/src/main/assets/sealed/core.sealed');
/**
 * 封存产物是 **gitignore 的构建输出**：全新检出 / CI 上不存在。
 * 缺它就跳过（而不是崩），与项目里"没浏览器就跳过浏览器门禁"同一口径——
 * 但要说清是"跳过"不是"通过"，否则等于静默失去这条断言。
 */
if (!existsSync(SEALED_PATH)) {
  console.log('\n[skip] 封存产物不存在：先跑 `npm run gen:sealed`');
  console.log('       （端上构建下线后这条测试只在有产物时才有意义）');
  process.exit(0);
}

const plain = readFileSync(join(ROOT, 'host/core-baseline.bin'));
const sealed = readFileSync(SEALED_PATH);
const salt = readFileSync(join(ROOT, 'android/app/src/main/assets/sealed/salt.bin'));
const signers = readFileSync(join(ROOT, 'android/app/src/main/assets/sealed/signers.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const signer = signers[0] ?? '';

console.log('\n[封存体基本形态]');
check('封存体不空', sealed.length > 0);
check('版本是 2', sealed[0] === 2, String(sealed[0]));
check('不以明文魔数 MCTB 开头', sealed.subarray(0, 4).toString('ascii') !== 'MCTB');
check('不是明文本身', !sealed.equals(plain), `${sealed.length} vs ${plain.length}`);
check('盐是 32 字节', salt.length === 32, String(salt.length));
check('包裹数与白名单条数一致', sealed[1] === signers.length, `wrapCount=${sealed[1]} 白名单=${signers.length}`);

console.log('\n[往返：用实际签名能还原逐字节相同的明文]');
const restored = unseal(sealed, signer, salt);
check('解封成功', restored !== null);
check('长度一致', restored?.length === plain.length);
check(
  '内容一致',
  restored !== null &&
    createHash('sha256').update(restored).digest('hex') === createHash('sha256').update(plain).digest('hex'),
);
check('还原结果是合法方块表（魔数 MCTB）', restored?.subarray(0, 4).toString('ascii') === 'MCTB');

if (signers.length > 1) {
  console.log('\n[多包裹：白名单里的每个签名都能解开自己的那份]');
  for (const [i, other] of signers.entries()) {
    check(`signers[${i}] 能解封`, unseal(sealed, other, salt) !== null);
  }
}

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
  check('换签名（别人的证书）→ 派生出别的 KEK，解不开', unseal(sealed, otherSigner, salt) === null);
}
{
  const otherSalt = randomBytes(32);
  check('换盐 → 解不开', unseal(sealed, signer, otherSalt) === null);
}
{
  check('截断 → 解不开', unseal(sealed.subarray(0, 40), signer, salt) === null);
}
{
  check('空签名 → 解不开（fail-closed）', unseal(sealed, '', salt) === null);
}
{
  // 把窗口从 1 改成 0：相当于"把校验判断改掉"的那种改法，数据本身也必须打不开
  const tampered = Buffer.from(sealed);
  tampered[1] = 0;
  check('把包裹数改成 0（模拟绕过判断）→ 解不开', unseal(tampered, signer, salt) === null);
}

console.log(`\n封存往返测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

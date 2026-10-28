/**
 * 核心数据封存（A23）
 *
 * 把 `host/core-baseline.bin`（明文紧凑方块表）封成 `core.sealed` 放进 APK 的 assets，
 * 由原生在启动时**先验签名、再解封**。产物里不再有任何可直接读取的方块表。
 *
 * 运行：`npm run gen:sealed`（`android:sync` 会自动跑一次）
 *
 * ## 文件布局（小端，**不带魔数**：读错文件时表现为"解不开"，而不是"认出来了"）
 *
 *   u8   version        = 1
 *   u8   wrapCount      = 1
 *   u16  permK          形态变换的步长（与明文长度互质）
 *   u32  plainLen       明文长度
 *   u16  reserved
 *   12B  fileNonce
 *   u16  wrapLen
 *   ...  包裹后的 CEK（AES-256-GCM）
 *   u32  payloadLen
 *   ...  变换后的数据（AES-256-GCM）
 *
 * AAD 绑定"它前面的一切"：包裹体绑 header+nonce，载荷再绑上包裹体本身。
 * 于是改任何一个字节（包括 permK / plainLen）都会让解密直接失败。
 *
 * ## 密钥
 *
 *   KEK = HKDF-SHA256(salt = release.config.json: saltHex,
 *                     ikm  = 期望签名证书摘要 ‖ salt,
 *                     info = "minicraft/core/v1")
 *
 * ⚠️ 必须说清边界：证书摘要本身是**公开信息**，所以 KEK 不是"只有官方私钥才能算出来"的
 * 密码学锁。真正把改签包挡住的是原生里的**签名比对 + 解封耦合**：签名不符就不解封。
 * 把摘要混进 KEK 的作用是"换签名后连派生链都对不上"，属于提高绕过成本，不是秘密。
 *
 * 这也正是 `release.config.json` 的 `signingCertSha256` 必须填**应用签名证书**的原因：
 * 填错（比如填成 upload key）会让 Play 上的正式包自己解不开。
 */

import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = join(ROOT, 'host/core-baseline.bin');
const CONFIG = join(ROOT, 'release.config.json');
const OUT_DIR = join(ROOT, 'android/app/src/main/assets/sealed');
const OUT_SEALED = join(OUT_DIR, 'core.sealed');
const OUT_SIGNERS = join(OUT_DIR, 'signers.txt');
/**
 * iOS 侧同一份产物：`ios/App/App/sealed/` 是以**文件夹引用**加进 Xcode target 的，
 * 所以两条路必须由同一次生成写出来——分别生成迟早会出现"两个平台装的是不同数据"。
 */
const IOS_DIR = join(ROOT, 'ios/App/App/sealed');

/** 与 `CoreVault.java` 的 `INFO` 必须逐字节一致 */
const INFO = Buffer.from('minicraft/core/v1', 'utf8');
/** 与 `CoreVault.java` 的 `SEALED_VERSION` 一致 */
const SEALED_VERSION = 1;
const NONCE_LEN = 12;
/** 没配真实证书时的占位：`release:audit` 一见它就红，避免占位悄悄发出去 */
const DEV_PLACEHOLDER_SIGNER = '0'.repeat(64);

interface ReleaseConfig {
  signingCertSha256?: unknown;
  saltHex?: unknown;
}

/** 最小质因数互不相关的步长：挑第一个与 n 互质的奇数，避免退化成位移 */
function pickPermutation(n: number): number {
  for (let k = 3; k < 65535; k += 2) {
    if (gcd(k, n) === 1) return k;
  }
  throw new Error(`找不到与长度 ${n} 互质的步长：这份明文长度不适合做形态变换`);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** `transformed[i] = plain[(i * k) % n]`；逆变换是 `plain[(i * k) % n] = transformed[i]` */
function permute(input: Uint8Array, k: number): Uint8Array {
  const n = input.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = input[(i * k) % n];
  return out;
}

function hkdf(salt: Buffer, ikm: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, INFO, 32));
}

function readConfig(): { signers: string[]; salt: Buffer } {
  const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as ReleaseConfig;
  const list = Array.isArray(raw.signingCertSha256) ? raw.signingCertSha256 : [];
  const signers = list
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/:/g, '').trim().toLowerCase())
    .filter((value) => /^[0-9a-f]{64}$/.test(value));
  if (signers.length === 0) {
    // 空列表 = 还没配真实证书。允许出包（否则开发内循环全断），但用**全零占位**
    // 封存，于是任何真机都解不开；而 `release:audit --mode app` 见到这个占位会直接红。
    console.log(
      '\n⚠️ release.config.json 的 signingCertSha256 为空，本次用**全零占位**封存：\n' +
        '   · 开发/联调可以走通链路，但真机一定解不开（这是故意的 fail-closed）\n' +
        '   · 正式发布前必须填 Play App Signing 的**应用签名证书** SHA-256（不是 upload key）\n' +
        '   · 拿法：对 Play 已发布版本的 APK 跑 `apksigner verify --print-certs`',
    );
    signers.push(DEV_PLACEHOLDER_SIGNER);
  }
  const saltHex = typeof raw.saltHex === 'string' ? raw.saltHex.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(saltHex)) {
    throw new Error('release.config.json 的 saltHex 必须是 64 位十六进制（32 字节）');
  }
  return { signers, salt: Buffer.from(saltHex, 'hex') };
}

function main(): void {
  const { signers, salt } = readConfig();
  const plain = readFileSync(PLAIN);
  if (plain.length === 0) throw new Error('host/core-baseline.bin 是空的');

  const k = pickPermutation(plain.length);
  const transformed = permute(plain, k);

  const nonce = randomBytes(NONCE_LEN);
  const cek = randomBytes(32);

  // 头 10 字节：version / wrapCount / permK / plainLen / reserved
  const header = Buffer.alloc(10);
  header.writeUInt8(SEALED_VERSION, 0);
  header.writeUInt8(1, 1);
  header.writeUInt16LE(k, 2);
  header.writeUInt32LE(plain.length, 4);
  header.writeUInt16LE(0, 8);

  // KEK：期望签名摘要 + 盐一起做 ikm，换证书 → 派生链整体变化
  const signerBytes = Buffer.from(signers[0], 'hex');
  const kek = hkdf(salt, Buffer.concat([signerBytes, salt]));

  const wrapAad = Buffer.concat([header, nonce]);
  const wrapCipher = createCipheriv('aes-256-gcm', kek, nonce);
  wrapCipher.setAAD(wrapAad);
  const wrapped = Buffer.concat([wrapCipher.update(cek), wrapCipher.final(), wrapCipher.getAuthTag()]);

  const wrapLen = Buffer.alloc(2);
  wrapLen.writeUInt16LE(wrapped.length, 0);

  const payloadAad = Buffer.concat([header, nonce, wrapLen, wrapped]);
  const payloadCipher = createCipheriv('aes-256-gcm', cek, nonce);
  payloadCipher.setAAD(payloadAad);
  const payload = Buffer.concat([
    payloadCipher.update(Buffer.from(transformed)),
    payloadCipher.final(),
    payloadCipher.getAuthTag(),
  ]);

  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32LE(payload.length, 0);

  const sealed = Buffer.concat([header, nonce, wrapLen, wrapped, payloadLen, payload]);

  const appId = String(
    (JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8')) as { appId?: unknown }).appId ?? '',
  );
  if (appId === '') throw new Error('capacitor.config.json 里没有 appId：iOS 的 bundle 绑定靠它');

  const writeAll = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core.sealed'), sealed);
    // 原生只读这一份白名单；与 KEK 用的是同一条（[0]），两处不可能对不上
    writeFileSync(join(dir, 'signers.txt'), `${signers.join('\n')}\n`);
    // 盐也写进包：**单一真源**。Java / Swift 都不再抄一遍常量，改盐只改一处
    writeFileSync(join(dir, 'salt.bin'), salt);
    // iOS 的身份判据（Android 用证书摘要）：iOS 没有读自身签名身份的公开 API，
    // 能绑的只有 bundle id；见 ios/App/App/CoreVault.swift 的注释
    writeFileSync(join(dir, 'bundle.txt'), `${appId}\n`);
  };
  writeAll(OUT_DIR);
  writeAll(IOS_DIR);

  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
  console.log('\n核心数据封存');
  console.log(`  明文        ${kb(plain.length)}（${plain.length} 字节）`);
  console.log(`  封存体      ${kb(sealed.length)}（${sealed.length} 字节，+${kb(sealed.length - plain.length)}）`);
  console.log(`  形态步长    k=${k}（与长度互质）`);
  console.log(`  签名白名单  ${signers.length} 条`);
  console.log(`  产物        ${OUT_SEALED}`);
  console.log(`  白名单      ${OUT_SIGNERS}`);
  console.log(`  明文摘要    ${createHash('sha256').update(plain).digest('hex').slice(0, 16)}…`);
}

main();

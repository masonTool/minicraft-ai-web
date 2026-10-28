/**
 * 核心数据封存（A23，格式 v2 / A30）
 *
 * 把 `host/core-baseline.bin`（明文紧凑方块表）封成 `core.sealed` 放进安装包，
 * 由原生在启动时解封。产物里不再有任何可直接读取的方块表。
 *
 * 运行：`npm run gen:sealed`（`android:sync` / `ios:sync` 会自动跑一次）
 *
 * ## 格式 v2（小端，**不带魔数**：读错文件时表现为"解不开"，而不是"认出来了"）
 *
 *   u8   version        = 2
 *   u8   wrapCount      = N（允许的签名身份个数）
 *   u16  permK          形态变换的步长（与明文长度互质）
 *   u32  plainLen       明文长度
 *   u16  reserved
 *   12B  fileNonce
 *   N × (u16 wrapLen + 包裹后的 CEK)      ← 每个允许的签名身份包一份
 *   u32  payloadLen
 *   ...  变换后的数据（AES-256-GCM）
 *
 * AAD 绑定"它前面的一切"：每个包裹体绑 header+nonce，载荷再绑上**全部**包裹体。
 *
 * ## 密钥
 *
 *   KEK_i = HKDF-SHA256(salt = saltHex, ikm = 摘要_i ‖ salt, info = "minicraft/core/v1")
 *   CEK   = 每次构建随机的 32 字节，被 KEK_i 各包一份
 *
 * ## 为什么是"多份包裹"（这是 A30 的修法）
 *
 * v1 只有一个包裹，且运行时拿的是 `signers.txt` 里的**期望摘要**——那等于
 * "密钥由文件内容决定"，把这个校验分支 patch 掉就能解密。
 *
 * v2 让运行时拿**安装包实际签名**去派生 KEK：正版包的 KEK 恰好能打开属于它的那份包裹；
 * 换成别人的证书重签，派生出来的 KEK 打不开任何一份，**patch 代码也没用**——
 * 数据本身就没给他准备钥匙。
 *
 * ⚠️ 边界仍然要说清：证书摘要、盐、密文全在包里，**读懂格式的人可以离线自己解**。
 * v2 提高的是"改包重签"的成本（从改一个布尔变成必须自己重封），不是数学上的不可破。
 */

import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = join(ROOT, 'host/core-baseline.bin');
const CONFIG = join(ROOT, 'release.config.json');
const OUT_DIR = join(ROOT, 'android/app/src/main/assets/sealed');
const OUT_SEALED = join(OUT_DIR, 'core.sealed');
/**
 * iOS 侧同一份产物：`ios/App/App/sealed/` 是以**文件夹引用**加进 Xcode target 的，
 * 所以两条路必须由同一次生成写出来——分别生成迟早会出现"两个平台装的是不同数据"。
 */
const IOS_DIR = join(ROOT, 'ios/App/App/sealed');
/** 桌面端：Electron 打包时作为 extraResources 进 `resources/sealed`。 */
const DESKTOP_DIR = join(ROOT, 'desktop/resources/sealed');

/** 与 `SealedCore.java` 的 `INFO` 必须逐字节一致 */
const INFO = Buffer.from('minicraft/core/v1', 'utf8');
/** 与 `SealedCore.java` 的 `VERSION` 一致 */
const SEALED_VERSION = 2;
const NONCE_LEN = 12;

interface ReleaseConfig {
  signingCertSha256?: unknown;
  saltHex?: unknown;
  macTeamId?: unknown;
  winCertThumbprint?: unknown;
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

/**
 * 本机 Android debug keystore 的证书摘要。
 *
 * 开发包用 debug 证书签名，摘要必然不在正式白名单里；v2 又要用**实际签名**派生 KEK，
 * 所以本地必须有一份"属于 debug 证书"的包裹，否则开发者自己都跑不起来。
 *
 * ⚠️ 只在**非发布**封装时加入（`MINICRAFT_RELEASE=1` 时排除）——
 * 把 debug 摘要带进正式包，等于给"拿到我们 debug keystore 的人"留了一把钥匙。
 */
function debugKeystoreDigest(): string | null {
  const home = process.env.HOME ?? '';
  const path = join(home, '.android/debug.keystore');
  if (home === '' || !existsSync(path)) return null;
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/keytool') : 'keytool';
  try {
    const out = execFileSync(
      keytool,
      ['-list', '-v', '-keystore', path, '-alias', 'androiddebugkey', '-storepass', 'android', '-keypass', 'android'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = /SHA256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})/.exec(out);
    return match === null ? null : match[1].replace(/:/g, '').toLowerCase();
  } catch {
    return null;
  }
}

function readConfig(): { signers: string[]; salt: Buffer; raw: ReleaseConfig } {
  const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as ReleaseConfig;
  const list = Array.isArray(raw.signingCertSha256) ? raw.signingCertSha256 : [];
  const configured = list
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/:/g, '').trim().toLowerCase())
    .filter((value) => /^[0-9a-f]{64}$/.test(value));

  const release = process.env.MINICRAFT_RELEASE === '1';
  if (release && configured.length === 0) {
    throw new Error(
      'MINICRAFT_RELEASE=1 但 release.config.json 的 signingCertSha256 为空：\n' +
        '  · 正式封装必须知道"哪个签名能解开"，否则发出去的包自己也打不开\n' +
        '  · 填 Play App Signing 的**应用签名证书** SHA-256（不是 upload key）',
    );
  }

  const signers = [...new Set(configured)];
  if (!release) {
    const debugDigest = debugKeystoreDigest();
    if (debugDigest !== null && !signers.includes(debugDigest)) signers.push(debugDigest);
    if (signers.length === 0) {
      throw new Error(
        '既没有配置签名证书，也没找到 ~/.android/debug.keystore：\n' +
          '  · 开发：先构建一次 debug 包，让 Android Studio/Gradle 生成 debug keystore\n' +
          '  · 正式：填 release.config.json 的 signingCertSha256',
      );
    }
  }

  const saltHex = typeof raw.saltHex === 'string' ? raw.saltHex.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(saltHex)) {
    throw new Error('release.config.json 的 saltHex 必须是 64 位十六进制（32 字节）');
  }
  return { signers, salt: Buffer.from(saltHex, 'hex'), raw };
}

function main(): void {
  const { signers, salt, raw } = readConfig();
  const plain = readFileSync(PLAIN);
  if (plain.length === 0) throw new Error('host/core-baseline.bin 是空的');

  const k = pickPermutation(plain.length);
  const transformed = permute(plain, k);

  const nonce = randomBytes(NONCE_LEN);
  const cek = randomBytes(32);

  // 头 10 字节：version / wrapCount / permK / plainLen / reserved
  const header = Buffer.alloc(10);
  header.writeUInt8(SEALED_VERSION, 0);
  header.writeUInt8(signers.length, 1);
  header.writeUInt16LE(k, 2);
  header.writeUInt32LE(plain.length, 4);
  header.writeUInt16LE(0, 8);

  const wrapAad = Buffer.concat([header, nonce]);
  const wraps: Buffer[] = [];
  for (const signerHex of signers) {
    const kek = hkdf(salt, Buffer.concat([Buffer.from(signerHex, 'hex'), salt]));
    const cipher = createCipheriv('aes-256-gcm', kek, nonce);
    cipher.setAAD(wrapAad);
    const wrapped = Buffer.concat([cipher.update(cek), cipher.final(), cipher.getAuthTag()]);
    const len = Buffer.alloc(2);
    len.writeUInt16LE(wrapped.length, 0);
    wraps.push(Buffer.concat([len, wrapped]));
  }
  const wrapBlock = Buffer.concat(wraps);

  // 载荷的 AAD 绑上"全部包裹体"：少一份、改一份，都解不开
  const payloadCipher = createCipheriv('aes-256-gcm', cek, nonce);
  payloadCipher.setAAD(Buffer.concat([header, nonce, wrapBlock]));
  const payload = Buffer.concat([
    payloadCipher.update(Buffer.from(transformed)),
    payloadCipher.final(),
    payloadCipher.getAuthTag(),
  ]);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32LE(payload.length, 0);

  const sealed = Buffer.concat([header, nonce, wrapBlock, payloadLen, payload]);

  const appId = String(
    (JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8')) as { appId?: unknown }).appId ?? '',
  );
  if (appId === '') throw new Error('capacitor.config.json 里没有 appId：iOS 的 bundle 绑定靠它');

  // 桌面端的身份判据与移动端不同：macOS 看 codesign 的 Team ID，Windows 看
  // Authenticode 证书指纹。没填就写空文件——打包后的应用会因此拒绝解封（fail-closed），
  // 而开发态（未打包）仍然放行，否则本地没法跑。
  const macTeamId = typeof raw.macTeamId === 'string' ? raw.macTeamId.trim() : '';
  const winThumbprint = typeof raw.winCertThumbprint === 'string'
    ? raw.winCertThumbprint.replace(/\s/g, '').toUpperCase()
    : '';

  const writeAll = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core.sealed'), sealed);
    // iOS / 桌面端没有"读自身签名"的能力，只能按 [0] 派生；Android 用**实际**签名。
    // 两条路都对着同一份包裹列表，所以这份名单必须与 wraps 同序同源。
    writeFileSync(join(dir, 'signers.txt'), `${signers.join('\n')}\n`);
    writeFileSync(join(dir, 'salt.bin'), salt);
    writeFileSync(join(dir, 'bundle.txt'), `${appId}\n`);
    writeFileSync(join(dir, 'team.txt'), `${macTeamId}\n`);
    writeFileSync(join(dir, 'win-cert.txt'), `${winThumbprint}\n`);
  };
  writeAll(OUT_DIR);
  writeAll(IOS_DIR);
  writeAll(DESKTOP_DIR);

  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
  console.log('\n核心数据封存（格式 v2）');
  console.log(`  明文        ${kb(plain.length)}（${plain.length} 字节）`);
  console.log(`  封存体      ${kb(sealed.length)}（${sealed.length} 字节，+${kb(sealed.length - plain.length)}）`);
  console.log(`  形态步长    k=${k}（与长度互质）`);
  console.log(`  签名包裹    ${signers.length} 份`);
  for (const [i, signer] of signers.entries()) console.log(`    [${i}] ${signer.slice(0, 16)}…`);
  console.log(`  产物        ${OUT_SEALED}`);
  console.log(`  明文摘要    ${createHash('sha256').update(plain).digest('hex').slice(0, 16)}…`);
}

main();

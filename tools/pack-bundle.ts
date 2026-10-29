/**
 * 整包加密（A36）：`web/dist` → 一个**看起来像原生库**的加密包 `libmcrt.so`。
 *
 * ## 为什么是"整包一个密文"
 *
 * 逐文件加密在安全上没有额外收益——同一把 CEK，解开一个文件和解开整包成本一样。
 * 整包一次 AES-GCM 反而更简单，语义也更强：**任何一处被改，整个包直接打不开**。
 * 4.4 MB 的包整段解密只要十几毫秒，谈不上性能问题。
 *
 * ## 为什么叫 `.so`、还带假 ELF 头
 *
 * 放 `assets/` 下（**不是** `lib/<abi>/`，那里会被 Android 当原生库、Play 会校验 ELF）
 * 的文件，Android 完全不解释。名字与头 4 字节 `\x7fELF` 只是让 `unzip` + `file` 的人
 * 以为它是原生库，顺手跳过。
 *
 * ## 包格式（小端，假头之后）
 *
 *   "\x7fELF" + 4B 占位            假 ELF 头，不属于加密范围
 *   u8 version=1 | u8 codec(gzip) | u8 wrapCount | u8 reserved
 *   32B salt | 12B fileNonce
 *   wrapCount × (u16 len + AES-GCM(CEK))     每个允许的签名一份
 *   u32 cipherLen
 *   整段密文 = AES-GCM( gzip( 内层容器 ) )
 *
 * 内层容器（解密 + gunzip 之后）：
 *
 *   "MCB1" | u16 count | count × (u16 pathLen, path, u32 offset, u32 length) | 数据区
 *
 * ## 密钥
 *
 *   KEK_i = HKDF-SHA256(salt, 摘要_i ‖ salt, info="minicraft/bundle/v1")
 *   CEK   = 随机 32B，被每个 KEK_i 各包一份
 *
 * ⚠️ 证书摘要是**公开信息**。这里挡住的是"改包重签后跑起来"和"解包后把游戏搬走"，
 * 不是"别人永远拿不到内容"——纯客户端做不到后者。
 */

import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web/dist');
const CONFIG = join(ROOT, 'release.config.json');
const OUT_DIR = join(ROOT, 'build/rt');
/** 伪装成原生库的文件名（三端统一） */
const OUT_PKG = join(OUT_DIR, 'libmcrt.so');

const FAKE_ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);
const VERSION = 1;
const CODEC_GZIP = 1;
const INFO = Buffer.from('minicraft/bundle/v1', 'utf8');
const NONCE_LEN = 12;

interface ReleaseConfig {
  signingCertSha256?: unknown;
}

/**
 * 本机 Android debug keystore 的证书摘要。
 *
 * 开发包用 debug 证书签名，摘要不在正式白名单里；本地要能跑通，就把 debug 摘要也包一份。
 * `MINICRAFT_RELEASE=1`（正式发布）时**不**加入——否则等于给拿到我们 debug keystore 的人留了钥匙。
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

function readSigners(): string[] {
  const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as ReleaseConfig;
  const list = Array.isArray(raw.signingCertSha256) ? raw.signingCertSha256 : [];
  const configured = list
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/:/g, '').trim().toLowerCase())
    .filter((v) => /^[0-9a-f]{64}$/.test(v));

  const signers = [...new Set(configured)];
  if (process.env.MINICRAFT_RELEASE !== '1') {
    const debug = debugKeystoreDigest();
    if (debug !== null && !signers.includes(debug)) signers.push(debug);
  }
  if (signers.length === 0) {
    throw new Error(
      '没有可用的签名摘要：填 release.config.json 的 signingCertSha256（Play 应用签名证书），\n' +
        '或先构建一次 debug 包以生成 ~/.android/debug.keystore',
    );
  }
  return signers;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

function hkdf(salt: Buffer, ikm: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, INFO, 32));
}

/** 内层容器：索引 + 数据区。整体会被 gzip 再加密，所以这里不做压缩。 */
function buildContainer(files: string[]): { container: Buffer; plainBytes: number } {
  const count = Buffer.alloc(2);
  count.writeUInt16LE(files.length, 0);

  const indexParts: Buffer[] = [Buffer.from('MCB1', 'ascii'), count];
  const dataParts: Buffer[] = [];
  let cursor = 0;
  let plainBytes = 0;

  for (const path of files) {
    const plain = readFileSync(join(DIST, path));
    plainBytes += plain.length;
    const pathBytes = Buffer.from(path, 'utf8');
    // 索引顺序必须与读取端一致：pathLen → path → offset → length
    const pathLen = Buffer.alloc(2);
    pathLen.writeUInt16LE(pathBytes.length, 0);
    const offset = Buffer.alloc(4);
    offset.writeUInt32LE(cursor, 0);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(plain.length, 0);
    indexParts.push(pathLen, pathBytes, offset, length);
    dataParts.push(plain);
    cursor += plain.length;
  }

  return { container: Buffer.concat([...indexParts, ...dataParts]), plainBytes };
}

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`缺少 ${DIST}/index.html：先跑 npm run build:web`);
  }
  const signers = readSigners();
  const files = collectFiles(DIST);
  const { container, plainBytes } = buildContainer(files);

  const compressed = gzipSync(container, { level: 9 });

  const salt = randomBytes(32);
  const fileNonce = randomBytes(NONCE_LEN);
  const cek = randomBytes(32);

  // 头部（不含假 ELF 的 8 字节）
  const head = Buffer.alloc(4);
  head.writeUInt8(VERSION, 0);
  head.writeUInt8(CODEC_GZIP, 1);
  head.writeUInt8(signers.length, 2);
  head.writeUInt8(0, 3);
  const wrapAad = Buffer.concat([head, salt, fileNonce]);

  const wraps: Buffer[] = [];
  for (const signer of signers) {
    const kek = hkdf(salt, Buffer.concat([Buffer.from(signer, 'hex'), salt]));
    const cipher = createCipheriv('aes-256-gcm', kek, fileNonce);
    cipher.setAAD(wrapAad);
    const sealed = Buffer.concat([cipher.update(cek), cipher.final(), cipher.getAuthTag()]);
    const len = Buffer.alloc(2);
    len.writeUInt16LE(sealed.length, 0);
    wraps.push(Buffer.concat([len, sealed]));
  }
  const wrapBlock = Buffer.concat(wraps);

  // 整段密文：AAD 绑住"它前面的一切"，改头、改包裹都会让解密失败
  const payloadAad = Buffer.concat([head, salt, fileNonce, wrapBlock]);
  const bodyCipher = createCipheriv('aes-256-gcm', cek, fileNonce);
  bodyCipher.setAAD(payloadAad);
  const body = Buffer.concat([bodyCipher.update(compressed), bodyCipher.final(), bodyCipher.getAuthTag()]);
  const bodyLen = Buffer.alloc(4);
  bodyLen.writeUInt32LE(body.length, 0);

  const pkg = Buffer.concat([FAKE_ELF, head, salt, fileNonce, wrapBlock, bodyLen, body]);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PKG, pkg);
  // 仅构建侧：测试与三端壳需要知道"用哪个摘要去开"。摘要本身公开，但它不属于包内容。
  writeFileSync(join(OUT_DIR, 'signers.json'), `${JSON.stringify({ signers }, null, 2)}\n`);

  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
  console.log('\n整包加密（单段密文）');
  console.log(`  文件数      ${files.length}`);
  console.log(`  明文        ${kb(plainBytes)}`);
  console.log(`  gzip 后     ${kb(compressed.length)}（压掉 ${(100 - (compressed.length / plainBytes) * 100).toFixed(1)}%）`);
  console.log(`  成品        ${kb(pkg.length)}  ${OUT_PKG}`);
  console.log(`  签名包裹    ${signers.length} 份`);
  for (const [i, s] of signers.entries()) console.log(`    [${i}] ${s.slice(0, 16)}…`);
  console.log(`  产物摘要    ${createHash('sha256').update(pkg).digest('hex').slice(0, 16)}…`);
}

main();

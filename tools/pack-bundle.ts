/**
 * 整包加密（A35）：把 `web/dist` 打成一个 `game.pkg`，壳里解密后喂给 WebView。
 *
 * ## 为什么不再只加密方块表
 *
 * 发版只有 APP 一种形态，网页构建只用于自测。既然如此，"把数据藏起来、其余 JS 明文放
 * assets"就没有意义了——攻击者 `unzip` 之后拿到的是完整的游戏逻辑。整包加密之后，
 * 包里只剩密文，连"这是什么游戏"都要先解出来。
 *
 * ## 包格式（小端）
 *
 *   "MCPK" | u8 version=1 | u8 wrapCount | u16 reserved
 *   salt 32B | fileNonce 12B
 *   wrapCount × (u16 len + 包住 CEK 的密文)
 *   u16 entryCount
 *   entryCount × (u16 pathLen, path, u32 offset, u32 length, 12B nonce)
 *   数据区：逐文件密文首尾相接
 *
 * ## 密钥
 *
 *   KEK_i = HKDF-SHA256(salt, 摘要_i ‖ salt, info="minicraft/bundle/v1")
 *   CEK   = 随机 32B，被每个 KEK_i 各包一份（每个允许的签名一份）
 *   文件  = AES-256-GCM(CEK, 该文件自己的 nonce, aad = path ‖ 索引)
 *
 * ⚠️ 与方块表那套一样：证书摘要是**公开信息**。这里挡住的是"改包重签后跑起来"，
 * 以及"解包后把 JS 搬去别的站点"；不是"别人永远拿不到内容"。
 */

import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web/dist');
const CONFIG = join(ROOT, 'release.config.json');
const OUT_DIR = join(ROOT, 'build/pkg');
const OUT_PKG = join(OUT_DIR, 'game.pkg');

const MAGIC = Buffer.from('MCPK', 'ascii');
const VERSION = 1;
const INFO = Buffer.from('minicraft/bundle/v1', 'utf8');
const SALT_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

interface ReleaseConfig {
  signingCertSha256?: unknown;
  saltHex?: unknown;
}

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

/** 收集 `web/dist` 下的所有文件，路径用 `/` 分隔并排序（保证可复现） */
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

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`缺少 ${DIST}/index.html：先跑 npm run build:web`);
  }
  const signers = readSigners();
  const files = collectFiles(DIST);

  const salt = randomBytes(SALT_LEN);
  const fileNonce = randomBytes(NONCE_LEN);
  const cek = randomBytes(32);

  // ---- 头 + 盐 + 包 CEK 用的 nonce
  const head = Buffer.alloc(8);
  MAGIC.copy(head, 0);
  head.writeUInt8(VERSION, 4);
  head.writeUInt8(signers.length, 5);
  head.writeUInt16LE(0, 6);
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

  // ---- 逐文件加密（先算索引，再拼数据区）
  interface Entry {
    path: string;
    nonce: Buffer;
    data: Buffer;
    offset: number;
  }
  const entries: Entry[] = files.map((path) => {
    const plain = readFileSync(join(DIST, path));
    const nonce = randomBytes(NONCE_LEN);
    const aad = Buffer.concat([Buffer.from(path, 'utf8'), Buffer.from([0])]);
    const cipher = createCipheriv('aes-256-gcm', cek, nonce);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    return { path, nonce, data, offset: 0 };
  });

  const countBuf = Buffer.alloc(2);
  countBuf.writeUInt16LE(entries.length, 0);
  const indexParts: Buffer[] = [countBuf];
  let cursor = 0;
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, 'utf8');
    const pathLen = Buffer.alloc(2);
    pathLen.writeUInt16LE(pathBytes.length, 0);
    const offset = Buffer.alloc(4);
    offset.writeUInt32LE(cursor, 0);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(entry.data.length, 0);
    indexParts.push(pathLen, pathBytes, offset, length, entry.nonce);
    entry.offset = cursor;
    cursor += entry.data.length;
  }

  const pkg = Buffer.concat([
    head,
    salt,
    fileNonce,
    ...wraps,
    ...indexParts,
    ...entries.map((e) => e.data),
  ]);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PKG, pkg);
  // 仅构建侧产物：测试与诊断要知道"这份包是哪几个签名能开"。
  // 摘要本身是公开信息，但它**不进包**（壳不需要，也不该给）。
  writeFileSync(join(OUT_DIR, 'signers.json'), `${JSON.stringify({ signers }, null, 2)}\n`);

  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
  const plainTotal = entries.reduce((sum, e) => sum + e.data.length - TAG_LEN, 0);
  console.log('\n整包加密');
  console.log(`  文件数      ${entries.length}`);
  console.log(`  明文        ${kb(plainTotal)}`);
  console.log(`  包           ${kb(pkg.length)}（+${kb(pkg.length - plainTotal)}）`);
  console.log(`  签名包裹    ${signers.length} 份`);
  for (const [i, s] of signers.entries()) console.log(`    [${i}] ${s.slice(0, 16)}…`);
  console.log(`  产物        ${OUT_PKG}`);
  console.log(`  明文摘要    ${createHash('sha256').update(pkg).digest('hex').slice(0, 16)}…`);
}

main();

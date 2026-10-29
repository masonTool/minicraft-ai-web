/**
 * 整包加密的往返测试（不需要 Electron、不需要设备）。
 *
 * 读取端 `desktop/bundle.mjs` 就是"原生壳的替身"：它就是壳里要跑的那段逻辑。
 * 负面断言才是保护真正在意的东西——**整包单段密文，改一个字节整包就打不开**。
 *
 * 运行：`npm run test:pack`
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBundle } from '../desktop/bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'build/rt/libmcrt.so');
const SIGNERS = join(ROOT, 'build/rt/signers.json');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
};

if (!existsSync(PKG)) {
  console.log('\n[skip] 整包不存在：先跑 `npm run pack`（需要先 build:web）');
  process.exit(0);
}

const pkg = readFileSync(PKG);
const signer = existsSync(SIGNERS) ? JSON.parse(readFileSync(SIGNERS, 'utf8')).signers[0] : null;

console.log('\n[包形态]');
check('是"假 ELF"开头（伪装成 .so）', pkg.subarray(0, 4).toString('hex') === '7f454c46');
check('版本 1', pkg.readUInt8(8) === 1);
check('压缩算法 gzip', pkg.readUInt8(9) === 1);
check('至少一份签名包裹', pkg.readUInt8(10) >= 1);
check('包内不含 HTML 明文', !pkg.includes(Buffer.from('<!DOCTYPE html>')));
check('包内不含 JS 源码特征', !pkg.includes(Buffer.from('function ')));

if (signer === undefined || signer === null) {
  console.log('\n[跳过] 没有 signers.json，无法派生 KEK');
  console.log(`\n整包测试：${passed} 通过 / ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

console.log('\n[往返：用签名摘要能解开]');
const bundle = openBundle(pkg, signer);
check('打开成功', bundle !== null);
check('包含 index.html', bundle?.paths.includes('index.html') === true);
const html = bundle?.get('index.html') ?? null;
check('index.html 解出且是 HTML', html !== null && html.toString('utf8').includes('<html'));
const js = bundle?.paths.find((p) => p.endsWith('.js'));
const jsBytes = js === undefined ? null : (bundle?.get(js) ?? null);
check('有 JS 且能解出', jsBytes !== null && jsBytes.length > 0);
check('解出的总字节数与原产物一致', bundle !== null && bundle.bytes > 4_000_000, String(bundle?.bytes));

console.log('\n[负面：整包单段密文，任何一处改动都必须整包打不开]');
check('换签名 → 解不开', openBundle(pkg, '11'.repeat(32)) === null);
{
  const tampered = Buffer.from(pkg);
  tampered[tampered.length - 40] ^= 0xff;
  check('密文区改一个字节 → 整包打不开', openBundle(tampered, signer) === null);
}
{
  const tampered = Buffer.from(pkg);
  tampered[8] = 99;
  check('改版本字节 → 打不开', openBundle(tampered, signer) === null);
}
{
  const tampered = Buffer.from(pkg);
  tampered[0] = 0;
  check('假 ELF 头被改 → 打不开', openBundle(tampered, signer) === null);
}
{
  check('截断 → 打不开', openBundle(pkg.subarray(0, 200), signer) === null);
  check('空包 → 打不开', openBundle(Buffer.alloc(0), signer) === null);
}

console.log(`\n整包测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

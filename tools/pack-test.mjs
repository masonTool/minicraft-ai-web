/**
 * 整包加密的往返测试（不需要 Electron，也不需要设备）。
 *
 * 与 `tools/sealed-test.ts` 同一思路：把读取端（`desktop/bundle.mjs`）当作"原生壳的替身"，
 * 用真实 `game.pkg` 验证格式与密码学；负面断言才是保护真正在意的东西。
 *
 * 运行：`npm run test:pack`
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBundle } from '../desktop/bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'build/pkg/game.pkg');
const CONFIG = join(ROOT, 'release.config.json');

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
const signersFile = join(ROOT, 'build/pkg/signers.json');
const fromBuild = existsSync(signersFile) ? JSON.parse(readFileSync(signersFile, 'utf8')).signers : null;
const configured = JSON.parse(readFileSync(CONFIG, 'utf8')).signingCertSha256 ?? [];
const signer = Array.isArray(fromBuild) && fromBuild.length > 0
  ? String(fromBuild[0])
  : (Array.isArray(configured) && configured.length > 0 ? String(configured[0]).replace(/:/g, '') : null);

console.log('\n[包形态]');
check('魔数 MCPK', pkg.subarray(0, 4).toString('ascii') === 'MCPK');
check('版本 1', pkg.readUInt8(4) === 1);
check('至少一份签名包裹', pkg.readUInt8(5) >= 1);
check('包内不含 HTML 明文', !pkg.includes(Buffer.from('<!DOCTYPE html>')));

if (signer === null) {
  console.log('\n[跳过往返] release.config.json 没有配签名摘要，无法派生 KEK');
  console.log(`\n整包测试：${passed} 通过 / ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

console.log('\n[往返：用签名摘要能解开]');
const bundle = openBundle(pkg, signer);
check('打开成功', bundle !== null);
check('包含 index.html', bundle?.paths.includes('index.html') === true);
const html = bundle?.get('index.html') ?? null;
check('index.html 能解出', html !== null);
check('index.html 是 HTML', html !== null && html.toString('utf8').includes('<html'));
const js = bundle?.paths.find((p) => p.endsWith('.js'));
const jsBytes = js === undefined ? null : bundle?.get(js);
check('有 JS 且能解出', jsBytes !== null && jsBytes.length > 0);
// 数据区按索引顺序首尾相接，所以"最后一个条目"的密文一定落在包尾
const lastPath = bundle === null ? undefined : bundle.paths[bundle.paths.length - 1];

console.log('\n[负面：任何一处改动都必须解不开]');
check('换签名 → 解不开', openBundle(pkg, '11'.repeat(32)) === null);
{
  const tampered = Buffer.from(pkg);
  tampered[tampered.length - 30] ^= 0xff;
  const b = openBundle(tampered, signer);
  const got = b === null ? null : (b.get(lastPath) ?? null);
  check('数据区改一个字节 → 那个文件解不开', got === null);
  // 其它文件不该受影响：逐文件鉴权的好处就是"坏一个不牵连整包"
  const other = b === null ? null : (b.get(js) ?? null);
  check('同包内其它文件仍可解出', other !== null);
}
{
  const tampered = Buffer.from(pkg);
  tampered[0] = 0;
  check('魔数被改 → 打不开', openBundle(tampered, signer) === null);
}
{
  check('截断 → 打不开', openBundle(pkg.subarray(0, 80), signer) === null);
  check('空包 → 打不开', openBundle(Buffer.alloc(0), signer) === null);
}

console.log(`\n整包测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

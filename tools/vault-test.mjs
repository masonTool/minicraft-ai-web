/**
 * `native/vault` 的解密实现与打包端是否一致（不需要设备）。
 *
 * 为什么必须有这一份：`native/vault` 是"壳里真正跑的那段逻辑"的第三份实现
 * （前两份是 `desktop/bundle.mjs` 与 `BundleVault.java`）。三份实现漂移的后果是
 * "手机上白屏、电脑上正常"，而那要装机 + logcat 才能定位。这里用 host 编译的
 * `vault-cli` 解一遍真实的 `build/rt/libmcrt.so`，逐文件与 `web/dist` 比对。
 *
 * 三层断言：
 *   ① 密码学标准向量（AES-GCM / SHA-256 / HMAC / HKDF）——自实现密码学的地基
 *   ② 与 `desktop/bundle.mjs` 的元信息一致（文件数、容器字节数）
 *   ③ 逐文件字节一致；以及"改一字节就整包打不开"的负面用例
 *
 * 环境不全时（没有 clang / zlib / 没打过包）**优雅跳过并说明原因**，不红。
 * 这样它能进 CI，而不会因为 runner 缺 zlib 把主分支打红。
 *
 * 运行：`npm run test:vault`
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE = join(ROOT, 'native/vault');
const CLI = join(NATIVE, 'build/host/vault-cli');
const SELFTEST = join(NATIVE, 'build/host/vault-selftest');
const PKG = join(ROOT, 'build/rt/libmcrt.so');
const SIGNERS = join(ROOT, 'build/rt/signers.json');
const DIST = join(ROOT, 'web/dist');

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

const skip = (reason) => {
  console.log(`\n[skip] ${reason}`);
  console.log('（这不是失败：说明本机缺编译环境或还没打包）');
  process.exit(0);
};

// ---------------------------------------------------------------- 0. 编译

console.log('\n[编译 host 版]');
try {
  execFileSync('bash', [join(NATIVE, 'build-host.sh')], { stdio: 'pipe', encoding: 'utf8' });
  check('build-host.sh 编译通过', existsSync(CLI) && existsSync(SELFTEST));
} catch (error) {
  skip(`编译失败（缺 clang 或 zlib？）：${String(error.stderr ?? error.message).split('\n')[0]}`);
}

// ---------------------------------------------------------------- 1. 标准向量

console.log('\n[密码学标准向量]');
try {
  const out = execFileSync(SELFTEST, [], { encoding: 'utf8' });
  const match = /自测：(\d+) 通过 \/ (\d+) 失败/.exec(out);
  check('vault-selftest 全绿', match !== null && match[2] === '0', out.trim().split('\n').pop());
} catch (error) {
  check('vault-selftest 全绿', false, '退出码非 0');
}

// ---------------------------------------------------------------- 2. 真实包

if (!existsSync(PKG) || !existsSync(SIGNERS)) {
  skip('没有 build/rt/libmcrt.so 或 signers.json：先跑 `npm run build:web && npm run pack`');
}

const pkg = readFileSync(PKG);
const signer = JSON.parse(readFileSync(SIGNERS, 'utf8')).signers[0];
if (typeof signer !== 'string') skip('signers.json 里没有可用的签名摘要');

const run = (args) =>
  execFileSync(CLI, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

console.log('\n[与 desktop/bundle.mjs 的元信息对齐]');
{
  const [status, files, bytes] = run(['info', PKG, signer]).split(' ');

  // 参考实现：desktop/bundle.mjs 就是桌面壳跑的那段逻辑
  const { openBundle } = await import('../desktop/bundle.mjs');
  const reference = openBundle(pkg, signer);

  check('native 打开成功', status === 'ok', `输出 ${status}`);
  check('参考实现打开成功', reference !== null);
  if (reference !== null) {
    check('文件数一致', Number(files) === reference.paths.length, `${files} vs ${reference.paths.length}`);
    check('容器字节数一致', Number(bytes) === reference.bytes, `${bytes} vs ${reference.bytes}`);
  }
}

console.log('\n[多份签名包裹：每一份都能开同一个包]');
{
  // 这条不是"顺带测一下"：开发机与真机装的是 **debug 签名**，而正式证书排在
  // signers[0]。如果实现只尝试第一份包裹，debug 包会在真机上白屏——而这只能
  // 装机才发现。所以在 host 上就把"逐份尝试"钉死。
  const signers = JSON.parse(readFileSync(SIGNERS, 'utf8')).signers;
  check('至少两份签名包裹', signers.length >= 2, `实际 ${signers.length} 份`);
  for (const [i, s] of signers.entries()) {
    let ok = false;
    try {
      ok = run(['info', PKG, s]).startsWith('ok ');
    } catch {
      ok = false;
    }
    check(`第 ${i + 1} 份（${String(s).slice(0, 8)}…）能打开`, ok);
  }
}

console.log('\n[逐文件字节一致]');
{
  const outDir = mkdtempSync(join(tmpdir(), 'vault-unpack-'));
  try {
    const unpacked = run(['unpack', PKG, signer, outDir]);
    check('解包成功', unpacked.startsWith('ok '), unpacked);

    // ⚠️ 基准目录必须是 root：递归时若用子目录做 relative 的基准，
    // `assets/x.js` 会退化成 `x.js`，两边都退化 → 清单断言假通过、内容比对假失败。
    const walk = (root) => {
      const out = [];
      const visit = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) visit(full);
          else out.push(relative(root, full).split(sep).join('/'));
        }
      };
      visit(root);
      return out.sort();
    };

    const expected = walk(DIST);
    const actual = walk(outDir);
    check('文件清单与 web/dist 一致', JSON.stringify(expected) === JSON.stringify(actual),
      `dist=${expected.length} 解出=${actual.length}（包可能过期，先 npm run pack）`);

    const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const mismatched = expected.filter((path) => {
      const a = join(DIST, path);
      const b = join(outDir, path);
      return !existsSync(b) || digest(a) !== digest(b);
    });
    check(`每个文件内容一致（${expected.length} 个）`, mismatched.length === 0,
      mismatched.slice(0, 3).join(', '));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 3. 负面

console.log('\n[负面：整包单段密文，任何一处改动都必须整包打不开]');
{
  const scratch = mkdtempSync(join(tmpdir(), 'vault-negative-'));
  const tryOpen = (bytes) => {
    const path = join(scratch, 'case.bin');
    writeFileSync(path, bytes);
    try {
      execFileSync(CLI, ['info', path, signer], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };

  try {
    check('换签名 → 打不开', (() => {
      const path = join(scratch, 'wrong-signer.bin');
      writeFileSync(path, pkg);
      try {
        execFileSync(CLI, ['info', path, '11'.repeat(32)], { stdio: 'pipe' });
        return false;
      } catch {
        return true;
      }
    })());

    const tamperedBody = Buffer.from(pkg);
    tamperedBody[tamperedBody.length - 40] ^= 0xff;
    check('密文区改一个字节 → 打不开', !tryOpen(tamperedBody));

    const tamperedVersion = Buffer.from(pkg);
    tamperedVersion[8] = 99;
    check('改版本字节 → 打不开', !tryOpen(tamperedVersion));

    const tamperedElf = Buffer.from(pkg);
    tamperedElf[0] = 0;
    check('假 ELF 头被改 → 打不开', !tryOpen(tamperedElf));

    check('截断 → 打不开', !tryOpen(pkg.subarray(0, 200)));
    check('空包 → 打不开', !tryOpen(Buffer.alloc(0)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`\n整包 native 测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

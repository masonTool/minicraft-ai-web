/**
 * 桌面端解封的离线测试（不需要 Electron，也不需要窗口）。
 *
 * `desktop/core-vault.mjs` 刻意不 import electron，就是为了能被这一套直接跑：
 * 真实产物 + 真实 Node 密码学，验证"格式对不对"和"身份判据四象限"。
 *
 * 运行：`npm run test:desktop`
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unsealCore, verifyIdentity } from '../desktop/core-vault.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'desktop/resources/sealed');
const TMP = join(ROOT, '.tmp/desktop-identity');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

/**
 * 封存产物是 **gitignore 的构建输出**：全新检出 / CI 上不存在。
 * 缺它就跳过（而不是崩），与项目里"没浏览器就跳过浏览器门禁"同一口径；
 * 但要明确说"跳过"，不能伪装成通过。
 */
if (!existsSync(join(DIR, 'core.sealed'))) {
  console.log('\n[skip] 桌面端封存产物不存在：先跑 `npm run gen:sealed`');
  process.exit(0);
}

const plain = readFileSync(join(ROOT, 'host/core-baseline.bin'));
const dev = { dir: DIR, packaged: false };

console.log('\n[开发态：未打包必须能解封]');
const data = unsealCore(dev);
check('解封成功', data !== null);
check('长度一致', data !== null && data.length === plain.length);
check('内容逐字节一致', data !== null && data.equals(plain));
check('是合法方块表（MCTB）', data !== null && data.subarray(0, 4).toString('ascii') === 'MCTB');
check('身份判据在开发态放行', verifyIdentity(dev) === true);

console.log('\n[打包态：四象限]');
// 本机没有正式签名，codesign 取不到 TeamIdentifier → actual = null
const unsigned = { dir: DIR, packaged: true };
check('未配置 + 未签名 → 放行（无证书的本地构建要能开）', verifyIdentity(unsigned) === true);
check('未配置 + 未签名 → 能解封', unsealCore(unsigned) !== null);

// 造一份"配置了 Team ID"的目录：期望有值、实际未签名 → 必须拒绝
mkdirSync(TMP, { recursive: true });
for (const name of ['core.sealed', 'salt.bin', 'signers.txt', 'bundle.txt']) {
  copyFileSync(join(DIR, name), join(TMP, name));
}
writeFileSync(join(TMP, 'team.txt'), 'TESTTEAM123\n');
const configured = { dir: TMP, packaged: true };
check('配置了 Team ID + 未签名 → 拒绝', verifyIdentity(configured) === false);
check('配置了 Team ID + 未签名 → 解不开', unsealCore(configured) === null);

console.log('\n[负面：产物缺失或损坏都必须解不开]');
check('目录不存在 → 解不开', unsealCore({ dir: join(ROOT, '.tmp/does-not-exist'), packaged: false }) === null);

const broken = join(ROOT, '.tmp/desktop-broken');
mkdirSync(broken, { recursive: true });
writeFileSync(join(broken, 'core.sealed'), Buffer.alloc(64));
copyFileSync(join(DIR, 'salt.bin'), join(broken, 'salt.bin'));
copyFileSync(join(DIR, 'signers.txt'), join(broken, 'signers.txt'));
check('封存体是垃圾数据 → 解不开', unsealCore({ dir: broken, packaged: false }) === null);

console.log(`\n桌面端解封测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

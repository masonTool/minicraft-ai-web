/**
 * 版本契约（批次 20261025-0329 · 宿主5）
 *
 * 钉住"宿主太老要提示更新、浏览器不该被误判成太老"这条判定。
 *
 * 为什么值得单独一套测试：这条判定错一次的后果是**白屏**或**误导提示**，而两种都不会
 * 在开发机上出现（开发机永远是最新代码 + 最新 core.bin）。三种组合必须都能静态验：
 *   ① 匹配（宿主自报 core/1，站点要求 1）→ 放行，进游戏
 *   ② 落后（自报 core/0，站点要求 1）→ 提示"请更新应用"
 *   ③ 浏览器（UA 里没有宿主标记）→ **不能**提示更新，要走正常流程（最终看到安装引导）
 *
 * 运行：npm run test:hostversion
 */

import { evaluateHostVersion, readHostCoreVersion } from '../web/src/core/hostCore.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 宿主在 UA 末尾拼的标记（与 README / 安卓壳的约定一致） */
const HOST_UA = (core: number): string =>
  `Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 MinicraftHost/1.0 core/${core}`;

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

console.log('\n[一、从 UA 读版本]');
{
  equal('宿主 UA：读到 core/1', readHostCoreVersion(HOST_UA(1)), 1);
  equal('宿主 UA：读到 core/12', readHostCoreVersion(HOST_UA(12)), 12);
  equal('浏览器 UA：读不到（null）', readHostCoreVersion(BROWSER_UA), null);
  equal('空 UA：null', readHostCoreVersion(''), null);
  equal(
    '只有 core/N 没有宿主标记 → null（不能把巧合数字当版本）',
    readHostCoreVersion('Mozilla/5.0 (Windows NT 10.0) core/9'),
    null,
  );
  equal(
    '宿主标记但版本非数字 → null',
    readHostCoreVersion('Mozilla/5.0 MinicraftHost/1.0 core/abc'),
    null,
  );
  equal(
    '标记顺序无关，只要同时出现就能读（大小写不敏感）',
    readHostCoreVersion('minicrafthost/2.1 core/3'),
    3,
  );
}

console.log('\n[二、三种组合的判定]');
{
  // ① 匹配
  equal('匹配：core/1 vs 要求 1 → ok', evaluateHostVersion(readHostCoreVersion(HOST_UA(1)), 1), 'ok');
  equal('更高也算 ok：core/2 vs 要求 1 → ok', evaluateHostVersion(readHostCoreVersion(HOST_UA(2)), 1), 'ok');
  // ② 落后
  equal('落后：core/0 vs 要求 1 → outdated', evaluateHostVersion(readHostCoreVersion(HOST_UA(0)), 1), 'outdated');
  equal('落后：core/1 vs 要求 2 → outdated', evaluateHostVersion(readHostCoreVersion(HOST_UA(1)), 2), 'outdated');
  // ③ 浏览器
  equal(
    '浏览器：读不到版本 → unknown（继续走正常流程，最终看到安装引导）',
    evaluateHostVersion(readHostCoreVersion(BROWSER_UA), 1),
    'unknown',
  );
  equal(
    'unknown 不等于 outdated：要求再高也不能对浏览器提示"请更新应用"',
    evaluateHostVersion(null, 99) === 'outdated',
    false,
  );
}

console.log('\n[三、边界]');
{
  equal('要求 0 时任何宿主都 ok', evaluateHostVersion(0, 0), 'ok');
  equal('不存在的版本号（负数）不进 UA 判定', readHostCoreVersion('MinicraftHost/1.0 core/-1'), null);
  equal('超大版本号照读（不做上限假设）', readHostCoreVersion(HOST_UA(999)), 999);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);

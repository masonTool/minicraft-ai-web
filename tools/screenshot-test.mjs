#!/usr/bin/env node
/**
 * 截图脚本的自检（Q8）。
 *
 * 只测**契约**，不测"截出来的图好不好看"（那要靠人看）：
 *   ① 没有浏览器时必须 exit 0 —— 环境缺东西不能让门禁变红；
 *   ② 参数解析与默认值正确；
 *   ③ 脚本不把浏览器当成硬依赖（`playwright-core` 是 devDependency，
 *      且真正用到时才 import —— 没浏览器时连模块都不加载）。
 *
 * 为什么这几条值得测：`tools/screenshot.ts` 以后会被 Q9/Q10 挂在门禁上。
 * 一旦它"没浏览器就 exit 1"，CI 里没有 Chrome 的机器会全红，
 * 而那种红**指向的是环境、不是代码**，最容易被养成"习惯性重跑"。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

console.log('截图脚本自检');

// ---------------------------------------------------------------- 没有浏览器 → 必须放行
{
  let code = 0;
  let out = '';
  try {
    out = execFileSync('node', [join(projectRoot, 'tools', 'screenshot.mjs')], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, SHOT_FORCE_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    code = error.status ?? 1;
    out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  check('没有浏览器时退出码是 0（环境问题不该让门禁变红）', code === 0, `实际 ${code}`);
  check('说明为什么跳过，并告诉怎么修', /\[skip\]/.test(out) && /CHROME_PATH/.test(out), out.slice(0, 120));
  check('明确写了"退出码仍然是 0"', /退出码仍然是 0/.test(out));
}

// ---------------------------------------------------------------- 依赖与加载时机
{
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  check('playwright-core 是 devDependency（不进运行时产物）', Boolean(pkg.devDependencies?.['playwright-core']));
  check('没有引入 playwright（那个会下载 300MB 浏览器）', !pkg.devDependencies?.playwright && !pkg.dependencies?.playwright);
  check('有 npm run shot', typeof pkg.scripts?.shot === 'string');

  const src = readFileSync(join(projectRoot, 'tools', 'screenshot.mjs'), 'utf8');
  // ⚠️ Q9 把浏览器查找抽到了 `tools/browser.mjs`（三个调用方共用一份），
  // 所以"怎么找浏览器"这几条要查那边；这里只查"截图脚本有没有复用共用模块"。
  const browser = readFileSync(join(projectRoot, 'tools', 'browser.mjs'), 'utf8');
  check(
    'playwright-core 是"确定要跑才 import"（没浏览器时不加载）',
    /await import\('playwright-core'\)/.test(browser) && !/^import .*playwright-core/m.test(browser),
  );
  check('截图脚本复用共用的浏览器模块', src.includes("from './browser.mjs'"));
  check('优先用 CHROME_PATH', browser.includes('process.env.CHROME_PATH'));
  check('三个平台都有候选路径', /darwin/.test(browser) && /win32/.test(browser) && /google-chrome/.test(browser));
  check('截图落到 .tmp（不进仓库）', src.includes(".tmp', 'shots'"));
  check('参数支持 --url/--out/--wait/--full', ['--url', '--out', '--wait', '--full'].every((k) => src.includes(k)));
  check('收集 console.error（给 Q9 铺路）', /type\(\) === 'error'/.test(browser));
  check('收集 pageerror', browser.includes("page.on('pageerror'"));
}

console.log(`\n截图脚本测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

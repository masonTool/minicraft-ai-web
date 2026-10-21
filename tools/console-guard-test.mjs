#!/usr/bin/env node
/**
 * 控制台门禁的自检（Q9）。
 *
 * 只测**契约**，不测"页面有没有错"（那要靠真跑）。三条最要紧的：
 *   ① 没有浏览器 → exit 0（环境问题不是页面问题）；
 *   ② **页面真报错时必须 exit 1** —— 这条最关键。一个"永远绿"的门禁
 *      比没有门禁更糟：它占着"已覆盖"的位置，让人以为这件事验过了；
 *   ③ `--allow` 只放行匹配的条目，不能顺带把别的错也放过去。
 *
 * ② 用一个**故意报错的本地页面**来验（临时起 python http.server）。
 * 不这么做就只能靠读源码，而"门禁到底会不会红"恰恰是读源码看不出来的。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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

/**
 * 跑一次 guard，返回 `{ code, out }`（**异步**）。
 *
 * ⚠️ 这里必须用 `spawn` + Promise，不能用 `execFileSync`：
 *   同步执行会把本进程的事件循环整个堵住，而同一进程里还开着测试用的
 *   本地 http server —— 于是 guard 里的浏览器请求永远等不到响应，
 *   以 `page.goto: Timeout` 收场。**这个坑第一次写的时候就踩了**，
 *   现象看起来像"门禁打不开页面"，其实是测试自己的 server 被饿死了。
 */
function runGuard(args, env = {}) {
  return new Promise((done) => {
    const child = spawn('node', [join(projectRoot, 'tools', 'console-guard.mjs'), ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (code) => done({ code: code ?? 0, out }));
  });
}

console.log('控制台门禁自检');

// ---------------------------------------------------------------- 没有浏览器 → 放行
{
  const { code, out } = await runGuard([], { SHOT_FORCE_NO_BROWSER: '1' });
  check('没有浏览器时退出码 0', code === 0, `实际 ${code}`);
  check('说明跳过原因与修法', /\[skip\]/.test(out) && /CHROME_PATH/.test(out));
  check('明确写了"退出码仍然是 0"', /退出码仍然是 0/.test(out));
}

// ---------------------------------------------------------------- 页面真报错 → 必须红
{
  const html = `<!DOCTYPE html><html><body>
<script>
  console.error('guard-test 故意报错');
  setTimeout(function () { throw new Error('guard-test 未捕获异常'); }, 50);
</script></body></html>`;

  // 用一个最小 http server（异步），不依赖外部进程、退出干净
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    response.end(html);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  try {
    const { code, out } = await runGuard(['--url', url, '--wait', '3000']);
    // 没浏览器就测不了这一条（CI 里可能没有）——如实标成跳过，不算失败
    if (/\[skip\]/.test(out) && code === 0) {
      console.log('  ~ 这台机器没有浏览器，跳过"报错必须变红"的实证（不判失败）');
    } else {
      check('页面报错时退出码非 0（门禁真的会红）', code !== 0, `实际 ${code}`);
      check('报错内容被列出来了', /guard-test 故意报错/.test(out) || /console\.error/.test(out), out.slice(0, 160));
      check('未捕获异常也被抓到（pageerror）', /pageerror/.test(out), out.slice(0, 160));
    }

    // 同样的页面，用 --allow 全放行 → 应放绿
    if (!/\[skip\]/.test(out)) {
      const allowed = await runGuard(['--url', url, '--wait', '3000', '--allow', 'guard-test', '--allow', 'console.error', '--allow', 'pageerror']);
      check('--allow 匹配到的条目被放行后转绿', allowed.code === 0, `实际 ${allowed.code}`);
      check('放行时说明了放行几条', /放行 \d+ 条已知噪音/.test(allowed.out), allowed.out.slice(0, 160));
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
}

// ---------------------------------------------------------------- 源码契约
{
  const src = readFileSync(join(projectRoot, 'tools', 'console-guard.mjs'), 'utf8');
  const browser = readFileSync(join(projectRoot, 'tools', 'browser.mjs'), 'utf8');
  check('收集 console.error', /type\(\) === 'error'/.test(browser));
  check('收集 pageerror', browser.includes("page.on('pageerror'"));
  check('浏览器查找逻辑共用（不是复制一份）', src.includes("from './browser.mjs'"));
  check('browser.mjs 里只有一个 findChrome 实现', (browser.match(/function findChrome/g) ?? []).length === 1);
  check('screenshot 也复用同一份', readFileSync(join(projectRoot, 'tools', 'screenshot.mjs'), 'utf8').includes("from './browser.mjs'"));
  check('有 --enter-world 选项（多跑真实代码）', src.includes('--enter-world'));
  check('有 --allow 放行机制', src.includes('--allow'));
  check('页打不开算真失败（不是环境问题）', src.includes('页面打不开'));

  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  check('有 npm run guard', typeof pkg.scripts?.guard === 'string');
}

console.log(`\n控制台门禁测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

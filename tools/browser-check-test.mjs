#!/usr/bin/env node
/**
 * `check:browser` 的自检（Q10）。
 *
 * 测的是**开关契约**，不测"页面有没有错"（那是 guard 的事）：
 *   ① 默认不跑 → exit 0 且耗时极短（不能拖慢 `npm run check`）；
 *   ② `BROWSER_CHECK=1` 才会真的去起服务；
 *   ③ **端口被占时必须失败**，不能连上去测别人的服务。
 *
 * ③ 是这一批实测撞出来的真 bug：Vite 绑 IPv6 `[::1]`，别的进程（nginx、
 * 上一次跑剩的 vite）绑 IPv4 `127.0.0.1`，两个地址不冲突，于是 `--strictPort`
 * 认为端口可用照常启动——guard 连上的其实是旧实例，报"通过"。**假绿比报错危险**。
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

/** 异步跑一次（不能用 execFileSync：会堵住本进程里正在监听的 server） */
function run(args, env = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn('node', [join(projectRoot, 'tools', 'browser-check.mjs'), ...args], {
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
    child.on('close', (code) => done({ code: code ?? 0, out, ms: Date.now() - started }));
  });
}

console.log('浏览器门禁开关自检');

// ---------------------------------------------------------------- 默认不跑
{
  const { code, out, ms } = await run([]);
  check('默认不跑时退出码 0', code === 0, `实际 ${code}`);
  check('说明怎么开启', /BROWSER_CHECK=1/.test(out), out.slice(0, 120));
  check('默认路径要快（< 2 秒，不能拖慢 check）', ms < 2000, `实际 ${ms}ms`);
  check('默认不启动 dev server', !/起 dev server/.test(out));
}

// ---------------------------------------------------------------- 端口被占 → 必须失败
{
  // 故意占一个端口（IPv4，模拟 nginx / 上次跑剩的实例）
  const blocker = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '2' });
    response.end('ok');
  });
  await new Promise((done) => blocker.listen(0, '127.0.0.1', done));
  const port = blocker.address().port;

  try {
    const { code, out } = await run([], { BROWSER_CHECK: '1', BROWSER_CHECK_PORT: String(port) });
    check('端口被占时退出码非 0（不能假绿）', code !== 0, `实际 ${code}`);
    check('说清"会连到别人的实例"这个后果', /假绿|别人的|不是这次改动/.test(out), out.slice(0, 200));
    check('给了换端口的办法', /BROWSER_CHECK_PORT/.test(out));
  } finally {
    await new Promise((done) => blocker.close(done));
  }
}

// ---------------------------------------------------------------- 源码与接线
{
  const src = readFileSync(join(projectRoot, 'tools', 'browser-check.mjs'), 'utf8');
  check('有前置端口探测（不依赖 strictPort 单打独斗）', src.includes('portAlreadyInUse'));
  check('IPv4 与 localhost 都探（Vite 绑 IPv6，别的东西可能绑 IPv4）', /127\.0\.0\.1.*localhost|localhost.*127\.0\.0\.1/s.test(src));
  check('自己起 dev server 并关掉（不要求用户先 npm run dev）', src.includes('startDevServer') && src.includes('SIGTERM'));
  check('dev server 起不来算真失败', src.includes('dev server 30 秒内没起来'));
  check('guard 带 --enter-world（多跑真实代码）', src.includes('--enter-world'));

  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  check('有 npm run check:browser', typeof pkg.scripts?.['check:browser'] === 'string');
  check('已挂进 npm run check 链尾', /check:browser/.test(pkg.scripts?.check ?? ''));
  check('check 里是"&&"串联（失败会中断，不是忽略）', /audit:docs && npm run check:browser/.test(pkg.scripts?.check ?? ''));
}

console.log(`\n浏览器门禁开关测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

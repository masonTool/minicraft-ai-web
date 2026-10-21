#!/usr/bin/env node
/**
 * 固定端口的小游戏预览入口（http://localhost:3899）
 *
 * 为什么需要：`run_game` 每次重启都会**换一个随机端口**，而且只监听 IPv6 的
 * `[::1]`——所以「刚才那个 localhost:53704」过一会儿就打不开了，`127.0.0.1` 也连不上。
 *
 * 这里起一个固定 3899 的反向代理，**同时监听 127.0.0.1 与 ::1**，把请求转给
 * helper 当前的端口。helper 换端口时不用改地址，改这里的目标就行（或传 UPSTREAM）。
 *
 * 用法：
 *   node tools/minigame/preview-proxy.mjs                 # 自动发现 helper 端口
 *   UPSTREAM=http://localhost:64004 node tools/minigame/preview-proxy.mjs
 *   PORT=3899 node tools/minigame/preview-proxy.mjs
 */

import { createServer, request } from 'node:http';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.PORT || 3899);

/** 从 lsof 里找 helper 的监听端口（它只监听 [::1]） */
function discoverUpstream() {
  if (process.env.UPSTREAM) return new URL(process.env.UPSTREAM);
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
    const candidates = [];
    for (const line of out.split('\n')) {
      const m = /\[::1\]:(\d+)\s+\(LISTEN\)/.exec(line);
      if (!m) continue;
      const port = Number(m[1]);
      // 排除显然不是预览的端口（本地开发常见的几个）
      if ([3899, 3847, 5173, 8787].includes(port)) continue;
      candidates.push(port);
    }
    // helper 的预览端口一般是高位随机端口；取最大的那个（最近启动的）
    candidates.sort((a, b) => b - a);
    if (candidates.length > 0) return new URL(`http://localhost:${candidates[0]}`);
  } catch {
    /* 交给下面报错 */
  }
  return null;
}

let upstream = discoverUpstream();
if (!upstream) {
  console.error('找不到 helper 预览端口：先跑一次 run_game，或显式给 UPSTREAM=http://localhost:PORT');
  process.exit(1);
}

const server = createServer((req, res) => {
  const options = {
    protocol: 'http:',
    hostname: upstream.hostname,
    port: upstream.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${upstream.port}` },
  };
  const proxied = request(options, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  proxied.on('error', (err) => {
    // helper 换端口了：重新发现一次，提示重试
    const next = discoverUpstream();
    if (next && next.port !== upstream.port) upstream = next;
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`预览服务连不上：${err.message}\n当前上游 ${upstream.href}\n重新跑一次 run_game 后刷新。`);
  });
  req.pipe(proxied);
});

// 双栈监听：`localhost` 在不同平台可能解析到 ::1 或 127.0.0.1，两边都要通
server.listen(PORT, '::', () => {
  console.log(`预览入口：http://localhost:${PORT}/  →  ${upstream.href}`);
  console.log('（helper 换端口后，重启本脚本即可；浏览器不用改地址）');
});

// 每 10 秒复查一次上游是否还活着，死了就重新发现
setInterval(() => {
  const probe = request(
    { hostname: upstream.hostname, port: upstream.port, path: '/', method: 'HEAD', timeout: 1500 },
    (r) => r.resume(),
  );
  probe.on('error', () => {
    const next = discoverUpstream();
    if (next && next.port !== upstream.port) {
      console.log(`上游已切换：${upstream.href} → ${next.href}`);
      upstream = next;
    }
  });
  probe.on('timeout', () => probe.destroy());
  probe.end();
}, 10_000);

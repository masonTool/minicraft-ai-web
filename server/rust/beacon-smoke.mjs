/**
 * 局域网发现（N4 的 Rust 半边）冒烟：**两个真进程互相发现**。
 *
 * 验的是这条链：起两个服务端（`BEACON=1`，同一个 UDP 发现端口）→ 各自的广播能到
 * 对方 → `/healthz` 的 `peers` 里出现对方 → 房间里有人/有房主时，广播内容跟着变 →
 * **自己的回声被过滤**（不然房间里会看到自己两遍）。
 *
 * 为什么不用单测替代：`SO_REUSEPORT`、广播回环、"同一台机器两个进程"这些只在真 socket
 * 上才成立；单测里那个 socket_round_trip 只验了"能收能解"。
 *
 * 运行：`bash run-beacon-smoke.sh`（会 build 两个临时服务端并清理）
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BINARY = process.env.BINARY ?? './target/debug/minicraft-server';
/** 用非默认端口：开发者自己的服务端可能正占着 25188 */
const BEACON_PORT = Number(process.env.BEACON_PORT ?? 25198);

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 起一个带发现的服务端，返回 { child, port, output() } */
async function startServer(label) {
  const dataDir = mkdtempSync(join(tmpdir(), `minicraft-beacon-${label}-`));
  const child = spawn(BINARY, [], {
    env: {
      ...process.env,
      PORT: '0',
      BEACON: '1',
      BEACON_PORT: String(BEACON_PORT),
      // 走回环网卡：开发机的默认可组播网卡不一定在（见 beacon.rs 的注释）
      BEACON_IF: '127.0.0.1',
      GRACE_MS: '400',
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  for (let i = 0; i < 120; i++) {
    await sleep(40);
    const match = output.match(/已启动，端口 (\d+)/);
    if (match) return { child, port: Number(match[1]), output: () => output };
    if (child.exitCode !== null) break;
  }
  throw new Error(`${label} 没起来：${output.slice(-400)}`);
}

async function healthz(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    return await response.json();
  } catch {
    return null;
  }
}

/** 轮询直到 `predicate(health)` 为真 */
async function until(port, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await healthz(port);
    if (last && predicate(last)) return last;
    await sleep(150);
  }
  return last;
}

const a = await startServer('a');
const b = await startServer('b');
console.log(`\n[两个服务端] A=${a.port} B=${b.port}，发现端口 ${BEACON_PORT}`);

try {
  check('两个服务端都起来了', a.port > 0 && b.port > 0 && a.port !== b.port, `${a.port} / ${b.port}`);
  const firstHealth = await healthz(a.port);
  check('/healthz 报告发现已开启', firstHealth?.beacon === true, JSON.stringify(firstHealth?.beacon));

  // A 开一间房（带房主），广播内容应当跟着变成"1 人 / 有房主"
  const socket = new WebSocket(`ws://127.0.0.1:${a.port}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.send(
    JSON.stringify({
      t: 'join',
      v: 2,
      clientId: 'beaconhost0001',
      name: '房主',
      x: 0,
      y: 70,
      z: 0,
      dimension: 'overworld',
      room: 'beaconroom',
      host: true,
      world: { name: '发现测试世界', seed: 998877 },
    }),
  );
  const welcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.t === 'welcome') {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  check('A 上开了一间房（带房主与世界名）', welcome?.isHost === true, JSON.stringify(welcome?.isHost));

  const seenByB = await until(b.port, (health) => (health.peers ?? []).some((peer) => peer.port === a.port));
  const peerOfA = (seenByB?.peers ?? []).find((peer) => peer.port === a.port);
  check('B 发现了 A（端口对得上）', peerOfA !== undefined, JSON.stringify(seenByB?.peers));
  check('广播带世界名（面板要显示"进哪片大陆"）', peerOfA?.name === '发现测试世界', JSON.stringify(peerOfA?.name));
  check('广播带种子', peerOfA?.seed === 998877, `${peerOfA?.seed}`);
  check('广播带人数与房主标记', peerOfA?.players === 1 && peerOfA?.hasHost === true, JSON.stringify(peerOfA));
  check('广播带口令开关（这里没设口令）', peerOfA?.passwordRequired === false, `${peerOfA?.passwordRequired}`);
  check('广播带房间名（点一下进房要靠它）', peerOfA?.room === 'beaconroom', `${peerOfA?.room}`);

  const seenByA = await until(a.port, (health) => (health.peers ?? []).some((peer) => peer.port === b.port));
  check('A 也发现了 B（双向）', (seenByA?.peers ?? []).some((peer) => peer.port === b.port), JSON.stringify(seenByA?.peers));

  // 回声过滤：自己发的那一帧会回到自己的 socket 上，不能在 peers 里出现
  check(
    '自己的广播不会出现在自己的列表里',
    (seenByA?.peers ?? []).every((peer) => peer.port !== a.port),
    JSON.stringify(seenByA?.peers),
  );
  check('两边各只看见 1 个 peer（没有重复）', (seenByA?.peers ?? []).length === 1 && (seenByB?.peers ?? []).length === 1, `${seenByA?.peers?.length} / ${seenByB?.peers?.length}`);

  // B 也开一间空房（没人），它的广播应当显示 0 人 / 没房主 —— 证明内容是实时算的
  const idle = await until(b.port, (health) => (health.peers ?? []).length === 1);
  check('B 自己的状态是"0 人"（还没人进它）', idle?.players === 0, `${idle?.players}`);

  socket.close();
} finally {
  for (const server of [a, b]) {
    server.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      server.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

console.log(`\n发现冒烟：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

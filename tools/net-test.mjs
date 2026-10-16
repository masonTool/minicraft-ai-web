/**
 * 联机（K2）协议测试
 *
 * 起一个真的服务端（子进程），用真的 WebSocket 客户端连上去，
 * 验证"加入 / 位置广播 / 方块同步 / 世界快照 / 断线广播 / 聊天"这几条链路。
 * 用真连接而不是打桩：这类代码的 bug 几乎都出在"消息发没发出去、字段对不对"上。
 *
 * 运行：npm run test:net
 */

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8799; // 用不常用的端口，避免和开发者自己的服务端撞车
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

/** 一个测试用客户端：把收到的消息存进 mailbox，便于断言 */
class TestClient {
  constructor(name) {
    this.name = name;
    this.mailbox = [];
    this.socket = new WebSocket(`ws://localhost:${PORT}`);
    this.socket.on('message', (raw) => {
      this.mailbox.push(JSON.parse(String(raw)));
    });
    this.closed = false;
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** 取出一条指定类型的消息（取走即删） */
  take(type) {
    const index = this.mailbox.findIndex((message) => message.t === type);
    if (index < 0) return null;
    return this.mailbox.splice(index, 1)[0];
  }

  /**
   * 等待某类型消息出现（最多 timeout 毫秒）。
   *
   * ⚠️ 默认超时从 1500 提到 4000（批次 99）：**刚 spawn 起来的服务端**要等
   * Node 起进程 + 绑端口 + 建 handler，机器一忙就可能超过 1.5 秒——
   * 于是"Alice 收到 welcome"偶发红、连带四条依赖它的断言一起红（重跑又绿）。
   * 门禁"时红时绿"比慢一秒危险得多：它会让人养成**习惯性重跑**，
   * 那个习惯一养成，真红也会被当成偶发。
   */
  async wait(type, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const message = this.take(type);
      if (message) return message;
      await sleep(20);
    }
    return null;
  }

  close() {
    this.closed = true;
    this.socket.close();
  }
}

// ---------------------------------------------------------------- 启动服务端

console.log('\n[启动服务端]');
const server = spawn('node', ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk);
});

// 等服务端监听端口
let listening = false;
for (let i = 0; i < 100 && !listening; i++) {
  await sleep(100);
  listening = serverOutput.includes('已启动');
}
check('服务端启动成功', listening, serverOutput.trim().split('\n').slice(-3).join(' | '));

try {
  // ---------------------------------------------------------------- 加入与广播
  console.log('\n[加入 / 位置广播]');
  /**
   * 加入并等 welcome。
   *
   * 为什么要"重发一次"：`join` 可能在服务端的连接 handler 完全就绪之前发出去，
   * 那条消息就**永远没人接**（不是服务端的 bug，而是"测试比服务端快"）。
   * 第一次等 2.5 秒还没回就重发一次 join——真实玩家重连也是这个行为。
   */
  async function joinAndWaitWelcome(client, name, x, y, z) {
    await client.ready();
    for (let attempt = 0; attempt < 2; attempt++) {
      client.send({ t: 'join', name, x, y, z });
      const welcome = await client.wait('welcome', attempt === 0 ? 2500 : 4000);
      if (welcome) return welcome;
    }
    return null;
  }

  const alice = new TestClient('Alice');
  const welcomeA = await joinAndWaitWelcome(alice, 'Alice', 10, 70, 20);
  check('Alice 收到 welcome', welcomeA !== null);
  check('welcome 带服务端种子', welcomeA?.seed === 20261014, `${welcomeA?.seed}`);
  check('welcome 带自己的 id', welcomeA?.id === 1, `${welcomeA?.id}`);
  check('welcome 初始玩家表只含自己', (welcomeA?.players ?? []).length === 1, `${welcomeA?.players?.length}`);

  const bob = new TestClient('Bob');
  const welcomeB = await joinAndWaitWelcome(bob, 'Bob', -5, 70, 8);
  check('Bob 收到 welcome 且能看到 Alice', (welcomeB?.players ?? []).some((p) => p.name === 'Alice'), JSON.stringify(welcomeB?.players));

  const aliceSeesBob = await alice.wait('player');
  check('Alice 收到 Bob 加入的广播', aliceSeesBob?.name === 'Bob' && aliceSeesBob?.id === 2, JSON.stringify(aliceSeesBob));

  // 位置广播
  alice.send({ t: 'move', x: 11.5, y: 71.25, z: 21, yaw: 1.57, pitch: -0.2, dimension: 'overworld' });
  await sleep(120);
  const moved = await bob.wait('player');
  check('位置更新被广播', moved?.id === 1 && Math.abs(moved.x - 11.5) < 0.001, JSON.stringify(moved));
  check('朝向也一起同步', Math.abs((moved?.yaw ?? 0) - 1.57) < 0.001, `${moved?.yaw}`);

  // 限频：短时间内连发多条 move，只应有一条被转发
  bob.mailbox.length = 0;
  for (let i = 0; i < 10; i++) alice.send({ t: 'move', x: 20 + i, y: 70, z: 0, yaw: 0, pitch: 0 });
  await sleep(150);
  const forwarded = bob.mailbox.filter((message) => message.t === 'player').length;
  check('位置消息被服务端限频', forwarded <= 2, `150ms 内转发了 ${forwarded} 条`);

  // ---------------------------------------------------------------- 方块同步
  console.log('\n[方块改动广播与快照]');
  alice.send({ t: 'block', x: 100, y: 64, z: -50, id: 1, state: 0, dimension: 'overworld' });
  const blockMessage = await bob.wait('block');
  check(
    '方块改动被广播（含坐标/方块/维度）',
    blockMessage?.x === 100 && blockMessage?.y === 64 && blockMessage?.z === -50 && blockMessage?.id === 1,
    JSON.stringify(blockMessage),
  );
  check('广播里带 by（发送者 id）', blockMessage?.by === 1, `${blockMessage?.by}`);

  alice.send({ t: 'block', x: 101, y: 65, z: -50, id: 259, state: 6, dimension: 'overworld' });
  // 等 Bob 真的收到这条广播再让 Carol 加入：`await sleep(100)` 也有"服务端还没处理完"
  // 的风险（那时 Carol 的 welcome 里就少一条改动，而且是**偶发**的）
  await bob.wait('block');

  // 新玩家加入：应当在 welcome 里拿到**已有的方块改动**（这是"区块同步"的全部内容）
  const carol = new TestClient('Carol');
  const welcomeC = await joinAndWaitWelcome(carol, 'Carol', 0, 80, 0);
  check('新玩家拿到玩家列表', (welcomeC?.players ?? []).length === 3, `${welcomeC?.players?.length}`);
  check(
    '新玩家拿到历史方块改动（含状态）',
    (welcomeC?.edits ?? []).some((e) => e[0] === 100 && e[3] === 1) &&
      (welcomeC?.edits ?? []).some((e) => e[0] === 101 && e[3] === 259 && e[4] === 6),
    JSON.stringify(welcomeC?.edits),
  );
  check('新玩家拿到的是服务端种子（据此重现同一片地形）', welcomeC?.seed === welcomeA?.seed);

  // ---------------------------------------------------------------- 聊天与离开
  console.log('\n[聊天 / 离开]');
  bob.send({ t: 'chat', text: '你好世界' });
  const chat = await alice.wait('chat');
  check('聊天被广播（带昵称）', chat?.name === 'Bob' && chat?.text === '你好世界', JSON.stringify(chat));

  carol.close();
  const leave = await alice.wait('leave');
  check('离开会广播 leave', leave?.id === 3, JSON.stringify(leave));

  // ---------------------------------------------------------------- 异常输入
  console.log('\n[异常输入]');
  alice.mailbox.length = 0;
  alice.socket.send('这不是 JSON');
  const errorMessage = await alice.wait('error');
  check('非法 JSON 会被回错误而不是崩服务端', errorMessage !== null, JSON.stringify(errorMessage));

  alice.send({ t: 'nonsense' });
  const unknownType = await alice.wait('error');
  check('未知消息类型会被回错误', unknownType !== null, JSON.stringify(unknownType));

  alice.send({ t: 'block', x: 'abc', y: 1, z: 1, id: 1 });
  // ⚠️ 这里原来写的是 `check('非法坐标不会写进世界快照', true)`——**永远为真**，
  // 什么也没验（标题说了它没做的事）。真正的判据是"新玩家拿到的快照里没有它"。
  const dave = new TestClient('Dave');
  const welcomeD = await joinAndWaitWelcome(dave, 'Dave', 3, 70, 3);
  check('非法坐标不会写进世界快照', welcomeD !== null && !(welcomeD.edits ?? []).some((e) => e[3] === 1 && e[0] === 1));
  dave.close();

  check('服务端仍然活着', server.exitCode === null, `exitCode=${server.exitCode}`);

  alice.close();
  bob.close();
} finally {
  server.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n联机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

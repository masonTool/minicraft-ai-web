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
import { PROTOCOL_VERSION } from '../server/protocol.mjs';

const PORT = 8799; // 用不常用的端口，避免和开发者自己的服务端撞车
let passed = 0;
let failed = 0;
/** 每个 TestClient 默认拿一个新身份（8~64 位字母/数字/-/_，见 server/protocol.mjs） */
let clientSeq = 0;

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
  /** @param {string} [clientId] 显式传同一个值可以测"重复身份" */
  constructor(name, clientId = `testclient${String(++clientSeq).padStart(2, '0')}`) {
    this.name = name;
    this.clientId = clientId;
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

  /**
   * 等连接真的关闭。
   *
   * 被服务端拒绝时，"收到 error"与"连接关闭"是两帧：只断言前者，
   * 会把"错误发出去了但没关"这种半成品当成通过。
   */
  async waitClosed(timeout = 2000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.socket.readyState === WebSocket.CLOSED) return true;
      await sleep(20);
    }
    return false;
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
      client.send({ t: 'join', v: PROTOCOL_VERSION, clientId: client.clientId, name, x, y, z });
      const welcome = await client.wait('welcome', attempt === 0 ? 2500 : 4000);
      if (welcome) return welcome;
    }
    return null;
  }

  const alice = new TestClient('Alice');
  const welcomeA = await joinAndWaitWelcome(alice, 'Alice', 10, 70, 20);
  check('Alice 收到 welcome', welcomeA !== null);
  check('welcome 带服务端种子', welcomeA?.seed === 20261014, `${welcomeA?.seed}`);
  check('welcome 带协议版本', welcomeA?.v === PROTOCOL_VERSION, `${welcomeA?.v}`);
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

  // ---------------------------------------------------------------- 掉落物镜像
  console.log('\n[掉落物镜像（L7 第一刀）]');
  alice.mailbox.length = 0;
  bob.mailbox.length = 0;

  alice.send({ t: 'item-spawn', localId: 7, itemId: 12, count: 3, x: 10.5, y: 70, z: 20.5 });
  const itemSpawn = await bob.wait('item-spawn');
  check(
    '掉落物生成被广播（owner / localId / 物品 / 数量 / 坐标）',
    itemSpawn?.owner === 1 &&
      itemSpawn?.localId === 7 &&
      itemSpawn?.itemId === 12 &&
      itemSpawn?.count === 3 &&
      Math.abs(itemSpawn?.x - 10.5) < 0.001,
    JSON.stringify(itemSpawn),
  );
  check('生成者自己不会收到回传', (await alice.wait('item-spawn', 300)) === null);

  // 新玩家进来要看得见地上已有的东西（与方块改动同一个思路）
  const erin = new TestClient('Erin');
  const welcomeE = await joinAndWaitWelcome(erin, 'Erin', 0, 70, 0);
  check(
    'welcome 里带已有掉落物',
    (welcomeE?.items ?? []).some((i) => i.owner === 1 && i.localId === 7 && i.itemId === 12),
    JSON.stringify(welcomeE?.items),
  );
  erin.close();
  await alice.wait('leave');

  // 删除：只有 owner 能删（协议里 localId 由服务端拼上自己的 id）
  alice.send({ t: 'item-remove', localId: 7 });
  const itemRemove = await bob.wait('item-remove');
  check('掉落物消失被广播', itemRemove?.owner === 1 && itemRemove?.localId === 7, JSON.stringify(itemRemove));

  alice.send({ t: 'item-spawn', localId: 8, itemId: 5, count: 1, x: 1, y: 70, z: 1 });
  await bob.wait('item-spawn');
  // Bob 用自己的 localId=8 想删 Alice 那一堆：key 前缀不同，删不到
  bob.send({ t: 'item-remove', localId: 8 });
  await sleep(120);
  const frank = new TestClient('Frank');
  const welcomeF = await joinAndWaitWelcome(frank, 'Frank', 0, 70, 0);
  check(
    '删不掉别人的掉落物（owner 由服务端填，不信消息里的 id）',
    (welcomeF?.items ?? []).some((i) => i.owner === 1 && i.localId === 8),
    JSON.stringify(welcomeF?.items),
  );
  frank.close();
  await alice.wait('leave');

  // 脏数据：数量超上限 / 坐标 NaN 都不该进快照
  alice.send({ t: 'item-spawn', localId: 9, itemId: 5, count: 999, x: 1, y: 70, z: 1 });
  alice.send({ t: 'item-spawn', localId: 10, itemId: 5, count: 1, x: 'abc', y: 70, z: 1 });
  await sleep(120);
  const grace = new TestClient('Grace');
  const welcomeG = await joinAndWaitWelcome(grace, 'Grace', 0, 70, 0);
  check(
    '脏掉落物消息被拒（数量超上限 / 坐标非法）',
    !(welcomeG?.items ?? []).some((i) => i.owner === 1 && (i.localId === 9 || i.localId === 10)),
    JSON.stringify(welcomeG?.items),
  );
  grace.close();
  await alice.wait('leave');

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

  // ---------------------------------------------------------------- 握手（联机2）
  console.log('\n[握手 / 版本 / 身份]');
  {
    // 旧版本：字段语义可能已经变了，服务端必须在 join 就拒绝，而不是让他带病进世界
    const oldVersion = new TestClient('OldVersion');
    await oldVersion.ready();
    oldVersion.send({ t: 'join', v: PROTOCOL_VERSION - 1, name: '老客户端', clientId: 'oldversion01' });
    const versionError = await oldVersion.wait('error');
    check('旧版本被拒（error.code = version）', versionError?.code === 'version', JSON.stringify(versionError));
    check('被拒后服务端关闭连接', await oldVersion.waitClosed(), `readyState=${oldVersion.socket.readyState}`);

    // 缺 clientId：没有它就没法做"重复连接"和重连认人
    const noId = new TestClient('NoId');
    await noId.ready();
    noId.send({ t: 'join', v: PROTOCOL_VERSION, name: '无身份' });
    const idError = await noId.wait('error');
    check('缺 clientId 被拒（error.code = clientId）', idError?.code === 'clientId', JSON.stringify(idError));
    await noId.waitClosed();

    // 重复 clientId：同一个浏览器开两个标签页，后来的应被拒（不然两个连接共用一个玩家记录）
    const duplicate = new TestClient('Duplicate', alice.clientId);
    await duplicate.ready();
    duplicate.send({ t: 'join', v: PROTOCOL_VERSION, name: '重复身份', clientId: alice.clientId });
    const dupError = await duplicate.wait('error');
    check('重复 clientId 被拒（error.code = duplicate）', dupError?.code === 'duplicate', JSON.stringify(dupError));
    await duplicate.waitClosed();

    // 脏名字：控制字符、尖括号（能伪造 `<名字>` 前缀）、前后空白
    const dirty = new TestClient('DirtyName');
    const welcomeDirty = await joinAndWaitWelcome(dirty, '  <坏\u0000名>  ', 0, 70, 0);
    check('脏名字被洗成安全形式', welcomeDirty?.name === '坏 名', JSON.stringify(welcomeDirty?.name));
    dirty.close();

    // 超长名字按**字符**截断（不能把 emoji 的代理对切一半）
    const longName = new TestClient('LongName');
    const welcomeLong = await joinAndWaitWelcome(longName, '一二三四五六七八九十一二三四五六七八', 0, 70, 0);
    check(
      '超长名字截到 16 个字符',
      Array.from(welcomeLong?.name ?? '').length === 16,
      JSON.stringify(welcomeLong?.name),
    );
    longName.close();
  }

  check('服务端仍然活着', server.exitCode === null, `exitCode=${server.exitCode}`);

  // ---------------------------------------------------------------- 离开时清理掉落物
  console.log('\n[离开时清理掉落物]');
  alice.send({ t: 'item-spawn', localId: 99, itemId: 3, count: 1, x: 0, y: 70, z: 0 });
  await bob.wait('item-spawn');
  alice.close();
  await bob.wait('leave');
  // Alice 名下还有 localId=8 那一堆，两条 remove 的先后不定：收集到 99 为止
  const removes = [];
  const removeDeadline = Date.now() + 1500;
  while (Date.now() < removeDeadline) {
    const message = bob.take('item-remove');
    if (!message) {
      await sleep(20);
      continue;
    }
    removes.push(message);
    if (removes.some((m) => m.localId === 99)) break;
  }
  check(
    '玩家离开后他名下的掉落物被清掉',
    removes.some((m) => m.owner === 1 && m.localId === 99),
    JSON.stringify(removes),
  );

  bob.close();
} finally {
  server.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n联机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

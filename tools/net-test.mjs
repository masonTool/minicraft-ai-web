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
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../server/protocol.mjs';

const PORT = 8799; // 用不常用的端口，避免和开发者自己的服务端撞车
/**
 * 服务端快照目录（联机13）：指到临时目录，**不能**用默认的 `server/.data/`——
 * 否则跑一次测试就把开发者自己房间的存档覆盖了。
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'minicraft-net-'));
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
  constructor(name, clientId = `testclient${String(++clientSeq).padStart(2, '0')}`, options = {}) {
    this.name = name;
    this.clientId = clientId;
    /** 房间码 / 口令（联机26）：跟着 join 一起发 */
    this.room = options.room ?? '';
    this.password = options.password ?? '';
    this.mailbox = [];
    this.socket = new WebSocket(
      `ws://localhost:${PORT}`,
      options.origin ? { headers: { origin: options.origin } } : undefined,
    );
    /*
     * 兜底监听 `error`：没有它的话，连接失败（服务端还没起来 / 重启中的空窗）
     * 会以**未捕获事件**的形式把整个测试进程带崩——看不到是哪条断言失败，只看到
     * 一段 ECONNREFUSED 堆栈。`ready()` 里那个 `once('error', reject)` 仍然生效。
     */
    this.socket.on('error', () => {});
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
  /**
   * 等某类型消息出现。
   *
   * 默认超时 4s → **8s**：这个套件现在要起两次服务端（持久化用例），而 `check:fast`
   * 里它和 guard 等重套件并发跑——机器一忙，"服务端 spawn + 握手"就可能超过 4 秒，
   * 表现为偶发红（外面重跑又绿，反而让人养成习惯性重跑）。等待成功的路径不会变慢。
   */
  async wait(type, timeout = 8000) {
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
/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
let serverOutput = '';

/**
 * 起一个服务端子进程并等它监听端口。
 *
 * 抽成函数是为了"重启后快照仍在"那条用例（联机13）——它要真的杀一次再起一次。
 */
async function startServer(extraEnv = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    serverOutput = '';
    server = spawn('node', ['server/index.mjs'], {
      // GRACE_MS：断线宽限期（联机8）。真实值 30 秒，测试里压到 400ms——否则每条
      // "宽限期过后才清掉落物"的断言都要白等半分钟
      env: {
        ...process.env,
        PORT: String(PORT),
        GRACE_MS: '400',
        DATA_DIR,
        // 来源白名单（联机26）：只有这个 origin 能连；不带 Origin 的照常放行（node 客户端）
        ALLOWED_ORIGINS: 'http://good.example',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => {
      serverOutput += String(chunk);
    });
    server.stderr.on('data', (chunk) => {
      serverOutput += String(chunk);
    });
    // 等服务端监听端口
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (serverOutput.includes('已启动')) return true;
      if (server.exitCode !== null) break;
    }
    // 上一次的 socket 还在 TIME_WAIT / CPU 挤到超时：等一下再起一次，
    // 而不是直接把"没监听"当成断言失败（外面看到的是偶发红）
    if (attempt < attempts) await sleep(700);
  }
  return false;
}

check('服务端启动成功', await startServer(), serverOutput.trim().split('\n').slice(-3).join(' | '));

// 健康检查（联机28）：容器/反代靠它判活，和 WebSocket 共用同一个端口
{
  const response = await fetch(`http://localhost:${PORT}/healthz`).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  check('GET /healthz 返回 ok', response?.status === 200 && body?.ok === true, JSON.stringify(body));
  check('/healthz 带上在线人数与协议版本', typeof body?.players === 'number' && body?.protocol > 0, JSON.stringify(body));
  check(
    '/healthz 带吞吐统计（联机29）',
    typeof body?.traffic?.inBytesPerSecond === 'number' && typeof body?.traffic?.outBytesPerSecond === 'number',
    JSON.stringify(body?.traffic),
  );
  const missing = await fetch(`http://localhost:${PORT}/nope`).catch(() => null);
  check('其它路径返回 404（不误当健康检查通过）', missing?.status === 404, `${missing?.status}`);
}

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
  async function joinAndWaitWelcome(client, name, x, y, z, dimension = 'overworld') {
    await client.ready();
    for (let attempt = 0; attempt < 2; attempt++) {
      client.send({
        t: 'join',
        v: PROTOCOL_VERSION,
        clientId: client.clientId,
        name,
        x,
        y,
        z,
        dimension,
        ...(client.room ? { room: client.room } : {}),
        ...(client.password ? { password: client.password } : {}),
      });
      const welcome = await client.wait('welcome', attempt === 0 ? 4000 : 6000);
      if (welcome) return welcome;
    }
    return null;
  }

  const alice = new TestClient('Alice');
  /**
   * 心跳（联机7）的探针：服务端在 join 成功时立刻 ping 一次，之后每 5s 一次。
   * 这里**先挂监听再继续跑别的用例**，跑完再收结果——不对齐 5s 窗口，套件不会因此变慢。
   */
  const heartbeatSeen = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    alice.socket.once('ping', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  /**
   * 时间校正（联机10）的探针：服务端每 2s 广播一条 `time`。同样先挂好再跑别的用例，
   * 不对齐 2s 窗口，套件不会因此变慢。
   */
  const timeSeen = alice.wait('time', 5000);
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
  console.log('\n[延迟探测（联机29）]');
  {
    alice.mailbox.length = 0;
    alice.send({ t: 'ping' });
    const pong = await alice.wait('pong', 2000);
    check('ping 收到 pong（客户端靠它算 RTT）', pong !== null, JSON.stringify(pong));
  }

  console.log('\n[方块改动广播与快照]');
  alice.send({ t: 'block', x: 30, y: 64, z: -20, id: 1, state: 0, dimension: 'overworld' });
  const blockMessage = await bob.wait('block');
  check(
    '方块改动被广播（含坐标/方块/维度）',
    blockMessage?.x === 30 && blockMessage?.y === 64 && blockMessage?.z === -20 && blockMessage?.id === 1,
    JSON.stringify(blockMessage),
  );
  check('广播里带 by（发送者 id）', blockMessage?.by === 1, `${blockMessage?.by}`);

  alice.send({ t: 'block', x: 31, y: 65, z: -20, id: 259, state: 6, dimension: 'overworld' });
  // 等 Bob 真的收到这条广播再让 Carol 加入：`await sleep(100)` 也有"服务端还没处理完"
  // 的风险（那时 Carol 的 welcome 里就少一条改动，而且是**偶发**的）
  await bob.wait('block');

  // 新玩家加入：应当在 welcome 里拿到**已有的方块改动**（这是"区块同步"的全部内容）
  const carol = new TestClient('Carol');
  const welcomeC = await joinAndWaitWelcome(carol, 'Carol', 0, 80, 0);
  check('新玩家拿到玩家列表', (welcomeC?.players ?? []).length === 3, `${welcomeC?.players?.length}`);
  check(
    '新玩家拿到历史方块改动（含状态）',
    (welcomeC?.edits ?? []).some((e) => e[0] === 30 && e[3] === 1) &&
      (welcomeC?.edits ?? []).some((e) => e[0] === 31 && e[3] === 259 && e[4] === 6),
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
  console.log('\n[掉落物维度（联机31）]');
  {
    // bob 在下界丢一堆（`dimension` 跟着消息走，而不是"接收者当前维度"）
    bob.send({ t: 'item-spawn', localId: 61, itemId: 3, count: 1, x: 9, y: 70, z: 9, dimension: 'nether' });
    await sleep(150);

    // 主世界的新玩家不该看到它
    const overworldGuest = new TestClient('OwGuest');
    const owWelcome = await joinAndWaitWelcome(overworldGuest, '主世界客', 9, 70, 9);
    check(
      '主世界玩家的快照里没有下界的掉落物',
      !(owWelcome?.items ?? []).some((i) => i.localId === 61),
      JSON.stringify(owWelcome?.items),
    );

    // 下界的新玩家应该看到（同一个坐标，不同维度）
    const netherGuest = new TestClient('NetherGuest');
    const netherWelcome = await joinAndWaitWelcome(netherGuest, '下界客', 9, 70, 9, 'nether');
    check(
      '下界玩家的快照里有它（带 dimension）',
      (netherWelcome?.items ?? []).some((i) => i.localId === 61 && i.dimension === 'nether'),
      JSON.stringify(netherWelcome?.items),
    );

    overworldGuest.close();
    netherGuest.close();
  }

  console.log('\n[聊天 / 离开]');
  bob.send({ t: 'chat', text: '你好世界' });
  const chat = await alice.wait('chat');
  check('聊天被广播（带昵称）', chat?.name === 'Bob' && chat?.text === '你好世界', JSON.stringify(chat));

  alice.mailbox.length = 0;
  carol.close();
  // 宽限期（400ms）到期才广播 leave，而且这期间**别人的** leave 也会进来
  // （上面几段新加的 guest 客户端刚关）——所以按 id 找，别取第一条
  let leave = null;
  const leaveDeadline = Date.now() + 2500;
  while (Date.now() < leaveDeadline) {
    const message = alice.take('leave');
    if (!message) {
      await sleep(20);
      continue;
    }
    if (message.id === welcomeC?.id) {
      leave = message;
      break;
    }
  }
  check('离开会广播 leave', leave !== null, JSON.stringify(leave));

  // ---------------------------------------------------------------- 聊天不重复回显（联机30）
  console.log('\n[聊天不重复]');
  {
    alice.mailbox.length = 0;
    bob.mailbox.length = 0;
    bob.send({ t: 'chat', text: '只该出现一次' });
    check('接收者收到一条', (await alice.wait('chat', 2000)) !== null);
    check(
      '发送者不会收到服务端回传（客户端已本地回显，否则同一条消息出现两次）',
      (await bob.wait('chat', 600)) === null,
    );
  }

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

  // ---------------------------------------------------------------- 位置与维度（联机3）
  console.log('\n[位置与维度]');
  {
    // 入服要带上"我此刻在哪"：不带的话队友会先在 (0,80,0) 看到你闪一下
    alice.mailbox.length = 0;
    const netherGuy = new TestClient('NetherGuy');
    const welcomeN = await joinAndWaitWelcome(netherGuy, '下界客', 12.5, 70.25, -3.5, 'nether');
    const selfInWelcome = (welcomeN?.players ?? []).find((player) => player.id === welcomeN?.id);
    check(
      'join 的坐标写进 welcome',
      selfInWelcome?.x === 12.5 && selfInWelcome?.y === 70.25 && selfInWelcome?.z === -3.5,
      JSON.stringify(selfInWelcome),
    );
    check('join 的维度写进 welcome', selfInWelcome?.dimension === 'nether', `${selfInWelcome?.dimension}`);

    const joinBroadcast = await alice.wait('player');
    check('加入广播带维度（其他人据此过滤渲染）', joinBroadcast?.dimension === 'nether', JSON.stringify(joinBroadcast));
    netherGuy.close();

    // 脏维度不能进 edits/容器表的 key（那会让一整片改动永远对不上）
    const weird = new TestClient('WeirdDimension');
    const welcomeWeird = await joinAndWaitWelcome(weird, '怪维度', 0, 70, 0, 'moon');
    const weirdSelf = (welcomeWeird?.players ?? []).find((player) => player.id === welcomeWeird?.id);
    check('非法维度回落 overworld', weirdSelf?.dimension === 'overworld', `${weirdSelf?.dimension}`);
    weird.close();
  }

  // ---------------------------------------------------------------- 断线重连（联机8）
  console.log('\n[断线重连]');
  {
    /*
     * 手机切后台/网络抖一下都会触发 close，客户端那边是"自动重连"。
     * 宽限期（测试里 400ms）内带同一个 clientId 回来，要复用原来的玩家 id：
     * 否则队友眼里你"消失又出现"，你名下的掉落物也再没人有权删（owner 就是 id）。
     */
    const reconnector = new TestClient('Reconnector');
    const welcomeR1 = await joinAndWaitWelcome(reconnector, '重连者', 3, 70, 3);
    const idBefore = welcomeR1?.id;
    check('首次加入拿到 id', typeof idBefore === 'number', `${idBefore}`);

    reconnector.close();
    await sleep(120); // 落在宽限期内（400ms）
    const back = new TestClient('Reconnector', reconnector.clientId);
    const welcomeR2 = await joinAndWaitWelcome(back, '重连者', 3, 70, 3);
    check('宽限期内重连复用原 id', welcomeR2?.id === idBefore, `${idBefore} → ${welcomeR2?.id}`);
    back.close();
    await sleep(600); // 让他过完宽限期
    // 宽限期过完就该从玩家表里消失（新进来的人看不到"幽灵"）
    const peek = new TestClient('Peeker');
    const welcomePeek = await joinAndWaitWelcome(peek, '旁观者', 0, 70, 0);
    check(
      '宽限期过后不再出现在玩家表里',
      !(welcomePeek?.players ?? []).some((p) => p.name === '重连者'),
      JSON.stringify(welcomePeek?.players),
    );
    peek.close();
  }

  // ---------------------------------------------------------------- 时间权威（联机10）
  console.log('\n[时间权威]');
  {
    const welcomeTime = welcomeA?.timeOfDay;
    check('welcome 带时间', typeof welcomeTime === 'number' && welcomeTime >= 0 && welcomeTime < 1, `${welcomeTime}`);
    // 天气权威（联机35）：进服先对齐一次。切换广播要等真实天气到点（8~16 分钟），
    // 那一半由 `tests/net-weather.test.ts` 的规则一致性覆盖
    const welcomeWeather = welcomeA?.weather;
    check(
      'welcome 带天气（clear/rain/thunder）',
      welcomeWeather === 'clear' || welcomeWeather === 'rain' || welcomeWeather === 'thunder',
      `${welcomeWeather}`,
    );
    // 2 秒一条校正广播；值必须落在一天之内（否则客户端会算成 NaN/负数）
    const timeMessage = await timeSeen;
    const value = timeMessage?.timeOfDay;
    check('收到时间校正广播', typeof value === 'number' && value >= 0 && value < 1, `${value}`);
  }

  // ---------------------------------------------------------------- 批量方块（联机12）
  console.log('\n[批量方块]');
  {
    alice.mailbox.length = 0;
    bob.send({
      t: 'blocks',
      blocks: [
        [20, 70, 30, 1, 0, 'overworld'],
        [21, 70, 30, 2, 3, 'overworld'],
      ],
    });
    const batch = await alice.wait('blocks', 2000);
    check('一批方块被整体转发', Array.isArray(batch?.blocks) && batch.blocks.length === 2, JSON.stringify(batch));

    // 脏条目逐条丢：坐标非数字那条不能进 edits，也不能被转发
    alice.mailbox.length = 0;
    bob.send({
      t: 'blocks',
      blocks: [
        [22, 70, 30, 1, 0, 'overworld'],
        ['x', 70, 30, 1, 0, 'overworld'],
      ],
    });
    const filtered = await alice.wait('blocks', 2000);
    check('批量里的非法条目被丢掉', filtered?.blocks?.length === 1, JSON.stringify(filtered));
  }

  // ---------------------------------------------------------------- 外观状态（联机17）
  console.log('\n[外观状态]');
  {
    await sleep(80); // move 有 50ms 限频
    alice.mailbox.length = 0;
    bob.send({
      t: 'move',
      x: -5,
      y: 70,
      z: 8,
      yaw: 0.5,
      pitch: 0.1,
      dimension: 'overworld',
      held: 5,
      armor: [1, 2, 0, 0],
      sneak: 1,
      swing: 1,
    });
    const state = await alice.wait('player', 2000);
    check(
      'move 带的手持物 / 盔甲 / 潜行 / 挥手被转发',
      state?.held === 5 &&
        Array.isArray(state?.armor) &&
        state.armor[1] === 2 &&
        state?.sneak === true &&
        state?.swing === true,
      JSON.stringify(state),
    );

    // 白名单：客户端塞的未知字段不该出现在广播里（否则一个客户端就能决定别人收到的报文）
    await sleep(80);
    alice.mailbox.length = 0;
    bob.send({
      t: 'move',
      x: -5,
      y: 70,
      z: 8,
      yaw: 0.5,
      pitch: 0.1,
      dimension: 'overworld',
      evil: { x: 1 },
      held: -3,
    });
    const clean = await alice.wait('player', 2000);
    check(
      '外观只转发白名单字段（未知字段与非正 id 被丢掉）',
      clean !== null && clean.evil === undefined && clean.held === undefined,
      JSON.stringify(clean),
    );
  }

  // ---------------------------------------------------------------- 生物命中（联机19）
  console.log('\n[生物命中]');
  {
    alice.mailbox.length = 0;
    bob.send({ t: 'mob-hit', typeId: 'zombie', dimension: 'overworld', x: 12, y: 70, z: 12, damage: 4, fire: 0 });
    const hit = await alice.wait('mob-hit', 2000);
    check(
      '生物命中被转发（类型 + 坐标 + 伤害）',
      hit?.typeId === 'zombie' && hit?.damage === 4 && hit?.x === 12,
      JSON.stringify(hit),
    );
    check('服务端填 by（谁打的）', typeof hit?.by === 'number', `${hit?.by}`);

    // 伤害与着火夹在合理区间：一个人不该能一发打死 100 血的怪
    alice.mailbox.length = 0;
    bob.send({ t: 'mob-hit', typeId: 'zombie', dimension: 'overworld', x: 12, y: 70, z: 12, damage: 999, fire: 99 });
    const clamped = await alice.wait('mob-hit', 2000);
    check('伤害与着火被夹到上限', clamped?.damage === 50 && clamped?.fire === 16, JSON.stringify(clamped));

    // 缺 typeId 整条丢（没有类型就无从匹配）
    alice.mailbox.length = 0;
    bob.send({ t: 'mob-hit', typeId: '', dimension: 'overworld', x: 0, y: 70, z: 0, damage: 4 });
    check('缺 typeId 的命中被拒', (await alice.wait('mob-hit', 600)) === null);
  }

  // ---------------------------------------------------------------- 拾取仲裁（联机21）
  console.log('\n[拾取仲裁]');
  {
    await sleep(80);
    // 再来一个"别人"：alice 与 rival 抢 bob 生成的那堆，才是真正的并发仲裁。
    // ⚠️ owner 要用**服务端分配的 id**（welcome 里的 `id`），`bob.id` 那个字段不存在、
    // 传 undefined 会被服务端当脏数据静默丢掉（本轮踩过：两边都收不到回包）
    const bobId = Number(welcomeB?.id ?? 0);
    check('拿到 bob 的服务端 id（下面抢的是他名下的堆）', bobId > 0, `${bobId}`);
    const rival = new TestClient('Rival');
    await joinAndWaitWelcome(rival, '抢货的人', 0, 70, 0);
    bob.send({ t: 'item-spawn', localId: 41, itemId: 3, count: 2, x: 40, y: 70, z: 40 });
    await sleep(150);

    alice.mailbox.length = 0;
    rival.mailbox.length = 0;
    // 两边几乎同时申请：服务端"查还在 → 删 → 回 ok"是原子的
    alice.send({ t: 'item-take', owner: bobId, localId: 41 });
    rival.send({ t: 'item-take', owner: bobId, localId: 41 });
    const aliceResult = await alice.wait('item-take', 2000);
    const rivalResult = await rival.wait('item-take', 2000);
    const winners = [aliceResult, rivalResult].filter((result) => result?.ok === true);
    check('同一堆只有一边抢到', winners.length === 1, JSON.stringify({ aliceResult, rivalResult }));
    check(
      '输的那边收到 gone',
      [aliceResult, rivalResult].some((result) => result?.ok === false && result?.reason === 'gone'),
      JSON.stringify({ aliceResult, rivalResult }),
    );
    check(
      '抢到之后各端都收到 item-remove（镜像一起消失）',
      (await alice.wait('item-remove', 2000)) !== null && (await rival.wait('item-remove', 2000)) !== null,
    );

    // 已经被抢走的再抢：gone（不能凭空变出一堆）
    rival.mailbox.length = 0;
    rival.send({ t: 'item-take', owner: bobId, localId: 41 });
    const late = await rival.wait('item-take', 2000);
    check('已抢走的堆再抢返回 gone', late?.ok === false && late?.reason === 'gone', JSON.stringify(late));
    rival.close();
  }

  // ---------------------------------------------------------------- PvP（联机22）
  console.log('\n[PvP 转发]');
  {
    await sleep(80);
    const aliceId = Number(welcomeA?.id ?? 0);
    const bobServerId = Number(welcomeB?.id ?? 0);

    alice.mailbox.length = 0;
    bob.mailbox.length = 0;
    bob.send({ t: 'player-hit', targetId: aliceId, damage: 4, team: 'red' });
    const hitMsg = await alice.wait('player-hit', 2000);
    check(
      '打人只发给被打的那位（带来源与队伍）',
      hitMsg?.damage === 4 && hitMsg?.fromTeam === 'red' && hitMsg?.fromId === bobServerId,
      JSON.stringify(hitMsg),
    );
    check('攻击者自己不会收到自己发的 player-hit', (await bob.wait('player-hit', 400)) === null);

    // 服务端夹取伤害上限（无鉴权下最省的那道闸）
    alice.mailbox.length = 0;
    bob.send({ t: 'player-hit', targetId: aliceId, damage: 999, team: '' });
    const clampedHit = await alice.wait('player-hit', 2000);
    check('打人伤害被夹到 50', clampedHit?.damage === 50, JSON.stringify(clampedHit));

    // 打自己 / 打不存在的 id：服务端不发（避免自伤死循环与无效包）
    alice.mailbox.length = 0;
    bob.send({ t: 'player-hit', targetId: bobServerId, damage: 4, team: '' });
    bob.send({ t: 'player-hit', targetId: 9999, damage: 4, team: '' });
    check('打自己 / 打不存在的 id 都不发', (await alice.wait('player-hit', 600)) === null);
  }

  // ---------------------------------------------------------------- 脏消息校验（联机24）
  console.log('\n[脏消息校验]');
  {
    const dirty = [
      ['y 越界', { t: 'block', x: 5, y: 400, z: 5, id: 1, state: 0, dimension: 'overworld' }],
      ['方块 id 超上界', { t: 'block', x: 5, y: 70, z: 5, id: 9999, state: 0, dimension: 'overworld' }],
      ['state 超 8 位', { t: 'block', x: 5, y: 70, z: 5, id: 1, state: 300, dimension: 'overworld' }],
      ['隔空改方块（200 格外）', { t: 'block', x: 200, y: 70, z: 5, id: 1, state: 0, dimension: 'overworld' }],
    ];
    for (const [label, message] of dirty) {
      alice.mailbox.length = 0;
      bob.send(message);
      check(`${label} 被拒`, (await alice.wait('block', 500)) === null);
    }

    // 批量里逐条丢：坏的那条不连累好的
    alice.mailbox.length = 0;
    bob.send({
      t: 'blocks',
      blocks: [
        [6, 70, 6, 1, 0, 'overworld'],
        [6, 400, 6, 1, 0, 'overworld'],
      ],
    });
    const batch = await alice.wait('blocks', 2000);
    check('批量里越界的条目被单独丢掉', batch?.blocks?.length === 1, JSON.stringify(batch));

    // 容器也要卡距离（原来只校验形状）
    alice.mailbox.length = 0;
    bob.send({ t: 'container', x: 300, y: 70, z: 300, dimension: 'overworld', slots: [null] });
    check('隔空改容器被拒', (await alice.wait('container', 500)) === null);
  }

  // ---------------------------------------------------------------- 广播范围（联机27）
  console.log('\n[广播范围]');
  {
    // 一个"远方的观察者"：和 bob 同房，但人在 5000 格外（313 区块）
    const far = new TestClient('FarAway');
    await joinAndWaitWelcome(far, '远处的人', 5000, 70, 5000);

    alice.mailbox.length = 0;
    far.mailbox.length = 0;
    bob.send({ t: 'block', x: 2, y: 70, z: 8, id: 1, state: 0, dimension: 'overworld' });
    check('近处的人收到方块', (await alice.wait('block', 2000)) !== null);
    check('8 区块外的人收不到方块', (await far.wait('block', 700)) === null);

    // 聊天是文字，不受范围限制（否则远处的人就成了聋子）
    far.mailbox.length = 0;
    bob.send({ t: 'chat', text: '远处的也看得到' });
    check('聊天不受关注范围限制', (await far.wait('chat', 2000)) !== null);

    // 维度不同也不收：`far` 换维度不发 move 了，这里用"下界坐标"的方块试
    alice.mailbox.length = 0;
    far.mailbox.length = 0;
    bob.send({ t: 'block', x: 2, y: 70, z: 8, id: 1, state: 0, dimension: 'nether' });
    check('换维度的方块不会发给主世界的人', (await alice.wait('block', 700)) === null);

    far.close();
  }

  // ---------------------------------------------------------------- 箭与 TNT（联机23）
  console.log('\n[箭与 TNT]');
  {
    alice.mailbox.length = 0;
    bob.send({ t: 'arrow', x: 5, y: 71, z: 5, vx: 0, vy: 0, vz: -45, damage: 6 });
    const arrow = await alice.wait('arrow', 2000);
    check(
      '箭被转发（位置 + 速度 + 伤害）',
      arrow?.damage === 6 && arrow?.vz === -45 && arrow?.x === 5,
      JSON.stringify(arrow),
    );

    // 速度上限：手搓一支 500 格/秒 的箭要被丢（一支箭不该飞那么快）
    alice.mailbox.length = 0;
    bob.send({ t: 'arrow', x: 5, y: 71, z: 5, vx: 500, vy: 0, vz: 0, damage: 6 });
    check('超速的箭被拒', (await alice.wait('arrow', 600)) === null);

    alice.mailbox.length = 0;
    bob.send({ t: 'tnt', x: 7, y: 70, z: 7, dimension: 'overworld' });
    const tnt = await alice.wait('tnt', 2000);
    check('TNT 点燃被转发（坐标 + 维度）', tnt?.x === 7 && tnt?.dimension === 'overworld', JSON.stringify(tnt));

    // ⚠️ 用非数字字符串而不是 NaN：`JSON.stringify(NaN)` 会变成 null，
    // 服务端 `Number(null)` 是 0，等于"合法坐标 0"——那样这条会假通过
    alice.mailbox.length = 0;
    bob.send({ t: 'tnt', x: 'abc', y: 70, z: 7, dimension: 'overworld' });
    check('TNT 脏坐标被拒', (await alice.wait('tnt', 600)) === null);
  }

  // ---------------------------------------------------------------- 限频与体积（联机25）
  console.log('\n[限频与体积]');
  {
    // 聊天：每秒 5 条、桶容量 10。灌 30 条，只有一部分被广播
    alice.mailbox.length = 0;
    for (let i = 0; i < 30; i++) bob.send({ t: 'chat', text: `刷屏 ${i}` });
    await sleep(400);
    let chats = 0;
    while (alice.take('chat') !== null) chats++;
    check('聊天刷屏被限（30 条只放行一部分）', chats > 0 && chats < 30, `${chats} 条`);

    /*
     * 方块：桶容量 400，**按条数计费**。用两批 256 格来验证，而不是灌 500 条单条消息——
     * 后者要对 500 条消息做序列化与断言，是这个套件最贵的一段（它已经 16s 了）。
     * 第一批 256 放行；紧接着第二批只剩 ~150 个令牌，不够 256 → 被拒。
     */
    alice.mailbox.length = 0;
    const bigBatch = Array.from({ length: 256 }, () => [5, 70, 5, 1, 0, 'overworld']);
    bob.send({ t: 'blocks', blocks: bigBatch });
    check('第一批 256 格放行（红石连锁的量级）', (await alice.wait('blocks', 2000)) !== null);
    bob.send({ t: 'blocks', blocks: bigBatch });
    check('紧接着的第二批被限（桶里不够 256 个令牌）', (await alice.wait('blocks', 1200)) === null);

    // 超过 maxPayload（64KB）的消息：`ws` 直接以 1009 关连接
    const big = new TestClient('BigSender');
    await joinAndWaitWelcome(big, '大包', 0, 70, 0);
    const closed = new Promise((resolve) => big.socket.once('close', (code) => resolve(code)));
    big.socket.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(80 * 1024) }));
    const code = await Promise.race([closed, sleep(2000).then(() => -1)]);
    check('超过 64KB 的消息直接断连（1009）', code === 1009, `${code}`);
  }

  // ---------------------------------------------------------------- 容器同步（联机15）
  console.log('\n[容器同步]');
  {
    alice.mailbox.length = 0;
    // 服务端不按方块类型限制：熔炉 3 格、漏斗 5 格、箱子 27 格都走同一条 container 消息
    bob.send({
      t: 'container',
      x: 40,
      y: 70,
      z: 40,
      dimension: 'overworld',
      slots: [{ id: 1, count: 2 }, null, null],
    });
    const furnaceMsg = await alice.wait('container', 2000);
    check(
      '熔炉（3 格）的内容被转发',
      Array.isArray(furnaceMsg?.slots) && furnaceMsg.slots.length === 3,
      JSON.stringify(furnaceMsg),
    );
    check('转发里带 by（发送者 id）', typeof furnaceMsg?.by === 'number', `${furnaceMsg?.by}`);

    // 超过 27 格（最大的容器）整条丢：服务端只做形状校验
    alice.mailbox.length = 0;
    bob.send({ t: 'container', x: 41, y: 70, z: 40, dimension: 'overworld', slots: new Array(28).fill(null) });
    check('超过 27 格的容器消息被拒', (await alice.wait('container', 600)) === null);
  }

  // ---------------------------------------------------------------- 牌子 / 展示框（联机16）
  console.log('\n[牌子与展示框]');
  {
    alice.mailbox.length = 0;
    bob.send({ t: 'sign', x: 90, y: 70, z: 90, dimension: 'overworld', lines: ['你好', '世界', '', ''] });
    const signMsg = await alice.wait('sign', 2000);
    check(
      '牌子文字被转发（4 行）',
      Array.isArray(signMsg?.lines) && signMsg.lines.length === 4 && signMsg.lines[0] === '你好',
      JSON.stringify(signMsg),
    );

    // 超过 4 行要截断，不然客户端渲染与存档都会多出一行
    alice.mailbox.length = 0;
    bob.send({ t: 'sign', x: 92, y: 70, z: 90, dimension: 'overworld', lines: ['1', '2', '3', '4', '5'] });
    const clipped = await alice.wait('sign', 2000);
    check('牌子超过 4 行被截断', Array.isArray(clipped?.lines) && clipped.lines.length === 4, JSON.stringify(clipped));

    alice.mailbox.length = 0;
    bob.send({ t: 'frame', x: 91, y: 70, z: 90, dimension: 'overworld', item: { id: 5, count: 1 }, rotation: 2 });
    const frameMsg = await alice.wait('frame', 2000);
    check(
      '展示框内容被转发（含旋转）',
      frameMsg?.item?.id === 5 && frameMsg?.rotation === 2,
      JSON.stringify(frameMsg),
    );

    // 取走东西 = item 为 null（空框），不是少一个字段
    alice.mailbox.length = 0;
    bob.send({ t: 'frame', x: 91, y: 70, z: 90, dimension: 'overworld', item: null, rotation: 0 });
    const emptyFrame = await alice.wait('frame', 2000);
    check('取空展示框用 item=null 表示', emptyFrame?.item === null, JSON.stringify(emptyFrame));
  }

  // ---------------------------------------------------------------- 睡眠跳夜（联机11）
  console.log('\n[睡眠跳夜]');
  {
    alice.mailbox.length = 0;
    // bob 睡满（本项目口径：一个人睡就行，不要求全员躺下）→ 服务端拨到黎明并广播 snap
    bob.send({ t: 'sleep' });

    // 2 秒一次的时间广播也会进来，跳过它们，只找带 snap 的那条
    let snap = null;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const message = alice.take('time');
      if (!message) {
        await sleep(20);
        continue;
      }
      if (message.snap === true) {
        snap = message;
        break;
      }
    }
    check('有人睡满 → 广播跳夜（snap）', snap !== null, JSON.stringify(snap));
    check('跳夜落在黎明（0.12 附近）', Math.abs((snap?.timeOfDay ?? -1) - 0.12) < 0.02, `${snap?.timeOfDay}`);

    // 没 join 就睡：回错误，而不是崩
    const early = new TestClient('EarlySleeper');
    await early.ready();
    early.send({ t: 'sleep' });
    const earlyError = await early.wait('error', 2000);
    check('未 join 就睡被拒', earlyError?.code === 'joined', JSON.stringify(earlyError));
    early.close();
  }

  // ---------------------------------------------------------------- 心跳（联机7）
  check('心跳：客户端收到服务端 ping', await heartbeatSeen);

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

  // ---------------------------------------------------------------- 快照裁剪（联机14）
  console.log('\n[快照裁剪]');
  {
    /*
     * 一条在原点附近、一条在 2000 格外：新玩家只该收到近的那条。
     *
     * ⚠️ 远处那条要**先让发送者走过去**再写——联机24 加的距离闸（64 格）会直接拒收
     * "隔空改方块"，否则这条测到的就不是"裁剪"而是"拒收"了。
     * ⚠️ 用一个**新**客户端发：上面那节已经把 alice/bob 都关了，
     * 对已关闭的 socket `send()` 是静默失败（踩过：断言拿到旧改动、不含新的）。
     */
    const sender = new TestClient('SnapshotSender');
    await joinAndWaitWelcome(sender, '裁剪测试', 0, 70, 0);
    sender.send({ t: 'block', x: 8, y: 70, z: 8, id: 1, state: 0, dimension: 'overworld' });
    await sleep(80);
    sender.send({ t: 'move', x: 2000, y: 70, z: 2000, yaw: 0, pitch: 0, dimension: 'overworld' });
    await sleep(120); // move 有 50ms 限频
    sender.send({ t: 'block', x: 2008, y: 70, z: 2008, id: 1, state: 0, dimension: 'overworld' });
    await sleep(150);

    const newcomer = new TestClient('Newcomer');
    const welcome = await joinAndWaitWelcome(newcomer, '新人', 0, 70, 0);
    const edits = welcome?.edits ?? [];
    check(
      'welcome 带附近改动',
      edits.some((e) => e[0] === 8 && e[2] === 8),
      JSON.stringify(edits.length),
    );
    check(
      'welcome 不带远处改动（按玩家位置裁剪）',
      !edits.some((e) => e[0] === 2008),
      `${edits.length} 条`,
    );
    newcomer.close();
    sender.close();
  }

  // ---------------------------------------------------------------- 重启后快照仍在（联机13）
  console.log('\n[持久化：重启后快照仍在]');
  {
    // 先留一条方块 + 一个容器，然后 SIGTERM（退出流程里会补存一次）
    const before = new TestClient('BeforeRestart');
    const welcomeBefore = await joinAndWaitWelcome(before, '重启前', 0, 70, 0);
    check('重启前的客户端能加入', welcomeBefore !== null);
    before.send({ t: 'block', x: 30, y: 70, z: 30, id: 5, state: 0, dimension: 'overworld' });
    before.send({
      t: 'container',
      x: 31,
      y: 70,
      z: 30,
      dimension: 'overworld',
      slots: [{ id: 3, count: 7 }],
    });
    await sleep(250);
    before.close();

    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    // 等它真的退干净再起——端口还在 TIME_WAIT 时新进程会 EADDRINUSE
    await Promise.race([exited, sleep(2500)]);
    await sleep(200);

    check('重启后服务端能再起来', await startServer(), serverOutput.trim().split('\n').slice(-3).join(' | '));

    const revived = new TestClient('Revived');
    const welcome = await joinAndWaitWelcome(revived, '复活的玩家', 0, 70, 0);
    check('重启后拿到 welcome', welcome !== null);
    check(
      '重启后方块改动还在',
      (welcome?.edits ?? []).some((e) => e[0] === 30 && e[1] === 70 && e[2] === 30),
      JSON.stringify((welcome?.edits ?? []).slice(-3)),
    );
    check(
      '重启后容器内容还在',
      (welcome?.containers ?? []).some((c) => c.x === 31 && c.z === 30),
      JSON.stringify(welcome?.containers),
    );
    revived.close();
  }

  // ---------------------------------------------------------------- 损坏快照回退（联机13）
  console.log('\n[持久化：损坏快照被备份而不是覆盖]');
  {
    // 先让它退干净（退出流程会写一份好快照），再把文件写坏
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, sleep(2500)]);
    writeFileSync(join(DATA_DIR, 'world.json'), '{ 这不是 JSON');
    await sleep(100);

    check('坏快照下服务端仍能起来', await startServer(), serverOutput.trim().split('\n').slice(-3).join(' | '));
    check(
      '坏快照被备份（不是静静删掉）',
      readdirSync(DATA_DIR).some((name) => name.startsWith('world.json.broken-')),
      readdirSync(DATA_DIR).join(','),
    );

    const fresh = new TestClient('Fresh');
    const welcomeFresh = await joinAndWaitWelcome(fresh, '新开局', 0, 70, 0);
    check('坏快照之后从空世界开始', welcomeFresh !== null && (welcomeFresh.edits ?? []).length === 0, `${(welcomeFresh?.edits ?? []).length}`);
    fresh.close();
  }
  // ---------------------------------------------------------------- 房间 / 来源（联机26）
  console.log('\n[房间与来源校验]');
  {
    // 来源：带 Origin 的连接才校验（node 客户端不带 Origin，照常放行——否则这套测试自己就连不上）
    const evil = new TestClient('EvilOrigin', undefined, { origin: 'http://evil.example' });
    const evilError = await evil.wait('error', 3000);
    check('错 origin 被拒', evilError?.code === 'origin', JSON.stringify(evilError));
    evil.close();

    const good = new TestClient('GoodOrigin', undefined, { origin: 'http://good.example' });
    check('白名单里的 origin 正常加入', (await joinAndWaitWelcome(good, '好来源', 0, 70, 0)) !== null);

    // 一房一世界：A 房写的方块，B 房看不到（广播与快照两条路都要挡住）
    const roomA = new TestClient('RoomA', undefined, { room: 'alpha' });
    const welcomeA = await joinAndWaitWelcome(roomA, 'A 房', 0, 70, 0);
    const roomB = new TestClient('RoomB', undefined, { room: 'beta' });
    const welcomeB2 = await joinAndWaitWelcome(roomB, 'B 房', 0, 70, 0);
    check('两个房都能加入', welcomeA !== null && welcomeB2 !== null);

    roomA.send({ t: 'block', x: 3, y: 70, z: 3, id: 1, state: 0, dimension: 'overworld' });
    await sleep(150);
    check('A 房的方块不会发给 B 房', (await roomB.wait('block', 600)) === null);

    const lateA = new TestClient('LateA', undefined, { room: 'alpha' });
    const lateWelcomeA = await joinAndWaitWelcome(lateA, '后进 A 房', 0, 70, 0);
    check(
      'A 房的快照里有自己的方块',
      (lateWelcomeA?.edits ?? []).some((e) => e[0] === 3 && e[2] === 3),
      JSON.stringify(lateWelcomeA?.edits),
    );

    const lateB = new TestClient('LateB', undefined, { room: 'beta' });
    const lateWelcomeB = await joinAndWaitWelcome(lateB, '后进 B 房', 0, 70, 0);
    check(
      'B 房的快照里没有 A 房的方块',
      !(lateWelcomeB?.edits ?? []).some((e) => e[0] === 3 && e[2] === 3),
      JSON.stringify(lateWelcomeB?.edits),
    );

    // 非法房名回默认房间（房名是数据 key 的前缀，不能透传）
    const weirdRoom = new TestClient('WeirdRoom', undefined, { room: '不合法 房名!' });
    check('非法房名回默认房间（不报错）', (await joinAndWaitWelcome(weirdRoom, '怪房名', 0, 70, 0)) !== null);

    for (const client of [good, roomA, roomB, lateA, lateB, weirdRoom]) client.close();
  }

  // ---------------------------------------------------------------- 房间口令（联机26）
  console.log('\n[房间口令]');
  {
    // 这一段要带着口令重启（其他测试都不带密码，不能提前设）
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, sleep(2500)]);
    check('带口令的服务端起来了', await startServer({ ROOM_PASSWORD: 'sesame' }));

    const noPw = new TestClient('NoPw');
    await noPw.ready();
    noPw.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      clientId: noPw.clientId,
      name: '没口令',
      x: 0,
      y: 70,
      z: 0,
      dimension: 'overworld',
    });
    const noPwError = await noPw.wait('error', 3000);
    check('没带口令被拒', noPwError?.code === 'password', JSON.stringify(noPwError));
    noPw.close();

    const withPw = new TestClient('WithPw', undefined, { password: 'sesame' });
    check('带对口令能进', (await joinAndWaitWelcome(withPw, '有口令', 0, 70, 0)) !== null);
    withPw.close();
  }
} finally {
  server?.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n联机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

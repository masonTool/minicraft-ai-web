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
import { get } from 'node:http';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, sanitizeWorldMeta } from '../server/protocol.mjs';

/**
 * 服务端快照目录（联机13）：指到临时目录，**不能**用默认的 `server/.data/`——
 * 否则跑一次测试就把开发者自己房间的存档覆盖了。
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'minicraft-net-'));

/**
 * 端口由系统分配（`PORT=0`），起完再从服务端日志里读回来。
 *
 * ⚠️ 以前写死 8799，理由是"用不常用的端口避免和开发者自己的服务端撞车"。但真正的
 * 撞车方是**另一棵并行工作树**：两边的 `npm test` 同时跑时，先起的那台占住 8799，
 * 后起的那台 `EADDRINUSE` 崩掉（stderr 只有一段 Node 版本号），于是"服务端启动成功"红、
 * 后面一串依赖 welcome 的断言跟着红——重跑又绿。让系统挑端口，这类偶发就彻底没有了。
 */
let PORT = 0;
let passed = 0;
let failed = 0;
/** 每个 TestClient 默认拿一个新身份（8~64 位字母/数字/-/_，见 server/protocol.mjs） */
let clientSeq = 0;

/**
 * 距上一条断言超过 300ms 就把耗时打在行尾。
 *
 * 这个套件的时间几乎全是"等"（起服务端、等 welcome、等广播），总时长看不出是哪一段；
 * 把慢的那几条直接标出来，比事后猜快得多（也解释了为什么它并发时容易撞超时）。
 */
let lastCheckAt = Date.now();
function check(label, ok, detail = '') {
  const now = Date.now();
  const waited = now - lastCheckAt;
  lastCheckAt = now;
  const took = waited >= 300 ? `  (+${waited}ms)` : '';
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${took}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}${took}`);
  }
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET 一个 JSON 端点（L9 的 `/rooms`）；连 `headers` 一起回，好断言 CORS */
function getJson(path) {
  return new Promise((resolve, reject) => {
    get(`http://localhost:${PORT}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

/** 一个测试用客户端：把收到的消息存进 mailbox，便于断言 */
class TestClient {
  /** @param {string} [clientId] 显式传同一个值可以测"重复身份" */
  constructor(name, clientId = `testclient${String(++clientSeq).padStart(2, '0')}`, options = {}) {
    this.name = name;
    this.clientId = clientId;
    /** 房间码 / 口令（联机26）：跟着 join 一起发 */
    this.room = options.room ?? '';
    this.password = options.password ?? '';
    /** 开房（L8）：`join` 里带 host 标记，服务端据此登记这一房的唯一房主 */
    this.host = options.host === true;
    /** 这一局用哪个世界（L9）：只有房主带，种子决定队友那边的地形 */
    this.world = options.world ?? null;
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

/** 停掉子进程并**等它真的退出**（2 秒不退就 SIGKILL） */
function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已经死了
      }
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

console.log('\n[启动服务端]');
/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
let serverOutput = '';

/**
 * 起一个服务端子进程并等它监听端口。
 *
 * 抽成函数是为了"重启后快照仍在"那条用例（联机13）——它要真的杀一次再起一次。
 *
 * 端口交给系统挑（`PORT=0`），再从服务端日志里读回实际值：写死端口时，两棵并行
 * 工作树同时跑 `npm test` 会撞 `EADDRINUSE`，表现为"服务端启动成功"红了、重跑又绿。
 * 每次重启都重新传 `'0'`，不要复用上一次读到的 `PORT`（那台可能还没放开）。
 */
async function startServer(extraEnv = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    serverOutput = '';
    server = spawn('node', ['server/index.mjs'], {
      // GRACE_MS：断线宽限期（联机8）。真实值 30 秒，测试里压到 400ms——否则每条
      // "宽限期过后才清掉落物"的断言都要白等半分钟
      env: {
        ...process.env,
        PORT: '0',
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
    // 等服务端监听端口，并从日志里读出系统分配的端口号
    for (let i = 0; i < 100; i++) {
      await sleep(40);
      const match = serverOutput.match(/已启动，端口 (\d+)/);
      if (match) {
        PORT = Number(match[1]);
        return true;
      }
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
        ...(client.host ? { host: true } : {}),
        ...(client.world ? { world: client.world } : {}),
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
  await sleep(50);
  const moved = await bob.wait('player');
  check('位置更新被广播', moved?.id === 1 && Math.abs(moved.x - 11.5) < 0.001, JSON.stringify(moved));
  check('朝向也一起同步', Math.abs((moved?.yaw ?? 0) - 1.57) < 0.001, `${moved?.yaw}`);

  // 限频：短时间内连发多条 move，只应有一条被转发
  bob.mailbox.length = 0;
  for (let i = 0; i < 10; i++) alice.send({ t: 'move', x: 20 + i, y: 70, z: 0, yaw: 0, pitch: 0 });
  await sleep(60);
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
  // 等 Bob 真的收到这条广播再让 Carol 加入：`await sleep(40)` 也有"服务端还没处理完"
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
  check('生成者自己不会收到回传', (await alice.wait('item-spawn', 250)) === null);

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
  await sleep(50);
  const frank = new TestClient('Frank');
  const welcomeF = await joinAndWaitWelcome(frank, 'Frank', 0, 70, 0);
  check(
    '删不掉别人的掉落物（owner 由服务端填，不信消息里的 id）',
    (welcomeF?.items ?? []).some((i) => i.owner === 1 && i.localId === 8),
    JSON.stringify(welcomeF?.items),
  );
  // 退房提示（联机45）：客户端要靠服务端的 `leave` 广播才知道"谁走了"。
  // 先挂好监听再关连接——关完再 wait 会漏掉（同一个坑在 `time` 那儿记过）。
  const frankLeave = alice.wait('leave', 4000);
  frank.close();
  const frankLeft = await frankLeave;
  check(
    '有人离开时服务端广播 leave，且带离开者的 id',
    frankLeft?.id === welcomeF?.id,
    JSON.stringify({ left: frankLeft, welcomeId: welcomeF?.id }),
  );

  // 脏数据：数量超上限 / 坐标 NaN 都不该进快照
  alice.send({ t: 'item-spawn', localId: 9, itemId: 5, count: 999, x: 1, y: 70, z: 1 });
  alice.send({ t: 'item-spawn', localId: 10, itemId: 5, count: 1, x: 'abc', y: 70, z: 1 });
  await sleep(50);
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
    await sleep(60);

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
      (await bob.wait('chat', 250)) === null,
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
    await sleep(50); // 落在宽限期内（400ms）
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
    await sleep(40); // move 有 50ms 限频
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
    await sleep(40);
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
    check('缺 typeId 的命中被拒', (await alice.wait('mob-hit', 250)) === null);
  }

  // ---------------------------------------------------------------- 拾取仲裁（联机21）
  console.log('\n[拾取仲裁]');
  {
    await sleep(40);
    // 再来一个"别人"：alice 与 rival 抢 bob 生成的那堆，才是真正的并发仲裁。
    // ⚠️ owner 要用**服务端分配的 id**（welcome 里的 `id`），`bob.id` 那个字段不存在、
    // 传 undefined 会被服务端当脏数据静默丢掉（本轮踩过：两边都收不到回包）
    const bobId = Number(welcomeB?.id ?? 0);
    check('拿到 bob 的服务端 id（下面抢的是他名下的堆）', bobId > 0, `${bobId}`);
    const rival = new TestClient('Rival');
    await joinAndWaitWelcome(rival, '抢货的人', 0, 70, 0);
    bob.send({ t: 'item-spawn', localId: 41, itemId: 3, count: 2, x: 40, y: 70, z: 40 });
    await sleep(60);

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
    await sleep(40);
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
    check('攻击者自己不会收到自己发的 player-hit', (await bob.wait('player-hit', 250)) === null);

    // 服务端夹取伤害上限（无鉴权下最省的那道闸）
    alice.mailbox.length = 0;
    bob.send({ t: 'player-hit', targetId: aliceId, damage: 999, team: '' });
    const clampedHit = await alice.wait('player-hit', 2000);
    check('打人伤害被夹到 50', clampedHit?.damage === 50, JSON.stringify(clampedHit));

    // 打自己 / 打不存在的 id：服务端不发（避免自伤死循环与无效包）
    alice.mailbox.length = 0;
    bob.send({ t: 'player-hit', targetId: bobServerId, damage: 4, team: '' });
    bob.send({ t: 'player-hit', targetId: 9999, damage: 4, team: '' });
    check('打自己 / 打不存在的 id 都不发', (await alice.wait('player-hit', 250)) === null);
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
      check(`${label} 被拒`, (await alice.wait('block', 250)) === null);
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
    check('隔空改容器被拒', (await alice.wait('container', 250)) === null);
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
    check('8 区块外的人收不到方块', (await far.wait('block', 250)) === null);

    // 聊天是文字，不受范围限制（否则远处的人就成了聋子）
    far.mailbox.length = 0;
    bob.send({ t: 'chat', text: '远处的也看得到' });
    check('聊天不受关注范围限制', (await far.wait('chat', 2000)) !== null);

    // 维度不同也不收：`far` 换维度不发 move 了，这里用"下界坐标"的方块试
    alice.mailbox.length = 0;
    far.mailbox.length = 0;
    bob.send({ t: 'block', x: 2, y: 70, z: 8, id: 1, state: 0, dimension: 'nether' });
    check('换维度的方块不会发给主世界的人', (await alice.wait('block', 250)) === null);

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
    check('超速的箭被拒', (await alice.wait('arrow', 250)) === null);

    alice.mailbox.length = 0;
    bob.send({ t: 'tnt', x: 7, y: 70, z: 7, dimension: 'overworld' });
    const tnt = await alice.wait('tnt', 2000);
    check('TNT 点燃被转发（坐标 + 维度）', tnt?.x === 7 && tnt?.dimension === 'overworld', JSON.stringify(tnt));

    // ⚠️ 用非数字字符串而不是 NaN：`JSON.stringify(NaN)` 会变成 null，
    // 服务端 `Number(null)` 是 0，等于"合法坐标 0"——那样这条会假通过
    alice.mailbox.length = 0;
    bob.send({ t: 'tnt', x: 'abc', y: 70, z: 7, dimension: 'overworld' });
    check('TNT 脏坐标被拒', (await alice.wait('tnt', 250)) === null);
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
    check('超过 27 格的容器消息被拒', (await alice.wait('container', 250)) === null);
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
    await sleep(40);
    sender.send({ t: 'move', x: 2000, y: 70, z: 2000, yaw: 0, pitch: 0, dimension: 'overworld' });
    await sleep(50); // move 有 50ms 限频
    sender.send({ t: 'block', x: 2008, y: 70, z: 2008, id: 1, state: 0, dimension: 'overworld' });
    await sleep(60);

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
    await sleep(40);

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
    await sleep(60);
    check('A 房的方块不会发给 B 房', (await roomB.wait('block', 250)) === null);

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

  // ---------------------------------------------------------------- 房主（L8）
  console.log('\n[房主：一房一名]');
  {
    const hostA = new TestClient('HostA', undefined, { room: 'hostroom', host: true });
    const welcomeHost = await joinAndWaitWelcome(hostA, '房主 A', 0, 70, 0);
    check('带 host 的 join 能开房', welcomeHost !== null);
    // welcome 里下发房主身份（L8）：客户端据此决定跑不跑模拟，不自己猜
    check('房主的 welcome 带 isHost=true', welcomeHost?.isHost === true, `${welcomeHost?.isHost}`);
    check('房主的 welcome 里 hostId 指向自己', welcomeHost?.hostId === welcomeHost?.id, `${welcomeHost?.hostId} vs ${welcomeHost?.id}`);

    const follower = new TestClient('Follower', undefined, { room: 'hostroom' });
    const welcomeFollower = await joinAndWaitWelcome(follower, '跟随者', 0, 70, 0);
    check('同房不带 host 的能进（当从属端）', welcomeFollower !== null);
    check('从属端的 welcome 带 isHost=false', welcomeFollower?.isHost === false, `${welcomeFollower?.isHost}`);
    check(
      '从属端的 welcome 指向房主（hostId = 房主 id）',
      welcomeFollower?.hostId === welcomeHost?.id,
      `${welcomeFollower?.hostId} vs ${welcomeHost?.id}`,
    );

    // 没房主的房：hostId 为 null（客户端据此知道这一局没人跑模拟，而不是默默当成自己在跑）
    const noHostRoom = new TestClient('NoHostRoom', undefined, { room: 'nohostroom' });
    const welcomeNoHost = await joinAndWaitWelcome(noHostRoom, '没房主', 0, 70, 0);
    check('没房主的房：isHost=false 且 hostId=null', welcomeNoHost?.isHost === false && welcomeNoHost?.hostId === null, JSON.stringify({ isHost: welcomeNoHost?.isHost, hostId: welcomeNoHost?.hostId }));
    noHostRoom.close();

    // 第二个房主：明确拒绝，并且**断开**——留在房里当"半个房主"比拒连更难查
    const hostB = new TestClient('HostB', undefined, { room: 'hostroom' });
    await hostB.ready();
    hostB.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      clientId: hostB.clientId,
      name: '抢房主',
      x: 0,
      y: 70,
      z: 0,
      dimension: 'overworld',
      room: 'hostroom',
      host: true,
    });
    const hostTaken = await hostB.wait('error', 3000);
    check('第二个房主被拒（error.code = host-taken）', hostTaken?.code === 'host-taken', JSON.stringify(hostTaken));
    check('被拒后连接关闭', await hostB.waitClosed());

    // 房主位按房名隔离：另一个房名照常开
    const otherHost = new TestClient('OtherHost', undefined, { room: 'hostroom2', host: true });
    check('别的房名仍可开房（登记按房隔离）', (await joinAndWaitWelcome(otherHost, '别房房主', 0, 70, 0)) !== null);

    // 房主断线 → 宽限期（测试里 400ms）过完才让出房主位，下一个人才能重新开房
    hostA.close();
    await sleep(900);
    const hostC = new TestClient('HostC', undefined, { room: 'hostroom', host: true });
    check('原房主宽限期过后房主位释放（可重新开房）', (await joinAndWaitWelcome(hostC, '新房主', 0, 70, 0)) !== null);

    for (const client of [follower, otherHost, hostC]) client.close();
  }

  // ---------------------------------------------------------------- 房间的世界（L9）
  console.log('\n[房间的世界：地形由房主那个世界决定（L9）]');
  {
    // 房主带世界 → welcome 下发的种子就是它（不再是全服一个常量）
    const worldHost = new TestClient('WorldHost', undefined, {
      room: 'worldroom',
      host: true,
      world: { name: '草原小屋', seed: 424242, mode: 'survival', difficulty: 'hard' },
    });
    const welcomeWorldHost = await joinAndWaitWelcome(worldHost, '世界房主', 0, 70, 0);
    check(
      '房主带世界开房：welcome.world.seed = 上报的种子',
      welcomeWorldHost?.world?.seed === 424242,
      JSON.stringify(welcomeWorldHost?.world),
    );
    check('房主带世界开房：老字段 seed 也是同一份', welcomeWorldHost?.seed === 424242, `${welcomeWorldHost?.seed}`);
    check(
      '房主带世界开房：世界名/模式随欢迎包下发',
      welcomeWorldHost?.world?.name === '草原小屋' && welcomeWorldHost?.world?.mode === 'survival',
      JSON.stringify(welcomeWorldHost?.world),
    );

    // 从属端：自己带的世界不生效，跟着房主走（否则两个人会各自生成一片大陆）
    const worldFollower = new TestClient('WorldFollower', undefined, {
      room: 'worldroom',
      world: { name: '我自己的世界', seed: 999 },
    });
    const welcomeWorldFollower = await joinAndWaitWelcome(worldFollower, '世界从属', 0, 70, 0);
    check(
      '从属端跟着房主的种子（自己带的不算）',
      welcomeWorldFollower?.seed === 424242 && welcomeWorldFollower?.world?.seed === 424242,
      JSON.stringify(welcomeWorldFollower?.world),
    );
    check('从属端的世界名也是房主的', welcomeWorldFollower?.world?.name === '草原小屋', JSON.stringify(welcomeWorldFollower?.world));

    // 没房主的房：退回服务端默认种子（"单机直连服务器"的老行为不能断）
    const plainRoom = new TestClient('PlainRoom', undefined, { room: 'plainroom' });
    const welcomePlain = await joinAndWaitWelcome(plainRoom, '普通房', 0, 70, 0);
    check('没房主的房退回服务端默认种子', welcomePlain?.seed === 20261014, `${welcomePlain?.seed}`);

    // 脏世界：种子不是整数 → 整份丢弃、保留默认（不能把 NaN 当种子发给所有人）
    const badWorldHost = new TestClient('BadWorldHost', undefined, {
      room: 'badworld',
      host: true,
      world: { name: '<b>坏种子', seed: 'abc' },
    });
    const welcomeBad = await joinAndWaitWelcome(badWorldHost, '坏世界房主', 0, 70, 0);
    check('房主上报脏种子：退回默认种子', welcomeBad?.seed === 20261014, `${welcomeBad?.seed}`);

    // `/rooms`（L9）：客户端的"加入房间"面板靠它自动列出房间，不必手敲房名
    const listing = await getJson('/rooms');
    const worldEntry = (listing.json?.rooms ?? []).find((entry) => entry.room === 'worldroom');
    check(
      '/rooms 列出有人的房间（人数 + 房主标记）',
      worldEntry?.players === 2 && worldEntry?.hasHost === true,
      JSON.stringify(worldEntry),
    );
    check(
      '/rooms 带世界名与种子（加入前就知道是哪片大陆）',
      worldEntry?.world?.seed === 424242 && worldEntry?.world?.name === '草原小屋',
      JSON.stringify(worldEntry?.world),
    );
    check(
      '/rooms 不下发口令（只说服务端要不要口令）',
      worldEntry !== undefined && !('password' in worldEntry) && listing.json?.passwordRequired === false,
      JSON.stringify(listing.json),
    );
    check(
      '/rooms 带 CORS（浏览器从 5173 跨源读得到）',
      listing.headers?.['access-control-allow-origin'] === '*',
      `${listing.headers?.['access-control-allow-origin']}`,
    );
    const healthz = await getJson('/healthz');
    check('/healthz 仍然可用（没被新路由挡掉）', healthz.json?.ok === true && healthz.status === 200);

    // 收口函数本身：名字超长截断、控制字符与尖括号清掉
    const meta = sanitizeWorldMeta({ name: '<草原>\u0007' + '长'.repeat(40), seed: 7, mode: 'creative' });
    check(
      'sanitizeWorldMeta 清字符并截到 32 字',
      meta?.name === '草原' + '长'.repeat(30) && meta?.seed === 7,
      JSON.stringify(meta?.name),
    );
    check(
      'sanitizeWorldMeta 拒绝非整数种子 / 非对象',
      sanitizeWorldMeta({ seed: 1.5 }) === null && sanitizeWorldMeta(null) === null,
    );

    for (const client of [worldHost, worldFollower, plainRoom, badWorldHost]) client.close();
  }

  // ---------------------------------------------------------------- 昵称唯一（本轮）
  console.log('\n[房间内昵称唯一]');
  {
    const nameHost = new TestClient('NameHost', undefined, { room: 'nameroom', host: true });
    await joinAndWaitWelcome(nameHost, '同名', 0, 70, 0);

    const sameName = new TestClient('SameName', undefined, { room: 'nameroom' });
    await sameName.ready();
    sameName.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      clientId: sameName.clientId,
      name: '同名',
      x: 0,
      y: 70,
      z: 0,
      dimension: 'overworld',
      room: 'nameroom',
    });
    const duplicateName = await sameName.wait('error', 3000);
    check(
      '同房重名被拒（error.code = duplicate-name）',
      duplicateName?.code === 'duplicate-name',
      JSON.stringify(duplicateName),
    );
    check('重名被拒后连接关闭', await sameName.waitClosed());

    // 只按房判重：另一个房间的同名玩家照常能进
    const otherRoomSameName = new TestClient('OtherRoomSameName', undefined, { room: 'nameroom2' });
    check(
      '不同房间的同名玩家可以进（只按房判重）',
      (await joinAndWaitWelcome(otherRoomSameName, '同名', 0, 70, 0)) !== null,
    );

    // 房主侧也要拦（条目要求"房主与从属各一次"）：nameroom2 里已有一个叫「同名」的从属，
    // 新来的自称房主、名字也重复 —— 同样必须拒。不拦的话，房主能顶掉别人已经挂出去的名字牌。
    const hostDuplicate = new TestClient('HostDuplicate', undefined, { room: 'nameroom2' });
    await hostDuplicate.ready();
    hostDuplicate.send({
      t: 'join',
      v: PROTOCOL_VERSION,
      clientId: hostDuplicate.clientId,
      name: '同名',
      x: 0,
      y: 70,
      z: 0,
      dimension: 'overworld',
      room: 'nameroom2',
      host: true,
    });
    const hostDupErr = await hostDuplicate.wait('error', 3000);
    check(
      '房主重名同样被拒（error.code = duplicate-name）',
      hostDupErr?.code === 'duplicate-name',
      JSON.stringify(hostDupErr),
    );

    nameHost.close();
    otherRoomSameName.close();
  }

  // ---------------------------------------------------------------- 外观转发（本轮）
  console.log('\n[玩家外观（皮肤）随 move 转发]');
  {
    const lookHost = new TestClient('LookHost', undefined, { room: 'lookroom', host: true });
    const lookFollower = new TestClient('LookFollower', undefined, { room: 'lookroom' });
    await joinAndWaitWelcome(lookHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(lookFollower, '队友', 2, 70, 2);

    const look = [1, 2, 3, 4, 5, 2, 1, 3, 1, 2];
    // move 有 50ms 节流：先让窗口过去再发
    await sleep(80);
    lookFollower.mailbox.length = 0;
    lookHost.mailbox.length = 0;
    lookFollower.send({ t: 'move', x: 2, y: 70, z: 2, yaw: 0, pitch: 0, dimension: 'overworld', look });
    const seen = await lookHost.wait('player', 2000);
    check(
      'move.look 原样转发给同房其他人',
      JSON.stringify(seen?.look) === JSON.stringify(look),
      JSON.stringify(seen?.look),
    );

    // 形状收口：长度不够的直接不下发（客户端回退昵称派生），不能把任意结构透传
    await sleep(80);
    lookHost.mailbox.length = 0;
    lookFollower.send({ t: 'move', x: 2, y: 70, z: 2, yaw: 0, pitch: 0, dimension: 'overworld', look: [1, 2, 3] });
    const short = await lookHost.wait('player', 1500);
    check('长度不足的 look 不下发', short?.look === undefined, JSON.stringify(short?.look));

    lookHost.close();
    lookFollower.close();
  }

  // ---------------------------------------------------------------- 方块权威标记（MS2）
  console.log('\n[方块权威标记：谁算的]');
  {
    const authHost = new TestClient('AuthHost', undefined, { room: 'authroom', host: true });
    const authFollower = new TestClient('AuthFollower', undefined, { room: 'authroom' });
    await joinAndWaitWelcome(authHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(authFollower, '从属', 4, 70, 4);

    // 房主算出来的改动 → 下行带 authority: true（从属端据此知道"这是权威结果"）
    authFollower.mailbox.length = 0;
    authHost.send({ t: 'blocks', blocks: [[40, 70, 40, 1, 0, 'overworld']] });
    const fromHost = await authFollower.wait('blocks', 2000);
    check('房主的方块广播带 authority: true', fromHost?.authority === true, JSON.stringify(fromHost));

    /*
     * 从属端直接发 `blocks` / `block`：**一律被丢**（MS2 起从属端走 `edit-request`）。
     * 连同"谎报 authority: true"一起验——服务端按 isHost 判，不看客户端字段。
     */
    authHost.mailbox.length = 0;
    authFollower.send({ t: 'blocks', blocks: [[41, 70, 40, 1, 0, 'overworld']] });
    check('从属端直接发 blocks 被丢弃', (await authHost.wait('blocks', 600)) === null);

    authHost.mailbox.length = 0;
    authFollower.send({ t: 'blocks', authority: true, blocks: [[42, 70, 40, 1, 0, 'overworld']] });
    check('从属端谎报 authority 也没用（照样丢）', (await authHost.wait('blocks', 600)) === null);

    authHost.mailbox.length = 0;
    authFollower.send({ t: 'block', x: 43, y: 70, z: 40, id: 1, state: 0, dimension: 'overworld' });
    check('从属端单条 block 同样被丢弃', (await authHost.wait('block', 600)) === null);

    authHost.close();
    authFollower.close();
  }

  // ---------------------------------------------------------------- 房主代发的远处改动（本轮修复）
  console.log('\n[房主代发的远处改动不被距离闸丢弃]');
  {
    const farHost = new TestClient('FarHost', undefined, { room: 'farroom', host: true });
    const farFollower = new TestClient('FarFollower', undefined, { room: 'farroom' });
    await joinAndWaitWelcome(farHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(farFollower, '远处的从属', 500, 70, 500);

    /*
     * 房主在 (0,0)，代发从属端在 (500,500) 那一格的落地结果。
     * 以前服务端拿**房主自己的坐标**量距离（64 格闸）→ 判 `distance` 静默丢掉，
     * 表现是"从属端改了方块，房主和其他人都看不到"。
     */
    farFollower.mailbox.length = 0;
    farHost.send({ t: 'blocks', blocks: [[500, 70, 500, 1, 0, 'overworld']] });
    const farBroadcast = await farFollower.wait('blocks', 2000);
    check(
      '房主代发远处改动：从属端收得到（不再被判 distance）',
      Array.isArray(farBroadcast?.blocks) && farBroadcast?.authority === true,
      JSON.stringify(farBroadcast),
    );

    /*
     * 反向确认：闸本身还在。**没房主**的房里没人代发，远处改动仍然要被挡掉，
     * 否则"任何客户端都能隔空改主城"这条老问题会跟着一起回来。
     */
    const soloRoom = new TestClient('SoloRoom', undefined, { room: 'soloroom' });
    const soloOther = new TestClient('SoloOther', undefined, { room: 'soloroom' });
    await joinAndWaitWelcome(soloRoom, '甲', 0, 70, 0);
    await joinAndWaitWelcome(soloOther, '乙', 0, 70, 0);
    soloOther.mailbox.length = 0;
    soloRoom.send({ t: 'blocks', blocks: [[500, 70, 500, 1, 0, 'overworld']] });
    check('没房主的房里：远处改动仍被距离闸丢掉', (await soloOther.wait('blocks', 800)) === null);

    for (const client of [soloRoom, soloOther, farHost, farFollower]) client.close();
  }

  // ---------------------------------------------------------------- 改动请求（L8 · MS2）
  console.log('\n[从属端的改动请求转给房主]');
  {
    const reqHost = new TestClient('ReqHost', undefined, { room: 'reqroom', host: true });
    const reqFollower = new TestClient('ReqFollower', undefined, { room: 'reqroom' });
    const welcomeReqHost = await joinAndWaitWelcome(reqHost, '房主', 0, 70, 0);
    const welcomeReqFollower = await joinAndWaitWelcome(reqFollower, '从属', 4, 70, 4);

    // 从属端请求改一格 → 只有房主收到，且带 from 与 payload
    reqHost.mailbox.length = 0;
    reqFollower.send({
      t: 'edit-request',
      payload: { t: 'blocks', blocks: [[50, 70, 50, 1, 0, 'overworld']] },
    });
    const forwarded = await reqHost.wait('edit-request', 2000);
    check('房主收到从属端的改动请求', Array.isArray(forwarded?.payload?.blocks), JSON.stringify(forwarded));
    check('请求带 from（谁点的）', forwarded?.from === welcomeReqFollower?.id, `${forwarded?.from} vs ${welcomeReqFollower?.id}`);
    check('payload 原样转发（坐标/方块/维度不变）', JSON.stringify(forwarded?.payload?.blocks?.[0]) === JSON.stringify([50, 70, 50, 1, 0, 'overworld']));

    // 不认识的载荷：服务端不转（房主那边不该被塞垃圾）
    reqHost.mailbox.length = 0;
    reqFollower.send({ t: 'edit-request', payload: { t: 'nonsense' } });
    const junk = await reqHost.wait('edit-request', 600);
    check('不认识的载荷被丢弃（房主收不到）', junk === null, JSON.stringify(junk));

    // 房里没有房主：明确回执，别让从属端以为"发出去了"
    const noHostFollower = new TestClient('NoHostFollower', undefined, { room: 'nohostreq' });
    await joinAndWaitWelcome(noHostFollower, '没房主', 0, 70, 0);
    noHostFollower.mailbox.length = 0;
    noHostFollower.send({ t: 'edit-request', payload: { t: 'blocks', blocks: [[51, 70, 50, 1, 0, 'overworld']] } });
    const rejected = await noHostFollower.wait('edit-request', 2000);
    check('没房主时回执 no-host', rejected?.ok === false && rejected?.reason === 'no-host', JSON.stringify(rejected));

    // 有房主的房里：从属端走老的 `blocks` 直接被丢（改动只能走 edit-request）
    reqHost.mailbox.length = 0;
    reqFollower.send({ t: 'blocks', blocks: [[52, 70, 50, 1, 0, 'overworld']] });
    check('从属端直接发 blocks 被丢弃（房主收不到）', (await reqHost.wait('blocks', 600)) === null);
    reqHost.mailbox.length = 0;
    reqFollower.send({ t: 'block', x: 53, y: 70, z: 50, id: 1, state: 0, dimension: 'overworld' });
    check('从属端直接发 block 也被丢弃', (await reqHost.wait('block', 600)) === null);

    // 房主自己发的照旧（它是权威结果）
    reqFollower.mailbox.length = 0;
    reqHost.send({ t: 'blocks', blocks: [[20, 70, 20, 1, 0, 'overworld']] });
    const fromHostStillWorks = await reqFollower.wait('blocks', 2000);
    check('房主自己发的 blocks 仍被广播', fromHostStillWorks?.authority === true, JSON.stringify(fromHostStillWorks));

    /*
     * 四条"坐标类"请求（L8 · MS4 收尾）：容器 / 牌子 / 展示框 / TNT 也走 edit-request，
     * 服务端只转给房主；直发（老路）在有房主的房里一律被丢。
     */
    const payloads = [
      ['container', { t: 'container', x: 60, y: 70, z: 60, dimension: 'overworld', slots: [null, null, null] }],
      ['sign', { t: 'sign', x: 61, y: 70, z: 60, dimension: 'overworld', lines: ['你好', '', '', ''] }],
      ['frame', { t: 'frame', x: 62, y: 70, z: 60, dimension: 'overworld', item: { id: 1, count: 1 }, rotation: 0 }],
      ['tnt', { t: 'tnt', x: 63, y: 70, z: 60, dimension: 'overworld' }],
    ];
    for (const [label, payload] of payloads) {
      reqHost.mailbox.length = 0;
      reqFollower.send({ t: 'edit-request', payload });
      const forwardedKind = await reqHost.wait('edit-request', 2000);
      check(`${label} 请求被转给房主`, forwardedKind?.payload?.t === label, JSON.stringify(forwardedKind));
    }
    // 直发老路：房主收不到（有房主的房只收房主的坐标类消息）
    for (const [label, payload] of payloads) {
      reqHost.mailbox.length = 0;
      reqFollower.send(payload);
      check(`${label} 直发被丢弃（改走请求通道）`, (await reqHost.wait(label, 600)) === null);
    }

    reqHost.close();
    reqFollower.close();
    noHostFollower.close();
  }

  // ---------------------------------------------------------------- 实体快照（L8 · MS3）
  console.log('\n[实体快照只由房主推、按房转发]');
  {
    const snapHost = new TestClient('SnapHost', undefined, { room: 'snaproom', host: true });
    const snapFollower = new TestClient('SnapFollower', undefined, { room: 'snaproom' });
    const welcomeSnapHost = await joinAndWaitWelcome(snapHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(snapFollower, '从属', 4, 70, 4);

    snapFollower.mailbox.length = 0;
    snapHost.send({
      t: 'entity-snap',
      entities: [
        ['1:7', 'zombie', 10, 70, 10, 0.5, 18, 2],
        ['1:8', 'cow', 12, 70, 12, 0, 10, 0],
      ],
    });
    const snap = await snapFollower.wait('entity-snap', 2000);
    check('从属端收到房主的实体快照', Array.isArray(snap?.entities) && snap.entities.length === 2, JSON.stringify(snap));
    check('快照带 by（哪个房主推的）', snap?.by === welcomeSnapHost?.id, `${snap?.by} vs ${welcomeSnapHost?.id}`);

    // 从属端推的快照一律不转（谁模拟谁是权威）
    snapHost.mailbox.length = 0;
    snapFollower.send({ t: 'entity-snap', entities: [['2:1', 'zombie', 0, 70, 0, 0, 20, 0]] });
    check('从属端推的实体快照被丢弃', (await snapHost.wait('entity-snap', 600)) === null);

    // 形状不对 / 空数组：不转（省得从属端收到一堆没用的包）
    snapFollower.mailbox.length = 0;
    snapHost.send({ t: 'entity-snap', entities: [] });
    snapHost.send({ t: 'entity-snap', entities: 'nope' });
    check('空数组/非数组不转发', (await snapFollower.wait('entity-snap', 600)) === null);

    // 超上限截断（不整包拒绝）
    snapFollower.mailbox.length = 0;
    const huge = Array.from({ length: 400 }, (_unused, index) => [`1:${index}`, 'zombie', 1, 70, 1, 0, 20, 0]);
    snapHost.send({ t: 'entity-snap', entities: huge });
    const truncated = await snapFollower.wait('entity-snap', 2000);
    check('超过 256 条的实体快照被截断', Array.isArray(truncated?.entities) && truncated.entities.length === 256, `${truncated?.entities?.length}`);

    // 死亡/消失（MS3）：房主点名 → 从属端收到；从属端点名不被转发
    snapFollower.mailbox.length = 0;
    snapHost.send({ t: 'entity-remove', keys: ['1:7', '1:8'] });
    const removed = await snapFollower.wait('entity-remove', 2000);
    check('从属端收到实体消失', Array.isArray(removed?.keys) && removed.keys.length === 2, JSON.stringify(removed));

    snapHost.mailbox.length = 0;
    snapFollower.send({ t: 'entity-remove', keys: ['2:1'] });
    check('从属端点名的实体消失被丢弃', (await snapHost.wait('entity-remove', 600)) === null);

    snapFollower.mailbox.length = 0;
    snapHost.send({ t: 'entity-remove', keys: [] });
    snapHost.send({ t: 'entity-remove', keys: 'nope' });
    check('空/非法键列表不转发', (await snapFollower.wait('entity-remove', 600)) === null);

    snapHost.close();
    snapFollower.close();
  }

  // ---------------------------------------------------------------- 容器进度（L8 · MS4）
  console.log('\n[容器进度只认房主]');
  {
    const cookHost = new TestClient('CookHost', undefined, { room: 'cookroom', host: true });
    const cookFollower = new TestClient('CookFollower', undefined, { room: 'cookroom' });
    await joinAndWaitWelcome(cookHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(cookFollower, '从属', 4, 70, 4);

    cookFollower.mailbox.length = 0;
    cookHost.send({
      t: 'container',
      x: 10,
      y: 70,
      z: 10,
      dimension: 'overworld',
      slots: [{ id: 1, count: 1 }, null, null],
      progress: 0.5,
    });
    const withProgress = await cookFollower.wait('container', 2000);
    check('房主的容器进度被转发', withProgress?.progress === 0.5, JSON.stringify(withProgress));

    /*
     * 从属端的容器改动：MS4 收尾之后**整条直发都被丢**（改走 `edit-request`，由房主落地）。
     * 所以这里断言的是"房主收不到直发的 container"，而不是"收到了但进度没了"。
     */
    cookHost.mailbox.length = 0;
    cookFollower.send({
      t: 'container',
      x: 11,
      y: 70,
      z: 10,
      dimension: 'overworld',
      slots: [{ id: 1, count: 1 }, null, null],
      progress: 0.9,
    });
    check('从属端直发 container 被丢弃（改走请求通道）', (await cookHost.wait('container', 600)) === null);

    // 越界的进度夹到 [0,1]：进度条不该被一个 1.7 拉出框
    cookFollower.mailbox.length = 0;
    cookHost.send({ t: 'container', x: 12, y: 70, z: 10, dimension: 'overworld', slots: [null, null, null], progress: 1.7 });
    const clamped = await cookFollower.wait('container', 2000);
    check('房主的越界进度被夹到 1', clamped?.progress === 1, JSON.stringify(clamped));

    cookHost.close();
    cookFollower.close();
  }

  // ---------------------------------------------------------------- 房主退出（L8 · MS4）
  console.log('\n[房主掉线：先提示、宽限到期关房]');
  {
    // 宽限期在测试里是 400ms（见 spawn 的 GRACE_MS）：正好够验"先提示、后关房"
    const leaveHost = new TestClient('LeaveHost', undefined, { room: 'leaveroom', host: true });
    const leaveFollower = new TestClient('LeaveFollower', undefined, { room: 'leaveroom' });
    await joinAndWaitWelcome(leaveHost, '房主', 0, 70, 0);
    await joinAndWaitWelcome(leaveFollower, '从属', 4, 70, 4);

    leaveFollower.mailbox.length = 0;
    leaveHost.close();
    const closing = await leaveFollower.wait('room-closed', 2000);
    check('房主一掉线就通知同房其他人', closing?.reason === 'host-left', JSON.stringify(closing));
    check('通知里带重连宽限（客户端据此告诉玩家等多久）', typeof closing?.graceMs === 'number' && closing.graceMs > 0, `${closing?.graceMs}`);

    // 到期没回来：房间关闭 + 明确理由（客户端据此不再重连）
    const bye = await leaveFollower.wait('error', 3000);
    check('宽限到期房间关闭并给出 host-left', bye?.code === 'host-left', JSON.stringify(bye));
    leaveFollower.close();
  }

  // ---------------------------------------------------------------- 命中带全局键（L8 · MS3 收尾）
  console.log('\n[命中带全局键：按身份认那只怪]');
  {
    // 用独立的一对客户端：alice/bob 在更早的重启用例里已经断了
    const hitSender = new TestClient('HitSender', undefined, { room: 'hitroom' });
    const hitReceiver = new TestClient('HitReceiver', undefined, { room: 'hitroom' });
    await joinAndWaitWelcome(hitSender, '打人的', 0, 70, 0);
    await joinAndWaitWelcome(hitReceiver, '被打的', 2, 70, 2);

    hitReceiver.mailbox.length = 0;
    hitSender.send({
      t: 'mob-hit',
      typeId: 'zombie',
      dimension: 'overworld',
      x: 5,
      y: 70,
      z: 5,
      damage: 4,
      fire: 0,
      key: '7:12',
    });
    const hitMsg = await hitReceiver.wait('mob-hit', 2000);
    check('命中里的全局键被转发', hitMsg?.key === '7:12', JSON.stringify(hitMsg));
    check('老字段（类型/坐标/伤害）照旧', hitMsg?.typeId === 'zombie' && hitMsg?.damage === 4, JSON.stringify(hitMsg));

    hitReceiver.mailbox.length = 0;
    hitSender.send({ t: 'mob-hit', typeId: 'zombie', dimension: 'overworld', x: 5, y: 70, z: 5, damage: 4, fire: 0 });
    const noKey = await hitReceiver.wait('mob-hit', 2000);
    check('不带键时不塞空 key（老客户端兼容）', noKey !== null && noKey.key === undefined, JSON.stringify(noKey));

    hitReceiver.mailbox.length = 0;
    hitSender.send({
      t: 'mob-hit',
      typeId: 'zombie',
      dimension: 'overworld',
      x: 5,
      y: 70,
      z: 5,
      damage: 4,
      fire: 0,
      key: 'x'.repeat(80),
    });
    const longKey = await hitReceiver.wait('mob-hit', 2000);
    check('超长键被截到 32', typeof longKey?.key === 'string' && longKey.key.length === 32, `${longKey?.key?.length}`);

    hitSender.close();
    hitReceiver.close();
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
  // 等它真的退出再走，否则下一次跑的 spawn 会撞上还没释放的端口
  await stopServer(server);
}

console.log(`\n联机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

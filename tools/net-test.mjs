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
  constructor(name, clientId = `testclient${String(++clientSeq).padStart(2, '0')}`) {
    this.name = name;
    this.clientId = clientId;
    this.mailbox = [];
    this.socket = new WebSocket(`ws://localhost:${PORT}`);
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
/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
let serverOutput = '';

/**
 * 起一个服务端子进程并等它监听端口。
 *
 * 抽成函数是为了"重启后快照仍在"那条用例（联机13）——它要真的杀一次再起一次。
 */
async function startServer() {
  serverOutput = '';
  server = spawn('node', ['server/index.mjs'], {
    // GRACE_MS：断线宽限期（联机8）。真实值 30 秒，测试里压到 400ms——否则每条
    // "宽限期过后才清掉落物"的断言都要白等半分钟
    env: { ...process.env, PORT: String(PORT), GRACE_MS: '400', DATA_DIR },
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
    if (server.exitCode !== null) return false;
  }
  return false;
}

check('服务端启动成功', await startServer(), serverOutput.trim().split('\n').slice(-3).join(' | '));

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
      client.send({ t: 'join', v: PROTOCOL_VERSION, clientId: client.clientId, name, x, y, z, dimension });
      const welcome = await client.wait('welcome', attempt === 0 ? 2500 : 4000);
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
        [100, 70, 100, 1, 0, 'overworld'],
        [101, 70, 100, 2, 3, 'overworld'],
      ],
    });
    const batch = await alice.wait('blocks', 2000);
    check('一批方块被整体转发', Array.isArray(batch?.blocks) && batch.blocks.length === 2, JSON.stringify(batch));

    // 脏条目逐条丢：坐标非数字那条不能进 edits，也不能被转发
    alice.mailbox.length = 0;
    bob.send({
      t: 'blocks',
      blocks: [
        [102, 70, 100, 1, 0, 'overworld'],
        ['x', 70, 100, 1, 0, 'overworld'],
      ],
    });
    const filtered = await alice.wait('blocks', 2000);
    check('批量里的非法条目被丢掉', filtered?.blocks?.length === 1, JSON.stringify(filtered));
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
    // 一条在原点附近、一条在 5000 格外：新玩家只该收到近的那条。
    // ⚠️ 用一个**新**客户端发：上面那节已经把 alice/bob 都关了，
    // 对已关闭的 socket `send()` 是静默失败（本轮踩过：断言拿到 5 条旧改动、不含新的）
    const sender = new TestClient('SnapshotSender');
    await joinAndWaitWelcome(sender, '裁剪测试', 0, 70, 0);
    sender.send({ t: 'block', x: 8, y: 70, z: 8, id: 1, state: 0, dimension: 'overworld' });
    sender.send({ t: 'block', x: 5000, y: 70, z: 5000, id: 1, state: 0, dimension: 'overworld' });
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
      !edits.some((e) => e[0] === 5000),
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
    before.send({ t: 'block', x: 60, y: 70, z: 60, id: 5, state: 0, dimension: 'overworld' });
    before.send({
      t: 'container',
      x: 61,
      y: 70,
      z: 60,
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
      (welcome?.edits ?? []).some((e) => e[0] === 60 && e[1] === 70 && e[2] === 60),
      JSON.stringify((welcome?.edits ?? []).slice(-3)),
    );
    check(
      '重启后容器内容还在',
      (welcome?.containers ?? []).some((c) => c.x === 61 && c.z === 60),
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
} finally {
  server?.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n联机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

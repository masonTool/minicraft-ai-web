/**
 * Rust 服务端冒烟（第一阶段）
 *
 * 不替代 `tools/net-test.mjs`（1871 行黑盒断言，最终验收还得靠它），只用来在
 * "刚写完、还没跑全量"时快速确认核心链路通不通：join / welcome / move / blocks /
 * edit-request / 重名 / room-config / leave。
 *
 * 用 Node 23 内置的全局 `WebSocket`（不依赖 `ws`），所以在新工作树里不用先 `npm ci`。
 *
 * 运行：`bash run-smoke.sh`（会把服务器起在 25199、跑完自动 kill）
 */

const URL = process.env.URL ?? 'ws://127.0.0.1:8887';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let seq = 0;

/** 一个测试用客户端：收到的消息进 inbox，`wait(type)` 按类型取第一条 */
function connect(name, options = {}) {
  const clientId = options.clientId ?? `smoke${String(++seq).padStart(4, '0')}`;
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.addEventListener('message', (event) => {
    try {
      inbox.push(JSON.parse(event.data));
    } catch {
      inbox.push({ t: 'bad-json', raw: event.data });
    }
  });
  const client = {
    name,
    clientId,
    ws,
    inbox,
    ready: new Promise((resolve) => ws.addEventListener('open', () => resolve(true))),
    async wait(type, ms = 2000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const index = inbox.findIndex((message) => message.t === type);
        if (index >= 0) return inbox.splice(index, 1)[0];
        await sleep(10);
      }
      return null;
    },
    send(value) {
      ws.send(JSON.stringify(value));
    },
    join(x, y, z, extra = {}) {
      return client.send({
        t: 'join',
        v: 2,
        clientId,
        name,
        x,
        y,
        z,
        dimension: 'overworld',
        ...extra,
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* 已经断了 */
      }
    },
  };
  return client;
}

const host = connect('房主', { clientId: 'smokehost0001' });
await host.ready;
host.join(0, 70, 0, { room: 'smoke', host: true });
const hostWelcome = await host.wait('welcome', 3000);
check('房主 join 收到 welcome', hostWelcome !== null, JSON.stringify(hostWelcome));
check('welcome 带 isHost=true', hostWelcome?.isHost === true);
check('welcome 的 hostId 指向自己', hostWelcome?.hostId === hostWelcome?.id);
check('welcome 带种子', typeof hostWelcome?.seed === 'number');
check('welcome 带 timeOfDay / weather', typeof hostWelcome?.timeOfDay === 'number' && typeof hostWelcome?.weather === 'string');

const guest = connect('客人', { clientId: 'smokeguest001' });
await guest.ready;
guest.join(4, 70, 4, { room: 'smoke' });
const guestWelcome = await guest.wait('welcome', 3000);
check('从属 join 收到 welcome', guestWelcome !== null);
check('从属 isHost=false', guestWelcome?.isHost === false);
check('从属 hostId = 房主 id', guestWelcome?.hostId === hostWelcome?.id, `${guestWelcome?.hostId} vs ${hostWelcome?.id}`);
check('房主收到"有人进来"的 player 广播', (await host.wait('player', 2000)) !== null);

const guestId = guestWelcome?.id;
guest.send({ t: 'move', x: 5, y: 70, z: 5, yaw: 1.2, pitch: 0.1, dimension: 'overworld', team: '红队' });
const moveMsg = await host.wait('player', 2000);
check('房主收到从属的 move', moveMsg?.id === guestId && moveMsg?.x === 5, JSON.stringify(moveMsg));
check('队伍随 move 转发', moveMsg?.team === '红队', JSON.stringify(moveMsg?.team));

// 房主改方块 → 从属收到（带 authority）
guest.inbox.length = 0;
host.send({ t: 'blocks', blocks: [[10, 70, 10, 1, 0, 'overworld']] });
const blockMsg = await guest.wait('blocks', 2000);
check('从属收到房主的方块广播', Array.isArray(blockMsg?.blocks), JSON.stringify(blockMsg));
check('方块广播带 authority=true', blockMsg?.authority === true);

// 从属直接改方块 → 静默丢弃（有房主的房里只收房主；与 JS 版一致，不回 error，
// 否则从属端每改一次就多一条错误，界面会被刷屏）
host.inbox.length = 0;
guest.send({ t: 'blocks', blocks: [[11, 70, 10, 1, 0, 'overworld']] });
check('从属直发 blocks 被丢弃（房主收不到）', (await host.wait('blocks', 600)) === null);

// 从属走 edit-request → 房主收到转发
host.inbox.length = 0;
guest.send({ t: 'edit-request', payload: { t: 'blocks', blocks: [[12, 70, 10, 1, 0, 'overworld']] } });
const forwarded = await host.wait('edit-request', 2000);
check('房主收到从属的改动请求', Array.isArray(forwarded?.payload?.blocks), JSON.stringify(forwarded));

// 重名加入 → 拒绝
const dup = connect('房主', { clientId: 'smokedup00001' });
await dup.ready;
dup.join(0, 70, 0, { room: 'smoke' });
const dupError = await dup.wait('error', 3000);
check('同房重名被拒（duplicate-name）', dupError?.code === 'duplicate-name', JSON.stringify(dupError));
dup.close();

// 房主改天气 → 同房收到
guest.inbox.length = 0;
host.send({ t: 'room-config', weather: 'rain' });
const weatherMsg = await guest.wait('weather', 2000);
check('房主改天气 → 从属收到 weather', weatherMsg?.kind === 'rain', JSON.stringify(weatherMsg));

// 从属改天气 → 被拒
guest.inbox.length = 0;
guest.send({ t: 'room-config', weather: 'clear' });
const weatherDenied = await guest.wait('error', 2000);
check('从属改房间配置被拒（not-host）', weatherDenied?.code === 'not-host', JSON.stringify(weatherDenied));

// 聊天
guest.inbox.length = 0;
host.send({ t: 'chat', text: '你好' });
const chatMsg = await guest.wait('chat', 2000);
check('聊天转发（且不回给发送者）', chatMsg?.text === '你好' && chatMsg?.name === '房主', JSON.stringify(chatMsg));

// 断开 → 对方收到 leave
host.inbox.length = 0;
guest.close();
const leaveMsg = await host.wait('leave', 3000);
check('断线广播 leave（带 id）', leaveMsg?.id === guestId, JSON.stringify(leaveMsg));

host.close();
console.log(`\nRust 冒烟：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

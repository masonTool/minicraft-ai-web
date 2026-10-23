/**
 * 多人联机服务端（K2）
 *
 * 设计前提：**地形是确定性的**——同一个种子 + 同一套生成算法，任何客户端都会
 * 生成完全一样的世界。所以服务端不需要同步区块地形，只需要负责三件事：
 *
 *   1. 定种子：新客户端进来时告诉它用哪个种子（保证大家看到同一片大陆）
 *   2. 转发玩家位置：谁在哪、朝哪看
 *   3. 广播方块改动：谁把哪一块改成了什么（新加入者会收到全部历史改动）
 *
 * 换句话说，这里的"区块同步"是**零带宽**的：算力换带宽，区块同步退化成
 * "同步一份（种子 + 增量列表）"——与 K1 的增量存档是同一套思路。
 *
 * 运行：node server/index.mjs           （默认端口 8787）
 *      PORT=9000 node server/index.mjs
 *
 * 协议：JSON 文本帧，消息表与校验规则见 docs/NET-PROTOCOL.md（客户端实现在 src/net/NetClient.ts）
 */

import { WebSocketServer } from 'ws';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOSE_CLIENT_ID,
  CLOSE_DUPLICATE,
  CLOSE_VERSION,
  PROTOCOL_VERSION,
  finiteNumber,
  isValidClientId,
  sanitizeDimension,
  sanitizeName,
} from './protocol.mjs';
import { readSnapshot, SNAPSHOT_VERSION, startAutoSave, writeSnapshot } from './store.mjs';
import { DEFAULT_MAX_EDITS, rememberEdit, selectSnapshotEdits } from './snapshot.mjs';

const PORT = Number(process.env.PORT ?? 8787);
/** 世界种子：服务端说了算，客户端不再用自己配置的种子 */
const WORLD_SEED = Number(process.env.SEED ?? 20261014);
/**
 * 方块改动最多记这么多条（防止长时间运行的房间把内存吃光）。
 *
 * 满了之后**淘汰最旧的一条并告警**（联机14）——原来的写法是静默丢弃新改动，
 * 客户端完全不知道，队友那边就"我改的东西不见了"。
 */
const MAX_EDITS = DEFAULT_MAX_EDITS;
/** 淘汰计数：告警限频用（每 100 条报一次，否则一炸就是几千行日志） */
let evictedEdits = 0;
function warnEvictedEdit(key) {
  evictedEdits++;
  if (evictedEdits === 1 || evictedEdits % 100 === 0) {
    log(
      `方块增量已达上限 ${MAX_EDITS}，淘汰最旧的一条（累计 ${evictedEdits} 条，例如 ${key}）。` +
        '建议清空存档或调大 MAX_EDITS',
    );
  }
}
/**
 * 一条 `blocks` 消息最多认多少条（联机12）。
 *
 * 客户端合帧上限是 256，这里给到 4096 是留余量；再多的直接截掉——否则一条手工构造
 * 的消息就能让服务端遍历几十万次，还把它整包转发出去。
 */
const MAX_BLOCKS_PER_MESSAGE = 4096;
/** 玩家位置更新的最小间隔（毫秒）：比这更频繁的移动消息直接丢弃 */
const MOVE_INTERVAL_MS = 50;
/**
 * 掉落物镜像上限（L7 第一刀）。
 *
 * 这一批只做"看见"：谁生成谁负责删，服务端只存一份最新状态。
 * 上限按"一局里地上的掉落物"估的——超过就丢新的，别让长时间运行的房间把内存吃光。
 */
const MAX_ITEMS = 2000;
/** 每个玩家每秒最多广播多少条掉落物（防脚本刷消息） */
const ITEM_RATE_LIMIT = 30;

/** @type {Map<string, {id:number,name:string,clientId:string,x:number,y:number,z:number,yaw:number,pitch:number,socket:import('ws').WebSocket,lastMove:number,dimension:string}>} */
const players = new Map();
/** 方块改动：key = "维度|x,y,z" → { x, y, z, id, state, dimension } */
const edits = new Map();
/**
 * 掉落物镜像：key = "ownerId:localId"。
 *
 * key 里的 owner 一律由服务端填（不用客户端消息里的任何 id），
 * 于是"删别人的掉落物"这件事在协议层就不成立。
 */
const items = new Map();
/**
 * 断线宽限期（联机8）：这么久之内带同一个 clientId 回来就复用原 id 与掉落物。
 *
 * 可用 `GRACE_MS` 覆盖——测试里调成几百毫秒，不必白等 30 秒（`联机7` 的坑：
 * 让断言去对齐真实时长，套件会从 2 秒涨到十几秒，并发下还容易偶发超时）。
 */
const GRACE_MS = Number(process.env.GRACE_MS ?? 30000);
/** clientId → { id, name, timer }：已断开但还没过宽限期的人 */
const graces = new Map();
/**
 * 容器内容（联机13）：`维度|x,y,z` → `{x,y,z,dimension,slots}`。
 *
 * 服务端原来只转发 `container` 消息、不留副本，于是重启之后箱子里的东西对新玩家
 * 完全不可见（只有打开过那个箱子的老玩家本地还记得）。这里顺手留一份，随快照落盘，
 * `welcome` 里下发。
 */
const containers = new Map();
/** 容器快照上限（与 `MAX_EDITS` 同一个理由：别让长时间运行的房间把内存吃光） */
const MAX_CONTAINERS = 5000;
/**
 * 牌子文字（联机16）：`维度|x,y,z` → `{x,y,z,dimension,lines}`。
 *
 * 与容器同理：服务端不留副本，新玩家进来就看不到队友写的牌子；留了却不落盘，
 * 重启之后又全没了。所以既留也存。
 */
const signs = new Map();
/** 展示框内容（联机16）：`维度|x,y,z` → `{x,y,z,dimension,item,rotation}`；`item = null` 是空框 */
const frames = new Map();
const MAX_SIGNS = 5000;
const MAX_FRAMES = 5000;
/**
 * 世界快照文件（联机13）。`DATA_DIR` 可覆盖——测试里指到临时目录，
 * 免得把仓库里的 `server/.data/world.json` 弄脏。
 */
const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL('./.data/', import.meta.url));
const WORLD_FILE = join(DATA_DIR, 'world.json');
let nextPlayerId = 1;

const log = (...args) => console.log(`[server ${new Date().toISOString().slice(11, 19)}]`, ...args);

function send(socket, message) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/**
 * 拒绝一条连接：先回 `error`（带 `code`，客户端按它决定要不要重连），再关。
 *
 * 关闭码只给日志/抓包看；客户端判的永远是 `error.code`——这样两者可以独立演进。
 */
function reject(socket, code, message, closeCode) {
  send(socket, { t: 'error', code, message });
  socket.close(closeCode, code);
}

function broadcast(message, exceptId = null) {
  const text = JSON.stringify(message);
  for (const player of players.values()) {
    if (player.id === exceptId) continue;
    if (player.socket.readyState !== player.socket.OPEN) continue;
    player.socket.send(text);
  }
}

/** 给新玩家准备的世界快照 */
/**
 * 给新玩家准备的世界快照。
 *
 * `edits` **只发这个玩家附近的**（联机14）：跑久了的房间能攒到十几万条，
 * 一次发给手机就是几 MB 的 JSON，而这个玩家真正看得见的可能只有几百格。
 */
function snapshotFor(player) {
  return {
    seed: WORLD_SEED,
    // 时间权威（联机10）：进服先对齐一次，之后靠每 2s 的 `time` 广播校正
    timeOfDay: currentTimeOfDay(),
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      dimension: p.dimension,
    })),
    // 方块改动用数组传更紧凑：[x, y, z, id, state, dimension]；**按玩家位置裁剪**（联机14）
    edits: selectSnapshotEdits(edits.values(), player).map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
    // 地上的掉落物：新玩家进来要看得见（L7 第一刀）
    items: [...items.values()],
    // 容器内容（联机13）：重启后箱子里的东西不会凭空消失
    containers: [...containers.values()],
    // 牌子与展示框（联机16）：同一条理由
    signs: [...signs.values()],
    frames: [...frames.values()],
  };
}

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  log(`已启动，端口 ${PORT}，种子 ${WORLD_SEED}`);
  log(`玩家把游戏指向 ws://localhost:${PORT} 即可联机`);
});

/**
 * 心跳（联机7）：每 5s ping 一次，20s 没回 pong 就 terminate。
 *
 * 为什么必须有：TCP 半开连接（手机切后台、断 wifi、进电梯）**不会**触发 close，
 * 服务端会一直把这个人算在线——房间里永远多一个人，他名下的掉落物也不会清。
 * 浏览器不能主动发 ping，但会自动回 pong，所以 ping/pong 是唯一不用改协议的探活。
 *
 * 用时间戳而不是经典的单布尔 `isAlive`：后者把"超时"绑死在扫描间隔上（一次没回就断，
 * 5s 的网络抖动也会踢人），时间戳才能表达"20s 都没回"。
 */
/**
 * 时间权威（联机10）：服务端只推算、不 tick。
 *
 * 一天 20 分钟、开局 0.12（清晨），与客户端 `dayLengthSeconds` 的默认值一致。
 * 客户端那边拿到目标值后按 4 倍速向它靠（`core/net/NetTime.ts`），所以这里
 * 2 秒一条足够——不需要每帧广播。
 */
const DAY_LENGTH_MS = 20 * 60 * 1000;
/** 清晨 0.12（睡满跳夜也回到这里） */
const DAWN_TIME_OF_DAY = 0.12;
/** 当前这一天的起点时刻（`sleep` 会把它重置成"现在"，等于把时间拨回清晨） */
let serverStartMs = Date.now();
/** 起点时刻对应的一天中的时间：读档时会换成存档里的值（重启后从上次那一刻继续） */
let startTimeOfDay = DAWN_TIME_OF_DAY;
function currentTimeOfDay() {
  const value = (Date.now() - serverStartMs) / DAY_LENGTH_MS + startTimeOfDay;
  return value - Math.floor(value);
}

/** 时间校正广播：2 秒一条；没人时什么都不发 */
const clockTimer = setInterval(() => {
  if (players.size === 0) return;
  broadcast({ t: 'time', timeOfDay: currentTimeOfDay() });
}, 2000);
clockTimer.unref?.();

// ---------------------------------------------------------------- 持久化（联机13）

/** 当前世界的完整快照（落盘用） */
function worldSnapshot() {
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    seed: WORLD_SEED,
    timeOfDay: Number(currentTimeOfDay().toFixed(6)),
    // 方块改动用数组传更紧凑：[x, y, z, id, state, dimension]
    edits: [...edits.values()].map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
    // 容器：[x, y, z, dimension, slots]
    containers: [...containers.values()].map((c) => [c.x, c.y, c.z, c.dimension, c.slots]),
    // 牌子：[x, y, z, dimension, lines]（联机16）
    signs: [...signs.values()].map((s) => [s.x, s.y, s.z, s.dimension, s.lines]),
    // 展示框：[x, y, z, dimension, item, rotation]
    frames: [...frames.values()].map((f) => [f.x, f.y, f.z, f.dimension, f.item, f.rotation]),
  };
}

/**
 * 启动时读档：把上次的快照灌回内存表。
 *
 * 时间用"存档时刻的时间"做新的起点——服务端停机的那段时间不走（原版服务器关掉的
 * 时候世界也是停的），这比"按真实时间补算"更符合直觉，也不会出现"重启后突然变成深夜"。
 */
const loaded = readSnapshot(WORLD_FILE, log);
if (loaded.data) {
  const saved = loaded.data;
  for (const entry of Array.isArray(saved.edits) ? saved.edits : []) {
    if (!Array.isArray(entry)) continue;
    const [x, y, z, id, state, dimension] = entry;
    const edit = {
      x: Math.trunc(Number(x)),
      y: Math.trunc(Number(y)),
      z: Math.trunc(Number(z)),
      id: Math.trunc(Number(id)),
      state: Math.trunc(Number(state ?? 0)),
      dimension: sanitizeDimension(String(dimension ?? 'overworld')),
    };
    if (![edit.x, edit.y, edit.z, edit.id, edit.state].every(Number.isFinite)) continue;
    // 读档也走容量策略：存档比上限还大时保留最后 MAX_EDITS 条（不告警，这是读档不是溢出）
    rememberEdit(edits, `${edit.dimension}|${edit.x},${edit.y},${edit.z}`, edit, MAX_EDITS);
  }
  for (const entry of Array.isArray(saved.containers) ? saved.containers : []) {
    if (!Array.isArray(entry)) continue;
    const [x, y, z, dimension, slots] = entry;
    const container = {
      x: Math.trunc(Number(x)),
      y: Math.trunc(Number(y)),
      z: Math.trunc(Number(z)),
      dimension: sanitizeDimension(String(dimension ?? 'overworld')),
      slots,
    };
    if (![container.x, container.y, container.z].every(Number.isFinite)) continue;
    containers.set(`${container.dimension}|${container.x},${container.y},${container.z}`, container);
  }
  for (const entry of Array.isArray(saved.signs) ? saved.signs : []) {
    if (!Array.isArray(entry)) continue;
    const [x, y, z, dimension, lines] = entry;
    const sign = {
      x: Math.trunc(Number(x)),
      y: Math.trunc(Number(y)),
      z: Math.trunc(Number(z)),
      dimension: sanitizeDimension(String(dimension ?? 'overworld')),
      lines: Array.isArray(lines) ? lines.map((line) => String(line)) : [],
    };
    if (![sign.x, sign.y, sign.z].every(Number.isFinite)) continue;
    signs.set(`${sign.dimension}|${sign.x},${sign.y},${sign.z}`, sign);
  }
  for (const entry of Array.isArray(saved.frames) ? saved.frames : []) {
    if (!Array.isArray(entry)) continue;
    const [x, y, z, dimension, item, rotation] = entry;
    const frame = {
      x: Math.trunc(Number(x)),
      y: Math.trunc(Number(y)),
      z: Math.trunc(Number(z)),
      dimension: sanitizeDimension(String(dimension ?? 'overworld')),
      item: item && typeof item === 'object' ? item : null,
      rotation: Math.trunc(Number(rotation ?? 0)) || 0,
    };
    if (![frame.x, frame.y, frame.z].every(Number.isFinite)) continue;
    frames.set(`${frame.dimension}|${frame.x},${frame.y},${frame.z}`, frame);
  }
  if (typeof saved.timeOfDay === 'number' && Number.isFinite(saved.timeOfDay)) {
    startTimeOfDay = ((saved.timeOfDay % 1) + 1) % 1;
    serverStartMs = Date.now();
  }
  log(
    `读档完成：方块 ${edits.size} 条 / 容器 ${containers.size} 个 / 时间 ${currentTimeOfDay().toFixed(2)}`,
  );
}

/** 定时落盘（30 秒）；正常退出时再补一次 */
const autoSave = startAutoSave(WORLD_FILE, worldSnapshot, { intervalMs: 30_000, log });

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 20000;
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    const socket = player.socket;
    if (socket.readyState !== socket.OPEN) continue;
    const silentFor = now - (socket.lastPongAt ?? now);
    if (silentFor > HEARTBEAT_TIMEOUT_MS) {
      log(`玩家 #${player.id}（${player.name}）${Math.round(silentFor / 1000)}s 没回 pong，断开`);
      socket.terminate();
      continue;
    }
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);
// 不拖住进程退出（测试里 spawn 服务端，收尾时要能干净收）
heartbeat.unref?.();

wss.on('connection', (socket, request) => {
  const address = request.socket.remoteAddress ?? 'unknown';
  let player = null;

  // 心跳（联机7）：ping 是协议层帧，浏览器会自动回 pong（它不能主动 ping）
  socket.lastPongAt = Date.now();
  socket.on('pong', () => {
    socket.lastPongAt = Date.now();
  });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, { t: 'error', code: 'bad-json', message: '消息不是合法 JSON' });
      return;
    }

    switch (message.t) {
      case 'join': {
        if (player) return send(socket, { t: 'error', code: 'joined', message: '已经加入过了' });

        // 版本先判：字段不兼容时，旧客户端连新服务端不会自己报错，只会静默错乱
        if (Number(message.v) !== PROTOCOL_VERSION) {
          return reject(
            socket,
            'version',
            `协议版本不匹配：服务端 ${PROTOCOL_VERSION}，客户端 ${message.v ?? '未提供'}`,
            CLOSE_VERSION,
          );
        }
        if (!isValidClientId(message.clientId)) {
          return reject(socket, 'clientId', '缺少合法的 clientId（8~64 位字母/数字/-/_）', CLOSE_CLIENT_ID);
        }
        /*
         * 同一个 clientId 已经在线 → 拒绝新连接。
         *
         * 不做"新连接顶掉旧连接"：在没有鉴权的前提下，那等于谁抄到 id 谁就能踢人。
         * 断线重连复用 id 是另一条路（联机8 的 grace 会话），前提是旧连接已经消失。
         */
        for (const other of players.values()) {
          if (other.clientId === message.clientId) {
            return reject(socket, 'duplicate', '这个 clientId 已经在线（同一个浏览器开了两个标签页？）', CLOSE_DUPLICATE);
          }
        }

        /*
         * 断线重连（联机8）：宽限期内的 clientId 复用原来的 id。
         *
         * 上面那条 duplicate 只挡"还活着"的连接；这个人已经断了，宽限期里他还占着 id 与
         * 掉落物——重连时认回同一个 id，队友眼里的你不会"消失又出现"，你自己名下的东西
         * （`items` 的 owner 就是 id）也还能删。
         */
        const grace = graces.get(message.clientId);
        if (grace) {
          clearTimeout(grace.timer);
          graces.delete(message.clientId);
          log(`${grace.name}#${grace.id} 宽限期内重连，复用 id`);
        }

        const name = sanitizeName(message.name);
        player = {
          id: grace ? grace.id : nextPlayerId++,
          name,
          clientId: message.clientId,
          // 位置与维度：客户端进服时会带上"我此刻在哪"，不再让新玩家在别人眼里
          // 先出现在 (0,80,0) 一次（要等 100ms 后的第一条 move 才纠正）
          x: finiteNumber(message.x, 0),
          y: finiteNumber(message.y, 80),
          z: finiteNumber(message.z, 0),
          yaw: 0,
          pitch: 0,
          dimension: sanitizeDimension(message.dimension),
          socket,
          lastMove: 0,
          // 掉落物广播的令牌窗口（见 ITEM_RATE_LIMIT）
          itemWindow: 0,
          itemCount: 0,
        };
        players.set(player.id, player);

        send(socket, {
          t: 'welcome',
          // 客户端据此确认"我连上的是我认识的那版协议"（服务端已经先校验过一次）
          v: PROTOCOL_VERSION,
          id: player.id,
          name: player.name,
          ...snapshotFor(player),
        });
        broadcast({ t: 'player', id: player.id, name: player.name, x: player.x, y: player.y, z: player.z, yaw: 0, pitch: 0, dimension: player.dimension }, player.id);
        // 入服立刻探一次活（联机7）：不用等下一个 5s 心跳窗口，半开连接能早 5s 被发现，
        // 测试也不必白等一个完整间隔
        socket.ping();
        log(`${name}#${player.id} 加入（来自 ${address}），当前 ${players.size} 人`);
        break;
      }

      case 'move': {
        if (!player) return;
        const now = Date.now();
        if (now - player.lastMove < MOVE_INTERVAL_MS) return;
        player.lastMove = now;
        player.x = Number(message.x ?? player.x);
        player.y = Number(message.y ?? player.y);
        player.z = Number(message.z ?? player.z);
        player.yaw = Number(message.yaw ?? player.yaw);
        player.pitch = Number(message.pitch ?? player.pitch);
        player.dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        broadcast(
          { t: 'player', id: player.id, name: player.name, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, dimension: player.dimension },
          player.id,
        );
        break;
      }

      case 'block': {
        if (!player) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        const id = Math.trunc(Number(message.id));
        const state = Math.trunc(Number(message.state ?? 0));
        if (![x, y, z, id, state].every(Number.isFinite)) return;

        if (edits.size < MAX_EDITS) {
          rememberEdit(edits, `${dimension}|${x},${y},${z}`, { x, y, z, id, state, dimension }, MAX_EDITS, warnEvictedEdit);
        }
        // 广播给其他人（含 by，方便客户端区分"自己改的"）
        broadcast({ t: 'block', x, y, z, id, state, dimension, by: player.id }, player.id);
        break;
      }

      /*
       * 批量方块改动（联机12）。
       *
       * 客户端把 100ms 内的改动合成一条（同格只留最后一稿），这里逐条与 `block` 同样收口
       * （截断成整数、坐标必须有限、`edits` 有上限、维度名走 `sanitizeDimension`），
       * 再**一次性**广播给其他人——`by` 仍然带，客户端靠它区分"自己改的"。
       */
      case 'blocks': {
        if (!player) return;
        const list = Array.isArray(message.blocks) ? message.blocks.slice(0, MAX_BLOCKS_PER_MESSAGE) : [];
        const accepted = [];
        for (const raw of list) {
          if (!Array.isArray(raw)) continue;
          const [rawX, rawY, rawZ, rawId, rawState, rawDimension] = raw;
          const edit = {
            x: Math.trunc(Number(rawX)),
            y: Math.trunc(Number(rawY)),
            z: Math.trunc(Number(rawZ)),
            id: Math.trunc(Number(rawId)),
            state: Math.trunc(Number(rawState ?? 0)),
            dimension: sanitizeDimension(String(rawDimension ?? player.dimension)),
          };
          if (![edit.x, edit.y, edit.z, edit.id, edit.state].every(Number.isFinite)) continue;
          rememberEdit(edits, `${edit.dimension}|${edit.x},${edit.y},${edit.z}`, edit, MAX_EDITS, warnEvictedEdit);
          accepted.push(edit);
        }
        if (accepted.length === 0) return;
        broadcast(
          {
            t: 'blocks',
            blocks: accepted.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
            by: player.id,
          },
          player.id,
        );
        break;
      }

      /*
       * 牌子文字与展示框内容（联机16）。
       *
       * 都按坐标存一份（`welcome` 要发、快照要落盘），校验只做形状与长度：
       * 牌子最多 4 行、每行截到 64 个字符；展示框的 `item` 要么是 null（空框），
       * 要么是 `{id, count}`。内容怎么渲染是客户端的事。
       */
      case 'sign': {
        if (!player) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        if (![x, y, z].every(Number.isFinite)) return;
        const lines = Array.isArray(message.lines)
          ? message.lines.slice(0, 4).map((line) => String(line).slice(0, 64))
          : [];
        if (signs.size < MAX_SIGNS) signs.set(`${dimension}|${x},${y},${z}`, { x, y, z, dimension, lines });
        broadcast({ t: 'sign', x, y, z, dimension, lines, by: player.id }, player.id);
        break;
      }

      case 'frame': {
        if (!player) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        if (![x, y, z].every(Number.isFinite)) return;
        const rawItem = message.item;
        const item =
          rawItem && typeof rawItem === 'object'
            ? { id: Math.trunc(Number(rawItem.id)), count: Math.trunc(Number(rawItem.count ?? 1)) }
            : null;
        if (item && (!Number.isFinite(item.id) || !Number.isFinite(item.count))) return;
        const rotation = Math.trunc(Number(message.rotation ?? 0)) || 0;
        if (frames.size < MAX_FRAMES) frames.set(`${dimension}|${x},${y},${z}`, { x, y, z, dimension, item, rotation });
        broadcast({ t: 'frame', x, y, z, dimension, item, rotation, by: player.id }, player.id);
        break;
      }

      case 'container': {
        if (!player) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const slots = message.slots;
        // 只做形状校验：内容由客户端 `restoreStacks` 清洗。
        // 8192 字节上限挡住把消息塞爆的脏客户端。
        if (!Array.isArray(slots) || slots.length > 27) return;
        if (JSON.stringify(slots).length > 8192) return;
        // 留一份副本随快照落盘（联机13）：不然重启之后箱子里的东西对新玩家不可见
        if (containers.size < MAX_CONTAINERS) {
          containers.set(`${dimension}|${x},${y},${z}`, { x, y, z, dimension, slots });
        }
        broadcast({ t: 'container', dimension, x, y, z, slots, by: player.id }, player.id);
        break;
      }

      case 'item-spawn': {
        if (!player) return;
        // 每秒最多 30 条：本地扫描是 100ms 一次，正常一帧也不会一下冒出几十堆
        const now = Date.now();
        if (now >= player.itemWindow) {
          player.itemWindow = now + 1000;
          player.itemCount = 0;
        }
        if (++player.itemCount > ITEM_RATE_LIMIT) return;

        const localId = Math.trunc(Number(message.localId));
        const itemId = Math.trunc(Number(message.itemId));
        const count = Math.trunc(Number(message.count));
        const x = Number(message.x);
        const y = Number(message.y);
        const z = Number(message.z);
        if (![localId, itemId, count, x, y, z].every(Number.isFinite)) return;
        if (localId <= 0 || itemId <= 0 || count <= 0 || count > 64) return;
        // 世界高度是 [-64, 320)，放宽到 ±2000 只为挡住明显的脏数据
        if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < -2000 || y > 2000) return;

        const key = `${player.id}:${localId}`;
        if (items.size >= MAX_ITEMS && !items.has(key)) return;
        items.set(key, { owner: player.id, localId, itemId, count, x, y, z });
        broadcast({ t: 'item-spawn', owner: player.id, localId, itemId, count, x, y, z }, player.id);
        break;
      }

      case 'item-remove': {
        if (!player) return;
        const localId = Math.trunc(Number(message.localId));
        if (!Number.isFinite(localId) || localId <= 0) return;
        const key = `${player.id}:${localId}`;
        if (!items.delete(key)) return;
        broadcast({ t: 'item-remove', owner: player.id, localId }, player.id);
        break;
      }

      case 'chat': {
        if (!player) return;
        const text = String(message.text ?? '').slice(0, 200);
        if (text.length === 0) return;
        broadcast({ t: 'chat', id: player.id, name: player.name, text });
        log(`<${player.name}> ${text}`);
        break;
      }

      /*
       * 睡满跳夜（联机11）。
       *
       * 口径**先按本项目**：任一玩家睡满即跳夜，不要求"所有人都躺下"（基岩版要全员睡；
       * 这条差异记在 TASKS 的差异台账里）。服务端只做两件事：把时间拨到黎明、广播出去。
       *
       * 拨法很省：把"开局时刻"重置成现在——因为 `START_TIME_OF_DAY` 本身就是清晨 0.12。
       */
      case 'sleep': {
        if (!player) return send(socket, { t: 'error', code: 'joined', message: '先 join 再睡' });
        serverStartMs = Date.now();
        startTimeOfDay = DAWN_TIME_OF_DAY;
        broadcast({ t: 'time', timeOfDay: currentTimeOfDay(), snap: true });
        log(`${player.name}#${player.id} 睡满，时间跳到黎明`);
        break;
      }

      default:
        send(socket, { t: 'error', code: 'unknown', message: `未知消息类型 ${message.t}` });
    }
  });

  socket.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    /*
     * 不立刻广播 leave，也不立刻清掉落物：先给 30 秒宽限期（联机8）。
     *
     * 手机切后台、wifi 抖一下都会触发 close，客户端那边是"自动重连"。如果这时就把人
     * 移出房间、把他的掉落物清掉，重连回来等于换了个人：队友眼里你消失又出现，你自己
     * 生成的东西还被清空了。宽限期到期才真正离开。
     *
     * 期间他**不在** `players` 里：位置不再广播（别人看到的是停在原地），也不占在线人数。
     */
    const grace = {
      id: player.id,
      name: player.name,
      timer: null,
    };
    grace.timer = setTimeout(() => {
      graces.delete(player.clientId);
      broadcast({ t: 'leave', id: player.id });
      // 宽限期过完，他名下那些掉落物再没人有权删了（owner 已离线），一并清掉；
      // 否则它们会永远躺在别人的世界里，而本地镜像又不可拾取
      for (const [key, item] of items) {
        if (item.owner !== player.id) continue;
        items.delete(key);
        broadcast({ t: 'item-remove', owner: item.owner, localId: item.localId });
      }
      log(`${player.name}#${player.id} 宽限期结束，已移出房间`);
    }, GRACE_MS);
    // 不拖住进程退出（测试里 spawn 服务端，收尾时要能干净收）
    grace.timer.unref?.();
    graces.set(player.clientId, grace);
    log(`${player.name}#${player.id} 断线（${Math.round(GRACE_MS / 1000)}s 内重连可复用 id），当前在线 ${players.size} 人`);
  });

  socket.on('error', (error) => {
    log('socket 出错：', error.message);
  });
});

// Ctrl+C 时干净退出（容器里被 kill 也不会留下半开连接）
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('收到退出信号，保存快照并关闭服务端');
    // 退出前补存一次（联机13）：定时器是 30 秒一轮，最后这几秒的改动不能白丢
    autoSave.stop();
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}

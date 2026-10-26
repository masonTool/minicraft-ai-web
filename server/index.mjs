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
 * 运行：node server/index.mjs           （默认端口 25187，见 protocol.mjs 的 DEFAULT_PORT）
 *      PORT=9000 node server/index.mjs
 *
 * 协议：JSON 文本帧，消息表与校验规则见 docs/NET-PROTOCOL.md（客户端实现在 src/net/NetClient.ts）
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOSE_CLIENT_ID,
  CLOSE_DUPLICATE,
  CLOSE_VERSION,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  blockEditRejection,
  finiteNumber,
  isValidClientId,
  sanitizeDimension,
  sanitizeName,
  sanitizeRoom,
  sanitizeEditPayload,
  sanitizeEntityKeys,
  sanitizeEntitySnap,
  sanitizeWorldMeta,
  withinEditReach,
} from './protocol.mjs';
import { readSnapshot, SNAPSHOT_VERSION, startAutoSave, writeSnapshot } from './store.mjs';
import { networkInterfaces } from 'node:os';
import { DEFAULT_MAX_EDITS, editsInChunk, rememberEdit, selectSnapshotEdits } from './snapshot.mjs';
import { encodeEditsPack } from './editpack.mjs';
import { createBuckets } from './ratelimit.mjs';
import { withinAoi } from './aoi.mjs';
import { isWeatherKind, tickWeather, weatherSecondsFor } from './weather.mjs';

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
/** 世界种子：服务端说了算，客户端不再用自己配置的种子 */
const WORLD_SEED = Number(process.env.SEED ?? 20261014);
/**
 * 方块改动最多记这么多条（防止长时间运行的房间把内存吃光）。
 *
 * 满了之后**淘汰最旧的一条并告警**（联机14）——原来的写法是静默丢弃新改动，
 * 客户端完全不知道，队友那边就"我改的东西不见了"。
 */
const MAX_EDITS = DEFAULT_MAX_EDITS;
/** 按视野补发时，一条 `blocks` 消息最多带多少格（密集区也别推巨包） */
const CHUNK_EDITS_BATCH = 2048;
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
/** 每个玩家每秒最多广播多少条生物命中（联机19）：攻击频率本来就低，这个上限只挡脚本 */
const MOB_HIT_RATE_LIMIT = 30;
/** 每个玩家每秒最多发多少次拾取申请（联机21）：走近一堆货最多也就每秒几次 */
const ITEM_TAKE_RATE_LIMIT = 20;

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
 * 房主（L8）：房间名 → `{ id, clientId }`，一个房间只有一名房主。
 *
 * 为什么服务端要记这件事：这一批之后**世界只由房主模拟**，其他人只渲染。两个人都
 * 以为自己在模拟，正是"同一只怪两边血量不同"的根因——所以"谁是房主"必须是服务端
 * 说了算，而不是客户端互相约定。
 *
 * 房主断线时**不立刻**释放：先留一个宽限期（与 `graces` 同一把尺子），他重连回来
 * 仍然是他；宽限期过完才让出房主位，下一个开房的人才进得来。
 */
const hosts = new Map();
/**
 * 每个房间"是哪个世界"（L9）：`room` → `{name, seed, mode, difficulty}`。
 *
 * 房主开房时随 `join` 上报，服务端只做形状收口、**不做玩法判断**（模式/难度只当标签存着）。
 * 从属端靠 `welcome` 里这一份知道"该生成哪片大陆"，`seed` 从此按房间而不是全服一个常量。
 *
 * 没有房主的房间（有人直接 join、没带 host）不在表里，退回 `WORLD_SEED`——那是
 * "单机直连服务器"的老行为，不能因为这一批就断掉。
 */
const roomWorlds = new Map();

/** 这个房间当前的世界元数据（没房主时用服务端默认种子兜底） */
function worldOfRoom(room) {
  return (
    roomWorlds.get(room) ?? { name: '', seed: WORLD_SEED, mode: '', difficulty: '', worldType: '' }
  );
}
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
 * 一条 `session-sync` 最多带多少条（用户 2026-10-26，与客户端 `SESSION_SYNC_BATCH` 对齐）。
 *
 * 房主进房时把容器/牌子/展示框整份推上来，服务端存一份再按房广播——
 * 队友的 `welcome` 里能看到的箱子内容只能来自这一推（服务端清场之后是空的）。
 */
const SESSION_SYNC_BATCH = 200;
/** 一条连接最多发多少条 `session-sync`：一次整份推最多几十条，这个上限只挡脚本 */
const SESSION_SYNC_MAX_MESSAGES = 256;

/**
 * 拒收日志（联机24）：限频到每 5 秒最多一条。
 *
 * 单独看一条"y 越界"没意义，但"某个人一直在发越界坐标"很值得知道——每条都打会把
 * 日志刷满，反而看不出规律。
 */
let lastRejectLogAt = 0;
let rejectedSinceLastLog = 0;
function rejectEdit(player, reason, where) {
  rejectedSinceLastLog++;
  const now = Date.now();
  if (now - lastRejectLogAt < 5000) return;
  lastRejectLogAt = now;
  log(`${player.name}#${player.id} 的改动被拒 ${rejectedSinceLastLog} 次（最近一次：${reason} @ ${where}）`);
  rejectedSinceLastLog = 0;
}

/**
 * 箭/TNT 这类"特效消息"的令牌窗口（联机23）：每人每秒 30 条。
 *
 * 与掉落物、生物命中相同的做法——正常玩法根本打不满，这个上限只用来挡脚本。
 */
const EFFECT_RATE_LIMIT = 30;
function takeEffectToken(player) {
  const now = Date.now();
  if (now >= player.effectWindow) {
    player.effectWindow = now + 1000;
    player.effectCount = 0;
  }
  return ++player.effectCount <= EFFECT_RATE_LIMIT;
}

/**
 * 外观字段收口（联机17 / 皮肤同步）。
 *
 * 只认白名单字段，值一律规整成数字/布尔——**不让客户端把任意结构塞进广播**，
 * 否则一个客户端就能决定别人收到的报文长什么样（内存与带宽都被它牵着走）。
 */
function readAppearance(message) {
  const armor = Array.isArray(message.armor)
    ? message.armor.slice(0, 4).map((id) => Math.trunc(Number(id)) || 0)
    : undefined;
  const positive = (value) => {
    const id = Math.trunc(Number(value));
    return Number.isFinite(id) && id > 0 ? id : 0;
  };
  /*
   * 外观下标（皮肤）：定长 10，多一个都不要（协议契约，见
   * `src/core/net/RemoteAppearance.ts` 的 `REMOTE_LOOK_LENGTH`）。
   * 服务端不校验"第几档合法"——那是各端颜色表的长度，服务端没有那张表；
   * 只做形状收口（整数、长度），越界由客户端的 `paletteOf` 回退默认。
   */
  const look = Array.isArray(message.look)
    ? message.look.slice(0, 10).map((value) => {
        const n = Math.trunc(Number(value));
        return Number.isFinite(n) && n >= 0 ? n : 0;
      })
    : undefined;
  return {
    ...(positive(message.held) ? { held: positive(message.held) } : {}),
    ...(positive(message.offhand) ? { offhand: positive(message.offhand) } : {}),
    ...(armor && armor.some((id) => id > 0) ? { armor } : {}),
    ...(look && look.length === 10 ? { look } : {}),
    ...(message.sneak ? { sneak: true } : {}),
    ...(message.swing ? { swing: true } : {}),
    ...(message.hurt ? { hurt: true } : {}),
    ...(message.fire ? { fire: true } : {}),
    ...(message.ride ? { ride: true } : {}),
    ...(message.sleep ? { sleep: true } : {}),
  };
}
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
  const text = JSON.stringify(message);
  socket.send(text);
  traffic.outBytes += text.length;
  traffic.outMessages++;
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

/**
 * 房间密码（联机26）：`ROOM_PASSWORD` 为空 = 不校验（内网自建默认）。
 *
 * 只做"进房要口令"这一层，不是鉴权：口令在局域网里明文发，防的是"隔壁同事随手连"。
 */
const ROOM_PASSWORD = process.env.ROOM_PASSWORD ?? '';

/**
 * 允许的来源（联机26）：`ALLOWED_ORIGINS` 用逗号分隔，留空 = 不校验。
 *
 * ⚠️ **没有 Origin 的连接放行**：浏览器一定带 Origin，而 node 机器人 / 原生客户端
 * 不带——不放行的话，所有非浏览器客户端（含本仓库的 `test:net`）都会被拒。
 * 所以这条规则是"浏览器跨站会被挡"，不是"所有客户端都校验"。
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

/** 关闭码：来源被拒（联机26） */
const CLOSE_ORIGIN = 4004;
/** 关闭码：房间密码错（联机26） */
const CLOSE_PASSWORD = 4005;
/** 关闭码：这个房间已经有房主（L8） */
const CLOSE_HOST_TAKEN = 4006;
/** 房主退出、房间已关闭（L8 · MS4）：客户端不该再重连 */
const CLOSE_HOST_LEFT = 4007;
/** 房间内已有同名玩家（本轮）：改名再来，重连没用，所以也是致命码 */
const CLOSE_DUPLICATE_NAME = 4008;
/**
 * 房间里登记着房主、但人目前不在线（用户 2026-10-26）。
 *
 * 典型场景：房主 wifi 断了，`hosts` 里还挂着他（30 秒宽限期内）。此时访客进来会看到
 * 一个**不推进的世界**（怪物不动、红石不亮、熔炉不烧），而界面一切正常——这正是最难查
 * 的那种坏状态。所以直接挡在门外，让他等房主回来再来。
 */
const CLOSE_HOST_OFFLINE = 4009;

/**
 * 运行统计（联机29）：入/出字节与消息数。
 *
 * 只累计、不按窗口清零；速率由"两个采样点的差值 / 经过秒数"算出来——这样即使
 * `/healthz` 和定时日志交错调用，也不会互相把对方的窗口打乱。
 */
const traffic = {
  inBytes: 0,
  outBytes: 0,
  inMessages: 0,
  outMessages: 0,
  sampleAt: Date.now(),
  sampleInBytes: 0,
  sampleOutBytes: 0,
};

/** 取一段时间的平均速率（会推进采样点） */
function trafficRates() {
  const now = Date.now();
  const seconds = Math.max(0.001, (now - traffic.sampleAt) / 1000);
  const rates = {
    seconds: Number(seconds.toFixed(2)),
    inBytesPerSecond: Math.round((traffic.inBytes - traffic.sampleInBytes) / seconds),
    outBytesPerSecond: Math.round((traffic.outBytes - traffic.sampleOutBytes) / seconds),
    inMessagesPerSecond: Math.round(traffic.inMessages / Math.max(1, seconds)),
    outMessagesPerSecond: Math.round(traffic.outMessages / Math.max(1, seconds)),
  };
  traffic.sampleAt = now;
  traffic.sampleInBytes = traffic.inBytes;
  traffic.sampleOutBytes = traffic.outBytes;
  return rates;
}

/** 人读的字节速率 */
function formatBytesPerSecond(bytes) {
  if (bytes < 1024) return `${bytes}B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB/s`;
}

/**
 * 广播给同一个房间里的人（联机26）。
 *
 * `room` 必传：漏一个调用点就会"跨房串台"——这也是为什么 `broadcast` 的第三个参数
 * 不给默认值（给了默认值，漏传的地方会静默变成"发给所有人"）。
 */
function broadcast(message, exceptId, room, aoi = null) {
  const text = JSON.stringify(message);
  for (const player of players.values()) {
    if (player.id === exceptId) continue;
    if (player.room !== room) continue;
    // 关注范围（联机27）：只发给"看得见这一格/这一点的"人。`aoi` 为空 = 不按范围过滤
    if (aoi && !withinAoi(player, aoi.x, aoi.z, aoi.dimension)) continue;
    if (player.socket.readyState !== player.socket.OPEN) continue;
    player.socket.send(text);
    traffic.outBytes += text.length;
    traffic.outMessages++;
  }
}

/** 取出某房间名下的全部值（key 是 `房名|...`，联机26） */
function roomScopedValues(map, room) {
  const prefix = `${room}|`;
  const out = [];
  for (const [key, value] of map) {
    if (key.startsWith(prefix)) out.push(value);
  }
  return out;
}

/** 现在有人的房间（`time` 这类广播要按房各发一份） */
function roomsInUse() {
  const rooms = new Set();
  for (const player of players.values()) rooms.add(player.room);
  return rooms;
}

/**
 * 数据表的 key 加房间前缀（联机26）：`room|dimension|x,y,z`。
 *
 * 用前缀而不是"每个房间一套 Map"：前者只需要改 key 的拼法，后者要把四张表
 * （edits / containers / signs / frames）全部搬进 Room 对象、再改几十处引用——
 * 改错一处的表现是"某个功能跨房串台"，比 key 拼错更难查。
 */
function scopedKey(room, key) {
  return `${room}|${key}`;
}

/**
 * 按视野补发方块增量（2026-10-26）。
 *
 * 进房时的快照只带玩家 8 个区块（128 格）内的改动，更远的改动新玩家**永远收不到**——
 * 这就是"他那边地形和我这边对不上"的主因之一（跑久了的房间尤其明显）。
 *
 * 这里补上：玩家每跨进一个**新区块**，就把那个区块的增量推给他。走的是普通的
 * `blocks` 消息，客户端一行都不用改（`NetClient` 本来就会逐条喂 `onNetBlock`）。
 *
 * 为什么按区块而不是按半径：区块是加载单位，玩家走进来的就是这一块；
 * 一次最多推 `CHUNK_EDITS_BATCH` 条，密集区也不会推出一条巨包。
 */
function pushChunkEdits(player) {
  // 房主自己就是权威，不需要把自己的改动再收回去（他的本地世界本来就是全的）
  if (player.isHost === true) return;
  const cx = player.x >> 4;
  const cz = player.z >> 4;
  const key = `${player.dimension}|${cx},${cz}`;
  if (player.sentEditChunks.has(key)) return;

  /*
   * 懒上行（用户 2026-10-26）：服务端不再"自己攒"世界，缓存里的东西全部来自房主。
   *
   *  · 这一块**已确认**（房主给过整块）→ 直接推缓存，和以前一样；
   *  · 还没确认 → 向房主要（`edits-request`），房主回 `edits-reply`，服务端再按房广播；
   *  · **没有房主的房**（有人直接 join、没带 host）没有权威可问，退回老行为：
   *    服务端缓存就是大家共用的那份（那种房子里本来就没人跑模拟，谁改都一样）。
   *
   * `sentEditChunks` 只在**真的推了**之后才记：回包丢了的话，玩家下一次 move 会重试
   * （`requestedChunks` 挡的是"同一块被连点"，不是"永久只问一次"）。
   */
  const waitingForHost = hosts.has(player.room) && confirmedChunks.get(player.room)?.has(key) !== true;
  if (waitingForHost) {
    requestChunkFromHost(player, cx, cz);
    return;
  }
  player.sentEditChunks.add(key);
  // 只保留最近 4096 个键，防止长跑把 Set 撑大（走回头路会重推一次，无害）
  if (player.sentEditChunks.size > 4096) {
    const oldest = player.sentEditChunks.values().next();
    if (!oldest.done) player.sentEditChunks.delete(oldest.value);
  }
  sendChunkEdits(player, cx, cz);
}

/** 把某个区块的缓存整块推给这个玩家（没有改动就什么都不发） */
function sendChunkEdits(player, cx, cz) {
  const found = editsInChunk(edits.values(), player.room, player.dimension, cx, cz);
  if (found.length === 0) return;
  for (let i = 0; i < found.length; i += CHUNK_EDITS_BATCH) {
    const slice = found.slice(i, i + CHUNK_EDITS_BATCH);
    send(player.socket, {
      t: 'blocks',
      blocks: slice.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
      // 服务端补发：不是谁"刚改的"，但客户端只认 blocks 里的坐标，`by` 只用于区分自己
      authority: true,
    });
  }
}

/**
 * 向房主要一个区块的增量（懒上行）。
 *
 * 三道闸：房主在线、这一块还没在飞、在飞总数不超过 `MAX_INFLIGHT_REQUESTS`
 * （队友传送到几万格外时会连带跨过上千个区块，不设上限就等于让他的手机一次性
 * 收几百条请求）。
 */
function requestChunkFromHost(player, cx, cz) {
  const hostId = hosts.get(player.room)?.id;
  const host = hostId === undefined ? undefined : players.get(hostId);
  if (!host) return;
  const key = `${player.dimension}|${cx},${cz}`;
  const requested = trackedChunks(requestedChunks, player.room);
  if (requested.has(key)) return;
  if (requested.size >= MAX_INFLIGHT_REQUESTS) return;
  rememberTracked(requestedChunks, player.room, key);
  send(host.socket, { t: 'edits-request', dimension: player.dimension, cx, cz });
  /*
   * 回包丢了的话不能永远卡在"在飞"里：5 秒后忘掉这次请求，玩家下一次 move 会重试。
   * 不用"回包才算数"是因为房主可能刚好在切维度/卡顿，卡住的代价是队友那边永远缺一块。
   */
  const timer = setTimeout(() => requestedChunks.get(player.room)?.delete(key), 5000);
  timer.unref?.();
}

/** 给新玩家准备的世界快照 */
/**
 * 给新玩家准备的世界快照。
 *
 * `edits` **只发这个玩家附近的**（联机14）：跑久了的房间能攒到十几万条，
 * 一次发给手机就是几 MB 的 JSON，而这个玩家真正看得见的可能只有几百格。
 */
/**
 * 房间级的游戏模式（用户 2026-10-26："房主改了游戏模式，其他人收不到"）。
 *
 * 为什么单独存一份而不是只读 `worldOfRoom().mode`：世界元数据是房主 `join` 那一刻的快照，
 * 之后用 `/gamemode` 改的都不会回写。晚进来的人要看到**当前**模式，只能靠这份。
 */
const roomGameModes = new Map();

/** 客户端能收的模式（与 `src/core/world/GameMode.ts` 的 `GAME_MODES` 同一套字符串） */
const GAME_MODE_VALUES = ['survival', 'creative', 'adventure', 'spectator'];

/**
 * 房间的"哪些区块已经有房主给的权威数据"（用户 2026-10-26 懒上行）。
 *
 * `confirmed`：房主已经把这一整块回给我们了（`edits-reply`）；之后谁走进来直接推缓存。
 * `requested`：已经向房主要过、还没回；用来防"同一个区块被连点 8 次"。
 * 两张表都按房一份，键是 `维度|cx,cz`，各自有上限（长跑的房间会走遍整张地图）。
 */
const confirmedChunks = new Map();
const requestedChunks = new Map();
const MAX_TRACKED_CHUNKS = 4096;
/** 同时在飞的请求上限：队友传送到远处时别一口气把房主的手机压死 */
const MAX_INFLIGHT_REQUESTS = 8;

/** 取（必要时建）某个房间的区块追踪集合 */
function trackedChunks(store, room) {
  let set = store.get(room);
  if (!set) {
    set = new Set();
    store.set(room, set);
  }
  return set;
}

/** 记一个区块键并保住上限（走回头路会重推一次，无害） */
function rememberTracked(store, room, key) {
  const set = trackedChunks(store, room);
  set.add(key);
  if (set.size > MAX_TRACKED_CHUNKS) {
    const oldest = set.values().next();
    if (!oldest.done) set.delete(oldest.value);
  }
  return set;
}

/**
 * 把一个房间的会话缓存整个清掉（用户 2026-10-26：**服务器不持有世界存档**）。
 *
 * 口径：世界以房主本地为准，服务端只当"这一局的转发 + 缓存"，房间一结束就不该留下任何
 * 东西——留下的旧数据会在下一局被 `welcome` 发出去，变成"房主本地的世界被服务端改回去"。
 *
 * 只清**这个房名**前缀下的 key：同一台服务器上的其它房间互不影响。
 * `hosts` 不在这里动（清场之后调用方马上就会写它，分两步写清楚更好读）。
 *
 * @returns 丢掉的方块增量条数（只为日志）
 */
function clearRoom(room) {
  const prefix = `${room}|`;
  let removed = 0;
  for (const key of [...edits.keys()]) {
    if (!key.startsWith(prefix)) continue;
    edits.delete(key);
    removed++;
  }
  for (const key of [...containers.keys()]) if (key.startsWith(prefix)) containers.delete(key);
  for (const key of [...signs.keys()]) if (key.startsWith(prefix)) signs.delete(key);
  for (const key of [...frames.keys()]) if (key.startsWith(prefix)) frames.delete(key);
  /*
   * 掉落物（key 是 `ownerId:localId`，没有房名前缀）：按 owner 现在所在的房间判。
   * 房间关掉时同房的人马上就要被踢，他们的掉落物本来也会在各自宽限期里清掉；
   * 这里顺手清是为了"房主新上位"那条路——上一局的残留不该出现在新房主的世界里。
   */
  for (const [key, item] of [...items]) {
    if (players.get(item.owner)?.room === room) items.delete(key);
  }
  roomWorlds.delete(room);
  roomGameModes.delete(room);
  // 每房一套的时钟（用户 2026-10-26）：房间结束就丢，下一位房主带自己的时间进来
  clocks.delete(room);
  confirmedChunks.delete(room);
  requestedChunks.delete(room);
  return removed;
}

/**
 * 房主**主动退出** → 当场关房（用户 2026-10-26）。
 *
 * 与"掉线"的区别只有一个：主动退出是玩家说"我不玩了"，没有给他留 30 秒重连窗口的必要，
 * 房间里剩下的也不是"暂时没人模拟"，而是**这一局结束了**。继续留着只会让访客对着一个
 * 不推进的世界发呆（怪物不动、红石不亮），所以当场踢人 + 清缓存。
 *
 * 顺序：先删 `hosts`（后面所有人都在关连接，别让他们的 close 再走一遍"房主掉了"），
 * 再通知 + 踢人，最后清缓存。清除时 `players` 里还有这些人，掉落物能按房一起清掉。
 *
 * @returns 被踢出的人数（只为日志）
 */
function closeRoomNow(host) {
  const room = host.room;
  hosts.delete(room);
  // `reason: 'host-out'` + `graceMs: 0`：客户端据此显示"房主已退出"而不是倒计时
  broadcast({ t: 'room-closed', reason: 'host-out', graceMs: 0 }, null, room);
  let kicked = 0;
  for (const other of players.values()) {
    if (other.room !== room) continue;
    if (other.id === host.id) continue;
    reject(other.socket, 'host-left', '房主已退出，房间已关闭', CLOSE_HOST_LEFT);
    kicked++;
  }
  const dropped = clearRoom(room);
  log(
    `房间 ${room} 已关闭（房主 ${host.name}#${host.id} 主动退出），踢出 ${kicked} 人，丢弃 ${dropped} 条缓存改动`,
  );
  return kicked;
}

function snapshotFor(player) {
  // 地形由**房主那个世界**的种子决定（L9）：`seed` 与 `world.seed` 同一份，
  // 老客户端只读 `seed` 也能对上；没房主的房退回服务端默认种子
  const world = worldOfRoom(player.room);
  /*
   * 房主的 welcome **不带任何世界数据**（用户 2026-10-26）。
   *
   * 他本地那个存档就是真相，服务端缓存里的东西（清场之后通常本来就是空的）对他只有
   * 害处：万一哪天清场漏了，这些内容会在进房那一刻把他刚改的东西顶回旧值。
   * 从属端照旧拿（他们的地形就是靠这份 + 按区块补发来的）。
   */
  const isHost = player.isHost === true;
  // 这个玩家附近的增量（半径裁剪照旧，只发他看得见的那一圈）
  const nearEdits = isHost ? [] : selectSnapshotEdits(roomScopedValues(edits, player.room), player);
  return {
    seed: world.seed,
    world: {
      name: world.name,
      seed: world.seed,
      mode: world.mode,
      difficulty: world.difficulty,
      worldType: world.worldType ?? '',
    },
    /*
     * 房主（L8）：这一局谁在跑模拟。
     *
     * `isHost` 只对**收快照的这个人**有意义（"我是不是房主"），`hostId` 是房里那一名的
     * 服务端 id（从属端拿它显示"房主：#3"、后续"房主退出"也靠它对号）。
     * 没房主的房（有人直接 join 没带 host）一律 `hostId: null`，客户端据此知道
     * 这一局没人跑模拟——比静默当成"我在跑"安全。
     */
    isHost: player.isHost === true,
    hostId: hosts.get(player.room)?.id ?? null,
    // 这一局**当前**的游戏模式（房主中途改过也认这里，见 `roomGameModes`）
    gameMode: roomGameModes.get(player.room) ?? world.mode ?? null,

    // 时间权威（联机10）：进服先对齐一次，之后靠每 2s 的 `time` 广播校正
    // 三者都取**本房**的时钟（用户 2026-10-26：每房一套）
    timeOfDay: currentTimeOfDay(clockOf(player.room)),
    // 天数权威（用户 2026-10-25）：与时间一起下发，晚加入的人不再从第 0 天开始
    day: currentDay(clockOf(player.room)),
    // 天气权威（联机35）：进服先对齐一次，之后靠切换时的广播
    weather: clockOf(player.room).weather.kind,
    players: [...players.values()]
      .filter((p) => p.room === player.room)
      .map((p) => ({
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
    // 且**只带本房**的（联机26：key 前缀就是房名）
    /*
     * 方块增量（2026-10-26）：改发**压缩格式**（`editsPack`），老字段 `edits` 留空。
     *
     * 两者的内容是同一批（`selectSnapshotEdits` 的半径裁剪没变）：压缩只是把
     * `[x,y,z,id,state,"overworld"]` 换成"按区块分组 + 区块内下标"，一条从 30 多字符
     * 降到 10 个左右。客户端在 `NetClient` 里解包，`onWelcome` 拿到的还是老形状。
     */
    edits: [],
    editsPack: encodeEditsPack(nearEdits, player.dimension),
    // 地上的掉落物：新玩家进来要看得见（L7 第一刀）；owner 必须同房
    // 同房 + **同维度**（联机31）：下界掉的东西不该画在主世界同坐标。
    // 房主也收（他要看见队友丢在地上的东西），这不是"世界数据"。
    items: [...items.values()].filter(
      (item) => players.get(item.owner)?.room === player.room && item.dimension === player.dimension,
    ),
    // 容器内容（联机13）与牌子/展示框（联机16）：同样只带本房；房主不带（见上面 isHost 的说明）
    containers: isHost ? [] : roomScopedValues(containers, player.room),
    signs: isHost ? [] : roomScopedValues(signs, player.room),
    frames: isHost ? [] : roomScopedValues(frames, player.room),
  };
}

/*
 * `maxPayload`（联机25）：`ws` 默认是 100MB——一条手工构造的消息就能让服务端
 * 先分配 100MB 再解析。64KB 足够容纳最大的合法消息（`blocks` 一批 256 条约 8KB，
 * 容器 8192 字节上限），超了 `ws` 会以 1009 关连接。
 */
/**
 * 同一个端口既跑 WebSocket 也跑 `/healthz`（联机28）。
 *
 * 为什么不另开一个健康检查端口：容器/反代只需要暴露一个口；而且 `ws` 支持
 * "挂在已有 HTTP server 上"，升级请求由它自己接管，普通请求落到这里。
 */
/**
 * 房间列表（L9）：给客户端的"加入房间"面板自动列出，省得手敲房名。
 *
 * 只列**当前有人**的房间（空房间没有加入的意义，它们的存档还在磁盘上躺着）。
 * **不下发口令**：口令是进房的门槛，不是菜单上的信息；这里只说"这个服务器要不要口令"。
 * 世界名与种子要发：加入的人靠它知道"进去会是哪片大陆"（面板上直接写出来）。
 */
function roomsListing() {
  const byRoom = new Map();
  for (const p of players.values()) {
    let entry = byRoom.get(p.room);
    if (!entry) {
      entry = { room: p.room, players: 0, hasHost: false };
      byRoom.set(p.room, entry);
    }
    entry.players += 1;
    if (p.isHost === true) entry.hasHost = true;
  }
  return [...byRoom.values()]
    .map((entry) => ({ ...entry, world: worldOfRoom(entry.room) }))
    .sort((a, b) => a.room.localeCompare(b.room));
}

const httpServer = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  /*
   * `/rooms`（L9）：浏览器要从 `http://localhost:5173` 跨源读它，所以必须带 CORS。
   * 内容是"哪个房间有人 + 世界叫什么"，没有口令、没有玩家名——局域网里谁都能看，
   * 这也正是"自动发现房间"想要的效果。
   */
  if (path === '/rooms') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: PROTOCOL_VERSION,
        // 服务端级口令（`ROOM_PASSWORD`）：客端据此提示"要口令"
        passwordRequired: Boolean(ROOM_PASSWORD),
        rooms: roomsListing(),
      }),
    );
    return;
  }
  /*
   * 局域网探测（用户 2026-10-26）。
   *
   * 「选择服务器」要先知道哪个地址有人在听：客户端对一个网段的 254 个地址并发打这个接口，
   * 谁能马上回谁就是候选，耗时差就是 RTT。所以这条必须：
   *  · **无状态**——不建玩家、不占房主位、不碰任何房间状态（打一次只花几微秒）；
   *  · **不缓存**——`no-store`，否则第二次扫描拿到的是缓存，测出来的"0ms"是假的；
   *  · 负载极小——几十字节，254 个并发也不会把服务端压出问题。
   * 为什么不复用 `/healthz`：那个要算吞吐/房间数，是给人看的；探测只想要"最快的一个字节"。
   */
  if (path === '/ping') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
    });
    res.end(JSON.stringify({ ok: true, t: Date.now(), v: PROTOCOL_VERSION }));
    return;
  }
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        players: players.size,
        rooms: roomsInUse().size,
        uptime: Math.round(process.uptime()),
        seed: WORLD_SEED,
        protocol: PROTOCOL_VERSION,
        // 最近一段时间的平均吞吐（联机29）：容器/反代拿它看"这条线路是不是堵了"
        traffic: trafficRates(),
        totals: { inBytes: traffic.inBytes, outBytes: traffic.outBytes },
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('minicraft multiplayer server（WebSocket 请连这个地址的根路径）');
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });

httpServer.listen(PORT, () => {
  // 打**实际绑定**的端口，而不是环境变量里的那个：PORT=0 时由系统挑端口
  // （测试用，避免两棵并行工作树抢同一个 8799 / 抢占同一台机器上的固定端口）
  const bound = httpServer.address();
  const port = typeof bound === 'object' && bound ? bound.port : PORT;
  log(`已启动，端口 ${port}，种子 ${WORLD_SEED}（健康检查 /healthz）`);
  /*
   * 把**局域网地址**打出来（用户 2026-10-26："手机上想连电脑上的服务器，不知道填什么"）。
   *
   * 以前这里只打 `ws://localhost:${port}`——那句话只对**跑服务端的这台机器**成立，
   * 别的设备填 localhost 指的是它自己，必然连不上，而且看不出是哪里错了。
   * 顺带把网卡列表打全：一台机器常见「有线 + 无线 + 虚拟网卡」好几个地址，
   * 玩家可以逐个在手机浏览器里试 `http://<ip>:<port>/healthz`。
   */
  const lanAddresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry !== undefined && entry.internal === false && entry.family === 'IPv4')
    .map((entry) => entry.address);
  if (lanAddresses.length > 0) {
    log('局域网地址（同一 Wi-Fi 下的手机/别的电脑填这些）：');
    for (const address of lanAddresses) log(`  ${address}   →  ws://${address}:${port}`);
  }
  log(`本机自连：ws://localhost:${port}（只有这台机器能用）`);
  if (ALLOWED_ORIGINS.length > 0) log(`来源白名单：${ALLOWED_ORIGINS.join(', ')}`);
  if (ROOM_PASSWORD) log('已启用房间口令（ROOM_PASSWORD）');
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
/**
 * **每房一套**时钟（用户 2026-10-26）。
 *
 * 以前是"整个服务端一套"：房主 A 在房甲玩到深夜，房主 B 在房乙开房上报中午，
 * 服务端采纳后广播给所有房间，A 那边的太阳会突然跳到中午。既然世界以房主本地为准，
 * 时间与天气也该跟着房间走。
 *
 * 结构：`room → clock`。房主开房时新建（并用他上报的值初始化），`clearRoom` 时删掉；
 * 没有房主的房（有人直接 join）与"读档后的默认值"用 `defaultClock`。
 *
 * ⚠️ 取整时机必须与客户端 `advanceDay()` 同一条线（时间跨过午夜、取模变小），
 * 否则两边会差一天，而这种差一天只在玩到半夜才暴露。纯函数版本在
 * `src/core/net/NetTime.ts#dayAt`，`tests/net-time.test.ts` 钉着它的口径。
 */
function createClock() {
  return {
    /** 这一天的起点时刻（`sleep` 会把它重置成"现在"，等于把时间拨回清晨） */
    startMs: Date.now(),
    /** 起点时刻对应的一天中的时间 */
    startTimeOfDay: DAWN_TIME_OF_DAY,
    /** 起点对应第几天 */
    startDay: 0,
    /** 天气（联机35）：晴天/雨/雷暴，每房自己走自己的状态机 */
    weather: { kind: 'clear', seconds: weatherSecondsFor(Math.random, 'clear') },
  };
}
/** 兜底时钟：没有房主的房、以及读档时的默认值 */
const defaultClock = createClock();
/** room → clock：房主开房时新建，`clearRoom` 时删掉 */
const clocks = new Map();
/** 这个房间的时钟（没有就退回兜底那份） */
function clockOf(room) {
  return clocks.get(room) ?? defaultClock;
}
function currentDay(clock = defaultClock) {
  const elapsed = (Date.now() - clock.startMs) / DAY_LENGTH_MS;
  return clock.startDay + Math.max(0, Math.floor(elapsed + clock.startTimeOfDay));
}
function currentTimeOfDay(clock = defaultClock) {
  const value = (Date.now() - clock.startMs) / DAY_LENGTH_MS + clock.startTimeOfDay;
  return value - Math.floor(value);
}

/** 时间校正广播：2 秒一条、按房各发一份；没人时什么都不发 */
const clockTimer = setInterval(() => {
  if (players.size === 0) return;
  for (const room of roomsInUse()) {
    const clock = clockOf(room);
    broadcast({ t: 'time', timeOfDay: currentTimeOfDay(clock), day: currentDay(clock) }, null, room);
  }
}, 2000);
clockTimer.unref?.();

/**
 * 天气权威（联机35）：晴天/雨/雷暴由服务端决定，切换时广播。
 *
 * 客户端那边有一套完整的状态机（8~16 分钟晴天、45% 继续晴 / 55% 转雨、30% 雷暴），
 * 联机时让它**让位**——否则两个人各自掷骰子，永远对不上。
 *
 * 每房自己走一份（用户 2026-10-26）：兜底时钟那份也照常推进（给没有房主的房用）。
 */
function tickClockWeather(clock) {
  const next = tickWeather(clock.weather, 2, Math.random);
  const changed = next.kind !== clock.weather.kind;
  clock.weather = next;
  return changed;
}
const weatherTimer = setInterval(() => {
  const active = roomsInUse();
  const changedDefault = tickClockWeather(defaultClock);
  if (changedDefault && active.size > 0) {
    // 用兜底时钟的房间（没有房主的那种）一起收
    for (const room of active) {
      if (clocks.has(room)) continue;
      broadcast({ t: 'weather', kind: defaultClock.weather.kind }, null, room);
    }
  }
  for (const [room, clock] of clocks) {
    if (!tickClockWeather(clock)) continue;
    broadcast({ t: 'weather', kind: clock.weather.kind }, null, room);
    log(`房间 ${room} 天气切换到 ${clock.weather.kind}`);
  }
}, 2000);
weatherTimer.unref?.();

/**
 * 运行统计日志（联机29）：每 10 秒一行。
 *
 * 只在有人在线上时打（空房间刷日志没有意义）；消息速率也一起打——它比字节更早暴露
 * "某个客户端在疯狂发包"（字节会被单条大消息带偏）。
 */
const statsTimer = setInterval(() => {
  if (players.size === 0) return;
  const rates = trafficRates();
  log(
    `统计：在线 ${players.size} 人 / 房间 ${roomsInUse().size} 个 / ` +
      `↓${formatBytesPerSecond(rates.inBytesPerSecond)} ↑${formatBytesPerSecond(rates.outBytesPerSecond)} / ` +
      `消息 ↓${rates.inMessagesPerSecond}/s ↑${rates.outMessagesPerSecond}/s`,
  );
}, 10_000);
statsTimer.unref?.();

// ---------------------------------------------------------------- 持久化（联机13）

/** 当前世界的完整快照（落盘用） */
function worldSnapshot() {
  /*
   * ⚠️ **这里只有"非世界数据"，没有任何房间内容**（用户 2026-10-26）。
   *
   * 世界（方块增量 / 容器 / 牌子 / 展示框）以**房主本地存档**为唯一真相，服务端只当
   * 这一局的缓存；房间一结束就清（`clearRoom`）。落盘一份"世界的副本"会立刻变成
   * 第二份事实：重启后它会被 `welcome` 发出去，把房主本地的世界改回上一次的样子。
   *
   * 留下的三样是**兜底时钟**（`defaultClock`）：每个房间的时钟由房主开房时上报，
   * 只存在内存里、随房间一起清掉；这份落盘的是"没有房主的房"用的那套，
   * 顺带保证"重启之后时间接着走"（停机期间世界停着）。
   */
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    timeOfDay: Number(currentTimeOfDay(defaultClock).toFixed(6)),
    // 天数（用户 2026-10-25）：重启之后接着数，否则一个晚上的存档会让世界回到第 0 天
    day: currentDay(defaultClock),
    // 天气（联机35）：重启后接着上次的天气跑
    weather: defaultClock.weather.kind,
  };
}

/**
 * 启动时读档：**只把三个全局量灌回来**（时间 / 天数 / 天气）。
 *
 * 时间用"存档时刻的时间"做新的起点——服务端停机的那段时间不走（原版服务器关掉的
 * 时候世界也是停的），这比"按真实时间补算"更符合直觉，也不会出现"重启后突然变成深夜"。
 *
 * ⚠️ 老版本（v1）的存档里还有 edits/containers/signs/frames 四张表（那时候服务端自己
 * 存世界）。它们现在**一律不读**：世界以房主本地为准，读回来就等于服务端抢先给房主
 * 灌了一份旧世界。`readSnapshot` 仍然接受 v1（时间照样拿来用），下一次保存会写成 v2。
 */
const loaded = readSnapshot(WORLD_FILE, log);
if (loaded.data) {
  const saved = loaded.data;
  if (saved.version !== SNAPSHOT_VERSION) {
    log(`存档是 v${saved.version}（当前 v${SNAPSHOT_VERSION}）：只沿用时间/天数/天气，房间数据不再读取`);
  }
  // 读档只回填**兜底时钟**（`defaultClock`）：有房主的房间用自己的那份，由房主上报
  if (isWeatherKind(saved.weather)) {
    defaultClock.weather = { kind: saved.weather, seconds: weatherSecondsFor(Math.random, saved.weather) };
  }
  if (typeof saved.timeOfDay === 'number' && Number.isFinite(saved.timeOfDay)) {
    defaultClock.startTimeOfDay = ((saved.timeOfDay % 1) + 1) % 1;
    defaultClock.startMs = Date.now();
  }
  if (typeof saved.day === 'number' && Number.isFinite(saved.day) && saved.day >= 0) {
    defaultClock.startDay = Math.trunc(saved.day);
  }
  log(
    `读档完成：兜底时钟 ${currentTimeOfDay(defaultClock).toFixed(2)} · 第 ${currentDay(defaultClock)} 天 · ` +
      `天气 ${defaultClock.weather.kind}（房间数据不落盘）`,
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

  /*
   * 来源校验（联机26）：只挡**带 Origin 且不在白名单**的连接。
   *
   * `ALLOWED_ORIGINS` 留空 = 不校验（内网自建默认，否则更新完就连不上）；
   * 无 Origin 的放行（node 机器人 / 原生客户端不带，浏览器一定带）。
   */
  const origin = request.headers.origin;
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    reject(socket, 'origin', `来源不被允许：${origin}`, CLOSE_ORIGIN);
    return;
  }

  // 心跳（联机7）：ping 是协议层帧，浏览器会自动回 pong（它不能主动 ping）
  socket.lastPongAt = Date.now();
  socket.on('pong', () => {
    socket.lastPongAt = Date.now();
  });

  socket.on('message', (raw) => {
    // 入站统计（联机29）：按原始文本长度
    traffic.inBytes += String(raw).length;
    traffic.inMessages++;
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

        /*
         * 房间（联机26）：非法房名回默认房间（房名是数据 key 的前缀，不能透传）。
         * 密码只做"进房口令"，不是鉴权——明文、只防隔壁同事随手连。
         */
        const room = sanitizeRoom(message.room);
        if (ROOM_PASSWORD && String(message.password ?? '') !== ROOM_PASSWORD) {
          return reject(socket, 'password', '房间密码不对', CLOSE_PASSWORD);
        }

        /*
         * 房主（L8）：一个房间只认一名房主，第二个带 `host: true` 的 join 直接拒。
         *
         * **不退化成从属端**：静默降级会让两端都以为自己说了算，而这一批要消灭的正是
         * 那种"同一只怪两边血量不同"——退回客户端再提示，玩家还是先进来了，只是换了个
         * 身份，看起来像成功。拒绝 + `host-taken` 才能让他停在一句明确的话上。
         *
         * 宽限期内重连的房主还是他本人（`grace.id` 就是原 id），不该把自己挡在门外。
         */
        const wantsHost = message.host === true;
        const host = hosts.get(room);
        if (wantsHost && host && host.id !== grace?.id) {
          return reject(socket, 'host-taken', '这个房间已经有房主了', CLOSE_HOST_TAKEN);
        }
        /*
         * 房主不在线 → 访客不许进（用户 2026-10-26）。
         *
         * `hosts` 里登记着房主、但那名玩家已经不在 `players` 里（断线进宽限期了）：
         * 这时房间里没有人在跑模拟。以前访客照样能进来，看到的是一个**不推进的世界**
         * ——怪物不动、红石不亮、熔炉不烧，而界面一切正常，最难查。
         * 宽限期一过房间就关，所以他下一次试也进不来（要么房主回来了，要么房没了）。
         */
        if (!wantsHost && host && !players.has(host.id)) {
          return reject(socket, 'host-offline', '房主暂时不在房间，等他回来再来', CLOSE_HOST_OFFLINE);
        }

        const name = sanitizeName(message.name);
        /*
         * 昵称唯一（用户要求）：同一个房间里不允许两个同名玩家。
         *
         * 为什么必须在**进房之前**拒绝而不是进去之后加后缀：房间进出提示、聊天、
         * 队伍、友伤判定全都按昵称对号，两个"小明"会让"谁在说话、谁能打谁"全部含糊。
         * 明确让他停在一句"改个名字再来"，比静默改名（他会以为自己叫那个）可控。
         *
         * 只比同房：不同房间的两个人同名互不影响。宽限期内重连的人不在 `players` 里，
         * 所以不会把自己挡在门外。
         */
        for (const other of players.values()) {
          if (other.room === room && other.name === name) {
            return reject(
              socket,
              'duplicate-name',
              `房间内已有同名玩家「${name}」，请改名后再加入`,
              CLOSE_DUPLICATE_NAME,
            );
          }
        }
        player = {
          id: grace ? grace.id : nextPlayerId++,
          name,
          room,
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
          // 队伍名（联机22）：随 move 上报，转发给其他人判友伤
          team: '',
          // 生物命中的令牌窗口（联机19，见 MOB_HIT_RATE_LIMIT）
          hitWindow: 0,
          hitCount: 0,
          // 拾取申请的令牌窗口（联机21，见 ITEM_TAKE_RATE_LIMIT）
          takeWindow: 0,
          takeCount: 0,
          // 箭/TNT 的令牌窗口（联机23，见 EFFECT_RATE_LIMIT）
          effectWindow: 0,
          effectCount: 0,
          // 方块/容器/聊天的令牌桶（联机25）
          buckets: createBuckets(),
          // 房主（L8）：他这一局跑模拟，其他人只渲染
          isHost: wantsHost,
          /*
           * 按视野补发（2026-10-26）：已经推过哪些区块的增量。
           * 键是 `维度|cx,cz`；玩家跨进新区块才推一次，走开再回来不重复推
           * （回来时那些格子已经在他本地世界里了）。
           */
          sentEditChunks: new Set(),
          // 已经发了几条 `session-sync`（用户 2026-10-26）：只有房主用得上，防脚本无限刷
          syncMessages: 0,
        };
        players.set(player.id, player);
        if (wantsHost) {
          /*
           * 清场（用户 2026-10-26）：**新房主上位 = 新的一局**，服务端从这一刻起只当缓存，
           * 数据全部由房主本地上行（`session-sync` + 按区块的 `edits-reply`）。
           *
           * 唯一的例外是**宽限期内重连的房主本人**：`grace.id` 与 `hosts` 里那个 id 相同，
           * 他切后台 10 秒回来还是同一局，清了等于把队友眼前的世界抹掉一片。
           * 正常新开房时 `hosts` 里通常是空的（关房那一步已经清过），这里的清是**兜底**：
           * 服务端崩溃重启、或某个房名残留了上一轮的数据时，只有这一刀能保证
           * "房主一进来，前面的历史就不存在了"。
           * 清场必须在 `send(welcome)` 之前：`snapshotFor()` 读的就是这几张表。
           */
          const sameHostReturning = Boolean(grace) && hosts.get(room)?.id === player.id;
          if (!sameHostReturning) {
            const dropped = clearRoom(room);
            if (dropped > 0) log(`房间 ${room} 开房前清场（丢弃 ${dropped} 条残留改动）`);
          }
          hosts.set(room, { id: player.id, clientId: player.clientId });
          /*
           * 时间 / 天数 / 天气（用户 2026-10-25 起，2026-10-26 扩到三者全部 + 每房一套）：
           * **开房时以房主本地为准，而且只影响这一个房间**。
           *
           * 为什么这三个也要跟房主：房主退出房间后在本地继续玩，时间和天气都在他存档里走；
           * 重开房时若服务端还按自己那套时钟，房主一进来就会被拽到"服务端此刻"——
           * 界面上一句话都没有，但那不是他的世界了。
           *
           * 为什么每房一套：以前是全服一套，房主 B 在另一个房开房会把握着 A 那个房间的
           * 太阳一起拨过去。房间之间本来就各是各的世界，时钟没有共享的理由。
           *
           * 顺序：先定天数与时刻，最后才重置起点 `startMs`——反了会凭空多算一天。
           */
          if (!sameHostReturning) {
            const clock = createClock();
            const hostDay = Number(message.day);
            const hostTime = Number(message.timeOfDay);
            if (Number.isInteger(hostDay) && hostDay >= 0) clock.startDay = hostDay;
            // 脏数据（没带/NaN）就保留默认时刻：老客户端不带这个字段，不能因此把时间清零
            if (Number.isFinite(hostTime)) clock.startTimeOfDay = ((hostTime % 1) + 1) % 1;
            clock.startMs = Date.now();
            if (isWeatherKind(message.weather)) {
              clock.weather = { kind: message.weather, seconds: weatherSecondsFor(Math.random, message.weather) };
            }
            clocks.set(room, clock);
            /*
             * 广播对齐（只发本房）：`snap` = 立刻对齐，不走"4 倍速收敛"那套。
             * 这时房主本人在 `players` 里，所以也收得到，无害。
             */
            broadcast(
              { t: 'time', timeOfDay: currentTimeOfDay(clock), day: currentDay(clock), snap: true },
              null,
              room,
            );
            broadcast({ t: 'weather', kind: clock.weather.kind }, null, room);
            log(
              `房间 ${room} 采用房主的时间：第 ${currentDay(clock)} 天 ${currentTimeOfDay(clock).toFixed(2)} · ` +
                `天气 ${clock.weather.kind}`,
            );
          }
          /*
           * 世界（L9）：**只有房主能定这一局用哪个世界**。
           *
           * 从属端带来的 `world` 一律不看——它本来也不该带（客户端只在开房时填）。
           * `sanitizeWorldMeta` 返回 `null` 时（没带 / 种子是脏数据）保留房间原有的那份：
           * 房主重连、换客户端重开都能沿用，不至于把已在地图上的队友踢进另一片大陆。
           */
          const meta = sanitizeWorldMeta(message.world);
          if (meta) {
            roomWorlds.set(room, meta);
            log(`房间 ${room} 的世界：${meta.name || '(未命名)'} · 种子 ${meta.seed}`);
          }
        }

        send(socket, {
          t: 'welcome',
          // 客户端据此确认"我连上的是我认识的那版协议"（服务端已经先校验过一次）
          v: PROTOCOL_VERSION,
          id: player.id,
          name: player.name,
          ...snapshotFor(player),
        });
        broadcast(
          {
            t: 'player',
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: 0,
            pitch: 0,
            dimension: player.dimension,
            /*
             * 房主标识（用户 2026-10-25："我看所有人都是房主"）。
             *
             * 以前 `hostId` 只在 `welcome` 里下发一次：房主中途离开/换人之后，客户端那份
             * 永远停在旧值——名字牌该标的没标、不该标的还标着。把"这条 player 是不是房主"
             * 随每条广播带出去，客户端就不用猜。
             */
            isHost: hosts.get(player.room)?.id === player.id,
          },
          player.id,
          player.room,
        );
        // 入服立刻探一次活（联机7）：不用等下一个 5s 心跳窗口，半开连接能早 5s 被发现，
        // 测试也不必白等一个完整间隔
        socket.ping();
        log(`${name}#${player.id} 加入（来自 ${address}）${wantsHost ? ' · 房主' : ''}，当前 ${players.size} 人`);
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
        // 队伍（联机22）：空串 = 没队伍；只在变了的时候改，避免每条 move 都写一遍
        const team = String(message.team ?? '').slice(0, 32);
        if (team !== player.team) player.team = team;
        // 按视野补发（2026-10-26）：跨进新区块就把那一块的方块增量推给他
        pushChunkEdits(player);
        // 外观（联机17）：只认白名单字段，收口后原样转发
        player.appearance = readAppearance(message);
        broadcast(
          {
            t: 'player',
            id: player.id,
            name: player.name,
            // 房主标识（用户 2026-10-25）：随每条位置广播带出去，见 join 分支里的说明
            isHost: hosts.get(player.room)?.id === player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: player.yaw,
            pitch: player.pitch,
            dimension: player.dimension,
            ...player.appearance,
            ...(player.team ? { team: player.team } : {}),
          },
          player.id,
          player.room,
          // 批量用**发起者位置**当中心：这批改动都在他 64 格内（联机24 的距离闸）
          { x: player.x, z: player.z, dimension: player.dimension },
        );
        break;
      }

      case 'block': {
        if (!player) return;
        /*
         * 有房主的房里只收房主的坐标类消息（L8 · MS2）。
         *
         * 从属端的改动走 `edit-request`（由房主落地后以权威结果重发），这条老路留着是给
         * **没有房主的房**用的（有人直接 join、没带 host；那种房子没人推进世界，谁改都一样）。
         * 有房主还放宽，等于把权威又还给了每个客户端。
         */
        if (hosts.has(player.room) && player.isHost !== true) {
          return rejectEdit(player, 'not-host', 'block');
        }
        // 限频（联机25）：一条改动花一个令牌
        if (!player.buckets.block.take()) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        const id = Math.trunc(Number(message.id));
        const state = Math.trunc(Number(message.state ?? 0));
        // 校验（联机24）：y 范围 / id 上界 / state 位宽 / 与玩家的距离
        const rejection = blockEditRejection(player, x, y, z, id, state);
        if (rejection) {
          rejectEdit(player, rejection, `${x},${y},${z}`);
          return;
        }

        if (edits.size < MAX_EDITS) {
          rememberEdit(
            edits,
            scopedKey(player.room, `${dimension}|${x},${y},${z}`),
            // `room` 一起存：按视野补发时按房间筛（见 `pushChunkEdits`）
            { x, y, z, id, state, dimension, room: player.room },
            MAX_EDITS,
            warnEvictedEdit,
          );
        }
        // 广播给其他人（含 by，方便客户端区分"自己改的"）
        broadcast(
          {
            t: 'block',
            x,
            y,
            z,
            id,
            state,
            dimension,
            by: player.id,
            // 权威标记（MS2）：由**服务端**按 isHost 重新判定，不信客户端传上来的那个值
            authority: player.isHost === true,
          },
          player.id,
          player.room,
          { x, z, dimension },
        );
        break;
      }

      /*
       * 实体消失（L8 · MS3）：房主说"这几只没了"。
       *
       * 为什么要单独一条而不是等快照里消失：快照失踪有 300ms 宽限（AOI 边界会抖），
       * 死亡用宽限会出现"打死了还站着 0.3 秒"，而且掉落的瞬间会看不到。
       */
      case 'entity-remove': {
        if (!player) return;
        if (hosts.has(player.room) && player.isHost !== true) return;
        const keys = sanitizeEntityKeys(message.keys);
        if (!keys) return;
        broadcast({ t: 'entity-remove', keys, by: player.id }, player.id, player.room);
        break;
      }

      /*
       * 实体快照（L8 · MS3）：房主每 100ms 推一次，服务端**只按房间 + AOI 转发**。
       *
       * 为什么不做内容校验：服务端没有世界也没有生物表，判不了"这只僵尸该不该在这"。
       * 形状收口（是不是数组、超不超过上限）在这里，语义把关在两端。
       */
      case 'entity-snap': {
        if (!player) return;
        // 只有房主能推：别人推过来的"实体在世界哪"没有意义（谁模拟谁是权威）
        if (hosts.has(player.room) && player.isHost !== true) return;
        const entities = sanitizeEntitySnap(message.entities);
        if (!entities || entities.length === 0) return;
        broadcast(
          { t: 'entity-snap', by: player.id, entities },
          player.id,
          player.room,
          // 与方块同一条 AOI：用**发送者**的位置当中心，这批实体都在他视野内
          { x: player.x, z: player.z, dimension: player.dimension },
        );
        break;
      }

      /*
       * 从属端的改动请求（L8 · MS2）→ **只转给本房房主**。
       *
       * 为什么要有这条路：房主权威之后世界只由房主推进，但从属端仍然是"能建造"的
       * （拆、放、开箱子）。直接丢弃它的 `blocks` 等于没收建造能力，所以改动以
       * "请求"的形式回到房主：房主在自己的世界里应用、再由 `BlockFunnel` 作为
       * **权威结果**广播出去。服务端在这条链上只做路由——不判权、不落地、不校验内容
       * （形状收口在 `sanitizeEditPayload`，世界语义由房主那端把关）。
       */
      /*
       * 房主改房间配置（本轮：时间 / 天气）。
       *
       * 这两样都是服务端权威（`time` 每 2s 广播校正、`weather` 只在切换时广播），
       * 客户端自己改会被下一轮覆盖——所以房主改完发一条这里应用，再立刻广播给全房，
       * 两端当场对齐。只收房主：从属端改了没有意义（它不推进世界）。
       */
      case 'room-config': {
        if (!player) return;
        if (player.isHost !== true) {
          send(socket, { t: 'error', code: 'not-host', message: '只有房主能修改房间设置' });
          return;
        }
        const timeOfDay = Number(message.timeOfDay);
        /*
         * 广播给**全房**（用户 2026-10-26："房间的设置发生了变化，房里所有人都该收到消息"）。
         * 时间/天气本身另有 `time` / `weather` 两条权威消息，这条是"谁改了什么"的通知，
         * 客户端据此打一行系统提示；房主也收（他自己也要在聊天区看到那一行）。
         */
        const applied = {};
        // 只改**本房**的时钟（用户 2026-10-26：每房一套；别的房在玩自己的时间）
        const clock = clockOf(player.room);
        if (Number.isFinite(timeOfDay)) {
          // 与"有人睡满跳夜"同一条路：把开局时刻重置成现在，广播 snap 让客户端立刻对齐
          // 换起点前先把"今天"结算掉：否则改时间会被当成"这一天重新开始"，天数倒退
          clock.startDay = currentDay(clock);
          clock.startTimeOfDay = ((timeOfDay % 1) + 1) % 1;
          clock.startMs = Date.now();
          broadcast(
            { t: 'time', timeOfDay: currentTimeOfDay(clock), day: currentDay(clock), snap: true },
            null,
            player.room,
          );
          applied.timeOfDay = currentTimeOfDay(clock);
        }
        if (isWeatherKind(message.weather)) {
          clock.weather = { kind: message.weather, seconds: weatherSecondsFor(Math.random, message.weather) };
          broadcast({ t: 'weather', kind: clock.weather.kind }, null, player.room);
          applied.weather = clock.weather.kind;
          log(`房主 ${player.name} 把天气改成 ${clock.weather.kind}（房间 ${player.room}）`);
        }
        // 游戏模式（用户 2026-10-26）：房主改完，房里所有人都跟着变
        if (GAME_MODE_VALUES.includes(String(message.gameMode ?? ''))) {
          roomGameModes.set(player.room, message.gameMode);
          applied.gameMode = message.gameMode;
        }
        if (Object.keys(applied).length > 0) {
          broadcast({ t: 'room-config', ...applied, by: player.name }, null, player.room);
        }
        break;
      }

      case 'edit-request': {
        if (!player) return;
        // 借用方块令牌桶：一条请求一格，防止有人把房主刷爆
        if (!player.buckets.block.take()) return;
        const hostEntry = hosts.get(player.room);
        const hostPlayer = hostEntry ? players.get(hostEntry.id) : undefined;
        if (!hostPlayer) {
          // 房里没房主（或房主刚掉线）：明确回执，让从属端知道自己这刀没人接
          send(socket, { t: 'edit-request', ok: false, reason: 'no-host' });
          return;
        }
        const payload = sanitizeEditPayload(message.payload);
        if (!payload) return;
        send(hostPlayer.socket, { t: 'edit-request', from: player.id, payload });
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
        // 同上（L8 · MS2）：有房主的房里，从属端不该再走这条老路
        if (hosts.has(player.room) && player.isHost !== true) {
          return rejectEdit(player, 'not-host', 'blocks');
        }
        const list = Array.isArray(message.blocks) ? message.blocks.slice(0, MAX_BLOCKS_PER_MESSAGE) : [];
        // 限频（联机25）：**按条数**计费——一次爆炸几百格是正常的，持续每帧几百格不是
        if (!player.buckets.block.take(Date.now(), list.length)) return;
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
          // 与单条 `block` 同一套校验（联机24）：坏条目单独丢，不整包拒绝
          if (blockEditRejection(player, edit.x, edit.y, edit.z, edit.id, edit.state)) continue;
          rememberEdit(
            edits,
            scopedKey(player.room, `${edit.dimension}|${edit.x},${edit.y},${edit.z}`),
            { ...edit, room: player.room },
            MAX_EDITS,
            warnEvictedEdit,
          );
          accepted.push(edit);
        }
        if (accepted.length === 0) return;
        broadcast(
          {
            t: 'blocks',
            blocks: accepted.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
            by: player.id,
            // 同上：服务端按 isHost 重新标注，不是照抄客户端的 `authority`
            authority: player.isHost === true,
          },
          player.id,
          player.room,
        );
        break;
      }

      /*
       * 房主回一个区块的整块增量（用户 2026-10-26 懒上行）。
       *
       * 为什么要一条独立消息、而不是复用 `blocks`：
       *  · **空区块必须能回答"这块没改过"**，否则服务端永远不知道该块已确认，会无限请求；
       *    而 `blocks` 的空列表在现有逻辑里是直接 return 的（连广播都不发）。
       *  · 回包要能精确对上"我请求过的那一块"：清 `requested`、标 `confirmed`，
       *    这是 `blocks`（房主的实时改动）不该做的事。
       *
       * 校验与 `blocks` 同口径（`blockEditRejection` 对房主不设距离闸），坏条目单独丢。
       * 收下后按房广播 `blocks`——客户端零改动，走的就是它本来就在处理的补发消息。
       */
      case 'edits-reply': {
        if (!player) return;
        // 只有本房房主能回（别人的"整块快照"没有权威性）
        if (hosts.get(player.room)?.id !== player.id) return;
        const dimension = sanitizeDimension(String(message.dimension ?? 'overworld'));
        const cx = Math.trunc(Number(message.cx));
        const cz = Math.trunc(Number(message.cz));
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
        const key = `${dimension}|${cx},${cz}`;
        const list = Array.isArray(message.blocks) ? message.blocks.slice(0, MAX_BLOCKS_PER_MESSAGE) : [];
        const accepted = [];
        for (const raw of list) {
          if (!Array.isArray(raw)) continue;
          const [rawX, rawY, rawZ, rawId, rawState] = raw;
          const edit = {
            x: Math.trunc(Number(rawX)),
            y: Math.trunc(Number(rawY)),
            z: Math.trunc(Number(rawZ)),
            id: Math.trunc(Number(rawId)),
            state: Math.trunc(Number(rawState ?? 0)),
            // 维度以信封为准：一条回包只属于一个区块，条目里带什么维度都不该改这件事
            dimension,
          };
          if (blockEditRejection(player, edit.x, edit.y, edit.z, edit.id, edit.state)) continue;
          // 收到的必须是这一块里的坐标（防止一次回包把远处的东西写进缓存）
          if (edit.x >> 4 !== cx || edit.z >> 4 !== cz) continue;
          rememberEdit(
            edits,
            scopedKey(player.room, `${dimension}|${edit.x},${edit.y},${edit.z}`),
            { ...edit, room: player.room },
            MAX_EDITS,
            warnEvictedEdit,
          );
          accepted.push(edit);
        }
        rememberTracked(confirmedChunks, player.room, key);
        requestedChunks.get(player.room)?.delete(key);
        if (accepted.length > 0) {
          broadcast(
            {
              t: 'blocks',
              blocks: accepted.map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
              authority: true,
            },
            player.id,
            player.room,
          );
        }
        break;
      }

      /*
       * 房主进房时把容器/牌子/展示框整份推上来（用户 2026-10-26）。
       *
       * 服务端清场之后这三张表是空的，而队友 `welcome` 里的箱子内容只能来自房主——
       * 方块可以按区块懒补，箱子不行（打开看到空的就会往里放东西，然后被覆盖）。
       *
       * 为什么不像 `container` 那样走令牌桶：这是一次性整份推（一世界通常几十条），
       * 按条限频会让"箱子多的世界"永远推不完。改成**按条数计上限**（`syncMessages`）。
       *
       * 形状校验与各自的单向消息同口径（坐标/y 范围/slots 长度与字节数/四行文字），
       * 但不设距离闸：房主的位置与世界里的箱子毫无关系，他可能在几千格外。
       */
      case 'session-sync': {
        if (!player) return;
        // 只有本房房主能推：别人推来的"世界散件"没有权威性
        if (hosts.get(player.room)?.id !== player.id) return;
        if (player.syncMessages >= SESSION_SYNC_MAX_MESSAGES) return;
        player.syncMessages++;

        const kind = String(message.kind ?? '');
        const list = Array.isArray(message.items) ? message.items.slice(0, SESSION_SYNC_BATCH) : [];
        const out = [];
        if (kind === 'container') {
          for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const dimension = sanitizeDimension(String(raw.dimension ?? player.dimension));
            const x = Math.trunc(Number(raw.x));
            const y = Math.trunc(Number(raw.y));
            const z = Math.trunc(Number(raw.z));
            if (![x, y, z].every(Number.isFinite)) continue;
            if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) continue;
            const slots = raw.slots;
            if (!Array.isArray(slots) || slots.length > 27) continue;
            if (JSON.stringify(slots).length > 8192) continue;
            if (containers.size >= MAX_CONTAINERS) continue;
            containers.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, slots });
            out.push({ t: 'container', dimension, x, y, z, slots, by: player.id });
          }
        } else if (kind === 'sign') {
          for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const dimension = sanitizeDimension(String(raw.dimension ?? player.dimension));
            const x = Math.trunc(Number(raw.x));
            const y = Math.trunc(Number(raw.y));
            const z = Math.trunc(Number(raw.z));
            if (![x, y, z].every(Number.isFinite)) continue;
            const lines = Array.isArray(raw.lines)
              ? raw.lines.slice(0, 4).map((line) => String(line).slice(0, 64))
              : [];
            if (signs.size >= MAX_SIGNS) continue;
            signs.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, lines });
            out.push({ t: 'sign', x, y, z, dimension, lines, by: player.id });
          }
        } else if (kind === 'frame') {
          for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const dimension = sanitizeDimension(String(raw.dimension ?? player.dimension));
            const x = Math.trunc(Number(raw.x));
            const y = Math.trunc(Number(raw.y));
            const z = Math.trunc(Number(raw.z));
            if (![x, y, z].every(Number.isFinite)) continue;
            const rawItem = raw.item;
            const item =
              rawItem && typeof rawItem === 'object'
                ? { id: Math.trunc(Number(rawItem.id)), count: Math.trunc(Number(rawItem.count ?? 1)) }
                : null;
            if (item && (!Number.isFinite(item.id) || !Number.isFinite(item.count))) continue;
            const rotation = Math.trunc(Number(raw.rotation ?? 0)) || 0;
            if (frames.size >= MAX_FRAMES) continue;
            frames.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, item, rotation });
            out.push({ t: 'frame', x, y, z, dimension, item, rotation, by: player.id });
          }
        } else {
          // 不认识的 kind：直接丢（不要因为一条脏消息把整条连接关掉）
          return;
        }
        // 收下之后按房广播：先进来的队友当场看到，后进来的从 `welcome` 拿（两边都不需要握手）
        for (const payload of out) broadcast(payload, player.id, player.room);
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
        // 有房主的房里只收房主的坐标类消息（L8 · MS4 收尾）：从属端改走 `edit-request`
        if (hosts.has(player.room) && player.isHost !== true) return rejectEdit(player, 'not-host', 'sign');
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        if (![x, y, z].every(Number.isFinite)) return;
        const lines = Array.isArray(message.lines)
          ? message.lines.slice(0, 4).map((line) => String(line).slice(0, 64))
          : [];
        if (signs.size < MAX_SIGNS) signs.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, lines });
        broadcast({ t: 'sign', x, y, z, dimension, lines, by: player.id }, player.id, player.room, { x, z, dimension });
        break;
      }

      /*
       * 生物命中（联机19）。
       *
       * 不带实体 id：两端生物是各自随机生成的，服务端也没有实体表。接收方按
       * "类型 + 坐标邻域"找自己世界里最近的那只（找不到就忽略，不能凭空生成）。
       * 所以服务端这里只做形状收口 + 限频，语义全在两端。
       */
      case 'mob-hit': {
        if (!player) return;
        const now = Date.now();
        if (now - player.hitWindow >= 1000) {
          player.hitWindow = now;
          player.hitCount = 0;
        }
        if (++player.hitCount > MOB_HIT_RATE_LIMIT) return;

        const typeId = String(message.typeId ?? '').slice(0, 32);
        if (!typeId) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        const x = Number(message.x);
        const y = Number(message.y);
        const z = Number(message.z);
        // 伤害与着火时长夹到合理区间：一个人不该能一发打死 100 血的怪
        const damage = Math.min(50, Math.max(0, Number(message.damage ?? 0)));
        const fire = Math.min(16, Math.max(0, Number(message.fire ?? 0)));
        if (![x, y, z, damage, fire].every(Number.isFinite)) return;
        // 全局键（L8 · MS3 收尾）：只做长度收口，服务端没有实体表不校验它是否存在
        const key = typeof message.key === 'string' ? message.key.slice(0, 32) : '';
        broadcast(
          { t: 'mob-hit', typeId, dimension, x, y, z, damage, fire, by: player.id, ...(key ? { key } : {}) },
          player.id,
          player.room,
          { x, z, dimension },
        );
        break;
      }

      /*
       * 打人（联机22）：**只转发给被击者**，不做友伤判定。
       *
       * 队伍规则（`friendlyFire`）存在客户端存档里，服务端没有队伍表——所以友伤只能在
       * 两端各自判：攻击者那边判一次（省一次往返），被击者再用消息里的 `fromTeam` 判一次
       * （不能只信对方）。
       */
      /*
       * 箭与 TNT（联机23）：都是"事件 + 坐标/速度"，不带实体 id。
       *
       * 箭在接收端重新生成一支跑物理（落点会差几厘米，但"看到队友在射箭"成立）；
       * TNT 用坐标当 key，接收端 `prime` 是幂等的，不会重复点火。
       */
      case 'arrow': {
        if (!player) return;
        if (!takeEffectToken(player)) return;
        const x = Number(message.x);
        const y = Number(message.y);
        const z = Number(message.z);
        const vx = Number(message.vx);
        const vy = Number(message.vy);
        const vz = Number(message.vz);
        if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return;
        // 一支箭不该每秒飞几百格：速度与伤害都夹住
        if (Math.hypot(vx, vy, vz) > 200) return;
        const damage = Math.min(50, Math.max(0, Number(message.damage ?? 0)));
        if (!Number.isFinite(damage)) return;
        broadcast({ t: 'arrow', x, y, z, vx, vy, vz, damage, by: player.id }, player.id, player.room, { x, z, dimension: player.dimension });
        break;
      }

      case 'tnt': {
        if (!player) return;
        // 有房主的房里只收房主的坐标类消息（L8 · MS4 收尾）：从属端改走 `edit-request`
        if (hosts.has(player.room) && player.isHost !== true) return rejectEdit(player, 'not-host', 'tnt');
        if (!takeEffectToken(player)) return;
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        if (![x, y, z].every(Number.isFinite)) return;
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        broadcast({ t: 'tnt', x, y, z, dimension, by: player.id }, player.id, player.room, { x, z, dimension });
        break;
      }

      case 'player-hit': {
        if (!player) return;
        const targetId = Math.trunc(Number(message.targetId));
        const target = players.get(targetId);
        if (!target || target.id === player.id) return;
        const damage = Math.min(50, Math.max(0, Number(message.damage ?? 0)));
        if (!Number.isFinite(damage) || damage <= 0) return;
        send(target.socket, {
          t: 'player-hit',
          fromId: player.id,
          fromName: player.name,
          fromTeam: String(message.team ?? '').slice(0, 32),
          damage,
        });
        break;
      }

      case 'frame': {
        if (!player) return;
        // 有房主的房里只收房主的坐标类消息（L8 · MS4 收尾）：从属端改走 `edit-request`
        if (hosts.has(player.room) && player.isHost !== true) return rejectEdit(player, 'not-host', 'frame');
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
        if (frames.size < MAX_FRAMES) frames.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, item, rotation });
        broadcast({ t: 'frame', x, y, z, dimension, item, rotation, by: player.id }, player.id, player.room, { x, z, dimension });
        break;
      }

      case 'container': {
        if (!player) return;
        // 同上（L8 · MS4 收尾）：有房主的房里，容器改动要经 `edit-request` 回房主落地
        if (hosts.has(player.room) && player.isHost !== true) return rejectEdit(player, 'not-host', 'container');
        if (!player.buckets.container.take()) return;
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
        // 联机24：容器也要卡距离与 y 范围（原来只看形状，隔空改主城的箱子照样收）
        if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
        if (!withinEditReach(player, x, z)) {
          rejectEdit(player, 'distance', `${x},${y},${z}`);
          return;
        }
        /*
         * 进度（L8 · MS4）：熔炉/酿造的 `cookProgress` 是 0..1。
         *
         * 只有房主会推进计时（`SimMode.containers`），所以只有他的进度是真的；
         * 别人的进度字段一律忽略——否则从属端能用一个假进度把所有人的进度条改坏。
         * 不落盘（`containers` 表只存槽位）：进度是瞬时量，重启后归零才对。
         */
        const rawProgress = Number(message.progress);
        const progress =
          player.isHost === true && Number.isFinite(rawProgress)
            ? Math.min(Math.max(rawProgress, 0), 1)
            : undefined;
        // 留一份副本随快照落盘（联机13）：不然重启之后箱子里的东西对新玩家不可见
        if (containers.size < MAX_CONTAINERS) {
          containers.set(scopedKey(player.room, `${dimension}|${x},${y},${z}`), { x, y, z, dimension, slots });
        }
        broadcast(
          {
            t: 'container',
            dimension,
            x,
            y,
            z,
            slots,
            by: player.id,
            ...(progress === undefined ? {} : { progress }),
          },
          player.id,
          player.room,
          { x, z, dimension },
        );
        break;
      }

      case 'item-spawn': {
        if (!player) return;
        /*
         * 令牌桶（用户 2026-10-26）：平时每秒 30 条，但允许一次性 400 条的突发。
         *
         * 突发额度是给"进房那一刻"的：房主的世界里本来就有几百堆掉落物，客户端会重播一遍，
         * 固定 1 秒窗口只能过 30 条、其余被丢掉且不重试——队友那边就凭空少一地的东西。
         */
        if (!player.buckets.item.take()) return;

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
        // 维度（联机31）：镜像要在**掉落物所在的维度**才画，不能拿「接收者当前维度」顶替
        const dimension = sanitizeDimension(String(message.dimension ?? player.dimension));
        items.set(key, { owner: player.id, localId, itemId, count, x, y, z, dimension });
        broadcast(
          { t: 'item-spawn', owner: player.id, localId, itemId, count, x, y, z, dimension },
          player.id,
          player.room,
          { x, z, dimension },
        );
        break;
      }

      /*
       * 捡**别人**的掉落物（联机21）：first-come 仲裁。
       *
       * 谁先到谁拿到：服务端原子地"查还在不在 → 删 → 回 ok"，同时广播 `item-remove`
       * 给所有人（含请求者），让各端的镜像一起消失。两条请求同时到达时，只有先删成功
       * 的那条拿到 ok，另一条拿到 `gone`——这就是"双客户端抢同一堆只有一边拿到"。
       *
       * 自己的掉落物不走这里：那是本地权威，客户端自己捡、再发 `item-remove`。
       */
      /*
       * 应用层 ping（联机29）：浏览器不允许客户端发协议层 ping 帧，所以延迟只能这样测。
       * 只回一条 pong，不带业务逻辑、也不记日志（2 秒一条，记了会把日志刷满）。
       */
      case 'ping': {
        send(socket, { t: 'pong' });
        break;
      }

      case 'item-take': {
        if (!player) return;
        const now = Date.now();
        if (now >= player.takeWindow) {
          player.takeWindow = now + 1000;
          player.takeCount = 0;
        }
        if (++player.takeCount > ITEM_TAKE_RATE_LIMIT) return;

        const owner = Math.trunc(Number(message.owner));
        const localId = Math.trunc(Number(message.localId));
        if (!Number.isFinite(owner) || !Number.isFinite(localId) || owner <= 0 || localId <= 0) return;

        // 跨房不给偷（联机26）：owner 必须和我在同一个房间
        const ownerPlayer = players.get(owner);
        if (!ownerPlayer || ownerPlayer.room !== player.room) {
          send(socket, { t: 'item-take', ok: false, owner, localId, reason: 'gone' });
          break;
        }
        const key = `${owner}:${localId}`;
        const item = items.get(key);
        if (!item) {
          send(socket, { t: 'item-take', ok: false, owner, localId, reason: 'gone' });
          break;
        }
        items.delete(key);
        send(socket, { t: 'item-take', ok: true, owner, localId, itemId: item.itemId, count: item.count });
        // 所有人（含请求者）都删镜像：请求者靠 `ok` 加背包，靠这条删掉地上的那堆
        broadcast({ t: 'item-remove', owner, localId }, null, player.room);
        log(`${player.name}#${player.id} 捡走了 ${owner}#${localId} 那堆（${item.itemId}×${item.count}）`);
        break;
      }

      case 'item-remove': {
        if (!player) return;
        const localId = Math.trunc(Number(message.localId));
        if (!Number.isFinite(localId) || localId <= 0) return;
        const key = `${player.id}:${localId}`;
        if (!items.delete(key)) return;
        broadcast({ t: 'item-remove', owner: player.id, localId }, player.id, player.room, { x: player.x, z: player.z, dimension: player.dimension });
        break;
      }

      case 'chat': {
        if (!player) return;
        // 限频（联机25）：每人每秒 5 条；超了就静默丢（回一条错误反而会被刷屏者利用）
        if (!player.buckets.chat.take()) return;
        const text = String(message.text ?? '').slice(0, 200);
        if (text.length === 0) return;
        /*
         * 不发给发送者（联机30）：客户端在发送时已经**本地回显**过一次
         * （`main.ts` 里 `chat.push` + `chatLine`），再回传一份就是同一条消息出现两次。
         * 这与方块/容器的"广播给其他人"是同一个口径。
         */
        broadcast({ t: 'chat', id: player.id, name: player.name, text }, player.id, player.room);
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
        /*
         * 睡满 = 过了一天：先把"今天"定下来，再把时钟拨到明天清晨（顺序反了会少算一天）。
         * **只拨本房**（用户 2026-10-26：每房一套）——以前这里会遍历所有房间，
         * 于是甲房有人睡觉会把乙房的天也翻过去。
         */
        const sleepClock = clockOf(player.room);
        sleepClock.startDay = currentDay(sleepClock) + 1;
        sleepClock.startMs = Date.now();
        sleepClock.startTimeOfDay = DAWN_TIME_OF_DAY;
        broadcast(
          { t: 'time', timeOfDay: currentTimeOfDay(sleepClock), day: currentDay(sleepClock), snap: true },
          null,
          player.room,
        );
        log(`${player.name}#${player.id} 睡满，房间 ${player.room} 的时间跳到黎明`);
        break;
      }

      /*
       * 主动告别（用户 2026-10-25）：页面卸载 / 点「断开」时客户端会先发这条。
       *
       * 为什么需要：光靠 `close` 分不清"主动退出"和"网断了"，一律走 30 秒宽限期才广播
       * `leave`——队友的玩家列表里就挂着半分钟的幽灵（用户原话："我都刷新了，它还记在在线里面"）。
       * 这里立刻广播，宽限期**仍然保留**：刷新/误触在窗口内回来还是同一个 id、掉落物也还在。
       *
       * **房主主动退出 = 这一局结束**（用户 2026-10-26）：不再等 30 秒宽限期，当场关房
       * 并把同房所有人踢出去。区分"主动退出"与"网断了"是这条消息唯一的价值——
       * 前者是玩家说"我不玩了"，后者要留一次重连机会。
       */
      case 'bye': {
        if (!player) return;
        if (hosts.get(player.room)?.id === player.id) {
          closeRoomNow(player);
          player.farewell = true;
          socket.close();
          break;
        }
        broadcast({ t: 'leave', id: player.id }, null, player.room);
        // 关 socket 时那段宽限期到点后不要再广播一次（否则队友会看到两条"离开"）
        player.farewell = true;
        log(`${player.name}#${player.id} 主动离开（不等宽限期）`);
        // 剩下的清理（玩家表 / 房主提示 / 宽限期登记）都交给 close 那条既有路径
        socket.close();
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
    /*
     * 房主掉线（L8 · MS4）：**立刻**告诉同房其他人，别让他们对着一个没人模拟的世界发呆。
     *
     * 只是提示，不是关房：他可能只是切了后台，`GRACE_MS` 之内回来还是同一局。
     * 真关房在宽限期到期那一段（那时房主位才释放）。
     */
    if (hosts.get(player.room)?.id === player.id) {
      broadcast(
        { t: 'room-closed', reason: 'host-left', graceMs: GRACE_MS },
        player.id,
        player.room,
      );
      log(`房主 ${player.name}#${player.id} 掉线，已通知房间 ${player.room}（宽限 ${Math.round(GRACE_MS / 1000)}s）`);
    }
    const grace = {
      id: player.id,
      name: player.name,
      timer: null,
    };
    grace.timer = setTimeout(() => {
      graces.delete(player.clientId);
      // 主动告别过的（`bye`）已经在当时广播过了，这里只做清理
      if (!player.farewell) broadcast({ t: 'leave', id: player.id }, null, player.room);
      // 宽限期过完，他名下那些掉落物再没人有权删了（owner 已离线），一并清掉；
      // 否则它们会永远躺在别人的世界里，而本地镜像又不可拾取
      for (const [key, item] of items) {
        if (item.owner !== player.id) continue;
        items.delete(key);
        broadcast({ t: 'item-remove', owner: item.owner, localId: item.localId }, null, player.room);
      }
      /*
       * 房主（L8）宽限期结束 = 这一局没有人模拟了。
       */
      if (hosts.get(player.room)?.id === player.id) {
        hosts.delete(player.room);
        /*
         * 房主没回来 = 这一局没人模拟了（L8 · MS4）：**关房**，并把理由说清楚。
         *
         * 不关房的话，剩下的人会停在一个不推进的世界里：怪物不动、红石不亮、
         * 熔炉不烧，而界面上一切正常——这种"看起来还能玩"的坏状态最难排查。
         * 用 `error{code:'host-left'}` 而不是静默断开：客户端据此不再自动重连
         * （否则它会每 3 秒撞一次，日志刷满）。
         */
        const room = player.room;
        for (const other of players.values()) {
          if (other.room !== room) continue;
          reject(other.socket, 'host-left', '房主已退出，房间已关闭', CLOSE_HOST_LEFT);
        }
        /*
         * 关房 = 这一局结束：会话缓存整份清掉（用户 2026-10-26）。
         *
         * 世界已经回到房主本地了（他退出前那次 `saveNow`），服务端留着这些数据只会
         * 在下一局污染房主的世界。这也让"房间结束"这件事在内存占用上是可见的。
         */
        const dropped = clearRoom(room);
        log(`房间 ${room} 已关闭（房主 ${player.name}#${player.id} 宽限期结束未回来），丢弃 ${dropped} 条缓存改动`);
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
    // 先关 ws（停止接受新连接），再关 http server（它才是监听端口的那个）
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}

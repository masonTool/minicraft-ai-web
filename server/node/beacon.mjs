/**
 * 局域网发现（UDP 组播，N4/N6）—— 与 `server/rust/src/beacon.rs` **同一份协议**。
 *
 * 为什么 Node 版也要一份：浏览器发不出 UDP 组播，只能"借服务端的耳朵"——
 * 联机面板读 `/healthz` 的 `peers` 来列「附近房间」。以前只有 Rust 版（手机内建）有，
 * 于是 Web/桌面自建的服务端上这个功能是空的；这里把同一套 beacon 补到 Node 版。
 *
 * 报文（极简 JSON，一秒钟几条，可读性比省字节重要）：
 * ```json
 * {"mc":"minicraft","v":2,"id":"3f9a1c07","port":8887,"room":"草原",
 *  "name":"草原小屋","seed":424242,"players":2,"host":true,"pw":false}
 * ```
 *
 * 两个踩过的坑（照 Rust 那边的结论抄过来）：
 *  1. **组播而不是广播**：BSD/macOS 的 `SO_REUSEPORT` 对**广播**是"按四元组哈希挑一个
 *     socket"，同机两个实例只有一个收得到（A 看得见 B、B 看不见 A）；组播按"加入组"
 *     投递，所有成员都收得到。
 *  2. **收发分成两个 socket**：同一个 socket bind 之后再往同一个组发，部分内核会把包
 *     投回自己，表现为每 3 秒多一条自己的回声（虽然有 id 过滤，但白占带宽）。
 *
 * 任何一步失败都只让 `running` 变 false 并打一行日志：发现是**加分项**，
 * 没有它服务端照样能玩（客户端手填地址那条路一直在）。
 */

import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';

/** 发现用的 UDP 端口（与 TCP 端口相邻但不冲突，改它要同步 `server/rust/src/beacon.rs`） */
export const BEACON_PORT = 25188;
/** 组播组：IPv4 本地管理段（239.0.0.0/8），也是 Bonjour/mDNS 的做法 */
export const MULTICAST_GROUP = '239.255.42.99';
/** 报文魔数：端口上可能还有别的程序在发东西，不认的一律丢 */
const MAGIC = 'minicraft';
/** 广播间隔：3 秒（手机切后台再回来，最多 3 秒重新出现在列表里） */
export const BEACON_INTERVAL_MS = 3000;
/** peer 多久没再听到就当离线（3 个广播周期） */
export const PEER_TTL_MS = 12_000;

/**
 * 一帧广播的内容（客户端「加入房间」面板要显示的全部信息）。
 *
 * @typedef {object} Announce
 * @property {string} room    房间名（面板"点一下进房"要拼 `ws://host:port/<room>`）
 * @property {string} name    世界名（房主没上报时就是房间名）
 * @property {number} seed    世界种子
 * @property {number} players 本房在线人数
 * @property {boolean} hasHost 这一房有没有房主（没有就没人跑模拟）
 */

/**
 * 建一个 beacon 实例。
 *
 * @param {object} options
 * @param {number | (() => number)} options.port 本机服务端的 TCP 端口（报文里要带上）；
 *        传函数是为了 `PORT=0`（由系统分配，测试里就是这么跑的）——那时监听前拿不到端口
 * @param {number} options.protocol         协议版本（与 `PROTOCOL_VERSION` 相等）
 * @param {boolean} options.passwordRequired 服务端级口令（`ROOM_PASSWORD`）
 * @param {() => Announce} options.announce 取"当前该广播哪一间房"
 * @param {(line: string) => void} [options.log]
 */
export function createBeacon({ port, protocol, passwordRequired, announce, log = () => {} }) {
  /** 进程实例 id（8 位 hex）：只用来过滤自己的回声 */
  const instance = randomBytes(4).toString('hex');
  const portOf = typeof port === 'function' ? port : () => port;
  /** id → { peer, seenAt }；`peer` 的字段形状与 Rust 的 `Peer::to_wire` 一致 */
  const peers = new Map();

  let rx = null;
  let tx = null;
  let sendTimer = null;
  let sweepTimer = null;
  let running = false;

  function wire() {
    const info = announce();
    return JSON.stringify({
      mc: MAGIC,
      v: protocol,
      id: instance,
      port: portOf(),
      room: info.room,
      name: info.name,
      seed: info.seed,
      players: info.players,
      host: info.hasHost,
      pw: passwordRequired,
    });
  }

  function send() {
    if (!tx) return;
    const buffer = Buffer.from(wire(), 'utf8');
    tx.send(buffer, 0, buffer.length, BEACON_PORT, MULTICAST_GROUP, (error) => {
      // 发送失败多半是网络切换瞬间（换 Wi-Fi / 断网），下一轮会自己好
      if (error) log(`发现：广播失败（${error.message}）`);
    });
  }

  /** 收到一帧：只认自己的魔数与协议版本，自己的回声按 id 丢掉 */
  function receive(raw, rinfo) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || message.mc !== MAGIC || message.v !== protocol) return;
    if (typeof message.id !== 'string' || message.id.length === 0 || message.id === instance) return;
    const peerPort = Number(message.port);
    if (!Number.isInteger(peerPort) || peerPort <= 0 || peerPort > 65535) return;
    peers.set(message.id, {
      seenAt: Date.now(),
      peer: {
        name: typeof message.name === 'string' ? message.name : '',
        port: peerPort,
        room: typeof message.room === 'string' ? message.room : '',
        seed: Number.isFinite(Number(message.seed)) ? Number(message.seed) : 0,
        players: Number.isFinite(Number(message.players)) ? Number(message.players) : 0,
        hasHost: message.host === true,
        passwordRequired: message.pw === true,
        addr: rinfo.address,
      },
    });
  }

  /** 过期清理：12 秒没再听到就下线 */
  function sweep(now = Date.now()) {
    for (const [id, entry] of peers) {
      if (now - entry.seenAt > PEER_TTL_MS) peers.delete(id);
    }
  }

  function start() {
    if (running) return;
    try {
      rx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      rx.on('message', receive);
      rx.on('error', (error) => {
        log(`发现：监听失败（${error.message}）—— 附近房间列表会是空的`);
        stop();
      });
      rx.bind(BEACON_PORT, () => {
        try {
          rx.addMembership(MULTICAST_GROUP);
          running = true;
          log(`发现：已在 ${MULTICAST_GROUP}:${BEACON_PORT} 上广播（id ${instance}）`);
        } catch (error) {
          log(`发现：加入组播组失败（${error.message}）`);
          stop();
        }
      });

      // 发用自己的 socket（见文件头第 2 条坑）
      tx = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      tx.on('error', () => {});
      // 立即发一帧，别让第一次扫描白等 3 秒
      send();
      sendTimer = setInterval(send, BEACON_INTERVAL_MS);
      sweepTimer = setInterval(() => sweep(), BEACON_INTERVAL_MS);
      // 定时器不该把进程钉住（测试里 spawn 出来、kill 时能干净退出）
      sendTimer.unref?.();
      sweepTimer.unref?.();
    } catch (error) {
      log(`发现：启动失败（${error.message}）`);
      stop();
    }
  }

  function stop() {
    running = false;
    if (sendTimer) clearInterval(sendTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    sendTimer = null;
    sweepTimer = null;
    for (const socket of [rx, tx]) {
      try {
        socket?.close();
      } catch {
        // 已经关了
      }
    }
    rx = null;
    tx = null;
  }

  /** `/healthz` 里的 `peers`：字段与 Rust 的 `Peer::to_wire` 一一对应 */
  function snapshot(now = Date.now()) {
    sweep(now);
    return [...peers.values()].map(({ peer, seenAt }) => ({
      name: peer.name,
      port: peer.port,
      room: peer.room,
      seed: peer.seed,
      players: peer.players,
      hasHost: peer.hasHost,
      passwordRequired: peer.passwordRequired,
      addr: peer.addr,
      seenMs: now - seenAt,
    }));
  }

  return {
    start,
    stop,
    snapshot,
    get running() {
      return running;
    },
    get instanceId() {
      return instance;
    },
  };
}

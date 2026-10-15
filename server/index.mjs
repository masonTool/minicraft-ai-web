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
 * 协议：JSON 文本帧，消息类型见 tools/net-protocol.md 与 src/net/NetClient.ts
 */

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
/** 世界种子：服务端说了算，客户端不再用自己配置的种子 */
const WORLD_SEED = Number(process.env.SEED ?? 20261014);
/** 方块改动最多记这么多条（防止长时间运行的房间把内存吃光） */
const MAX_EDITS = 200_000;
/** 玩家位置更新的最小间隔（毫秒）：比这更频繁的移动消息直接丢弃 */
const MOVE_INTERVAL_MS = 50;

/** @type {Map<string, {id:number,name:string,x:number,y:number,z:number,yaw:number,pitch:number,socket:import('ws').WebSocket,lastMove:number,dimension:string}>} */
const players = new Map();
/** 方块改动：key = "维度|x,y,z" → { x, y, z, id, state, dimension } */
const edits = new Map();
let nextPlayerId = 1;

const log = (...args) => console.log(`[server ${new Date().toISOString().slice(11, 19)}]`, ...args);

function send(socket, message) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
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
function snapshotFor() {
  return {
    seed: WORLD_SEED,
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
    // 方块改动用数组传更紧凑：[x, y, z, id, state, dimension]
    edits: [...edits.values()].map((e) => [e.x, e.y, e.z, e.id, e.state, e.dimension]),
  };
}

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  log(`已启动，端口 ${PORT}，种子 ${WORLD_SEED}`);
  log(`玩家把游戏指向 ws://localhost:${PORT} 即可联机`);
});

wss.on('connection', (socket, request) => {
  const address = request.socket.remoteAddress ?? 'unknown';
  let player = null;

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, { t: 'error', message: '消息不是合法 JSON' });
      return;
    }

    switch (message.t) {
      case 'join': {
        if (player) return send(socket, { t: 'error', message: '已经加入过了' });
        const name = String(message.name ?? '玩家').slice(0, 16);
        player = {
          id: nextPlayerId++,
          name,
          x: Number(message.x ?? 0),
          y: Number(message.y ?? 80),
          z: Number(message.z ?? 0),
          yaw: 0,
          pitch: 0,
          dimension: 'overworld',
          socket,
          lastMove: 0,
        };
        players.set(player.id, player);

        send(socket, {
          t: 'welcome',
          id: player.id,
          name: player.name,
          ...snapshotFor(),
        });
        broadcast({ t: 'player', id: player.id, name: player.name, x: player.x, y: player.y, z: player.z, yaw: 0, pitch: 0, dimension: player.dimension }, player.id);
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
        player.dimension = String(message.dimension ?? player.dimension);
        broadcast(
          { t: 'player', id: player.id, name: player.name, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, dimension: player.dimension },
          player.id,
        );
        break;
      }

      case 'block': {
        if (!player) return;
        const dimension = String(message.dimension ?? player.dimension);
        const x = Math.trunc(Number(message.x));
        const y = Math.trunc(Number(message.y));
        const z = Math.trunc(Number(message.z));
        const id = Math.trunc(Number(message.id));
        const state = Math.trunc(Number(message.state ?? 0));
        if (![x, y, z, id, state].every(Number.isFinite)) return;

        if (edits.size < MAX_EDITS) {
          edits.set(`${dimension}|${x},${y},${z}`, { x, y, z, id, state, dimension });
        }
        // 广播给其他人（含 by，方便客户端区分"自己改的"）
        broadcast({ t: 'block', x, y, z, id, state, dimension, by: player.id }, player.id);
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

      default:
        send(socket, { t: 'error', message: `未知消息类型 ${message.t}` });
    }
  });

  socket.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    broadcast({ t: 'leave', id: player.id });
    log(`${player.name}#${player.id} 离开，当前 ${players.size} 人`);
  });

  socket.on('error', (error) => {
    log('socket 出错：', error.message);
  });
});

// Ctrl+C 时干净退出（容器里被 kill 也不会留下半开连接）
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('收到退出信号，关闭服务端');
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}

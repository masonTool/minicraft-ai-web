/**
 * 联机验收用的"另一个玩家"（node 客户端）
 *
 * 从命令行扮演一个队友：加入服务器 → 挪几步 → 改一个方块 → 保持在线若干秒。
 * 由 tools/net-check.sh 调用，与浏览器里的真人客户端互相验证。
 *
 * 用法：node tools/net-peer.mjs [端口] [方块x] [方块y] [方块z] [在线秒数]
 */

import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../server/protocol.mjs';

const port = Number(process.argv[2] ?? 8787);
const blockX = Number(process.argv[3] ?? 0);
const blockY = Number(process.argv[4] ?? 100);
const blockZ = Number(process.argv[5] ?? 0);
const staySeconds = Number(process.argv[6] ?? 20);
/** 要放的方块 id（由调用方从浏览器查出来传入——node 侧没有方块表） */
const blockId = Number(process.argv[7] ?? 1);

const socket = new WebSocket(`ws://localhost:${port}`);
const log = (...args) => console.log('[peer]', ...args);

socket.on('open', () => {
  socket.send(
    JSON.stringify({
      t: 'join',
      v: PROTOCOL_VERSION,
      // 每次跑都是一个新的"浏览器"：带 pid，避免和上一次残留的同名连接撞 clientId
      clientId: `peerbot-${process.pid}`,
      name: '机器人队友',
      x: blockX + 3,
      y: blockY,
      z: blockZ + 3,
    }),
  );
});

socket.on('message', (raw) => {
  const message = JSON.parse(String(raw));
  if (message.t === 'welcome') {
    log(`加入成功 #${message.id}，种子 ${message.seed}，在线 ${message.players.length} 人`);
    // 在浏览器玩家附近放一个显眼的方块（id 由调用方查好传进来）
    socket.send(JSON.stringify({ t: 'block', x: blockX, y: blockY, z: blockZ, id: blockId, state: 0, dimension: 'overworld' }));
    log(`放了方块 id=${blockId} 在 (${blockX}, ${blockY}, ${blockZ})`);

    let step = 0;
    const walk = setInterval(() => {
      step++;
      socket.send(
        JSON.stringify({
          t: 'move',
          x: blockX + 3 + Math.sin(step / 3) * 2,
          y: blockY,
          z: blockZ + 3 + Math.cos(step / 3) * 2,
          yaw: step / 5,
          pitch: 0,
          dimension: 'overworld',
        }),
      );
      if (step === 3) socket.send(JSON.stringify({ t: 'chat', text: '我是机器人队友，来验收联机' }));
      if (step > 4) clearInterval(walk);
    }, 120);
  }
});

socket.on('error', (error) => {
  log('连接失败：', error.message);
  process.exit(1);
});

setTimeout(() => {
  log(`在线 ${staySeconds} 秒结束，断开`);
  socket.close();
  process.exit(0);
}, staySeconds * 1000);

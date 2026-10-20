#!/usr/bin/env node
/**
 * Worker 自测（不依赖微信宿主）
 *
 * 用 Node vm 模拟微信 worker：
 *   - globalThis.self 是只读 getter（复现开发者工具报错）
 *   - 全局 worker 提供 onMessage/postMessage
 *   - 运行打包后的 wx-shim + chunk.worker.js
 *   - 发 ping / generate，检查回包
 *
 * 用法：node tools/minigame/test-worker-shim.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const shimPath = join(root, 'tools/minigame/spike-worker/wx-shim.mjs');
const workerPath = join(root, 'minigame-world/workers/chunk.worker.js');

const shimCode = readFileSync(shimPath, 'utf8');
const workerCode = readFileSync(workerPath, 'utf8');

const received = [];
let messageListener = null;

const fakeWorker = {
  onMessage(callback) {
    messageListener = callback;
  },
  postMessage(message) {
    received.push(message);
  },
  terminate() {},
};

// 模拟微信 worker：self 只读，而且没有浏览器式的 addEventListener/postMessage
const selfObject = {};

const context = vm.createContext({
  console,
  worker: fakeWorker,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
});

Object.defineProperty(context, 'self', {
  configurable: false,
  get() {
    return selfObject;
  },
});

vm.runInContext(shimCode, context, { filename: 'wx-shim.mjs' });
vm.runInContext(workerCode, context, { filename: 'chunk.worker.js' });

if (typeof messageListener !== 'function') {
  throw new Error('worker.onMessage 没有被注册');
}

// ping/pong
messageListener({ type: 'ping', id: 7 });
const pong = received.find((message) => message?.type === 'pong');
if (!pong || pong.id !== 7) {
  throw new Error(`ping 没有收到 pong：${JSON.stringify(received)}`);
}
console.log('✓ ping/pong', pong);

// 真实区块生成
messageListener({
  type: 'generate',
  id: 8,
  cx: 0,
  cz: 0,
  seed: 0x5eed,
  dimension: 0,
  worldType: 'default',
});
const generated = received.find((message) => message?.type === 'generated');
if (!generated) {
  throw new Error(`generate 没有回包：${JSON.stringify(received.map((m) => m?.type))}`);
}
// vm 里的 ArrayBuffer 与宿主 realm 不同，instanceof 会失败；用 byteLength 判断
if (!generated.blocks || typeof generated.blocks.byteLength !== 'number' || generated.blocks.byteLength === 0) {
  throw new Error('generated.blocks 不是非空 ArrayBuffer');
}
console.log('✓ generate', {
  id: generated.id,
  cx: generated.cx,
  cz: generated.cz,
  blocks: generated.blocks.byteLength,
  states: generated.states ? generated.states.byteLength : 0,
});

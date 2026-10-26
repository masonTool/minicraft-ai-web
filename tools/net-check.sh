#!/bin/sh
# 联机（K2）端到端验收：真服务端 + 浏览器客户端 + node"机器人队友"
#
# 前置：dev server 已经在跑（npm run dev）。
# 流程：
#   1. 后台起联机服务端（端口 8787）
#   2. 浏览器打开游戏 → mc.connect() 连上去
#   3. 起 node 队友：加入 → 挪动 → 在指定坐标放一个萤石 → 发一条聊天
#   4. 浏览器侧核对：在线人数、队友坐标、方块是否真的出现在世界里、聊天是否收到
#
# 用法：sh tools/net-check.sh

set -e

PORT=8787
URL="${1:-http://localhost:5173/}"
BLOCK_X=0
BLOCK_Y=100
BLOCK_Z=0

echo "== 启动联机服务端（端口 $PORT） =="
PORT=$PORT node server/node/index.mjs > .tmp/net-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "== 浏览器连接服务器 =="
playwright-cli goto "$URL" >/dev/null
sleep 14
playwright-cli eval "(function(){var mc=window.__mc;mc.teleportForce($BLOCK_X+0.5, $BLOCK_Y+2, $BLOCK_Z+0.5);return mc.connect('ws://localhost:$PORT','浏览器玩家');})()" >/dev/null
sleep 2

# 方块 id 交给浏览器查（node 侧拿不到方块表，硬编码数字很容易写错）
GLOW_ID=$(playwright-cli eval "window.__mc.blockId('glowstone')" | grep -o '### Result' -A1 | tail -1 | tr -d '" ')
GLOW_ID=$(printf '%s' "$GLOW_ID" | tr -cd '0-9')
echo "萤石 id = $GLOW_ID"

echo "== 机器人队友加入 =="
node tools/net-peer.mjs $PORT $BLOCK_X $BLOCK_Y $BLOCK_Z 12 "$GLOW_ID" > .tmp/net-peer.log 2>&1 &
PEER_PID=$!
sleep 4

echo "== 浏览器侧核对 =="
playwright-cli eval "eval(atob('$(base64 -i tools/net-acceptance.js | tr -d '\n')'))" | grep -v "await page"

kill $PEER_PID 2>/dev/null || true
sleep 1
echo
echo "== 队友离开后 =="
playwright-cli eval "(function(){return JSON.stringify(window.__mc.netState);})()" | grep -v "await page"

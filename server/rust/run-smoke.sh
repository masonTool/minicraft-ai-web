#!/bin/bash
# 起一个临时 Rust 服务端（25199，避开开发用的 25187），跑冒烟，再关掉。
#
# GRACE_MS 压到 400ms：默认 30 秒的断线宽限期会让"断线广播 leave"那条白等半分钟
# （与 `tools/net-test.mjs` 起服务端时的做法一致）。
# DATA_DIR 指到临时目录：别把开发者自己的存档弄脏。
set -u
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

cargo build -q || exit 1

DATA_DIR="$(mktemp -d)"
export DATA_DIR
GRACE_MS=400 PORT=25199 ./target/debug/minicraft-server > /tmp/minicraft-rust-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# 等端口起来（最多 3 秒）
for _ in $(seq 1 30); do
  if nc -z 127.0.0.1 25199 2>/dev/null; then break; fi
  sleep 0.1
done

URL=ws://127.0.0.1:25199 node smoke.mjs
STATUS=$?

echo '--- 服务器日志 ---'
cat /tmp/minicraft-rust-server.log
exit $STATUS

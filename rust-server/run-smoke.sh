#!/bin/bash
# 起一个临时 Rust 服务端（25199，避开开发用的 25187），跑冒烟，再关掉。
set -u
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

cargo build -q || exit 1

PORT=25199 ./target/debug/minicraft-server > /tmp/minicraft-rust-server.log 2>&1 &
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

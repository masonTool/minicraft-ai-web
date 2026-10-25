#!/bin/bash
# 用**全量黑盒断言**验收 Rust 版：`tools/net-test.mjs`（约 180 条）指向 Rust 服务端跑。
#
# 断言一条都不改——它验的是协议；JS 版的路径仍然默认走 `node server/index.mjs`。
set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(cd .. && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

cargo build -q || exit 1

cd "$ROOT" || exit 1
NET_SERVER_BIN="$ROOT/rust-server/target/debug/minicraft-server" node tools/net-test.mjs

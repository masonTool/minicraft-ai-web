#!/bin/bash
# 局域网发现（N4 的 Rust 半边）冒烟：build 之后**起两个真进程**互相发现。
#
# 发现端口用 25198（不是默认 25188）：开发者自己的服务端可能正占着默认口，
# 而两个测试实例用 SO_REUSEPORT 共享同一个口是**这条链路的前提**。
set -u
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

cargo build -q || exit 1

BINARY="$PWD/target/debug/minicraft-server" BEACON_PORT=25198 node beacon-smoke.mjs

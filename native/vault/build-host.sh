#!/bin/bash
# 编 host 版（macOS / Linux）的 `vault-cli` 与 `vault-selftest`。
#
# 为什么要 host 版：`vault.cpp` 的解密结果必须和 `tools/pack-bundle.ts` 打出的包、
# `desktop/bundle.mjs` 解出的内容完全一致。在设备上验证这条要装机 + logcat，
# 在 host 上只要一条命令。
#
# 用法：
#   bash native/vault/build-host.sh
#   native/vault/build/host/vault-selftest
#   npm run test:vault
set -eu
cd "$(dirname "$0")"

# macOS 上 PATH 里有时会优先命中 Android 的 clang，显式用系统那份
CXX="${CXX:-/usr/bin/clang++}"
SRC="src/crypto.cpp src/vault.cpp"

mkdir -p build/host

echo "── host（$($CXX --version | head -1)）"
# shellcheck disable=SC2086
$CXX -std=c++17 -O2 -Wall -Wextra -o build/host/vault-cli $SRC src/vault_cli.cpp -lz
# shellcheck disable=SC2086
$CXX -std=c++17 -O2 -Wall -Wextra -o build/host/vault-selftest $SRC test/selftest.cpp -lz

echo "   → build/host/vault-cli"
echo "   → build/host/vault-selftest"

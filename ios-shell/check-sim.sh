#!/bin/bash
# iOS 半边的**设备级**验收：把 Swift + Rust 静态库链接成一个模拟器可执行文件，
# 在真的 iOS 模拟器里跑起来（`simctl spawn`），验"起服务 → /healthz → /rooms → 停"。
#
# 为什么值得单独跑：`xcframework` 存在 ≠ 能链接（Rust 静态库常缺系统库符号），
# Swift typecheck 通过 ≠ 在 iOS 上跑得起来。这两件事只有"编成可执行 + 真跑"才暴露。
#
# 用法：`bash ios-shell/check-sim.sh`（约 1 分钟，含模拟器启动）
set -euo pipefail
cd "$(dirname "$0")" || exit 1
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

echo "① 静态检查（xcframework + Swift typecheck）"
bash check.sh | tail -4

echo
echo "② 启动一台 iOS 模拟器"
UDID=$(xcrun simctl list devices available \
  | grep -E "^\s+iPhone" | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')
if [ -z "$UDID" ]; then
  echo "没有可用的 iPhone 模拟器（Xcode → Settings → Components 里装一个 runtime）" >&2
  exit 1
fi
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
echo "   ✓ $UDID 已启动"

echo
echo "③ 链接模拟器可执行（Swift + Rust 静态库）"
SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
BINARY=/tmp/minicraft-ios-smoke
xcrun --sdk iphonesimulator swiftc \
  -sdk "$SIM_SDK" -target arm64-apple-ios15.0-simulator \
  -import-objc-header include/minicraft_server.h \
  Sources/*.swift Tests/main.swift \
  MinicraftServer.xcframework/ios-arm64_x86_64-simulator/libminicraft_server-sim.a \
  -o "$BINARY"
echo "   ✓ $(file -b "$BINARY")"

echo
echo "④ 在模拟器里跑"
xcrun simctl spawn "$UDID" "$BINARY"

echo
echo "iOS 设备级验收：全部通过"

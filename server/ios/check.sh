#!/bin/bash
# iOS 半边的验收：编出 xcframework + 用 iOS SDK 给 Swift 做类型检查。
#
# 为什么这两条就够（剩下的必须上真机）：
#   · xcframework 存在且架构对 → "Rust 能被 iOS 链接"这条成立；
#   · Swift 在 **iOS SDK** 下 typecheck 通过 → "调用签名/平台 API 用法"这条成立；
#   · 再往后的"前台当房主、Android 能被发现"要两台设备 + N6 的客户端接线，本机验不了。
#
# 用法：`bash server/ios/check.sh`（在仓库任意位置跑都行）
set -euo pipefail
cd "$(dirname "$0")" || exit 1
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

echo "① 编 Rust → xcframework"
bash ../rust/build-ios.sh > /tmp/minicraft-ios-build.log 2>&1 || {
  echo "   失败，日志见 /tmp/minicraft-ios-build.log"; tail -20 /tmp/minicraft-ios-build.log; exit 1
}
echo "   ✓ $(cd .. && ls ios/MinicraftServer.xcframework)"

echo "② Swift 类型检查（真机 SDK）"
DEVICE_SDK=$(xcrun --sdk iphoneos --show-sdk-path)
xcrun --sdk iphoneos swiftc -typecheck -sdk "$DEVICE_SDK" -target arm64-apple-ios15.0 \
  -import-objc-header include/minicraft_server.h Sources/*.swift
echo "   ✓ arm64-apple-ios15.0"

echo "③ Swift 类型检查（模拟器 SDK）"
SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator swiftc -typecheck -sdk "$SIM_SDK" -target arm64-apple-ios15.0-simulator \
  -import-objc-header include/minicraft_server.h Sources/*.swift
echo "   ✓ arm64-apple-ios15.0-simulator"

echo "④ 静态库里要有四个 C 入口"
# 先把符号表抓成变量再 grep：`nm | grep -q` 在 `set -o pipefail` 下会因为 grep 提前退出
# （nm 收到 SIGPIPE）被判成失败，看起来像"符号不存在"
SYMBOLS=$(nm -gU MinicraftServer.xcframework/ios-arm64/libminicraft_server.a 2>&1)
for symbol in minicraft_start_server minicraft_stop_server minicraft_server_port minicraft_add_bonjour_peer; do
  case "$SYMBOLS" in
    *"_$symbol"*) echo "   ✓ $symbol" ;;
    *) echo "   ✗ 缺少符号 $symbol"; exit 1 ;;
  esac
done

echo
echo "iOS 半边：全部通过"

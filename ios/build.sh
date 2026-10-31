#!/bin/bash
# iOS 出包（命令行，不用打开 Xcode）。
#
#   npm run build:ios     → 模拟器版 .app（**不需要任何证书**，用于验证能跑起来）
#   npm run release:ios   → 真机 Archive（需要 Apple 开发者证书已配在 Xcode 里）
#
# 加密包怎么进 App：`ios/App/App.xcodeproj` 里有一个 Build Phase 脚本，
# 每次构建时把 `build/rt/libmcrt.so` 和 `build/rt/signers.json`
# 拷进 `${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}`。
# 所以**必须先跑 `npm run pack`**，否则那个 Phase 的 `cp` 会失败（脚本是 set -e）。
#
# 导出 ipa：Archive 之后用
#   xcodebuild -exportArchive -archivePath ios/build/App.xcarchive \
#     -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/ipa
# `ExportOptions.plist` 需要填你自己的 Team ID（模板见 ios/ExportOptions.plist.example）。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
PROJECT="ios/App/App.xcodeproj"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "找不到 xcodebuild：iOS 必须在装了 Xcode 的 macOS 上出包" >&2
  exit 1
fi
if [ ! -f build/rt/libmcrt.so ]; then
  echo "缺少 build/rt/libmcrt.so：先跑 npm run pack" >&2
  exit 1
fi

if [ "$MODE" = "release" ]; then
  echo "── iOS（Release / 真机 Archive）"
  xcodebuild -project "$PROJECT" -scheme App -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath ios/build/App.xcarchive \
    -allowProvisioningUpdates \
    archive | tail -20
  echo
  echo "产物：ios/build/App.xcarchive"
  echo "导 ipa：xcodebuild -exportArchive -archivePath ios/build/App.xcarchive \\"
  echo "         -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/ipa"
else
  echo "── iOS（Debug / 模拟器，无需证书）"
  # 不指定具体机型，交给 Xcode 挑当前可用的模拟器 SDK
  xcodebuild -project "$PROJECT" -scheme App -configuration Debug \
    -sdk iphonesimulator \
    -derivedDataPath ios/build \
    build | tail -20
  echo
  echo "产物：ios/build/Build/Products/Debug-iphonesimulator/App.app"
  echo "装到已启动的模拟器："
  echo "  xcrun simctl boot 'iPhone 16' 2>/dev/null; xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/App.app"
  echo "  xcrun simctl launch booted com.minicraft.app"
fi

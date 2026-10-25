#!/bin/bash
# 编 iOS 产物：`MinicraftServer.xcframework`（真机 arm64 + 模拟器 arm64/x86_64）。
#
# 和 build-android.sh 一个思路：不装额外工具（这里连 `xcodebuild` 都是系统自带），
# 每一步都能在这个脚本里读出来。
#
# 用法：
#   bash build-ios.sh
#
# 产物：`ios-shell/MinicraftServer.xcframework`（带 `include/minicraft_server.h`），
# 拖进 Xcode 即可；Swift 侧见 `ios-shell/Sources/`。
set -eu
cd "$(dirname "$0")" || exit 1
ROOT="$(cd .. && pwd)"
OUT="$ROOT/ios-shell"
export PATH="$HOME/.cargo/bin:$PATH"

DEVICE=aarch64-apple-ios
SIM_ARM=aarch64-apple-ios-sim
SIM_X86=x86_64-apple-ios

echo "── 安装 Rust 的 iOS 目标（已装则跳过）"
rustup target add "$DEVICE" "$SIM_ARM" "$SIM_X86"

echo "── 编真机（$DEVICE）"
cargo build --release --lib --target "$DEVICE"
echo "── 编模拟器（$SIM_ARM / $SIM_X86）"
cargo build --release --lib --target "$SIM_ARM"
if cargo build --release --lib --target "$SIM_X86" 2>/dev/null; then
  SIM_LIBS=(
    "target/$SIM_ARM/release/libminicraft_server.a"
    "target/$SIM_X86/release/libminicraft_server.a"
  )
else
  echo "   （$SIM_X86 编不过：新版本 Rust 已把它降级，Apple Silicon 的模拟器只需要 arm64）"
  SIM_LIBS=("target/$SIM_ARM/release/libminicraft_server.a")
fi

mkdir -p "$OUT/lib"
echo "── 把模拟器的两个架构合成一份 fat .a"
lipo -create "${SIM_LIBS[@]}" -output "$OUT/lib/libminicraft_server-sim.a"
lipo -info "$OUT/lib/libminicraft_server-sim.a"

echo "── 生成 xcframework"
rm -rf "$OUT/MinicraftServer.xcframework"
xcodebuild -create-xcframework \
  -library "target/$DEVICE/release/libminicraft_server.a" -headers "$OUT/include" \
  -library "$OUT/lib/libminicraft_server-sim.a" -headers "$OUT/include" \
  -output "$OUT/MinicraftServer.xcframework" >/dev/null

echo
echo "产物："
find "$OUT/MinicraftServer.xcframework" -maxdepth 2 -type d | sed 's/^/  /'
echo "校验（应当是 arm64 / arm64+x86_64 的静态库）："
for lib in "$OUT"/MinicraftServer.xcframework/*/libminicraft_server.a; do
  echo -n "  $(basename "$(dirname "$lib")") → "
  lipo -info "$lib" | sed 's/.*are: //'
done
echo "导出的 C 符号："
nm -gU "$OUT"/MinicraftServer.xcframework/ios-arm64/libminicraft_server.a 2>/dev/null \
  | grep -E "minicraft_(start|stop|port)" | sed 's/^/  /' || true

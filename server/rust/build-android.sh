#!/bin/bash
# 编 Android 产物：`libminicraft_server.so`（arm64-v8a / armeabi-v7a 两个 ABI）。
#
# 为什么不用 `cargo-ndk`：它只是"帮你拼 NDK 的 linker 路径"的一层壳，机器上没装就得
# `cargo install`（还要联网、还要等编译）。直接指定 `CARGO_TARGET_*_LINKER` 效果一样，
# 而且**这个脚本本身就是"该怎么配"的文档**。
#
# 用法：
#   bash build-android.sh              # release，两个 ABI
#   ABI=arm64 bash build-android.sh    # 只编 arm64
#   ABI=v7a bash build-android.sh      # 只编 armeabi-v7a
#
# 产物落在 `target/<target>/release/libminicraft_server.so`，Kotlin 侧放进
# `app/src/main/jniLibs/<abi>/` 即可（N4b 的 Capacitor 工程）。
#
# ⚠️ 不再编 x86_64：手机上跑不到，只有 Intel 机器上的模拟器需要；换成 32 位 v7a
# 反而覆盖到更多老设备。模拟器请用 arm64 镜像。
set -eu
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:$PATH"

: "${ANDROID_NDK_HOME:=${ANDROID_HOME:-$HOME/Library/Android/sdk}/ndk}"
if [ ! -d "$ANDROID_NDK_HOME" ]; then
  echo "找不到 NDK：$ANDROID_NDK_HOME" >&2
  echo "装一个（Android Studio → SDK Manager → NDK），或设 ANDROID_NDK_HOME 指到已有那份" >&2
  exit 1
fi
NDK="$(ls -d "$ANDROID_NDK_HOME"/* 2>/dev/null | sort -V | tail -1)"
HOST_TAG="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
BIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
# API 24：jni 与 tokio 都用不到更新的系统接口；抬高只会缩小兼容机型
API=24
ABI="${ABI:-both}"

echo "NDK：${NDK}（${HOST_TAG}，API ${API}）"

build() {
  local triple="$1" clang="$2" abi="$3"
  echo "── ${abi}（${triple}）"
  rustup target add "$triple" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  env "CARGO_TARGET_$(echo "$triple" | tr 'a-z-' 'A-Z_')_LINKER=$BIN/$clang" \
    cargo build --release --lib --target "$triple"
  echo "   → $(ls -lh "target/$triple/release/libminicraft_server.so" | awk '{print $5, $9}')"
}

if [ "$ABI" = "both" ] || [ "$ABI" = "arm64" ]; then
  build aarch64-linux-android "aarch64-linux-android$API-clang" arm64-v8a
fi
if [ "$ABI" = "both" ] || [ "$ABI" = "v7a" ]; then
  build armv7-linux-androideabi "armv7a-linux-androideabi$API-clang" armeabi-v7a
fi

echo
echo "校验（应当是 ELF / ARM aarch64 或 ARM 32-bit）："
file target/aarch64-linux-android/release/libminicraft_server.so 2>/dev/null || true
file target/armv7-linux-androideabi/release/libminicraft_server.so 2>/dev/null || true

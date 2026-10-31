#!/bin/bash
# 编 Android 产物：`libminicraft_vault.so`（arm64-v8a / armeabi-v7a）。
#
# 与 `server/rust/build-android.sh` 同样的思路：不引入 cargo-ndk / CMake 之类的中间层，
# 直接指定 NDK 的 clang。**这个脚本本身就是"该怎么配"的文档**。
#
# 为什么用 `-static-libstdc++`：默认会链接 `libc++_shared.so`，那意味着 APK 里还要多带
# 一份 ~1 MB 的运行时，且一旦设备上已有别的版本会冲突。静态链接让这个 .so 自包含。
#
# 用法：
#   bash native/vault/build-android.sh              # release，两个 ABI
#   ABI=arm64 bash native/vault/build-android.sh    # 只编 arm64
#   ABI=v7a   bash native/vault/build-android.sh    # 只编 armeabi-v7a
#
# 产物：`native/vault/build/android/<abi>/libminicraft_vault.so`
# （`android/app/build.gradle` 的 `copyVaultLib` 会从这里拷进 jniLibs）
set -eu
cd "$(dirname "$0")"

: "${ANDROID_NDK_HOME:=${ANDROID_HOME:-$HOME/Library/Android/sdk}/ndk}"
if [ ! -d "$ANDROID_NDK_HOME" ]; then
  echo "找不到 NDK：$ANDROID_NDK_HOME" >&2
  echo "装一个（Android Studio → SDK Manager → NDK），或设 ANDROID_NDK_HOME 指到已有那份" >&2
  exit 1
fi
NDK="$(ls -d "$ANDROID_NDK_HOME"/* 2>/dev/null | sort -V | tail -1)"
HOST_TAG="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
BIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
# 与 server/rust/build-android.sh 保持同一个 API 级别（minSdk 23，这里取 24 留余量）
API=24
ABI="${ABI:-both}"
SRC="src/crypto.cpp src/vault.cpp src/jni_bridge.cpp"

echo "NDK：${NDK}（${HOST_TAG}，API ${API}）"

build() {
  local triple="$1" clang="$2" abi="$3"
  echo "── ${abi}（${triple}）"
  mkdir -p "build/android/$abi"
  # shellcheck disable=SC2086
  "$BIN/$clang" -std=c++17 -O2 -fPIC -shared -s \
    -static-libstdc++ \
    -o "build/android/$abi/libminicraft_vault.so" \
    $SRC -lz -llog
  echo "   → $(ls -lh "build/android/$abi/libminicraft_vault.so" | awk '{print $5, $9}')"
}

if [ "$ABI" = "both" ] || [ "$ABI" = "arm64" ]; then
  build aarch64-linux-android "aarch64-linux-android$API-clang++" arm64-v8a
fi
if [ "$ABI" = "both" ] || [ "$ABI" = "v7a" ]; then
  build armv7-linux-androideabi "armv7a-linux-androideabi$API-clang++" armeabi-v7a
fi

echo
echo "校验："
file build/android/arm64-v8a/libminicraft_vault.so 2>/dev/null || true
file build/android/armeabi-v7a/libminicraft_vault.so 2>/dev/null || true

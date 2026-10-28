#!/usr/bin/env bash
# 用真实 JVM 跑一遍 Android 侧的解封代码（不需要设备 / Gradle）。
#
#   bash tools/sealed-check.sh
#
# 前置：JDK 17+（`JAVA_HOME` 没设时自动找）、已跑过 `npm run gen:sealed`。
# 失败即非零退出——可以挂进 CI。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.tmp/sealed-check"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17 2>/dev/null || true)}"

if [ -z "${JAVA_HOME}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "跳过：找不到 JDK（sealed-check 需要 javac）"
  exit 0
fi

if [ ! -f "$ROOT/android/app/src/main/assets/sealed/core.sealed" ]; then
  echo "缺少封存体：先跑 npm run gen:sealed"
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/com/minicraft/app"
cp "$ROOT/android/app/src/main/java/com/minicraft/app/SealedCore.java" "$OUT/com/minicraft/app/"
cp "$ROOT/tools/sealed-check/SealedCheck.java" "$OUT/com/minicraft/app/"

"$JAVA_HOME/bin/javac" -d "$OUT" \
  "$OUT/com/minicraft/app/SealedCore.java" \
  "$OUT/com/minicraft/app/SealedCheck.java"

"$JAVA_HOME/bin/java" -cp "$OUT" com.minicraft.app.SealedCheck "$ROOT"

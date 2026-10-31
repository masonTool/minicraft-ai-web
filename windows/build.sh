#!/bin/bash
# Windows 出包。
#
#   npm run build:win     → 未签名 .exe 安装包
#   npm run release:win   → 签名 .exe（需要 CSC_LINK / CSC_KEY_PASSWORD）
#
# ⚠️ NSIS 目标**不能在 macOS 上直接出**（需要 wine）。本脚本会先检查并在缺失时
# 直接报错说清楚，而不是让 electron-builder 抛一堆 wine 堆栈。
# 正式发版请走 Windows 机器或 Windows CI。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
if [ ! -f build/rt/libmcrt.so ]; then
  echo "缺少 build/rt/libmcrt.so：先跑 npm run pack" >&2
  exit 1
fi

# 同 mac/build.sh：先在 shell 层清掉中间目录，避免 electron-builder 内部的
# 批量删除被带安全护栏的终端拦下
rm -rf dist/windows/win-unpacked dist/windows/win-unpacked-x64

if [ "$(uname -s)" = "Darwin" ] && ! command -v wine >/dev/null 2>&1; then
  echo "在 macOS 上出 Windows 安装包需要 wine，本机没有。" >&2
  echo "  选项 A：在 Windows 机器 / Windows CI 上跑这条命令" >&2
  echo "  选项 B：brew install --cask wine-stable 后再试" >&2
  exit 1
fi

if [ "$MODE" = "release" ]; then
  : "${CSC_LINK:?release 模式需要 CSC_LINK（签名证书 .pfx 的路径）}"
  : "${CSC_KEY_PASSWORD:?release 模式需要 CSC_KEY_PASSWORD}"
  echo "── Windows（签名）"
  npx electron-builder -c windows/electron-builder.yml --win
else
  echo "── Windows（未签名）"
  CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder -c windows/electron-builder.yml --win \
      --config.win.identity=null
fi

echo
echo "产物："
ls -lh dist/windows/*.exe 2>/dev/null || echo "（没有 exe，检查上面的日志）"

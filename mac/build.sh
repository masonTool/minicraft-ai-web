#!/bin/bash
# macOS 出包。
#
#   npm run build:mac     → 未签名 .dmg（本地自用、给朋友试）
#   npm run release:mac   → 签名 .dmg（需要 CSC_LINK / CSC_KEY_PASSWORD）
#
# 两种模式都依赖 `build/rt/libmcrt.so`（`npm run pack` 的产物），
# electron-builder 通过 extraResources 把它放进 `Minicraft.app/Contents/Resources/rt/`。
#
# ⚠️ dev 模式**主动关掉签名自动发现**：本机若装了自己的开发者证书，electron-builder
# 会自动签上，而 `release.config.json` 的 `macTeamId` 是空的 —— 那种组合会被
# `BundleVault` 判成"没配置却带着签名"，等于自己把自己当改包。未签名的包反而能开。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
if [ ! -f build/rt/libmcrt.so ]; then
  echo "缺少 build/rt/libmcrt.so：先跑 npm run pack" >&2
  exit 1
fi

if [ "$MODE" = "release" ]; then
  : "${CSC_LINK:?release 模式需要 CSC_LINK（签名证书 .p12 的路径）}"
  : "${CSC_KEY_PASSWORD:?release 模式需要 CSC_KEY_PASSWORD}"
  echo "── macOS（签名）"
  npx electron-builder -c mac/electron-builder.yml --mac
else
  echo "── macOS（未签名）"
  CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder -c mac/electron-builder.yml --mac \
      --config.mac.identity=null
fi

echo
echo "产物："
ls -lh dist/mac/*.dmg 2>/dev/null || echo "（没有 dmg，检查上面的日志）"

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
# 会自动签上，而桌面端解密只看 `signers.json`——签名与否不影响能不能开，
# 但未签名的包反而更干净、更好排查。
#
# ## 为什么每个 arch 单独起一次 electron-builder
#
# 一次 `--mac` 会连续处理 arm64 与 x64：每处理一个就要解压一份 Electron（550+ 文件），
# 再清掉上一个的中间目录。某些终端（CodeBuddy 内置终端）把"一次删 500+ 文件"当成
# 危险操作直接拦下，表现为"第二个 arch 打包到一半失败、dmg 只更新了一半"。
#
# 拆成两个进程 + 每个进程前用 shell 层清理，进程内的删除量就归零。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
if [ ! -f build/rt/libmcrt.so ]; then
  echo "缺少 build/rt/libmcrt.so：先跑 npm run pack" >&2
  exit 1
fi

build_arch() {
  local arch="$1"
  # shell 层清理（不受 node 的 safe-delete 护栏影响）
  rm -rf dist/mac/mac dist/mac/mac-arm64 dist/mac/mac-x64

  if [ "$MODE" = "release" ]; then
    npx electron-builder -c mac/electron-builder.yml --mac "--$arch"
  else
    CSC_IDENTITY_AUTO_DISCOVERY=false \
      npx electron-builder -c mac/electron-builder.yml --mac "--$arch" \
        --config.mac.identity=null
  fi
}

if [ "$MODE" = "release" ]; then
  : "${CSC_LINK:?release 模式需要 CSC_LINK（签名证书 .p12 的路径）}"
  : "${CSC_KEY_PASSWORD:?release 模式需要 CSC_KEY_PASSWORD}"
  echo "── macOS（签名）"
else
  echo "── macOS（未签名）"
fi

build_arch arm64
build_arch x64

echo
echo "产物："
ls -lh dist/mac/*.dmg 2>/dev/null || echo "（没有 dmg，检查上面的日志）"

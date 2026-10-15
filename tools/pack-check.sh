#!/bin/sh
# 资源包（K4）端到端验收：生成测试包 → 在浏览器里导入 → 直接读图集像素验证替换生效
#
# 前置：dev server 已经在跑（npm run dev）。
# 用法：sh tools/pack-check.sh

set -e

URL="${1:-http://localhost:5173/}"

echo "== 生成测试资源包 =="
node tools/make-test-pack.mjs .tmp/test-pack.mcpack

echo "== 把包内容注入验收脚本 =="
PACK_B64=$(base64 -i .tmp/test-pack.mcpack | tr -d '\n')
sed "s|__PACK_BASE64__|$PACK_B64|" tools/pack-acceptance.js > .tmp/pack-verify.js

echo "== 浏览器导入并核对 =="
playwright-cli goto "$URL" >/dev/null
sleep 14
playwright-cli eval "eval(atob('$(base64 -i .tmp/pack-verify.js | tr -d '\n')'))" | grep -v "await page"

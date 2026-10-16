#!/bin/sh
# 启动耗时验收（N8 的判据，批次 103）
#
# 前置：dev server 已经在跑（npm run dev）。
# 用法：sh tools/startup-check.sh [url]
#
# ⚠️ 这个脚本**自己先 goto 一次**：`bootMs`（首次访问到主菜单）只在**冷启动**那一次有值，
#    在已经加载好的页面上重跑只会拿到"—"。所以别把它塞进 ui-check.sh 的循环里。
#
# 与 `tools/ui-check.sh` 一样：把 `tools/startup-acceptance.js` 用 base64 传进页面执行
# （多行脚本直接传会被命令行解析吃掉换行，base64 可以原样带过去；
#  `atob` 解出来是二进制字符串，必须用 TextDecoder 按 UTF-8 还原，否则中文乱码）。

set -e

URL="${1:-http://localhost:5173/}"
SCRIPT="tools/startup-acceptance.js"

echo "=== 启动耗时验收：${URL} ==="
playwright-cli goto "$URL" >/dev/null
playwright-cli eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i "$SCRIPT" | tr -d '\n')'), (c) => c.charCodeAt(0))))" |
  sed 's/\\n/\n/g' | grep -E '\[OK\]|\[FAIL\]|^  '
echo ""

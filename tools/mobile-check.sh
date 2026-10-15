#!/bin/sh
# 以手机视口跑一遍移动端验收（M17）
#
# 前置：dev server 已经在跑（npm run dev）。
# 脚本会把 tools/mobile-acceptance.js 用 base64 传进页面执行——
# 直接传多行脚本会被命令行解析吃掉换行，base64 可以原样带过去。
#
# 用法：sh tools/mobile-check.sh [宽 高] [url]

set -e

WIDTH="${1:-430}"
HEIGHT="${2:-932}"
URL="${3:-http://localhost:5173/}"

echo "移动端验收：视口 ${WIDTH}×${HEIGHT} · ${URL}"
playwright-cli resize "$WIDTH" "$HEIGHT" >/dev/null
playwright-cli goto "$URL" >/dev/null
# 等世界加载出一片区块，否则帧率与内存都在爬坡期
sleep 12
playwright-cli eval "eval(atob('$(base64 -i tools/mobile-acceptance.js | tr -d '\n')'))"

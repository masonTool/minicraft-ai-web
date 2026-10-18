#!/bin/sh
# 批次 181 用户反馈专项验收（真浏览器）
# 前置：dev server 在跑；playwright-cli 已 open。
# 用法：sh tools/feedback181-check.sh [url]

set -e

URL="${1:-http://localhost:5173/}"
SCRIPT="tools/feedback181-acceptance.js"

playwright-cli resize 844 390 >/dev/null
playwright-cli goto "$URL" >/dev/null
sleep 6
playwright-cli eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i "$SCRIPT" | tr -d '\n')'), (c) => c.charCodeAt(0))))" |
  sed 's/\\n/\n/g' | grep -E '\[OK\]|\[FAIL\]|^结果'

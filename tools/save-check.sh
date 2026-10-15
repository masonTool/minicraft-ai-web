#!/bin/sh
# 存档（K1）端到端验收：改世界 → 保存 → **刷新页面** → 核对是否恢复
#
# 前置：dev server 已经在跑（npm run dev）。
# 必须真的重载页面才有意义——同一页面里读回来只是内存里的 Map 还在。
#
# 注：playwright 的 goto 之间 localStorage 不保留（IndexedDB 保留），
#     所以第一步把测试坐标打在输出里，由本脚本解析后注入第二步。
#
# 用法：sh tools/save-check.sh [url]

set -e

URL="${1:-http://localhost:5173/}"

echo "== 第一步：改世界并保存 =="
playwright-cli goto "$URL" >/dev/null
sleep 14
OUT1=$(playwright-cli eval "eval(atob('$(base64 -i tools/save-acceptance-write.js | tr -d '\n')'))")
echo "$OUT1" | grep -v "await page"

SAVE_INFO=$(printf '%s' "$OUT1" | tr -d '\\' | grep -o 'saveInfo={[^}]*}' | sed 's/saveInfo=//' || true)
if [ -z "$SAVE_INFO" ]; then
  echo "解析不到第一步的坐标，验收中止"
  exit 1
fi
echo "注入坐标：$SAVE_INFO"

echo
echo "== 第二步：刷新页面（模拟关掉游戏再打开） =="
playwright-cli goto "$URL" >/dev/null
sleep 14

# 把坐标塞进第二步脚本（脚本里留了一个 JSON 占位符）
sed "s|__SAVE_INFO_JSON__|$SAVE_INFO|" tools/save-acceptance-verify.js > .tmp/save-verify.js
playwright-cli eval "eval(atob('$(base64 -i .tmp/save-verify.js | tr -d '\n')'))" | grep -v "await page"

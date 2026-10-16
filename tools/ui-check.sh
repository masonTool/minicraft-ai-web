#!/bin/sh
# 界面适配验收（批次 26）：竖屏手机与横屏手机各跑一遍
#
# 前置：dev server 已经在跑（npm run dev）。
# 用法：sh tools/ui-check.sh [url]
#
# 为什么两种视口都要跑：
#   - 竖屏（430×932）：分页的**窄屏页大小**（32 件）与单行滚动的分类标签只在这时生效；
#     快捷栏两侧的背包/聊天键在竖屏下没有横向空间，退回"两端上方"
#   - 横屏（844×390）：屏幕够宽，背包/聊天按基岩版摆到快捷栏左右两侧
# 脚本把 tools/ui-acceptance.js 用 base64 传进页面执行——直接传多行脚本
# 会被命令行解析吃掉换行，base64 可以原样带过去。

set -e

URL="${1:-http://localhost:5173/}"
SCRIPT="tools/ui-acceptance.js"

run_case() {
  WIDTH="$1"
  HEIGHT="$2"
  echo "=== 界面验收：视口 ${WIDTH}×${HEIGHT} ==="
  playwright-cli resize "$WIDTH" "$HEIGHT" >/dev/null
  playwright-cli goto "$URL" >/dev/null
  # 等世界与 UI 就绪（触摸层是世界加载完后才创建的）。
  # 脚本自己会点"创建并进入"（全新会话里主菜单是空的），慢机器留足时间。
  sleep 6
  # ⚠️ `atob` 解出来的是**二进制字符串**，直接 eval 会让脚本里的中文变成乱码
  #    （表现为"搜索汉字搜不到东西"这类莫名其妙的失败）；用 TextDecoder 按 UTF-8 还原
  playwright-cli eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i "$SCRIPT" | tr -d '\n')'), (c) => c.charCodeAt(0))))" |
    sed 's/\\n/\n/g' | grep -E '\[OK\]|\[FAIL\]|^  '
  echo ""
}

# 1) 手机竖屏：窄屏页大小（32 件）、分类标签单行滚动、安全区
# 2) 手机横屏：快捷栏两侧的背包/聊天键摆到左右两侧
run_case 430 932
run_case 844 390
# 3) PC：宽屏页大小（60 件）与分页条——用户提的"PC 端显示"也要有回归
run_case 1440 900

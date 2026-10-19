#!/bin/sh
# 角色形象验收（批次 333）
#
# 前置：dev server 在跑；浏览器已用 `playwright-cli -s=<session> open --mobile` 打开
#       （需要 touch，否则 body.touch-mode 不会挂上，横屏布局与触摸路径都测不到）。
# 用法：sh tools/appearance-check.sh [url]
#
# 脚本把 tools/appearance-acceptance.js 用 base64 传进页面执行——直接传多行脚本
# 会被命令行解析吃掉换行，base64 可以原样带过去；再用 TextDecoder 按 UTF-8 还原，
# 否则脚本里的中文断言会变成乱码。

URL="${1:-http://localhost:5173/}"
SCRIPT="tools/appearance-acceptance.js"
# 可选：SESSION=xxx 指定 playwright-cli 的会话名（默认用当前活动会话）
PW="playwright-cli"
if [ -n "$SESSION" ]; then PW="playwright-cli -s=$SESSION"; fi

$PW resize 844 390 >/dev/null 2>&1
$PW goto "$URL" >/dev/null 2>&1
# 等世界与 UI 就绪（触摸层是世界加载完后才创建的）
sleep 8
$PW eval "() => document.getElementById('rotate-hint')?.remove()" >/dev/null 2>&1
$PW eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i "$SCRIPT" | tr -d '\n')'), (c) => c.charCodeAt(0))))" |
  sed 's/\\n/\n/g' | grep -E '\[OK\]|\[FAIL\]|^  '

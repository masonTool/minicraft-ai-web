#!/bin/sh
# 批次 185 用户反馈专项验收（真浏览器 + 触摸模拟）
#
# 前置：dev server 在跑；playwright-cli 已用 --mobile 打开（需要 touch/粗指针，
#       桌面上下文里竖屏浮层与触摸控件都不会挂上）。
#
# 用法：sh tools/feedback185-check.sh [url]

URL="${1:-http://localhost:5173/}"
SCRIPT="tools/feedback185-acceptance.js"

echo "=== ① 竖屏：整屏浮层 ==="
# ⚠️ 全屏状态会跨同源导航保留：上一轮结束时如果还在全屏，`resize` 不生效、
#    竖屏浮层永远不会出现（假红）。先退全屏，再定尺寸，再冷加载一次。
playwright-cli resize 360 732 >/dev/null 2>&1
playwright-cli goto "$URL" >/dev/null 2>&1
sleep 4
playwright-cli eval "() => { if (document.fullscreenElement) document.exitFullscreen(); return true; }" >/dev/null 2>&1
sleep 1
playwright-cli resize 360 732 >/dev/null 2>&1
playwright-cli reload >/dev/null 2>&1
sleep 10
playwright-cli eval "() => { const h=document.getElementById('rotate-hint'); const r=h&&h.getBoundingClientRect(); const ok=!!h&&h.classList.contains('visible')&&r.width>=innerWidth-1&&r.height>=innerHeight-1; return (ok?'[OK] 竖屏浮层盖满整屏':'[FAIL] 竖屏浮层缺失')+'  ->  '+Math.round(r?.width||0)+'x'+Math.round(r?.height||0)+' vp '+innerWidth+'x'+innerHeight; }" 2>&1 |
  grep -E '^"?\[(OK|FAIL)\]'
playwright-cli click "#rotate-hint" >/dev/null 2>&1
sleep 1
playwright-cli eval "() => (document.fullscreenElement?'[OK] 点浮层进入全屏':'[FAIL] 点浮层没进全屏')+'  ->  '+(document.getElementById('rotate-hint')?.classList.contains('visible')?'竖屏时浮层仍在':'浮层已收')" 2>&1 |
  grep -E '^"?\[(OK|FAIL)\]'
playwright-cli resize 844 390 >/dev/null 2>&1
sleep 1
playwright-cli eval "() => (document.getElementById('rotate-hint')?.classList.contains('visible')?'[FAIL] 横屏后浮层没消失':'[OK] 横屏后浮层自动收起')" 2>&1 |
  grep -E '^"?\[(OK|FAIL)\]'

echo "=== ② 横屏：整条流程 ==="
# 同上：①里点浮层进过全屏，不退掉的话 resize 到 844×390 不生效
playwright-cli eval "() => { if (document.fullscreenElement) document.exitFullscreen(); return true; }" >/dev/null 2>&1
sleep 1
playwright-cli resize 844 390 >/dev/null 2>&1
playwright-cli reload >/dev/null 2>&1
sleep 10
playwright-cli eval "eval(new TextDecoder().decode(Uint8Array.from(atob('$(base64 -i "$SCRIPT" | tr -d '\n')'), (c) => c.charCodeAt(0))))" 2>&1 |
  sed 's/\\n/\n/g' | grep -E '^"?\[(OK|FAIL)\]'

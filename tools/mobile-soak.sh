#!/bin/sh
# 移动端长跑验收（M17）：连续游玩若干分钟，定期采样内存/帧率/区块数，看趋势
#
# 目的：真机的发热与耗电只能上手摸，但**内存泄漏**在桌面浏览器上就能复现
# （同一套代码路径），长跑采样是最接近真机的一次自动化替代。
#
# 用法：sh tools/mobile-soak.sh [采样次数] [间隔秒] [视口宽] [视口高]
#       默认 18 次 × 20 秒 = 6 分钟

set -e

COUNT="${1:-18}"
INTERVAL="${2:-20}"
WIDTH="${3:-430}"
HEIGHT="${4:-932}"
URL="${5:-http://localhost:5173/}"

OUT=.tmp/soak-samples.txt
: > "$OUT"

echo "移动端长跑：${COUNT} 次 × ${INTERVAL} 秒（约 $((COUNT * INTERVAL / 60)) 分钟），视口 ${WIDTH}×${HEIGHT}"
playwright-cli resize "$WIDTH" "$HEIGHT" >/dev/null
playwright-cli goto "$URL" >/dev/null
sleep 14

# 先在附近随意走动，模拟"真的在玩"——静止挂机的内存表现没有参考价值
playwright-cli eval "(function(){var mc=window.__mc;mc.enableTouchControls();return 'touch ui on';})()" >/dev/null

START=$(date +%s)
i=1
while [ "$i" -le "$COUNT" ]; do
  # 每轮挪一下位置，触发区块的加载/卸载与网格化
  playwright-cli eval "(function(){var mc=window.__mc;var p=mc.info.position;var a=$i*0.7;mc.teleportForce(p[0]+Math.cos(a)*24,p[1],p[2]+Math.sin(a)*24);return 'moved';})()" >/dev/null 2>&1 || true
  # 取 "### Result" 下面那一行（脚本返回的是 key=value 文本）
  RAW=$(playwright-cli eval "eval(atob('$(base64 -i tools/mobile-soak.js | tr -d '\n')'))" 2>/dev/null \
    | grep -o 'heap=[0-9.a-z]*MB fps=[0-9]* chunks=[0-9]* tri=[0-9]* ent=[0-9]* view=[0-9]* edits=[0-9]* editChunks=[0-9]* pending=[0-9]* pos=[-0-9/]*' | head -1)
  ELAPSED=$(( $(date +%s) - START ))
  if [ -n "$RAW" ]; then
    printf '%4ds  %s\n' "$ELAPSED" "$RAW" | tee -a "$OUT"
  else
    printf '%4ds  (采样失败)\n' "$ELAPSED" | tee -a "$OUT"
  fi
  i=$((i + 1))
  [ "$i" -le "$COUNT" ] && sleep "$INTERVAL"
done

echo
echo "== 趋势 =="
FIRST=$(head -1 "$OUT")
LAST=$(tail -1 "$OUT")
echo "首采样：$FIRST"
echo "末采样：$LAST"

#!/bin/sh
# PWA（K8）验收：构建产物 + 预览服务上检查 manifest / Service Worker / 离线缓存
#
# Service Worker 只在生产模式注册，因此必须先构建再预览（开发服务器上跑不出结果）。
#
# 用法：sh tools/pwa-check.sh

set -e

PORT=4173

echo "== 构建 =="
npm run build 2>&1 | tail -3
echo
echo "== 检查构建产物里有没有 PWA 文件 =="
for f in dist/manifest.webmanifest dist/sw.js dist/icon.svg; do
  if [ -f "$f" ]; then echo "  ✓ $f"; else echo "  ✗ $f 缺失"; exit 1; fi
done

echo
echo "== 启动预览服务（端口 $PORT） =="
npx vite preview --port $PORT > .tmp/preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
sleep 3

echo "== 第一次访问（注册 Service Worker） =="
playwright-cli goto "http://localhost:$PORT/" >/dev/null
sleep 10
playwright-cli eval "eval(atob('$(base64 -i tools/pwa-acceptance.js | tr -d '\n')'))" | grep -v "await page"

echo
echo "== 第二次访问（Service Worker 应当已接管） =="
playwright-cli goto "http://localhost:$PORT/" >/dev/null
sleep 8
playwright-cli eval "eval(atob('$(base64 -i tools/pwa-acceptance.js | tr -d '\n')'))" | grep -v "await page"

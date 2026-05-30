#!/usr/bin/env bash
# start-production.sh — 一键启动 production 模式（不需要 Tauri/exe）
# 浏览器打开 http://localhost:3000 就是产品体验
set -euo pipefail
cd "$(dirname "$0")/.."

# 启动 WeChat read server
echo "Starting WeChat read server (port 8766)..."
node scripts/wechat-read-server.mjs > /tmp/wechat-read.log 2>&1 &

# 启动 production standalone server
echo "Starting production server (port 3000)..."
export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-$(grep DEEPSEEK_API_KEY .env 2>/dev/null | cut -d= -f2)}"
export PORT=3000
export HOSTNAME=127.0.0.1
export NODE_ENV=production

if [ -f "apps/web/.next/standalone/apps/web/server.js" ]; then
  # Static files must be copied into standalone (Next.js doesn't include them)
  mkdir -p apps/web/.next/standalone/apps/web/.next/static
  cp -r apps/web/.next/static/* apps/web/.next/standalone/apps/web/.next/static/ 2>/dev/null
  # Public assets too
  cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null
  node apps/web/.next/standalone/apps/web/server.js &
  echo "Production standalone server started"
else
  echo "No standalone build found. Run: bash scripts/legacy/build-all.sh first"
  exit 1
fi

sleep 5
curl -s -o /dev/null -w "localhost:3000 → %{http_code}\n" http://localhost:3000/

# Warm up all pages in background (trigger compilation so user gets instant response)
echo "Warming up pages..."
for route in / /members /inbound /me /connectors /skills /deliverables /references /onboarding; do
  curl -s -o /dev/null "http://localhost:3000$route" &
done
wait
echo "All pages warmed ✅"

# Warm up Secretary CLI session (6s cold start → subsequent chats ~3s)
echo "Warming up Secretary session..."
curl -s -X POST http://localhost:3000/api/v1/chat/owner/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"."}]}' > /dev/null 2>&1 &
WARM_PID=$!
# Don't wait — let it run in background while user opens browser
echo "Secretary warming in background (PID $WARM_PID)"

echo ""
echo "✅ 打开浏览器访问: http://localhost:3000"
echo "   WeChat read server: http://localhost:8766"
echo "   按 Ctrl+C 停止"
wait

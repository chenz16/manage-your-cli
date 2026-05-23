#!/usr/bin/env bash
# regression-test.sh — 交付前必跑的回归测试
# 任何一项 FAIL 就不交付给 owner
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
BASE="http://localhost:3000"

check() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$code" = "$expect" ]; then
    echo "✅ $name ($code)"
    PASS=$((PASS+1))
  else
    echo "❌ $name — expected $expect got $code"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 页面加载 ==="
check "首页" "$BASE/" "200"
check "/members" "$BASE/members" "200"
check "/inbound" "$BASE/inbound" "200"
check "/me" "$BASE/me" "200"
check "/connectors" "$BASE/connectors" "200"
check "/skills" "$BASE/skills" "200"
check "/deliverables" "$BASE/deliverables" "200"

echo "=== Static 文件 ==="
# 从首页 HTML 提取一个 JS chunk URL 测试
JS_URL=$(curl -s "$BASE/" 2>/dev/null | grep -o '/_next/static/chunks/webpack[^"]*' | head -1)
if [ -n "$JS_URL" ]; then
  check "JS bundle" "$BASE$JS_URL" "200"
else
  echo "❌ JS bundle URL not found in HTML"
  FAIL=$((FAIL+1))
fi
CSS_URL=$(curl -s "$BASE/" 2>/dev/null | grep -o '/_next/static/css/[^"]*' | head -1)
if [ -n "$CSS_URL" ]; then
  check "CSS bundle" "$BASE$CSS_URL" "200"
else
  echo "❌ CSS URL not found"
  FAIL=$((FAIL+1))
fi

echo "=== API ==="
check "GET /api/v1/staff" "$BASE/api/v1/staff" "200"
check "GET /api/v1/skills" "$BASE/api/v1/skills" "200"
check "GET /api/v1/channels/wechat/contacts" "$BASE/api/v1/channels/wechat/contacts" "200"

echo "=== 无白屏检查 ==="
BODY=$(curl -s "$BASE/" 2>/dev/null)
if echo "$BODY" | grep -q "app-shell-row\|chat-surface\|nav-item\|AppShell\|ChatRuntimeProvider\|data-page"; then
  echo "✅ HTML 有实际 UI 内容（非白屏）"
  PASS=$((PASS+1))
else
  echo "❌ HTML 没有 UI 内容 — 可能白屏"
  FAIL=$((FAIL+1))
fi

echo "=== WeChat read server ==="
check "read server" "http://127.0.0.1:8766/read?contact=test" "200"

echo "=== 聊天响应测试 ==="
START=$(date +%s%N)
CHAT_RESP=$(powershell.exe -NoProfile -Command '
$body = @{messages=@(@{role="user";content="hello"})} | ConvertTo-Json -Compress
$client = New-Object System.Net.WebClient
$client.Encoding = [System.Text.Encoding]::UTF8
$client.Headers.Add("Content-Type","application/json; charset=utf-8")
try { $client.UploadString("http://localhost:3000/api/v1/chat/owner/stream",$body) } catch { "ERROR:" + $_.Exception.Message }
' 2>&1)
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
if echo "$CHAT_RESP" | grep -q "error\|ERROR\|Error"; then
  echo "❌ 聊天失败 (${ELAPSED}ms): $(echo "$CHAT_RESP" | head -1 | cut -c1-100)"
  FAIL=$((FAIL+1))
elif [ "$ELAPSED" -gt 10000 ]; then
  echo "❌ 聊天太慢 (${ELAPSED}ms > 10s)"
  FAIL=$((FAIL+1))
else
  echo "✅ 聊天响应 (${ELAPSED}ms)"
  PASS=$((PASS+1))
fi

echo "=== /clear 测试 ==="
CLEAR_RESP=$(curl -s -X POST http://localhost:3000/api/v1/admin/reset 2>&1)
if echo "$CLEAR_RESP" | grep -q '"ok":true'; then
  echo "✅ /clear (admin/reset) 工作"
  PASS=$((PASS+1))
else
  echo "❌ /clear 失败"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== 结果: $PASS 通过 / $FAIL 失败 ==="
[ "$FAIL" -eq 0 ] && echo "🟢 ALL PASS — 可以交付" || echo "🔴 有失败 — 不要交付"
exit $FAIL

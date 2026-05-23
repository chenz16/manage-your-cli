#!/usr/bin/env bash
# oauth-test-mode-on.sh — toggle HOLON_OAUTH_TEST_MODE on, restart release dev,
# smoke-probe the new /api/v1/integrations/auth/session endpoint.
#
# Purpose: verify the iter-013 (NextAuth) pipe end-to-end WITHOUT needing
# real GCP OAuth credentials. The test mode short-circuits Google's OAuth
# dance with canned values ("test@example.com" etc.) so the UI flow, BFF,
# token storage, and audit emit can all be exercised.
#
# To turn it off later: bash scripts/oauth-test-mode-off.sh (or just
# remove HOLON_OAUTH_TEST_MODE from .env and restart).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found." >&2
  exit 2
fi

# Append or update HOLON_OAUTH_TEST_MODE=true
python3 - "${ENV_FILE}" <<'PY'
import sys, pathlib
env = pathlib.Path(sys.argv[1])
lines = env.read_text().splitlines()
seen = False
out = []
for ln in lines:
    if ln.startswith("HOLON_OAUTH_TEST_MODE="):
        out.append("HOLON_OAUTH_TEST_MODE=true"); seen = True
    else:
        out.append(ln)
if not seen: out.append("HOLON_OAUTH_TEST_MODE=true")
env.write_text("\n".join(out) + "\n")
print("✓ HOLON_OAUTH_TEST_MODE=true")
PY

echo ""
echo "Restarting release dev (port 3000) — env reload required..."
PID_3000=$(ss -tlnp 2>/dev/null | awk '/:3000 /{ for(i=1;i<=NF;i++) if($i ~ /pid=/){ split($i, a, ","); split(a[1], b, "="); print b[2]; exit }}')
if [ -n "${PID_3000:-}" ]; then
  kill "${PID_3000}" 2>/dev/null || true
  echo "  killed PID ${PID_3000}"
fi

cd "${REPO_ROOT}/apps/web"
rm -rf .next
nohup pnpm dev > /tmp/holon-dev.log 2>&1 & disown
echo "  starting fresh pnpm dev (release on port 3000)..."

until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -qE "200|500"; do sleep 1; done
echo "  dev port 3000 listening"

# Give Next a few seconds to compile / on first cold hit
echo "  waiting for / to compile..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 http://localhost:3000/)
  if [ "$CODE" = "200" ]; then
    echo "  / serves 200"
    break
  fi
  sleep 2
done

echo ""
echo "==================== SMOKE ===================="
echo ""

echo "1. /api/auth/providers (NextAuth provider config):"
curl -s http://localhost:3000/api/auth/providers | head -c 300
echo ""
echo ""

echo "2. /api/auth/signin/google (would normally 302 to Google; in TEST_MODE this still 302s to NextAuth's signin page since the dance is short-circuited inside the callback):"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:3000/api/auth/signin/google

echo ""
echo "3. /me (where the Connect Gmail button lives):"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:3000/me

echo ""
echo "4. /api/v1/integrations/auth/session (Hermes plugin's new endpoint — should 401 without session cookie):"
curl -s -w "  HTTP %{http_code}\n  body: " http://localhost:3000/api/v1/integrations/auth/session -X POST -H "Content-Type: application/json" -d '{"provider":"google"}' --max-time 30
echo ""

echo "==================== DONE ===================="
echo ""
echo "✓ TEST_MODE is ON. Open http://localhost:3000/me in your browser, click"
echo "  Connect Gmail. The flow will short-circuit through NextAuth's test"
echo "  callback and land you back on /me as 'Connected as test@example.com'."
echo ""
echo "To turn TEST_MODE off (use real Google): set HOLON_OAUTH_TEST_MODE=false"
echo "  in .env and restart dev."

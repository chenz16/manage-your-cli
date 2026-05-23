#!/usr/bin/env bash
# oauth-finish-setup.sh — finalize iter-011 Gmail OAuth config + restart dev
#
# Run after you have your GCP Web-application OAuth credentials:
#   bash scripts/oauth-finish-setup.sh '<GOOGLE_CLIENT_ID>' '<GOOGLE_CLIENT_SECRET>'
#
# Idempotent: re-running with new credentials just overwrites the two lines.
# Restarts the release dev server (port 3000) so the new env vars load
# (Next reads env at boot via instrumentation.ts; HMR alone won't pick them up).

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: bash scripts/oauth-finish-setup.sh '<GOOGLE_CLIENT_ID>' '<GOOGLE_CLIENT_SECRET>'" >&2
  exit 1
fi

CLIENT_ID="$1"
CLIENT_SECRET="$2"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found. Did the .env scaffolding step run?" >&2
  exit 2
fi

# Replace (or append) the two GOOGLE_* lines. Use python so quoting + special
# chars in the secret never bite (sed would).
python3 - "${ENV_FILE}" "${CLIENT_ID}" "${CLIENT_SECRET}" <<'PY'
import sys, pathlib
env_path = pathlib.Path(sys.argv[1])
cid, csec = sys.argv[2], sys.argv[3]
lines = env_path.read_text().splitlines()
seen_id, seen_sec = False, False
out = []
for ln in lines:
    if ln.startswith("GOOGLE_CLIENT_ID="):
        out.append(f"GOOGLE_CLIENT_ID={cid}"); seen_id = True
    elif ln.startswith("GOOGLE_CLIENT_SECRET="):
        out.append(f"GOOGLE_CLIENT_SECRET={csec}"); seen_sec = True
    else:
        out.append(ln)
if not seen_id:  out.append(f"GOOGLE_CLIENT_ID={cid}")
if not seen_sec: out.append(f"GOOGLE_CLIENT_SECRET={csec}")
env_path.write_text("\n".join(out) + "\n")
print("✓ .env updated")
PY

echo ""
echo "Restarting release dev (port 3000) — env reload required..."
# Scoped kill: only the 3000 listener (per L-015 collateral lesson).
PID_3000=$(ss -tlnp 2>/dev/null | awk '/:3000 /{ for(i=1;i<=NF;i++) if($i ~ /pid=/){ split($i, a, ","); split(a[1], b, "="); print b[2]; exit }}')
if [ -n "${PID_3000:-}" ]; then
  kill "${PID_3000}" 2>/dev/null || true
  echo "  killed PID ${PID_3000}"
fi

cd "${REPO_ROOT}/apps/web"
rm -rf .next
nohup pnpm dev > /tmp/holon-dev.log 2>&1 & disown
echo "  starting fresh pnpm dev..."

until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -qE "200|500"; do sleep 1; done
echo "  dev ready"

echo ""
echo "Smoke probe: /api/v1/integrations/oauth/gmail/authorize"
PROBE=$(curl -s -w "\n%{http_code}" "http://localhost:3000/api/v1/integrations/oauth/gmail/authorize")
CODE=$(echo "$PROBE" | tail -1)
BODY=$(echo "$PROBE" | head -c 200)
echo "  HTTP ${CODE}"
echo "  body: ${BODY}"

if [ "$CODE" = "200" ] || [ "$CODE" = "302" ] || [ "$CODE" = "307" ]; then
  echo ""
  echo "✓ OAuth /authorize wired. Open http://localhost:3000/me and click Connect Gmail."
elif echo "$BODY" | grep -q "oauth_config_error"; then
  echo ""
  echo "✗ Still missing config. Check ${ENV_FILE} for the two GOOGLE_* values."
  exit 3
else
  echo ""
  echo "? Unexpected response — check /tmp/holon-dev.log for boot errors."
fi

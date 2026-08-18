#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
PIDFILE="$ROOT/logs/app.pid"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE"))"
  echo "Use ./scripts/restart.sh to rebuild the UI and restart."
  exit 0
fi

if [[ "${SKIP_FRONTEND_BUILD:-}" != "1" ]]; then
  "$ROOT/scripts/build-frontend.sh"
fi

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "frontend/dist is missing. Run ./scripts/install.sh" >&2
  exit 1
fi

nohup node backend/src/index.js >> logs/stdout.log 2>&1 &
echo $! > "$PIDFILE"
PID="$(cat "$PIDFILE")"
echo "Started on port ${PORT:-9454} (pid $PID)"

ok=0
for _ in $(seq 1 20); do
  if curl -sf --max-time 1 "http://127.0.0.1:${PORT:-9454}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Process exited. Last log:" >&2
    tail -n 40 logs/stdout.log >&2 || true
    exit 1
  fi
  sleep 0.4
done
if [[ "$ok" -ne 1 ]]; then
  echo "Started but http://127.0.0.1:${PORT:-9454}/health did not respond. Last log:" >&2
  tail -n 40 logs/stdout.log >&2 || true
  echo "Run ./scripts/diagnose.sh" >&2
  exit 1
fi
curl -s "http://127.0.0.1:${PORT:-9454}/health"
echo
echo "Local health OK. If the public URL still fails, open firewall: ufw allow 9454/tcp"

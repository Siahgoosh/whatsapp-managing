#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
PIDFILE="$ROOT/logs/app.pid"

ui_is_current() {
  [[ -f "$ROOT/frontend/dist/ui-version.txt" ]] && grep -qx "scan-share-v1" "$ROOT/frontend/dist/ui-version.txt"
}

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  if ui_is_current; then
    echo "Already running (pid $(cat "$PIDFILE"))"
    echo "If the scan button is missing, hard-refresh the browser (Ctrl+Shift+R)."
    curl -s "http://127.0.0.1:${PORT:-9454}/health" || true
    echo
    exit 0
  fi
  echo "Running process has an old UI. Stopping so the scan/share page can be served."
  "$ROOT/scripts/stop.sh" || true
fi

if [[ "${SKIP_FRONTEND_BUILD:-}" != "1" ]] || ! ui_is_current; then
  if [[ -d "$ROOT/frontend/src" ]]; then
    "$ROOT/scripts/build-frontend.sh" || {
      if ui_is_current; then
        echo "Build failed, but committed dist already has the scan UI. Continuing."
      else
        exit 1
      fi
    }
  fi
fi

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "frontend/dist is missing. Run ./scripts/install.sh" >&2
  exit 1
fi
if ! ui_is_current; then
  echo "frontend/dist is stale (need scan-share-v1). Run ./scripts/build-frontend.sh" >&2
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

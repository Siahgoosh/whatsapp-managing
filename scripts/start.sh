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
echo "Started on port ${PORT:-9454} (pid $(cat "$PIDFILE"))"

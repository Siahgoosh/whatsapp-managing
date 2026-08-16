#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/app.pid"
if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Stopped pid $PID"
  fi
  rm -f "$PIDFILE"
else
  echo "Not running"
fi

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
PIDFILE="$ROOT/logs/app.pid"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup node backend/src/index.js >> logs/stdout.log 2>&1 &
echo $! > "$PIDFILE"
echo "Started on port ${PORT:-9454} (pid $(cat "$PIDFILE"))"

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/logs/app.pid"
PORT="${PORT:-9454}"

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
    echo "Stopped pid $PID"
  fi
  rm -f "$PIDFILE"
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti ":${PORT}" | xargs -r kill -9 2>/dev/null || true
fi

if command -v docker >/dev/null 2>&1; then
  docker compose -f "$ROOT/docker-compose.yml" down >/dev/null 2>&1 || true
fi

echo "Port ${PORT} is free"

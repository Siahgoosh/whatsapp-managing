#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-9454}"

echo "=== git ==="
git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true
git -C "$ROOT" log -1 --oneline 2>/dev/null || true

echo "=== frontend dist ==="
if [[ -f frontend/dist/index.html ]]; then
  echo "OK frontend/dist/index.html"
  grep -l "admin-outreach" frontend/dist/assets/*.js 2>/dev/null | head -1 || echo "WARNING: built JS may be old (no admin-outreach)"
else
  echo "MISSING frontend/dist/index.html"
fi

echo "=== pidfile ==="
if [[ -f logs/app.pid ]]; then
  PID="$(cat logs/app.pid)"
  echo "logs/app.pid=$PID"
  if kill -0 "$PID" 2>/dev/null; then echo "process alive"; else echo "process DEAD"; fi
else
  echo "no pidfile"
fi

echo "=== listeners on $PORT ==="
ss -lptn "sport = :$PORT" 2>/dev/null || netstat -lptn 2>/dev/null | grep ":$PORT" || true

echo "=== docker ==="
docker ps -a --filter name=whatsapp-campaign-manager 2>/dev/null || echo "docker not available"

echo "=== localhost health ==="
curl -sv --max-time 3 "http://127.0.0.1:${PORT}/health" 2>&1 | tail -25 || true

echo "=== last logs ==="
tail -n 40 logs/stdout.log 2>/dev/null || echo "no stdout.log"
echo "=== diagnose done ==="

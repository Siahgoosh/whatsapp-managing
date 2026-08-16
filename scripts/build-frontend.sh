#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d frontend/node_modules ]]; then
  echo "==> Installing frontend dependencies"
  npm --prefix frontend install
fi

echo "==> Building frontend (dist is not in git — required after every pull)"
npm --prefix frontend run build

if [[ ! -f frontend/dist/index.html ]]; then
  echo "Frontend build failed: frontend/dist/index.html is missing" >&2
  exit 1
fi

if ! grep -q "admin-outreach" frontend/dist/assets/*.js frontend/dist/index.html 2>/dev/null; then
  echo "Warning: built UI does not contain Admin Outreach routes. Check that source was pulled." >&2
fi

echo "==> Frontend build ready"

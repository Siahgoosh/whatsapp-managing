#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d frontend/node_modules ]]; then
  echo "==> Installing frontend dependencies"
  npm --prefix frontend install
fi

echo "==> Building frontend"
npm --prefix frontend run build

if [[ ! -f frontend/dist/index.html ]]; then
  echo "Frontend build failed: frontend/dist/index.html is missing" >&2
  exit 1
fi

if ! grep -q "scan-share-v" frontend/dist/ui-version.txt 2>/dev/null; then
  echo "Frontend build failed: ui-version.txt is missing scan-share stamp" >&2
  exit 1
fi

if ! grep -q "اسکن همه گروه‌ها همین الان" frontend/dist/assets/*.js 2>/dev/null; then
  echo "Frontend build failed: scan button is missing from the bundle" >&2
  exit 1
fi

echo "==> Frontend build ready"

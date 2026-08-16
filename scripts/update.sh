#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${1:-cursor/whatsapp-campaign-manager-b0db}"

echo "==> Stopping old process / Docker so port 9454 is free"
"$ROOT/scripts/stop.sh" || true

echo "==> Updating $BRANCH"
# Local edits to the example env file must not block pull. Never touch .env.
if ! git diff --quiet -- .env.example 2>/dev/null; then
  echo "Discarding local .env.example (your real .env is kept)"
  git checkout -- .env.example
fi
git fetch origin
git pull origin "$BRANCH"
chmod +x scripts/*.sh
./scripts/install.sh
./scripts/restart.sh
echo "==> Update complete. Hard-refresh the browser (Ctrl+Shift+R)."
echo "Check: curl -s http://127.0.0.1:9454/health"

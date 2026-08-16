#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${1:-cursor/whatsapp-campaign-manager-b0db}"

echo "==> Updating $BRANCH"
git fetch origin
git pull origin "$BRANCH"
./scripts/install.sh
./scripts/restart.sh
echo "==> Update complete. Hard-refresh the browser (Ctrl+Shift+R)."

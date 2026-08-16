#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing WhatsApp Campaign Manager"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit ADMIN_PASSWORD and SESSION_SECRET before going live."
fi

mkdir -p database uploads logs sessions
npm install
npm --prefix frontend install
npm --prefix frontend run build
echo "==> Install complete. Start with ./scripts/start.sh"

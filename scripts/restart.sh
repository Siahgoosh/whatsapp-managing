#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/stop.sh" || true
sleep 1
"$ROOT/scripts/start.sh"

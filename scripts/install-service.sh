#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/scripts/whatsapp-managing.service"
UNIT_DST="/etc/systemd/system/whatsapp-managing.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo ./scripts/install-service.sh" >&2
  exit 1
fi

sed "s#WorkingDirectory=/opt/whatsapp-managing#WorkingDirectory=${ROOT}#" "$UNIT_SRC" \
  | sed "s#EnvironmentFile=-/opt/whatsapp-managing/.env#EnvironmentFile=-${ROOT}/.env#" \
  > "$UNIT_DST"

systemctl daemon-reload
systemctl enable whatsapp-managing
"$ROOT/scripts/stop.sh" || true
systemctl restart whatsapp-managing
sleep 2
systemctl --no-pager --full status whatsapp-managing || true
curl -sf "http://127.0.0.1:${PORT:-9454}/health" && echo
echo "Service installed. Use: systemctl status whatsapp-managing"

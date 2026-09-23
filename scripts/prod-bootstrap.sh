#!/usr/bin/env bash
# Einmalige Prod-Pfade + Rechte (root auf Strato o. ä.)
set -euo pipefail
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-/opt/orbit/artifacts}"
SERVERS="${ORBIT_SERVERS_ROOT:-/opt/orbit/servers}"
USER_NAME="${ORBIT_USER:-tx2}"

mkdir -p "$ARTIFACTS" "$SERVERS" "/opt/orbit"
id "$USER_NAME" &>/dev/null || useradd -r -m -s /bin/bash "$USER_NAME"
chown -R "$USER_NAME:$USER_NAME" "$ARTIFACTS" "$SERVERS" "/opt/orbit"

if [[ -d /opt/tx2 ]]; then
  chown -R "$USER_NAME:$USER_NAME" /opt/tx2/data /opt/tx2/dist 2>/dev/null || true
fi

echo "OK: $ARTIFACTS und $SERVERS für $USER_NAME"
echo "Danach im Panel: Einstellungen → Host & Instanzen → Prod (License + MySQL)"

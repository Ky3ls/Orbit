#!/usr/bin/env bash
# Einmalige Prod-Pfade + Rechte
set -euo pipefail
INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-$INSTALL_DIR/artifacts}"
SERVERS="${ORBIT_SERVERS_ROOT:-$INSTALL_DIR/servers}"
USER_NAME="${ORBIT_USER:-orbit}"

mkdir -p "$ARTIFACTS" "$SERVERS" "$INSTALL_DIR/data"
id "$USER_NAME" &>/dev/null || useradd -r -m -s /bin/bash "$USER_NAME"
chown -R "$USER_NAME:$USER_NAME" "$ARTIFACTS" "$SERVERS" "$INSTALL_DIR/data" 2>/dev/null || true

echo "OK: $ARTIFACTS und $SERVERS für $USER_NAME"

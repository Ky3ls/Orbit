#!/usr/bin/env bash
# Einmalige Prod-Pfade (Orbit läuft als root)
set -euo pipefail
INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-$INSTALL_DIR/artifacts}"
SERVERS="${ORBIT_SERVERS_ROOT:-$INSTALL_DIR/servers}"

mkdir -p "$ARTIFACTS" "$SERVERS" "$INSTALL_DIR/data"

echo "OK: $ARTIFACTS und $SERVERS"

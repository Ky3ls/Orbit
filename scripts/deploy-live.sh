#!/usr/bin/env bash
# Live-Deploy: Build lokal, dann sicherer Code-Sync (kein Root --delete).
# Standardziel: /opt/orbit auf diesem Host (oder ORBIT_INSTALL_DIR / SSH-Host).
#
# Lokal auf dem Panel-Host:
#   bash scripts/deploy-live.sh
#
# Remote (optional):
#   ORBIT_DEPLOY_HOST=user@host ORBIT_REMOTE_DIR=/opt/orbit bash scripts/deploy-live.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ORBIT_DEPLOY_HOST:-${TX2_DEPLOY_HOST:-}}"
REMOTE_DIR="${ORBIT_REMOTE_DIR:-${TX2_REMOTE_DIR:-/opt/orbit}}"
USER_NAME="${ORBIT_USER:-orbit}"

cd "$ROOT"
npm run build

if [[ -z "$HOST" ]]; then
  # Gleicher Host: safe-sync (root nötig für chown/systemctl)
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Lokal als root ausführen: sudo bash $0"
    exit 1
  fi
  bash "$ROOT/scripts/safe-sync-live.sh" "$ROOT"
  if [[ ! -d "$REMOTE_DIR/node_modules" ]]; then
    runuser -u "$USER_NAME" -- bash -c "cd '$REMOTE_DIR' && npm ci --omit=dev"
  fi
  systemctl restart orbit
  sleep 1
  systemctl is-active orbit
  echo "Deploy OK → $REMOTE_DIR"
  exit 0
fi

# Remote: nur Code-Archive, extrahiert in Temp, dann safe-sync auf dem Ziel
ARCHIVE="/tmp/orbit-deploy-$$.tgz"
tar -czf "$ARCHIVE" \
  package.json package-lock.json \
  index.html vite.config.js README.md \
  src public dist server scripts docs resources

scp "$ARCHIVE" "$HOST:/tmp/orbit-deploy.tgz"
ssh "$HOST" "set -e
  TMP=\$(mktemp -d)
  tar -xzf /tmp/orbit-deploy.tgz -C \"\$TMP\"
  sudo ORBIT_INSTALL_DIR='$REMOTE_DIR' ORBIT_USER='$USER_NAME' \
    bash \"\$TMP/scripts/safe-sync-live.sh\" \"\$TMP\"
  if [[ ! -d '$REMOTE_DIR/node_modules' ]]; then
    sudo runuser -u '$USER_NAME' -- bash -c \"cd '$REMOTE_DIR' && npm ci --omit=dev\"
  fi
  sudo systemctl restart orbit
  sleep 1
  sudo systemctl is-active orbit
  rm -rf \"\$TMP\" /tmp/orbit-deploy.tgz
"
rm -f "$ARCHIVE"
echo "Deploy OK → $HOST:$REMOTE_DIR"

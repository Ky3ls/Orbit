#!/usr/bin/env bash
# Live-Deploy nach tx2.ky3ls.space (/opt/tx2 auf Strato)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TX2_DEPLOY_HOST:-Strato}"
REMOTE_DIR="${TX2_REMOTE_DIR:-/opt/tx2}"
ARCHIVE="/tmp/tx2-deploy-$$.tgz"

cd "$ROOT"
npm run build

tar -czf "$ARCHIVE" \
  package.json package-lock.json \
  index.html vite.config.js \
  src public \
  dist server scripts docs resources

scp "$ARCHIVE" "$HOST:/tmp/tx2-deploy.tgz"
ssh "$HOST" "set -e
  cd '$REMOTE_DIR'
  tar -xzf /tmp/tx2-deploy.tgz
  chown -R tx2:tx2 dist server scripts docs resources src public package.json package-lock.json index.html vite.config.js
  runuser -u tx2 -- npm ci --omit=dev
  systemctl restart tx2
  sleep 1
  systemctl is-active tx2
  rm -f /tmp/tx2-deploy.tgz
"
rm -f "$ARCHIVE"
echo "Deploy OK → https://tx2.ky3ls.space"

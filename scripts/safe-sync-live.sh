#!/usr/bin/env bash
# Sicherer Live-Code-Sync nach /opt/orbit (oder ORBIT_INSTALL_DIR).
#
# Synchronisiert NUR Code/Build — niemals data/, artifacts/, servers/, alpine/,
# node_modules/. Kein rsync --delete auf den Installations-Root.
#
# Usage (von Repo-Root oder mit SRC=):
#   sudo bash scripts/safe-sync-live.sh
#   sudo ORBIT_INSTALL_DIR=/opt/orbit bash scripts/safe-sync-live.sh /pfad/zum/repo
set -euo pipefail

INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
fi
SRC="$(cd "$SRC" && pwd)"

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Bitte als root: sudo bash $0"
    exit 1
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

need_root

[[ -f "$SRC/package.json" && -d "$SRC/server" ]] || {
  echo "Kein Orbit-Repo unter $SRC"
  exit 1
}
[[ -d "$INSTALL_DIR" ]] || {
  echo "Installationsziel fehlt: $INSTALL_DIR (erst install-orbit.sh)"
  exit 1
}

PROTECTED_ABS=(
  "$INSTALL_DIR/data"
  "$INSTALL_DIR/artifacts"
  "$INSTALL_DIR/servers"
  "$INSTALL_DIR/alpine"
  "$INSTALL_DIR/node_modules"
)

for p in "${PROTECTED_ABS[@]}"; do
  case "$SRC" in
    "$p"|"$p"/*)
      echo "ABORT: Quelle $SRC liegt unter geschütztem Pfad $p"
      exit 1
      ;;
  esac
done

if ! have rsync; then
  echo "rsync fehlt (apt install rsync)."
  exit 1
fi

echo "==> Safe-Sync: $SRC → $INSTALL_DIR (nur Code, kein Root --delete)"

rsync -a \
  "$SRC/package.json" \
  "$SRC/package-lock.json" \
  "$SRC/index.html" \
  "$SRC/vite.config.js" \
  "$INSTALL_DIR/"

sync_tree() {
  local name="$1"
  if [[ ! -d "$SRC/$name" ]]; then
    echo "  skip $name (fehlt in Quelle)"
    return 0
  fi
  mkdir -p "$INSTALL_DIR/$name"
  rsync -a --delete "$SRC/$name/" "$INSTALL_DIR/$name/"
  echo "  ok  $name/"
}

sync_tree server
sync_tree src
sync_tree scripts
sync_tree docs
sync_tree public
sync_tree resources
if [[ -d "$SRC/dist" ]]; then
  sync_tree dist
else
  echo "  skip dist/ (nicht gebaut — optional: npm run build in $SRC)"
fi

[[ -f "$SRC/README.md" ]] && rsync -a "$SRC/README.md" "$INSTALL_DIR/"

echo "==> Fertig. Persistenz unberührt: data/ artifacts/ servers/ alpine/"
echo "    Bei Bedarf: systemctl restart orbit"

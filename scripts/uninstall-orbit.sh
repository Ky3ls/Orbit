#!/usr/bin/env bash
# Orbit komplett deinstallieren (Dienst, Panel-Daten, optional Server-Ordner & Code).
#
#   sudo bash /opt/orbit/scripts/uninstall-orbit.sh
#   sudo bash /opt/orbit/scripts/uninstall-orbit.sh --keep-code
#   sudo ORBIT_DELETE_SERVERS=1 bash /opt/orbit/scripts/uninstall-orbit.sh
#
set -euo pipefail

INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
DATA_DIR="${ORBIT_DATA_DIR:-$INSTALL_DIR/data}"
SERVERS="${ORBIT_SERVERS_ROOT:-$INSTALL_DIR/servers}"
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-$INSTALL_DIR/artifacts}"
USER_NAME="${ORBIT_USER:-orbit}"
SERVICE_NAME=orbit
KEEP_CODE=0
DELETE_SERVERS="${ORBIT_DELETE_SERVERS:-1}"

for arg in "$@"; do
  case "$arg" in
    --keep-code) KEEP_CODE=1 ;;
    --keep-servers) DELETE_SERVERS=0 ;;
    --yes|-y) ;;
    *) echo "Unbekannt: $arg"; exit 1 ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Bitte als root: sudo bash $0"
  exit 1
fi

echo "==> Orbit deinstallieren"

# FX stoppen
pkill -f 'cfx-server/FXServer' 2>/dev/null || true
sleep 1
pkill -9 -f 'cfx-server/FXServer' 2>/dev/null || true

systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f /etc/systemd/system/"$SERVICE_NAME".service
rm -rf /etc/systemd/system/"$SERVICE_NAME".service.d
systemctl daemon-reload 2>/dev/null || true

# nginx Orbit-VHosts
shopt -s nullglob
for f in /etc/nginx/sites-enabled/orbit-*.conf /etc/nginx/sites-available/orbit-*.conf; do
  rm -f "$f"
  echo "  entfernt: $f"
done
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

# Server-Datenordner aus sqlite lesen (falls noch da)
if [[ -f "$DATA_DIR/orbit.sqlite" ]] && command -v sqlite3 >/dev/null 2>&1; then
  while IFS= read -r p; do
    [[ -n "$p" && -d "$p" ]] || continue
    if [[ "$DELETE_SERVERS" == "1" ]]; then
      echo "  lösche Server: $p"
      rm -rf "$p"
    fi
  done < <(sqlite3 "$DATA_DIR/orbit.sqlite" "SELECT data_path FROM orbit_servers;" 2>/dev/null || true)
  EXTRA="$(sqlite3 "$DATA_DIR/orbit.sqlite" "SELECT v FROM settings WHERE k='fxDataPath';" 2>/dev/null || true)"
  if [[ -n "$EXTRA" && -d "$EXTRA" && "$DELETE_SERVERS" == "1" ]]; then
    echo "  lösche fxDataPath: $EXTRA"
    rm -rf "$EXTRA"
  fi
fi

if [[ "$DELETE_SERVERS" == "1" && -d "$SERVERS" ]]; then
  echo "  lösche $SERVERS"
  rm -rf "$SERVERS"
fi

echo "  lösche Panel-Daten $DATA_DIR"
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"
# leerer Marker — kein Setup ohne Neuinstallation
echo "Orbit wurde deinstalliert. Neu: sudo bash scripts/install-orbit.sh" > "$DATA_DIR/UNINSTALLED"

if [[ -d "$ARTIFACTS" ]]; then
  echo "  lösche Artifacts $ARTIFACTS"
  rm -rf "$ARTIFACTS"
fi

rm -f /etc/sudoers.d/orbit

if [[ "$KEEP_CODE" -eq 0 ]]; then
  echo "  lösche Installationsverzeichnis $INSTALL_DIR (außer dieser Hinweis)"
  # Code löschen — Script läuft ggf. aus dem Ordner; erst am Ende
  cd /
  rm -rf "$INSTALL_DIR"
  echo "==> Fertig. Orbit ist entfernt. Neuinstallation:"
  echo "    curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh | sudo bash"
else
  chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR" 2>/dev/null || true
  echo "==> Fertig. Code unter $INSTALL_DIR behalten. Neu: sudo bash $INSTALL_DIR/scripts/install-orbit.sh"
fi

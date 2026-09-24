#!/usr/bin/env bash
# Orbit komplett deinstallieren (Dienst, Panel-Daten, Server-Ordner & Code).
#
#   sudo bash /opt/orbit/scripts/uninstall-orbit.sh
#   sudo bash /opt/orbit/scripts/uninstall-orbit.sh --keep-code
#
# Wichtig: Vom Panel aus per systemd-run starten (nicht in orbit.service-CGroup),
# sonst killt „systemctl stop orbit“ dieses Script mitten im Löschen.
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
LOG="${ORBIT_UNINSTALL_LOG:-/tmp/orbit-uninstall.log}"

exec > >(tee -a "$LOG") 2>&1

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

echo "==> Orbit deinstallieren ($(date -Is))"

# Aus orbit.service-CGroup raus (falls doch dort gestartet)
if [[ -w /sys/fs/cgroup/system.slice/cgroup.procs ]]; then
  echo $$ >/sys/fs/cgroup/system.slice/cgroup.procs 2>/dev/null || true
fi

# Kurz warten, damit HTTP-Antwort des Panels durchkommt
sleep 2

# FX stoppen (Fehlercodes ignorieren)
pkill -f 'cfx-server/FXServer' 2>/dev/null || true
sleep 1
pkill -9 -f 'cfx-server/FXServer' 2>/dev/null || true
pkill -9 -u "$USER_NAME" -f 'FXServer|cfx-server' 2>/dev/null || true

# Server-Pfade aus sqlite lesen BEVOR Service/Daten weg sind
SERVER_PATHS=()
if [[ -f "$DATA_DIR/orbit.sqlite" ]] && command -v sqlite3 >/dev/null 2>&1; then
  while IFS= read -r p; do
    [[ -n "$p" && -d "$p" ]] && SERVER_PATHS+=("$p")
  done < <(sqlite3 "$DATA_DIR/orbit.sqlite" "SELECT data_path FROM orbit_servers;" 2>/dev/null || true)
  EXTRA="$(sqlite3 "$DATA_DIR/orbit.sqlite" "SELECT v FROM settings WHERE k='fxDataPath';" 2>/dev/null || true)"
  if [[ -n "$EXTRA" && -d "$EXTRA" ]]; then
    SERVER_PATHS+=("$EXTRA")
  fi
fi

# nginx Orbit-VHosts
shopt -s nullglob
for f in /etc/nginx/sites-enabled/orbit-*.conf /etc/nginx/sites-available/orbit-*.conf; do
  rm -f "$f" && echo "  entfernt: $f" || true
done
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
fi

if [[ "$DELETE_SERVERS" == "1" ]]; then
  for p in "${SERVER_PATHS[@]:-}"; do
    if [[ -d "$p" ]]; then
      echo "  lösche Server: $p"
      rm -rf "$p" || true
    fi
  done
  if [[ -d "$SERVERS" ]]; then
    echo "  lösche $SERVERS"
    rm -rf "$SERVERS" || true
  fi
  # Häufiger Custom-Pfad
  if [[ -d /root/RoleplayServer ]]; then
    echo "  lösche /root/RoleplayServer"
    rm -rf /root/RoleplayServer || true
  fi
fi

if [[ -d "$ARTIFACTS" ]]; then
  echo "  lösche Artifacts $ARTIFACTS"
  rm -rf "$ARTIFACTS" || true
fi

# Dienst stoppen (nach Daten-Lesen; Script läuft außerhalb der CGroup)
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f /etc/systemd/system/"$SERVICE_NAME".service
rm -rf /etc/systemd/system/"$SERVICE_NAME".service.d
systemctl daemon-reload 2>/dev/null || true
# Resthaftende Node-Prozesse
pkill -9 -u "$USER_NAME" -f 'server/index.js' 2>/dev/null || true

rm -f /etc/sudoers.d/orbit

if [[ "$KEEP_CODE" -eq 0 ]]; then
  echo "  lösche Installationsverzeichnis $INSTALL_DIR"
  cd /
  # Robust gegen busy/ACL: mehrfach versuchen
  for _ in 1 2 3; do
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
    [[ ! -e "$INSTALL_DIR" ]] && break
    sleep 1
    # hart: Inhalte leeren
    find "$INSTALL_DIR" -mindepth 1 -delete 2>/dev/null || true
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
  done
  if [[ -e "$INSTALL_DIR" ]]; then
    echo "WARNUNG: $INSTALL_DIR konnte nicht vollständig gelöscht werden."
    ls -la "$INSTALL_DIR" 2>/dev/null || true
    exit 1
  fi
  echo "==> Fertig. Orbit ist entfernt. Neuinstallation:"
  echo "    curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh | sudo bash"
else
  echo "  lösche Panel-Daten $DATA_DIR (Code bleibt)"
  rm -rf "$DATA_DIR" || true
  mkdir -p "$DATA_DIR"
  echo "Orbit wurde deinstalliert. Neu: sudo bash scripts/install-orbit.sh" > "$DATA_DIR/UNINSTALLED"
  chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR" 2>/dev/null || true
  echo "==> Fertig. Code unter $INSTALL_DIR behalten."
fi

echo "==> Uninstall OK ($(date -Is))"

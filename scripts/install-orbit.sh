#!/usr/bin/env bash
# Orbit — alles unter /opt/orbit
#
#   sudo git clone https://github.com/Ky3ls/Orbit.git /opt/orbit
#   cd /opt/orbit && sudo bash scripts/install-orbit.sh
#
# Einzeiler:
#   curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh \
#     | sudo ORBIT_GIT_URL=https://github.com/Ky3ls/Orbit.git bash
set -euo pipefail

INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-$INSTALL_DIR/artifacts}"
SERVERS="${ORBIT_SERVERS_ROOT:-$INSTALL_DIR/servers}"
DATA_DIR="${ORBIT_DATA_DIR:-$INSTALL_DIR/data}"
USER_NAME="${ORBIT_USER:-orbit}"
PANEL_PORT="${ORBIT_PORT:-40220}"
PUBLIC_URL="${ORBIT_PUBLIC_URL:-}"
GIT_URL="${ORBIT_GIT_URL:-https://github.com/Ky3ls/Orbit.git}"
SERVICE_NAME=orbit

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Bitte als root ausführen: sudo bash $0"
    exit 1
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

ensure_pkgs() {
  if have apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git curl ca-certificates unzip xz-utils rsync >/dev/null
    if ! have node || ! have npm; then
      apt-get install -y -qq nodejs npm >/dev/null || true
    fi
  fi
  have git || { echo "git fehlt."; exit 1; }
  have node || { echo "Node.js fehlt (apt install nodejs npm / Node 20+)."; exit 1; }
  have npm || { echo "npm fehlt."; exit 1; }
  have unzip || { echo "unzip fehlt."; exit 1; }
}

resolve_source() {
  if [[ -f ./package.json && -d ./server && -d ./scripts ]]; then
    SRC="$(pwd)"
    echo "==> Quelle: lokales Repo ($SRC)"
    return
  fi
  if [[ -z "$GIT_URL" ]]; then
    echo "ORBIT_GIT_URL fehlt und kein lokales Repo."
    exit 1
  fi
  TMP="$(mktemp -d)"
  echo "==> Clone $GIT_URL"
  git clone --depth 1 "$GIT_URL" "$TMP/repo"
  SRC="$TMP/repo"
  [[ -f "$SRC/package.json" ]] || { echo "package.json nicht im Repo-Root."; exit 1; }
}

need_root
echo "==> Orbit Installer"
ensure_pkgs

id "$USER_NAME" &>/dev/null || useradd -r -m -d "/home/$USER_NAME" -s /bin/bash "$USER_NAME"
mkdir -p "$INSTALL_DIR" "$ARTIFACTS" "$SERVERS" "$DATA_DIR"

resolve_source

echo "==> Dateien → $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if have rsync; then
  rsync -a --delete \
    --exclude node_modules --exclude dist --exclude data \
    --exclude artifacts --exclude servers --exclude .git \
    "$SRC/" "$INSTALL_DIR/"
else
  tar -cf - \
    --exclude=node_modules --exclude=dist --exclude=data \
    --exclude=artifacts --exclude=servers --exclude=.git \
    -C "$SRC" . | tar -xf - -C "$INSTALL_DIR"
fi
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR"

cd "$INSTALL_DIR"
echo "==> npm ci + build"
runuser -u "$USER_NAME" -- npm ci
runuser -u "$USER_NAME" -- npm run build

ENV_LINES="Environment=NODE_ENV=production
Environment=ORBIT_ARTIFACTS_ROOT=$ARTIFACTS
Environment=ORBIT_SERVERS_ROOT=$SERVERS
Environment=ORBIT_PANEL_PORT=$PANEL_PORT
Environment=ORBIT_BIND_HOST=0.0.0.0"
if [[ -n "$PUBLIC_URL" ]]; then
  ENV_LINES="$ENV_LINES
Environment=ORBIT_PUBLIC_URL=$PUBLIC_URL"
fi

# alten tx2-Dienst entfernen falls noch vorhanden
systemctl stop tx2.service 2>/dev/null || true
systemctl disable tx2.service 2>/dev/null || true
rm -f /etc/systemd/system/tx2.service
rm -rf /etc/systemd/system/tx2.service.d

# sudo für Panel-User (Ordner/ACL/Host — kein Vollzugriff)
cat > /etc/sudoers.d/orbit <<SUDOEOF
Defaults:orbit !requiretty
orbit ALL=(root) NOPASSWD: /usr/bin/mkdir, /bin/mkdir
orbit ALL=(root) NOPASSWD: /usr/bin/chown, /bin/chown
orbit ALL=(root) NOPASSWD: /usr/bin/chmod, /bin/chmod
orbit ALL=(root) NOPASSWD: /usr/bin/setfacl
orbit ALL=(root) NOPASSWD: /usr/bin/install
orbit ALL=(root) NOPASSWD: /usr/bin/cp, /bin/cp
orbit ALL=(root) NOPASSWD: /usr/bin/ln, /bin/ln
orbit ALL=(root) NOPASSWD: /usr/bin/systemctl
orbit ALL=(root) NOPASSWD: /usr/sbin/nginx, /usr/bin/nginx
orbit ALL=(root) NOPASSWD: /usr/sbin/a2enmod, /usr/sbin/a2ensite
orbit ALL=(root) NOPASSWD: /usr/bin/apt-get
orbit ALL=(root) NOPASSWD: /usr/bin/mysql, /usr/bin/mariadb
orbit ALL=(root) NOPASSWD: /usr/bin/certbot
orbit ALL=(root) NOPASSWD: /bin/rm, /usr/bin/rm
orbit ALL=(root) NOPASSWD: /usr/bin/pkill, /bin/pkill
orbit ALL=(root) NOPASSWD: /usr/bin/fuser, /bin/fuser
orbit ALL=(root) NOPASSWD: /bin/bash /opt/orbit/scripts/uninstall-orbit.sh, /usr/bin/bash /opt/orbit/scripts/uninstall-orbit.sh
SUDOEOF
chmod 440 /etc/sudoers.d/orbit
visudo -cf /etc/sudoers.d/orbit >/dev/null
chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Orbit Panel
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$INSTALL_DIR
$ENV_LINES
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 1
systemctl is-active "$SERVICE_NAME" >/dev/null && echo "==> Dienst $SERVICE_NAME aktiv" || echo "==> WARNUNG: systemctl status $SERVICE_NAME"

HOST_HINT="${PUBLIC_URL:-http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PANEL_PORT}"
# PIN-Datei vom Dienst abwarten (kein journalctl nötig)
PIN_VAL=""
BANNER_FILE="$DATA_DIR/BOOTSTRAP.txt"
PIN_FILE="$DATA_DIR/BOOTSTRAP_PIN"
for _ in $(seq 1 20); do
  if [[ -f "$PIN_FILE" ]]; then
    PIN_VAL="$(tr -d '[:space:]' < "$PIN_FILE" | head -c 4)"
    break
  fi
  sleep 0.5
done
if [[ -z "$PIN_VAL" ]]; then
  PIN_VAL="$(journalctl -u "$SERVICE_NAME" -n 80 --no-pager 2>/dev/null | grep -oE 'PIN:[[:space:]]*[0-9]{4}' | tail -1 | grep -oE '[0-9]{4}' || true)"
fi

cat <<EOF

========================================
 Orbit installiert
========================================
 Panel:    $HOST_HINT
 Port:     $PANEL_PORT
 Pfad:     $INSTALL_DIR
 Daten:    $DATA_DIR
 FX:       $ARTIFACTS
 Server:   $SERVERS
EOF
if [[ -n "$PIN_VAL" ]]; then
  if [[ -f "$BANNER_FILE" ]]; then
    echo ""
    cat "$BANNER_FILE"
  else
    cat <<EOF

====================================================
  Orbit · Ersteinrichtung
====================================================
  PIN:     $PIN_VAL
  Panel:   $HOST_HINT
  Link:    $HOST_HINT/install?pin=$PIN_VAL
  → Browser öffnen → Cfx.re verknüpfen
====================================================
EOF
  fi
else
  cat <<EOF

 PIN noch nicht bereit — in 2s:
   cat $DATA_DIR/BOOTSTRAP.txt
EOF
fi
cat <<EOF
 Logs:     journalctl -u $SERVICE_NAME -f
========================================
EOF

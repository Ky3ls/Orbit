#!/usr/bin/env bash
# Orbit — Kontrollzentrum für Gameserver, Datenbanken und Websites
# Läuft als systemd-Dienst (root), alles unter /opt/orbit.
#
# Einzeiler (frischer Ubuntu/Debian-Server):
#   curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh | sudo bash
#
# Aus einem Klon:
#   sudo git clone https://github.com/Ky3ls/Orbit.git /opt/orbit && cd /opt/orbit && sudo bash scripts/install-orbit.sh
#
# Optionen (Umgebungsvariablen): ORBIT_PORT (40220), ORBIT_INSTALL_DIR (/opt/orbit), ORBIT_PUBLIC_URL
set -euo pipefail

INSTALL_DIR="${ORBIT_INSTALL_DIR:-/opt/orbit}"
ARTIFACTS="${ORBIT_ARTIFACTS_ROOT:-$INSTALL_DIR/artifacts}"
SERVERS="${ORBIT_SERVERS_ROOT:-$INSTALL_DIR/servers}"
DATA_DIR="${ORBIT_DATA_DIR:-$INSTALL_DIR/data}"
PANEL_PORT="${ORBIT_PORT:-40220}"
# Domain NIEMALS aus alten Drop-Ins übernehmen — nur explizit via ORBIT_PUBLIC_URL,
# sonst immer IP:Port. Domain setzt erst der Setup-Wizard.
PUBLIC_URL_EXPLICIT="${ORBIT_PUBLIC_URL:-}"
GIT_URL="${ORBIT_GIT_URL:-https://github.com/Ky3ls/Orbit.git}"
SERVICE_NAME=orbit

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Bitte als root ausführen: sudo bash $0"
    exit 1
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

if [[ -t 1 ]]; then C_O=$'\e[38;5;208m'; C_G=$'\e[32m'; C_D=$'\e[2m'; C_B=$'\e[1m'; C_0=$'\e[0m'; else C_O=; C_G=; C_D=; C_B=; C_0=; fi
STEP=0
step() { STEP=$((STEP + 1)); echo; echo "${C_O}[$STEP/5]${C_0} ${C_B}$*${C_0}"; }
ok() { echo "  ${C_G}✓${C_0} $*"; }

# node:sqlite braucht Node 22.5 oder neuer
node_ok() {
  have node || return 1
  local v major rest minor
  v="$(node -p 'process.versions.node' 2>/dev/null || echo 0.0)"
  major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
  (( major > 22 || (major == 22 && minor >= 5) ))
}

ensure_pkgs() {
  if have apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git curl ca-certificates unzip xz-utils rsync zstd openssl iproute2 gnupg >/dev/null
    ok "Grundpakete (git, curl, zstd, …)"
    if ! node_ok; then
      echo "  ${C_D}Node.js 22 wird über NodeSource installiert …${C_0}"
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
      apt-get install -y -qq nodejs >/dev/null
    fi
  elif have dnf; then
    dnf install -y -q git curl ca-certificates unzip xz rsync zstd openssl iproute >/dev/null
    if ! node_ok; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
      dnf install -y -q nodejs >/dev/null
    fi
  fi
  have git || { echo "git fehlt."; exit 1; }
  node_ok || { echo "Node.js 22.5+ fehlt (gefunden: $(node -v 2>/dev/null || echo keins))."; exit 1; }
  have npm || { echo "npm fehlt."; exit 1; }
  have unzip || { echo "unzip fehlt."; exit 1; }
  ok "Node.js $(node -v)"
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
echo
echo "${C_O}   ●  Orbit${C_0}"
echo "   Kontrollzentrum für Gameserver, Datenbanken und Websites"
step "Pakete prüfen"
ensure_pkgs
mkdir -p "$INSTALL_DIR" "$ARTIFACTS" "$SERVERS" "$DATA_DIR"

step "Orbit herunterladen"
resolve_source

# Laufender Dienst hält oft Dateien in node_modules → TAR_ENTRY_ERROR / ENOTEMPTY
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

echo "  Dateien → $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# WICHTIG: Niemals rsync --delete auf den ganzen INSTALL_DIR-Tree.
# Persistenz (data/artifacts/servers/alpine) bleibt unberührt.
# --delete nur innerhalb einzelner Code-Unterordner.
copy_tree() {
  local name="$1"
  [[ -d "$SRC/$name" ]] || return 0
  mkdir -p "$INSTALL_DIR/$name"
  if have rsync; then
    rsync -a --delete "$SRC/$name/" "$INSTALL_DIR/$name/"
  else
    find "$INSTALL_DIR/$name" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$SRC/$name/." "$INSTALL_DIR/$name/"
  fi
}
copy_tree server
copy_tree src
copy_tree scripts
copy_tree docs
copy_tree public
copy_tree resources
for f in package.json package-lock.json index.html vite.config.js README.md .gitignore; do
  [[ -f "$SRC/$f" ]] && cp -a "$SRC/$f" "$INSTALL_DIR/$f"
done

cd "$INSTALL_DIR"
step "Abhängigkeiten installieren und bauen (1–2 Minuten)"
# Kaputte/teilweise node_modules von fehlgeschlagenen Installs weg
rm -rf "$INSTALL_DIR/node_modules"
export HOME="${HOME:-/root}"
export npm_config_cache="${ORBIT_NPM_CACHE:-$INSTALL_DIR/.npm-cache}"
export npm_config_update_notifier=false
mkdir -p "$npm_config_cache"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
ok "Oberfläche gebaut"

DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
DEFAULT_IP="${DEFAULT_IP:-127.0.0.1}"
if [[ -n "$PUBLIC_URL_EXPLICIT" ]]; then
  PUBLIC_URL="$PUBLIC_URL_EXPLICIT"
else
  PUBLIC_URL="http://${DEFAULT_IP}:${PANEL_PORT}"
fi

ENV_LINES="Environment=NODE_ENV=production
Environment=HOME=/root
Environment=ORBIT_ARTIFACTS_ROOT=$ARTIFACTS
Environment=ORBIT_SERVERS_ROOT=$SERVERS
Environment=ORBIT_PANEL_PORT=$PANEL_PORT
Environment=ORBIT_BIND_HOST=0.0.0.0
Environment=ORBIT_PUBLIC_URL=$PUBLIC_URL"

# alten tx2-Dienst entfernen falls noch vorhanden
systemctl stop tx2.service 2>/dev/null || true
systemctl disable tx2.service 2>/dev/null || true
rm -f /etc/systemd/system/tx2.service
rm -rf /etc/systemd/system/tx2.service.d

# Alte Orbit-Drop-Ins (Domain/Env) verwerfen — sonst bleibt z. B. Domain hängen
rm -rf /etc/systemd/system/${SERVICE_NAME}.service.d

# Kein eigener User mehr — Sudoers-Rest von Altinstallationen entfernen
rm -f /etc/sudoers.d/orbit

chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true

# Wie txAdmin: systemd ohne User= → root
# KillMode=process: Panel-Restart tötet FXServer-Kinder NICHT (sonst Ghost-Timeouts)
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Orbit Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
$ENV_LINES
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=3
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "/etc/systemd/system/${SERVICE_NAME}.service.d"
cat > "/etc/systemd/system/${SERVICE_NAME}.service.d/fx-survive.conf" <<'EOF'
[Service]
# FX läuft als Kind von Orbit — bei Panel-Restart nicht mitkillen
KillMode=process
EOF

step "Dienst einrichten"
# Firewall: Panel-Port freigeben, wenn ufw aktiv ist
if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PANEL_PORT/tcp" >/dev/null && ok "Firewall: Port $PANEL_PORT freigegeben (ufw)"
fi
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 1
systemctl is-active "$SERVICE_NAME" >/dev/null && echo "==> Dienst $SERVICE_NAME aktiv (root)" || echo "==> WARNUNG: systemctl status $SERVICE_NAME"

HOST_HINT="${PUBLIC_URL:-http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PANEL_PORT}"
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
 Orbit ist installiert
========================================
 Panel:    $HOST_HINT
 Pfad:     $INSTALL_DIR
 Daten:    $DATA_DIR
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
  Link:    $HOST_HINT/install?pin=$PIN_VAL
  → Link öffnen → Inhaberkonto anlegen → Einrichtung startet
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

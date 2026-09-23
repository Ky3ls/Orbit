#!/usr/bin/env bash
# Orbit-Cutover: FXServer von systemd/txAdmin → Orbit-Supervisor
# Nur als root auf dem Host ausführen.
set -euo pipefail

TX2_USER=tx2
FX_ROOT=/root/RoleplayServer
FX_DATA=/root/RoleplayServer/txData/Roleplay
DB=/opt/tx2/data/tx2.sqlite
UNIT=fivem-txadmin.service
PANEL=http://127.0.0.1:40220

echo "==> ACL für ${TX2_USER} auf Datenpfad"
setfacl -R -m "u:${TX2_USER}:rwx" "${FX_DATA}"
setfacl -R -d -m "u:${TX2_USER}:rwx" "${FX_DATA}"
setfacl -m "u:${TX2_USER}:rx" "${FX_ROOT}"
setfacl -R -m "u:${TX2_USER}:rx" "${FX_ROOT}/alpine"

echo "==> Orbit-Einstellungen (SQLite)"
sqlite3 "$DB" <<SQL
INSERT INTO settings (k, v) VALUES ('fxControlMode', 'orbit') ON CONFLICT(k) DO UPDATE SET v = 'orbit';
INSERT INTO settings (k, v) VALUES ('fxServerRoot', '${FX_ROOT}') ON CONFLICT(k) DO UPDATE SET v = '${FX_ROOT}';
INSERT INTO settings (k, v) VALUES ('fxDataPath', '${FX_DATA}') ON CONFLICT(k) DO UPDATE SET v = '${FX_DATA}';
INSERT INTO settings (k, v) VALUES ('controlEnabled', '1') ON CONFLICT(k) DO UPDATE SET v = '1';
SQL

echo "==> ${UNIT} stoppen & deaktivieren"
systemctl stop "$UNIT" || true
systemctl disable "$UNIT" || true

echo "==> tx2 neu starten"
systemctl restart tx2.service
sleep 2

if [[ ! -f /root/.tx2-admin ]]; then
  echo "WARN: /root/.tx2-admin fehlt — Server im Panel manuell starten (Power → Start)."
  exit 0
fi

ORBIT_USER=$(grep -i '^Benutzer:' /root/.tx2-admin | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')
ORBIT_PASS=$(grep -i '^Passwort:' /root/.tx2-admin | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "==> Panel-Login & FXServer starten"
HDR_ORIGIN='Origin: https://tx2.ky3ls.space'
HDR_CLIENT='x-tx2-client: 1'
LOGIN=$(curl -sf -c "$COOKIE_JAR" -X POST "${PANEL}/api/auth/login" \
  -H 'Content-Type: application/json' -H "$HDR_ORIGIN" -H "$HDR_CLIENT" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$ORBIT_USER" "$ORBIT_PASS")") || {
  echo "Login fehlgeschlagen — bitte im Panel Power → Start."
  exit 1
}

if echo "$LOGIN" | grep -q totpRequired; then
  echo "2FA aktiv — bitte im Panel Power → Start."
  exit 0
fi

curl -sf -b "$COOKIE_JAR" -X POST "${PANEL}/api/server/control" \
  -H 'Content-Type: application/json' -H "$HDR_ORIGIN" -H "$HDR_CLIENT" \
  -d '{"action":"start"}' && echo "==> Start angefordert."

sleep 8
if curl -sf "${FX_ROOT}" >/dev/null 2>&1; then true; fi
if curl -sf "http://127.0.0.1:30120/info.json" | head -c 80; then
  echo ""
  echo "==> FiveM-Endpunkt antwortet."
else
  echo "WARN: info.json noch nicht erreichbar — Logs im Panel prüfen."
fi

echo "==> Cutover abgeschlossen. txAdmin-Dienst ist disabled."

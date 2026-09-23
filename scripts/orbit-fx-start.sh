#!/usr/bin/env bash
# FXServer über laufendes Orbit-Panel starten (nach Cutover)
set -euo pipefail
PANEL=http://127.0.0.1:40220
HDR=( -H 'Origin: https://tx2.ky3ls.space' -H 'x-tx2-client: 1' -H 'Content-Type: application/json' )
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT
U=$(grep -i '^Benutzer:' /root/.tx2-admin | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')
P=$(grep -i '^Passwort:' /root/.tx2-admin | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')
BODY=$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$U" "$P")
curl -sf -c "$COOKIE_JAR" -X POST "${PANEL}/api/auth/login" "${HDR[@]}" -d "$BODY"
curl -sf -b "$COOKIE_JAR" -X POST "${PANEL}/api/server/control" "${HDR[@]}" -d '{"action":"start"}'
echo OK

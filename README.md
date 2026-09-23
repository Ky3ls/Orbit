# Orbit

Web-Panel **und** FiveM/FXServer in einem. Auf einem frischen Linux-Server reicht die Installation — danach im Browser einen Server anlegen. FX wird automatisch nach `/opt/orbit/artifacts` geladen, Server-Daten liegen unter `/opt/orbit/servers`.

## Voraussetzungen

- Linux (root/sudo)
- Git, Node.js 20+, npm, unzip, xz-utils
- Internet (FX-Artifact-Download beim Setup)

## Installation

```bash
sudo git clone https://github.com/Ky3ls/Orbit.git /opt/orbit
cd /opt/orbit
sudo bash scripts/install-orbit.sh
```

Einzeiler:

```bash
curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh \
  | sudo ORBIT_GIT_URL=https://github.com/Ky3ls/Orbit.git bash
```

Danach alles unter einem Pfad:

```
/opt/orbit/              Panel + Code
/opt/orbit/data/         Panel-DB
/opt/orbit/artifacts/    FXServer-Builds (wird beim Setup geladen)
/opt/orbit/servers/      deine FiveM-Server (cfg, resources, …)
```

Dienst: `orbit` · Port: **40220** · User: `orbit`

## Ersteinrichtung (frischer Server)

1. Dienst starten → **PIN** erscheint im Terminal / `journalctl -u orbit`
2. Browser: `http://DEINE-IP:40220` → PIN eingeben → **Konto verknüpfen** (Cfx.re)
3. Backup-Passwort setzen → **Master-Account erstellen** (danach bist du eingeloggt)
4. Setup-Wizard: Name → Deploy-Typ → Template → Netzwerk → DB → License
5. Orbit lädt FX und legt den Server unter `/opt/orbit/servers/…` an

Keine Marketing-Landing — Einstieg ist PIN → Cfx → Master → Setup.

**Ingame:** `/orbit` oder `/tx` — Heal, Announce, Spielerliste, Kick.

Weitere Server später: **Einstellungen → Instanzen**.

## Update

```bash
cd /opt/orbit
sudo -u orbit git pull
sudo -u orbit npm ci
sudo -u orbit npm run build
sudo systemctl restart orbit
```

## Nützliche Befehle

```bash
systemctl status orbit
journalctl -u orbit -f
```

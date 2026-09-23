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

1. Browser: `http://DEINE-SERVER-IP:40220`
2. Master-Account anlegen
3. Setup-Wizard: Name, Port, optional Framework, MySQL, License
4. Orbit lädt das empfohlene FX-Artifact und legt den Server unter `/opt/orbit/servers/…` an
5. Start — fertig

Kein separates `FXServer`-Download, kein `run.sh` von Hand, kein fremder Datenordner nötig.

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

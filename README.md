# Orbit

Web-Panel für FiveM/FXServer: Start/Stop, Live-Konsole, Ressourcen, Multi-Server und schlankes Ingame-Menü.
Alles unter **`/opt/orbit`** — Panel, Daten, FX-Builds und Server-Instanzen.

## Voraussetzungen

- Linux (root/sudo)
- Git, Node.js 20+, npm, unzip, xz-utils

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

Struktur nach dem Install:

```
/opt/orbit/           Panel (dieses Repo)
/opt/orbit/data/      Panel-Datenbank
/opt/orbit/artifacts/ FXServer-Builds
/opt/orbit/servers/   Server-Datenordner
```

Dienst: `orbit` · Port: **40220** · System-User: `orbit`

Optional mit öffentlicher URL:

```bash
sudo ORBIT_PUBLIC_URL=https://panel.example.com bash scripts/install-orbit.sh
```

## Ersteinrichtung

1. Browser: `http://DEINE-SERVER-IP:40220`
2. Setup-Wizard: Master-Account → Zugang → optional Framework → Port → Datenbank → License → Start
3. Cockpit: Konsole, Start/Stop, Ressourcen

Später: **Einstellungen** → Instanzen, FX Builds, Prod (License / MySQL).

**Ingame:** `/orbit` oder `/tx` — Heal, Announce, Spielerliste, Kick.

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

FX Start/Stop nur über das Panel.

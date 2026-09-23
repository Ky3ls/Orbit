# Orbit

Web-Panel für FiveM/FXServer: Start/Stop, Live-Konsole, Ressourcen, Multi-Server und schlankes Ingame-Menü.
FX läuft über Orbit — kein separates Monitor-Panel nötig.

## Voraussetzungen

- Linux (root/sudo)
- Git, Node.js 20+, npm, unzip, xz-utils

## Installation

```bash
sudo git clone https://github.com/Ky3ls/orbit.git /opt/tx2
cd /opt/tx2
sudo bash scripts/install-orbit.sh
```

Einzeiler:

```bash
curl -fsSL https://raw.githubusercontent.com/Ky3ls/orbit/main/scripts/install-orbit.sh \
  | sudo ORBIT_GIT_URL=https://github.com/Ky3ls/orbit.git bash
```

Das Skript installiert das Panel unter `/opt/tx2`, legt die Datenpfade unter `/opt/orbit` an und startet den Dienst `tx2` (Port **40220**).

Optional mit öffentlicher URL:

```bash
sudo ORBIT_GIT_URL=https://github.com/Ky3ls/orbit.git \
     ORBIT_PUBLIC_URL=https://panel.example.com \
     bash scripts/install-orbit.sh
```

## Ersteinrichtung

1. Im Browser öffnen: `http://DEINE-SERVER-IP:40220`
2. Setup-Wizard durchlaufen:
   - Master-Account anlegen
   - Panel-Zugang prüfen
   - Optional Framework-Profil (Minimal / ESX / QB)
   - Servername, Port, Spielerlimit
   - Datenbank (MySQL) verbinden oder anlegen
   - Cfx-License-Key eintragen
   - Server starten
3. Danach im Cockpit: Konsole, Start/Stop, Ressourcen

Später ändern: **Einstellungen** → Instanzen (weitere Server), FX Builds, Prod (License / MySQL).

**Ingame:** `/orbit` oder `/tx` — Heal, Announce, Spielerliste, Kick.

## Update

```bash
cd /opt/tx2
sudo -u tx2 git pull
sudo -u tx2 npm ci
sudo -u tx2 npm run build
sudo systemctl restart tx2
```

## Nützliche Befehle

```bash
systemctl status tx2
journalctl -u tx2 -f
```

FX Start/Stop nur über das Panel — nicht manuell per `run.sh`.

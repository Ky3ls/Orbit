# Orbit

Web-Panel für FiveM/FXServer — Start/Stop, Konsole, Ingame-Menü, Multi-Server.
**Kein txAdmin nötig.** FX wird vom Panel gesteuert.

## Voraussetzungen (Linux)

- Root bzw. sudo
- Git, Node.js 20+, npm, unzip, xz-utils
- Offene Ports: **Panel** (Standard `40220`) + **FX** (Standard `30120` TCP+UDP)

## 1) Auf GitHub hochladen (einmalig, dein Rechner oder dieser Host)

```bash
cd /opt/tx2   # oder dein Orbit-Ordner
git init
git add .
git commit -m "Orbit Panel"
# Repo auf github.com anlegen (leer, ohne README), dann:
git branch -M main
git remote add origin https://github.com/DEIN_USER/orbit.git
git push -u origin main
```

Mit GitHub CLI:

```bash
cd /opt/tx2
git init && git add . && git commit -m "Orbit Panel"
gh repo create orbit --private --source=. --remote=origin --push
```

Nicht committen: `data/`, `node_modules/`, `dist/` (stehen in `.gitignore`).

## 2) Auf dem Server installieren (wie FX — aber ein Befehl)

**Variante A — Einzeiler** (nach dem Push, `DEIN_USER` ersetzen):

```bash
curl -fsSL https://raw.githubusercontent.com/DEIN_USER/orbit/main/scripts/install-orbit.sh \
  | sudo ORBIT_GIT_URL=https://github.com/DEIN_USER/orbit.git bash
```

Optional Domain:

```bash
sudo ORBIT_GIT_URL=https://github.com/DEIN_USER/orbit.git \
     ORBIT_PUBLIC_URL=https://panel.example.com \
     bash -c 'curl -fsSL https://raw.githubusercontent.com/DEIN_USER/orbit/main/scripts/install-orbit.sh | bash'
```

**Variante B — git clone** (klarer, empfohlen):

```bash
sudo git clone https://github.com/DEIN_USER/orbit.git /opt/tx2
cd /opt/tx2
sudo bash scripts/install-orbit.sh
```

Das Skript legt User `tx2`, Ordner unter `/opt/orbit`, baut das Panel und startet `systemd` (`tx2.service`).

Vergleich zu klassischem FX/txAdmin:

| Klassisch (Cfx)                         | Orbit                                      |
|-----------------------------------------|--------------------------------------------|
| `wget` FX-Build + `tar xf`              | Panel lädt FX-Builds im Setup / Einstellungen |
| `git clone cfx-server-data`             | Datenordner unter `/opt/orbit/servers/…`   |
| `server.cfg` + `run.sh` von Hand        | Setup-Wizard im Browser                    |
| txAdmin startet mit FX                  | Panel steuert FX (`fxControlMode=orbit`)   |

## 3) Erstes Setup (Browser)

1. Öffne `http://DEINE-IP:40220` (oder deine Domain hinter Reverse-Proxy).
2. **Setup-Wizard:** Master-Account → Panel-Zugang → Framework (Minimal/ESX/QB optional) → Port → **Datenbank** → License-Key → Start.
3. Danach: Cockpit = Live-Konsole, Start/Stop, Ressourcen. Ingame: `/orbit` oder `/tx` (Kick/Announce/Heal/Liste).

Server + MySQL später ändern: **Einstellungen** → Instanzen / Prod (License, MySQL in `server.cfg`).

## 4) Firewall (wichtig)

- Panel: TCP `40220` (oder nur localhost + Nginx/Caddy)
- Spiel: TCP **und** UDP `30120` (bzw. dein FX-Port)

## 5) Update später

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
# FX läuft als Kindprozess von Orbit — Start/Stop im Panel, nicht manuell run.sh
```

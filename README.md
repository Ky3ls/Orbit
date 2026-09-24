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
2. Browser: `http://DEINE-IP:40220` → PIN → **Cfx.re verknüpfen**
3. Backup-Passwort → Master-Account (danach eingeloggt)
4. Setup-Wizard inkl. **Panel-Zugang** (IP:Port **oder Domain**)
5. Bei Domain: nach Abschluss automatische Weiterleitung auf die neue URL

Der Installer legt `/etc/sudoers.d/orbit` an (mkdir/chown/setfacl u. a.), damit Datenordner
unter `/root/…` und `/home/…` nutzbar sind. Gesperrt bleiben `/root/Rechnungen` und `/root/Telegram`.


**Ingame:** `/orbit` oder `/orbitmenu` — NoClip, God, Teleport, Heal, Announce, Spieler-Aktionen, Fahrzeug-Tools.

Weitere Server später: **Einstellungen → Instanzen**.

## Update

**Sicher (empfohlen):** nur Code syncen — `data/`, `artifacts/`, `servers/`, `alpine/` bleiben.

```bash
# Von einer Repo-Kopie (z. B. nach git pull + npm run build):
sudo bash scripts/safe-sync-live.sh /pfad/zum/repo
sudo systemctl restart orbit
```

Oder gebündelt:

```bash
sudo bash scripts/deploy-live.sh
```

**Nicht** `rsync --delete` auf ganz `/opt/orbit` ausführen — das löscht Panel-DB und FX-Daten.

Alternativ im Installationsordner (wenn dort ein Git-Checkout liegt):

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

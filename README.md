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

Dienst: `orbit` · Port: **40220** · läuft als **root** (wie txAdmin, kein eigener Systemuser)

## Ersteinrichtung (frischer Server)

1. Dienst starten → **PIN** erscheint im Terminal / `journalctl -u orbit`
2. Browser: `http://DEINE-IP:40220` → PIN → **Cfx.re verknüpfen**
3. Backup-Passwort → Master-Account (danach eingeloggt)
4. Setup-Wizard inkl. **Panel-Zugang** (IP:Port **oder Domain**)
5. Bei Domain: nach Abschluss automatische Weiterleitung auf die neue URL

Gesperrt bleiben `/root/Rechnungen` und `/root/Telegram` (Pfad-Policy im Panel).


## Oberfläche

- **Dashboard** — Server-Hero mit Power-Steuerung, Restart-Countdown, Live-KPIs (Spieler, CPU, RAM, FX) mit Verlauf, Live-Konsole, Online-Liste, Aktivitäts-Feed, Ressourcen- und Community-Übersicht
- **Befehlspalette** — `Strg/⌘ + K` oder `/`: Seiten öffnen, Spieler suchen, Server starten/stoppen/neu starten, Theme und Akzentfarbe wechseln
- **Tastenkürzel** — `?` zeigt alle; `G` + Taste springt zu Seiten (z. B. `G P` Spieler, `G R` Ressourcen), `[` klappt die Sidebar ein, `Shift + T` wechselt Hell/Dunkel
- **Ressourcen** — Status-Filter, Verfügbarkeits-Anzeige, Ordner-Karten, Aktionen mit Rückmeldung
- **Audit-Log** — Timeline nach Tagen, Kategorie-/Benutzer-Filter, CSV-Export
- **Server-Log** — Level-Filter mit Zählern, Pause, Download als `.log`
- **Darstellung** — Schwarz oder Hell, kompakte Sidebar, Akzentfarbe frei wählbar (10 Farben)

## Multi-Game: Minecraft

Unter **Instanzen** laufen Minecraft-Server parallel zu FiveM — der Umschalter oben in der Sidebar wechselt zwischen allen Instanzen.

- **Typen:** Vanilla, Paper, Purpur (Plugins), Fabric, Forge, NeoForge (Mods) — jede Version, inkl. Loader-Auswahl
- **Java automatisch:** benötigte Version laut Mojang; fehlende Versionen lädt Orbit als Eclipse Temurin nach `/opt/orbit/runtimes`
- **RAM-Empfehlung:** aus Typ, Mod-/Plugin-Anzahl, Slots, Sichtweite und freiem Host-Speicher; Start mit Aikar-G1GC-Flags
- **Mods & Plugins:** Modrinth-Suche passend zu Loader + Version, Abhängigkeiten werden mitinstalliert, Updates per Hash-Abgleich, eigene `.jar` hochladen
- **server.properties:** gruppiertes Formular oder alle Schlüssel
- **Sicher:** Server laufen als Systembenutzer `orbit-mc` (nicht root) und überstehen einen Panel-Neustart
- Daten: `/opt/orbit/servers/minecraft/<instanz>/`

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
sudo git pull
sudo npm ci
sudo npm run build
sudo systemctl restart orbit
```

## Nützliche Befehle

```bash
systemctl status orbit
journalctl -u orbit -f
```

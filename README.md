# Orbit

**Kontrollzentrum für deinen Server** — Gameserver (Minecraft, FiveM), Datenbanken (MySQL/MariaDB, PostgreSQL, Redis), Websites und Domains (nginx, Apache, Caddy) in einem Panel. Ein Befehl installiert alles, den Rest erledigt ein Assistent im Browser.

## Installation

Auf einem frischen Ubuntu/Debian-Server (als root):

```bash
curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh | sudo bash
```

Der Installer holt Node.js 22, baut Orbit, richtet den Dienst `orbit` ein (Port **40220**, Firewall wird bei aktivem ufw freigegeben) und zeigt am Ende einen Link mit PIN.

Aus einem Klon geht es genauso:

```bash
sudo git clone https://github.com/Ky3ls/Orbit.git /opt/orbit
cd /opt/orbit && sudo bash scripts/install-orbit.sh
```

Optionen: `ORBIT_PORT`, `ORBIT_INSTALL_DIR`, `ORBIT_PUBLIC_URL` als Umgebungsvariablen.

```
/opt/orbit/              Panel + Code
/opt/orbit/data/         Panel-DB, Backups
/opt/orbit/servers/      Gameserver (Minecraft, FiveM)
/opt/orbit/artifacts/    FXServer-Builds
```

## Ersteinrichtung

1. Link aus der Installer-Ausgabe öffnen (`http://DEINE-IP:40220/install?pin=…`) — PIN steht auch in `journalctl -u orbit`
2. **Inhaberkonto** anlegen: Benutzername + Passwort (oder mit Cfx.re-Konto)
3. **Einrichtungs-Assistent**:
   - Server-Check (System, RAM, Speicher, IP, vorhandene Dienste)
   - **Datenbanken** auswählen und installieren (MariaDB/MySQL, PostgreSQL, Redis)
   - **Webserver** wählen (nginx, Apache, Caddy) und optional eine **Domain fürs Panel**
   - **Ersten Server** anlegen: Minecraft, FiveM oder einen bestehenden importieren
4. Danach nur noch die angezeigten DNS-Einträge bei Cloudflare anlegen

## Host-Verwaltung

- **Datenbanken** — Server installieren, Datenbanken mit eigenem Benutzer anlegen, Passwort zurücksetzen, SQL-Export, externer Zugriff. Zugangsdaten fertig formatiert für FiveM (oxmysql), Minecraft-Plugins (JDBC) und Laravel/.env. Bestehende Datenbanken werden angezeigt, aber nie verändert.
- **Domains & Web** — Reverse-Proxy (Apps, Panel), statische Website, PHP-Website, Weiterleitung oder **Gameserver-Adresse** (inkl. SRV-Record, damit Spieler keinen Port eintippen). HTTPS per Let's Encrypt, vorhandenem Zertifikat oder Cloudflare. DNS-Prüfung erkennt Cloudflare-Proxy. Orbit schreibt nur eigene `orbit-site-*`-Dateien, testet jede Änderung (`nginx -t` usw.) und rollt bei Fehlern zurück.
- **Dienste** — Status, RAM, Laufzeit und Logs von Webserver, Datenbanken und PHP-FPM; Start, Stopp, Neustart, Reload.

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

Minecraft-Server laufen parallel zu FiveM und allen anderen Diensten — jeder Server steht in der Sidebar unter **Server** mit eigenen Seiten.

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

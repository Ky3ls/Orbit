<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img src="docs/assets/banner-light.svg" alt="Orbit" width="620">
  </picture>
</p>

<p align="center">
  Ein Kontrollzentrum für deinen Server — Minecraft, FiveM, Datenbanken und Websites<br>
  in einem schlichten Web-Panel. Ein Befehl installiert alles, den Rest erledigt ein Assistent.
</p>

<p align="center">
  <a href="https://github.com/Ky3ls/Orbit/releases"><img src="https://img.shields.io/github/v/release/Ky3ls/Orbit?include_prereleases&label=version&color=ff7a1a&style=flat-square" alt="Version"></a>
  <img src="https://img.shields.io/badge/Node.js-22+-3c873a?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/Ubuntu%20%2F%20Debian-supported-e95420?style=flat-square&logo=ubuntu&logoColor=white" alt="Ubuntu / Debian">
  <a href="https://discord.com/users/439408306080186368"><img src="https://img.shields.io/badge/Discord-Ky3ls-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
</p>

---

## Installation

Auf einem frischen Ubuntu- oder Debian-Server, als root:

```bash
curl -fsSL https://raw.githubusercontent.com/Ky3ls/Orbit/main/scripts/install-orbit.sh | sudo bash
```

Danach den Link aus der Ausgabe öffnen (`http://DEINE-IP:40220`) und das Inhaberkonto anlegen. Ein Assistent fragt nach Datenbanken, Webserver, Domain und dem ersten Gameserver.

## Was Orbit kann

|  |  |
|---|---|
| **Gameserver** | Minecraft (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge) und FiveM. Konsole, Dateien, Mods & Plugins über Modrinth, Backups mit Zeitplan, Java wird automatisch geholt. |
| **Datenbanken** | MySQL/MariaDB, PostgreSQL und Redis per Klick. Eingebautes Datenbank-Studio: Tabellen bearbeiten, Struktur, SQL-Editor, ER-Diagramm. |
| **Domains & Web** | nginx, Apache oder Caddy. Reverse-Proxy, statische oder PHP-Seiten, Weiterleitungen und Gameserver-Adressen — HTTPS per Let's Encrypt oder Cloudflare. |
| **Live-Übersicht** | CPU, RAM, Netzwerk und Datenträger in Echtzeit — und welcher Server oder Prozess am meisten zieht, direkt beendbar. |
| **Team** | Rollen und feine Rechte pro Mitglied und pro Server, Audit-Log für jede Aktion, Anmeldung per Passwort oder Cfx.re. |

Orbit fasst nur an, was es selbst angelegt hat: fremde Webseiten-Konfigurationen und Datenbanken bleiben unverändert, jede Webserver-Änderung wird getestet und bei Fehlern zurückgerollt.

## Update

```bash
cd /opt/orbit && sudo git pull && sudo npm ci && sudo npm run build && sudo systemctl restart orbit
```

Panel-Datenbank, Gameserver und Backups liegen in `data/` und `servers/` und bleiben dabei erhalten. Laufende Gameserver überstehen den Neustart des Panels.

## Hilfe

```bash
systemctl status orbit      # läuft Orbit?
journalctl -u orbit -f      # Live-Log
```

Fragen, Ideen oder Fehler: ein [Issue](https://github.com/Ky3ls/Orbit/issues) öffnen oder auf [Discord](https://discord.com/users/439408306080186368) schreiben.

<sub>Orbit ist in der Beta — Feedback ist willkommen.</sub>

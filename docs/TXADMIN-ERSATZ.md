# Orbit vs. txAdmin

## Implementiert

- **txAdmin-Migration**: Erkennung (txData, systemd, **laufende FX/txAdmin-Prozesse**), Server-Profile, CFG, **Bans/Warns/Allowlist** aus `playersDB.json`, Deaktivierung txAdmin — Setup oder **Einstellungen → Host → txAdmin**
- FX Artifacts, Multi-Server **parallel**, Monitoring **pro Instanz**, Konsole **Zielinstanz**
- Recipes: Profile + YAML (`replace_string`, `connect_database`, `move_path`, …)
- Drops: Konsole + **`.orbit/fx-console.log`** pro Server
- Ingame: NUI mit **Spielerliste + Kick**
- Prod: **Einstellungen → Host & Instanzen → Prod**, `scripts/prod-bootstrap.sh`
- Discord Webhook + Bot, Docker, `install-orbit.sh`

## Grenzen

- Kein vollständiger txAdmin-YAML-Katalog
- Ingame: kein NoClip/Spectate
- Linux proot-Artifacts only

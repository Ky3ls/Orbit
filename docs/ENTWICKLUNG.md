# Orbit Panel — Design & Entwicklung am PC

## Wo liegt das Design?

**Nur hier bearbeiten** (Git-Repository, Ordner `tx2/`):

| Was | Pfad |
|-----|------|
| Panel-Rahmen (Header, Top-Navigation) | `src/workspace/Workspace.jsx`, `src/workspace/workspace.css`, `src/workspace/nav.js` |
| CSS-Einstieg (welche Styles geladen werden) | `src/main.jsx` |
| Routen | `src/App.jsx` |
| Globales Theme | `src/styles.css`, `src/theme/tokens.css`, `src/theme/panel.css` |
| Cockpit / Übersicht | `src/cockpit/` |
| Einzelseiten | `src/pages/*.jsx` (+ `setup-wizard.css`, `settings.css`, …) |
| Modulliste | `src/layout/modules.js` |

Die Website **lädt nicht** `src/` direkt. Node serviert den **Build** unter `dist/` (gebündeltes JS/CSS).

## Am PC starten

```bash
cd tx2
npm ci
npm run dev
```

Änderungen in `src/` → im Browser sichtbar (Hot Reload).

## Live (tx2.ky3ls.space)

```bash
cd tx2
bash scripts/deploy-live.sh
```

Deploy kopiert nach `/opt/tx2`: **`dist`**, **`server`**, **`src`** (Referenz), `scripts`, `resources`, …

**Nicht** am Server in alten Kopien unter `/opt/tx2/src` arbeiten ohne vorher `git pull` + Deploy — der Stand muss mit **Git `main`** übereinstimmen.

## Branch

Aktuelles Live-Design entspricht **`main`** im Repo `Umschulung-TF`, Unterordner `tx2/`.

Feature-Branches (z. B. Home-Bar) nur mergen, wenn du sie bewusst live willst.

import { settingMap } from './db.js';
import { buildSettingsForServer, getOrbitServerById } from './orbitServersDb.js';

/** Settings für Konsole/Queue — Ziel-Instanz oder aktiver Server. */
export function resolveConsoleSettings(db) {
  const global = settingMap(db);
  const target = global.consoleTargetServerId;
  if (!target) return global;
  const row = getOrbitServerById(db, target);
  if (!row) return global;
  return buildSettingsForServer(db, row);
}

import { controlFx } from './control.js';
import { dispatchFxCommand } from './fxCommand.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, string>} settings
 * @param {(level: string, text: string) => void} logLine
 */
export async function drainCommandQueue(db, settings, logLine) {
  const row = db.prepare(`
    SELECT id, kind, payload, author FROM queue
    WHERE status = 'queued'
    ORDER BY id ASC
    LIMIT 1
  `).get();
  if (!row) return { processed: 0 };

  const claim = db.prepare("UPDATE queue SET status = 'processing' WHERE id = ? AND status = 'queued'").run(row.id);
  if (!claim.changes) return { processed: 0 };

  const payload = JSON.parse(row.payload || '{}');
  try {
    const out = await executeQueueItem(settings, row.kind, payload, logLine);
    db.prepare("UPDATE queue SET status = 'done' WHERE id = ?").run(row.id);
    if (!(row.author === 'system' && row.kind === 'console')) {
      logLine('ok', `FX ✓ ${row.kind} (${row.author})${out ? `: ${String(out).slice(0, 120)}` : ''}`);
    }
    return { processed: 1, ok: true };
  } catch (err) {
    db.prepare("UPDATE queue SET status = 'failed' WHERE id = ?").run(row.id);
    logLine('bad', `FX ✗ ${row.kind}: ${err.message}`);
    return { processed: 1, ok: false };
  }
}

async function executeQueueItem(settings, kind, payload, logLine) {
  if (kind === 'console') {
    const command = String(payload.command || '').trim();
    if (!command) throw new Error('Leerer Konsolenbefehl.');
    return dispatchFxCommand(settings, command);
  }

  if (kind.startsWith('resource.')) {
    const action = kind.slice('resource.'.length);
    const name = payload.name;
    if (!name) throw new Error('Ressourcenname fehlt.');
    if (action === 'start') return dispatchFxCommand(settings, `ensure ${name}`);
    if (action === 'restart') return dispatchFxCommand(settings, `restart ${name}`);
    if (action === 'stop') return dispatchFxCommand(settings, `stop ${name}`);
    throw new Error('Unbekannte Ressourcen-Aktion.');
  }

  if (kind === 'kick') {
    const reason = (payload.reason || 'Kick').replace(/"/g, "'");
    if (payload.id !== undefined) return dispatchFxCommand(settings, `kick ${payload.id} ${reason}`);
    throw new Error('Kick ohne Spieler-ID.');
  }

  if (kind === 'warn' || kind === 'message') {
    const reason = (payload.reason || payload.message || '').replace(/"/g, "'");
    if (payload.id !== undefined) {
      if (kind === 'message') return dispatchFxCommand(settings, `say ${reason}`);
      return dispatchFxCommand(settings, `kick ${payload.id} ${reason}`);
    }
    throw new Error('Spieler-ID fehlt.');
  }

  if (kind === 'ban') {
    const reason = (payload.reason || 'Ban').replace(/"/g, "'");
    if (payload.identifier) {
      return dispatchFxCommand(settings, `add_ace identifier.${payload.identifier} command deny allow # orbit-ban ${reason}`);
    }
    throw new Error('Ban: Identifier für Ingame-Sperre fehlt (Panel-Ban ist in der DB).');
  }

  if (kind.startsWith('server.')) {
    const action = kind.slice('server.'.length);
    if (['start', 'stop', 'restart'].includes(action)) {
      await controlFx(action, settings, logLine);
      return '';
    }
  }

  throw new Error(`Warteschlange: ${kind} nicht unterstützt.`);
}

import { controlFx } from './control.js';
import { dispatchFxCommand } from './fxCommand.js';
import { orbitEventCommand } from './orbitEvents.js';

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

  if (kind === 'orbitEvent') {
    const event = String(payload.event || '').trim();
    if (!event) throw new Error('orbitEvent ohne Name.');
    return dispatchFxCommand(settings, orbitEventCommand(event, payload.data || payload));
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
    return dispatchFxCommand(settings, orbitEventCommand('playerKicked', {
      target: payload.id,
      reason: payload.reason || 'Kick',
    }));
  }

  if (kind === 'warn') {
    return dispatchFxCommand(settings, orbitEventCommand('playerWarned', {
      targetNetId: payload.id,
      author: payload.author || 'Orbit',
      reason: payload.reason || '',
      actionId: payload.actionId,
    }));
  }

  if (kind === 'message') {
    return dispatchFxCommand(settings, orbitEventCommand('directMessage', {
      target: payload.id,
      author: payload.author || 'Admin',
      message: payload.reason || payload.message || '',
    }));
  }

  if (kind === 'ban') {
    return dispatchFxCommand(settings, orbitEventCommand('playerBanned', {
      targetNetId: payload.id,
      targetIds: payload.identifiers || (payload.identifier ? [payload.identifier] : []),
      reason: payload.reason || 'Ban',
      kickMessage: payload.reason || 'Gebannt',
    }));
  }

  if (kind === 'shutdown') {
    return dispatchFxCommand(settings, orbitEventCommand('serverShuttingDown', {
      message: payload.message || 'Server wird neu gestartet…',
    }));
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

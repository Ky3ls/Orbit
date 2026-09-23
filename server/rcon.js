import { Rcon } from 'rcon-client';

export function fxCommandReady(settings) {
  return Boolean(String(settings.rconPassword || '').length >= 4);
}

/**
 * FiveM/Source-RCON — Befehle direkt an FXServer (ohne txAdmin).
 */
export async function sendFxCommand(settings, command) {
  const password = String(settings.rconPassword || '');
  if (!fxCommandReady(settings)) {
    throw new Error('RCON fehlt: In server.cfg `rcon_password "…"` setzen und unter Einstellungen „CFG neu lesen“. ');
  }
  const host = settings.fivemHost || '127.0.0.1';
  const port = Number(settings.rconPort) || Number(settings.fivemPort) || 30120;
  const rcon = await Rcon.connect({ host, port, password, timeout: 8000 });
  try {
    const out = await rcon.send(command);
    return out || '';
  } finally {
    rcon.end();
  }
}

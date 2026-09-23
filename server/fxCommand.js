import { orbitControlMode } from './fxLaunch.js';
import { sendFxCommand, fxCommandReady } from './rcon.js';
import { sendSupervisorCommand, supervisorConsoleReady } from './fxSupervisor.js';

/**
 * Befehl an den laufenden FXServer — Orbit-Konsole hat Vorrang vor RCON.
 * @param {Record<string, string>} settings
 */
export async function dispatchFxCommand(settings, command) {
  if (orbitControlMode(settings) === 'orbit' && supervisorConsoleReady()) {
    return sendSupervisorCommand(settings, command);
  }
  if (fxCommandReady(settings)) {
    return sendFxCommand(settings, command);
  }
  throw new Error(
    'Keine FX-Konsole: Orbit-Prozess starten oder `rcon_password` in server.cfg setzen.',
  );
}

export function fxConsoleReady(settings) {
  if (orbitControlMode(settings) === 'orbit' && supervisorConsoleReady()) return true;
  return fxCommandReady(settings);
}

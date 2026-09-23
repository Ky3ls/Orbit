/** Anzeige-Labels für FX-Steuerung im Panel */

export function fxModeLabel(mode) {
  return mode === 'orbit' ? 'Orbit-Prozess' : 'systemd';
}

export function fxModeShort(mode) {
  return mode === 'orbit' ? 'Orbit' : 'systemd';
}

/**
 * @param {{ fxControlMode?: string, fxCommandReady?: boolean, processActive?: boolean, unitActive?: boolean, online?: boolean }} s
 */
export function processLabel(s) {
  const active = s.processActive ?? s.unitActive;
  if (s.fxControlMode === 'orbit') {
    if (active) return 'FX läuft (Orbit)';
    return 'FX gestoppt';
  }
  return active ? 'Dienst aktiv' : 'Dienst inaktiv';
}

/**
 * @param {{ fxCommandReady?: boolean, fxControlMode?: string, online?: boolean }} s
 */
export function consoleReadyHint(s) {
  if (s.fxCommandReady) {
    return s.fxControlMode === 'orbit'
      ? 'Konsole über Orbit-Pipe'
      : 'Konsole bereit (Orbit oder RCON)';
  }
  if (s.fxControlMode === 'orbit') {
    return 'Server unter Orbit starten für Konsole & Ressourcen.';
  }
  return 'Orbit-Prozess starten oder rcon_password in server.cfg.';
}

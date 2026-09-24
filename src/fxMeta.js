/** Anzeige-Labels für FX-Steuerung im Panel */

/** @param {(k: string) => string} [t] */
export function fxModeLabel(mode, t) {
  if (t) return mode === 'orbit' ? t('fx.modeOrbit') : t('fx.modeSystemd');
  return mode === 'orbit' ? 'Orbit-Prozess' : 'systemd';
}

export function fxModeShort(mode) {
  return mode === 'orbit' ? 'Orbit' : 'systemd';
}

/**
 * @param {{ fxControlMode?: string, fxCommandReady?: boolean, processActive?: boolean, unitActive?: boolean, online?: boolean }} s
 * @param {(k: string) => string} [t]
 */
export function processLabel(s, t) {
  const active = s.processActive ?? s.unitActive;
  if (s.fxControlMode === 'orbit') {
    if (active) return t ? t('fx.procOrbitOn') : 'FX läuft (Orbit)';
    return t ? t('fx.procOrbitOff') : 'FX gestoppt';
  }
  return active
    ? (t ? t('fx.procSvcOn') : 'Dienst aktiv')
    : (t ? t('fx.procSvcOff') : 'Dienst inaktiv');
}

/**
 * @param {{ fxCommandReady?: boolean, fxControlMode?: string, online?: boolean }} s
 * @param {(k: string) => string} [t]
 */
export function consoleReadyHint(s, t) {
  if (s.fxCommandReady) {
    return s.fxControlMode === 'orbit'
      ? (t ? t('fx.hintOrbitPipe') : 'Konsole über Orbit-Pipe')
      : (t ? t('fx.hintReady') : 'Konsole bereit (Orbit oder RCON)');
  }
  if (s.fxControlMode === 'orbit') {
    return t ? t('fx.hintStartOrbit') : 'Server unter Orbit starten für Konsole & Ressourcen.';
  }
  return t ? t('fx.hintRcon') : 'Orbit-Prozess starten oder rcon_password in server.cfg.';
}

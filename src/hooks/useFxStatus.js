import { useEffect, useRef, useState } from 'react';
import { api, sameJson } from '../api.js';

const EMPTY = {
  online: false,
  fxControlMode: 'systemd',
  fxCommandReady: false,
  processActive: false,
  unitActive: false,
  controlEnabled: false,
  status: 'offline',
  controlPhase: 'idle',
  supervisorPhase: undefined,
  ready: false,
};

export function normalizeFx(d) {
  return {
    online: !!d.online,
    fxControlMode: d.fxControlMode || 'systemd',
    fxCommandReady: !!d.fxCommandReady,
    processActive: !!(d.processActive ?? d.unitActive),
    unitActive: !!(d.unitActive ?? d.processActive),
    controlEnabled: d.controlEnabled !== false,
    status: d.status || 'offline',
    controlPhase: d.controlPhase || 'idle',
    supervisorPhase: d.supervisorPhase,
    ready: true,
  };
}

/** Status transitional / Prozess aktiv → Konsole als live behandeln. */
export function isFxConsoleLive(fx) {
  if (!fx) return false;
  return !!(
    fx.online
    || fx.processActive
    || fx.unitActive
    || fx.status === 'starting'
    || fx.status === 'stopping'
    || fx.status === 'restarting'
    || fx.controlPhase === 'starting'
    || fx.controlPhase === 'stopping'
    || fx.controlPhase === 'restarting'
    || fx.supervisorPhase === 'starting'
    || fx.supervisorPhase === 'running'
    || fx.supervisorPhase === 'stopping'
  );
}

/** Pollt /api/server/status für FX-Metadaten (leichtgewichtig). */
export function useFxStatus(intervalMs = 8000) {
  const [fx, setFx] = useState(EMPTY);
  const prev = useRef(null);

  useEffect(() => {
    let stop = false;
    let timer = 0;

    const schedule = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(load, ms);
    };

    const load = () => {
      if (stop) return;
      if (document.hidden) {
        schedule(intervalMs);
        return;
      }
      api('/api/server/status')
        .then((d) => {
          if (stop) return;
          const next = normalizeFx(d);
          if (!(prev.current && sameJson(prev.current, next))) {
            prev.current = next;
            setFx(next);
          }
          const busy = next.status === 'starting' || next.status === 'stopping'
            || next.status === 'restarting' || !next.online;
          // Offline/Boot: 2s — Online stabil: normales Intervall
          schedule(busy ? Math.min(intervalMs, 2000) : intervalMs);
        })
        .catch(() => {
          if (!stop) schedule(intervalMs);
        });
    };

    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [intervalMs]);

  return fx;
}

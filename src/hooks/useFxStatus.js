import { useEffect, useRef, useState } from 'react';
import { api, sameJson } from '../api.js';

const EMPTY = {
  online: false,
  fxControlMode: 'systemd',
  fxCommandReady: false,
  processActive: false,
  controlEnabled: false,
  status: 'offline',
};

/** Pollt /api/server/status für FX-Metadaten (leichtgewichtig). */
export function useFxStatus(intervalMs = 8000) {
  const [fx, setFx] = useState(EMPTY);
  const prev = useRef(EMPTY);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      api('/api/server/status')
        .then((d) => {
          if (stop) return;
          const next = {
            online: !!d.online,
            fxControlMode: d.fxControlMode || 'systemd',
            fxCommandReady: !!d.fxCommandReady,
            processActive: !!d.unitActive,
            unitActive: !!d.unitActive,
            controlEnabled: !!d.controlEnabled,
            status: d.status || 'offline',
            supervisorPhase: d.supervisorPhase,
          };
          if (sameJson(prev.current, next)) return;
          prev.current = next;
          setFx(next);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => { stop = true; clearInterval(id); };
  }, [intervalMs]);

  return fx;
}

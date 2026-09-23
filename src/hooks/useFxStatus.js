import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = {
  online: false,
  fxControlMode: 'systemd',
  fxCommandReady: false,
  processActive: false,
  controlEnabled: false,
  status: 'offline',
};

/** Pollt /api/server/status für FX-Metadaten (leichtgewichtig). */
export function useFxStatus(intervalMs = 5000) {
  const [fx, setFx] = useState(EMPTY);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      api('/api/server/status')
        .then((d) => {
          if (stop) return;
          setFx({
            online: !!d.online,
            fxControlMode: d.fxControlMode || 'systemd',
            fxCommandReady: !!d.fxCommandReady,
            processActive: !!d.unitActive,
            unitActive: !!d.unitActive,
            controlEnabled: !!d.controlEnabled,
            status: d.status || 'offline',
            supervisorPhase: d.supervisorPhase,
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => { stop = true; clearInterval(id); };
  }, [intervalMs]);

  return fx;
}

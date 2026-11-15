import { useState } from 'react';
import { api } from '../../api.js';
import { toast } from '../../components/toast.jsx';
import { useNow } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';

/* „Nächster Neustart“ wie bei FiveM — Zeiten direkt in der Karte einstellbar */
const pad = (n) => String(n).padStart(2, '0');
function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export default function McRestartCard({ inst, onSaved }) {
  const now = useNow(1000);
  const [edit, setEdit] = useState(false);
  const [times, setTimes] = useState(inst.restartTimes || []);
  const [add, setAdd] = useState('04:00');
  const [busy, setBusy] = useState(false);
  const next = inst.nextRestart;
  const left = next?.at ? next.at - now.getTime() : null;
  const pct = left != null ? Math.max(0, Math.min(1, 1 - left / 86_400_000)) : 0;
  const C = 2 * Math.PI * 42;

  async function save(list) {
    setBusy(true);
    try {
      const d = await api(`/api/mc/instances/${inst.id}`, { method: 'PATCH', body: { restartTimes: list } });
      onSaved?.(d.instance);
      setTimes(d.instance.restartTimes);
      toast.ok(list.length ? 'Neustart-Zeiten gespeichert' : 'Geplante Neustarts aus');
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  return (
    <section className="mci-restart card">
      <div className="mci-restart-ring" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" className="ring-track" />
          <circle cx="50" cy="50" r="42" className="ring-fill" style={{ strokeDasharray: `${pct * C} ${C}` }} />
        </svg>
        <NavIcon name="restart" />
      </div>
      <div className="mci-restart-text">
        <span className="mci-restart-label">Nächster Neustart</span>
        {left != null ? (
          <>
            <strong className="mono">{countdown(left)}</strong>
            <span className="muted">{next.hhmm} Uhr{times.length > 1 ? ` · ${times.length} Zeiten` : ''}</span>
          </>
        ) : <strong className="mci-restart-none">Kein Neustart geplant</strong>}
        <button type="button" className="mci-restart-edit" onClick={() => { setTimes(inst.restartTimes || []); setEdit((v) => !v); }}>
          {edit ? 'Schließen' : left != null ? 'Zeiten ändern' : 'Neustart planen'} <NavIcon name="arrowRight" />
        </button>
      </div>
      {edit && (
        <div className="mci-restart-form">
          <div className="mci-restart-chips">
            {times.length === 0 ? <span className="muted">Noch keine Zeit — täglich, Uhrzeit in deutscher Zeit.</span> : times.map((t) => (
              <span key={t} className="mci-restart-chip mono">{t}
                <button type="button" title="Entfernen" disabled={busy} onClick={() => save(times.filter((x) => x !== t))}><NavIcon name="x" /></button>
              </span>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (!times.includes(add)) save([...times, add]); }}>
            <input type="time" value={add} onChange={(e) => setAdd(e.target.value)} required />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || times.includes(add)}><NavIcon name="plus" />Hinzufügen</button>
          </form>
          <small className="muted">Spieler werden 5 Min. und 1 Min. vorher im Chat gewarnt, dann läuft der 10-Sekunden-Countdown.</small>
        </div>
      )}
    </section>
  );
}

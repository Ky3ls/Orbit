import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { toast } from '../../components/toast.jsx';
import { Empty, Modal } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { fmtAgo, fmtDate } from './mcItems.jsx';
import './mcbackups.css';

const SCOPE_INFO = {
  full: { label: 'Komplett', text: 'Welten, Plugins/Mods, Configs, Server-JAR', icon: 'archive' },
  worlds: { label: 'Nur Welten', text: 'Oberwelt, Nether, Ende und weitere Welten', icon: 'globe' },
  config: { label: 'Ohne Welten', text: 'Plugins/Mods und Configs — klein und schnell', icon: 'cfg' },
  upload: { label: 'Hochgeladen', text: 'Eigenes Archiv', icon: 'upload' },
};
const REASON = { schedule: 'Zeitplan', manual: 'Manuell', 'pre-restore': 'Sicherheit', upload: 'Upload' };
const EVERY_LABEL = { 1: 'Stündlich', 2: 'Alle 2 h', 3: 'Alle 3 h', 6: 'Alle 6 h', 12: 'Alle 12 h', 24: 'Täglich', 48: 'Alle 2 Tage', 168: 'Wöchentlich' };

export function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024 ** 2) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 100 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}
function fmtIn(t) {
  if (!t) return '—';
  const d = t - Date.now();
  if (d <= 60_000) return 'gleich';
  if (d < 3600_000) return `in ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) return `in ${Math.round(d / 3600_000)} h`;
  return `in ${Math.round(d / 86_400_000)} Tagen`;
}

export default function McBackups({ inst }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState('full');
  const [note, setNote] = useState('');
  const [job, setJob] = useState(null);
  const [restore, setRestore] = useState(null);
  const [upPct, setUpPct] = useState(null);
  const fileRef = useRef(null);
  const base = `/api/mc/instances/${inst.id}/backups`;

  const load = useCallback(async () => {
    try {
      const d = await api(base);
      setData(d);
      setErr('');
      if (d.job) setJob((j) => (j && j.id === d.job.id ? j : d.job));
    } catch (e) { setErr(e.message); }
  }, [base]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Laufenden Job eng verfolgen
  useEffect(() => {
    if (!job || job.done) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const d = await api(`${base}/jobs/${job.id}`);
        if (stop) return;
        setJob(d.job);
        if (d.job.done) {
          if (d.job.error) toast.err(`${d.job.label} fehlgeschlagen`, { text: d.job.error });
          else toast.ok(`${d.job.label} fertig`, { text: d.job.result?.file || (d.job.result?.restored ? `${d.job.result.restored.length} Einträge wiederhergestellt` : undefined) });
          load();
        }
      } catch { /* */ }
    };
    const t = setInterval(tick, 700);
    return () => { stop = true; clearInterval(t); };
  }, [job?.id, job?.done, base, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    try {
      const d = await api(base, { method: 'POST', body: { scope, note } });
      setJob(d.job);
      setNote('');
    } catch (e) { toast.err(e.message); }
  }

  async function patchFile(b, body, okText) {
    try {
      await api(`${base}/file?file=${encodeURIComponent(b.file)}`, { method: 'PATCH', body });
      if (okText) toast.ok(okText);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function remove(b) {
    if (!window.confirm(`Backup vom ${fmtDate(b.created)} (${fmtBytes(b.size)}) endgültig löschen?`)) return;
    try {
      await api(`${base}/file?file=${encodeURIComponent(b.file)}`, { method: 'DELETE' });
      toast.ok('Backup gelöscht');
      load();
    } catch (e) { toast.err(e.message); }
  }

  function upload(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-TX2-Client', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUpPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setUpPct(null);
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) { toast.ok('Archiv hochgeladen', { text: `${d.entries?.length || 0} Einträge erkannt` }); load(); }
      else toast.err('Upload fehlgeschlagen', { text: d.error || (xhr.status === 413 ? 'Datei zu groß für den Proxy (Cloudflare: max. 100 MB).' : `HTTP ${xhr.status}`) });
    };
    xhr.onerror = () => { setUpPct(null); toast.err('Upload fehlgeschlagen', { text: 'Verbindung abgebrochen — große Dateien ggf. direkt über die Server-IP hochladen.' }); };
    setUpPct(0);
    xhr.send(file);
  }

  if (!data) {
    return err
      ? <div className="card mcb-err"><Empty title="Backups nicht ladbar" text={err} /><button type="button" className="btn btn-sm" onClick={load}>Erneut versuchen</button></div>
      : <div className="mcx-loading">Lade Backups…</div>;
  }

  const items = data.items;
  const last = items.find((b) => b.reason !== 'pre-restore');
  const running = job && !job.done;
  const blocked = running || !!data.busy;

  return (
    <div className="mcb">
      <div className="mcb-tiles">
        <div className="mcb-tile tone-accent">
          <span className="mcb-tile-ico"><NavIcon name="archive" /></span>
          <span><b>{items.length}</b><em>Backups · {fmtBytes(data.totalSize)}</em></span>
        </div>
        <div className={`mcb-tile ${last && Date.now() - last.created < 86_400_000 * 2 ? 'tone-ok' : 'tone-warn'}`}>
          <span className="mcb-tile-ico"><NavIcon name="check" /></span>
          <span><b>{last ? fmtAgo(last.created) : 'Nie'}</b><em>Letztes Backup</em></span>
        </div>
        <div className={`mcb-tile ${data.cfg.enabled ? 'tone-info' : 'tone-mute'}`}>
          <span className="mcb-tile-ico"><NavIcon name="clock" /></span>
          <span><b>{data.cfg.enabled ? fmtIn(data.next) : 'Aus'}</b><em>{data.cfg.enabled ? `${EVERY_LABEL[data.cfg.everyHours]}${data.cfg.everyHours >= 24 ? ` · ${data.cfg.at} Uhr` : ''}` : 'Kein Zeitplan'}</em></span>
        </div>
        <div className={`mcb-tile ${data.free != null && data.free < 10 * 1024 ** 3 ? 'tone-bad' : 'tone-mute'}`}>
          <span className="mcb-tile-ico"><NavIcon name="db" /></span>
          <span><b>{fmtBytes(data.free)}</b><em>Frei auf der Platte</em></span>
        </div>
      </div>

      {job && <JobCard job={job} onClose={() => setJob(null)} />}
      {data.busy && !running && (
        <div className="mcp-note"><NavIcon name="clock" /><span>Gerade läuft {data.busy.kind === 'restore' ? 'eine Wiederherstellung' : 'ein Backup'} von <b>{data.busy.name}</b> — neue Backups starten danach.</span></div>
      )}

      <section className="card mcb-create">
        <div className="mcb-scopes" role="radiogroup" aria-label="Umfang">
          {['full', 'worlds', 'config'].map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} className={`mcb-scope${scope === s ? ' active' : ''}`} onClick={() => setScope(s)}>
              <NavIcon name={SCOPE_INFO[s].icon} />
              <span><b>{SCOPE_INFO[s].label}</b><small>{SCOPE_INFO[s].text}</small></span>
            </button>
          ))}
        </div>
        <div className="mcb-create-row">
          <input className="input" placeholder="Notiz (optional) — z. B. „vor Update auf 1.21.5“" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) create(); }} />
          <button type="button" className="btn btn-primary" disabled={blocked} onClick={create}><NavIcon name="archive" />Backup erstellen</button>
          <input ref={fileRef} type="file" hidden accept=".zst,.gz,.tgz,.tar" onChange={upload} />
          <button type="button" className="btn" disabled={upPct != null} onClick={() => fileRef.current?.click()}><NavIcon name="upload" />{upPct != null ? `${upPct} %` : 'Hochladen'}</button>
        </div>
        <p className="mcb-hint">
          {data.running
            ? <>Server läuft — Orbit speichert die Welt vorher ({data.rcon ? 'über RCON' : 'über die Konsole'}) und pausiert das Autosave kurz. Spieler können weiterspielen.</>
            : <>Server ist aus — das Backup ist automatisch konsistent.</>}
          {' '}Welten: {data.worlds.length ? data.worlds.join(', ') : 'keine gefunden'}.
        </p>
      </section>

      <Schedule data={data} base={base} onSaved={setData} />

      {items.length === 0 ? (
        <div className="card mm-empty"><Empty title="Noch keine Backups" text="Erstelle das erste Backup oder schalte den Zeitplan ein." /></div>
      ) : (
        <div className="card mcb-list">
          {items.map((b) => {
            const info = SCOPE_INFO[b.scope] || SCOPE_INFO.upload;
            return (
              <div key={b.file} className={`mcb-row${b.locked ? ' locked' : ''}`}>
                <span className={`mcb-ico s-${b.scope}`}><NavIcon name={info.icon} /></span>
                <span className="mcb-main">
                  <b>{fmtDate(b.created)}<span className="muted"> · {fmtAgo(b.created)}</span></b>
                  <small>
                    {info.label}
                    {b.note ? <> · <span className="mcb-note">{b.note}</span></> : null}
                    {b.by ? <> · {b.by}</> : null}
                  </small>
                </span>
                <span className="mcb-chips">
                  <span className={`mcp-chip ${b.reason === 'schedule' ? 'info' : b.reason === 'pre-restore' ? 'warn' : ''}`}>{REASON[b.reason] || 'Manuell'}</span>
                  {b.live ? <span className="mcp-chip ok" title="Im laufenden Betrieb gesichert (save-all flush)"><i />Live</span> : null}
                  {b.locked ? <span className="mcp-chip warn" title="Wird vom Zeitplan nie gelöscht"><NavIcon name="lock" />Behalten</span> : null}
                </span>
                <span className="mcb-size">
                  <b>{fmtBytes(b.size)}</b>
                  {b.raw ? <small>von {fmtBytes(b.raw)}{b.durationMs ? ` · ${(b.durationMs / 1000).toFixed(b.durationMs < 10_000 ? 1 : 0)} s` : ''}</small> : null}
                </span>
                <span className="mcb-acts">
                  <button type="button" className="btn btn-sm" disabled={blocked} onClick={() => setRestore(b)}><NavIcon name="undo" />Wiederherstellen</button>
                  <a className="o-icon-btn" title="Herunterladen" href={`${base}/download?file=${encodeURIComponent(b.file)}`}><NavIcon name="download" /></a>
                  <button type="button" className={`o-icon-btn${b.locked ? ' on' : ''}`} title={b.locked ? 'Nicht mehr fest behalten' : 'Fest behalten (Zeitplan löscht es nie)'} onClick={() => patchFile(b, { locked: !b.locked }, b.locked ? 'Wird wieder automatisch aufgeräumt' : 'Backup wird behalten')}><NavIcon name="lock" /></button>
                  <button type="button" className="o-icon-btn" title="Notiz bearbeiten" onClick={() => { const n = window.prompt('Notiz:', b.note || ''); if (n !== null) patchFile(b, { note: n }); }}><NavIcon name="log" /></button>
                  <button type="button" className="o-icon-btn danger" title="Löschen" disabled={blocked} onClick={() => remove(b)}><NavIcon name="trash" /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {restore && (
        <RestoreModal
          inst={inst}
          backup={restore}
          base={base}
          running={data.running}
          onClose={() => setRestore(null)}
          onStarted={(j) => { setRestore(null); setJob(j); }}
        />
      )}
    </div>
  );
}

function JobCard({ job, onClose }) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job.log?.length]);
  const pct = job.done && !job.error ? 100 : job.progress || 0;
  return (
    <section className={`card mcb-job${job.error ? ' bad' : job.done ? ' ok' : ''}`}>
      <div className="mcb-job-head">
        <span className="mcb-job-ico"><NavIcon name={job.kind === 'restore' ? 'undo' : 'archive'} /></span>
        <span className="mcb-job-title">
          <b>{job.label}{job.done ? (job.error ? ' fehlgeschlagen' : ' fertig') : ''}</b>
          <small>{job.done ? (job.error || (job.result?.file ? `${job.result.file} · ${fmtBytes(job.result.size)}` : 'Abgeschlossen')) : `${job.step}${job.total ? ` · ${fmtBytes(job.bytes)} von ${fmtBytes(job.total)}` : ''}`}</small>
        </span>
        <span className="mcb-job-pct">{pct}%</span>
        {job.done && <button type="button" className="o-icon-btn" title="Schließen" onClick={onClose}><NavIcon name="x" /></button>}
      </div>
      <div className={`mcx-progress${job.error ? ' bad' : job.done ? ' ok' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      {job.log?.length > 0 && (
        <div className="mcb-job-log" ref={logRef}>
          {job.log.map((l, i) => <div key={i} className={`lv-${l.level}`}>{l.text}</div>)}
        </div>
      )}
    </section>
  );
}

function Schedule({ data, base, onSaved }) {
  const [form, setForm] = useState(data.cfg);
  const [saving, setSaving] = useState(false);
  const keys = ['enabled', 'everyHours', 'at', 'scope', 'keep', 'onlyActive', 'announce'];
  const dirty = keys.some((k) => form[k] !== data.cfg[k]);
  useEffect(() => { if (!dirty) setForm(data.cfg); }, [data.cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(next = form) {
    setSaving(true);
    try {
      const body = {};
      for (const k of keys) body[k] = next[k];
      const d = await api(`${base}/settings`, { method: 'PUT', body });
      onSaved(d);
      setForm(d.cfg);
      toast.ok(d.cfg.enabled ? 'Zeitplan gespeichert' : 'Zeitplan ausgeschaltet');
    } catch (e) { toast.err(e.message); }
    setSaving(false);
  }

  return (
    <section className={`card mcb-sched${form.enabled ? ' on' : ''}`}>
      <header className="mcb-sched-head">
        <span className="mcb-sched-ico"><NavIcon name="calendar" /></span>
        <span className="grow"><b>Automatische Backups</b><small>{form.enabled ? `${EVERY_LABEL[form.everyHours]}${form.everyHours >= 24 ? ` um ${form.at} Uhr` : ''} · ${SCOPE_INFO[form.scope].label} · die letzten ${form.keep} behalten` : 'Aus — Backups nur von Hand'}</small></span>
        <button type="button" role="switch" aria-checked={form.enabled} aria-label="Automatische Backups" className={`switch${form.enabled ? ' on' : ''}`} onClick={() => { const n = { ...form, enabled: !form.enabled }; setForm(n); save(n); }} />
      </header>
      {form.enabled && (
        <div className="mcb-sched-body">
          <div className="mcb-field">
            <label>Intervall</label>
            <div className="mcb-chipsel">
              {data.everyOptions.map((h) => (
                <button key={h} type="button" className={form.everyHours === h ? 'active' : ''} onClick={() => set('everyHours', h)}>{EVERY_LABEL[h]}</button>
              ))}
            </div>
          </div>
          <div className="mcb-grid">
            {form.everyHours >= 24 && (
              <div className="mcb-field">
                <label htmlFor="mcb-at">Uhrzeit</label>
                <input id="mcb-at" type="time" className="input" value={form.at} onChange={(e) => set('at', e.target.value)} />
              </div>
            )}
            <div className="mcb-field">
              <label htmlFor="mcb-scope">Umfang</label>
              <select id="mcb-scope" className="input" value={form.scope} onChange={(e) => set('scope', e.target.value)}>
                {['full', 'worlds', 'config'].map((s) => <option key={s} value={s}>{SCOPE_INFO[s].label}</option>)}
              </select>
            </div>
            <div className="mcb-field">
              <label htmlFor="mcb-keep">Behalten</label>
              <div className="mcb-keep">
                <input id="mcb-keep" type="number" min={1} max={100} className="input" value={form.keep} onChange={(e) => set('keep', Number(e.target.value))} />
                <span className="muted">neueste automatische</span>
              </div>
            </div>
          </div>
          <label className="mcx-switch-row"><span><b>Nur wenn gespielt wurde</b><small>Überspringen, wenn seit dem letzten Backup niemand online war</small></span><button type="button" role="switch" aria-checked={form.onlyActive} className={`switch${form.onlyActive ? ' on' : ''}`} onClick={() => set('onlyActive', !form.onlyActive)} /></label>
          <label className="mcx-switch-row"><span><b>Spieler informieren</b><small>Kurze Chat-Nachricht bei Start und Ende des Backups</small></span><button type="button" role="switch" aria-checked={form.announce} className={`switch${form.announce ? ' on' : ''}`} onClick={() => set('announce', !form.announce)} /></label>
          <p className="mcb-hint">Manuelle, hochgeladene und mit <NavIcon name="lock" /> markierte Backups werden nie automatisch gelöscht.</p>
          {dirty && (
            <div className="mcb-sched-foot">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(data.cfg)}>Verwerfen</button>
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => save()}>Speichern</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RestoreModal({ backup, base, running, onClose, onStarted }) {
  const [entries, setEntries] = useState(backup.entries || null);
  const [sel, setSel] = useState(() => new Set(backup.entries || []));
  const [safety, setSafety] = useState(true);
  const [startAfter, setStartAfter] = useState(running);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    if (entries) return;
    api(`${base}/entries?file=${encodeURIComponent(backup.file)}`)
      .then((d) => { setEntries(d.entries); setSel(new Set(d.entries)); })
      .catch((e) => setLoadErr(e.message));
  }, [base, backup.file, entries]);

  const all = entries && sel.size === entries.length;
  const toggle = (n) => setSel((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  async function go() {
    setBusy(true);
    try {
      const d = await api(`${base}/restore`, { method: 'POST', body: { file: backup.file, entries: all ? null : [...sel], stop: running, startAfter, safety } });
      onStarted(d.job);
    } catch (e) { toast.err(e.message); setBusy(false); }
  }

  return (
    <Modal title="Backup wiederherstellen" onClose={onClose}>
      <div className="mcb-restore">
        <div className="mcb-restore-src">
          <NavIcon name={(SCOPE_INFO[backup.scope] || SCOPE_INFO.upload).icon} />
          <span><b>{fmtDate(backup.created)}</b><small>{(SCOPE_INFO[backup.scope] || SCOPE_INFO.upload).label} · {fmtBytes(backup.size)}{backup.note ? ` · ${backup.note}` : ''}</small></span>
        </div>

        <div className="mcb-field">
          <label>Was soll zurück? <button type="button" className="mcx-reset" onClick={() => setSel(all ? new Set() : new Set(entries || []))}>{all ? 'Nichts' : 'Alles'}</button></label>
          {loadErr ? <p className="bad-text">{loadErr}</p> : !entries ? <div className="mcx-loading">Lese Archiv…</div> : (
            <div className="mcb-entries">
              {entries.map((n) => (
                <label key={n} className={`mcb-entry${sel.has(n) ? ' on' : ''}`}>
                  <input type="checkbox" checked={sel.has(n)} onChange={() => toggle(n)} />
                  <span className="mono">{n}</span>
                </label>
              ))}
            </div>
          )}
          {backup.scope === 'full' && all && <small className="muted">Kompletter Stand: Dateien, die nach dem Backup dazugekommen sind, werden entfernt (Logs bleiben).</small>}
        </div>

        <label className="mcx-switch-row"><span><b>Vorher Sicherheits-Backup</b><small>Den aktuellen Stand sichern, damit du zurück kannst</small></span><button type="button" role="switch" aria-checked={safety} className={`switch${safety ? ' on' : ''}`} onClick={() => setSafety(!safety)} /></label>
        <label className="mcx-switch-row"><span><b>Danach starten</b><small>Server nach der Wiederherstellung hochfahren</small></span><button type="button" role="switch" aria-checked={startAfter} className={`switch${startAfter ? ' on' : ''}`} onClick={() => setStartAfter(!startAfter)} /></label>

        {running && <div className="mcp-note warn"><NavIcon name="power" /><span>Der Server läuft und wird dafür <b>gestoppt</b>. Spieler werden vorher im Chat informiert.</span></div>}
        {!safety && <div className="mcp-note warn"><NavIcon name="bolt" /><span>Ohne Sicherheits-Backup ist der aktuelle Stand danach <b>weg</b>.</span></div>}

        <div className="mcb-restore-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn btn-danger" disabled={busy || !sel.size} onClick={go}><NavIcon name="undo" />{running ? 'Stoppen & wiederherstellen' : 'Wiederherstellen'}</button>
        </div>
      </div>
    </Modal>
  );
}

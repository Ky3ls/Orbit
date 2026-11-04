import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtMb } from './mcShared.js';
import './mc.css';

const fmtBytes = (b) => (b == null ? '—' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
const baseName = (p) => String(p).split('/').filter(Boolean).pop() || p;
const looksLikeId = (s) => /^[0-9a-f]{32}$/.test(s);

function niceName(s) {
  const folder = baseName(s.path);
  if (!looksLikeId(folder)) return folder.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  if (s.motd && s.motd !== 'A Minecraft Server') return s.motd.replace(/§./g, '').slice(0, 40);
  return `${TYPE_META[s.type]?.label || 'Minecraft'} ${s.mcVersion || ''}`.trim();
}

export default function McImport() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [manual, setManual] = useState('');
  const [sel, setSel] = useState(null);
  const [an, setAn] = useState(null);
  const [anErr, setAnErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [instId, setInstId] = useState(null);
  const jobAfter = useRef(0);
  const logRef = useRef(null);

  const scan = () => {
    setList(null);
    api('/api/mc/import/scan').then((d) => setList(d.servers || [])).catch((e) => { toast.err(e.message); setList([]); });
  };
  useEffect(scan, []);

  async function analyze(p) {
    setSel(p);
    setAn(null);
    setAnErr(null);
    setForm(null);
    try {
      const d = await api(`/api/mc/import/analyze?path=${encodeURIComponent(p)}`);
      const s = d.server;
      setAn(s);
      setForm({
        name: niceName(s),
        mode: 'copy',
        port: s.port,
        ramMb: Math.min(s.ramMax || 65536, s.ramMb || s.ramSuggest || 4096),
        mcVersion: s.mcVersion || '',
        skipLogs: true,
        eula: s.eula,
        sourceRunningOk: false,
      });
      setTimeout(() => document.querySelector('.mim-config')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e) { setAnErr(e.message); }
  }

  async function start() {
    setBusy(true);
    try {
      const d = await api('/api/mc/import', { method: 'POST', body: { path: an.path, ...form } });
      setInstId(d.instance.id);
      jobAfter.current = 0;
      setJob({ id: d.jobId, step: 'Vorbereiten', progress: 0, log: [], done: false });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  useEffect(() => {
    if (!job?.id || job.done) return undefined;
    const t = setInterval(() => {
      api(`/api/mc/import/jobs/${job.id}?after=${jobAfter.current}`).then((d) => {
        if (d.log?.length) jobAfter.current = d.log[d.log.length - 1].t;
        setJob((j) => ({ ...d, log: [...(j?.log || []), ...(d.log || [])].slice(-300) }));
      }).catch(() => {});
    }, 800);
    return () => clearInterval(t);
  }, [job?.id, job?.done]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job?.log?.length]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const tm = an ? TYPE_META[an.type] || TYPE_META.vanilla : null;

  if (job) {
    return (
      <Page className="mcx-page">
        <PageHeader eyebrow="Import" title={form.name} description={`${tm.label} ${form.mcVersion} wird übernommen.`} />
        <section className="mcx-install card">
          <div className="mcx-install-head">
            <GameMark game="minecraft" color={tm.color} size={48} />
            <div>
              <b>{job.done ? (job.error ? 'Import fehlgeschlagen' : 'Import abgeschlossen') : job.step}</b>
              <span>{job.done ? (job.error || 'Alle Einstellungen, Welten, Spieler und Erweiterungen sind übernommen.') : form.mode === 'copy' ? `Kopiere ${fmtBytes(an.size)} — das Original bleibt unverändert.` : 'Wird vor Ort übernommen.'}</span>
            </div>
            <span className="mcx-install-pct">{job.progress || 0}%</span>
          </div>
          <div className={`mcx-progress${job.error ? ' bad' : job.done ? ' ok' : ''}`}><i style={{ width: `${job.progress || 0}%` }} /></div>
          <div className="mcx-install-log" ref={logRef}>
            {job.log.map((l, i) => (
              <div key={`${l.t}-${i}`} className={`lvl-${l.level}`}>
                {l.level === 'step' ? <NavIcon name="chevron" /> : null}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
          {job.done && (
            <div className="mcx-install-foot">
              {job.error
                ? <button type="button" className="btn" onClick={() => setJob(null)}>Zurück</button>
                : <button type="button" className="btn btn-primary" onClick={() => navigate(`/mc/${instId}`)}>Zur Instanz<NavIcon name="chevron" /></button>}
            </div>
          )}
        </section>
      </Page>
    );
  }

  const blockers = [];
  if (an) {
    if (an.managed) blockers.push('Dieser Ordner ist schon eine Orbit-Instanz.');
    if (form?.mode === 'copy' && an.fits === false) blockers.push(`Zu wenig Speicher: ${fmtBytes(an.size)} nötig, ${fmtBytes(an.free)} frei.`);
    if (form?.mode === 'inplace' && an.running) blockers.push('Zum Übernehmen vor Ort muss der Server gestoppt sein.');
    if (!form?.mcVersion) blockers.push('Minecraft-Version angeben.');
    if (!form?.eula) blockers.push('EULA akzeptieren.');
    if (form?.mode === 'copy' && an.running && !form.sourceRunningOk) blockers.push('Bestätigen, dass im laufenden Betrieb kopiert wird.');
  }

  return (
    <Page className="mcx-page">
      <PageHeader
        eyebrow="Instanzen"
        title="Server importieren"
        description="Bestehende Minecraft-Server übernehmen: Welten, Plugins/Mods, Spieler, OPs, Whitelist und alle Einstellungen."
        actions={<Link to="/instances" className="btn btn-sm btn-ghost">Abbrechen</Link>}
      />

      <section className="mim-find card">
        <header className="mim-find-head">
          <div><h3>Gefundene Server</h3><p>Orbit hat diesen Host nach Ordnern mit einer <code>server.properties</code> durchsucht.</p></div>
          <button type="button" className="btn btn-sm" onClick={scan}><NavIcon name="refresh" />Neu suchen</button>
        </header>
        {!list ? <div className="mcx-loading">Suche Server…</div> : list.length === 0 ? (
          <p className="muted mim-none">Keine Server gefunden. Gib den Pfad unten von Hand ein.</p>
        ) : (
          <div className="mim-grid">
            {list.map((s) => {
              const t = TYPE_META[s.type] || {};
              return (
                <button key={s.path} type="button" className={`mim-card${sel === s.path ? ' active' : ''}${s.error ? ' err' : ''}`} onClick={() => !s.error && analyze(s.path)} disabled={!!s.error}>
                  <span className="mim-card-top">
                    <GameMark game="minecraft" color={t.color || '#888'} size={38} />
                    <span className="mim-card-title">
                      <b>{s.error ? baseName(s.path) : niceName(s)}</b>
                      <small className="mono">{s.path}</small>
                    </span>
                  </span>
                  {s.error ? <span className="mim-card-err">{s.error}</span> : (
                    <>
                      <span className="mim-tags">
                        <span className="mim-type" style={{ '--c': t.color }}>{t.label}</span>
                        <span className="mcp-chip">{s.mcVersion || '?'}{s.loaderVersion ? ` · ${s.loaderVersion}` : ''}</span>
                        <span className="mcp-chip">Port {s.port}</span>
                        {s.extensions ? <span className="mcp-chip">{s.extensions} {s.kind === 'mods' ? 'Mods' : 'Plugins'}</span> : null}
                      </span>
                      <span className="mim-tags">
                        {s.running ? <span className="mcp-chip ok"><i />Läuft gerade</span> : null}
                        {s.mcsmanager ? <span className="mcp-chip info">MCSManager</span> : null}
                        {s.managed ? <span className="mcp-chip warn">Schon in Orbit</span> : null}
                        {s.players ? <span className="mcp-chip">{s.players} Spieler</span> : null}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <form className="mim-manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) analyze(manual.trim()); }}>
          <div className="lg-search"><NavIcon name="folder" /><input placeholder="Oder Pfad eingeben, z. B. /home/minecraft/survival" value={manual} onChange={(e) => setManual(e.target.value)} /></div>
          <button type="submit" className="btn btn-sm" disabled={!manual.trim()}>Prüfen</button>
        </form>
      </section>

      {sel && !an && !anErr && <div className="card mim-analyzing"><div className="mcx-loading">Analysiere {sel} … (Größe wird berechnet)</div></div>}
      {anErr && <div className="mcp-note mim-err"><NavIcon name="x" /><span><b>Nicht importierbar.</b> {anErr}</span></div>}

      {an && form && (
        <section className="mim-config card">
          <header className="mim-cfg-head">
            <GameMark game="minecraft" color={tm.color} size={52} />
            <div>
              <h3>{niceName(an)}</h3>
              <p className="mono">{an.path}</p>
            </div>
          </header>

          <dl className="mim-facts">
            <div><dt>Typ</dt><dd><span className="mim-type" style={{ '--c': tm.color }}>{tm.label}</span></dd></div>
            <div><dt>Version</dt><dd>{an.mcVersion || '?'}{an.loaderVersion ? <small> · {an.loaderVersion}</small> : null}</dd></div>
            <div><dt>{an.kind === 'mods' ? 'Mods' : 'Plugins'}</dt><dd>{an.extensions}</dd></div>
            <div><dt>Welten</dt><dd title={an.worlds.join(', ')}>{an.worlds.length ? an.worlds.join(', ') : '—'}</dd></div>
            <div><dt>Spieler / OPs</dt><dd>{an.players} / {an.ops}</dd></div>
            <div><dt>Größe</dt><dd>{fmtBytes(an.size)}</dd></div>
            <div><dt>Java</dt><dd>{an.javaMajor ? `Java ${an.javaMajor}` : '—'}</dd></div>
            <div><dt>Start</dt><dd className="mono" title={an.launch?.argsFile || an.launch?.jar}>{an.launch?.mode === 'args' ? 'unix_args.txt' : an.launch?.jar}</dd></div>
          </dl>

          {(an.running || an.mcsmanager || an.portConflict || an.notes.length > 0) && (
            <div className="mim-warns">
              {an.running && <div className="mcp-note warn"><NavIcon name="bolt" /><span><b>Der Server läuft gerade (PID {an.running}).</b> Kopieren geht trotzdem, das Original wird nur gelesen. Für eine absolut saubere Welt-Kopie ihn aber besser kurz stoppen.</span></div>}
              {an.mcsmanager && <div className="mcp-note"><NavIcon name="layers" /><span><b>Wird von MCSManager verwaltet.</b> Der Import erstellt eine unabhängige Kopie, MCSManager und das Original bleiben unberührt.</span></div>}
              {an.portConflict && <div className="mcp-note warn"><NavIcon name="signal" /><span><b>Port {an.originalPort} ist belegt</b> ({an.portConflict.replace(/\.$/, '')}). Orbit schlägt Port {an.port} vor.</span></div>}
              {an.notes.map((n) => <div key={n} className="mcp-note"><NavIcon name="sparkle" /><span>{n}</span></div>)}
            </div>
          )}

          <div className="mim-form">
            <div className="mim-modes">
              <button type="button" className={`mim-mode${form.mode === 'copy' ? ' active' : ''}`} onClick={() => set('mode', 'copy')}>
                <NavIcon name="copy" />
                <b>Kopieren <em>empfohlen</em></b>
                <small>Orbit legt eine Kopie unter /opt/orbit/servers an. Das Original bleibt komplett unverändert und kann weiterlaufen.</small>
              </button>
              <button type="button" className={`mim-mode${form.mode === 'inplace' ? ' active' : ''}`} disabled={!an.inplaceOk} onClick={() => set('mode', 'inplace')}>
                <NavIcon name="folder" />
                <b>Vor Ort übernehmen</b>
                <small>{an.inplaceOk ? 'Orbit verwaltet den Ordner direkt, ohne Kopie. Die Dateien gehören danach dem Benutzer orbit-mc.' : 'Nicht möglich: Ein Elternordner (z. B. /root) ist für den Minecraft-Benutzer gesperrt.'}</small>
              </button>
            </div>

            <div className="mim-fields">
              <label className="mcp-field"><span>Name in Orbit</span><input value={form.name} maxLength={40} onChange={(e) => set('name', e.target.value)} /></label>
              <label className="mcp-field"><span>Port</span><input type="number" min={1024} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} /></label>
              <label className="mcp-field"><span>Minecraft-Version</span><input value={form.mcVersion} onChange={(e) => set('mcVersion', e.target.value)} placeholder="z. B. 1.21.1" /></label>
            </div>

            <div className="mim-ram">
              <div className="mim-ram-top">
                <span>Arbeitsspeicher</span>
                <b>{fmtMb(form.ramMb)}</b>
                {an.ramMb ? <small>bisher {fmtMb(an.ramMb)} (aus Startskript)</small> : null}
                <button type="button" className="mcx-reset" onClick={() => set('ramMb', an.ramSuggest)}>Empfehlung: {fmtMb(an.ramSuggest)}</button>
              </div>
              {(() => {
                const max = Math.max(an.ramMax || 16384, form.ramMb, an.ramSuggest || 0);
                const pct = (v) => `${((v - 1024) / (max - 1024)) * 100}%`;
                return <input type="range" className="mcx-ram-slider" min={1024} max={max} step={512} value={form.ramMb} style={{ '--pct': pct(form.ramMb), '--rec': pct(an.ramSuggest || form.ramMb) }} onChange={(e) => set('ramMb', Number(e.target.value))} />;
              })()}
            </div>

            <div className="mim-checks">
              {form.mode === 'copy' && (
                <label className="mcx-switch-row"><span><b>Logs weglassen</b><small>logs/ und crash-reports/ nicht mitkopieren</small></span><button type="button" role="switch" aria-checked={form.skipLogs} className={`switch${form.skipLogs ? ' on' : ''}`} onClick={() => set('skipLogs', !form.skipLogs)} /></label>
              )}
              {form.mode === 'copy' && an.running && (
                <label className="mcx-switch-row"><span><b>Im laufenden Betrieb kopieren</b><small>Mir ist klar, dass die Welt während des Spiels kopiert wird</small></span><button type="button" role="switch" aria-checked={form.sourceRunningOk} className={`switch${form.sourceRunningOk ? ' on' : ''}`} onClick={() => set('sourceRunningOk', !form.sourceRunningOk)} /></label>
              )}
              {!an.eula && (
                <label className="mcx-switch-row"><span><b>Minecraft-EULA akzeptieren</b><small>Der Server hatte sie noch nicht akzeptiert (aka.ms/MinecraftEULA)</small></span><button type="button" role="switch" aria-checked={form.eula} className={`switch${form.eula ? ' on' : ''}`} onClick={() => set('eula', !form.eula)} /></label>
              )}
            </div>

            <div className="mim-foot">
              <span className="muted">
                {blockers.length ? blockers[0] : form.mode === 'copy' ? `${fmtBytes(an.size)} werden kopiert · ${fmtBytes(an.free)} frei` : 'Der Ordner wird direkt übernommen'}
              </span>
              <button type="button" className="btn btn-primary" disabled={busy || blockers.length > 0} onClick={start}>
                <NavIcon name="switch" />{busy ? 'Startet…' : 'Importieren'}
              </button>
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** FX-Builds, Multi-Server, Prod — Host-Einstellungen. */
export default function SettingsHostPanel({ initialTab = 'servers', onMessage, onError }) {
  const [tab, setTab] = useState(initialTab);
  const [artifacts, setArtifacts] = useState({ builds: [], installed: [], recommended: '', fxServerRoot: '' });
  const [servers, setServers] = useState([]);
  const [newName, setNewName] = useState('');
  const [build, setBuild] = useState('');
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [prodMysql, setProdMysql] = useState('');
  const [txDetect, setTxDetect] = useState(null);
  const [txImportSettings, setTxImportSettings] = useState(true);
  const [txDeactivate, setTxDeactivate] = useState(true);
  const [txStart, setTxStart] = useState(true);
  const [txImportBans, setTxImportBans] = useState(true);
  const [txImportWarns, setTxImportWarns] = useState(true);
  const [txImportWl, setTxImportWl] = useState(true);
  const [txActiveProfile, setTxActiveProfile] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'txadmin') return;
    api('/api/txadmin/detect').then((d) => {
      setTxDetect(d);
      if (d.profiles?.length && !txActiveProfile) setTxActiveProfile(d.profiles[0].profile);
    }).catch((e) => onError?.(e.message));
  }, [tab]);

  function load() {
    api('/api/artifacts').then(setArtifacts).catch((e) => onError?.(e.message));
    api('/api/servers').then((d) => setServers(d.servers || [])).catch(() => {});
    api('/api/platform/readiness').then(setReadiness).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function installBuild() {
    setBusy(true);
    onError?.('');
    try {
      const b = build || artifacts.recommended;
      await api('/api/artifacts/install', { method: 'POST', body: { build: b } });
      onMessage?.(`Artifact ${b} installiert und als FX-Root gesetzt.`);
      load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function activateBuild(id) {
    const num = id.replace(/^build-/, '');
    setBusy(true);
    try {
      await api('/api/artifacts/activate', { method: 'POST', body: { build: num } });
      onMessage?.(`FX-Root auf ${id} umgestellt.`);
      load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createServer() {
    setBusy(true);
    try {
      await api('/api/servers', { method: 'POST', body: { name: newName.trim() } });
      setNewName('');
      onMessage?.('Server angelegt und aktiviert.');
      load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function activate(id) {
    await api('/api/servers/activate', { method: 'POST', body: { id } });
    onMessage?.('Server aktiviert.');
    load();
  }

  async function serverControl(id, action) {
    setBusy(true);
    onError?.('');
    try {
      await api('/api/servers/control', { method: 'POST', body: { id, action } });
      onMessage?.(`Server ${action} (Instanz ${id}).`);
      load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    { id: 'servers', label: 'Instanzen' },
    { id: 'txadmin', label: 'txAdmin' },
    { id: 'artifacts', label: 'FX Builds' },
    { id: 'prod', label: 'Prod' },
  ];

  async function runTxMigrate() {
    setBusy(true);
    onError?.('');
    try {
      const data = await api('/api/txadmin/migrate', {
        method: 'POST',
        body: {
          importSettings: txImportSettings,
          deactivateTxAdmin: txDeactivate,
          importBans: txImportBans,
          importWarns: txImportWarns,
          importWhitelist: txImportWl,
          startServers: txStart,
          activeProfile: txActiveProfile,
        },
      });
      onMessage?.(`Migration OK: ${data.imported?.length || 0} Server · aktiv: ${data.active?.name || '—'}`);
      load();
      api('/api/txadmin/detect').then(setTxDetect).catch(() => {});
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-host-panel">
      <div className="db-tabs" style={{ marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`db-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'servers' && (
        <div className="st-sub">
          <h3>Multi-Server</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            FX ist in Orbit integriert (Start/Stop/Crash-Restart). „Aktiv“ = Cockpit & Konsole.
            Neuer RP-Server: Name eingeben → Anlegen → Start (ohne txAdmin-Recipe-Deploy).
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input className="search grow" placeholder="Neuer Servername…" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || newName.trim().length < 2} onClick={createServer}>Anlegen</button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {servers.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="mono">{s.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>:{s.port}</span>
                {s.is_active ? <span className="badge ok">aktiv</span> : (
                  <button type="button" className="btn btn-sm" onClick={() => activate(s.id)}>Aktivieren</button>
                )}
                {s.supervisorPhase === 'running' || s.supervisorPhase === 'starting' ? (
                  <span className="badge ok">{s.supervisorPhase}{s.pid ? ` #${s.pid}` : ''}</span>
                ) : (
                  <span className="badge">gestoppt</span>
                )}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => serverControl(s.id, 'start')}>Start</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => serverControl(s.id, 'stop')}>Stop</button>
                <span className="muted" style={{ fontSize: 12 }}>{s.data_path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'txadmin' && (
        <div className="st-sub">
          <h3>Wechsel von txAdmin</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Erkennt txData & Dienste, übernimmt alle Server-Profile, optional CFG-Einstellungen,
            stoppt txAdmin und startet FX über Orbit.
          </p>
          {!txDetect && <p className="muted">Suche…</p>}
          {txDetect && !txDetect.found && (
            <p className="muted">Kein txAdmin / txData auf diesem Host gefunden.</p>
          )}
          {txDetect?.found && (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                FX-Root: <span className="mono">{txDetect.fxRoot || '—'}</span>
                {txDetect.processRunning ? ' · txAdmin-Prozess läuft' : ''}
              </p>
              <ul style={{ fontSize: 13, marginBottom: 12 }}>
                {(txDetect.profiles || []).map((p) => (
                  <li key={p.dataPath}>
                    <b>{p.profile}</b> — {p.hostname} · :{p.port} · {p.resourceCount} Res.
                    <div className="mono muted">{p.dataPath}</div>
                  </li>
                ))}
              </ul>
              <label className="field">
                <span>Aktives Profil nach Migration</span>
                <select value={txActiveProfile} onChange={(e) => setTxActiveProfile(e.target.value)}>
                  {(txDetect.profiles || []).map((p) => (
                    <option key={p.profile} value={p.profile}>{p.profile} ({p.hostname})</option>
                  ))}
                </select>
              </label>
              <label className="row"><input type="checkbox" checked={txImportSettings} onChange={(e) => setTxImportSettings(e.target.checked)} /> server.cfg → Panel-Einstellungen</label>
              <label className="row"><input type="checkbox" checked={txImportBans} onChange={(e) => setTxImportBans(e.target.checked)} /> Bans (playersDB)</label>
              <label className="row"><input type="checkbox" checked={txImportWarns} onChange={(e) => setTxImportWarns(e.target.checked)} /> Warns</label>
              <label className="row"><input type="checkbox" checked={txImportWl} onChange={(e) => setTxImportWl(e.target.checked)} /> Allowlist</label>
              <label className="row"><input type="checkbox" checked={txDeactivate} onChange={(e) => setTxDeactivate(e.target.checked)} /> txAdmin-Dienst deaktivieren</label>
              <label className="row"><input type="checkbox" checked={txStart} onChange={(e) => setTxStart(e.target.checked)} /> FXServer nach Migration starten</label>
              {txDetect.hints?.processTxRoots?.length > 0 && (
                <p className="muted" style={{ fontSize: 12 }}>txData via Prozess: {txDetect.hints.processTxRoots.join(', ')}</p>
              )}
              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={busy || !txDetect.profiles?.length} onClick={runTxMigrate}>
                Jetzt auf Orbit umstellen
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'artifacts' && (
        <div className="st-sub">
          <h3>FX Build Manager</h3>
          <p className="muted">FiveM Linux-Artifacts nach <code className="mono">ORBIT_ARTIFACTS_ROOT</code>.</p>
          <p className="muted">Empfohlen: <b>{artifacts.recommended || '—'}</b></p>
          {artifacts.fxServerRoot && (
            <p className="mono" style={{ fontSize: 12, marginBottom: 8 }}>Aktiv: {artifacts.fxServerRoot}</p>
          )}
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <select value={build} onChange={(e) => setBuild(e.target.value)}>
              <option value="">Build wählen…</option>
              {(artifacts.builds || []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={installBuild}>Download & Install</button>
          </div>
          <p className="muted">Installiert:</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {(artifacts.installed || []).map((a) => (
              <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span className="mono">{a.id}</span>
                {a.ready ? <span className="badge ok">bereit</span> : <span className="badge">…</span>}
                {a.ready && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => activateBuild(a.id)}>Als FX-Root</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'prod' && (
        <div className="st-sub">
          <h3>Prod & Readiness</h3>
          <p className="muted">License & MySQL in die server.cfg des aktiven Servers.</p>
          {readiness && (
            <>
              <ul style={{ fontSize: 13 }}>
                {(readiness.ok || []).map((x) => <li key={x} className="ok">{x}</li>)}
                {(readiness.issues || []).map((x) => <li key={x} style={{ color: 'var(--bad)' }}>{x}</li>)}
              </ul>
              {readiness.cfg && (
                <p className="muted">CFG: License {readiness.cfg.license ? '✓' : '✗'} · MySQL {readiness.cfg.mysql ? '✓' : '✗'}</p>
              )}
            </>
          )}
          <div className="st-grid" style={{ marginTop: 12 }}>
            <label className="field grow">
              <span>sv_licenseKey</span>
              <input type="password" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="cfxk_…" />
            </label>
            <label className="field grow">
              <span>mysql_connection_string</span>
              <input className="mono" value={prodMysql} onChange={(e) => setProdMysql(e.target.value)} placeholder="mysql://…" />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 12 }}
            disabled={busy || (!licenseKey.trim() && !prodMysql.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/api/platform/prod-config', {
                  method: 'POST',
                  body: { licenseKey: licenseKey.trim(), mysqlConnection: prodMysql.trim() },
                });
                onMessage?.('Prod-Werte in server.cfg geschrieben.');
                setLicenseKey('');
                setProdMysql('');
                load();
              } catch (e) {
                onError?.(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            In server.cfg speichern
          </button>
        </div>
      )}
    </div>
  );
}

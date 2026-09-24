import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

/** FX-Builds, Multi-Server, Prod — Host-Einstellungen. */
export default function SettingsHostPanel({ initialTab = 'servers', onMessage, onError }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const [artifacts, setArtifacts] = useState({ builds: [], installed: [], recommended: '', fxServerRoot: '' });
  const [servers, setServers] = useState([]);
  const [newName, setNewName] = useState('');
  const [build, setBuild] = useState('');
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [prodMysql, setProdMysql] = useState('');

  useEffect(() => {
    setTab(['artifacts', 'prod', 'servers'].includes(initialTab) ? initialTab : 'servers');
  }, [initialTab]);

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
      onMessage?.(t('host.created'));
      load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function activate(id) {
    await api('/api/servers/activate', { method: 'POST', body: { id } });
    onMessage?.(t('host.activated'));
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
    { id: 'servers', label: t('host.tab.servers') },
    { id: 'artifacts', label: t('host.tab.artifacts') },
    { id: 'prod', label: t('host.tab.prod') },
  ];

  return (
    <div className="st-host-panel">
      <div className="db-tabs" style={{ marginBottom: 16 }}>
        {tabs.map((tabItem) => (
          <button key={tabItem.id} type="button" className={`db-tab${tab === tabItem.id ? ' active' : ''}`} onClick={() => setTab(tabItem.id)}>
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === 'servers' && (
        <div className="st-sub">
          <h3>Multi-Server</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            FX ist in Orbit integriert (Start/Stop/Crash-Restart). „Aktiv“ = Cockpit & Konsole.
            Neuer Server: Name eingeben → Anlegen → Start.
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input className="search grow" placeholder={t('host.newNamePh')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || newName.trim().length < 2} onClick={createServer}>{t('common.create')}</button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {servers.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="mono">{s.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>:{s.port}</span>
                {s.is_active ? <span className="badge ok">{t('common.active')}</span> : (
                  <button type="button" className="btn btn-sm" onClick={() => activate(s.id)}>{t('host.activate')}</button>
                )}
                {s.supervisorPhase === 'running' || s.supervisorPhase === 'starting' ? (
                  <span className="badge ok">{s.supervisorPhase}{s.pid ? ` #${s.pid}` : ''}</span>
                ) : (
                  <span className="badge">{t('host.stopped')}</span>
                )}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => serverControl(s.id, 'start')}>{t('ctl.start')}</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => serverControl(s.id, 'stop')}>{t('ctl.stop')}</button>
                <span className="muted" style={{ fontSize: 12 }}>{s.data_path}</span>
              </li>
            ))}
          </ul>
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
              <option value="">{t('host.pickBuild')}</option>
              {(artifacts.builds || []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={installBuild}>{t('host.install')}</button>
          </div>
          <p className="muted">{t('host.installed')}</p>
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

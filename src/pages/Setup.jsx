import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Stepper from '../components/Stepper.jsx';
import { Badge, Mark } from '../components/Ui.jsx';
import './setup-wizard.css';

const FRAMEWORKS = [
  { id: 'blank', title: 'Minimal', text: 'OxMySQL + Basis — ohne Framework.' },
  { id: 'esx', title: 'ESX Legacy', text: 'Profil mit ZIP/Git + CFG-Vorlage.' },
  { id: 'qb', title: 'QBCore', text: 'QB-Core Basis-Recipe.' },
];

const STEPS = [
  { id: 'system', label: 'System' },
  { id: 'panel', label: 'Panel-Zugang' },
  { id: 'framework', label: 'Framework' },
  { id: 'network', label: 'Netzwerk' },
  { id: 'database', label: 'Datenbank' },
  { id: 'keys', label: 'Keys & Start' },
  { id: 'done', label: 'Fertig' },
];

const DEFAULT_PANEL_PORT = 40220;

function CheckRow({ ok, warn, title, detail }) {
  const cls = ok ? 'ok' : warn ? 'warn' : 'bad';
  return (
    <div className={`setup-check ${cls}`}>
      <i className="dot" aria-hidden="true" />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export default function Setup({ onDone }) {
  const [step, setStep] = useState(0);
  const [preflight, setPreflight] = useState(null);
  const [name, setName] = useState('Mein Roleplay');
  const [recipe, setRecipe] = useState('esx');
  const [port, setPort] = useState(30120);
  const [maxClients, setMaxClients] = useState(48);
  const [onesync, setOnesync] = useState('on');
  const [locale, setLocale] = useState('de-DE');
  const [tags, setTags] = useState('roleplay, german');
  const [portStatus, setPortStatus] = useState(null);
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [serversRoot, setServersRoot] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [pathStatus, setPathStatus] = useState(null);
  const [panelAccess, setPanelAccess] = useState(null);
  const [panelMode, setPanelMode] = useState('domain');
  const [panelPort, setPanelPort] = useState(DEFAULT_PANEL_PORT);
  const [panelDomain, setPanelDomain] = useState('');
  const [panelPublicHost, setPanelPublicHost] = useState('');
  const [panelStack, setPanelStack] = useState('auto');
  const [panelPreview, setPanelPreview] = useState(null);
  const [createDatabase, setCreateDatabase] = useState(true);
  const [dbName, setDbName] = useState('');
  const [mysqlRootPassword, setMysqlRootPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [migrateTxAdmin, setMigrateTxAdmin] = useState(false);
  const [importTxSettings, setImportTxSettings] = useState(true);
  const [deactivateTxAdmin, setDeactivateTxAdmin] = useState(true);
  const [importTxBans, setImportTxBans] = useState(true);
  const [importTxWarns, setImportTxWarns] = useState(true);
  const [importTxWhitelist, setImportTxWhitelist] = useState(true);

  const loadPreflight = useCallback(() => {
    api('/api/setup/preflight').then(setPreflight).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { loadPreflight(); }, [loadPreflight]);

  const txProfiles = preflight?.txadmin?.profiles || [];

  useEffect(() => {
    if (txProfiles.length) setMigrateTxAdmin(true);
  }, [txProfiles.length]);

  useEffect(() => {
    api('/api/setup/panel-access').then(setPanelAccess).catch(() => {});
  }, []);

  const refreshPanelPreview = useCallback(() => {
    api('/api/setup/panel-access/preview', {
      method: 'POST',
      body: {
        mode: panelMode,
        panelPort: Number(panelPort),
        publicHost: panelPublicHost.trim() || undefined,
        domain: panelDomain.trim() || undefined,
        https: true,
      },
    })
      .then(setPanelPreview)
      .catch(() => setPanelPreview(null));
  }, [panelMode, panelPort, panelPublicHost, panelDomain]);

  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(refreshPanelPreview, 350);
    return () => clearTimeout(t);
  }, [step, refreshPanelPreview]);

  const probePort = useCallback((p) => {
    const n = Number(p);
    if (!n) return;
    api('/api/setup/check-port', { method: 'POST', body: { port: n } })
      .then(setPortStatus)
      .catch(() => setPortStatus(null));
  }, []);

  useEffect(() => {
    if (step !== 3) return;
    const t = setTimeout(() => probePort(port), 400);
    return () => clearTimeout(t);
  }, [port, step, probePort]);

  const probePath = useCallback((root, exact) => {
    if (!useCustomPath) {
      setPathStatus(null);
      return;
    }
    const r = String(root || '').trim();
    const d = String(exact || '').trim();
    if (!r && !d) {
      setPathStatus(null);
      return;
    }
    api('/api/setup/validate-path', { method: 'POST', body: { serversRoot: r, dataPath: d } })
      .then(setPathStatus)
      .catch(() => setPathStatus({ ok: false, issues: ['Pfad konnte nicht geprüft werden.'] }));
  }, [useCustomPath]);

  useEffect(() => {
    if (step !== 3 || !useCustomPath) return;
    const t = setTimeout(() => probePath(serversRoot, dataPath), 400);
    return () => clearTimeout(t);
  }, [step, useCustomPath, serversRoot, dataPath, probePath]);

  async function installMysql() {
    setBusy(true);
    setErr('');
    try {
      await api('/api/setup/mysql-install', { method: 'POST', body: {} });
      loadPreflight();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/setup', {
        method: 'POST',
        body: {
          deploy: 'popular',
          name: name.trim(),
          project: name.trim(),
          recipe,
          port: Number(port),
          maxClients: Number(maxClients),
          onesync,
          locale,
          tags,
          licenseKey: licenseKey.trim(),
          createDatabase,
          dbName: dbName.trim() || undefined,
          mysqlRootPassword,
          startServer: autoStart,
          serversRoot: useCustomPath && !dataPath.trim() ? serversRoot.trim() : undefined,
          dataPath: useCustomPath && dataPath.trim() ? dataPath.trim() : undefined,
          panelAccess: {
            mode: panelMode,
            panelPort: Number(panelPort) || DEFAULT_PANEL_PORT,
            publicHost: panelMode === 'port' ? (panelPublicHost.trim() || panelAccess?.publicIp) : undefined,
            domain: panelMode === 'domain' ? panelDomain.trim() : undefined,
            stack: panelStack,
            https: panelMode === 'domain',
          },
          migrateFromTxAdmin: migrateTxAdmin && txProfiles.length > 0,
          importTxAdminSettings: importTxSettings,
          deactivateTxAdmin,
          importTxAdminBans: importTxBans,
          importTxAdminWarns: importTxWarns,
          importTxAdminWhitelist: importTxWhitelist,
        },
      });
      setResult(data);
      setStep(6);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const canNext = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) {
      const pp = Number(panelPort);
      if (!Number.isFinite(pp) || pp < 1024 || pp > 65535) return false;
      if (panelMode === 'domain') return panelDomain.trim().includes('.');
      return true;
    }
    if (step === 2) {
      if (migrateTxAdmin && txProfiles.length > 0) return true;
      return name.trim().length >= 2 && recipe;
    }
    if (step === 3) {
      const p = Number(port);
      const m = Number(maxClients);
      if (!Number.isFinite(p) || p < 1) return false;
      if (!Number.isFinite(m) || m < 1) return false;
      if (portStatus?.inUse) return false;
      if (portStatus?.orbitConflict) return false;
      if (useCustomPath) {
        const r = serversRoot.trim();
        const d = dataPath.trim();
        if (!r && !d) return false;
        if (!pathStatus || !pathStatus.ok) return false;
      }
      return true;
    }
    if (step === 4) {
      if (createDatabase) return Boolean(preflight?.mysql?.running);
      return true;
    }
    if (step === 5) {
      if (migrateTxAdmin && txProfiles.length > 0) return true;
      return licenseKey.trim().length > 8;
    }
    return false;
  }, [step, name, recipe, port, maxClients, portStatus, pathStatus, useCustomPath, serversRoot, dataPath, preflight, createDatabase, licenseKey, panelMode, panelPort, panelDomain, migrateTxAdmin]);

  const isLastAction = step === 5;

  return (
    <div className="wizard setup-wizard">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="wizard-shell setup-shell">
        <header className="setup-head">
          <div className="brand-link"><Mark /> Orbit</div>
          <p className="eyebrow">Server-Einrichtung</p>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Alles im Panel — nur der Host-Installer bleibt auf der Shell.</p>
        </header>

        <section className="wizard-body setup-body">
          {err && <div className="err">{err}</div>}

          <Stepper
            steps={STEPS}
            step={step}
            onStepChange={setStep}
            canNext={canNext}
            busy={busy}
            showNav={step < 6}
            hideBack={step === 0}
            isLastAction={isLastAction}
            completeLabel="Server aufsetzen & starten"
            onComplete={finish}
            onBack={() => setStep((s) => Math.max(0, s - 1))}
            onNext={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            {step === 0 && (
              <>
                <h1>System-Check</h1>
                <p className="lede">Pfade, FX-Artifact und MySQL — bevor der Server angelegt wird.</p>
                <div className="setup-checks">
                  <CheckRow
                    ok={preflight?.paths?.issues?.length === 0}
                    warn={preflight?.paths?.issues?.length > 0}
                    title="Orbit-Pfade"
                    detail={(preflight?.paths?.ok || []).join(' · ') || 'Lade…'}
                  />
                  {(preflight?.paths?.issues || []).map((i) => (
                    <CheckRow key={i} ok={false} title="Hinweis" detail={i} />
                  ))}
                  <CheckRow
                    ok={preflight?.mysql?.running}
                    warn={preflight?.mysql?.installed && !preflight?.mysql?.running}
                    title="MySQL / MariaDB"
                    detail={preflight?.mysql?.running
                      ? `Dienst aktiv (${preflight.mysql.service || 'mysql'})`
                      : preflight?.mysql?.installed
                        ? 'Installiert, Dienst nicht aktiv'
                        : 'Nicht installiert — im nächsten Schritt Datenbank'}
                  />
                  <CheckRow
                    ok={preflight?.artifact}
                    warn={!preflight?.artifact}
                    title="FX-Artifact"
                    detail={preflight?.artifact ? 'Binary vorhanden oder wird beim Abschluss geladen' : 'Wird beim Abschluss automatisch installiert'}
                  />
                  {txProfiles.length > 0 && (
                    <CheckRow
                      ok
                      title="txAdmin erkannt"
                      detail={`${preflight.txadmin.profiles?.length || 0} Server in txData · Dienste: ${(preflight.txadmin.unitsActive || []).join(', ') || 'Prozess/txData'}`}
                    />
                  )}
                </div>
                {txProfiles.length > 0 && (
                  <div className="panel" style={{ padding: 12, marginTop: 12 }}>
                    <label className="row">
                      <input type="checkbox" checked={migrateTxAdmin} onChange={(e) => setMigrateTxAdmin(e.target.checked)} />
                      Von txAdmin auf Orbit umstellen (Server & Daten übernehmen)
                    </label>
                    {migrateTxAdmin && (
                      <>
                        <label className="row">
                          <input type="checkbox" checked={importTxSettings} onChange={(e) => setImportTxSettings(e.target.checked)} />
                          Einstellungen aus server.cfg ins Panel übernehmen
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={deactivateTxAdmin} onChange={(e) => setDeactivateTxAdmin(e.target.checked)} />
                          txAdmin-Dienst danach stoppen & deaktivieren
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={importTxBans} onChange={(e) => setImportTxBans(e.target.checked)} />
                          Bans aus playersDB.json übernehmen
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={importTxWarns} onChange={(e) => setImportTxWarns(e.target.checked)} />
                          Warns übernehmen
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={importTxWhitelist} onChange={(e) => setImportTxWhitelist(e.target.checked)} />
                          Allowlist (whitelistApprovals) übernehmen
                        </label>
                        <ul className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                          {(preflight.txadmin.profiles || []).map((p) => (
                            <li key={p.dataPath}><b>{p.profile}</b> · {p.hostname} · :{p.port} · <span className="mono">{p.dataPath}</span></li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
                <div className="setup-actions-inline">
                  <button type="button" className="btn btn-sm" onClick={loadPreflight}>Erneut prüfen</button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h1>Panel-Zugang</h1>
                <p className="lede">
                  Wie txAdmin per <code className="mono">IP:Port</code> — Orbit standardmäßig Port {DEFAULT_PANEL_PORT}.
                  Oder eigene Domain mit automatischem Reverse-Proxy (nginx/Apache/Caddy).
                </p>
                <div className="template-list" style={{ marginBottom: 16 }}>
                  <button type="button" className={`template-card${panelMode === 'port' ? ' on' : ''}`} onClick={() => setPanelMode('port')}>
                    <b>IP & Port</b>
                    <span>Direkt erreichbar — z. B. {panelAccess?.txAdminStylePort || `http://…:${DEFAULT_PANEL_PORT}`}</span>
                  </button>
                  <button type="button" className={`template-card${panelMode === 'domain' ? ' on' : ''}`} onClick={() => setPanelMode('domain')}>
                    <b>Domain / HTTPS</b>
                    <span>Eigene URL wie tx2.ky3ls.space — Proxy wird eingerichtet</span>
                  </button>
                </div>
                <label className="field">
                  <span>Panel-Port (intern / bei IP-Zugang)</span>
                  <input className="mono" type="number" min={1024} max={65535} value={panelPort} onChange={(e) => setPanelPort(e.target.value)} />
                </label>
                {panelMode === 'port' && (
                  <label className="field">
                    <span>Öffentliche IP (optional)</span>
                    <input className="mono" placeholder={panelAccess?.publicIp || 'automatisch'} value={panelPublicHost} onChange={(e) => setPanelPublicHost(e.target.value)} />
                  </label>
                )}
                {panelMode === 'domain' && (
                  <>
                    <label className="field">
                      <span>Domain fürs Panel</span>
                      <input className="mono" placeholder="panel.deine-domain.de" value={panelDomain} onChange={(e) => setPanelDomain(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Webserver (Reverse-Proxy)</span>
                      <select value={panelStack} onChange={(e) => setPanelStack(e.target.value)}>
                        <option value="auto">Automatisch ({panelAccess?.suggestedStack || 'nginx'})</option>
                        {(panelAccess?.stacks || []).map((s) => (
                          <option key={s.id} value={s.id} disabled={!s.installed}>
                            {s.label}{s.active ? ' · aktiv' : s.installed ? ' · installiert' : ' · fehlt'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted" style={{ fontSize: 13 }}>
                      DNS muss auf diesen Server zeigen. Beim Abschluss: VHost + systemd-URL.
                      {panelAccess?.stacks?.every((s) => !s.installed) ? ' Kein Webserver erkannt — nginx empfohlen oder IP:Port wählen.' : ''}
                    </p>
                  </>
                )}
                {panelPreview?.previewUrl && (
                  <p className="setup-port-hint ok" style={{ marginTop: 12 }}>
                    Vorschau: <span className="mono">{panelPreview.previewUrl}</span>
                  </p>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <h1>Server & Framework</h1>
                <p className="lede">Name und Recipe-Profil — Ressourcen werden beim Abschluss auf dem Host geholt.</p>
                <label className="field"><span>Servername</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
                <div className="template-list" style={{ marginTop: 16 }}>
                  {FRAMEWORKS.map((f) => (
                    <button key={f.id} type="button" className={`template-card${recipe === f.id ? ' on' : ''}`} onClick={() => setRecipe(f.id)}>
                      <b>{f.title}</b>
                      <span>{f.text}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1>Netzwerk</h1>
                <p className="lede">Game-Port muss frei sein. Jede weitere Instanz später mit anderem Port.</p>
                <div className="row">
                  <label className="field grow"><span>Game-Port</span><input value={port} onChange={(e) => setPort(e.target.value)} /></label>
                  <label className="field grow"><span>Slots</span><input value={maxClients} onChange={(e) => setMaxClients(e.target.value)} /></label>
                </div>
                {portStatus && (
                  <p className={`setup-port-hint ${portStatus.available && !portStatus.orbitConflict ? 'ok' : 'bad'}`}>
                    {portStatus.inUse && 'Port ist belegt (Prozess lauscht bereits).'}
                    {!portStatus.inUse && portStatus.orbitConflict && `Reserviert für „${portStatus.orbitConflict.name}“.`}
                    {portStatus.available && !portStatus.orbitConflict && 'Port ist frei.'}
                  </p>
                )}
                <label className="field"><span>OneSync</span>
                  <select value={onesync} onChange={(e) => setOnesync(e.target.value)}>
                    <option value="on">Infinity</option>
                    <option value="legacy">Legacy</option>
                    <option value="off">Aus</option>
                  </select>
                </label>
                <label className="field"><span>Locale</span><input value={locale} onChange={(e) => setLocale(e.target.value)} /></label>
                <label className="field"><span>Tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
                <label className="row" style={{ marginTop: 16 }}>
                  <input
                    type="checkbox"
                    checked={useCustomPath}
                    onChange={(e) => {
                      setUseCustomPath(e.target.checked);
                      if (!e.target.checked) setPathStatus(null);
                    }}
                  />
                  Eigenen Server-Datenordner festlegen
                </label>
                {useCustomPath && (
                  <div className="panel" style={{ padding: 12, marginTop: 8 }}>
                    <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                      Standard: <code className="mono">{preflight?.defaultServersRoot || '/opt/orbit/servers'}</code>/&lt;slug&gt;
                    </p>
                    <label className="field">
                      <span>Basisordner (Unterordner pro Server)</span>
                      <input
                        className="mono"
                        placeholder={preflight?.serversRoot || preflight?.defaultServersRoot || '/opt/orbit/servers'}
                        value={serversRoot}
                        onChange={(e) => setServersRoot(e.target.value)}
                        disabled={Boolean(dataPath.trim())}
                      />
                    </label>
                    <label className="field">
                      <span>Oder exakter Datenpfad (ohne Unterordner)</span>
                      <input
                        className="mono"
                        placeholder="/opt/fivem/live"
                        value={dataPath}
                        onChange={(e) => setDataPath(e.target.value)}
                      />
                    </label>
                    {pathStatus && (
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        {(pathStatus.issues || []).map((i) => (
                          <p key={i} className="setup-port-hint bad">{i}</p>
                        ))}
                        {(pathStatus.warnings || []).map((w) => (
                          <p key={w} className="setup-port-hint ok">{w}</p>
                        ))}
                        {pathStatus.ok && !(pathStatus.warnings || []).length && (
                          <p className="setup-port-hint ok">Pfad ist nutzbar.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 4 && (
              <>
                <h1>Datenbank</h1>
                <p className="lede">MariaDB für ESX/QB. Orbit kann Server und Datenbank anlegen.</p>
                {!preflight?.mysql?.running && (
                  <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
                    <p className="muted" style={{ fontSize: 13 }}>MariaDB fehlt oder läuft nicht. Installation braucht <code className="mono">sudo</code> für User <code className="mono">tx2</code>.</p>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={installMysql}>MariaDB installieren</button>
                  </div>
                )}
                <label className="row">
                  <input type="checkbox" checked={createDatabase} onChange={(e) => setCreateDatabase(e.target.checked)} />
                  Datenbank automatisch anlegen
                </label>
                {createDatabase && (
                  <>
                    <label className="field"><span>Datenbankname</span>
                      <input className="mono" placeholder={`orbit_${name.toLowerCase().replace(/\W+/g, '_').slice(0, 20)}`} value={dbName} onChange={(e) => setDbName(e.target.value)} />
                    </label>
                    <label className="field"><span>MySQL root-Passwort (optional)</span>
                      <input type="password" value={mysqlRootPassword} onChange={(e) => setMysqlRootPassword(e.target.value)} placeholder="Leer = sudo mysql auf dem Host" autoComplete="new-password" />
                    </label>
                  </>
                )}
              </>
            )}

            {step === 5 && (
              <>
                <h1>Keys & Start</h1>
                <p className="lede">Cfx.re License und optional direkter FX-Start nach dem Setup.</p>
                <label className="field"><span>sv_licenseKey</span>
                  <input type="password" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="cfxk_…" autoComplete="off" />
                </label>
                <label className="row">
                  <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                  FXServer nach Einrichtung starten (Orbit-Prozess)
                </label>
                <article className="panel setup-summary" style={{ marginTop: 16, padding: 12 }}>
                  <div className="res-line"><span>Server</span><b>{name}</b></div>
                  <div className="res-line"><span>Framework</span><b>{recipe}</b></div>
                  <div className="res-line"><span>Game-Port</span><b>{port}</b></div>
                  <div className="res-line">
                    <span>Panel-URL</span>
                    <b className="mono" style={{ fontSize: 12 }}>{panelPreview?.previewUrl || '—'}</b>
                  </div>
                  <div className="res-line">
                    <span>Datenordner</span>
                    <b className="mono" style={{ fontSize: 12 }}>
                      {useCustomPath
                        ? (dataPath.trim() || `${serversRoot.trim() || preflight?.defaultServersRoot || '/opt/orbit/servers'}/<slug>`)
                        : `${preflight?.defaultServersRoot || '/opt/orbit/servers'}/<slug>`}
                    </b>
                  </div>
                  <div className="res-line"><span>DB</span><b>{createDatabase ? (dbName || 'auto') : 'manuell'}</b></div>
                </article>
              </>
            )}

            {step === 6 && result && (
              <>
                <h1>Fertig</h1>
                <p className="lede">
                  {result.serverStarted
                    ? 'Server wurde aufgesetzt und gestartet.'
                    : 'Server wurde aufgesetzt.'}
                </p>
                {result.serverStarted && <Badge tone="ok">FX läuft</Badge>}
                {result.panelUrl && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                    Panel: <a className="mono" href={result.panelUrl}>{result.panelUrl}</a>
                    {result.panelRestart ? ' · Dienst wird neu gestartet…' : ''}
                  </p>
                )}
                {result.dataPath && (
                  <p className="muted mono" style={{ fontSize: 13, marginTop: 12 }}>{result.dataPath}</p>
                )}
                {(result.nextSteps || []).length > 0 && (
                  <ul className="muted" style={{ marginTop: 12 }}>
                    {result.nextSteps.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                )}
                <div className="row" style={{ gap: 8, marginTop: 20 }}>
                  <a className="btn btn-primary" style={{ width: 'auto', display: 'inline-flex' }} href="/panel">Zum Cockpit</a>
                  <a className="btn" style={{ width: 'auto', display: 'inline-flex' }} href="/settings?tab=servers">Einstellungen</a>
                </div>
              </>
            )}
          </Stepper>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import SettingsHostPanel from '../components/SettingsHostPanel.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import OrbitSelect from '../components/OrbitSelect.jsx';
import { useAppearance } from '../hooks/useAppearance.js';
import { ACCENT_PRESETS } from '../appearance.js';
import { GAME_BUILD_OPTIONS, ONESYNC_OPTIONS } from './settingsOptions.js';
import { BAN_DURATION_PRESETS, banDurationLabel } from './banPresets.js';

const HOST_TABS = new Set(['servers', 'artifacts', 'prod']);

const SECTIONS = [
  { id: 'appearance', label: 'Aussehen', hint: 'UI & Konsole', owner: false },
  { id: 'server', label: 'Game Server', hint: 'server.cfg', owner: false },
  { id: 'moderation', label: 'Moderation', hint: 'Ban-Vorlagen', owner: false, admin: true },
  { id: 'host', label: 'Host', hint: 'Builds & Instanzen', owner: true },
  { id: 'fx', label: 'FX & Orbit', hint: 'Prozess & RCON', owner: true },
  { id: 'discord', label: 'Discord', hint: 'Webhook & Bot', owner: true },
  { id: 'account', label: 'Account', hint: 'Passwort & 2FA', owner: false },
  { id: 'danger', label: 'Gefahrenzone', hint: 'Wipe & Deinstall', owner: true },
];

function ModuleCard({ title, lead, children, actions, wide }) {
  return (
    <article className={`st-mod${wide ? ' st-wide' : ''}`}>
      {(title || lead || actions) && (
        <header className="st-mod-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {lead ? <p>{lead}</p> : null}
          </div>
          {actions ? <div className="st-mod-actions">{actions}</div> : null}
        </header>
      )}
      <div className="st-mod-body">{children}</div>
    </article>
  );
}

function FieldRow({ children }) {
  return <div className="st-fields">{children}</div>;
}

function SegControl({ label, value, options, onChange, ariaLabel }) {
  return (
    <div className="st-row">
      {label ? <span className="st-row-label">{label}</span> : null}
      <div className="st-seg" role="group" aria-label={ariaLabel || label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`st-seg-btn${value === o.value ? ' active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {o.hint ? <small>{o.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings({ user, onUser, onSetupReset }) {
  const [form, setForm] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState(null);
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState([]);
  const [params, setParams] = useSearchParams();
  const [msg, setMsg] = useState(
    params.get('cfx') === 'ok'
      ? 'Cfx.re ist verbunden.'
      : params.get('cfx') === 'taken'
        ? 'Dieses Cfx.re-Konto ist schon vergeben.'
        : '',
  );
  const [err, setErr] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplReason, setTplReason] = useState('');
  const [tplDuration, setTplDuration] = useState('2d');
  const [tplBusy, setTplBusy] = useState(false);
  const hostTab = HOST_TABS.has(params.get('tab')) ? params.get('tab') : 'servers';
  const [prefs, setAppearance] = useAppearance();

  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const nav = useMemo(
    () => SECTIONS.filter((s) => {
      if (s.owner && !isOwner) return false;
      if (s.admin && !isAdmin) return false;
      return true;
    }),
    [isOwner, isAdmin],
  );

  const sectionParam = params.get('section');
  const section = nav.some((s) => s.id === sectionParam)
    ? sectionParam
    : (HOST_TABS.has(params.get('tab')) ? 'host' : 'appearance');

  function setSection(id) {
    const next = new URLSearchParams(params);
    next.set('section', id);
    if (id !== 'host') next.delete('tab');
    setParams(next, { replace: true });
  }

  function load() {
    api('/api/settings').then((d) => setForm(d.settings)).catch((e) => setErr(e.message));
    api('/api/sessions').then((d) => setSessions(d.sessions)).catch(() => {});
  }

  function loadTemplates() {
    api('/api/ban-templates')
      .then((d) => setTemplates(d.templates || []))
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (section === 'moderation' && isAdmin) loadTemplates();
  }, [section, isAdmin]);

  async function addTemplate(e) {
    e.preventDefault();
    setTplBusy(true);
    setErr('');
    try {
      await api('/api/ban-templates', {
        method: 'POST',
        body: { reason: tplReason, durationId: tplDuration },
      });
      setTplReason('');
      setTplDuration('2d');
      setMsg('Ban-Vorlage gespeichert.');
      loadTemplates();
    } catch (error) {
      setErr(error.message);
    }
    setTplBusy(false);
  }

  async function removeTemplate(id) {
    setTplBusy(true);
    setErr('');
    try {
      await api(`/api/ban-templates/${id}`, { method: 'DELETE' });
      loadTemplates();
    } catch (error) {
      setErr(error.message);
    }
    setTplBusy(false);
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      await api('/api/settings', { method: 'PUT', body: form });
      setMsg('Gespeichert — OneSync / Game Build in server.cfg übernommen (Neustart ggf. nötig).');
    } catch (error) {
      setErr(error.message);
    }
  }

  async function password(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/auth/password', { method: 'POST', body: pw });
      setMsg('Passwort geändert. Andere Sitzungen sind ungültig.');
      onUser({ ...user, mustChange: false });
      setPw({ current: '', next: '' });
    } catch (error) {
      setErr(error.message);
    }
  }

  if (!form) {
    return <Page>{err ? <div className="err">{err}</div> : <p className="muted">Lade…</p>}</Page>;
  }

  const set = (patch) => setForm({ ...form, ...patch });
  const activeMeta = nav.find((s) => s.id === section);

  const aside = (
    <nav className="st-nav" aria-label="Einstellungs-Bereiche">
      {nav.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`st-nav-item${section === s.id ? ' active' : ''}${s.id === 'danger' ? ' danger' : ''}`}
          onClick={() => setSection(s.id)}
        >
          <span className="st-nav-label">{s.label}</span>
          <span className="st-nav-hint">{s.hint}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <Page className="settings-page">
      <PageHeader
        eyebrow="System"
        title="Einstellungen"
        description={activeMeta ? `${activeMeta.label} — ${activeMeta.hint}` : 'FiveM, Host und Account getrennt konfigurieren.'}
      />
      {err && <div className="err">{err}</div>}
      {msg && <div className="banner">{msg}</div>}

      <div className="st-shell">
        {aside}
        <div className="st-main">
        {section === 'appearance' && (
          <div className="st-stack">
            <ModuleCard title="Oberfläche" lead="Pro Account — gilt auf jedem Gerät nach Login.">
              <SegControl
                label="Navigation"
                value={prefs.navLayout}
                onChange={(v) => setAppearance({ navLayout: v })}
                options={[
                  { value: 'sidebar', label: 'Sidebar', hint: 'Links' },
                  { value: 'dock', label: 'Toolbar', hint: 'Unten' },
                ]}
              />
              <SegControl
                label="Schema"
                value={prefs.theme}
                onChange={(v) => setAppearance({ theme: v })}
                options={[
                  { value: 'dark', label: 'Dunkel' },
                  { value: 'light', label: 'Hell' },
                ]}
              />
              <div className="st-row st-row-wrap">
                <span className="st-row-label">Akzent</span>
                <div className="st-accents" role="group" aria-label="Akzentfarbe">
                  {Object.values(ACCENT_PRESETS).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`st-accent${prefs.accent === c.id ? ' active' : ''}`}
                      style={{ ['--swatch']: c.hex }}
                      title={c.label}
                      aria-label={c.label}
                      aria-pressed={prefs.accent === c.id}
                      onClick={() => setAppearance({ accent: c.id })}
                    >
                      <i />
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </ModuleCard>

            <ModuleCard title="Konsolen-Filter" lead="Was in der Live-Konsole sichtbar ist.">
              <div className="st-chips" role="group" aria-label="Konsolen-Filter">
                {[
                  { key: 'showInfo', label: 'Infos' },
                  { key: 'showWarn', label: 'Warnings' },
                  { key: 'showBad', label: 'Errors' },
                  { key: 'showOk', label: 'OK' },
                  { key: 'hideAssetSpam', label: 'Asset-Spam aus' },
                ].map((t) => {
                  const on = prefs.console?.[t.key] !== false;
                  return (
                    <label key={t.key} className={`st-chip${on ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setAppearance({ console: { [t.key]: e.target.checked } })}
                      />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            </ModuleCard>
          </div>
        )}

        {section === 'moderation' && isAdmin && (
          <div className="st-stack">
            <ModuleCard
              title="Ban-Vorlagen"
              lead="Vorlagen erscheinen beim Sperren eines Spielers. Grund und Dauer werden vorausgefüllt."
            >
              <form className="st-fields st-fields-1" onSubmit={addTemplate}>
                <label className="field">
                  <span>Grund</span>
                  <input
                    value={tplReason}
                    onChange={(e) => setTplReason(e.target.value)}
                    placeholder="z. B. RDM / FailRP"
                    required
                    minLength={3}
                  />
                </label>
                <OrbitSelect
                  label="Dauer"
                  value={tplDuration}
                  onChange={setTplDuration}
                  options={BAN_DURATION_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                />
                <div>
                  <button type="submit" className="btn btn-primary" disabled={tplBusy || tplReason.trim().length < 3}>
                    {tplBusy ? '…' : 'Vorlage hinzufügen'}
                  </button>
                </div>
              </form>

              {templates.length === 0 ? (
                <p className="muted" style={{ marginTop: 16 }}>Noch keine Vorlagen — oben anlegen.</p>
              ) : (
                <ul className="st-tpl-list">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <div>
                        <strong>{t.reason}</strong>
                        <span className="muted">{banDurationLabel(t.duration_id)}</span>
                      </div>
                      <button type="button" className="btn btn-sm" disabled={tplBusy} onClick={() => removeTemplate(t.id)}>
                        Löschen
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ModuleCard>
          </div>
        )}

        {section === 'server' && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              wide
              title="Identität & Slots"
              lead="Werte landen in der aktiven server.cfg."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <FieldRow>
                <label className="field"><span>Anzeigename</span><input value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} /></label>
                <label className="field"><span>Projekt</span><input value={form.project} onChange={(e) => set({ project: e.target.value })} /></label>
                <label className="field"><span>Slots</span><input type="number" min={1} max={2048} value={form.maxClients} onChange={(e) => set({ maxClients: e.target.value })} /></label>
                <label className="field"><span>Locale</span><input value={form.locale || 'de-DE'} onChange={(e) => set({ locale: e.target.value })} /></label>
                <label className="field st-span-2"><span>Tags</span><input value={form.tags || ''} onChange={(e) => set({ tags: e.target.value })} placeholder="roleplay, german, …" /></label>
              </FieldRow>
            </ModuleCard>

            <ModuleCard title="Sync & Build">
              <div className="st-fields st-fields-1">
                <label className="field">
                  <span>OneSync</span>
                  <select value={form.onesync || 'on'} onChange={(e) => set({ onesync: e.target.value })}>
                    {ONESYNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Game Build</span>
                  <select value={form.gameBuild || ''} onChange={(e) => set({ gameBuild: e.target.value })}>
                    {GAME_BUILD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            </ModuleCard>

            <ModuleCard title="Verbindung" lead="FiveM läuft lokal — Host bleibt 127.0.0.1.">
              <div className="st-fields st-fields-1">
                <label className="field"><span>Host</span><input value={form.fivemHost} onChange={(e) => set({ fivemHost: e.target.value })} readOnly /></label>
                <label className="field"><span>Port</span><input value={form.fivemPort} onChange={(e) => set({ fivemPort: e.target.value })} /></label>
              </div>
              <label className="row st-check">
                <input type="checkbox" checked={!!form.allowlistEnabled} onChange={(e) => set({ allowlistEnabled: e.target.checked })} />
                Allowlist-Modus (Spieler-Whitelist)
              </label>
              {isOwner && (
                <label className="field">
                  <span>IP-Allowlist (Panel)</span>
                  <textarea placeholder="Leer = alle. Eine IP pro Zeile." value={form.ipAllowlist} onChange={(e) => set({ ipAllowlist: e.target.value })} rows={3} />
                </label>
              )}
            </ModuleCard>

            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">FiveM speichern</button>
              {isOwner && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => api('/api/settings/rescan', { method: 'POST', body: {} })
                    .then((d) => { load(); setMsg(`CFG gelesen · ${d.count} Ressourcen.`); })
                    .catch((e) => setErr(e.message))}
                >
                  Aus server.cfg laden
                </button>
              )}
            </div>
          </form>
        )}

        {section === 'host' && isOwner && (
          <div className="st-stack">
            <ModuleCard wide title="Host & Instanzen" lead="FX-Builds, weitere Server und Prod.">
              {form.orbitServerName ? (
                <p className="st-meta">
                  Aktiv: <b>{form.orbitServerName}</b>
                  {' · '}
                  <span className="mono">{form.fxDataPath}</span>
                  {' · '}
                  Basis: <span className="mono">{form.orbitServersRoot || '/opt/orbit/servers'}</span>
                </p>
              ) : null}
              <SettingsHostPanel initialTab={hostTab} onMessage={setMsg} onError={setErr} />
            </ModuleCard>
          </div>
        )}

        {section === 'fx' && isOwner && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              title="Steuerung"
              lead="Prozess und Pfade — nicht in der server.cfg."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <label className="field">
                <span>Steuerungsmodus</span>
                <select value={form.fxControlMode || 'systemd'} onChange={(e) => set({ fxControlMode: e.target.value })}>
                  <option value="systemd">systemd (bestehender Dienst)</option>
                  <option value="orbit">Orbit startet FXServer selbst</option>
                </select>
              </label>
              {form.fxControlMode === 'orbit' && (
                <div className="st-fields st-fields-1">
                  <label className="field"><span>FXServer-Root</span><input value={form.fxServerRoot || ''} onChange={(e) => set({ fxServerRoot: e.target.value })} placeholder="/opt/orbit/artifacts/…" /></label>
                  <label className="field"><span>Datenpfad</span><input value={form.fxDataPath || ''} onChange={(e) => set({ fxDataPath: e.target.value })} /></label>
                  <label className="field"><span>Zusatz-Argumente</span><input value={form.fxServerExtraArgs || ''} onChange={(e) => set({ fxServerExtraArgs: e.target.value })} placeholder="optional" /></label>
                </div>
              )}
              <p className="st-meta">
                Konsole: {form.fxCommandReady ? <b className="ok">bereit</b> : <b className="bad">offline</b>}
                {' · '}
                MySQL: {form.mysqlReady ? <b className="ok">CFG</b> : <b className="bad">fehlt</b>}
              </p>
            </ModuleCard>

            <ModuleCard title="RCON">
              <div className="st-fields st-fields-1">
                <label className="field"><span>Port</span><input value={form.rconPort || ''} onChange={(e) => set({ rconPort: e.target.value })} placeholder={form.fivemPort || '30120'} /></label>
                <label className="field"><span>Passwort</span><input type="password" value={form.rconPassword || ''} onChange={(e) => set({ rconPassword: e.target.value })} placeholder={form.rconConfigured ? 'leer lassen' : 'eintragen'} autoComplete="new-password" /></label>
              </div>
              <label className="row st-check">
                <input type="checkbox" checked={form.autoRestartEnabled !== false} onChange={(e) => set({ autoRestartEnabled: e.target.checked })} />
                Bei Crash immer neu starten
              </label>
            </ModuleCard>

            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">FX speichern</button>
              <button className="btn" type="button" onClick={() => api('/api/settings/rcon-test', { method: 'POST', body: {} }).then((d) => setMsg(d.message || 'RCON OK')).catch((e) => setErr(e.message))}>RCON testen</button>
            </div>
          </form>
        )}

        {section === 'discord' && isOwner && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              title="Webhook"
              lead="Start/Stop und optional Player-Drops — kein Bot nötig."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <div className="st-chips">
                <label className={`st-chip${form.discordEnabled ? ' on' : ''}`}>
                  <input type="checkbox" checked={!!form.discordEnabled} onChange={(e) => set({ discordEnabled: e.target.checked })} />
                  Aktiv
                </label>
                <label className={`st-chip${form.discordNotifyDrops === '1' || form.discordNotifyDrops === true ? ' on' : ''}`}>
                  <input type="checkbox" checked={form.discordNotifyDrops === '1' || form.discordNotifyDrops === true} onChange={(e) => set({ discordNotifyDrops: e.target.checked ? '1' : '0' })} />
                  Disconnects
                </label>
              </div>
              <div className="st-fields st-fields-1">
                <label className="field"><span>Webhook-URL</span><input value={form.discordWebhook || ''} onChange={(e) => set({ discordWebhook: e.target.value })} /></label>
                <label className="field"><span>Guild-ID</span><input value={form.discordGuild || ''} onChange={(e) => set({ discordGuild: e.target.value })} /></label>
              </div>
            </ModuleCard>

            <ModuleCard title="Bot (optional)">
              <label className={`st-chip${form.discordBotEnabled ? ' on' : ''}`}>
                <input type="checkbox" checked={!!form.discordBotEnabled} onChange={(e) => set({ discordBotEnabled: e.target.checked })} />
                Slash-Commands
              </label>
              <label className="field">
                <span>Bot-Token</span>
                <input type="password" value={form.discordBotToken || ''} onChange={(e) => set({ discordBotToken: e.target.value })} placeholder={form.discordBotConfigured ? 'leer = behalten' : 'Bot-Token'} autoComplete="new-password" />
              </label>
            </ModuleCard>

            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">Discord speichern</button>
              <button type="button" className="btn" onClick={() => api('/api/platform/discord-test', { method: 'POST', body: {} }).then(() => setMsg('Discord-Test gesendet.')).catch((e) => setErr(e.message))}>Webhook testen</button>
            </div>
          </form>
        )}

        {section === 'account' && (
          <div className="st-stack">
            <ModuleCard title="Passwort">
              <form onSubmit={password}>
                <div className="st-fields st-fields-1">
                  <label className="field"><span>Aktuell</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
                  <label className="field"><span>Neu</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
                </div>
                <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>Passwort ändern</button>
              </form>
            </ModuleCard>

            <ModuleCard title="Cfx.re" lead="Login-Verknüpfung — erstellt keine neuen Admins.">
              {user.cfxName ? (
                <div className="st-inline">
                  <b>{user.cfxName}</b>
                  <button className="btn btn-sm" type="button" onClick={() => api('/api/auth/cfx/unlink', { method: 'POST', body: {} }).then(() => { onUser({ ...user, cfxName: '' }); setMsg('Cfx.re getrennt.'); }).catch((e) => setErr(e.message))}>Trennen</button>
                </div>
              ) : (
                <a className="btn cfx" href="/api/auth/cfx/start?mode=link">Mit Cfx.re verbinden</a>
              )}
            </ModuleCard>

            <ModuleCard title="Zwei-Faktor">
              {!totp ? (
                <button className="btn" type="button" onClick={() => api('/api/auth/totp/setup', { method: 'POST', body: {} }).then(setTotp)}>Einrichten</button>
              ) : (
                <>
                  <p className="mono">{totp.secret}</p>
                  <div className="st-inline">
                    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                    <button className="btn btn-primary" type="button" onClick={() => api('/api/auth/totp/enable', { method: 'POST', body: { code } }).then(() => { setMsg('2FA aktiv.'); onUser({ ...user, totp: true }); }).catch((e) => setErr(e.message))}>Aktivieren</button>
                  </div>
                </>
              )}
            </ModuleCard>

            <ModuleCard title="Sitzungen">
              <ul className="st-sessions">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <span>{s.ip} · {fmtFull(s.last_seen)}{s.current ? ' · diese' : ''}</span>
                    {!s.current && (
                      <button className="btn btn-sm" type="button" onClick={() => api(`/api/sessions/${s.id}`, { method: 'DELETE' }).then(load)}>Beenden</button>
                    )}
                  </li>
                ))}
              </ul>
            </ModuleCard>
          </div>
        )}

        {section === 'danger' && isOwner && (
          <div className="st-stack">
            <ModuleCard title="Neu einrichten" lead="Stoppt FX, löscht Server-Ordner, öffnet den Setup-Wizard.">
              <button
                type="button"
                className="btn btn-primary"
                disabled={resetBusy}
                onClick={async () => {
                  if (!window.confirm('FX stoppen und ALLE Server-Ordner löschen, dann Setup starten?')) return;
                  if (!window.confirm('Wirklich alles löschen und neu einrichten?')) return;
                  setResetBusy(true);
                  setErr('');
                  try {
                    const res = await api('/api/settings/reset-setup', {
                      method: 'POST',
                      body: { confirm: true, wipe: true },
                    });
                    setMsg(`Gelöscht: ${(res.deleted || []).length} Ordner — Setup startet…`);
                    onSetupReset?.({ redirect: '/setup', wipe: true });
                  } catch (e) {
                    setErr(e.message || 'Löschen fehlgeschlagen');
                  } finally {
                    setResetBusy(false);
                  }
                }}
              >
                {resetBusy ? 'Lösche…' : 'Alles löschen & Setup starten'}
              </button>
            </ModuleCard>

            <ModuleCard title="Orbit deinstallieren" lead="Panel, Dienst und Installation weg. Kein Setup danach — nur neu per Install-Skript.">
              <button
                type="button"
                className="btn btn-danger"
                disabled={resetBusy}
                onClick={async () => {
                  const phrase = window.prompt('Zum Bestätigen exakt eingeben: ORBIT LÖSCHEN');
                  if (phrase == null) return;
                  if (String(phrase).trim().toUpperCase() !== 'ORBIT LÖSCHEN') {
                    setErr('Abgebrochen — Phrase falsch.');
                    return;
                  }
                  if (!window.confirm('Orbit jetzt unwiderruflich deinstallieren? Das Panel geht offline.')) return;
                  setResetBusy(true);
                  setErr('');
                  try {
                    const res = await api('/api/settings/uninstall', {
                      method: 'POST',
                      body: { confirmPhrase: 'ORBIT LÖSCHEN' },
                    });
                    setMsg(res.message || 'Deinstallation läuft…');
                    window.setTimeout(() => { window.location.href = 'about:blank'; }, 2500);
                  } catch (e) {
                    setErr(e.message || 'Deinstallation fehlgeschlagen');
                    setResetBusy(false);
                  }
                }}
              >
                {resetBusy ? '…' : 'Orbit komplett deinstallieren'}
              </button>
            </ModuleCard>
          </div>
        )}
        </div>
      </div>
    </Page>
  );
}

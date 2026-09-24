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
  { id: 'general', label: 'Allgemein', hint: 'Name & Sprache', owner: false },
  { id: 'fxserver', label: 'FXServer', hint: 'Prozess & Pfade', owner: true },
  { id: 'bans', label: 'Bans', hint: 'Prüfung & Vorlagen', owner: false, admin: true },
  { id: 'allowlist', label: 'Allowlist', hint: 'Zugangskontrolle', owner: false, admin: true },
  { id: 'discord', label: 'Discord', hint: 'Webhook & Bot', owner: true },
  { id: 'game', label: 'Spiel', hint: 'Menü & Notifs', owner: false, admin: true },
  { id: 'system', label: 'System', hint: 'Clean & Backup', owner: true },
  { id: 'appearance', label: 'Aussehen', hint: 'UI & Konsole', owner: false },
  { id: 'host', label: 'Host', hint: 'Builds & Instanzen', owner: true },
  { id: 'account', label: 'Account', hint: 'Passwort & 2FA', owner: false },
  { id: 'danger', label: 'Gefahrenzone', hint: 'Wipe & Deinstall', owner: true },
];

const ALLOWLIST_MODES = [
  { value: 'disabled', label: 'Deaktiviert (öffentlich)' },
  { value: 'admin_only', label: 'Nur Admins (Wartung)' },
  { value: 'discord_member', label: 'Discord-Mitglied' },
  { value: 'discord_roles', label: 'Discord-Rollen' },
  { value: 'approved_license', label: 'Freigeschaltete License' },
  { value: 'external', label: 'Externe Allowlist-Resource' },
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

function Toggle({ checked, onChange, onLabel = 'An', offLabel = 'Aus' }) {
  return (
    <label className={`st-chip${checked ? ' on' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {checked ? onLabel : offLabel}
    </label>
  );
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
  const [cleanOpts, setCleanOpts] = useState(null);
  const [cleanForm, setCleanForm] = useState({ players: '60d', bans: 'revoked', warns: '30d', hwids: 'none' });
  const [sysBusy, setSysBusy] = useState(false);
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
  const legacyMap = { server: 'general', moderation: 'bans', fx: 'fxserver' };
  const mapped = legacyMap[sectionParam] || sectionParam;
  const section = nav.some((s) => s.id === mapped)
    ? mapped
    : (HOST_TABS.has(params.get('tab')) ? 'host' : 'general');

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
    if (section === 'bans' && isAdmin) loadTemplates();
  }, [section, isAdmin]);
  useEffect(() => {
    if (section === 'system' && isOwner) {
      api('/api/system/options').then((d) => {
        setCleanOpts(d.clean);
        if (d.clean?.players?.[4]) setCleanForm((f) => ({ ...f, players: d.clean.players[4].value }));
      }).catch(() => {});
    }
  }, [section, isOwner]);

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
      setMsg('Gespeichert.');
      load();
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
  const modes = form.allowlistModes?.length ? form.allowlistModes : ALLOWLIST_MODES;

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
        description={activeMeta ? `${activeMeta.label} — ${activeMeta.hint}` : 'Orbit-Server und Panel konfigurieren.'}
      />
      {err && <div className="err">{err}</div>}
      {msg && <div className="banner">{msg}</div>}

      <div className="st-shell">
        {aside}
        <div className="st-main">

        {section === 'general' && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              wide
              title="Allgemein"
              lead="Kurzer Panel-/Discord-Name und Sprache für Nachrichten."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <FieldRow>
                <label className="field">
                  <span>Server-Name <em className="req">Pflicht</em></span>
                  <input
                    value={form.serverName || ''}
                    maxLength={18}
                    required
                    onChange={(e) => set({ serverName: e.target.value })}
                    placeholder="Kurzname (1–18)"
                  />
                </label>
                <label className="field">
                  <span>Sprache <em className="req">Pflicht</em></span>
                  <select
                    value={form.language || form.locale || 'de-DE'}
                    onChange={(e) => set({ language: e.target.value, locale: e.target.value })}
                  >
                    <option value="de-DE">Deutsch</option>
                    <option value="en">English (default)</option>
                    <option value="fr">Français</option>
                    <option value="es">Español</option>
                    <option value="pt">Português</option>
                    <option value="nl">Nederlands</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </FieldRow>
            </ModuleCard>
            <ModuleCard wide title="Server-Identität" lead="Werte landen in der aktiven server.cfg.">
              <FieldRow>
                <label className="field"><span>Anzeigename (hostname)</span><input value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} /></label>
                <label className="field"><span>Projekt</span><input value={form.project} onChange={(e) => set({ project: e.target.value })} /></label>
                <label className="field"><span>Slots</span><input type="number" min={1} max={2048} value={form.maxClients} onChange={(e) => set({ maxClients: e.target.value })} /></label>
                <label className="field"><span>Tags</span><input value={form.tags || ''} onChange={(e) => set({ tags: e.target.value })} placeholder="roleplay, german, …" /></label>
                <label className="field"><span>Game Build</span>
                  <select value={form.gameBuild || ''} onChange={(e) => set({ gameBuild: e.target.value })}>
                    {GAME_BUILD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field"><span>Port</span><input value={form.fivemPort} onChange={(e) => set({ fivemPort: e.target.value })} /></label>
              </FieldRow>
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">Allgemein speichern</button>
            </div>
          </form>
        )}

        {section === 'fxserver' && isOwner && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              wide
              title="FXServer"
              lead="Datenordner, Start und erweiterte Optionen."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <label className="field">
                <span>Steuerungsmodus</span>
                <select value={form.fxControlMode || 'systemd'} onChange={(e) => set({ fxControlMode: e.target.value })}>
                  <option value="systemd">systemd (bestehender Dienst)</option>
                  <option value="orbit">Orbit startet FXServer selbst</option>
                </select>
              </label>
              <FieldRow>
                <label className="field st-span-2">
                  <span>Server-Datenordner</span>
                  <input value={form.fxDataPath || ''} onChange={(e) => set({ fxDataPath: e.target.value })} placeholder="/opt/orbit/servers/…" />
                </label>
                <label className="field">
                  <span>CFG-Pfad</span>
                  <input value={form.fxCfgPath || 'server.cfg'} onChange={(e) => set({ fxCfgPath: e.target.value })} />
                </label>
                <label className="field">
                  <span>Startup-Argumente</span>
                  <input value={form.fxServerExtraArgs || ''} onChange={(e) => set({ fxServerExtraArgs: e.target.value })} placeholder="optional" />
                </label>
                <label className="field">
                  <span>FXServer-Root</span>
                  <input value={form.fxServerRoot || ''} onChange={(e) => set({ fxServerRoot: e.target.value })} />
                </label>
                <label className="field">
                  <span>OneSync</span>
                  <select value={form.onesync || 'on'} onChange={(e) => set({ onesync: e.target.value })}>
                    {ONESYNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Resource-Start-Toleranz</span>
                  <select value={form.resourceStartingTolerance || '90'} onChange={(e) => set({ resourceStartingTolerance: e.target.value })}>
                    <option value="60">1 Minute</option>
                    <option value="90">1,5 Minuten (Standard)</option>
                    <option value="120">2 Minuten</option>
                    <option value="180">3 Minuten</option>
                    <option value="300">5 Minuten</option>
                  </select>
                </label>
              </FieldRow>
              <div className="st-chips" style={{ marginTop: 12 }}>
                <Toggle checked={!!form.quietMode} onChange={(v) => set({ quietMode: v })} onLabel="Quiet Mode an" offLabel="Quiet Mode aus" />
                <Toggle checked={form.fxAutostart !== false} onChange={(v) => set({ fxAutostart: v })} onLabel="Autostart an" offLabel="Autostart aus" />
                <Toggle checked={form.autoRestartEnabled !== false} onChange={(v) => set({ autoRestartEnabled: v })} onLabel="Crash-Restart an" offLabel="Crash-Restart aus" />
              </div>
              <p className="st-meta" style={{ marginTop: 8 }}>
                Quiet Mode: FX-Ausgabe nur in der Live-Konsole, nicht im Host-Terminal/Journal von Orbit.
                Resource-Start-Toleranz: wenn der Endpunkt nach der Zeit nicht online ist (oder „failed to start in time“), wird neu gestartet.
              </p>
            </ModuleCard>
            <ModuleCard title="RCON">
              <div className="st-fields st-fields-1">
                <label className="field"><span>Port</span><input value={form.rconPort || ''} onChange={(e) => set({ rconPort: e.target.value })} placeholder={form.fivemPort || '30120'} /></label>
                <label className="field"><span>Passwort</span><input type="password" value={form.rconPassword || ''} onChange={(e) => set({ rconPassword: e.target.value })} placeholder={form.rconConfigured ? 'leer lassen' : 'eintragen'} autoComplete="new-password" /></label>
              </div>
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">FX speichern</button>
              <button className="btn" type="button" onClick={() => api('/api/settings/rcon-test', { method: 'POST', body: {} }).then((d) => setMsg(d.message || 'RCON OK')).catch((e) => setErr(e.message))}>RCON testen</button>
            </div>
          </form>
        )}

        {section === 'bans' && isAdmin && (
          <div className="st-stack">
            <form onSubmit={save}>
              <ModuleCard
                title="Ban-Prüfung"
                lead="Beim Join gegen die Orbit-Banliste prüfen."
                actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
              >
                <Toggle checked={form.banChecking !== false} onChange={(v) => set({ banChecking: v })} onLabel="Prüfung an" offLabel="Prüfung aus" />
                <label className="field" style={{ marginTop: 12 }}>
                  <span>Ablehnungs-Hinweis</span>
                  <textarea rows={3} value={form.banRejectionMessage || ''} onChange={(e) => set({ banRejectionMessage: e.target.value })} />
                </label>
                <label className="field">
                  <span>Erforderliche HWID-Treffer</span>
                  <select value={String(form.requiredHwidMatches ?? '1')} onChange={(e) => set({ requiredHwidMatches: e.target.value })}>
                    <option value="0">0 — HWID-Bans aus</option>
                    <option value="1">1 — empfohlen</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                  </select>
                </label>
              </ModuleCard>
            </form>
            <ModuleCard title="Ban-Vorlagen" lead="Vorlagen beim Sperren vorausfüllen.">
              <form className="st-fields st-fields-1" onSubmit={addTemplate}>
                <label className="field">
                  <span>Grund</span>
                  <input value={tplReason} onChange={(e) => setTplReason(e.target.value)} placeholder="z. B. RDM / FailRP" required minLength={3} />
                </label>
                <OrbitSelect
                  label="Dauer"
                  value={tplDuration}
                  onChange={setTplDuration}
                  options={BAN_DURATION_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                />
                <button type="submit" className="btn btn-primary" disabled={tplBusy || tplReason.trim().length < 3}>
                  {tplBusy ? '…' : 'Vorlage hinzufügen'}
                </button>
              </form>
              {templates.length === 0 ? (
                <p className="muted" style={{ marginTop: 16 }}>Noch keine Vorlagen.</p>
              ) : (
                <ul className="st-tpl-list">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <div>
                        <strong>{t.reason}</strong>
                        <span className="muted">{banDurationLabel(t.duration_id)}</span>
                      </div>
                      <button type="button" className="btn btn-sm" disabled={tplBusy} onClick={() => removeTemplate(t.id)}>Löschen</button>
                    </li>
                  ))}
                </ul>
              )}
            </ModuleCard>
          </div>
        )}

        {section === 'allowlist' && isAdmin && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              wide
              title="Allowlist-Modus"
              lead="Zugangskontrolle beim Connect — analog zu txAdmin."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <div className="st-radio-list">
                {modes.map((m) => (
                  <label key={m.value} className={`st-radio${(form.allowlistMode || 'disabled') === m.value ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="allowlistMode"
                      checked={(form.allowlistMode || 'disabled') === m.value}
                      onChange={() => set({ allowlistMode: m.value })}
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
              <label className="field" style={{ marginTop: 14 }}>
                <span>Allowlist-Hinweis</span>
                <textarea
                  rows={3}
                  value={form.allowlistInstructions || ''}
                  onChange={(e) => set({ allowlistInstructions: e.target.value })}
                  disabled={(form.allowlistMode || 'disabled') === 'disabled' || form.allowlistMode === 'admin_only'}
                />
              </label>
              <label className="field">
                <span>Erlaubte Discord-Rollen (IDs, Komma)</span>
                <input
                  value={form.allowlistDiscordRoles || ''}
                  onChange={(e) => set({ allowlistDiscordRoles: e.target.value })}
                  placeholder="000000000000000000, …"
                  disabled={form.allowlistMode !== 'discord_roles'}
                />
              </label>
              {isOwner && (
                <label className="field">
                  <span>IP-Allowlist (Panel)</span>
                  <textarea placeholder="Leer = alle. Eine IP pro Zeile." value={form.ipAllowlist || ''} onChange={(e) => set({ ipAllowlist: e.target.value })} rows={2} />
                </label>
              )}
            </ModuleCard>
          </form>
        )}

        {section === 'discord' && isOwner && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              title="Webhook"
              lead="Start/Stop und optional Player-Drops."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <div className="st-chips">
                <Toggle checked={!!form.discordEnabled} onChange={(v) => set({ discordEnabled: v })} onLabel="Webhook an" offLabel="Webhook aus" />
                <Toggle checked={!!form.discordNotifyDrops} onChange={(v) => set({ discordNotifyDrops: v })} onLabel="Disconnects" offLabel="Disconnects aus" />
              </div>
              <div className="st-fields st-fields-1">
                <label className="field"><span>Webhook-URL</span><input value={form.discordWebhook || ''} onChange={(e) => set({ discordWebhook: e.target.value })} /></label>
                <label className="field"><span>Guild-ID</span><input value={form.discordGuild || ''} onChange={(e) => set({ discordGuild: e.target.value })} /></label>
                <label className="field"><span>Warnungen-Kanal-ID</span><input value={form.discordWarningsChannel || ''} onChange={(e) => set({ discordWarningsChannel: e.target.value })} placeholder="leer = aus" /></label>
              </div>
            </ModuleCard>
            <ModuleCard title="Bot">
              <Toggle checked={!!form.discordBotEnabled} onChange={(v) => set({ discordBotEnabled: v })} onLabel="Bot an" offLabel="Bot aus" />
              <p className="st-meta" style={{ marginTop: 8 }}>
                Benötigt Intent <b>Server Members</b> im Discord Developer Portal (Allowlist Discord-Member/Rollen).
                Status-Embed: im gewünschten Kanal <code>/status add</code> ausführen.
              </p>
              <label className="field" style={{ marginTop: 10 }}>
                <span>Bot-Token</span>
                <input type="password" value={form.discordBotToken || ''} onChange={(e) => set({ discordBotToken: e.target.value })} placeholder={form.discordBotConfigured ? 'leer = behalten' : 'Bot-Token'} autoComplete="new-password" />
              </label>
              {(form.discordStatusMessageId) && (
                <p className="st-meta ok">Status-Embed aktiv (Msg {form.discordStatusMessageId})</p>
              )}
            </ModuleCard>
            <ModuleCard wide title="Status Embed JSON" lead="Struktur der Status-Nachricht (Platzhalter wie {{uptime}}).">
              <textarea
                className="st-code"
                rows={10}
                value={form.discordStatusEmbedJson || ''}
                onChange={(e) => set({ discordStatusEmbedJson: e.target.value })}
                spellCheck={false}
              />
            </ModuleCard>
            <ModuleCard wide title="Status Config JSON" lead="Farben, Online-Strings und Buttons.">
              <textarea
                className="st-code"
                rows={10}
                value={form.discordStatusConfigJson || ''}
                onChange={(e) => set({ discordStatusConfigJson: e.target.value })}
                spellCheck={false}
              />
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">Discord speichern</button>
              <button type="button" className="btn" onClick={() => api('/api/platform/discord-test', { method: 'POST', body: {} }).then(() => setMsg('Discord-Test gesendet.')).catch((e) => setErr(e.message))}>Webhook testen</button>
            </div>
          </form>
        )}

        {section === 'game' && isAdmin && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              title="Menü"
              lead="Orbit Ingame-Menü (/orbit) — Einstellungen gehen an orbit_bridge."
              actions={<button className="btn btn-primary btn-sm" type="submit">Speichern</button>}
            >
              <div className="st-chips">
                <Toggle checked={form.gameMenuEnabled !== false} onChange={(v) => set({ gameMenuEnabled: v })} onLabel="Menü an" offLabel="Menü aus" />
                <Toggle checked={!!form.gameMenuAlignRight} onChange={(v) => set({ gameMenuAlignRight: v })} onLabel="Rechts" offLabel="Links" />
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Seitenwechsel-Taste</span>
                <input
                  value={form.gameMenuPageKey || 'Tab'}
                  onChange={(e) => set({ gameMenuPageKey: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' || e.key === 'Backspace') return;
                    if (e.key.length === 1 || ['Tab', 'Enter', 'Shift', 'Control', 'Alt'].includes(e.key)) {
                      e.preventDefault();
                      set({ gameMenuPageKey: e.key === ' ' ? 'Space' : e.key });
                    }
                  }}
                  placeholder="Taste drücken…"
                />
              </label>
            </ModuleCard>
            <ModuleCard title="Benachrichtigungen" lead="Admin-Namen und Standard-Notifs ausblenden.">
              <div className="st-chips st-chips-col">
                <Toggle checked={form.hideAdminInPunishments !== false} onChange={(v) => set({ hideAdminInPunishments: v })} onLabel="Admin in Strafen versteckt" offLabel="Admin in Strafen sichtbar" />
                <Toggle checked={!!form.hideAdminInMessages} onChange={(v) => set({ hideAdminInMessages: v })} onLabel="Admin in Nachrichten versteckt" offLabel="Admin in Nachrichten sichtbar" />
                <Toggle checked={!!form.hideAnnouncementNotif} onChange={(v) => set({ hideAnnouncementNotif: v })} onLabel="Announce-Notif aus" offLabel="Announce-Notif an" />
                <Toggle checked={!!form.hideDmNotif} onChange={(v) => set({ hideDmNotif: v })} onLabel="DM-Notif aus" offLabel="DM-Notif an" />
                <Toggle checked={!!form.hideWarnNotif} onChange={(v) => set({ hideWarnNotif: v })} onLabel="Warn-Notif aus" offLabel="Warn-Notif an" />
                <Toggle checked={!!form.hideRestartWarnNotif} onChange={(v) => set({ hideRestartWarnNotif: v })} onLabel="Restart-Warn aus" offLabel="Restart-Warn an" />
              </div>
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">Spiel speichern</button>
            </div>
          </form>
        )}

        {section === 'system' && isOwner && (
          <div className="st-stack">
            <ModuleCard wide title="Datenbank sichern" lead="Kopie der Orbit-Panel-DB (Spieler, Bans, Warns, Allowlist).">
              <button
                type="button"
                className="btn btn-primary"
                disabled={sysBusy}
                onClick={async () => {
                  setSysBusy(true);
                  setErr('');
                  try {
                    const d = await api('/api/system/backup-database');
                    const blob = new Blob([JSON.stringify(d.export, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `orbit-players-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    setMsg(`Backup: ${d.file} (${d.bytes} Bytes) + JSON-Download.`);
                  } catch (e) {
                    setErr(e.message);
                  }
                  setSysBusy(false);
                }}
              >
                Backup herunterladen
              </button>
            </ModuleCard>
            <ModuleCard wide title="Datenbank bereinigen" lead="Unwiderruflich — vorher Backup machen.">
              <div className="banner warn" style={{ marginBottom: 12 }}>
                Warnung: diese Aktion ist irreversibel. Zuerst Backup sichern.
              </div>
              <FieldRow>
                {['players', 'bans', 'warns', 'hwids'].map((key) => (
                  <label key={key} className="field">
                    <span>{key === 'players' ? 'Spieler' : key === 'bans' ? 'Bans' : key === 'warns' ? 'Warns' : 'HWIDs'}</span>
                    <select
                      value={cleanForm[key]}
                      onChange={(e) => setCleanForm({ ...cleanForm, [key]: e.target.value })}
                    >
                      {(cleanOpts?.[key] || [{ value: cleanForm[key], label: cleanForm[key] }]).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </FieldRow>
              <button
                type="button"
                className="btn btn-danger"
                disabled={sysBusy}
                onClick={async () => {
                  if (!window.confirm('Datenbank wirklich bereinigen?')) return;
                  setSysBusy(true);
                  setErr('');
                  try {
                    const d = await api('/api/system/clean-database', {
                      method: 'POST',
                      body: { confirm: true, ...cleanForm },
                    });
                    setMsg(`Bereinigt: ${JSON.stringify(d.cleaned)}`);
                  } catch (e) {
                    setErr(e.message);
                  }
                  setSysBusy(false);
                }}
              >
                Datenbank bereinigen
              </button>
            </ModuleCard>
            <ModuleCard title="Allowlists widerrufen" lead="Einträge aus der Orbit-Allowlist entfernen.">
              <button
                type="button"
                className="btn"
                disabled={sysBusy}
                onClick={async () => {
                  if (!window.confirm('Alle Allowlist-Einträge löschen?')) return;
                  setSysBusy(true);
                  try {
                    const d = await api('/api/system/revoke-allowlists', {
                      method: 'POST',
                      body: { confirm: true, olderThanDays: 'all' },
                    });
                    setMsg(`${d.removed} Allowlist-Einträge entfernt.`);
                  } catch (e) {
                    setErr(e.message);
                  }
                  setSysBusy(false);
                }}
              >
                Alle Allowlists widerrufen
              </button>
            </ModuleCard>
          </div>
        )}

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

        {section === 'host' && isOwner && (
          <div className="st-stack">
            <ModuleCard wide title="Host & Instanzen" lead="FX-Builds, weitere Server und Prod.">
              {form.orbitServerName ? (
                <p className="st-meta">
                  Aktiv: <b>{form.orbitServerName}</b>
                  {' · '}
                  <span className="mono">{form.fxDataPath}</span>
                </p>
              ) : null}
              <SettingsHostPanel initialTab={hostTab} onMessage={setMsg} onError={setErr} />
            </ModuleCard>
          </div>
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
            <ModuleCard title="Orbit deinstallieren" lead="Panel, Dienst und Installation weg.">
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
                  if (!window.confirm('Orbit jetzt unwiderruflich deinstallieren?')) return;
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

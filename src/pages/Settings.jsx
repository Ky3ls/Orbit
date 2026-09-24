import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import SettingsHostPanel from '../components/SettingsHostPanel.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import OrbitSelect from '../components/OrbitSelect.jsx';
import { useAppearance } from '../hooks/useAppearance.js';
import { ACCENT_PRESETS } from '../appearance.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { LANGUAGE_OPTIONS } from '../i18n/catalog.js';
import { toBcp47, toSettingsValue } from '../i18n/core.js';
import { GAME_BUILD_OPTIONS, ONESYNC_OPTIONS } from './settingsOptions.js';
import { BAN_DURATION_PRESETS, banDurationLabel } from './banPresets.js';

const HOST_TABS = new Set(['servers', 'artifacts', 'prod']);

const SECTION_DEFS = [
  { id: 'general', labelKey: 'settings.sec.general', hintKey: 'settings.sec.generalHint', owner: false },
  { id: 'fxserver', labelKey: 'settings.sec.fxserver', hintKey: 'settings.sec.fxserverHint', owner: true },
  { id: 'bans', labelKey: 'settings.sec.bans', hintKey: 'settings.sec.bansHint', owner: false, admin: true },
  { id: 'allowlist', labelKey: 'settings.sec.allowlist', hintKey: 'settings.sec.allowlistHint', owner: false, admin: true },
  { id: 'discord', labelKey: 'settings.sec.discord', hintKey: 'settings.sec.discordHint', owner: true },
  { id: 'game', labelKey: 'settings.sec.game', hintKey: 'settings.sec.gameHint', owner: false, admin: true },
  { id: 'system', labelKey: 'settings.sec.system', hintKey: 'settings.sec.systemHint', owner: true },
  { id: 'appearance', labelKey: 'settings.sec.appearance', hintKey: 'settings.sec.appearanceHint', owner: false },
  { id: 'host', labelKey: 'settings.sec.host', hintKey: 'settings.sec.hostHint', owner: true },
  { id: 'account', labelKey: 'settings.sec.account', hintKey: 'settings.sec.accountHint', owner: false },
  { id: 'danger', labelKey: 'settings.sec.danger', hintKey: 'settings.sec.dangerHint', owner: true },
];

const ALLOWLIST_MODE_KEYS = {
  disabled: 'settings.allowlist.mode.disabled',
  admin_only: 'settings.allowlist.mode.admin_only',
  discord_member: 'settings.allowlist.mode.discord_member',
  discord_roles: 'settings.allowlist.mode.discord_roles',
  approved_license: 'settings.allowlist.mode.approved_license',
  external: 'settings.allowlist.mode.external',
};

const ALLOWLIST_MODE_VALUES = ['disabled', 'admin_only', 'discord_member', 'discord_roles', 'approved_license', 'external'];

/** Felder je Settings-Tab — verhindert Cross-Tab-Validierung (z. B. RCON beim Language-Save). */
const SECTION_FIELDS = {
  general: [
    'serverName', 'language', 'locale', 'hostname', 'project',
    'maxClients', 'tags', 'gameBuild', 'fivemHost', 'fivemPort',
  ],
  fxserver: [
    'hostname', 'fivemHost', 'fivemPort',
    'fxControlMode', 'fxDataPath', 'fxCfgPath', 'fxServerExtraArgs', 'fxServerRoot',
    'onesync', 'resourceStartingTolerance', 'quietMode', 'fxAutostart', 'autoRestartEnabled',
    'rconPort', 'rconPassword',
  ],
  bans: ['banChecking', 'banRejectionMessage', 'requiredHwidMatches'],
  allowlist: ['allowlistMode', 'allowlistEnabled', 'allowlistInstructions', 'allowlistDiscordRoles'],
  discord: [
    'discordEnabled', 'discordNotifyDrops', 'discordWebhook', 'discordGuild',
    'discordWarningsChannel', 'discordStatusEmbedJson', 'discordStatusConfigJson',
    'discordBotEnabled', 'discordBotToken',
  ],
  game: [
    'gameMenuEnabled', 'gameMenuAlignRight', 'gameMenuPageKey',
    'hideAdminInPunishments', 'hideAdminInMessages', 'hideAnnouncementNotif',
    'hideDmNotif', 'hideWarnNotif', 'hideRestartWarnNotif',
  ],
};

function pickSectionPayload(form, section) {
  const keys = SECTION_FIELDS[section];
  if (!keys) return { ...form };
  const out = {};
  for (const k of keys) {
    if (form[k] !== undefined) out[k] = form[k];
  }
  return out;
}

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

function Toggle({ checked, onChange, onLabel = 'On', offLabel = 'Off' }) {
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
  const { t, setLanguage, syncFromSettings } = useI18n();
  const [form, setForm] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState(null);
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState([]);
  const [params, setParams] = useSearchParams();
  const [msg, setMsg] = useState('');
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

  useEffect(() => {
    const cfx = params.get('cfx');
    if (cfx === 'ok') setMsg(t('settings.cfxOk'));
    else if (cfx === 'taken') setMsg(t('settings.cfxTaken'));
  }, [params, t]);

  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const nav = useMemo(
    () => SECTION_DEFS.filter((s) => {
      if (s.owner && !isOwner) return false;
      if (s.admin && !isAdmin) return false;
      return true;
    }).map((s) => ({ ...s, label: t(s.labelKey), hint: t(s.hintKey) })),
    [isOwner, isAdmin, t],
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
    api('/api/settings').then((d) => {
      setForm(d.settings);
      if (d.settings) syncFromSettings(d.settings);
    }).catch((e) => setErr(e.message));
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
      setMsg(t('settings.tplSaved'));
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
      const base = pickSectionPayload(form, section);
      const payload = section === 'general'
        ? {
          ...base,
          language: form.language || form.locale,
          locale: toBcp47(form.language || form.locale || 'de'),
        }
        : base;
      await api('/api/settings', { method: 'PUT', body: payload });
      if (payload.language) setLanguage(payload.language);
      setMsg(t('common.saved'));
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
      setMsg(t('settings.pwChanged'));
      onUser({ ...user, mustChange: false });
      setPw({ current: '', next: '' });
    } catch (error) {
      setErr(error.message);
    }
  }

  if (!form) {
    return <Page>{err ? <div className="err">{err}</div> : <p className="muted">{t('common.loading')}</p>}</Page>;
  }

  const set = (patch) => setForm({ ...form, ...patch });
  const activeMeta = nav.find((s) => s.id === section);
  const modes = (form.allowlistModes?.length
    ? form.allowlistModes.map((m) => ({ ...m, label: t(ALLOWLIST_MODE_KEYS[m.value] || m.label) }))
    : ALLOWLIST_MODE_VALUES.map((value) => ({ value, label: t(ALLOWLIST_MODE_KEYS[value]) })));

  const aside = (
    <nav className="st-nav" aria-label={t('settings.navAria')}>
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
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={activeMeta ? `${activeMeta.label} — ${activeMeta.hint}` : t('settings.desc')}
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
              title={t('settings.general.title')}
              lead={t('settings.general.lead')}
              actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
            >
              <FieldRow>
                <label className="field">
                  <span>{t('settings.serverName')} <em className="req">{t('common.required')}</em></span>
                  <input
                    value={form.serverName || ''}
                    maxLength={18}
                    required
                    onChange={(e) => set({ serverName: e.target.value })}
                    placeholder={t('settings.serverNamePh')}
                  />
                </label>
                <label className="field">
                  <span>{t('settings.language')} <em className="req">{t('common.required')}</em></span>
                  <select
                    value={toSettingsValue(form.language || form.locale || 'de-DE')}
                    onChange={(e) => {
                      const language = e.target.value;
                      set({ language, locale: toBcp47(language) });
                      setLanguage(language);
                    }}
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                    ))}
                  </select>
                </label>
              </FieldRow>
            </ModuleCard>
            <ModuleCard wide title={t('settings.identity')} lead={t('settings.identityLead')}>
              <FieldRow>
                <label className="field"><span>{t('settings.hostname')}</span><input value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} /></label>
                <label className="field"><span>{t('settings.project')}</span><input value={form.project} onChange={(e) => set({ project: e.target.value })} /></label>
                <label className="field"><span>{t('settings.slots')}</span><input type="number" min={1} max={2048} value={form.maxClients} onChange={(e) => set({ maxClients: e.target.value })} /></label>
                <label className="field"><span>{t('settings.tags')}</span><input value={form.tags || ''} onChange={(e) => set({ tags: e.target.value })} placeholder={t('settings.tagsPh')} /></label>
                <label className="field"><span>{t('settings.gameBuild')}</span>
                  <select value={form.gameBuild || ''} onChange={(e) => set({ gameBuild: e.target.value })}>
                    {GAME_BUILD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field"><span>{t('settings.port')}</span><input value={form.fivemPort} onChange={(e) => set({ fivemPort: e.target.value })} /></label>
              </FieldRow>
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">{t('settings.saveGeneral')}</button>
            </div>
          </form>
        )}

        {section === 'fxserver' && isOwner && (
          <form className="st-stack" onSubmit={save}>
            <ModuleCard
              wide
              title={t('settings.fx.title')}
              lead={t('settings.fx.lead')}
              actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
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
            <ModuleCard title={t('settings.rcon')}>
              <div className="st-fields st-fields-1">
                <label className="field"><span>Port</span><input value={form.rconPort || ''} onChange={(e) => set({ rconPort: e.target.value })} placeholder={form.fivemPort || '30120'} /></label>
                <label className="field"><span>Passwort</span><input type="password" value={form.rconPassword || ''} onChange={(e) => set({ rconPassword: e.target.value })} placeholder={form.rconConfigured ? 'leer lassen' : 'eintragen'} autoComplete="new-password" /></label>
              </div>
            </ModuleCard>
            <div className="st-foot st-wide">
              <button className="btn btn-primary" type="submit">{t('settings.fx.save')}</button>
              <button className="btn" type="button" onClick={() => api('/api/settings/rcon-test', { method: 'POST', body: {} }).then((d) => setMsg(d.message || t('settings.rconOk'))).catch((e) => setErr(e.message))}>{t('settings.fx.rconTest')}</button>
            </div>
          </form>
        )}

        {section === 'bans' && isAdmin && (
          <div className="st-stack">
            <form onSubmit={save}>
              <ModuleCard
                title={t('settings.bans.title')}
                lead={t('settings.bans.lead')}
                actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
              >
                <Toggle checked={form.banChecking !== false} onChange={(v) => set({ banChecking: v })} onLabel={t('settings.bans.checkOnShort')} offLabel={t('settings.bans.checkOffShort')} />
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
            <ModuleCard title={t('settings.bans.templates')} lead={t('settings.bans.templatesLead')}>
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
                  {tplBusy ? '…' : t('settings.tplAdd')}
                </button>
              </form>
              {templates.length === 0 ? (
                <p className="muted" style={{ marginTop: 16 }}>Noch keine Vorlagen.</p>
              ) : (
                <ul className="st-tpl-list">
                  {templates.map((tpl) => (
                    <li key={tpl.id}>
                      <div>
                        <strong>{tpl.reason}</strong>
                        <span className="muted">{banDurationLabel(tpl.duration_id)}</span>
                      </div>
                      <button type="button" className="btn btn-sm" disabled={tplBusy} onClick={() => removeTemplate(tpl.id)}>{t('common.delete')}</button>
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
              title={t('settings.allowlist.title')}
              lead={t('settings.allowlist.lead')}
              actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
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
              actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
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
                {t('settings.discord.intent')}
                {' '}{t('settings.discord.statusEmbed')}
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
              title={t('settings.game.menuTitle')}
              lead={t('settings.game.menuLead')}
              actions={<button className="btn btn-primary btn-sm" type="submit">{t('common.save')}</button>}
            >
              <div className="st-chips">
                <Toggle checked={form.gameMenuEnabled !== false} onChange={(v) => set({ gameMenuEnabled: v })} onLabel={t('settings.game.menuOn')} offLabel={t('settings.game.menuOff')} />
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
                  placeholder={t('settings.game.keyPh')}
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
                    <span>{key === 'players' ? t('settings.clean.players') : key === 'bans' ? t('settings.clean.bans') : key === 'warns' ? t('settings.clean.warns') : t('settings.clean.hwids')}</span>
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
            <ModuleCard title={t('settings.allowlist.revoke')} lead={t('settings.allowlist.revokeLead')}>
              <button
                type="button"
                className="btn"
                disabled={sysBusy}
                onClick={async () => {
                  if (!window.confirm(t('settings.allowlist.revokeConfirm'))) return;
                  setSysBusy(true);
                  try {
                    const d = await api('/api/system/revoke-allowlists', {
                      method: 'POST',
                      body: { confirm: true, olderThanDays: 'all' },
                    });
                    setMsg(t('settings.allowlist.revoked', { n: d.removed }));
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
            <ModuleCard title={t('settings.appearance.title')} lead={t('settings.appearance.lead')}>
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
            <ModuleCard title={t('settings.account.password')}>
              <form onSubmit={password}>
                <div className="st-fields st-fields-1">
                  <label className="field"><span>Aktuell</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
                  <label className="field"><span>Neu</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
                </div>
                <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>{t('settings.account.changePw')}</button>
              </form>
            </ModuleCard>
            <ModuleCard title={t('settings.account.cfx')} lead={t('settings.account.cfxLead')}>
              {user.cfxName ? (
                <div className="st-inline">
                  <b>{user.cfxName}</b>
                  <button className="btn btn-sm" type="button" onClick={() => api('/api/auth/cfx/unlink', { method: 'POST', body: {} }).then(() => { onUser({ ...user, cfxName: '' }); setMsg('Cfx.re getrennt.'); }).catch((e) => setErr(e.message))}>Trennen</button>
                </div>
              ) : (
                <a className="btn cfx" href="/api/auth/cfx/start?mode=link">Mit Cfx.re verbinden</a>
              )}
            </ModuleCard>
            <ModuleCard title={t('settings.account.totp')}>
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
            <ModuleCard title={t('settings.account.sessions')}>
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
            <ModuleCard title={t('settings.danger.reset')} lead={t('settings.danger.resetLead')}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={resetBusy}
                onClick={async () => {
                  if (!window.confirm(t('settings.danger.resetConfirm1'))) return;
                  if (!window.confirm(t('settings.danger.resetConfirm2'))) return;
                  setResetBusy(true);
                  setErr('');
                  try {
                    const res = await api('/api/settings/reset-setup', {
                      method: 'POST',
                      body: { confirm: true, wipe: true },
                    });
                    setMsg(t('settings.danger.resetMsg', { n: (res.deleted || []).length }));
                    onSetupReset?.({ redirect: '/setup', wipe: true });
                  } catch (e) {
                    setErr(e.message || t('settings.danger.resetFail'));
                  } finally {
                    setResetBusy(false);
                  }
                }}
              >
                {resetBusy ? t('settings.danger.resetBusy') : t('settings.danger.resetBtn')}
              </button>
            </ModuleCard>
            <ModuleCard title="Orbit deinstallieren" lead="Panel, Dienst und Installation weg.">
              <button
                type="button"
                className="btn btn-danger"
                disabled={resetBusy}
                onClick={async () => {
                  const phrase = window.prompt(t('settings.danger.uninstallPrompt'));
                  if (phrase == null) return;
                  if (String(phrase).trim().toUpperCase() !== t('settings.danger.uninstallPhrase')) {
                    setErr('Abgebrochen — Phrase falsch.');
                    return;
                  }
                  if (!window.confirm('Orbit jetzt unwiderruflich deinstallieren?')) return;
                  setResetBusy(true);
                  setErr('');
                  try {
                    const res = await api('/api/settings/uninstall', {
                      method: 'POST',
                      body: { confirmPhrase: t('settings.danger.uninstallPhrase') },
                    });
                    setMsg(res.message || t('settings.danger.uninstallMsg'));
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

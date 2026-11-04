import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, sameJson } from '../api.js';
import ServerControls, { statusLabel, statusTone } from '../components/ServerControls.jsx';
import { Toaster } from '../components/toast.jsx';
import { Mark } from '../components/Ui.jsx';
import { roleLabel } from '../format.js';
import { useAppearance } from '../hooks/useAppearance.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import { MOBILE_TABS, localizedModules, moduleForPath } from '../layout/modules.js';
import CommandPalette from './CommandPalette.jsx';
import ShortcutsDialog from './ShortcutsDialog.jsx';
import './shell.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

function initials(name) {
  const s = String(name || '?').trim();
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function Shell({ user, onLogout }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const loc = useLocation();
  const modules = useMemo(() => localizedModules(t), [t]);
  const [prefs, setAppearance] = useAppearance();
  const [status, setStatus] = useState('offline');
  const [live, setLive] = useState({ clients: 0, maxClients: 48, hostname: 'Server', serverLabel: 'Game Server' });
  const [controlEnabled, setControlEnabled] = useState(true);
  const [fxMeta, setFxMeta] = useState({ fxControlMode: 'systemd', fxCommandReady: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [mcList, setMcList] = useState([]);
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchRef = useRef(null);
  const powerRef = useRef(null);
  const userRef = useRef(null);
  const gPending = useRef(0);

  const isOwner = user.role === 'owner';
  const canControl = user.role === 'owner' || user.role === 'admin';
  const collapsed = !!prefs.sidebarCollapsed;
  const isLight = prefs.theme === 'light';
  const current = moduleForPath(loc.pathname);
  const tone = statusTone(status);

  const refreshStatus = useCallback(() => {
    if (document.hidden) return;
    api('/api/server/status')
      .then((d) => {
        const nextStatus = d.status || (d.online ? 'online' : 'offline');
        const nextLive = {
          clients: d.clients ?? 0,
          maxClients: d.maxClients ?? 48,
          hostname: d.hostname || 'Server',
          serverLabel: d.serverLabel || d.hostname || 'Game Server',
        };
        const nextFx = { fxControlMode: d.fxControlMode || 'systemd', fxCommandReady: !!d.fxCommandReady };
        const nextControl = d.controlEnabled !== false;
        setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
        setControlEnabled((prev) => (prev === nextControl ? prev : nextControl));
        setLive((prev) => (sameJson(prev, nextLive) ? prev : nextLive));
        setFxMeta((prev) => (sameJson(prev, nextFx) ? prev : nextFx));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    const busy = status === 'starting' || status === 'stopping' || status === 'restarting';
    const id = setInterval(refreshStatus, busy ? 2000 : 10_000);
    return () => clearInterval(id);
  }, [refreshStatus, status]);

  useEffect(() => {
    setPowerOpen(false);
    setUserOpen(false);
    setDrawer(false);
    setSwitchOpen(false);
  }, [loc.pathname]);

  /* Minecraft-Instanzen für Navigation + Umschalter */
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      api('/api/mc/instances')
        .then((d) => {
          if (!alive) return;
          const next = (d.instances || []).map((i) => ({ id: i.id, name: i.name, type: i.type, mcVersion: i.mcVersion, phase: i.status?.phase, players: i.status?.players, max: i.status?.maxPlayers }));
          setMcList((prev) => (sameJson(prev, next) ? prev : next));
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  /* Dokumenttitel */
  useEffect(() => {
    const page = current ? t(current.item.labelKey) : '';
    document.title = page ? `${page} · Orbit` : 'Orbit · Server Control';
  }, [current, t]);

  /* Popover schließen bei Klick außerhalb */
  useEffect(() => {
    if (!powerOpen && !userOpen && !switchOpen) return undefined;
    const onDown = (e) => {
      if (powerRef.current && !powerRef.current.contains(e.target)) setPowerOpen(false);
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
      if (switchRef.current && !switchRef.current.contains(e.target)) setSwitchOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [powerOpen, userOpen, switchOpen]);

  /* Globale Tastenkürzel */
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (paletteOpen || keysOpen || isTyping(e.target) || mod || e.altKey) return;
      if (document.querySelector('.modal-back')) return;
      const k = e.key;
      if (k === '/') { e.preventDefault(); setPaletteOpen(true); return; }
      if (k === '?') { e.preventDefault(); setKeysOpen(true); return; }
      if (k === '[') { setAppearance({ sidebarCollapsed: !collapsed }); return; }
      if (k === 'T' && e.shiftKey) { setAppearance({ theme: isLight ? 'dark' : 'light' }); return; }
      if (k === 'g') { gPending.current = Date.now(); return; }
      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        for (const g of modules) {
          const hit = g.items.find((i) => i.key === k.toLowerCase() && (!i.owner || isOwner));
          if (hit) { e.preventDefault(); navigate(hit.to); return; }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, keysOpen, collapsed, isLight, modules, isOwner, navigate, setAppearance]);

  const playerPct = live.maxClients ? Math.min(100, (live.clients / live.maxClients) * 100) : 0;

  const sidebar = (
    <aside className="sb" aria-label={t('nav.main')}>
      <div className="sb-head">
        <Link to="/panel" className="sb-brand" title="Orbit">
          <Mark />
          <span className="sb-brand-text">
            <b>Orbit</b>
            <small>Server Control</small>
          </span>
        </Link>
        <button
          type="button"
          className="sb-collapse"
          title={`${collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')} ( [ )`}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          onClick={() => setAppearance({ sidebarCollapsed: !collapsed })}
        >
          <NavIcon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>

      <div className="sb-switch" ref={switchRef}>
        <button type="button" className={`sb-server tone-${tone}${switchOpen ? ' open' : ''}`} title={live.hostname} onClick={() => setSwitchOpen((v) => !v)} aria-expanded={switchOpen}>
          <span className="sb-server-orb" aria-hidden="true"><i /></span>
          <span className="sb-server-main">
            <span className="sb-server-name">{live.serverLabel}</span>
            <span className="sb-server-meta">
              <span className="sb-server-status">{statusLabel(status)}</span>
              <span className="sb-server-sep">·</span>
              <span className="mono">{live.clients}/{live.maxClients}</span>
              {mcList.length ? <span className="sb-server-more">+{mcList.length}</span> : null}
            </span>
            <span className="sb-server-bar" aria-hidden="true"><i style={{ width: `${playerPct}%` }} /></span>
          </span>
          <span className="sb-switch-ico"><NavIcon name="switch" /></span>
        </button>
        {switchOpen && (
          <div className="pop sb-switch-menu" role="menu">
            <div className="sb-switch-label">FiveM</div>
            <Link to="/panel" className="sb-switch-item" role="menuitem">
              <span className={`sb-dot tone-${tone}`} />
              <span className="sb-switch-text"><b>{live.serverLabel}</b><small>{statusLabel(status)} · {live.clients}/{live.maxClients}</small></span>
            </Link>
            {mcList.length > 0 && <div className="sb-switch-label">Minecraft</div>}
            {mcList.map((m) => (
              <Link key={m.id} to={`/mc/${m.id}`} className="sb-switch-item" role="menuitem">
                <span className={`sb-dot tone-${({ running: 'ok', starting: 'warn', stopping: 'warn', crashed: 'bad', failed: 'bad', installing: 'warn' })[m.phase] || 'idle'}`} />
                <span className="sb-switch-text"><b>{m.name}</b><small>{m.type} {m.mcVersion}{m.phase === 'running' ? ` · ${m.players ?? 0}/${m.max ?? '–'}` : ''}</small></span>
              </Link>
            ))}
            <div className="pop-sep" />
            <Link to="/instances" className="pop-item" role="menuitem"><NavIcon name="layers" />Alle Instanzen</Link>
            {(user.role === 'owner' || user.role === 'admin') && <Link to="/instances/new" className="pop-item" role="menuitem"><NavIcon name="plus" />Neue Instanz</Link>}
          </div>
        )}
      </div>

      <nav className="sb-nav">
        {modules.map((group) => (
          <div key={group.id} className="sb-group">
            <span className="sb-group-label">{group.label}</span>
            {group.items.map((item) => {
              if (item.owner && !isOwner) return null;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={!!item.end}
                  title={item.label}
                  className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}
                >
                  <span className="sb-ico"><NavIcon name={item.icon} /></span>
                  <span className="sb-label">{item.label}</span>
                  {item.to === '/players' && live.clients > 0 ? <span className="sb-count">{live.clients}</span> : null}
                </NavLink>
              );
            })}
            {group.id === 'games' && mcList.map((m) => (
              <NavLink key={m.id} to={`/mc/${m.id}`} title={m.name} className={({ isActive }) => `sb-item sb-sub${isActive || loc.pathname.startsWith(`/mc/${m.id}/`) ? ' active' : ''}`}>
                <span className="sb-ico"><NavIcon name="cube" /></span>
                <span className="sb-label">{m.name}</span>
                <span className={`sb-dot tone-${({ running: 'ok', starting: 'warn', stopping: 'warn', crashed: 'bad', failed: 'bad', installing: 'warn' })[m.phase] || 'idle'}`} />
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sb-foot" ref={userRef}>
        <button type="button" className={`sb-user${userOpen ? ' open' : ''}`} onClick={() => setUserOpen((v) => !v)} aria-expanded={userOpen}>
          <span className="sb-avatar">{initials(user.cfxName || user.username)}</span>
          <span className="sb-user-text">
            <b>{user.username}</b>
            <small>{roleLabel(user.role)}</small>
          </span>
          <span className="sb-user-caret"><NavIcon name="chevronDown" /></span>
        </button>
        {userOpen && (
          <div className="pop sb-user-menu" role="menu">
            <Link to="/settings" className="pop-item" role="menuitem"><NavIcon name="gear" />{t('common.settings')}</Link>
            <button type="button" className="pop-item" role="menuitem" onClick={() => setAppearance({ theme: isLight ? 'dark' : 'light' })}>
              <NavIcon name={isLight ? 'moon' : 'sun'} />
              {isLight ? t('shell.darkMode') : t('shell.lightMode')}
              <span className={`switch${isLight ? ' on' : ''}`} aria-hidden="true" />
            </button>
            <button type="button" className="pop-item" role="menuitem" onClick={() => { setUserOpen(false); setKeysOpen(true); }}>
              <NavIcon name="keyboard" />{t('palette.shortcuts')}<kbd>?</kbd>
            </button>
            <div className="pop-sep" />
            <button type="button" className="pop-item danger" role="menuitem" onClick={onLogout}>
              <NavIcon name="logout" />{t('common.logout')}
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="app" data-collapsed={collapsed ? '1' : '0'} data-drawer={drawer ? '1' : '0'}>
      {sidebar}
      <button type="button" className="sb-scrim" aria-label={t('common.close')} onClick={() => setDrawer(false)} />

      <div className="app-main">
        <header className="tb">
          <button type="button" className="tb-burger" aria-label={t('nav.menu')} onClick={() => setDrawer(true)}>
            <NavIcon name="menu" />
          </button>
          <nav className="tb-crumbs" aria-label="Breadcrumb">
            <span className="tb-crumb-group">{current ? t(current.group.labelKey) : 'Orbit'}</span>
            <NavIcon name="chevron" />
            <span className="tb-crumb-page">{current ? t(current.item.labelKey) : ''}</span>
          </nav>

          <button type="button" className="tb-search" onClick={() => setPaletteOpen(true)}>
            <NavIcon name="search" />
            <span>{t('palette.trigger')}</span>
            <span className="tb-search-kbd"><kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
          </button>

          <div className="tb-end">
            <Link to="/players?filter=online" className={`tb-live tone-${tone}`} title={statusLabel(status)}>
              <i className="tb-live-dot" />
              <span className="tb-live-label">{statusLabel(status)}</span>
              <span className="tb-live-count"><NavIcon name="users" />{live.clients}</span>
            </Link>

            {canControl && (
              <div className="tb-pop-wrap" ref={powerRef}>
                <button
                  type="button"
                  className={`tb-icon tb-power tone-${tone}${powerOpen ? ' on' : ''}`}
                  aria-expanded={powerOpen}
                  title={t('shell.serverControls')}
                  onClick={() => setPowerOpen((v) => !v)}
                >
                  <NavIcon name="power" />
                </button>
                {powerOpen && (
                  <div className="pop tb-power-pop" role="menu">
                    <div className="pop-title">
                      <b>{live.serverLabel}</b>
                      <small className="mono">{live.hostname}</small>
                    </div>
                    <ServerControls
                      compact
                      status={status}
                      controlEnabled={controlEnabled}
                      canControl={canControl}
                      fxControlMode={fxMeta.fxControlMode}
                      fxCommandReady={fxMeta.fxCommandReady}
                      onDone={() => { refreshStatus(); setPowerOpen(false); }}
                    />
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="tb-icon"
              title={`${isLight ? t('shell.darkMode') : t('shell.lightMode')} (Shift+T)`}
              onClick={() => setAppearance({ theme: isLight ? 'dark' : 'light' })}
            >
              <NavIcon name={isLight ? 'moon' : 'sun'} />
            </button>
          </div>
        </header>

        {user.mustChange && (
          <div className="app-banner banner">
            {t('shell.mustChangePrefix')}
            <Link to="/settings">{t('common.settings')}</Link>
            {t('shell.mustChangeSuffix')}
          </div>
        )}

        <main className="app-content" key={loc.pathname}>
          <Outlet context={{
            onLogout,
            user,
            refreshStatus,
            fxMeta,
            serverStatus: status,
            controlEnabled,
            live,
          }} />
        </main>
      </div>

      <nav className="mtab" aria-label={t('nav.main')}>
        {MOBILE_TABS.map((item) => (
          <NavLink key={item.to} to={item.to} end={!!item.end} className={({ isActive }) => `mtab-item${isActive ? ' active' : ''}`}>
            <NavIcon name={item.icon} />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        ))}
        <button type="button" className="mtab-item" onClick={() => setDrawer(true)}>
          <NavIcon name="menu" />
          <span>{t('nav.more')}</span>
        </button>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        user={user}
        prefs={prefs}
        setAppearance={setAppearance}
        canControl={canControl}
        status={status}
        onLogout={onLogout}
        onShortcuts={() => setKeysOpen(true)}
        refreshStatus={refreshStatus}
        mcList={mcList}
      />
      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} modules={modules} isOwner={isOwner} mac={IS_MAC} />
      <Toaster />
    </div>
  );
}

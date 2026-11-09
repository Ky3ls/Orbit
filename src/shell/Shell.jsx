import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import GameMark from '../components/GameMark.jsx';
import ServerControls from '../components/ServerControls.jsx';
import { Toaster, toast } from '../components/toast.jsx';
import { Brand, Mark } from '../components/Ui.jsx';
import { roleLabel } from '../format.js';
import { GAMES, PHASE_LABEL, navMatches, serverNav } from '../games.js';
import { useAppearance } from '../hooks/useAppearance.js';
import { useServers } from '../hooks/useServers.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import { GLOBAL_NAV, MANAGE_NAV, locate, navGroups, navLabel } from '../layout/modules.js';
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
  const [prefs, setAppearance] = useAppearance();
  const { servers, fx, mcList, refresh, refreshFx } = useServers();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [lastServer, setLastServer] = useState(() => { try { return localStorage.getItem('orbit.lastServer') || ''; } catch { return ''; } });
  const powerRef = useRef(null);
  const userRef = useRef(null);
  const gPending = useRef(0);

  const isOwner = user.role === 'owner';
  const canControl = user.role === 'owner' || user.role === 'admin';
  const collapsed = !!prefs.sidebarCollapsed;
  const isLight = prefs.theme === 'light';
  const here = locate(loc.pathname, loc.search, servers);
  const server = here.server;
  const groups = useMemo(() => navGroups(t, server), [t, server]);
  const online = servers.filter((s) => s.phase === 'running');
  const totalPlayers = online.reduce((n, s) => n + (s.players || 0), 0);

  useEffect(() => {
    if (!here.key) return;
    setLastServer(here.key);
    try { localStorage.setItem('orbit.lastServer', here.key); } catch { /* */ }
  }, [here.key]);

  useEffect(() => {
    setPowerOpen(false);
    setUserOpen(false);
    setDrawer(false);
  }, [loc.pathname]);

  /* Dokumenttitel */
  useEffect(() => {
    const page = here.item ? navLabel(t, here.item) : '';
    const parts = [page, server?.name, 'Orbit'].filter(Boolean);
    document.title = parts.length > 1 ? parts.join(' · ') : 'Orbit · Game Server Panel';
  }, [here.item, server?.name, t]);

  /* Popover schließen bei Klick außerhalb */
  useEffect(() => {
    if (!powerOpen && !userOpen) return undefined;
    const onDown = (e) => {
      if (powerRef.current && !powerRef.current.contains(e.target)) setPowerOpen(false);
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [powerOpen, userOpen]);

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
        for (const g of groups) {
          const hit = g.items.find((i) => i.key === k.toLowerCase() && (!i.owner || isOwner));
          if (hit) { e.preventDefault(); navigate(hit.to); return; }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, keysOpen, collapsed, isLight, groups, isOwner, navigate, setAppearance]);

  const serverOrder = useMemo(() => {
    const order = { running: 0, starting: 1, restarting: 1, stopping: 1, installing: 2, crashed: 2, failed: 2 };
    return [...servers].sort((a, b) => (order[a.phase] ?? 3) - (order[b.phase] ?? 3) || a.name.localeCompare(b.name));
  }, [servers]);

  const sidebar = (
    <aside className="sb" aria-label={t('nav.main')}>
      <div className="sb-head">
        <Link to="/home" className="sb-brand" title="Orbit">
          <Brand size={34} />
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

      <nav className="sb-nav">
        <div className="sb-group">
          {GLOBAL_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={!!item.end} title={navLabel(t, item)} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}>
              <span className="sb-ico"><NavIcon name={item.icon} /></span>
              <span className="sb-label">{navLabel(t, item)}</span>
              {online.length ? <span className="sb-count" title={`${online.length} Server online`}>{online.length}/{servers.length}</span> : null}
            </NavLink>
          ))}
        </div>

        <div className="sb-group">
          <div className="sb-group-head">
            <span className="sb-group-label">Server</span>
            {canControl && <Link to="/instances/new" className="sb-group-add" title="Neuer Server" aria-label="Neuer Server"><NavIcon name="plus" /></Link>}
          </div>
          {serverOrder.map((s) => {
            const open = here.key === s.key;
            const items = open ? serverNav(s) : [];
            return (
              <div key={s.key} className={`sb-srv${open ? ' open' : ''}`}>
                <Link to={s.to} className={`sb-srv-row tone-${s.tone}`} title={`${s.name} — ${PHASE_LABEL[s.phase] || s.phase}`}>
                  <span className="sb-srv-mark">
                    <GameMark game={s.game} size={26} />
                    <i className="sb-srv-dot" />
                  </span>
                  <span className="sb-srv-text">
                    <b>{s.name}</b>
                    <small>{GAMES[s.game]?.label}{s.players != null ? <> · <span className="mono">{s.players}/{s.max ?? '–'}</span></> : <> · {PHASE_LABEL[s.phase] || s.phase}</>}</small>
                  </span>
                </Link>
                {open && items.length > 0 && (
                  <div className="sb-srv-nav">
                    {items.map((item) => {
                      const active = navMatches(item, loc.pathname, loc.search);
                      return (
                        <Link key={item.id} to={item.to} title={item.label} className={`sb-item sb-sub${active ? ' active' : ''}`}>
                          <span className="sb-ico"><NavIcon name={item.icon} /></span>
                          <span className="sb-label">{item.label}</span>
                          {item.count && s.players ? <span className="sb-count">{s.players}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {servers.length === 0 && (
            <Link to="/instances/new" className="sb-item sb-empty"><span className="sb-ico"><NavIcon name="plus" /></span><span className="sb-label">Ersten Server anlegen</span></Link>
          )}
        </div>

        <div className="sb-group">
          <span className="sb-group-label">{t('nav.manage')}</span>
          {MANAGE_NAV.map((item) => {
            if (item.owner && !isOwner) return null;
            return (
              <NavLink key={item.to} to={item.to} title={navLabel(t, item)} className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}>
                <span className="sb-ico"><NavIcon name={item.icon} /></span>
                <span className="sb-label">{navLabel(t, item)}</span>
              </NavLink>
            );
          })}
        </div>
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

  const ctxItems = server ? serverNav(server) : [];
  const playersItem = ctxItems.find((i) => i.id === 'players');
  const fallback = servers.find((s) => s.key === lastServer) || serverOrder[0];
  const mobileTabs = [
    { to: '/home', end: true, label: t('nav.overview'), icon: 'dashboard' },
    server
      ? { to: server.to, label: 'Server', icon: 'layers', match: true }
      : fallback ? { to: fallback.to, label: 'Server', icon: 'layers' } : { to: '/instances/new', label: 'Neu', icon: 'plus' },
    playersItem ? { to: playersItem.to, label: playersItem.label, icon: 'users' } : { to: '/settings', label: t('nav.settings'), icon: 'gear' },
  ];

  return (
    <div className="app" data-collapsed={collapsed ? '1' : '0'} data-drawer={drawer ? '1' : '0'}>
      {sidebar}
      <button type="button" className="sb-scrim" aria-label={t('common.close')} onClick={() => setDrawer(false)} />

      <div className="app-main">
        <header className="tb">
          <button type="button" className="tb-burger" aria-label={t('nav.menu')} onClick={() => setDrawer(true)}>
            <NavIcon name="menu" />
          </button>
          <Link to="/home" className="tb-mark" aria-label="Orbit"><Mark size={30} /></Link>
          <nav className="tb-crumbs" aria-label="Breadcrumb">
            {server ? (
              <>
                <Link to={server.to} className="tb-crumb-server"><GameMark game={server.game} size={20} /><span>{server.name}</span></Link>
                {here.item && here.item.to !== server.to && (<><NavIcon name="chevron" /><span className="tb-crumb-page">{here.item.label}</span></>)}
              </>
            ) : (
              <>
                <span className="tb-crumb-group">Orbit</span>
                <NavIcon name="chevron" />
                <span className="tb-crumb-page">{here.item ? navLabel(t, here.item) : ''}</span>
              </>
            )}
          </nav>

          <button type="button" className="tb-search" onClick={() => setPaletteOpen(true)}>
            <NavIcon name="search" />
            <span>{t('palette.trigger')}</span>
            <span className="tb-search-kbd"><kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
          </button>

          <div className="tb-end">
            {server ? (
              <Link to={playersItem?.to || server.to} className={`tb-live tone-${server.tone}`} title={`${server.name}: ${PHASE_LABEL[server.phase] || server.phase}`}>
                <i className="tb-live-dot" />
                <span className="tb-live-label">{PHASE_LABEL[server.phase] || server.phase}</span>
                <span className="tb-live-count"><NavIcon name="users" />{server.players ?? 0}</span>
              </Link>
            ) : (
              <Link to="/home" className={`tb-live tone-${online.length ? 'ok' : 'idle'}`} title="Server online">
                <i className="tb-live-dot" />
                <span className="tb-live-label">{online.length}/{servers.length} online</span>
                <span className="tb-live-count"><NavIcon name="users" />{totalPlayers}</span>
              </Link>
            )}

            {canControl && server && (server.game === 'minecraft' || server.active) && (
              <div className="tb-pop-wrap" ref={powerRef}>
                <button
                  type="button"
                  className={`tb-icon tb-power tone-${server.tone}${powerOpen ? ' on' : ''}`}
                  aria-expanded={powerOpen}
                  title={t('shell.serverControls')}
                  onClick={() => setPowerOpen((v) => !v)}
                >
                  <NavIcon name="power" />
                </button>
                {powerOpen && (
                  <div className="pop tb-power-pop" role="menu">
                    <div className="pop-title">
                      <b>{server.name}</b>
                      <small className="mono">{server.game === 'fivem' ? fx.hostname : server.sub}</small>
                    </div>
                    {server.game === 'fivem' ? (
                      <ServerControls
                        compact
                        status={fx.status}
                        controlEnabled={fx.controlEnabled}
                        canControl={canControl}
                        fxControlMode={fx.fxControlMode}
                        fxCommandReady={fx.fxCommandReady}
                        onDone={() => { refreshFx(); setPowerOpen(false); }}
                      />
                    ) : (
                      <McPower server={server} onDone={() => { refresh(); setPowerOpen(false); }} />
                    )}
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

        {server && ctxItems.length > 1 && (
          <nav className="ctx-tabs" aria-label={server.name}>
            {ctxItems.map((item) => (
              <Link key={item.id} to={item.to} className={navMatches(item, loc.pathname, loc.search) ? 'active' : ''}>
                <NavIcon name={item.icon} />{item.label}
              </Link>
            ))}
          </nav>
        )}

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
            refreshStatus: refreshFx,
            refreshServers: refresh,
            servers,
            fxMeta: { fxControlMode: fx.fxControlMode, fxCommandReady: fx.fxCommandReady },
            serverStatus: fx.status,
            controlEnabled: fx.controlEnabled,
            live: { clients: fx.clients, maxClients: fx.maxClients, hostname: fx.hostname, serverLabel: fx.serverLabel },
          }} />
        </main>
      </div>

      <nav className="mtab" aria-label={t('nav.main')}>
        {mobileTabs.map((item) => (
          <NavLink key={item.label} to={item.to} end={!!item.end} className={({ isActive }) => `mtab-item${isActive || (item.match && here.scope === 'server' && item.to === server?.to && !playersItem?.to.endsWith(loc.pathname)) ? ' active' : ''}`}>
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
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
        status={fx.status}
        onLogout={onLogout}
        onShortcuts={() => setKeysOpen(true)}
        refreshStatus={refreshFx}
        groups={groups}
        servers={servers}
        mcList={mcList}
      />
      <ShortcutsDialog open={keysOpen} onClose={() => setKeysOpen(false)} modules={groups} isOwner={isOwner} mac={IS_MAC} />
      <Toaster />
    </div>
  );
}

/** Start/Stopp/Neustart für Minecraft-Instanzen im Topbar-Popover */
function McPower({ server, onDone }) {
  const [busy, setBusy] = useState('');
  const running = server.phase === 'running' || server.phase === 'starting';
  const run = useCallback(async (action) => {
    setBusy(action);
    try {
      await api(`/api/mc/instances/${server.id}/control`, { method: 'POST', body: { action } });
      toast.ok(`${server.name}: ${action === 'start' ? 'startet' : action === 'stop' ? 'gestoppt' : action === 'kill' ? 'beendet' : 'Neustart'}`);
      onDone?.();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }, [server.id, server.name, onDone]);
  return (
    <div className="mc-power">
      <button type="button" className="btn btn-sm mc-power-start" disabled={!!busy || running} onClick={() => run('start')}><NavIcon name="play" />Start</button>
      <button type="button" className="btn btn-sm" disabled={!!busy || !running} onClick={() => run('restart')}><NavIcon name="restart" />Neustart</button>
      <button type="button" className="btn btn-sm btn-danger" disabled={!!busy || !running} onClick={() => run('stop')}><NavIcon name="stop" />Stopp</button>
      {running && <button type="button" className="mc-power-kill" disabled={!!busy} onClick={() => { if (window.confirm(`${server.name} hart beenden (ohne Speichern)?`)) run('kill'); }}>Hart beenden</button>}
    </div>
  );
}

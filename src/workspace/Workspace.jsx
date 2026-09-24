import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import LiveConsole from '../components/LiveConsole.jsx';
import ServerControls, { statusLabel, statusTone } from '../components/ServerControls.jsx';
import { Mark } from '../components/Ui.jsx';
import { useAppearance } from '../hooks/useAppearance.js';
import { NavIcon } from '../layout/icons.jsx';
import { MODULES } from '../layout/modules.js';
import { GROUPS, PRIMARY, pathInGroup } from './nav.js';

const DOCK_LEFT = [
  { to: '/players', label: 'Spieler', icon: 'users' },
  { to: '/resources', label: 'Scripts', icon: 'box' },
];

/** Bereits in der unteren Toolbar — nicht nochmal unter „Mehr“. */
const DOCK_PATHS = new Set([
  '/panel',
  '/players',
  '/resources',
  '/console',
  ...DOCK_LEFT.map((i) => i.to),
]);

const RAIL_PRIMARY = new Set(['/panel', '/players', '/resources', '/monitoring', '/console']);

function RailLink({ to, end, icon, label, active, onClick, asButton, pressed, pri }) {
  const cls = `ws-rail-item${active ? ' active' : ''}`;
  const inner = (
    <>
      <span className="ws-rail-ico"><NavIcon name={icon} /></span>
      <span className="ws-rail-label">{label}</span>
    </>
  );
  if (asButton) {
    return (
      <button type="button" className={cls} data-pri={pri ? '1' : '0'} aria-pressed={pressed} title={label} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      data-pri={pri ? '1' : '0'}
      className={({ isActive }) => `ws-rail-item${(active ?? isActive) ? ' active' : ''}`}
      onClick={onClick}
    >
      {inner}
    </NavLink>
  );
}

function MoreSheet({ open, onClose, user, hideDockDuplicates }) {
  if (!open) return null;

  const columns = MODULES.map((group) => {
    const items = group.items.filter((item) => {
      if (item.owner && user.role !== 'owner') return false;
      if (hideDockDuplicates && DOCK_PATHS.has(item.to)) return false;
      return true;
    });
    const extra = [];
    if (group.id === 'ops') {
      extra.push({ to: '/ingame', label: 'Ingame', icon: 'cfg' });
    }
    return { ...group, items: [...items, ...extra] };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="ws-more-sheet" role="dialog" aria-label="Module">
      <button type="button" className="ws-more-backdrop" aria-label="Schließen" onClick={onClose} />
      <div className="ws-more-panel">
        <div className={`ws-more-grid ws-more-cols-${Math.min(columns.length, 3)}`}>
          {columns.map((group) => (
            <section key={group.id} className="ws-more-col">
              <h3>{group.label}</h3>
              <div className="ws-more-list">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className="ws-more-link" onClick={onClose}>
                    <NavIcon name={item.icon} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Workspace({ user, onLogout }) {
  const [status, setStatus] = useState('offline');
  const [live, setLive] = useState({ clients: 0, maxClients: 48, hostname: 'Server', serverLabel: 'Game Server' });
  const [controlEnabled, setControlEnabled] = useState(true);
  const [fxMeta, setFxMeta] = useState({ fxControlMode: 'systemd', fxCommandReady: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [dockShow, setDockShow] = useState(0);
  const [prefs, setAppearance] = useAppearance();
  const dockHover = useRef(false);
  const menuRef = useRef(null);
  const powerRef = useRef(null);
  const loc = useLocation();
  const isOwner = user.role === 'owner';
  const canControl = user.role === 'owner' || user.role === 'admin';
  const canConsole = user.role === 'owner' || user.role === 'admin';
  const onCockpit = loc.pathname === '/panel';
  const activeGroup = pathInGroup(loc.pathname);
  const isSidebar = prefs.navLayout === 'sidebar';
  const isDock = prefs.navLayout === 'dock';
  const isLight = prefs.theme === 'light';
  const moreActive = moreOpen || loc.pathname === '/more';

  const refreshStatus = useCallback(() => {
    if (document.hidden) return;
    api('/api/server/status')
      .then((d) => {
        setStatus(d.status || (d.online ? 'online' : 'offline'));
        setControlEnabled(d.controlEnabled !== false);
        setLive({
          clients: d.clients ?? 0,
          maxClients: d.maxClients ?? 48,
          hostname: d.hostname || 'Server',
          serverLabel: d.serverLabel || d.hostname || 'Game Server',
        });
        setFxMeta({
          fxControlMode: d.fxControlMode || 'systemd',
          fxCommandReady: !!d.fxCommandReady,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.body.classList.add('orbit-ws');
    return () => document.body.classList.remove('orbit-ws');
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 4000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    setMenuOpen(false);
    setPowerOpen(false);
    setOpenGroup(null);
    setMobileNav(false);
    setMoreOpen(false);
  }, [loc.pathname]);

  /* Auto-hide Dock: Nähe zum unteren Rand → smooth einblenden */
  useEffect(() => {
    if (!isDock) return undefined;
    let raf = 0;
    let target = 0;
    let current = 0;
    const apply = () => {
      raf = 0;
      current += (target - current) * 0.2;
      if (Math.abs(target - current) < 0.004) current = target;
      setDockShow(current);
      if (current !== target) raf = requestAnimationFrame(apply);
    };
    const aim = (v) => {
      target = powerOpen || moreOpen || dockHover.current ? 1 : v;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onMove = (e) => {
      const h = window.innerHeight || 1;
      const dist = h - e.clientY;
      const zone = 120;
      const raw = dist <= 8 ? 1 : dist >= zone ? 0 : 1 - (dist - 8) / (zone - 8);
      aim(raw * raw * (3 - 2 * raw));
    };
    const onLeave = () => {
      if (!(powerOpen || moreOpen || dockHover.current)) aim(0);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isDock, powerOpen, moreOpen]);

  useEffect(() => {
    if (!isDock) return;
    if (powerOpen || moreOpen) setDockShow(1);
  }, [isDock, powerOpen, moreOpen]);

  useEffect(() => {
    if (!menuOpen && !powerOpen && !openGroup) return undefined;
    const onPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (powerRef.current && !powerRef.current.contains(e.target)) setPowerOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen, powerOpen, openGroup]);

  const showSideConsole = canConsole && consoleOpen && !onCockpit;
  const consoleActive = consoleOpen || (canConsole && loc.pathname === '/console');

  const powerMenu = powerOpen && (
    <div className="power-menu ws-power-menu" role="menu">
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
  );

  const headerEnd = (
    <div className="ws-header-end" ref={menuRef}>
      <span className={`ws-status ws-tone-${statusTone(status)}`}>{statusLabel(status)}</span>
      <span className="ws-status">{live.clients}/{live.maxClients}</span>
      {canControl && !isSidebar && !isDock && (
        <div className="dock-power" ref={powerRef}>
          <button type="button" className="ws-btn-ghost" onClick={() => setPowerOpen((v) => !v)} title={live.hostname}>
            {live.serverLabel || 'Server'}
          </button>
          {powerMenu}
        </div>
      )}
      {canConsole && !onCockpit && !isDock && (
        <button
          type="button"
          className={`ws-btn-ghost${showSideConsole ? ' active' : ''}`}
          onClick={() => setConsoleOpen((v) => !v)}
        >
          Konsole
        </button>
      )}
      <button type="button" className="ws-user" onClick={() => setMenuOpen((v) => !v)}>
        {user.username}
      </button>
      {menuOpen && (
        <div className="profile-menu ws-profile-menu">
          <Link to="/settings" className="pm-item" onClick={() => setMenuOpen(false)}>Einstellungen</Link>
          <button type="button" className="pm-item" onClick={() => { setMenuOpen(false); setMoreOpen(true); }}>Module</button>
          <button type="button" className="pm-item pm-logout" onClick={() => { setMenuOpen(false); onLogout(); }}>Abmelden</button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="ws"
      data-console={showSideConsole ? '1' : '0'}
      data-cockpit={onCockpit ? '1' : '0'}
      data-nav={prefs.navLayout}
      data-sidebar={prefs.sidebarCollapsed ? 'collapsed' : 'expanded'}
    >
      {isSidebar && (
        <aside className="ws-rail" aria-label="Hauptnavigation">
          <div className="ws-rail-top">
            <NavLink to="/panel" className="ws-rail-brand" title="Orbit">
              <Mark />
              <span className="ws-rail-brand-text">
                <b>Orbit</b>
                <small>{user.username}</small>
              </span>
            </NavLink>
            <button
              type="button"
              className="ws-rail-collapse"
              aria-label={prefs.sidebarCollapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
              onClick={() => setAppearance({ sidebarCollapsed: !prefs.sidebarCollapsed })}
            >
              <NavIcon name={prefs.sidebarCollapsed ? 'expand' : 'collapse'} />
            </button>
          </div>

          <nav className="ws-rail-nav">
            {MODULES.map((group) => (
              <div key={group.id} className="ws-rail-group">
                <span className="ws-rail-group-label">{group.label}</span>
                {group.items.map((item) => {
                  if (item.owner && !isOwner) return null;
                  if (item.consoleRoute && canConsole && !onCockpit) {
                    return (
                      <RailLink
                        key={item.to}
                        asButton
                        icon={item.icon}
                        label={item.label}
                        pri={RAIL_PRIMARY.has(item.to)}
                        active={consoleActive}
                        pressed={consoleOpen}
                        onClick={() => setConsoleOpen((v) => !v)}
                      />
                    );
                  }
                  return (
                    <RailLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      icon={item.icon}
                      label={item.label}
                      pri={RAIL_PRIMARY.has(item.to)}
                      active={item.end ? onCockpit : undefined}
                    />
                  );
                })}
              </div>
            ))}
            <div className="ws-rail-group">
              <span className="ws-rail-group-label">Extra</span>
              <RailLink to="/ingame" icon="cfg" label="Ingame" pri={false} />
              {canControl && (
                <div className="ws-rail-power" ref={powerRef}>
                  <RailLink
                    asButton
                    icon="power"
                    label="Power"
                    pri
                    active={powerOpen}
                    pressed={powerOpen}
                    onClick={() => { setPowerOpen((v) => !v); setMenuOpen(false); }}
                  />
                  {powerMenu}
                </div>
              )}
              <RailLink
                asButton
                icon="more"
                label="Module"
                pri
                active={moreOpen}
                pressed={moreOpen}
                onClick={() => setMoreOpen(true)}
              />
            </div>
          </nav>

          <div className="ws-rail-foot">
            <button
              type="button"
              className={`ws-rail-theme${isLight ? ' on' : ''}`}
              aria-pressed={isLight}
              title={isLight ? 'Dunkelmodus' : 'Hellmodus'}
              onClick={() => setAppearance({ theme: isLight ? 'dark' : 'light' })}
            >
              <span className="ws-rail-ico"><NavIcon name={isLight ? 'moon' : 'sun'} /></span>
              <span className="ws-rail-label">{isLight ? 'Dunkelmodus' : 'Hellmodus'}</span>
              <span className="ws-rail-switch" aria-hidden="true"><i /></span>
            </button>
            <button type="button" className="ws-rail-item" title="Abmelden" onClick={onLogout}>
              <span className="ws-rail-ico"><NavIcon name="logout" /></span>
              <span className="ws-rail-label">Logout</span>
            </button>
          </div>
        </aside>
      )}

      <div className="ws-column">
        <header className="ws-header">
          <div className="ws-header-start">
            {!isSidebar && (
              <button type="button" className="ws-burger" aria-label="Menü" onClick={() => setMoreOpen(true)}>
                <span /><span /><span />
              </button>
            )}
            <NavLink to="/panel" className="ws-logo">
              <Mark />
              <span>Orbit</span>
            </NavLink>
          </div>

          {!isSidebar && !isDock && (
            <nav className="ws-nav" aria-label="Module">
              {PRIMARY.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `ws-nav-link${isActive ? ' active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
              {GROUPS.map((group) => (
                <div key={group.id} className="ws-nav-drop">
                  <button
                    type="button"
                    className={`ws-nav-link ws-nav-drop-btn${activeGroup === group.id ? ' active' : ''}`}
                    onClick={() => setOpenGroup((g) => (g === group.id ? null : group.id))}
                  >
                    {group.label}
                  </button>
                  {openGroup === group.id && (
                    <div className="ws-drop-panel">
                      {group.items.map((item) => {
                        if (item.owner && !isOwner) return null;
                        return (
                          <NavLink key={item.to} to={item.to} className="ws-drop-item" onClick={() => setOpenGroup(null)}>
                            {item.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          )}

          {headerEnd}
        </header>

        {user.mustChange && (
          <div className="ws-banner">Passwort unter <Link to="/settings">Einstellungen</Link> ändern.</div>
        )}

        <div className="ws-body">
          <main className="ws-main">
            <Outlet context={{
              onLogout,
              user,
              openConsole: () => setConsoleOpen(true),
              refreshStatus,
              fxMeta,
              serverStatus: status,
              controlEnabled,
              live,
            }} />
          </main>
          {showSideConsole && (
            <aside className="ws-console-pane" aria-label="Live-Konsole">
              <LiveConsole variant="side" open onClose={() => setConsoleOpen(false)} />
            </aside>
          )}
        </div>

        {isDock && (
          <nav
            className={`ws-dock${dockShow > 0.08 ? ' is-hot' : ''}`}
            aria-label="Hauptnavigation"
            style={{ ['--dock-show']: String(dockShow) }}
            onMouseEnter={() => { dockHover.current = true; setDockShow(1); }}
            onMouseLeave={() => { dockHover.current = false; }}
          >
            <div className="ws-dock-side">
              {DOCK_LEFT.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `ws-dock-item${isActive ? ' active' : ''}`}
                >
                  <span className="ws-dock-ico"><NavIcon name={item.icon} /></span>
                  <span className="ws-dock-label">{item.label}</span>
                </NavLink>
              ))}
              {canConsole && !onCockpit && (
                <button
                  type="button"
                  className={`ws-dock-item${consoleActive ? ' active' : ''}`}
                  aria-pressed={consoleOpen}
                  onClick={() => setConsoleOpen((v) => !v)}
                >
                  <span className="ws-dock-ico"><NavIcon name="term" /></span>
                  <span className="ws-dock-label">Konsole</span>
                </button>
              )}
            </div>

            <NavLink to="/panel" end className={`ws-dock-item ws-dock-home${onCockpit ? ' active' : ''}`}>
              <span className="ws-dock-ico"><NavIcon name="home" /></span>
              <span className="ws-dock-label">Home</span>
            </NavLink>

            <div className="ws-dock-side">
              {canControl && (
                <div className="ws-dock-power" ref={powerRef}>
                  <button
                    type="button"
                    className={`ws-dock-item${powerOpen ? ' active' : ''}`}
                    aria-expanded={powerOpen}
                    onClick={() => { setPowerOpen((v) => !v); setMenuOpen(false); }}
                  >
                    <span className="ws-dock-ico"><NavIcon name="power" /></span>
                    <span className="ws-dock-label">Power</span>
                  </button>
                  {powerMenu}
                </div>
              )}
              <button
                type="button"
                className={`ws-dock-item${moreActive ? ' active' : ''}`}
                onClick={() => setMoreOpen(true)}
              >
                <span className="ws-dock-ico"><NavIcon name="more" /></span>
                <span className="ws-dock-label">Mehr</span>
              </button>
            </div>
          </nav>
        )}
      </div>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        user={user}
        hideDockDuplicates={isDock}
      />
    </div>
  );
}

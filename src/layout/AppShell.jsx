import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, sameJson } from '../api.js';
import ServerControls from '../components/ServerControls.jsx';
import { Mark } from '../components/Ui.jsx';
import { NavIcon } from './icons.jsx';
import { MODULES } from './modules.js';

const MOBILE_TABS = [
  { to: '/panel', end: true, label: 'Home', icon: 'home' },
  { to: '/players', label: 'Spieler', icon: 'users' },
  { to: '/resources', label: 'Scripts', icon: 'box' },
  { to: '/monitoring', label: 'Monitor', icon: 'chart' },
  { to: '/more', label: 'Menü', icon: 'more' },
];

export default function AppShell({ user, onLogout }) {
  const [status, setStatus] = useState('offline');
  const [live, setLive] = useState({ clients: 0, hostname: 'Server', maxClients: 48 });
  const [controlEnabled, setControlEnabled] = useState(true);
  const [fxMeta, setFxMeta] = useState({
    fxControlMode: 'systemd',
    fxCommandReady: false,
    online: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const menuRef = useRef(null);
  const powerRef = useRef(null);
  const loc = useLocation();
  const isOwner = user.role === 'owner';
  const canControl = user.role === 'owner' || user.role === 'admin';

  const refreshStatus = useCallback(() => {
    if (document.hidden) return;
    api('/api/server/status')
      .then((d) => {
        const nextStatus = d.status || (d.online ? 'online' : 'offline');
        const nextLive = {
          clients: d.clients ?? 0,
          hostname: d.hostname || 'Server',
          maxClients: d.maxClients ?? 48,
        };
        const nextFx = {
          fxControlMode: d.fxControlMode || 'systemd',
          fxCommandReady: !!d.fxCommandReady,
          online: !!d.online,
        };
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
    const id = setInterval(refreshStatus, 10_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => { setMenuOpen(false); setPowerOpen(false); }, [loc.pathname]);

  useEffect(() => {
    if (!menuOpen && !powerOpen) return undefined;
    const onPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (powerRef.current && !powerRef.current.contains(e.target)) setPowerOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen, powerOpen]);

  return (
    <div className="ob-app">
      <aside className="ob-aside" aria-label="Navigation">
        <NavLink to="/panel" className="ob-brand">
          <Mark />
          <span>Orbit</span>
        </NavLink>
        {MODULES.map((group) => (
          <div key={group.id}>
            <span className="ob-nav-label">{group.label}</span>
            {group.items.map((item) => {
              if (item.owner && !isOwner) return null;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `ob-nav-link${isActive ? ' active' : ''}`}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </aside>

      <div className="ob-main">
        <header className="ob-header">
          <div className="ob-status-row">
            <span className="ob-chip mono">{live.hostname}</span>
          </div>
          <div className="ob-header-actions" ref={menuRef}>
            {canControl && (
              <div className="dock-power" ref={powerRef}>
                <button type="button" className="btn btn-sm" onClick={() => setPowerOpen((v) => !v)}>
                  Server
                </button>
                {powerOpen && (
                  <div className="power-menu">
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
            <button type="button" className="ob-user" onClick={() => setMenuOpen((v) => !v)}>
              <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
              <span>{user.username}</span>
            </button>
            {menuOpen && (
              <div className="profile-menu">
                <Link to="/settings" className="pm-item" onClick={() => setMenuOpen(false)}>Einstellungen</Link>
                <button type="button" className="pm-item pm-logout" onClick={() => { setMenuOpen(false); onLogout(); }}>Abmelden</button>
              </div>
            )}
          </div>
        </header>

        {user.mustChange && (
          <div className="ob-alert">Passwort unter <Link to="/settings">Einstellungen</Link> ändern.</div>
        )}

        <main className="ob-content">
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

      <nav className="ob-tabbar" aria-label="Mobil">
        {MOBILE_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `ob-tab${isActive ? ' active' : ''}`}
          >
            <NavIcon name={tab.icon} />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

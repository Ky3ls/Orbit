import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { hydrateAppearanceFromServer } from './appearance.js';
import Shell from './components/Shell.jsx';
import { Mark } from './components/Ui.jsx';
import Admins from './pages/Admins.jsx';
import Audit from './pages/Audit.jsx';
import CfgEditor from './pages/CfgEditor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingame from './pages/Ingame.jsx';
import Install from './pages/Install.jsx';
import Login from './pages/Login.jsx';
import Database from './pages/Database.jsx';
import Monitoring from './pages/Monitoring.jsx';
import More from './pages/More.jsx';
import Players from './pages/Players.jsx';
import Resources from './pages/Resources.jsx';
import Schedule from './pages/Schedule.jsx';
import ServerLog from './pages/ServerLog.jsx';
import Settings from './pages/Settings.jsx';
import Setup from './pages/Setup.jsx';

const PANEL_PREFIXES = [
  '/panel', '/monitoring', '/console', '/players', '/history', '/drops',
  '/bans', '/whitelist', '/resources', '/schedule', '/server-log', '/cfg',
  '/audit', '/admins', '/ingame', '/database', '/more', '/setup', '/settings',
];

function isPanelPath(pathname) {
  return PANEL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function PlayersRedirect({ filter }) {
  const q = filter ? `?filter=${encodeURIComponent(filter)}` : '';
  return <Navigate to={`/players${q}`} replace />;
}

export default function App() {
  const [boot, setBoot] = useState(undefined);
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    api('/api/bootstrap')
      .then((data) => {
        if (cancelled) return;
        setBoot(data);
        if (data.needsMaster) {
          setSession(null);
          return;
        }
        if ('user' in data) {
          setSession(data.user ? { user: data.user, setup: !!data.setup } : null);
          if (data.language) {
            try {
              window.dispatchEvent(new CustomEvent('orbit:set-language', { detail: data.language }));
            } catch { /* */ }
          }
          return;
        }
        return api('/api/auth/me')
          .then((d) => {
            if (!cancelled) setSession({ user: d.user, setup: !!d.setup });
          })
          .catch(() => {
            if (!cancelled) setSession(null);
          });
      })
      .catch(() => {
        if (cancelled) return;
        setBoot({ needsMaster: true, masterPhase: 'pin', setup: false, hasUsers: false, brand: 'Orbit' });
        setSession(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const u = session?.user;
    if (!u?.id) return undefined;
    hydrateAppearanceFromServer(api, u.id, u.prefs ?? null).catch(() => {});
    return undefined;
  }, [session?.user?.id]);

  if (boot === undefined || session === undefined) {
    return (
      <div className="boot">
        <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
        <Mark />
      </div>
    );
  }

  if (boot.needsMaster) {
    return (
      <Routes>
        <Route
          path="/install"
          element={(
            <Install
              phase={boot.masterPhase || 'pin'}
              pendingCfx={boot.pendingCfx}
              setupPin={boot.setupPin || null}
              onPhaseRefresh={() => {
                api('/api/bootstrap').then((data) => {
                  setBoot(data);
                  setSession(null);
                }).catch(() => {});
              }}
              onMasterDone={(data) => {
                setBoot({ ...boot, needsMaster: false, hasUsers: true, masterPhase: 'done', setupPin: null });
                setSession({ user: data.user, setup: false });
              }}
            />
          )}
        />
        <Route path="*" element={<Navigate to="/install" replace />} />
      </Routes>
    );
  }

  const authed = !!session;
  const setupOk = !!session?.setup;

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={authed ? (setupOk ? '/panel' : '/setup') : '/login'} replace />}
      />
      <Route path="/install" element={<Navigate to={authed ? (setupOk ? '/panel' : '/setup') : '/login'} replace />} />
      <Route
        path="/login"
        element={
          authed
            ? <LoginRedirect setupOk={setupOk} />
            : <Login onUser={(data) => setSession({ user: data.user, setup: !!data.setup })} />
        }
      />

      {authed ? (
        <Route element={<Authed session={session} setSession={setSession} />}>
          <Route path="panel" element={setupOk ? <Dashboard /> : <Navigate to="/setup" replace />} />
          <Route path="monitoring" element={setupOk ? <Monitoring /> : <Navigate to="/setup" replace />} />
          <Route path="console" element={<Navigate to="/panel" replace />} />
          <Route path="players" element={setupOk ? <Players user={session.user} /> : <Navigate to="/setup" replace />} />
          <Route path="history" element={setupOk ? <PlayersRedirect /> : <Navigate to="/setup" replace />} />
          <Route path="drops" element={setupOk ? <PlayersRedirect /> : <Navigate to="/setup" replace />} />
          <Route path="bans" element={setupOk ? <PlayersRedirect filter="banned" /> : <Navigate to="/setup" replace />} />
          <Route path="whitelist" element={setupOk ? <PlayersRedirect filter="allowlist" /> : <Navigate to="/setup" replace />} />
          <Route path="resources" element={setupOk ? <Resources /> : <Navigate to="/setup" replace />} />
          <Route path="schedule" element={setupOk ? <Schedule /> : <Navigate to="/setup" replace />} />
          <Route path="server-log" element={setupOk ? <ServerLog /> : <Navigate to="/setup" replace />} />
          <Route path="cfg" element={setupOk ? <CfgEditor /> : <Navigate to="/setup" replace />} />
          <Route path="audit" element={setupOk ? <Audit /> : <Navigate to="/setup" replace />} />
          <Route path="admins" element={setupOk ? <Admins /> : <Navigate to="/setup" replace />} />
          <Route path="ingame" element={setupOk ? <Ingame user={session.user} /> : <Navigate to="/setup" replace />} />
          <Route path="platform" element={<Navigate to="/settings?section=host&tab=servers" replace />} />
          <Route path="database" element={setupOk ? <Database user={session.user} /> : <Navigate to="/setup" replace />} />
          <Route path="more" element={setupOk ? <More /> : <Navigate to="/setup" replace />} />
          <Route path="setup" element={setupOk ? <Navigate to="/panel" replace /> : <Setup userName={session.user?.cfxName || session.user?.username || ''} onDone={() => { setSession({ ...session, setup: true }); window.location.assign('/panel'); }} />} />
          <Route
            path="settings"
            element={
              <Settings
                user={session.user}
                onUser={(user) => setSession({ ...session, user })}
                onSetupReset={() => {
                  setSession({ ...session, setup: false });
                  window.location.assign('/setup');
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to={setupOk ? '/panel' : '/setup'} replace />} />
        </Route>
      ) : (
        <Route path="*" element={<GuestFallback />} />
      )}
    </Routes>
  );
}

/** Unauthentifiziert → Login. */
function GuestFallback() {
  const location = useLocation();
  if (isPanelPath(location.pathname)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Navigate to="/login" replace />;
}

function LoginRedirect({ setupOk }) {
  const location = useLocation();
  const dest = setupOk
    ? (isPanelPath(location.state?.from || '') ? location.state.from : '/panel')
    : '/setup';
  return <Navigate to={dest} replace />;
}

function Authed({ session, setSession }) {
  const navigate = useNavigate();
  async function onLogout() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setSession(null);
    navigate('/login');
  }
  function finishSetup() {
    setSession({ ...session, setup: true });
    navigate('/panel', { replace: true });
  }
  if (!session.setup) {
    return <Setup userName={session.user?.cfxName || session.user?.username || ''} onDone={finishSetup} />;
  }
  return <Shell user={session.user} onLogout={onLogout} />;
}

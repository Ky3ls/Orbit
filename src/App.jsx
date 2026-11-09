import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { hydrateAppearanceFromServer } from './appearance.js';
import Shell from './components/Shell.jsx';
import { Mark, Page } from './components/Ui.jsx';
import GameMark from './components/GameMark.jsx';
import Admins from './pages/Admins.jsx';
import Audit from './pages/Audit.jsx';
import CfgEditor from './pages/CfgEditor.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Home from './pages/Home.jsx';
import NewServer from './pages/NewServer.jsx';
import Welcome from './pages/Welcome.jsx';
import HostDatabases from './pages/host/Databases.jsx';
import HostServices from './pages/host/Services.jsx';
import HostWeb from './pages/host/Web.jsx';
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
import McCreate from './pages/mc/McCreate.jsx';
import McImport from './pages/mc/McImport.jsx';
import McInstance from './pages/mc/McInstance.jsx';
import Setup from './pages/Setup.jsx';

const PANEL_PREFIXES = [
  '/home', '/welcome', '/host', '/panel', '/monitoring', '/console', '/players', '/history', '/drops',
  '/bans', '/whitelist', '/resources', '/schedule', '/server-log', '/cfg',
  '/audit', '/admins', '/ingame', '/database', '/more', '/setup', '/settings', '/instances', '/mc',
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
                window.history.replaceState(null, '', '/welcome');
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
        element={<Navigate to={authed ? '/home' : '/login'} replace />}
      />
      <Route path="/install" element={<Navigate to={authed ? '/welcome' : '/login'} replace />} />
      <Route path="/welcome" element={authed ? <Welcome user={session.user} /> : <Navigate to="/login" replace />} />
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
          <Route path="panel" element={setupOk ? <Dashboard /> : <FxNotSetup />} />
          <Route path="monitoring" element={setupOk ? <Monitoring /> : <FxNotSetup />} />
          <Route path="console" element={<Navigate to="/panel" replace />} />
          <Route path="players" element={setupOk ? <Players user={session.user} /> : <FxNotSetup />} />
          <Route path="history" element={setupOk ? <PlayersRedirect /> : <FxNotSetup />} />
          <Route path="drops" element={setupOk ? <PlayersRedirect /> : <FxNotSetup />} />
          <Route path="bans" element={setupOk ? <PlayersRedirect filter="banned" /> : <FxNotSetup />} />
          <Route path="whitelist" element={setupOk ? <PlayersRedirect filter="allowlist" /> : <FxNotSetup />} />
          <Route path="resources" element={setupOk ? <Resources /> : <FxNotSetup />} />
          <Route path="schedule" element={setupOk ? <Schedule /> : <FxNotSetup />} />
          <Route path="server-log" element={setupOk ? <ServerLog /> : <FxNotSetup />} />
          <Route path="cfg" element={setupOk ? <CfgEditor /> : <FxNotSetup />} />
          <Route path="audit" element={<Audit />} />
          <Route path="admins" element={<Admins user={session.user} />} />
          <Route path="ingame" element={setupOk ? <Ingame user={session.user} /> : <FxNotSetup />} />
          <Route path="platform" element={<Navigate to="/settings?section=host&tab=servers" replace />} />
          <Route path="database" element={setupOk ? <Database user={session.user} /> : <FxNotSetup />} />
          <Route path="home" element={<Home />} />
          <Route path="host" element={<Navigate to="/host/services" replace />} />
          <Route path="host/databases" element={<HostDatabases />} />
          <Route path="host/web" element={<HostWeb />} />
          <Route path="host/services" element={<HostServices />} />
          <Route path="instances" element={<Navigate to="/home" replace />} />
          <Route path="instances/new" element={<NewServer />} />
          <Route path="instances/new/minecraft" element={<McCreate />} />
          <Route path="instances/import" element={<McImport />} />
          <Route path="mc/:id" element={<McInstance />} />
          <Route path="mc/:id/:tab" element={<McInstance />} />
          <Route path="more" element={<More />} />
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
          <Route path="*" element={<Navigate to="/home" replace />} />
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
  const dest = isPanelPath(location.state?.from || '') ? location.state.from : '/home';
  return <Navigate to={dest} replace />;
}

function Authed({ session, setSession }) {
  const navigate = useNavigate();
  const location = useLocation();
  async function onLogout() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setSession(null);
    navigate('/login');
  }
  function finishSetup() {
    setSession({ ...session, setup: true });
    navigate('/panel', { replace: true });
  }
  if (location.pathname === '/welcome') {
    return <Welcome user={session.user} />;
  }
  if (!session.setup && location.pathname === '/setup') {
    return <Setup userName={session.user?.cfxName || session.user?.username || ''} onDone={finishSetup} />;
  }
  return <Shell user={session.user} onLogout={onLogout} />;
}

/** FiveM-Seiten, solange FiveM noch nicht eingerichtet ist */
function FxNotSetup() {
  return (
    <Page>
      <div className="card fx-unset">
        <GameMark game="fivem" size={56} />
        <h2>FiveM ist noch nicht eingerichtet</h2>
        <p>Orbit läuft auch ohne FiveM — richte es ein, sobald du einen FXServer hosten willst.</p>
        <div className="fx-unset-acts">
          <Link to="/setup" className="btn btn-primary">FiveM einrichten</Link>
          <Link to="/home" className="btn">Zur Übersicht</Link>
        </div>
      </div>
    </Page>
  );
}

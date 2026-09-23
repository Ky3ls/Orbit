import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Mark } from '../components/Ui.jsx';

const HINTS = {
  unknown: 'Dieses Cfx.re-Konto ist noch keinem Team-Account zugeordnet. Einmal mit Passwort anmelden und unter Einstellungen verbinden.',
  error: 'Cfx.re hat die Anmeldung nicht abgeschlossen.',
  rate: 'Zu viele Cfx-Versuche. Kurz warten.',
  locked: 'Anmeldung vorübergehend gesperrt.',
};

export default function Login({ onUser }) {
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState(params.get('totp') === '1');
  const [err, setErr] = useState(HINTS[params.get('cfx')] || '');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (!totp) {
        const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
        if (data.totpRequired) setTotp(true);
        else onUser(data);
      } else {
        const data = await api('/api/auth/totp', { method: 'POST', body: { code } });
        onUser(data);
      }
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen login-page">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <form className="login-card login-box login-page-card" onSubmit={submit}>
        <Link to="/" className="brand-link"><Mark /> Orbit</Link>
        <h2>{totp ? 'Zweiter Faktor' : 'Anmelden'}</h2>
        <p className="sub">{totp ? 'Code aus der Authenticator-App.' : 'Team-Account. Cfx.re funktioniert nach der Verknüpfung unter Einstellungen.'}</p>
        {err && <div className="err">{err}</div>}
        {!totp && <a className="btn cfx" href="/api/auth/cfx/start?mode=login">Mit Cfx.re anmelden</a>}
        {!totp && <div className="or">oder mit Passwort</div>}
        {!totp ? (
          <>
            <label className="field"><span>Benutzer</span><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label className="field"><span>Passwort</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </>
        ) : (
          <label className="field"><span>Code</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        )}
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Prüfe…' : totp ? 'Bestätigen' : 'Anmelden'}</button>
      </form>
    </div>
  );
}

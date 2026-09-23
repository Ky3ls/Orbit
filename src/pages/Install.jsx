import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Mark } from '../components/Ui.jsx';

export default function Install({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) {
      setErr('Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/api/bootstrap/master', { method: 'POST', body: { username, password } });
      onDone(data);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="wizard-card">
        <div className="brand-link"><Mark /> Orbit</div>
        <p className="eyebrow">Schritt 1 von 2</p>
        <h1>Master-Account</h1>
        <p className="lede">Als Erstes brauchst du den Inhaber-Account. Danach richtest du den FiveM-Server ein. Cfx.re kannst du später verknüpfen.</p>
        {err && <div className="err">{err}</div>}
        <form onSubmit={submit}>
          <label className="field"><span>Benutzername</span><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="z. B. ky3ls" /></label>
          <label className="field"><span>Passwort</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mind. 12 Zeichen" /></label>
          <label className="field"><span>Passwort wiederholen</span><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Lege an…' : 'Master anlegen'}</button>
        </form>
        <p className="muted" style={{ marginTop: 14 }}>Schon eingerichtet? <Link to="/login">Anmelden</Link></p>
      </div>
    </div>
  );
}

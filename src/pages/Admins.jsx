import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull, roleLabel } from '../format.js';
import { Badge, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Admins() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'moderator' });
  const [err, setErr] = useState('');

  function load() { api('/api/admins').then((d) => setUsers(d.users)).catch((e) => setErr(e.message)); }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/admins', { method: 'POST', body: form });
      setForm({ username: '', password: '', role: 'moderator' });
      load();
    } catch (error) { setErr(error.message); }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Team"
        description="Nur der Inhaber legt Accounts an. Passwörter brauchen 12 Zeichen, einen Buchstaben und eine Zahl."
      />
      {err && <div className="err">{err}</div>}
      <PanelCard>
        <form className="row" onSubmit={create}>
          <input placeholder="Benutzer" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Passwort" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Anlegen</button>
        </form>
      </PanelCard>
      <PanelCard padded={false}>
        <div className="table-wrap">
          <table className="o-table">
            <thead><tr><th>Benutzer</th><th>Rolle</th><th>2FA</th><th>Login</th><th></th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="name" data-label="Benutzer">{user.username}</td>
                  <td data-label="Rolle"><Badge tone={user.role === 'owner' ? 'info' : ''}>{roleLabel(user.role)}</Badge></td>
                  <td data-label="2FA">{user.totp_enabled ? 'an' : 'aus'}</td>
                  <td data-label="Login">{fmtFull(user.last_login)}</td>
                  <td className="td-actions" data-label="">
                    {user.role !== 'owner' && (
                      <button className="btn btn-sm" type="button" onClick={() => api(`/api/admins/${user.id}`, { method: 'PATCH', body: { disabled: !user.disabled } }).then(load)}>
                        {user.disabled ? 'Aktivieren' : 'Sperren'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </Page>
  );
}

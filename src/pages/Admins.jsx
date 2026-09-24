import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtFull, roleLabel } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import './team.css';

const EMPTY_FORM = { username: '', password: '', role: 'moderator', permissions: [] };

export default function Admins() {
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ groups: [], templates: {} });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  function load() {
    api('/api/admins')
      .then((d) => {
        setUsers(d.users || []);
        setCatalog(d.catalog || { groups: [], templates: {} });
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setErr('');
    setForm({
      ...EMPTY_FORM,
      permissions: [...(catalog.templates?.moderator || [])],
    });
    setCreateOpen(true);
  }

  function openEdit(user) {
    setErr('');
    setEdit(user);
    setForm({
      username: user.username,
      password: '',
      role: user.role === 'owner' ? 'owner' : user.role,
      permissions: [...(user.permissions || [])].filter((p) => p !== '*'),
    });
  }

  function applyRoleTemplate(role) {
    setForm((f) => ({
      ...f,
      role,
      permissions: role === 'custom'
        ? f.permissions
        : [...(catalog.templates?.[role] || [])],
    }));
  }

  function togglePerm(id) {
    setForm((f) => {
      const has = f.permissions.includes(id);
      const permissions = has ? f.permissions.filter((p) => p !== id) : [...f.permissions, id];
      return { ...f, role: 'custom', permissions };
    });
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/admins', {
        method: 'POST',
        body: {
          username: form.username,
          password: form.password,
          role: form.role === 'custom' ? 'custom' : form.role,
          permissions: form.role === 'custom' ? form.permissions : undefined,
        },
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!edit || edit.role === 'owner') return;
    setBusy(true);
    setErr('');
    try {
      const body = {
        role: form.role,
        permissions: form.role === 'custom' ? form.permissions : null,
      };
      if (form.password.length >= 6) body.password = form.password;
      await api(`/api/admins/${edit.id}`, { method: 'PATCH', body });
      setEdit(null);
      load();
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  const members = useMemo(
    () => [...users].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.id - b.id)),
    [users],
  );

  const permGroups = catalog.groups || [];

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Team"
        description="Accounts, Rollen und granulare Rechte — angebunden an das Panel-Permission-System."
        actions={(
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Neuer Benutzer
          </button>
        )}
      />
      {err && !createOpen && !edit && <div className="err">{err}</div>}

      <div className="tm-grid">
        <PanelCard className="tm-module">
          <div className="tm-module-head">
            <div>
              <h3>Mitglieder</h3>
              <p className="muted">Klicke einen Account zum Bearbeiten.</p>
            </div>
            <Badge tone="info">{members.length}</Badge>
          </div>
          {members.length === 0 ? (
            <Empty title="Keine Accounts" text="Lege den ersten Moderator oder Admin an." />
          ) : (
            <div className="tm-list">
              {members.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`tm-card${user.disabled ? ' off' : ''}`}
                  onClick={() => user.role !== 'owner' && openEdit(user)}
                  disabled={user.role === 'owner'}
                >
                  <div className="tm-card-top">
                    <strong>{user.username}</strong>
                    <Badge tone={user.role === 'owner' ? 'info' : user.disabled ? 'bad' : ''}>
                      {roleLabel(user.role)}
                    </Badge>
                  </div>
                  <div className="tm-card-meta">
                    <span>2FA {user.totp_enabled ? 'an' : 'aus'}</span>
                    <span>Login {fmtFull(user.last_login)}</span>
                    {user.customPermissions && <span>individuelle Rechte</span>}
                  </div>
                  {user.role !== 'owner' && (
                    <div className="tm-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => api(`/api/admins/${user.id}`, {
                          method: 'PATCH',
                          body: { disabled: !user.disabled },
                        }).then(load)}
                      >
                        {user.disabled ? 'Aktivieren' : 'Sperren'}
                      </button>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard className="tm-module">
          <div className="tm-module-head">
            <div>
              <h3>Rollen-Vorlagen</h3>
              <p className="muted">Basisrechte — beim Anlegen/Editieren überschreibbar.</p>
            </div>
          </div>
          <div className="tm-roles">
            {['moderator', 'admin'].map((role) => (
              <div key={role} className="tm-role">
                <strong>{roleLabel(role)}</strong>
                <ul>
                  {(catalog.templates?.[role] || []).slice(0, 8).map((p) => (
                    <li key={p} className="mono">{p}</li>
                  ))}
                  {(catalog.templates?.[role] || []).length > 8 && (
                    <li className="muted">+{(catalog.templates[role].length - 8)} weitere</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>

      {(createOpen || edit) && (
        <Modal
          title={createOpen ? 'Neuer Benutzer' : `Bearbeiten: ${edit?.username}`}
          onClose={() => { setCreateOpen(false); setEdit(null); setErr(''); }}
          wide
        >
          <form className="tm-form" onSubmit={createOpen ? create : saveEdit}>
            {err && <div className="err">{err}</div>}
            {createOpen && (
              <label className="field">
                <span>Benutzername</span>
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="z. B. max.mod"
                />
              </label>
            )}
            <label className="field">
              <span>{createOpen ? 'Passwort' : 'Neues Passwort (optional)'}</span>
              <input
                type="text"
                required={createOpen}
                minLength={createOpen ? 6 : 0}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={createOpen ? 'mind. 6 Zeichen' : 'Leer = unverändert'}
              />
            </label>
            <label className="field">
              <span>Rolle</span>
              <select
                value={form.role}
                onChange={(e) => applyRoleTemplate(e.target.value)}
              >
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
                <option value="custom">Individuell</option>
              </select>
            </label>

            <div className="tm-perms">
              <h4>Berechtigungen</h4>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Vorlagen setzen die Haken; manuelle Änderung wechselt auf „Individuell“.
              </p>
              {permGroups.map((g) => (
                <fieldset key={g.id} className="tm-perm-group">
                  <legend>{g.label}</legend>
                  <div className="tm-perm-grid">
                    {g.permissions.map((perm) => (
                      <label key={perm.id} className="tm-perm">
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(perm.id)}
                          onChange={() => togglePerm(perm.id)}
                        />
                        <span>{perm.label}</span>
                        <code>{perm.id}</code>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => { setCreateOpen(false); setEdit(null); }}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {createOpen ? 'Anlegen' : 'Speichern'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

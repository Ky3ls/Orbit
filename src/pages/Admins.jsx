import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtFull, roleLabel } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import './team.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

const EMPTY_FORM = {
  username: '',
  password: '',
  role: 'moderator',
  permissions: [],
  cfxName: '',
  discordId: '',
};

export default function Admins() {
  const { t } = useI18n();
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
      cfxName: user.cfx_name || '',
      discordId: user.discord_id || '',
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
      const permissions = has ? f.permissions.filter((p) => p !== id) : [...(f.permissions), id];
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
          cfxName: form.cfxName || undefined,
          discordId: form.discordId || undefined,
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
        cfxName: form.cfxName,
        discordId: form.discordId,
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
        eyebrow={t('team.eyebrow')}
        title={t('page.admins')}
        description={t('team.desc')}
        actions={(
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            {t('team.newUser')}
          </button>
        )}
      />
      {err && !createOpen && !edit && <div className="err">{err}</div>}

      <div className="tm-grid">
        <PanelCard className="tm-module">
          <div className="tm-module-head">
            <div>
              <h3>{t('team.members')}</h3>
              <p className="muted">{t('team.membersHint')}</p>
            </div>
            <Badge tone="info">{members.length}</Badge>
          </div>
          {members.length === 0 ? (
            <Empty title={t('team.empty')} text={t('team.emptyText')} />
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
                    <span>{user.totp_enabled ? t('team.totpOn') : t('team.totpOff')}</span>
                    <span>{t('team.login', { when: fmtFull(user.last_login) })}</span>
                    {user.customPermissions && <span>{t('team.customPerms')}</span>}
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
                        {user.disabled ? t('team.enable') : t('team.lock')}
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
              <h3>{t('team.roleTpl')}</h3>
              <p className="muted">{t('team.roleTplHint')}</p>
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
                    <li className="muted">{t('team.more', { n: catalog.templates[role].length - 8 })}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>

      {(createOpen || edit) && (
        <Modal
          title={createOpen ? t('team.createTitle') : t('team.editTitle', { name: edit?.username })}
          onClose={() => { setCreateOpen(false); setEdit(null); setErr(''); }}
          wide
          aside={(
            <aside className="tm-identity-aside" aria-label={t('team.identity')}>
              <h4 className="tm-form-col-title">{t('team.identity')}</h4>
              {createOpen && (
                <label className="field">
                  <span>{t('team.username')}</span>
                  <input
                    form="tm-user-form"
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder={t('team.usernamePh')}
                  />
                </label>
              )}
              <label className="field">
                <span>{createOpen ? t('team.password') : t('team.newPassword')}</span>
                <input
                  form="tm-user-form"
                  type="text"
                  required={createOpen}
                  minLength={createOpen ? 6 : 0}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={createOpen ? t('team.pwPhCreate') : t('team.pwPhEdit')}
                />
              </label>
              <label className="field">
                <span>{t('team.cfx')}</span>
                <input
                  form="tm-user-form"
                  value={form.cfxName || ''}
                  onChange={(e) => setForm({ ...form, cfxName: e.target.value })}
                  placeholder={t('team.cfxPh')}
                />
              </label>
              <label className="field">
                <span>{t('team.discord')}</span>
                <input
                  form="tm-user-form"
                  value={form.discordId || ''}
                  onChange={(e) => setForm({ ...form, discordId: e.target.value })}
                  placeholder={t('team.discordPh')}
                />
              </label>
              <label className="field">
                <span>{t('team.role')}</span>
                <select
                  form="tm-user-form"
                  value={form.role}
                  onChange={(e) => applyRoleTemplate(e.target.value)}
                >
                  <option value="moderator">{t('role.mod')}</option>
                  <option value="admin">{t('role.admin')}</option>
                  <option value="custom">{t('role.custom')}</option>
                </select>
              </label>
            </aside>
          )}
        >
          <form id="tm-user-form" className="tm-form" onSubmit={createOpen ? create : saveEdit}>
            {err && <div className="err">{err}</div>}
            <div className="tm-perms">
              <h4 className="tm-form-col-title">{t('team.perms')}</h4>
              <p className="tm-perms-hint muted">
                {t('team.permsHint')}
              </p>
              <div className="tm-perms-body">
                {permGroups.map((g) => (
                  <fieldset key={g.id} className="tm-perm-group">
                    <legend>{g.label}</legend>
                    <div className="tm-perm-grid">
                      {g.permissions.map((perm) => (
                        <label key={perm.id} className={`tm-perm${perm.sensitive ? ' sensitive' : ''}`}>
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
            </div>

            <div className="tm-form-actions row">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {createOpen ? t('common.create') : t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

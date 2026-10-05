import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { roleLabel } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import './team.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

const EMPTY_FORM = {
  username: '',
  password: '',
  role: 'custom',
  permissions: [],
  cfxName: '',
  discordId: '',
};

function permLabel(t, id, fallback) {
  const key = `perm.${id}`;
  const label = t(key);
  return label === key ? (fallback || id) : label;
}

function groupLabel(t, id, fallback) {
  const key = `perm.group.${id}`;
  const label = t(key);
  return label === key ? (fallback || id) : label;
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function Admins({ user: me }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ groups: [], templates: {} });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createdCreds, setCreatedCreds] = useState(null);
  const [pwCopied, setPwCopied] = useState(false);

  function load() {
    api('/api/admins')
      .then((d) => {
        setUsers(d.users || []);
        setCatalog(d.catalog || { groups: [], templates: {} });
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  function allPermIds() {
    return catalog.all?.length
      ? [...catalog.all]
      : (catalog.groups || []).flatMap((g) => (g.permissions || []).map((p) => p.id));
  }

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
    const raw = [...(user.permissions || [])];
    const hasStar = raw.includes('*') || raw.includes('all_permissions');
    setForm({
      username: user.username,
      password: '',
      role: 'custom',
      permissions: hasStar ? allPermIds() : raw.filter((p) => p !== '*'),
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
      const ids = allPermIds();
      if (id === 'all_permissions') {
        const on = f.permissions.includes('all_permissions');
        return { ...f, role: 'custom', permissions: on ? [] : ids };
      }
      if (f.permissions.includes('all_permissions')) {
        const permissions = ids.filter((p) => p !== 'all_permissions' && p !== id);
        return { ...f, role: 'custom', permissions };
      }
      let permissions = f.permissions.includes(id)
        ? f.permissions.filter((p) => p !== id)
        : [...f.permissions, id];
      const singles = ids.filter((p) => p !== 'all_permissions');
      if (singles.length && singles.every((p) => permissions.includes(p))) {
        permissions = ids;
      }
      return { ...f, role: 'custom', permissions };
    });
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await api('/api/admins', {
        method: 'POST',
        body: {
          username: form.username,
          role: 'custom',
          permissions: form.permissions,
          cfxName: form.cfxName || undefined,
          discordId: form.discordId || undefined,
        },
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setErr('');
      if (res.password) {
        setCreatedCreds({ username: res.username || form.username, password: res.password });
        setPwCopied(false);
      }
      load();
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  async function copyCreatedPassword() {
    if (!createdCreds?.password) return;
    if (await copyText(createdCreds.password)) {
      setPwCopied(true);
      window.setTimeout(() => setPwCopied(false), 2000);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!edit || edit.role === 'owner') return;
    setBusy(true);
    setErr('');
    try {
      const body = {
        role: 'custom',
        permissions: form.permissions,
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

  function closeForm() {
    setCreateOpen(false);
    setEdit(null);
    setErr('');
  }

  function roleBadge(user) {
    if (user.role === 'owner') return t('team.masterAccount');
    const raw = user.permissions || [];
    if (raw.includes('*') || raw.includes('all_permissions')) return t('perm.all_permissions');
    if (user.role === 'admin' || user.role === 'moderator') return roleLabel(user.role);
    return t('role.custom');
  }

  /** Kurzüberblick: Rechte je Gruppe, sortiert. */
  function permPreview(user) {
    if (user.role === 'owner') return [];
    const raw = user.permissions || [];
    if (raw.includes('*') || raw.includes('all_permissions')) {
      return (catalog.groups || []).map((g) => ({
        id: g.id,
        label: groupLabel(t, g.id, g.label),
        n: (g.permissions || []).length,
        total: (g.permissions || []).length,
      }));
    }
    const set = new Set(raw);
    return (catalog.groups || [])
      .map((g) => {
        const ids = (g.permissions || []).map((p) => p.id).filter((id) => id !== 'all_permissions');
        const n = ids.filter((id) => set.has(id)).length;
        return {
          id: g.id,
          label: groupLabel(t, g.id, g.label),
          n,
          total: ids.length,
        };
      })
      .filter((g) => g.n > 0);
  }

  const members = useMemo(
    () => [...users].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.id - b.id)),
    [users],
  );

  const permGroups = catalog.groups || [];
  const hasAllPerms = form.permissions.includes('all_permissions');
  const formOpen = createOpen || !!edit;

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
      {err && !formOpen && !createdCreds && <div className="err">{err}</div>}

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
              {members.map((user) => {
                const isSelf = me && Number(me.id) === Number(user.id);
                const preview = permPreview(user);
                return (
                  <div
                    key={user.id}
                    className={`tm-card${user.disabled ? ' off' : ''}${user.role === 'owner' ? ' is-owner' : ''}`}
                  >
                    <div className="tm-card-top">
                      <strong>{user.username}</strong>
                      <Badge tone={user.role === 'owner' ? 'info' : user.disabled ? 'bad' : ''}>
                        {roleBadge(user)}
                      </Badge>
                    </div>

                    <div className="tm-card-ids">
                      {(user.cfx_name || user.cfx_id) && (
                        <span className="tm-chip mono" title={t('team.cfx')}>
                          {user.cfx_name || `fivem:${user.cfx_id}`}
                        </span>
                      )}
                      {user.discord_id && (
                        <span className="tm-chip mono" title={t('team.discord')}>
                          discord:{user.discord_id}
                        </span>
                      )}
                    </div>

                    {preview.length > 0 && (
                      <div className="tm-card-perms">
                        {preview.map((g) => (
                          <span key={g.id} className="tm-perm-pill">
                            {g.label}
                            <em>{g.n}/{g.total}</em>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="tm-card-actions">
                      {isSelf || user.role === 'owner' ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => navigate('/settings?section=account')}
                        >
                          {t('team.yourAccount')}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => openEdit(user)}>
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => api(`/api/admins/${user.id}`, {
                              method: 'PATCH',
                              body: { disabled: !user.disabled },
                            }).then(load)}
                          >
                            {user.disabled ? t('team.enable') : t('team.lock')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
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
              <button
                key={role}
                type="button"
                className="tm-role"
                onClick={() => {
                  setErr('');
                  setForm({
                    ...EMPTY_FORM,
                    role,
                    permissions: [...(catalog.templates?.[role] || [])],
                  });
                  setCreateOpen(true);
                }}
              >
                <strong>{roleLabel(role)}</strong>
                <ul>
                  {(catalog.templates?.[role] || []).slice(0, 6).map((p) => (
                    <li key={p}>{permLabel(t, p)}</li>
                  ))}
                  {(catalog.templates?.[role] || []).length > 6 && (
                    <li className="muted">{t('team.more', { n: catalog.templates[role].length - 6 })}</li>
                  )}
                </ul>
              </button>
            ))}
          </div>
        </PanelCard>
      </div>

      {formOpen && (
        <Modal
          title={createOpen ? t('team.createTitle') : t('team.editTitle', { name: edit?.username })}
          onClose={closeForm}
          aside={(
            <aside className="tm-perms-aside" aria-label={t('team.perms')}>
              <h4 className="tm-form-col-title">{t('team.perms')}</h4>
              <p className="tm-perms-hint muted">{t('team.permsHint')}</p>
              <div className="tm-perms-body">
                {permGroups.map((g) => (
                  <fieldset key={g.id} className="tm-perm-group">
                    <legend>{groupLabel(t, g.id, g.label)}</legend>
                    <div className="tm-perm-grid">
                      {(g.permissions || []).map((perm) => {
                        const isAll = perm.id === 'all_permissions';
                        const locked = hasAllPerms && !isAll;
                        const checked = hasAllPerms || form.permissions.includes(perm.id);
                        return (
                          <label
                            key={perm.id}
                            className={`tm-perm${perm.sensitive ? ' sensitive' : ''}${locked ? ' is-locked' : ''}`}
                            title={perm.id}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked}
                              onChange={() => togglePerm(perm.id)}
                            />
                            <span>{permLabel(t, perm.id, perm.label)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </aside>
          )}
        >
          <form className="tm-form" onSubmit={createOpen ? create : saveEdit}>
            {err && <div className="err">{err}</div>}
            <div className="tm-identity" aria-label={t('team.identity')}>
              <h4 className="tm-form-col-title">{t('team.identity')}</h4>
              {createOpen && (
                <label className="field">
                  <span>{t('team.username')} <em className="req">{t('common.required')}</em></span>
                  <input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder={t('team.usernamePh')}
                    autoComplete="off"
                  />
                </label>
              )}
              {!createOpen && (
                <label className="field">
                  <span>{t('team.newPassword')}</span>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={t('team.pwPhEdit')}
                  />
                </label>
              )}
              <label className="field">
                <span>{t('team.cfx')}</span>
                <input
                  value={form.cfxName || ''}
                  onChange={(e) => setForm({ ...form, cfxName: e.target.value })}
                  placeholder={t('team.cfxPh')}
                />
              </label>
              <label className="field">
                <span>{t('team.discord')}</span>
                <input
                  value={form.discordId || ''}
                  onChange={(e) => setForm({ ...form, discordId: e.target.value })}
                  placeholder={t('team.discordPh')}
                />
              </label>
              <label className="field">
                <span>{t('team.role')}</span>
                <select
                  value={form.role === 'custom' ? 'custom' : form.role}
                  onChange={(e) => applyRoleTemplate(e.target.value)}
                >
                  <option value="moderator">{t('role.mod')}</option>
                  <option value="admin">{t('role.admin')}</option>
                  <option value="custom">{t('role.custom')}</option>
                </select>
              </label>
            </div>
            <div className="tm-form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {createOpen ? t('common.create') : t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {createdCreds && (
        <Modal
          title={t('team.pwRevealTitle')}
          onClose={() => { setCreatedCreds(null); setPwCopied(false); }}
        >
          <div className="tm-pw-success">
            <p className="tm-pw-success-title">{t('team.pwSaved')}</p>
            <p>{t('team.pwCopyPlease')}</p>
            <div className="tm-pw-success-row">
              <input
                type="text"
                className="mono"
                readOnly
                value={createdCreds.password}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="btn" onClick={copyCreatedPassword}>
                {pwCopied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <p className="muted tm-pw-success-foot">{t('team.pwRevealFoot')}</p>
            <button
              type="button"
              className="btn btn-primary tm-pw-success-close"
              onClick={() => { setCreatedCreds(null); setPwCopied(false); }}
            >
              {t('common.close')}
            </button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

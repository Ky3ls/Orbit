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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
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

function PermsAside({ t, permGroups, form, hasAllPerms, togglePerm, onClose }) {
  return (
    <aside className="tm-perms-aside" aria-label={t('team.perms')}>
      <div className="tm-perms-head">
        <div>
          <h4 className="tm-form-col-title">{t('team.perms')}</h4>
          <p className="tm-perms-hint muted">{t('team.permsHint')}</p>
        </div>
        {onClose && (
          <button
            className="modal-x tm-perms-x"
            onClick={onClose}
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            ×
          </button>
        )}
      </div>
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
  );
}

export default function Admins({ user: me }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ groups: [], templates: {}, templateList: [] });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createdCreds, setCreatedCreds] = useState(null);
  const [pwCopied, setPwCopied] = useState(false);
  /** Stift aktiv: Klick auf Vorlage öffnet Bearbeiten statt User anlegen. */
  const [tplManaging, setTplManaging] = useState(false);
  /** null | { mode:'create'|'edit', id?, label, permissions, builtin? } */
  const [tplEdit, setTplEdit] = useState(null);

  function applyCatalog(d) {
    setUsers(d.users || []);
    setCatalog(d.catalog || { groups: [], templates: {}, templateList: [] });
  }

  function load() {
    api('/api/admins')
      .then(applyCatalog)
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  const templateList = useMemo(() => {
    if (catalog.templateList?.length) return catalog.templateList;
    const map = catalog.templates || {};
    return ['moderator', 'admin']
      .filter((id) => map[id])
      .map((id) => ({
        id,
        label: roleLabel(id),
        permissions: map[id] || [],
        builtin: true,
      }));
  }, [catalog]);

  function allPermIds() {
    return catalog.all?.length
      ? [...catalog.all]
      : (catalog.groups || []).flatMap((g) => (g.permissions || []).map((p) => p.id));
  }

  function openCreate() {
    setErr('');
    setTplEdit(null);
    setTplManaging(false);
    setForm({
      ...EMPTY_FORM,
      permissions: [...(catalog.templates?.moderator || templateList[0]?.permissions || [])],
    });
    setCreateOpen(true);
  }

  function openEdit(user) {
    setErr('');
    setTplEdit(null);
    setTplManaging(false);
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

  function openTplCreate() {
    setErr('');
    setCreateOpen(false);
    setEdit(null);
    setTplManaging(false);
    setTplEdit({
      mode: 'create',
      label: '',
      permissions: [...(catalog.templates?.moderator || [])],
    });
  }

  function openTplEdit(tpl) {
    setErr('');
    setCreateOpen(false);
    setEdit(null);
    setTplManaging(false);
    setTplEdit({
      mode: 'edit',
      id: tpl.id,
      label: tpl.label || roleLabel(tpl.id),
      permissions: [...(tpl.permissions || catalog.templates?.[tpl.id] || [])],
      builtin: !!tpl.builtin || tpl.id === 'moderator' || tpl.id === 'admin',
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
    const apply = (f) => {
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
    };
    if (tplEdit) {
      setTplEdit((f) => apply(f));
      return;
    }
    setForm((f) => apply(f));
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

  async function saveTpl(e) {
    e.preventDefault();
    if (!tplEdit) return;
    const label = String(tplEdit.label || '').trim();
    if (label.length < 2) {
      setErr(t('team.tplNameShort'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      let res;
      if (tplEdit.mode === 'create') {
        res = await api('/api/role-templates', {
          method: 'POST',
          body: { label, permissions: tplEdit.permissions },
        });
      } else {
        res = await api(`/api/role-templates/${encodeURIComponent(tplEdit.id)}`, {
          method: 'PATCH',
          body: { label, permissions: tplEdit.permissions },
        });
      }
      if (res.templates) {
        setCatalog((c) => ({
          ...c,
          templateList: res.templates,
          templates: Object.fromEntries([
            ['custom', []],
            ...res.templates.map((tpl) => [tpl.id, tpl.permissions || []]),
          ]),
        }));
      }
      setTplEdit(null);
      load();
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  async function deleteTpl() {
    if (!tplEdit?.id || tplEdit.builtin) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api(`/api/role-templates/${encodeURIComponent(tplEdit.id)}`, { method: 'DELETE' });
      if (res.templates) {
        setCatalog((c) => ({
          ...c,
          templateList: res.templates,
          templates: Object.fromEntries([
            ['custom', []],
            ...res.templates.map((tpl) => [tpl.id, tpl.permissions || []]),
          ]),
        }));
      }
      setTplEdit(null);
      load();
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  function closeForm() {
    setCreateOpen(false);
    setEdit(null);
    setTplEdit(null);
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
  const activePerms = tplEdit ? tplEdit.permissions : form.permissions;
  const hasAllPerms = activePerms.includes('all_permissions');
  const formOpen = createOpen || !!edit;
  const tplOpen = !!tplEdit;
  const activeForm = tplEdit || form;

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
      {err && !formOpen && !tplOpen && !createdCreds && <div className="err">{err}</div>}

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

        <PanelCard className={`tm-module${tplManaging ? ' is-managing' : ''}`}>
          <div className="tm-module-head">
            <div>
              <h3>{t('team.roleTpl')}</h3>
              <p className="muted">
                {tplManaging ? t('team.tplManageHint') : t('team.roleTplHint')}
              </p>
            </div>
            <div className="tm-tpl-actions">
              <button
                type="button"
                className="tm-icon-btn"
                title={t('team.tplAdd')}
                aria-label={t('team.tplAdd')}
                onClick={openTplCreate}
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className={`tm-icon-btn${tplManaging ? ' is-on' : ''}`}
                title={t('team.tplEdit')}
                aria-label={t('team.tplEdit')}
                aria-pressed={tplManaging}
                onClick={() => setTplManaging((v) => !v)}
              >
                <PencilIcon />
              </button>
            </div>
          </div>
          <div className="tm-roles">
            {templateList.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className={`tm-role${tplManaging ? ' is-editable' : ''}`}
                onClick={() => {
                  if (tplManaging) {
                    openTplEdit(tpl);
                    return;
                  }
                  setErr('');
                  setTplEdit(null);
                  setForm({
                    ...EMPTY_FORM,
                    role: tpl.id,
                    permissions: [...(tpl.permissions || catalog.templates?.[tpl.id] || [])],
                  });
                  setCreateOpen(true);
                }}
              >
                <strong>{tpl.label || roleLabel(tpl.id)}</strong>
                <ul>
                  {(tpl.permissions || []).slice(0, 6).map((p) => (
                    <li key={p}>{permLabel(t, p)}</li>
                  ))}
                  {(tpl.permissions || []).length > 6 && (
                    <li className="muted">{t('team.more', { n: tpl.permissions.length - 6 })}</li>
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
          showClose={false}
          aside={(
            <PermsAside
              t={t}
              permGroups={permGroups}
              form={form}
              hasAllPerms={hasAllPerms}
              togglePerm={togglePerm}
              onClose={closeForm}
            />
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
                  {templateList.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.label || roleLabel(tpl.id)}</option>
                  ))}
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

      {tplOpen && (
        <Modal
          title={tplEdit.mode === 'create' ? t('team.tplCreateTitle') : t('team.tplEditTitle', { name: tplEdit.label })}
          onClose={closeForm}
          showClose={false}
          aside={(
            <PermsAside
              t={t}
              permGroups={permGroups}
              form={activeForm}
              hasAllPerms={hasAllPerms}
              togglePerm={togglePerm}
              onClose={closeForm}
            />
          )}
        >
          <form className="tm-form" onSubmit={saveTpl}>
            {err && <div className="err">{err}</div>}
            <div className="tm-identity" aria-label={t('team.tplName')}>
              <h4 className="tm-form-col-title">{t('team.tplName')}</h4>
              <label className="field">
                <span>{t('team.tplName')} <em className="req">{t('common.required')}</em></span>
                <input
                  required
                  minLength={2}
                  value={tplEdit.label}
                  onChange={(e) => setTplEdit({ ...tplEdit, label: e.target.value })}
                  placeholder={t('team.tplNamePh')}
                  autoComplete="off"
                  autoFocus
                />
              </label>
            </div>
            <div className="tm-form-actions">
              {tplEdit.mode === 'edit' && !tplEdit.builtin && (
                <button type="button" className="btn btn-sm" disabled={busy} onClick={deleteTpl}>
                  {t('common.remove')}
                </button>
              )}
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {tplEdit.mode === 'create' ? t('common.create') : t('common.save')}
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

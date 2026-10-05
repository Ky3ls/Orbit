import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { roleLabel } from '../format.js';
import { Empty, Modal, Page, PanelCard } from '../components/Ui.jsx';
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

function flatPerms(catalog) {
  if (catalog.all?.length) {
    const byId = new Map();
    for (const g of catalog.groups || []) {
      for (const p of g.permissions || []) byId.set(p.id, p);
    }
    return catalog.all.map((id) => byId.get(id) || { id, label: id });
  }
  return (catalog.groups || []).flatMap((g) => g.permissions || []);
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

  const allPermList = useMemo(() => flatPerms(catalog), [catalog]);

  function allPermIds() {
    return catalog.all?.length
      ? [...catalog.all]
      : allPermList.map((p) => p.id);
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

  function permSummary(user) {
    if (user.role === 'owner') return t('team.masterAccount');
    const raw = user.permissions || [];
    if (raw.includes('*') || raw.includes('all_permissions')) return t('perm.all_permissions');
    if (user.role === 'admin' || user.role === 'moderator') return roleLabel(user.role);
    const n = raw.filter((p) => p !== '*').length;
    return n ? t('team.permCount', { n }) : roleLabel(user.role);
  }

  const members = useMemo(
    () => [...users].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.id - b.id)),
    [users],
  );

  const hasAllPerms = form.permissions.includes('all_permissions');
  const formOpen = createOpen || edit;

  return (
    <Page className="tm-page">
      {err && !formOpen && !createdCreds && <div className="err">{err}</div>}

      <PanelCard className="tm-table-card">
        <div className="tm-table-head">
          <h2>{t('team.allAdmins', { n: members.length })}</h2>
          <button type="button" className="btn btn-primary tm-add" onClick={openCreate}>
            + {t('team.add')}
          </button>
        </div>

        {members.length === 0 ? (
          <Empty title={t('team.empty')} text={t('team.emptyText')} />
        ) : (
          <div className="tm-table-wrap">
            <table className="tm-table">
              <thead>
                <tr>
                  <th>{t('team.username')}</th>
                  <th>{t('team.colIds')}</th>
                  <th>{t('team.colPerms')}</th>
                  <th>{t('team.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((u) => {
                  const isSelf = me && Number(me.id) === Number(u.id);
                  const isOwner = u.role === 'owner';
                  return (
                    <tr key={u.id} className={u.disabled ? 'off' : ''}>
                      <td className="tm-td-name">{u.username}</td>
                      <td className="tm-td-ids">
                        {u.cfx_name || u.cfx_id ? (
                          <div className="tm-id-line">
                            <span className="tm-id-badge cfx" aria-hidden="true">A</span>
                            <span className="mono">{u.cfx_id ? `fivem:${u.cfx_id}` : u.cfx_name}</span>
                          </div>
                        ) : null}
                        {u.discord_id ? (
                          <div className="tm-id-line">
                            <span className="tm-id-badge discord" aria-hidden="true">D</span>
                            <span className="mono">{`discord:${u.discord_id}`}</span>
                          </div>
                        ) : null}
                        {!u.cfx_name && !u.cfx_id && !u.discord_id && (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{permSummary(u)}</td>
                      <td className="tm-td-actions">
                        {isSelf || isOwner ? (
                          <button
                            type="button"
                            className="btn btn-sm tm-btn-outline"
                            onClick={() => navigate('/settings?section=account')}
                          >
                            ✎ {t('team.yourAccount')}
                          </button>
                        ) : (
                          <div className="tm-actions-row">
                            <button type="button" className="btn btn-sm" onClick={() => openEdit(u)}>
                              {t('common.edit')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => api(`/api/admins/${u.id}`, {
                                method: 'PATCH',
                                body: { disabled: !u.disabled },
                              }).then(load)}
                            >
                              {u.disabled ? t('team.enable') : t('team.lock')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {formOpen && (
        <Modal
          title={createOpen ? t('team.createTitle') : t('team.editTitle', { name: edit?.username })}
          onClose={closeForm}
        >
          <form className="tm-form-tx" onSubmit={createOpen ? create : saveEdit}>
            {err && <div className="err">{err}</div>}

            {createOpen && (
              <label className="field">
                <span>
                  {t('team.username')}{' '}
                  <em className="req">{t('common.required')}</em>
                </span>
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder={t('team.usernamePh')}
                  autoComplete="off"
                />
              </label>
            )}

            <label className="field">
              <span>
                {t('team.cfx')}{' '}
                <em className="opt">{t('common.optional')}</em>
              </span>
              <input
                value={form.cfxName || ''}
                onChange={(e) => setForm({ ...form, cfxName: e.target.value })}
                placeholder={t('team.cfxPh')}
              />
              <small className="tm-field-hint muted">{t('team.cfxHint')}</small>
            </label>

            <label className="field">
              <span>
                {t('team.discord')}{' '}
                <em className="opt">{t('common.optional')}</em>
              </span>
              <input
                value={form.discordId || ''}
                onChange={(e) => setForm({ ...form, discordId: e.target.value })}
                placeholder={t('team.discordPh')}
              />
              <small className="tm-field-hint muted">{t('team.discordHint')}</small>
            </label>

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

            <h4 className="tm-perms-title">{t('team.perms')}</h4>
            <div className="tm-perm-cols">
              {allPermList.map((perm) => {
                const isAll = perm.id === 'all_permissions';
                const locked = hasAllPerms && !isAll;
                const checked = hasAllPerms || form.permissions.includes(perm.id);
                return (
                  <label
                    key={perm.id}
                    className={`tm-perm-check${perm.sensitive ? ' is-sensitive' : ''}${locked ? ' is-locked' : ''}`}
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

            <div className="tm-form-foot">
              <button type="button" className="btn" onClick={closeForm} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {createOpen ? t('common.save') : t('common.save')}
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
              {t('team.pwClose')}
            </button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

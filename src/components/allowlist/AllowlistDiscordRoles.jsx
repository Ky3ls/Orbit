import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import { parseDiscordRoleIds, serializeDiscordRoleIds } from './allowlistUtils.js';

function toRows(raw) {
  const ids = parseDiscordRoleIds(raw, { strict: false });
  return ids.length ? ids : [''];
}

/**
 * Ausklappbares Panel für Discord-Rollen-IDs (add/remove Zeilen).
 * Speichert weiter als CSV in `allowlistDiscordRoles`.
 */
export default function AllowlistDiscordRoles({
  value = '',
  onChange,
  open: openProp,
  defaultOpen = true,
}) {
  const { t } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(openProp ?? defaultOpen);
  const [rows, setRows] = useState(() => toRows(value));
  const lastEmitted = useRef(serializeDiscordRoleIds(toRows(value)));

  useEffect(() => {
    if (openProp !== undefined) setOpen(openProp);
  }, [openProp]);

  useEffect(() => {
    const incoming = String(value || '');
    if (incoming === lastEmitted.current) return;
    setRows(toRows(incoming));
    lastEmitted.current = serializeDiscordRoleIds(toRows(incoming));
  }, [value]);

  function emit(nextRows) {
    setRows(nextRows);
    const csv = serializeDiscordRoleIds(nextRows, { strict: false });
    lastEmitted.current = csv;
    onChange?.(csv);
  }

  function setRow(index, text) {
    const next = rows.map((r, i) => (i === index ? text.replace(/\D/g, '').slice(0, 22) : r));
    emit(next);
  }

  function addRow() {
    emit([...rows, '']);
  }

  function removeRow(index) {
    if (rows.length <= 1) {
      emit(['']);
      return;
    }
    emit(rows.filter((_, i) => i !== index));
  }

  return (
    <div className={`al-roles${open ? ' open' : ''}`}>
      <button
        type="button"
        className="al-roles-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="al-roles-toggle-label">{t('settings.allowlist.roles')}</span>
        <span className="al-roles-count">
          {rows.filter((r) => String(r).replace(/\D/g, '').length >= 16).length}
        </span>
        <i className="al-roles-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div id={panelId} className="al-roles-panel">
          <p className="al-roles-hint muted">{t('settings.allowlist.rolesHint')}</p>
          <ul className="al-roles-list">
            {rows.map((row, index) => (
              <li key={`role-${index}`} className="al-roles-row">
                <label className="field al-roles-field">
                  <span className="sr-only">{t('settings.allowlist.roles')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('settings.allowlist.rolesPh')}
                    value={row}
                    onChange={(e) => setRow(index, e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-sm al-roles-remove"
                  onClick={() => removeRow(index)}
                  aria-label={t('settings.allowlist.rolesRemove')}
                  title={t('settings.allowlist.rolesRemove')}
                >
                  −
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm al-roles-add" onClick={addRow}>
            {t('settings.allowlist.rolesAdd')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

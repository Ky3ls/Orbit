import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.jsx';
import './orbitSelect.css';

/**
 * Orbit-Dropdown (kein natives <select> — eigener Look).
 * options: [{ value, label, hint? }]
 */
function OrbitSelect({
  label,
  value,
  options = [],
  onChange,
  placeholder,
  disabled = false,
  className = '',
}) {
  const { t } = useI18n();
  const ph = placeholder ?? t('select.placeholder');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const valueKey = String(value);
  const selected = useMemo(
    () => options.find((o) => String(o.value) === valueKey),
    [options, valueKey],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = useCallback(() => {
    if (!disabled) setOpen((v) => !v);
  }, [disabled]);

  const pick = useCallback((opt) => {
    onChange?.(opt.value, opt);
    setOpen(false);
  }, [onChange]);

  return (
    <div className={`osel ${className}`.trim()} ref={rootRef}>
      {label ? <span className="osel-label">{label}</span> : null}
      <button
        type="button"
        className={`osel-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
      >
        <span className={selected ? '' : 'osel-ph'}>
          {selected?.label || ph}
        </span>
        <i className="osel-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul id={listId} className="osel-menu" role="listbox">
          {options.length === 0 ? (
            <li className="osel-empty">{t('select.empty')}</li>
          ) : options.map((o) => {
            const active = String(o.value) === valueKey;
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`osel-opt${active ? ' active' : ''}`}
                  onClick={() => pick(o)}
                >
                  <span>{o.label}</span>
                  {o.hint ? <small>{o.hint}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default memo(OrbitSelect);

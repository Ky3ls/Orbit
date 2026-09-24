import { useEffect, useId, useRef, useState } from 'react';
import './orbitSelect.css';

/**
 * Orbit-Dropdown (kein natives <select> — eigener Look).
 * options: [{ value, label, hint? }]
 */
export default function OrbitSelect({
  label,
  value,
  options = [],
  onChange,
  placeholder = 'Auswählen…',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => String(o.value) === String(value));

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
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? '' : 'osel-ph'}>
          {selected?.label || placeholder}
        </span>
        <i className="osel-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul id={listId} className="osel-menu" role="listbox">
          {options.length === 0 ? (
            <li className="osel-empty">Keine Einträge</li>
          ) : options.map((o) => {
            const active = String(o.value) === String(value);
            return (
              <li key={String(o.value)} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`osel-opt${active ? ' active' : ''}`}
                  onClick={() => {
                    onChange?.(o.value, o);
                    setOpen(false);
                  }}
                >
                  <span>{o.label}</span>
                  {o.hint ? <small>{o.hint}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

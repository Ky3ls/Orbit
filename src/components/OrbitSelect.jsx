import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider.jsx';
import './orbitSelect.css';

const MENU_GAP = 6;
const MENU_MAX_VH = 0.46;
const MENU_MAX_PX = 280;

function menuMaxHeight() {
  if (typeof window === 'undefined') return MENU_MAX_PX;
  return Math.min(MENU_MAX_PX, Math.round(window.innerHeight * MENU_MAX_VH));
}

/**
 * Orbit-Dropdown (kein natives <select> — eigener Look).
 * options: [{ value, label, hint? }]
 * Menü per Portal zu document.body (fixed), damit overflow:hidden auf Cards nicht abschneidet.
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
  const [coords, setCoords] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const listId = useId();
  const valueKey = String(value);
  const selected = useMemo(
    () => options.find((o) => String(o.value) === valueKey),
    [options, valueKey],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const maxH = menuMaxHeight();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const placeAbove = spaceBelow < Math.min(maxH, 160) && spaceAbove > spaceBelow;
    const available = Math.max(80, placeAbove ? spaceAbove : spaceBelow);
    const height = Math.min(maxH, available);
    setCoords({
      left: rect.left,
      width: rect.width,
      top: placeAbove ? undefined : rect.bottom + MENU_GAP,
      bottom: placeAbove ? window.innerHeight - rect.top + MENU_GAP : undefined,
      maxHeight: height,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    // Capture: Scroll in Nested-Containern (Settings, Workspace) mitnehmen
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updatePosition, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      const tEl = e.target;
      if (rootRef.current?.contains(tEl)) return;
      if (menuRef.current?.contains(tEl)) return;
      setOpen(false);
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

  const menu = open && coords && typeof document !== 'undefined'
    ? createPortal(
      (
        <ul
          id={listId}
          ref={menuRef}
          className="osel-menu osel-menu-portal"
          role="listbox"
          style={{
            left: coords.left,
            width: coords.width,
            top: coords.top,
            bottom: coords.bottom,
            maxHeight: coords.maxHeight,
          }}
        >
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
      ),
      document.body,
    )
    : null;

  return (
    <div className={`osel ${className}`.trim()} ref={rootRef}>
      {label ? <span className="osel-label">{label}</span> : null}
      <button
        type="button"
        ref={triggerRef}
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
      {menu}
    </div>
  );
}

export default memo(OrbitSelect);

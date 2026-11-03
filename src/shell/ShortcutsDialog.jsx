import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nProvider.jsx';

/** Übersicht aller Tastenkürzel („?“) */
export default function ShortcutsDialog({ open, onClose, modules, isOwner, mac }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const general = [
    [[mac ? '⌘' : 'Ctrl', 'K'], t('keys.palette')],
    [['/'], t('keys.palette')],
    [['?'], t('keys.help')],
    [['['], t('keys.sidebar')],
    [['Shift', 'T'], t('keys.theme')],
    [['Esc'], t('keys.close')],
  ];
  const nav = modules.flatMap((g) => g.items)
    .filter((i) => i.key && (!i.owner || isOwner))
    .map((i) => [['G', i.key.toUpperCase()], i.label]);

  return (
    <div className="modal-back" onMouseDown={onClose} role="presentation">
      <div className="modal keys-modal" role="dialog" aria-modal="true" aria-labelledby="keys-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="spread modal-head">
          <h3 id="keys-title">{t('palette.shortcuts')}</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>
        <div className="keys-grid">
          <section>
            <h4>{t('keys.general')}</h4>
            {general.map(([k, label]) => (
              <div key={`${k.join('+')}-${label}`} className="keys-row">
                <span>{label}</span>
                <span className="keys-kbd">{k.map((x) => <kbd key={x}>{x}</kbd>)}</span>
              </div>
            ))}
          </section>
          <section>
            <h4>{t('keys.navigation')}</h4>
            {nav.map(([k, label]) => (
              <div key={label} className="keys-row">
                <span>{label}</span>
                <span className="keys-kbd">{k.map((x) => <kbd key={x}>{x}</kbd>)}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

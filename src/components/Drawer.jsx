import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Seitenpanel von rechts — Esc / Klick daneben schließt. */
export default function Drawer({ open = true, onClose, children, label, width = 600 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="drawer-back modal-back" onMouseDown={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ '--drawer-w': `${width}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}

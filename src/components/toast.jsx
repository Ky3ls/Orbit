import { useEffect, useState } from 'react';
import { NavIcon } from '../layout/icons.jsx';

/** Globale Toasts — `toast('Text')`, `toast.ok(...)`, `toast.err(...)` von überall aufrufbar. */
const listeners = new Set();
let seq = 0;

function emit(tone, title, opts = {}) {
  const item = { id: ++seq, tone, title: String(title || ''), text: opts.text || '', ttl: opts.ttl ?? (tone === 'bad' ? 6500 : 3800) };
  for (const fn of listeners) fn(item);
  return item.id;
}

export function toast(title, opts) { return emit('info', title, opts); }
toast.ok = (title, opts) => emit('ok', title, opts);
toast.err = (title, opts) => emit('bad', title, opts);
toast.warn = (title, opts) => emit('warn', title, opts);

const TONE_ICON = { ok: 'check', bad: 'x', warn: 'bolt', info: 'sparkle' };

export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const add = (item) => {
      setItems((prev) => [...prev.slice(-3), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, leaving: true } : i)));
        window.setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), 220);
      }, item.ttl);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, []);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast tone-${i.tone}${i.leaving ? ' leaving' : ''}`}>
          <span className="toast-ico"><NavIcon name={TONE_ICON[i.tone]} /></span>
          <div className="toast-body">
            <b>{i.title}</b>
            {i.text ? <span>{i.text}</span> : null}
          </div>
          <button
            type="button"
            className="toast-x"
            aria-label="Schließen"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}
          >
            <NavIcon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}

import { useMemo, useState } from 'react';

const ID_LABELS = {
  license: 'License',
  license2: 'License 2',
  discord: 'Discord',
  steam: 'Steam',
  fivem: 'Cfx.re',
  xbl: 'Xbox',
  live: 'Microsoft',
  ip: 'IP',
  hardware: 'HWID',
  identifier2: 'identifier2',
};

/** Bekannte Reihenfolge; unbekannte Typen folgen alphabetisch — nichts wird verworfen. */
const KIND_ORDER = [
  'license', 'license2', 'discord', 'steam', 'fivem',
  'xbl', 'live', 'ip', 'hardware', 'identifier2',
];

export function idKind(id) {
  const i = String(id || '').indexOf(':');
  return i > 0 ? id.slice(0, i) : 'id';
}

export function idLabel(id) {
  return ID_LABELS[idKind(id)] || idKind(id);
}

function idValue(id) {
  const s = String(id || '');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(i + 1) : s;
}

/** Clipboard-Text: eine Zeile pro Identifier als `type:value`. */
export function formatIdentifierCopy(kind, values) {
  const k = String(kind || 'id');
  const list = Array.isArray(values) ? values : [];
  return list
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .map((v) => (v.includes(':') && idKind(v) === k ? v : `${k}:${v}`))
    .join('\n');
}

async function writeClipboard(text) {
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

/** Gruppiert Identifier; mehrere Werte (v. a. IPs) mit `; ` in einer Zeile. Kein Typ-Filter. */
export function groupIdentifiers(ids) {
  const map = new Map();
  for (const raw of ids || []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const kind = idKind(s);
    const value = idValue(s);
    // Auch Werte ohne Prefix / leerer Suffix als Rohstring behalten
    const entry = value || s;
    if (!map.has(kind)) map.set(kind, []);
    const list = map.get(kind);
    if (!list.includes(entry)) list.push(entry);
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a);
    const ib = KIND_ORDER.indexOf(b);
    return (ia < 0 ? 1000 : ia) - (ib < 0 ? 1000 : ib) || a.localeCompare(b);
  });
  return keys.map((kind) => {
    const values = map.get(kind);
    return {
      kind,
      label: ID_LABELS[kind] || kind,
      values,
      full: values.join('; '),
      copyText: formatIdentifierCopy(kind, values),
    };
  });
}

function maskPart(part) {
  const v = String(part || '').trim();
  if (!v) return '••••';
  if (v.length <= 3) return '••••';
  const head = Math.min(4, Math.max(2, Math.floor(v.length / 4)));
  return `${v.slice(0, head)}••••`;
}

export function maskIdentifier(full) {
  return String(full || '')
    .split(';')
    .map((p) => maskPart(p))
    .join('; ');
}

/**
 * Strukturierte Identifier-Zeilen.
 * Mit mask: Standard zensiert; Hover (CSS) oder Tap/Click toggelt Reveal.
 * Mit copyable: Zeilenklick / Copy-Button kopiert `type:value` (mehrere Zeilen bei mehreren Werten).
 */
export default function PlayerIdentifiers({
  ids,
  compact = false,
  maxRows = 0,
  mask = true,
  copyable = false,
  className = '',
  copyLabel = 'Kopieren',
  copiedLabel = 'Kopiert',
}) {
  const groups = useMemo(() => {
    const all = groupIdentifiers(ids);
    return maxRows > 0 ? all.slice(0, maxRows) : all;
  }, [ids, maxRows]);
  const [open, setOpen] = useState(() => new Set());
  const [copiedKind, setCopiedKind] = useState('');

  if (!groups.length) return null;

  function toggle(kind) {
    if (!mask) return;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  async function copyGroup(g, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const ok = await writeClipboard(g.copyText);
    if (!ok) return;
    if (mask) {
      setOpen((prev) => {
        const next = new Set(prev);
        next.add(g.kind);
        return next;
      });
    }
    setCopiedKind(g.kind);
    window.setTimeout(() => {
      setCopiedKind((cur) => (cur === g.kind ? '' : cur));
    }, 1400);
  }

  function onRowActivate(g, e) {
    e.preventDefault();
    e.stopPropagation();
    if (copyable) {
      copyGroup(g, e);
      return;
    }
    toggle(g.kind);
  }

  return (
    <div
      className={`pl-ids${compact ? ' compact' : ''}${mask ? '' : ' plain'}${copyable ? ' copyable' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {groups.map((g) => {
        const shown = !mask || open.has(g.kind);
        const isCopied = copiedKind === g.kind;
        const interactive = mask || copyable;
        const Tag = interactive ? 'button' : 'div';
        return (
          <div key={g.kind} className={`pl-id-row-wrap${isCopied ? ' is-copied' : ''}`}>
            <Tag
              type={interactive ? 'button' : undefined}
              className={`pl-id-row-line${shown ? ' is-open' : ''}${isCopied ? ' is-copied' : ''}`}
              onClick={interactive ? (e) => onRowActivate(g, e) : undefined}
              title={
                copyable
                  ? `${copyLabel}: ${g.copyText}`
                  : mask
                    ? (shown ? g.full : `${g.label}: tippen/hover zum Anzeigen`)
                    : g.full
              }
              aria-pressed={mask ? shown : undefined}
              aria-label={`${g.label}: ${mask && !shown ? 'zensiert' : g.copyText || g.full}`}
            >
              <span className="pl-id-kind">{g.label}</span>
              <span className="pl-id-val">
                {mask ? (
                  <>
                    <span className="pl-id-mask mono">{maskIdentifier(g.full)}</span>
                    <span className="pl-id-full mono">{g.full}</span>
                  </>
                ) : (
                  <span className="pl-id-full mono is-static">{g.full}</span>
                )}
              </span>
            </Tag>
            {copyable ? (
              <button
                type="button"
                className={`pl-id-copy${isCopied ? ' is-copied' : ''}`}
                onClick={(e) => copyGroup(g, e)}
                title={g.copyText}
                aria-label={`${copyLabel} ${g.label}`}
              >
                {isCopied ? copiedLabel : copyLabel}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

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

/** discord / ip: nur Wert; sonst `type:value`. */
const VALUE_ONLY_KINDS = new Set(['discord', 'ip']);

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

function stripKindPrefix(kind, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.includes(':') && idKind(v) === kind) return idValue(v);
  return v;
}

/**
 * Clipboard-Text je Typ:
 * - Normal: `license:wert` (eine Zeile pro Wert)
 * - discord / ip: nur Wert, ohne Prefix
 */
export function formatIdentifierCopy(kind, values) {
  const k = String(kind || 'id');
  const list = (Array.isArray(values) ? values : [])
    .map((v) => stripKindPrefix(k, v))
    .filter(Boolean);
  if (!list.length) return '';
  if (VALUE_ONLY_KINDS.has(k)) return list.join('\n');
  return list.map((v) => `${k}:${v}`).join('\n');
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

/**
 * Anzeigezeilen: IP-Werte je eigene Zeile (Klick kopiert nur diese IP).
 * Andere Typen bleiben gruppiert.
 */
export function flattenIdentifierRows(groups) {
  const rows = [];
  for (const g of groups || []) {
    if (g.kind === 'ip') {
      g.values.forEach((value, idx) => {
        const v = String(value || '').trim();
        if (!v) return;
        rows.push({
          key: `ip:${idx}:${v}`,
          kind: 'ip',
          label: g.label,
          values: [v],
          full: v,
          copyText: formatIdentifierCopy('ip', [v]),
        });
      });
      continue;
    }
    rows.push({
      key: g.kind,
      kind: g.kind,
      label: g.label,
      values: g.values,
      full: g.full,
      copyText: g.copyText,
    });
  }
  return rows;
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

function FloppyIcon() {
  return (
    <svg className="pl-id-floppy-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 3v6h8V3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 21v-7h8v7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Strukturierte Identifier-Zeilen.
 * Mit mask: Standard zensiert; Hover (CSS) oder Tap/Click toggelt Reveal.
 * Mit copyable: Feldklick kopiert (Disketten-Icon als Hinweis); kein separater Button.
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
  const rows = useMemo(() => {
    const all = flattenIdentifierRows(groupIdentifiers(ids));
    return maxRows > 0 ? all.slice(0, maxRows) : all;
  }, [ids, maxRows]);
  const [open, setOpen] = useState(() => new Set());
  const [copiedKey, setCopiedKey] = useState('');

  if (!rows.length) return null;

  function toggle(key) {
    if (!mask) return;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyRow(row, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const ok = await writeClipboard(row.copyText);
    if (!ok) return;
    if (mask) {
      setOpen((prev) => {
        const next = new Set(prev);
        next.add(row.key);
        return next;
      });
    }
    setCopiedKey(row.key);
    window.setTimeout(() => {
      setCopiedKey((cur) => (cur === row.key ? '' : cur));
    }, 1400);
  }

  function onRowActivate(row, e) {
    e.preventDefault();
    e.stopPropagation();
    if (copyable) {
      copyRow(row, e);
      return;
    }
    toggle(row.key);
  }

  return (
    <div
      className={`pl-ids${compact ? ' compact' : ''}${mask ? '' : ' plain'}${copyable ? ' copyable' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {rows.map((row) => {
        const shown = !mask || open.has(row.key);
        const isCopied = copiedKey === row.key;
        const interactive = mask || copyable;
        const Tag = interactive ? 'button' : 'div';
        return (
          <div key={row.key} className={`pl-id-row-wrap${isCopied ? ' is-copied' : ''}`}>
            <Tag
              type={interactive ? 'button' : undefined}
              className={`pl-id-row-line${shown ? ' is-open' : ''}${isCopied ? ' is-copied' : ''}`}
              onClick={interactive ? (e) => onRowActivate(row, e) : undefined}
              title={
                copyable
                  ? `${isCopied ? copiedLabel : copyLabel}: ${row.copyText}`
                  : mask
                    ? (shown ? row.full : `${row.label}: tippen/hover zum Anzeigen`)
                    : row.full
              }
              aria-pressed={mask ? shown : undefined}
              aria-label={`${row.label}: ${mask && !shown ? 'zensiert' : row.copyText || row.full}${copyable ? ` — ${copyLabel}` : ''}`}
            >
              <span className="pl-id-kind">{row.label}</span>
              <span className="pl-id-val">
                {mask ? (
                  <>
                    <span className="pl-id-mask mono">{maskIdentifier(row.full)}</span>
                    <span className="pl-id-full mono">{row.full}</span>
                  </>
                ) : (
                  <span className="pl-id-full mono is-static">{row.full}</span>
                )}
              </span>
              {copyable ? (
                <span className={`pl-id-floppy${isCopied ? ' is-copied' : ''}`} aria-hidden="true">
                  <FloppyIcon />
                </span>
              ) : null}
            </Tag>
          </div>
        );
      })}
    </div>
  );
}

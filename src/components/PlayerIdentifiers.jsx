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
  return keys.map((kind) => ({
    kind,
    label: ID_LABELS[kind] || kind,
    full: map.get(kind).join('; '),
  }));
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
 */
export default function PlayerIdentifiers({
  ids,
  compact = false,
  maxRows = 0,
  mask = true,
  className = '',
}) {
  const groups = useMemo(() => {
    const all = groupIdentifiers(ids);
    return maxRows > 0 ? all.slice(0, maxRows) : all;
  }, [ids, maxRows]);
  const [open, setOpen] = useState(() => new Set());

  if (!groups.length) return null;

  function toggle(kind, e) {
    if (!mask) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div
      className={`pl-ids${compact ? ' compact' : ''}${mask ? '' : ' plain'}${className ? ` ${className}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {groups.map((g) => {
        const shown = !mask || open.has(g.kind);
        const Tag = mask ? 'button' : 'div';
        return (
          <Tag
            key={g.kind}
            type={mask ? 'button' : undefined}
            className={`pl-id-row-line${shown ? ' is-open' : ''}`}
            onClick={mask ? (e) => toggle(g.kind, e) : undefined}
            title={mask ? (shown ? g.full : `${g.label}: tippen/hover zum Anzeigen`) : g.full}
            aria-pressed={mask ? shown : undefined}
            aria-label={`${g.label}: ${mask && !shown ? 'zensiert' : g.full}`}
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
        );
      })}
    </div>
  );
}

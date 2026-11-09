import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../../components/toast.jsx';
import { NavIcon } from '../../../layout/icons.jsx';
import { cellText, fmtNum, sapi, studioPath } from './studioApi.js';

const KW = 'SELECT FROM WHERE AND OR NOT NULL IS IN LIKE REGEXP BETWEEN ORDER BY GROUP HAVING LIMIT OFFSET JOIN LEFT RIGHT INNER OUTER ON AS DISTINCT COUNT SUM AVG MIN MAX INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP ADD COLUMN INDEX PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT AUTO_INCREMENT TRUNCATE SHOW DESCRIBE EXPLAIN UNION ALL CASE WHEN THEN ELSE END ASC DESC IF EXISTS DATABASE VIEW WITH CONCAT NOW COALESCE IFNULL'.split(' ');
const KW_SET = new Set(KW);

function highlight(sql) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return sql.replace(/(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?)|(`[^`]*`?)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]+)|([\s\S])/g, (m, com, str, bt, num, word, other) => {
    if (com) return `<span class="hl-c">${esc(com)}</span>`;
    if (str) return `<span class="hl-s">${esc(str)}</span>`;
    if (bt) return `<span class="hl-i">${esc(bt)}</span>`;
    if (num) return `<span class="hl-n">${num}</span>`;
    if (word) return KW_SET.has(word.toUpperCase()) ? `<span class="hl-k">${word}</span>` : esc(word);
    return esc(other);
  }) + '\n';
}

const HKEY = (db) => `orbit.sql.history.${db}`;

export default function StudioSql({ db, writable, unlock, tables, schema, initial = '' }) {
  const [sql, setSql] = useState(initial || (tables[0] ? `SELECT * FROM \`${tables[0].name}\` LIMIT 100;` : 'SHOW TABLES;'));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState(0);
  const [hist, setHist] = useState(() => { try { return JSON.parse(localStorage.getItem(HKEY(db)) || '[]'); } catch { return []; } });
  const [showHist, setShowHist] = useState(false);
  const [sugg, setSugg] = useState(null); // { items, start, idx }
  const ta = useRef(null);
  const pre = useRef(null);

  useEffect(() => { if (initial) setSql(initial); }, [initial]);

  const words = useMemo(() => {
    const set = new Map();
    for (const t of schema?.tables || tables) {
      set.set(t.name, { w: t.name, kind: 'Tabelle' });
      for (const c of t.columns || []) if (!set.has(c.name)) set.set(c.name, { w: c.name, kind: t.name });
    }
    for (const k of KW) set.set(k, { w: k, kind: 'SQL' });
    return [...set.values()];
  }, [schema, tables]);

  function saveHist(q) {
    const next = [q, ...hist.filter((h) => h !== q)].slice(0, 40);
    setHist(next);
    try { localStorage.setItem(HKEY(db), JSON.stringify(next)); } catch { /* */ }
  }

  async function run(text = null) {
    const el = ta.current;
    const selected = el && el.selectionEnd > el.selectionStart ? sql.slice(el.selectionStart, el.selectionEnd) : null;
    const q = (text ?? selected ?? sql).trim();
    if (!q) return;
    setBusy(true);
    setErr('');
    try {
      const d = await sapi(studioPath(db, '/sql'), { method: 'POST', unlock, body: { sql: q } });
      setOut(d);
      setTab(Math.max(0, d.results.findIndex((r) => r.kind === 'rows')));
      saveHist(q);
    } catch (e) { setErr(e.message); setOut(null); }
    setBusy(false);
  }

  async function explain() {
    try {
      const d = await sapi(studioPath(db, '/explain'), { method: 'POST', body: { sql } });
      setOut({ results: [{ kind: 'rows', columns: Object.keys(d.rows[0] || {}).map((n) => ({ name: n })), rows: d.rows, total: d.rows.length, explain: true }], ms: 0 });
      setTab(0);
      setErr('');
    } catch (e) { setErr(e.message); }
  }

  function updateSugg(value, pos) {
    const before = value.slice(0, pos);
    const m = before.match(/([A-Za-z_][\w]*)$/);
    if (!m || m[1].length < 2) { setSugg(null); return; }
    const p = m[1].toLowerCase();
    const items = words.filter((x) => x.w.toLowerCase().startsWith(p) && x.w.toLowerCase() !== p).slice(0, 8);
    setSugg(items.length ? { items, start: pos - m[1].length, idx: 0, pos } : null);
  }

  function accept(item) {
    const el = ta.current;
    const next = sql.slice(0, sugg.start) + item.w + sql.slice(sugg.pos);
    setSql(next);
    setSugg(null);
    requestAnimationFrame(() => { const p = sugg.start + item.w.length; el.focus(); el.setSelectionRange(p, p); });
  }

  function onKey(e) {
    if (sugg) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSugg({ ...sugg, idx: (sugg.idx + 1) % sugg.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSugg({ ...sugg, idx: (sugg.idx - 1 + sugg.items.length) % sugg.items.length }); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); accept(sugg.items[sugg.idx]); return; }
      if (e.key === 'Escape') { setSugg(null); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      const next = `${sql.slice(0, s)}  ${sql.slice(el.selectionEnd)}`;
      setSql(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  }

  const res = out?.results?.[tab];
  const csv = () => {
    if (!res || res.kind !== 'rows') return;
    const cell = (v) => { const s = cellText(v) ?? ''; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [res.columns.map((c) => cell(c.name)).join(','), ...res.rows.map((r) => res.columns.map((c) => cell(r[c.name])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv' }));
    a.download = `${db}-abfrage.csv`;
    a.click();
  };

  const snippets = tables[0] ? [
    ['Erste 100', `SELECT * FROM \`${tables[0].name}\` LIMIT 100;`],
    ['Zählen', `SELECT COUNT(*) FROM \`${tables[0].name}\`;`],
    ['Größte Tabellen', "SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS mb, table_rows\nFROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY mb DESC LIMIT 20;"],
    ['Doppelte finden', `SELECT spalte, COUNT(*) n FROM \`${tables[0].name}\` GROUP BY spalte HAVING n > 1;`],
    ['Prozesse', 'SHOW FULL PROCESSLIST;'],
  ] : [];

  return (
    <div className="sq">
      <div className="sq-editor card">
        <div className="sq-toolbar">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => run()}><NavIcon name="play" />{busy ? 'Läuft…' : 'Ausführen'}<kbd>Strg ↵</kbd></button>
          <button type="button" className="btn btn-sm" onClick={explain} title="Ausführungsplan anzeigen"><NavIcon name="activity" />EXPLAIN</button>
          <div className="sq-snips">{snippets.map(([l, s]) => <button key={l} type="button" className="mcp-chip" onClick={() => setSql(s)}>{l}</button>)}</div>
          <span className="grow" />
          {!writable && <span className="mcp-chip warn" title="Nur lesende Abfragen"><NavIcon name="lock" />nur lesen</span>}
          <div className="sq-histwrap">
            <button type="button" className="btn btn-sm" onClick={() => setShowHist(!showHist)}><NavIcon name="clock" />Verlauf</button>
            {showHist && (
              <div className="pop sq-hist">
                {hist.length === 0 ? <div className="muted sq-hist-empty">Noch keine Abfragen.</div> : hist.map((h) => (
                  <button key={h} type="button" className="pop-item mono" onClick={() => { setSql(h); setShowHist(false); }}>{h.length > 110 ? `${h.slice(0, 110)}…` : h}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sq-code">
          <pre ref={pre} className="sq-hl" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlight(sql) }} />
          <textarea
            ref={ta}
            spellCheck={false}
            value={sql}
            onChange={(e) => { setSql(e.target.value); updateSugg(e.target.value, e.target.selectionStart); }}
            onKeyDown={onKey}
            onScroll={(e) => { if (pre.current) { pre.current.scrollTop = e.target.scrollTop; pre.current.scrollLeft = e.target.scrollLeft; } }}
            onBlur={() => setTimeout(() => setSugg(null), 150)}
          />
          {sugg && (
            <div className="sq-sugg">
              {sugg.items.map((it, i) => (
                <button key={it.w + it.kind} type="button" className={i === sugg.idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(it); }}>
                  <b className="mono">{it.w}</b><small>{it.kind}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {err && <div className="sq-err"><NavIcon name="x" /><pre>{err}</pre></div>}

      {out && (
        <div className="sq-out card">
          <div className="sq-tabs">
            {out.results.map((r, i) => (
              <button key={i} type="button" className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>
                {r.kind === 'rows' ? <><NavIcon name="list" />{r.explain ? 'EXPLAIN' : `Ergebnis ${i + 1}`} <span className="seg-n">{fmtNum(r.total)}</span></> : <><NavIcon name="check" />{fmtNum(r.affected)} betroffen</>}
              </button>
            ))}
            <span className="grow" />
            <span className="muted sq-ms">{out.ms} ms</span>
            {res?.kind === 'rows' && <button type="button" className="btn btn-sm" onClick={csv}><NavIcon name="download" />CSV</button>}
          </div>
          {res?.kind === 'rows' ? (
            <div className="sg-wrap sq-grid">
              <table className="sg-table">
                <thead><tr>{res.columns.map((c, i) => <th key={c.name + i}><span className="sg-th static"><span>{c.name}</span>{c.table && <small>{c.table}</small>}</span></th>)}</tr></thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={i}>{res.columns.map((c, j) => { const t = cellText(r[c.name]); return <td key={j} className={t === null ? 'null' : ''} title={t && t.length > 80 ? t : undefined}>{t === null ? <em>NULL</em> : t.length > 200 ? `${t.slice(0, 200)}…` : t}</td>; })}</tr>
                  ))}
                </tbody>
              </table>
              {res.truncated && <div className="sg-empty">Nur die ersten {fmtNum(res.rows.length)} von {fmtNum(res.total)} Zeilen angezeigt — für alles Export nutzen.</div>}
              {res.rows.length === 0 && <div className="sg-empty">Keine Zeilen.</div>}
            </div>
          ) : res ? (
            <div className="sq-ok"><NavIcon name="check" /><span><b>{fmtNum(res.affected)}</b> Zeile{res.affected === 1 ? '' : 'n'} betroffen{res.insertId ? ` · neue ID ${res.insertId}` : ''}{res.info ? ` · ${res.info}` : ''}</span></div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Globale Suche über alle Tabellen */
export function StudioSearch({ db, onOpen }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  async function go(e) {
    e?.preventDefault();
    setBusy(true);
    try { setR(await sapi(`${studioPath(db, '/search')}?q=${encodeURIComponent(q)}`)); } catch (er) { toast.err(er.message); }
    setBusy(false);
  }
  return (
    <div className="sx-search">
      <form className="sx-search-bar card" onSubmit={go}>
        <NavIcon name="search" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Wert in der ganzen Datenbank suchen — z. B. Spielername, Lizenz, E-Mail" />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || q.trim().length < 2}>{busy ? 'Sucht…' : 'Suchen'}</button>
      </form>
      {r && (
        <>
          <p className="muted sx-search-meta">{r.hits.length ? `${r.hits.length} Tabellen mit Treffern` : 'Keine Treffer'} · {r.ms} ms</p>
          {r.hits.map((h) => (
            <section key={h.table} className="card sx-hit">
              <header>
                <b className="mono">{h.table}</b>
                <small>in {h.columns.join(', ')}{h.more ? ' · weitere Treffer' : ''}</small>
                <span className="grow" />
                <button type="button" className="btn btn-sm" onClick={() => onOpen(h.table, { col: h.columns[0], contains: r.term })}>Öffnen<NavIcon name="arrowRight" /></button>
              </header>
              <div className="sg-wrap">
                <table className="sg-table compact">
                  <thead><tr>{Object.keys(h.rows[0] || {}).slice(0, 8).map((k) => <th key={k}><span className="sg-th static"><span>{k}</span></span></th>)}</tr></thead>
                  <tbody>{h.rows.map((row, i) => <tr key={i}>{Object.keys(row).slice(0, 8).map((k) => { const t = cellText(row[k]); const hit = t && t.toLowerCase().includes(r.term.toLowerCase()); return <td key={k} className={hit ? 'hit' : t === null ? 'null' : ''}>{t === null ? <em>NULL</em> : t.length > 60 ? `${t.slice(0, 60)}…` : t}</td>; })}</tr>)}</tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

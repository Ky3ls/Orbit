import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* Syntax-Hervorhebung für FXServer-CFG (server.cfg, resources.cfg …) */
const KEYWORDS = /^(ensure|start|stop|restart|exec|set|setr|sets|endpoint_add_tcp|endpoint_add_udp|add_ace|remove_ace|add_principal|remove_principal|load_server_icon|sv_[a-z_]+|onesync|con_[a-z_]+|steam_webApiKey|rcon_password)\b/i;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return `<span class="tk-c">${escapeHtml(line)}</span>`;
  }
  // Inline-Kommentar abtrennen (nicht innerhalb von Strings)
  let code = line;
  let comment = '';
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    if (!inStr && (ch === '#' || (ch === '/' && line[i + 1] === '/'))) {
      code = line.slice(0, i);
      comment = line.slice(i);
      break;
    }
  }
  const lead = code.match(/^\s*/)[0];
  let rest = code.slice(lead.length);
  let out = escapeHtml(lead);
  const kw = rest.match(KEYWORDS);
  if (kw) {
    out += `<span class="tk-k">${escapeHtml(kw[0])}</span>`;
    rest = rest.slice(kw[0].length);
  }
  out += escapeHtml(rest)
    .replace(/(&quot;|")([^"]*)("?)/g, '<span class="tk-s">"$2$3</span>')
    .replace(/(^|\s)(-?\d+(?:\.\d+)?)(?=\s|$)/g, '$1<span class="tk-n">$2</span>')
    .replace(/(\[[^\]\s]+\])/g, '<span class="tk-f">$1</span>');
  if (comment) out += `<span class="tk-c">${escapeHtml(comment)}</span>`;
  return out;
}

/* YAML/JSON/Properties: Schlüssel, Strings, Zahlen, Booleans, Kommentare */
function highlightData(line) {
  const t = line.trimStart();
  if (t.startsWith('#') || t.startsWith('//')) return `<span class="tk-c">${escapeHtml(line)}</span>`;
  let code = line;
  let comment = '';
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' || ch === "'") inStr = !inStr;
    if (!inStr && ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) { code = line.slice(0, i); comment = line.slice(i); break; }
  }
  const m = code.match(/^(\s*-?\s*)("?[\w.@$\-/ ]+"?)(\s*[:=])(.*)$/);
  let out;
  if (m) {
    out = `${escapeHtml(m[1])}<span class="tk-k">${escapeHtml(m[2])}</span>${escapeHtml(m[3])}${valueHtml(m[4])}`;
  } else {
    out = valueHtml(code);
  }
  if (comment) out += `<span class="tk-c">${escapeHtml(comment)}</span>`;
  return out;
}
function valueHtml(v) {
  return escapeHtml(v)
    .replace(/(&quot;|")([^"]*)("?)/g, '<span class="tk-s">"$2$3</span>')
    .replace(/'([^']*)'/g, '<span class="tk-s">\'$1\'</span>')
    .replace(/(^|[\s,[:])(true|false|null|~)(?=[\s,\]}]|$)/g, '$1<span class="tk-f">$2</span>')
    .replace(/(^|[\s,[:])(-?\d+(?:\.\d+)?)(?=[\s,\]}]|$)/g, '$1<span class="tk-n">$2</span>');
}

export function langFor(file) {
  if (/\.(cfg)$/i.test(file || '')) return 'cfg';
  if (/\.(ya?ml|json5?|properties|toml|conf|ini|mcmeta|snbt|lang)$/i.test(file || '')) return 'data';
  return 'plain';
}

/**
 * Code-Editor: Textarea über hervorgehobenem <pre>, plus Zeilennummern + Statusleiste.
 * Ref zeigt auf die Textarea (Suche nutzt setSelectionRange/scrollTop).
 */
const CfgCode = forwardRef(function CfgCode({ value, onChange, disabled, ariaLabel, dirty, readOnly, footerHint, lang = 'cfg', langLabel }, ref) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const setRefs = useCallback((el) => {
    taRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);

  const lines = useMemo(() => String(value || '').split('\n'), [value]);
  const html = useMemo(() => {
    const fn = lang === 'cfg' ? highlightLine : lang === 'data' ? highlightData : escapeHtml;
    return lines.map(fn).join('\n');
  }, [lines, lang]);
  const ensures = useMemo(() => lines.filter((l) => /^\s*ensure\s/i.test(l)).length, [lines]);

  const sync = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }, []);

  const updateCursor = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    setCursor((c) => (c.line === line && c.col === col ? c : { line, col }));
  }, []);

  useEffect(() => { sync(); }, [value, sync]);

  function onKeyDown(e) {
    // Tab rückt ein statt den Fokus zu verlassen
    if (e.key === 'Tab' && !e.shiftKey && !readOnly) {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = `${ta.value.slice(0, s)}  ${ta.value.slice(en)}`;
      onChange({ target: { value: next } });
      requestAnimationFrame(() => { ta.selectionStart = s + 2; ta.selectionEnd = s + 2; updateCursor(); });
    }
  }

  return (
    <div className="cfgx">
      <div className="cfgx-body">
        <div className="cfgx-gutter" ref={gutterRef} aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i} className={i + 1 === cursor.line ? 'cur' : ''}>{i + 1}</span>
          ))}
        </div>
        <div className="cfgx-code">
          <div className="cfgx-curline" style={{ transform: `translateY(${(cursor.line - 1) * 20 - (taRef.current?.scrollTop || 0)}px)` }} aria-hidden="true" />
          {/* eslint-disable-next-line react/no-danger */}
          <pre ref={preRef} className="cfgx-pre" aria-hidden="true" dangerouslySetInnerHTML={{ __html: `${html}\n` }} />
          <textarea
            ref={setRefs}
            className="cfgx-ta"
            value={value}
            onChange={(e) => { onChange(e); requestAnimationFrame(updateCursor); }}
            onScroll={() => { sync(); setCursor((c) => ({ ...c })); }}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onSelect={updateCursor}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            disabled={disabled}
            readOnly={readOnly}
            aria-label={ariaLabel}
          />
        </div>
      </div>
      <div className="cfgx-status">
        <span className={`cfgx-state${dirty ? ' dirty' : ''}`}><i />{dirty ? 'Ungespeichert' : 'Gespeichert'}</span>
        {readOnly ? <span className="cfgx-ro">Schreibgeschützt</span> : null}
        <span>Zeile {cursor.line}, Spalte {cursor.col}</span>
        <span>{lines.length} Zeilen</span>
        {lang === 'cfg' ? <span>{ensures} ensure</span> : null}
        <span className="grow" />
        {footerHint ? <span className="cfgx-hint">{footerHint}</span> : null}
        <span>{langLabel || (lang === 'cfg' ? 'CFG' : lang === 'data' ? 'YAML/JSON' : 'Text')} · UTF-8</span>
      </div>
    </div>
  );
});

export default CfgCode;

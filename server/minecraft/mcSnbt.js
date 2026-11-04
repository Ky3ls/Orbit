/**
 * SNBT-Parser (Ausgabe von `data get entity …` in der Server-Konsole) → einfaches JSON.
 * Zahlen-Suffixe (b s L f d) werden entfernt, typisierte Arrays [I; …] zu Arrays.
 */
export function parseSnbt(text) {
  const s = String(text);
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i += 1; };
  const fail = (m) => { throw new Error(`SNBT: ${m} bei ${i}`); };

  function str() {
    const q = s[i];
    i += 1;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        i += 1;
        const c = s[i];
        if (c === 'n') out += '\n';
        else if (c === 't') out += '\t';
        else if (c === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; }
        else out += c;
      } else out += s[i];
      i += 1;
    }
    if (s[i] !== q) fail('String nicht beendet');
    i += 1;
    return out;
  }

  function bare(key = false) {
    const st = i;
    const re = key ? /[A-Za-z0-9._+-]/ : /[A-Za-z0-9._+\-:]/;
    while (i < s.length && re.test(s[i])) i += 1;
    return s.slice(st, i);
  }

  function prim(tok) {
    if (tok === 'true') return 1;
    if (tok === 'false') return 0;
    const m = tok.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([bslfd]?)$/i);
    if (m) return Number(m[1]);
    return tok;
  }

  function value(depth = 0) {
    if (depth > 512) fail('zu tief');
    ws();
    const c = s[i];
    if (c === '{') {
      i += 1;
      const o = {};
      ws();
      if (s[i] === '}') { i += 1; return o; }
      for (;;) {
        ws();
        const k = s[i] === '"' || s[i] === "'" ? str() : bare(true);
        ws();
        if (s[i] !== ':') fail('":" erwartet');
        i += 1;
        o[k] = value(depth + 1);
        ws();
        if (s[i] === ',') { i += 1; continue; }
        if (s[i] === '}') { i += 1; return o; }
        fail('"," oder "}" erwartet');
      }
    }
    if (c === '[') {
      i += 1;
      ws();
      if (/[BIL]/.test(s[i]) && s[i + 1] === ';') i += 2;
      const a = [];
      ws();
      if (s[i] === ']') { i += 1; return a; }
      for (;;) {
        a.push(value(depth + 1));
        ws();
        if (s[i] === ',') { i += 1; continue; }
        if (s[i] === ']') { i += 1; return a; }
        fail('"," oder "]" erwartet');
      }
    }
    if (c === '"' || c === "'") return str();
    const tok = bare();
    if (!tok) fail('Wert erwartet');
    return prim(tok);
  }

  return value();
}

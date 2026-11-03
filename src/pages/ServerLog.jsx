import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Empty, Page, PageHeader } from '../components/Ui.jsx';
import './audit.css';
import { toBcp47 } from '../i18n/core.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';

const LEVELS = ['all', 'bad', 'warn', 'ok', 'info'];

export default function ServerLog() {
  const { t, lang } = useI18n();
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState('all');
  const seqRef = useRef(0);
  const boxRef = useRef(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  function fmtLineTime(ts) {
    if (!ts) return '';
    return new Intl.DateTimeFormat(toBcp47(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts);
  }

  useEffect(() => {
    let alive = true;
    let timer;

    async function tick() {
      if (!alive) return;
      try {
        const after = seqRef.current > 0 ? seqRef.current : 0;
        const d = await api(`/api/server-log?after=${after}`);
        if (!alive) return;
        const batch = d.lines || [];
        if (batch.length) {
          if (!pausedRef.current) {
            setLines((prev) => {
              const map = new Map(prev.map((l) => [l.id, l]));
              for (const l of batch) map.set(l.id, l);
              return [...map.values()].sort((a, b) => a.id - b.id).slice(-500);
            });
          }
          seqRef.current = Math.max(seqRef.current, ...batch.map((l) => l.id), d.seq || 0);
        } else if (d.seq) {
          seqRef.current = Math.max(seqRef.current, d.seq);
        }
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message);
      }
      timer = setTimeout(tick, 2500);
    }

    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (paused || !boxRef.current) return;
    boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, paused]);

  const counts = useMemo(() => {
    const c = { all: lines.length, bad: 0, warn: 0, ok: 0, info: 0 };
    for (const l of lines) c[l.level || 'info'] = (c[l.level || 'info'] || 0) + 1;
    return c;
  }, [lines]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter((l) => (level === 'all' || (l.level || 'info') === level)
      && (!needle || `${l.level} ${l.text}`.toLowerCase().includes(needle)));
  }, [lines, q, level]);

  function download() {
    const body = view.map((l) => `${new Date(l.t).toISOString()} [${l.level || 'info'}] ${l.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    a.download = `orbit-server-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const TILES = [
    { id: 'bad', label: 'Fehler', icon: 'x', tone: 'bad' },
    { id: 'warn', label: 'Warnungen', icon: 'bolt', tone: 'warn' },
    { id: 'ok', label: 'Erfolgreich', icon: 'check', tone: 'ok' },
    { id: 'info', label: 'Info', icon: 'sparkle', tone: 'info' },
  ];
  const needleRaw = q.trim();
  const mark = (text) => {
    if (!needleRaw) return text;
    const i = text.toLowerCase().indexOf(needleRaw.toLowerCase());
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + needleRaw.length)}</mark>{text.slice(i + needleRaw.length)}</>;
  };

  return (
    <Page className="slog-page lg-page">
      <PageHeader
        eyebrow={t('slog.eyebrow')}
        title={t('page.serverLog')}
        description="Ausgabe der FiveM-Konsole: Starts, Resources, Joins und Fehler."
        actions={(
          <button type="button" className="btn btn-sm" onClick={download} disabled={!view.length}>
            <NavIcon name="external" />{t('slog2.download')}
          </button>
        )}
      />

      <div className="lg-tiles">
        {TILES.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`lg-tile tone-${tile.tone}${level === tile.id ? ' active' : ''}`}
            onClick={() => setLevel(level === tile.id ? 'all' : tile.id)}
            aria-pressed={level === tile.id}
          >
            <span className="lg-tile-ico"><NavIcon name={tile.icon} /></span>
            <span className="lg-tile-text"><b>{counts[tile.id] || 0}</b><span>{tile.label}</span></span>
          </button>
        ))}
      </div>

      {err && <div className="err">{err}</div>}

      <section className="lg-win card">
        <header className="lg-win-head">
          <span className={`lg-live${paused ? ' paused' : ''}`}><i />{paused ? t('slog2.paused') : 'Live'}</span>
          <span className="lg-win-count">{level === 'all' ? `${view.length} Zeilen` : `${view.length} ${TILES.find((x) => x.id === level)?.label}`}{level !== 'all' ? <button type="button" className="lg-clear" onClick={() => setLevel('all')}>Filter aufheben</button> : null}</span>
          <div className="lg-search">
            <NavIcon name="search" />
            <input placeholder="Im Log suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className={`btn btn-sm${paused ? ' btn-primary' : ''}`} onClick={() => setPaused((v) => !v)}>
            <NavIcon name={paused ? 'play' : 'stop'} />{paused ? t('common.resume') : t('common.pause')}
          </button>
        </header>
        {view.length === 0 ? (
          <Empty title={t('slog.empty')} text={lines.length ? 'Keine Zeilen für diesen Filter.' : t('slog.emptyText')} />
        ) : (
          <div className="lg-body" ref={boxRef}>
            {view.map((line, idx) => (
              <div key={line.id} className={`lg-line lvl-${line.level || 'info'}`}>
                <span className="lg-n">{idx + 1}</span>
                <time>{fmtLineTime(line.t)}</time>
                <span className="lg-lvl">{({ bad: 'ERR', warn: 'WARN', ok: 'OK', info: 'INFO' })[line.level || 'info'] || line.level}</span>
                <code>{mark(line.text)}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

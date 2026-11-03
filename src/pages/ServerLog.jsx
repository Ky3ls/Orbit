import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
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

  return (
    <Page className="slog-page">
      <PageHeader
        eyebrow={t('slog.eyebrow')}
        title={t('page.serverLog')}
        description={t('slog.desc')}
        actions={(
          <>
            <button type="button" className="btn btn-sm" onClick={download} disabled={!view.length}>
              <NavIcon name="external" />{t('slog2.download')}
            </button>
            <button type="button" className={`btn btn-sm${paused ? ' btn-primary' : ''}`} onClick={() => setPaused((p) => !p)}>
              <NavIcon name={paused ? 'play' : 'stop'} />{paused ? t('common.resume') : t('common.pause')}
            </button>
          </>
        )}
      />
      <div className="audit-toolbar">
        <div className="seg slog-levels" role="tablist">
          {LEVELS.map((lv) => (
            <button key={lv} type="button" role="tab" aria-selected={level === lv} className={`${level === lv ? 'active' : ''} lv-${lv}`} onClick={() => setLevel(lv)}>
              {lv !== 'all' ? <i className="slog-dot" /> : null}
              {t(`slog2.level.${lv}`)}<span className="res-seg-n">{counts[lv] || 0}</span>
            </button>
          ))}
        </div>
        <input className="search audit-search" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
        {paused ? <span className="badge warn">{t('slog2.paused')}</span> : <span className="badge ok">Live</span>}
      </div>
      {err && <div className="err">{err}</div>}
      <PanelCard padded={false}>
        {view.length === 0 ? (
          <Empty title={t('slog.empty')} text={t('slog.emptyText')} />
        ) : (
          <div className="fx-log" ref={boxRef}>
            {view.map((line) => (
              <div key={line.id} className={`fx-log-line lvl-${line.level || 'info'}`}>
                <time>{fmtLineTime(line.t)}</time>
                <span className="fx-log-lvl">{line.level}</span>
                <code>{line.text}</code>
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </Page>
  );
}

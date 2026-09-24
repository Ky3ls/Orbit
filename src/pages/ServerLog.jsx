import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import { toBcp47 } from '../i18n/core.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

export default function ServerLog() {
  const { t, lang } = useI18n();
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [paused, setPaused] = useState(false);
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

  const view = q.trim()
    ? lines.filter((l) => `${l.level} ${l.text}`.toLowerCase().includes(q.toLowerCase()))
    : lines;

  return (
    <Page>
      <PageHeader
        eyebrow={t('slog.eyebrow')}
        title={t('page.serverLog')}
        description={t('slog.desc')}
        actions={(
          <div className="row" style={{ gap: 8 }}>
            <input className="search" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn btn-sm" onClick={() => setPaused((p) => !p)}>
              {paused ? t('common.resume') : t('common.pause')}
            </button>
          </div>
        )}
      />
      <p className="page-hint muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 13 }}>
        {t('slog.hint')}
      </p>
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

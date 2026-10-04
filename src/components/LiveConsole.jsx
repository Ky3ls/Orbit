import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mergeLines } from '../api.js';
import { consoleLineVisible } from '../appearance.js';
import { splitOrbitPlayerLine, stripAnsi } from '../consoleFormat.js';
import { fmtTime } from '../format.js';
import { useAppearance } from '../hooks/useAppearance.js';
import { useFxStatus } from '../hooks/useFxStatus.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

const MIN_H = 220;
const MAX_H = 620;
const DEFAULT_H = 340;
const QUICK = ['status', 'players', 'refresh', 'say Willkommen auf dem Server'];

function ConsoleLineText({ text, onPlayerClick }) {
  const parts = splitOrbitPlayerLine(text);
  if (!parts) return stripAnsi(text);
  return (
    <>
      {parts.before}
      <button
        type="button"
        className="lc-player-link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPlayerClick?.(parts);
        }}
        title="Spieler öffnen"
      >
        {parts.linkText}
      </button>
      {parts.after}
    </>
  );
}

/**
 * @param {{
 *   variant?: 'drawer' | 'page' | 'side' | 'cockpit',
 *   open?: boolean,
 *   onClose?: () => void,
 *   height?: number,
 *   onHeight?: (n: number) => void,
 * }} props
 */
export default function LiveConsole({
  variant = 'drawer',
  open = true,
  onClose,
  height,
  onHeight,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const active = variant === 'page' || variant === 'side' || variant === 'cockpit' || open;
  const fx = useFxStatus(active ? 8000 : 60_000);
  const [prefs] = useAppearance();
  const [targets, setTargets] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const box = useRef(null);
  const drag = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const stick = useRef(true);
  const inputRef = useRef(null);
  const consoleBuf = useRef([]);
  const consoleRaf = useRef(0);
  /** true = offline bestätigt → keine (Alt-)Logs annehmen */
  const suppressLogsRef = useRef(false);

  /** FX läuft / startet — sonst Konsole leer halten (keine Alt-Logs). */
  const consoleLive = !!(
    fx.online
    || fx.processActive
    || fx.unitActive
    || fx.status === 'starting'
    || fx.status === 'restarting'
    || fx.supervisorPhase === 'starting'
    || fx.supervisorPhase === 'restarting'
  );

  function wipeConsole() {
    consoleBuf.current = [];
    consoleRaf.current = 0;
    setLines([]);
  }

  useEffect(() => {
    if (!active) return;
    api('/api/servers').then((d) => setTargets(d.servers || [])).catch(() => {});
    api('/api/settings').then((d) => setTargetId(String(d.settings?.consoleTargetServerId || ''))).catch(() => {});
  }, [active]);

  async function setConsoleTarget(id) {
    await api('/api/servers/console-target', { method: 'POST', body: { id: id || '' } });
    setTargetId(String(id || ''));
  }

  // Erst nach Status-Hydration: offline → clear + suppress; live → Logs erlauben
  useEffect(() => {
    if (!fx.ready) return;
    if (consoleLive) {
      suppressLogsRef.current = false;
      return;
    }
    suppressLogsRef.current = true;
    wipeConsole();
  }, [fx.ready, consoleLive]);

  useEffect(() => {
    if (!active) return undefined;
    const es = new EventSource('/api/stream');
    es.addEventListener('console_clear', () => {
      wipeConsole();
    });
    es.addEventListener('console', (e) => {
      if (suppressLogsRef.current) return;
      let incoming;
      try { incoming = JSON.parse(e.data); } catch { return; }
      if (!Array.isArray(incoming) || !incoming.length) return;
      consoleBuf.current.push(...incoming);
      if (consoleRaf.current) return;
      consoleRaf.current = 1;
      queueMicrotask(() => {
        consoleRaf.current = 0;
        if (suppressLogsRef.current) {
          consoleBuf.current = [];
          return;
        }
        const batch = consoleBuf.current;
        consoleBuf.current = [];
        if (batch.length) setLines((prev) => mergeLines(prev, batch));
      });
    });
    es.onerror = () => {};
    return () => {
      es.close();
      consoleRaf.current = 0;
      consoleBuf.current = [];
    };
  }, [active]);

  const visible = useMemo(
    () => lines.filter((line) => consoleLineVisible(line, prefs?.console)),
    [lines, prefs?.console],
  );

  useEffect(() => {
    stick.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    if (active && stick.current && box.current) {
      box.current.scrollTop = box.current.scrollHeight;
    }
  }, [visible, active, autoScroll]);

  useEffect(() => {
    if (!active || variant !== 'drawer') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onClose, variant]);

  function onDragStart(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height || DEFAULT_H;
    drag.current = { startY, startH };
    const move = (ev) => {
      if (!drag.current) return;
      const next = Math.min(MAX_H, Math.max(MIN_H, drag.current.startH + (drag.current.startY - ev.clientY)));
      onHeight?.(next);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function send(cmd) {
    const line = (cmd ?? command).trim();
    if (!line || sending) return;
    setErr('');
    setSending(true);
    try {
      await api('/api/console', { method: 'POST', body: { command: line } });
      setHistory((prev) => [line, ...prev.filter((c) => c !== line)].slice(0, 40));
      setHistIdx(-1);
      setCommand('');
    } catch (error) {
      setErr(error.message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stick.current = atBottom;
    setAutoScroll((prev) => (prev === atBottom ? prev : atBottom));
  }

  function toggleAutoScroll() {
    setAutoScroll((prev) => {
      const next = !prev;
      stick.current = next;
      if (next && box.current) {
        box.current.scrollTop = box.current.scrollHeight;
      }
      return next;
    });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setCommand(history[next]);
    }
    if (e.key === 'ArrowDown' && histIdx >= 0) {
      e.preventDefault();
      const next = histIdx - 1;
      setHistIdx(next);
      setCommand(next < 0 ? '' : history[next]);
    }
  }

  function openPlayerFromConsole(ref) {
    if (!ref) return;
    const params = new URLSearchParams();
    if (ref.name) params.set('open', ref.name);
    if (ref.serverId != null && Number.isFinite(ref.serverId)) {
      params.set('sid', String(ref.serverId));
    }
    const qs = params.toString();
    if (!qs) return;
    navigate(`/players?${qs}`);
    onClose?.();
  }

  if (variant === 'drawer' && !open) return null;

  const h = height || DEFAULT_H;
  const rootClass = variant === 'page'
    ? 'live-console live-console-page'
    : variant === 'side'
      ? 'live-console live-console-side'
      : variant === 'cockpit'
        ? 'live-console live-console-cockpit'
        : 'live-console live-console-drawer';

  return (
    <div
      className={rootClass}
      style={variant === 'drawer' ? { height: h } : undefined}
      role={variant === 'drawer' ? 'dialog' : 'region'}
      aria-label={t('console.aria')}
    >
      {variant === 'drawer' && (
        <button type="button" className="lc-resize" aria-label={t('console.resize')} onPointerDown={onDragStart} />
      )}
      <header className="lc-head">
        <div className="lc-title">
          <span className={`lc-pulse${consoleLive ? ' on' : ''}`} aria-hidden="true" />
          <strong>{t('console.live')}</strong>
        </div>
        {targets.length > 0 && (
          <select
            className="lc-chip"
            style={{ maxWidth: 160 }}
            value={targetId}
            onChange={(e) => setConsoleTarget(e.target.value)}
            title={t('console.targetTitle')}
          >
            <option value="">{t('console.activeServer')}</option>
            {targets.map((s) => (
              <option key={s.id} value={s.id}>{s.name} :{s.port}</option>
            ))}
          </select>
        )}
        <div className="lc-quick">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              className="lc-chip"
              disabled={!fx.fxCommandReady || sending}
              onClick={() => send(q)}
            >
              {q.split(' ')[0]}
            </button>
          ))}
        </div>
        <div className="lc-actions">
          {(variant === 'drawer' || variant === 'side') && (
            <>
              <Link className="btn btn-sm" to="/panel" onClick={onClose}>{t('console.cockpit')}</Link>
              <button type="button" className="btn btn-sm" onClick={onClose}>{t('common.close')}</button>
            </>
          )}
          <button
            type="button"
            className={`btn btn-sm lc-auto${autoScroll ? ' on' : ''}`}
            onClick={toggleAutoScroll}
            aria-pressed={autoScroll}
            title={autoScroll ? t('console.autoOn') : t('console.autoOff')}
          >
            {t('console.auto')}
          </button>
          {variant !== 'cockpit' && (
            <button type="button" className="btn btn-sm" onClick={() => setLines([])}>{t('console.clear')}</button>
          )}
          {variant === 'cockpit' && (
            <button type="button" className="btn btn-sm" onClick={() => setLines([])}>{t('console.clr')}</button>
          )}
        </div>
      </header>
      <div className="lc-term" ref={box} onScroll={onScroll}>
        {visible.length === 0 && (
          <div className="lc-empty">
            {fx.ready && !consoleLive
              ? t('console.emptyOffline')
              : lines.length
                ? t('console.emptyFilter')
                : t('console.emptyWait')}
          </div>
        )}
        {(consoleLive || !fx.ready) && visible.map((line) => (
          <div key={line.id} className={`lc-line ${line.level || 'info'}`}>
            <span className="lc-ts">{fmtTime(line.t)}</span>
            <span className="lc-prompt">›</span>
            <span className="lc-text">
              <ConsoleLineText text={line.text} onPlayerClick={openPlayerFromConsole} />
            </span>
          </div>
        ))}
        {(consoleLive || !fx.ready) && visible.length > 0 && (
          <div className="lc-caret" aria-hidden="true">▌</div>
        )}
      </div>
      {err && <div className="lc-err">{err}</div>}
      <form
        className="lc-form"
        onSubmit={(e) => { e.preventDefault(); if (fx.fxCommandReady) send(); }}
      >
        <input
          ref={inputRef}
          className="mono"
          type="text"
          placeholder={fx.fxCommandReady ? t('console.phReady') : t('console.phOffline')}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          disabled={!fx.fxCommandReady}
          aria-label={t('console.aria')}
        />
      </form>
    </div>
  );
}

export { DEFAULT_H as LIVE_CONSOLE_DEFAULT_H, MIN_H, MAX_H };

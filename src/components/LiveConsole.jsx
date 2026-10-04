import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mergeLines } from '../api.js';
import { consoleLineVisible } from '../appearance.js';
import { splitOrbitPlayerLine, stripAnsi } from '../consoleFormat.js';
import { fmtTime } from '../format.js';
import { useAppearance } from '../hooks/useAppearance.js';
import { isFxConsoleLive, normalizeFx, useFxStatus } from '../hooks/useFxStatus.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

const MIN_H = 220;
const MAX_H = 620;
const DEFAULT_H = 340;
const QUICK = ['status', 'players', 'refresh', 'say Willkommen auf dem Server'];
/** scrollTop-Schwelle: darüber gilt „am oberen Rand“ → Soft-Historie einblenden */
const REVEAL_TOP_PX = 28;

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
  const polledFx = useFxStatus(active ? 8000 : 60_000);
  /** SSE-State ist frischer als der 8s-Poll — gewinnt während Start/Boot */
  const [sseFx, setSseFx] = useState(null);
  const fx = sseFx || polledFx;
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
  const endRef = useRef(null);
  const drag = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const stick = useRef(true);
  /** true während programmatischem Scroll → onScroll darf Auto nicht ausknipsen */
  const progScrollRef = useRef(false);
  const scrollRafRef = useRef(0);
  const inputRef = useRef(null);
  const consoleBuf = useRef([]);
  const consoleRaf = useRef(0);
  /** true = idle-offline bestätigt → keine Alt-Logs annehmen */
  const suppressLogsRef = useRef(false);
  /** nach console_clear / ersten Boot-Logs — Konsole nicht als offline behandeln */
  const [bootOpen, setBootOpen] = useState(false);
  const bootOpenRef = useRef(false);
  const wasLiveRef = useRef(false);

  function setBootGate(open) {
    bootOpenRef.current = open;
    setBootOpen(open);
  }
  /** Soft-Clear: Zeilen mit id ≤ Marker ausblenden (Buffer bleibt erhalten) */
  const [softHiddenBefore, setSoftHiddenBefore] = useState(0);
  /** true = archivierte Soft-Clear-Zeilen wieder einblenden */
  const [revealHistory, setRevealHistory] = useState(false);
  const linesRef = useRef([]);
  const softHiddenBeforeRef = useRef(0);
  const revealHistoryRef = useRef(false);
  /** Scroll-Anker nach Reveal: { prevH, prevTop } */
  const pendingRevealScroll = useRef(null);

  linesRef.current = lines;
  softHiddenBeforeRef.current = softHiddenBefore;
  revealHistoryRef.current = revealHistory;

  /** FX läuft / startet / stoppt — sonst Konsole leer halten (keine Alt-Logs). */
  const consoleLive = isFxConsoleLive(fx) || bootOpen;
  const booting = fx.status === 'starting' || fx.status === 'restarting'
    || fx.controlPhase === 'starting' || fx.controlPhase === 'restarting'
    || fx.supervisorPhase === 'starting'
    || bootOpen;

  function wipeConsole() {
    consoleBuf.current = [];
    consoleRaf.current = 0;
    softHiddenBeforeRef.current = 0;
    revealHistoryRef.current = false;
    pendingRevealScroll.current = null;
    setSoftHiddenBefore(0);
    setRevealHistory(false);
    setLines([]);
  }

  function revealSoftHistory() {
    if (revealHistoryRef.current || !softHiddenBeforeRef.current) return;
    const el = box.current;
    if (el) {
      pendingRevealScroll.current = { prevH: el.scrollHeight, prevTop: el.scrollTop };
    }
    revealHistoryRef.current = true;
    setRevealHistory(true);
    // User schaut Historie → Auto-Scroll aus
    if (stick.current) {
      stick.current = false;
      setAutoScroll(false);
    }
  }

  /** Nur .lc-term scrollen — nie scrollIntoView (scrollt overflow:hidden-Ancestors → Layout-Collapse). */
  function pinConsoleShell() {
    let p = box.current?.parentElement;
    while (p && p !== document.body) {
      if (p.classList?.contains('live-console')
        || p.classList?.contains('ck-term-frame')
        || p.classList?.contains('ck-terminal')
        || p.classList?.contains('ws-main')) {
        if (p.scrollTop) p.scrollTop = 0;
      }
      p = p.parentElement;
    }
  }

  function scrollToEnd() {
    const el = box.current;
    if (!el) return;
    progScrollRef.current = true;
    pinConsoleShell();
    el.scrollTop = el.scrollHeight;
    // nach Layout nochmal anheften (Burst/Start), Flag danach freigeben
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      pinConsoleShell();
      if (box.current) box.current.scrollTop = box.current.scrollHeight;
      scrollRafRef.current = requestAnimationFrame(() => {
        progScrollRef.current = false;
        scrollRafRef.current = 0;
      });
    });
  }

  function enableAutoScroll() {
    stick.current = true;
    setAutoScroll(true);
    scrollToEnd();
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

  // Erst nach Status-Hydration: idle-offline → clear + suppress; live/boot → Logs erlauben
  useEffect(() => {
    if (!fx.ready && !sseFx) return;
    if (isFxConsoleLive(fx) || bootOpen) {
      suppressLogsRef.current = false;
      // Sobald Status live ist, Boot-Gate nicht mehr nötig
      if (isFxConsoleLive(fx) && bootOpen) setBootGate(false);
      if (!wasLiveRef.current) enableAutoScroll();
      wasLiveRef.current = true;
      return;
    }
    // Wirklich idle offline — Boot-Gate zu
    if (bootOpen) setBootGate(false);
    wasLiveRef.current = false;
    suppressLogsRef.current = true;
    wipeConsole();
    enableAutoScroll();
  }, [fx.ready, fx.online, fx.processActive, fx.unitActive, fx.status, fx.controlPhase, fx.supervisorPhase, sseFx, bootOpen]);

  useEffect(() => {
    if (!active) return undefined;
    const es = new EventSource('/api/stream');
    es.addEventListener('state', (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const next = normalizeFx(data);
      setSseFx(next);
      if (isFxConsoleLive(next)) {
        // Start/Boot sofort entperren — nicht auf Poll warten
        suppressLogsRef.current = false;
        if (bootOpenRef.current) setBootGate(false);
      } else if (bootOpenRef.current) {
        // Bestätigt idle/offline → Boot-Gate zu (Effect leert Konsole)
        setBootGate(false);
      }
    });
    es.addEventListener('console_clear', () => {
      // Start/Restart leert Buffer serverseitig → ab jetzt Live-Logs zeigen
      suppressLogsRef.current = false;
      setBootGate(true);
      wipeConsole();
      enableAutoScroll();
    });
    es.addEventListener('console', (e) => {
      if (suppressLogsRef.current && !bootOpenRef.current) return;
      let incoming;
      try { incoming = JSON.parse(e.data); } catch { return; }
      if (!Array.isArray(incoming) || !incoming.length) return;
      // Eingehende Zeilen = Boot/Live läuft → nicht als offline suppressen
      suppressLogsRef.current = false;
      if (!bootOpenRef.current) setBootGate(true);
      consoleBuf.current.push(...incoming);
      if (consoleRaf.current) return;
      consoleRaf.current = 1;
      queueMicrotask(() => {
        consoleRaf.current = 0;
        if (suppressLogsRef.current && !bootOpenRef.current) {
          consoleBuf.current = [];
          return;
        }
        const batch = consoleBuf.current;
        consoleBuf.current = [];
        if (batch.length) {
          // Flag schon vor Commit setzen — sonst kann onScroll zwischen Paint und Effect greifen
          if (stick.current) progScrollRef.current = true;
          setLines((prev) => mergeLines(prev, batch));
        }
      });
    });
    es.onerror = () => {};
    return () => {
      es.close();
      consoleRaf.current = 0;
      consoleBuf.current = [];
      setSseFx(null);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      progScrollRef.current = false;
    };
  }, [active]);

  const filtered = useMemo(
    () => lines.filter((line) => consoleLineVisible(line, prefs?.console)),
    [lines, prefs?.console],
  );

  const hasSoftHidden = softHiddenBefore > 0 && !revealHistory
    && filtered.some((line) => line.id <= softHiddenBefore);

  const visible = useMemo(() => {
    if (!softHiddenBefore || revealHistory) return filtered;
    return filtered.filter((line) => line.id > softHiddenBefore);
  }, [filtered, softHiddenBefore, revealHistory]);

  useEffect(() => {
    stick.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    if (!active || !stick.current) return undefined;
    progScrollRef.current = true;
    scrollToEnd();
    return undefined;
  }, [visible, active, autoScroll]);

  // Soft-Historie eingeblendet: Scrollposition halten (alte Zeilen darüber)
  useLayoutEffect(() => {
    const anchor = pendingRevealScroll.current;
    if (!revealHistory || !anchor) return;
    pendingRevealScroll.current = null;
    const el = box.current;
    if (!el) return;
    progScrollRef.current = true;
    el.scrollTop = Math.max(0, el.scrollHeight - anchor.prevH + anchor.prevTop);
    requestAnimationFrame(() => {
      progScrollRef.current = false;
    });
  }, [revealHistory, visible]);

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
    // Programmatisches Scrollen (Append/Burst) darf Auto nie deaktivieren
    if (progScrollRef.current) return;
    const el = box.current;
    if (!el) return;
    // Soft-Clear: am oberen Rand → archivierte Zeilen wieder einblenden
    if (el.scrollTop <= REVEAL_TOP_PX) {
      revealSoftHistory();
    }
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = gap < 80;
    if (!atBottom) {
      // Nur User-Scroll nach oben → Auto aus
      if (stick.current) {
        stick.current = false;
        setAutoScroll(false);
      }
      return;
    }
    // Zurück am Ende → Auto wieder an
    if (!stick.current) {
      stick.current = true;
      setAutoScroll(true);
    }
  }

  function onTermWheel(e) {
    if (progScrollRef.current) return;
    const el = box.current;
    if (!el) return;
    // Kurzer Viewport nach CLR: kein Scrollbar → Wheel-hoch öffnet Historie
    if (e.deltaY < 0 && el.scrollTop <= REVEAL_TOP_PX) {
      revealSoftHistory();
    }
  }

  function toggleAutoScroll() {
    setAutoScroll((prev) => {
      const next = !prev;
      stick.current = next;
      if (next) scrollToEnd();
      return next;
    });
  }

  /** Soft-Clear: Viewport leeren, History behalten; Hochscrollen zeigt Altes wieder. */
  function clearLines() {
    const prev = linesRef.current;
    const lastId = prev.length ? prev[prev.length - 1].id : 0;
    if (lastId) {
      softHiddenBeforeRef.current = lastId;
      revealHistoryRef.current = false;
      pendingRevealScroll.current = null;
      setSoftHiddenBefore(lastId);
      setRevealHistory(false);
    }
    enableAutoScroll();
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
          <span
            className={`lc-pulse${consoleLive ? ' on' : ''}${booting && !fx.online ? ' boot' : ''}`}
            aria-hidden="true"
          />
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
          {variant !== 'cockpit' && (
            <button type="button" className="btn btn-sm lc-action-btn" onClick={clearLines}>{t('console.clear')}</button>
          )}
          {variant === 'cockpit' && (
            <button type="button" className="btn btn-sm lc-action-btn" onClick={clearLines}>{t('console.clr')}</button>
          )}
          <button
            type="button"
            className={`btn btn-sm lc-action-btn lc-auto${autoScroll ? ' on' : ''}`}
            onClick={toggleAutoScroll}
            aria-pressed={autoScroll}
            title={autoScroll ? t('console.autoOn') : t('console.autoOff')}
          >
            {t('console.auto')}
          </button>
        </div>
      </header>
      <div className="lc-term" ref={box} onScroll={onScroll} onWheel={onTermWheel}>
        {hasSoftHidden && (consoleLive || booting || !fx.ready) && (
          <button
            type="button"
            className="lc-soft-clear-cue"
            onClick={revealSoftHistory}
            title={t('console.softClearHint')}
          >
            {t('console.softClearCue')}
          </button>
        )}
        {visible.length === 0 && (
          <div className="lc-empty">
            {fx.ready && !consoleLive && !booting
              ? t('console.emptyOffline')
              : booting && !lines.length
                ? t('console.emptyStarting')
                : hasSoftHidden
                  ? t('console.softClearEmpty')
                  : lines.length
                    ? t('console.emptyFilter')
                    : t('console.emptyWait')}
          </div>
        )}
        {(consoleLive || !fx.ready || booting) && visible.map((line) => (
          <div key={line.id} className={`lc-line ${line.level || 'info'}`}>
            <span className="lc-ts">{fmtTime(line.t)}</span>
            <span className="lc-prompt">›</span>
            <span className="lc-text">
              <ConsoleLineText text={line.text} onPlayerClick={openPlayerFromConsole} />
            </span>
          </div>
        ))}
        {(consoleLive || !fx.ready || booting) && (
          <div ref={endRef} aria-hidden="true" style={{ height: 0, overflow: 'hidden' }} />
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
          placeholder={
            fx.fxCommandReady
              ? t('console.phReady')
              : booting || consoleLive
                ? t('console.phStarting')
                : t('console.phOffline')
          }
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

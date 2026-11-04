import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ACCENT_PRESETS } from '../appearance.js';
import { toast } from '../components/toast.jsx';
import { NavIcon } from '../layout/icons.jsx';
import { allModuleItems } from '../layout/modules.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

function score(hay, q) {
  if (!q) return 1;
  const h = hay.toLowerCase();
  const needle = q.toLowerCase().trim();
  if (!needle) return 1;
  if (h.startsWith(needle)) return 3;
  if (h.includes(` ${needle}`)) return 2.5;
  if (h.includes(needle)) return 2;
  // Buchstabenfolge (fuzzy): „mon“ → „Monitoring“, „srvlog“ → „Server-Log“
  let i = 0;
  for (const ch of h) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return 1;
  }
  return 0;
}

/**
 * Befehlspalette (Strg/⌘ + K): Seiten, Server-Aktionen, Spielersuche, Darstellung.
 */
export default function CommandPalette({ open, onClose, user, prefs, setAppearance, canControl, status, onLogout, onShortcuts, refreshStatus, mcList = [] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [players, setPlayers] = useState([]);
  const [armed, setArmed] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    setArmed('');
    setPlayers([]);
  }, [open]);

  /* Spielersuche (debounced) */
  useEffect(() => {
    if (!open) return undefined;
    const needle = q.trim();
    if (needle.length < 2) { setPlayers([]); return undefined; }
    let alive = true;
    const id = window.setTimeout(() => {
      api(`/api/players?q=${encodeURIComponent(needle)}&filter=all`)
        .then((d) => { if (alive) setPlayers((d.list || []).slice(0, 6)); })
        .catch(() => {});
    }, 180);
    return () => { alive = false; window.clearTimeout(id); };
  }, [q, open]);

  async function power(action) {
    if (armed !== action && action !== 'start') {
      setArmed(action);
      return false;
    }
    try {
      await api('/api/server/control', { method: 'POST', body: { action } });
      toast.ok(t(`palette.toast.${action}`));
      refreshStatus?.();
    } catch (e) {
      toast.err(t('palette.toast.fail'), { text: e.message });
    }
    return true;
  }

  const items = useMemo(() => {
    const out = [];
    for (const m of allModuleItems()) {
      if (m.owner && user.role !== 'owner') continue;
      out.push({
        id: `nav:${m.to}`,
        section: t('palette.pages'),
        icon: m.icon,
        label: t(m.labelKey),
        hint: t(m.groupKey),
        kbd: m.key ? ['G', m.key.toUpperCase()] : null,
        hay: `${t(m.labelKey)} ${m.kw || ''} ${m.to}`,
        run: () => { navigate(m.to); return true; },
      });
    }
    for (const m of mcList) {
      out.push({
        id: `mc:${m.id}`,
        section: 'Instanzen',
        icon: 'cube',
        label: m.name,
        hint: `Minecraft · ${m.type} ${m.mcVersion}${m.phase === 'running' ? ' · online' : ''}`,
        hay: `${m.name} minecraft ${m.type} ${m.mcVersion} instanz server`,
        run: () => { navigate(`/mc/${m.id}`); return true; },
      });
    }
    if (user.role === 'owner' || user.role === 'admin') {
      out.push({ id: 'mc:new', section: 'Instanzen', icon: 'plus', label: 'Neue Instanz erstellen', hint: 'Minecraft', hay: 'neue instanz erstellen minecraft server paper fabric forge neoforge vanilla purpur', run: () => { navigate('/instances/new'); return true; } });
    }
    if (canControl) {
      const busy = status === 'starting' || status === 'stopping' || status === 'restarting';
      if (!busy && status !== 'online') {
        out.push({ id: 'pw:start', section: t('palette.server'), icon: 'play', tone: 'ok', label: t('palette.start'), hay: 'server start starten hochfahren power', run: () => power('start') });
      }
      if (!busy && status === 'online') {
        out.push({
          id: 'pw:restart', section: t('palette.server'), icon: 'restart', tone: 'warn',
          label: armed === 'restart' ? t('palette.confirm') : t('palette.restart'),
          hay: 'server restart neustart neu starten reboot power', run: () => power('restart'),
        });
        out.push({
          id: 'pw:stop', section: t('palette.server'), icon: 'stop', tone: 'bad',
          label: armed === 'stop' ? t('palette.confirm') : t('palette.stop'),
          hay: 'server stop stoppen herunterfahren aus power', run: () => power('stop'),
        });
      }
    }
    const light = prefs.theme === 'light';
    out.push({
      id: 'ui:theme', section: t('palette.appearance'), icon: light ? 'moon' : 'sun',
      label: light ? t('shell.darkMode') : t('shell.lightMode'),
      hay: 'theme hell dunkel light dark modus farbe', kbd: ['Shift', 'T'],
      run: () => { setAppearance({ theme: light ? 'dark' : 'light' }); return true; },
    });
    out.push({
      id: 'ui:sidebar', section: t('palette.appearance'), icon: prefs.sidebarCollapsed ? 'expand' : 'collapse',
      label: prefs.sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar'),
      hay: 'sidebar navigation einklappen ausklappen', kbd: ['['],
      run: () => { setAppearance({ sidebarCollapsed: !prefs.sidebarCollapsed }); return true; },
    });
    for (const a of Object.values(ACCENT_PRESETS)) {
      if (a.id === prefs.accent) continue;
      out.push({
        id: `ui:accent:${a.id}`, section: t('palette.accent'), swatch: a.hex,
        label: t('palette.accentTo', { name: a.label }), hay: `akzent farbe accent color ${a.label} ${a.id}`,
        run: () => { setAppearance({ accent: a.id }); return true; },
        hidden: !q.trim(),
      });
    }
    out.push({ id: 'ui:keys', section: t('palette.help'), icon: 'keyboard', label: t('palette.shortcuts'), hay: 'shortcuts tastenkürzel hilfe keyboard', kbd: ['?'], run: () => { onShortcuts(); return true; } });
    out.push({ id: 'ui:logout', section: t('palette.help'), icon: 'logout', label: t('common.logout'), hay: 'logout abmelden ausloggen', run: () => { onLogout(); return true; } });
    return out;
  }, [t, user.role, canControl, status, prefs, armed, q, navigate, setAppearance, onLogout, onShortcuts, mcList]);

  const results = useMemo(() => {
    const scored = items
      .filter((i) => !i.hidden || q.trim())
      .map((i) => ({ ...i, s: score(i.hay, q) }))
      .filter((i) => i.s > 0);
    if (q.trim()) scored.sort((a, b) => b.s - a.s);
    const playerItems = players.map((p) => ({
      id: `pl:${p.identifier}`,
      section: t('palette.players'),
      avatar: p.name,
      online: p.online,
      label: p.name,
      hint: p.online ? `ID ${p.serverId ?? '–'} · ${p.ping ?? '–'} ms` : t('status.offline'),
      run: () => { navigate(`/players?open=${encodeURIComponent(p.name)}`); return true; },
    }));
    return q.trim() ? [...playerItems, ...scored] : scored;
  }, [items, players, q, t, navigate]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-sel="1"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  async function runAt(idx) {
    const item = results[idx];
    if (!item) return;
    const done = await item.run();
    if (done !== false) onClose();
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  let lastSection = '';
  return (
    <div className="cmdk-back" onMouseDown={onClose} role="presentation">
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('palette.title')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <NavIcon name="search" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('palette.placeholder')}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="cmdk-empty">
              <NavIcon name="search" />
              <span>{t('palette.empty', { q })}</span>
            </div>
          ) : results.map((item, idx) => {
            const head = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.id}>
                {head ? <div className="cmdk-section">{head}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === sel}
                  data-sel={idx === sel ? '1' : '0'}
                  className={`cmdk-item${idx === sel ? ' sel' : ''}${item.tone ? ` tone-${item.tone}` : ''}`}
                  onMouseMove={() => setSel(idx)}
                  onClick={() => runAt(idx)}
                >
                  <span className="cmdk-ico">
                    {item.avatar ? (
                      <span className={`cmdk-avatar${item.online ? ' on' : ''}`}>{item.avatar.slice(0, 1).toUpperCase()}</span>
                    ) : item.swatch ? (
                      <span className="cmdk-swatch" style={{ background: item.swatch }} />
                    ) : (
                      <NavIcon name={item.icon} />
                    )}
                  </span>
                  <span className="cmdk-label">{item.label}</span>
                  {item.hint ? <span className="cmdk-hint">{item.hint}</span> : null}
                  {item.kbd ? <span className="cmdk-kbd">{item.kbd.map((k) => <kbd key={k}>{k}</kbd>)}</span> : null}
                  <span className="cmdk-enter" aria-hidden="true"><NavIcon name="arrowRight" /></span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('palette.navigate')}</span>
          <span><kbd>↵</kbd> {t('palette.run')}</span>
          <span className="grow" />
          <span className="cmdk-brand">Orbit</span>
        </div>
      </div>
    </div>
  );
}

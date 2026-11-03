const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

/** Orbit-Icon-Set (24er Raster, Strichstärke 1.8, Farbe via currentColor). */
const PATHS = {
  home: <><path d="M3.5 10.2 12 3.8l8.5 6.4V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7" height="9" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.6" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.6" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.6" /></>,
  users: <><path d="M16 20v-1.2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7.8" r="3.3" /><path d="M21 20v-1.2a3.6 3.6 0 0 0-2.6-3.4M15.6 4.6a3.3 3.3 0 0 1 0 6.4" /></>,
  box: <><path d="M3.5 7.8 12 3.5l8.5 4.3v8.4L12 20.5l-8.5-4.3z" /><path d="M3.5 7.8 12 12l8.5-4.2M12 12v8.5" /></>,
  term: <><rect x="3" y="4.5" width="18" height="15" rx="2.2" /><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" /></>,
  chart: <><path d="M3 12h3.5l2.5-6 4 12 2.6-6H21" /></>,
  cfg: <><path d="M14.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h5M9 13l-1.5 1.5L9 16M13 13l1.5 1.5L13 16" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></>,
  drop: <><path d="M12 3c3 4 6 7 6 10a6 6 0 1 1-12 0c0-3 3-6 6-10z" /></>,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  wl: <><path d="m5 12.5 4.2 4.2L19 7" /></>,
  check: <><path d="m5 12.5 4.2 4.2L19 7" /></>,
  db: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  log: <><path d="M5 4.5h14v15H5z" /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" /></>,
  audit: <><path d="M12 3.5 19.5 6v5.5c0 4.6-3.2 7.9-7.5 9-4.3-1.1-7.5-4.4-7.5-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  team: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5v-.7A4.3 4.3 0 0 1 7.3 14.5h3.4a4.3 4.3 0 0 1 4.3 4.3v.7" /><path d="M16.5 4.9a3.2 3.2 0 0 1 0 6.2M21 19.5v-.7a4.3 4.3 0 0 0-3-4.1" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  setup: <><path d="M12 3 4 7v10l8 4 8-4V7z" /></>,
  gamepad: <><rect x="2.5" y="7" width="19" height="11" rx="5.5" /><path d="M7 11v3M5.5 12.5h3M15 11.5h.01M17.5 13.5h.01" /></>,
  power: <><path d="M12 3.5v8" /><path d="M7.2 6.5a7.5 7.5 0 1 0 9.6 0" /></>,
  play: <><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7z" /></>,
  stop: <><rect x="5.5" y="5.5" width="13" height="13" rx="2.2" /></>,
  restart: <><path d="M20 11.5A8 8 0 1 1 17.7 6" /><path d="M20 4v4.5h-4.5" /></>,
  refresh: <><path d="M20 11.5A8 8 0 1 1 17.7 6" /><path d="M20 4v4.5h-4.5" /></>,
  more: <><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></>,
  logout: <><path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" /><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5" /></>,
  collapse: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M9.5 4v16M15.5 10l-2 2 2 2" /></>,
  expand: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M9.5 4v16M13.5 10l2 2-2 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>,
  command: <><path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v11m0-11h6m-6 11A2.5 2.5 0 1 1 6.5 15H9zm0 0h6m0-11A2.5 2.5 0 1 1 17.5 9H15zm0 0v11m0 0a2.5 2.5 0 1 0 2.5-2.5H15" /></>,
  chevron: <><path d="m9 6 6 6-6 6" /></>,
  chevronDown: <><path d="m6 9 6 6 6-6" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.2" /><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" /></>,
  memory: <><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 7v10M11 7v10M15 7v10M5 17v2.5M19 17v2.5" /></>,
  signal: <><path d="M4 19v-3M9 19v-7M14 19V9M19 19V5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.3 8.4 12S9.6 5.9 12 3.5z" /></>,
  bolt: <><path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.2" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" /></>,
  bell: <><path d="M6 9.5a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  activity: <><path d="M3 12h3.5l2.5-6 4 12 2.6-6H21" /></>,
  folder: <><path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4.1l2 2.2h7.5a1.7 1.7 0 0 1 1.7 1.7v8.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" /></>,
  external: <><path d="M14 4.5h5.5V10M19.5 4.5 11 13" /><path d="M18 14v4.3a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3V7.7A1.7 1.7 0 0 1 5.7 6H10" /></>,
  megaphone: <><path d="M3.5 10v4a1 1 0 0 0 1 1H7l6 4.5V4.5L7 9H4.5a1 1 0 0 0-1 1z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  sparkle: <><path d="M12 3.5 13.8 9a1.5 1.5 0 0 0 1 1l5.7 2-5.7 2a1.5 1.5 0 0 0-1 1L12 20.5 10.2 15a1.5 1.5 0 0 0-1-1L3.5 12l5.7-2a1.5 1.5 0 0 0 1-1z" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z" /><circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
};

export function NavIcon({ name, size }) {
  const body = PATHS[name] || <circle cx="12" cy="12" r="2" />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...p}>
      {body}
    </svg>
  );
}

export const Icon = NavIcon;

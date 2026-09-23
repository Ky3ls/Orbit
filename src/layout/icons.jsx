const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function NavIcon({ name }) {
  switch (name) {
    case 'home': return <svg viewBox="0 0 24 24" {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
    case 'users': return <svg viewBox="0 0 24 24" {...p}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="8" r="3" /></svg>;
    case 'box': return <svg viewBox="0 0 24 24" {...p}><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /></svg>;
    case 'term': return <svg viewBox="0 0 24 24" {...p}><path d="M4 6h16v12H4z" /><path d="M7 10l3 2-3 2M12 14h5" /></svg>;
    case 'chart': return <svg viewBox="0 0 24 24" {...p}><path d="M4 20V10M12 20V4M20 20v-8" /></svg>;
    case 'cfg': return <svg viewBox="0 0 24 24" {...p}><path d="M8 6h12M8 12h12M8 18h8" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></svg>;
    case 'clock': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
    case 'list': return <svg viewBox="0 0 24 24" {...p}><path d="M8 6h12M8 12h12M8 18h12" /></svg>;
    case 'drop': return <svg viewBox="0 0 24 24" {...p}><path d="M12 3c3 4 6 7 6 10a6 6 0 1 1-12 0c0-3 3-6 6-10z" /></svg>;
    case 'ban': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="8" /><path d="M5 5l14 14" /></svg>;
    case 'wl': return <svg viewBox="0 0 24 24" {...p}><path d="M5 12l4 4L19 6" /></svg>;
    case 'db': return <svg viewBox="0 0 24 24" {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></svg>;
    case 'log': return <svg viewBox="0 0 24 24" {...p}><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case 'audit': return <svg viewBox="0 0 24 24" {...p}><path d="M8 6h11M8 12h11M8 18h11" /></svg>;
    case 'team': return <svg viewBox="0 0 24 24" {...p}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="8" r="3" /><path d="M20 20v-1a3.5 3.5 0 0 0-2.5-3.3M16 5.2a3 3 0 0 1 0 5.6" /></svg>;
    case 'gear': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M4.9 6.5l1.4 1.4M18.7 18.7l1.4 1.4" /></svg>;
    case 'setup': return <svg viewBox="0 0 24 24" {...p}><path d="M12 3 4 7v10l8 4 8-4V7z" /></svg>;
    case 'power': return <svg viewBox="0 0 24 24" {...p}><path d="M12 3v8" /><path d="M7.5 6.2a7 7 0 1 0 9 0" /></svg>;
    case 'more': return <svg viewBox="0 0 24 24" {...p}><circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none" /></svg>;
    case 'sun': return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case 'moon': return <svg viewBox="0 0 24 24" {...p}><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7.5 7.5 0 1 0 20 14.5z" /></svg>;
    case 'logout': return <svg viewBox="0 0 24 24" {...p}><path d="M10 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /><path d="M15 16l4-4-4-4M8 12h11" /></svg>;
    case 'collapse': return <svg viewBox="0 0 24 24" {...p}><path d="M15 6l-6 6 6 6" /></svg>;
    case 'expand': return <svg viewBox="0 0 24 24" {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'search': return <svg viewBox="0 0 24 24" {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16.5 16.5 21 21" /></svg>;
    default: return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="2" /></svg>;
  }
}

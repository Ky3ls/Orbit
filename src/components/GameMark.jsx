import { GAMES } from '../games.js';

/** Spiel-Symbol (eigene, neutrale Glyphen — keine Marken-Logos) */
const GLYPHS = {
  minecraft: (
    <>
      <path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z" fill="currentColor" opacity=".22" />
      <path d="M12 2.8 20.5 7.5 12 12.2 3.5 7.5z" fill="currentColor" opacity=".9" />
      <path d="M12 12.2v9l-8.5-4.7v-9z" fill="currentColor" opacity=".55" />
      <path d="M12 12.2v9l8.5-4.7v-9z" fill="currentColor" opacity=".35" />
    </>
  ),
  fivem: <path d="M5 19 9.5 5h3L8 19zm6 0 4.5-14h3L14 19z" fill="currentColor" />,
  terraria: (
    <>
      <path d="M12 21v-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 13c-4.5 0-7-2.6-7-6.6C9.4 6.4 12 9 12 13z" fill="currentColor" opacity=".6" />
      <path d="M12 13c0-5 2.8-8.6 8-9 0 5-3 9-8 9z" fill="currentColor" />
    </>
  ),
  rust: (
    <>
      <path d="M12 2.5 20.2 7.2v9.6L12 21.5l-8.2-4.7V7.2z" fill="currentColor" opacity=".9" />
      <circle cx="12" cy="12" r="3.4" fill="var(--gm-hole, #000)" />
    </>
  ),
  other: <rect x="5" y="5" width="14" height="14" rx="4" fill="currentColor" opacity=".8" />,
};

export default function GameMark({ game, size = 36, color, className = '' }) {
  const g = GAMES[game];
  const style = { width: size, height: size, '--gm': color || g?.color || 'var(--muted)' };
  return (
    <span className={`gm gm-${game || 'other'} ${className}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24">{GLYPHS[game] || GLYPHS.other}</svg>
    </span>
  );
}

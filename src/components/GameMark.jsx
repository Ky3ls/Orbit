/** Kleines Spiel-Logo: Minecraft-Würfel bzw. FiveM-Symbol */
export default function GameMark({ game, size = 36, color }) {
  const style = { width: size, height: size, '--gm': color || (game === 'fivem' ? '#f97316' : '#7fb238') };
  if (game === 'fivem') {
    return (
      <span className="gm gm-fivem" style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 19 9.5 5h3L8 19zm6 0 4.5-14h3L14 19z" fill="currentColor" /></svg>
      </span>
    );
  }
  return (
    <span className="gm gm-mc" style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z" fill="currentColor" opacity=".22" />
        <path d="M12 2.8 20.5 7.5 12 12.2 3.5 7.5z" fill="currentColor" opacity=".9" />
        <path d="M12 12.2v9l-8.5-4.7v-9z" fill="currentColor" opacity=".55" />
        <path d="M12 12.2v9l8.5-4.7v-9z" fill="currentColor" opacity=".35" />
      </svg>
    </span>
  );
}

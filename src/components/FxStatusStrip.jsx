import { Link } from 'react-router-dom';
import { consoleReadyHint, fxModeLabel, processLabel } from '../fxMeta.js';
import { Badge } from './Ui.jsx';

/**
 * @param {{
 *   fxControlMode?: string,
 *   fxCommandReady?: boolean,
 *   processActive?: boolean,
 *   unitActive?: boolean,
 *   online?: boolean,
 *   compact?: boolean,
 * }} props
 */
export default function FxStatusStrip({
  fxControlMode = 'systemd',
  fxCommandReady = false,
  processActive,
  unitActive,
  online = false,
  compact = false,
}) {
  const proc = { fxControlMode, processActive, unitActive };
  const meta = { fxControlMode, fxCommandReady, online };

  return (
    <div className={`fx-strip${compact ? ' compact' : ''}`} role="status" aria-label="FX-Steuerung">
      <span className="fx-chip">
        <span className="muted">Modus</span>
        <b>{fxModeLabel(fxControlMode)}</b>
      </span>
      <span className="fx-chip">
        <span className="muted">Prozess</span>
        <Badge tone={(processActive ?? unitActive) ? 'ok' : ''}>{processLabel(proc)}</Badge>
      </span>
      <span className="fx-chip">
        <span className="muted">Spiel</span>
        <Badge tone={online ? 'ok' : 'bad'}>{online ? 'Port live' : 'offline'}</Badge>
      </span>
      <span className="fx-chip grow">
        <span className="muted">Konsole</span>
        <Badge tone={fxCommandReady ? 'ok' : 'warn'}>{fxCommandReady ? 'verbunden' : 'nicht bereit'}</Badge>
      </span>
      {!compact && (
        <p className="muted fx-strip-hint">{consoleReadyHint(meta)} <Link to="/settings">Einstellungen</Link></p>
      )}
    </div>
  );
}

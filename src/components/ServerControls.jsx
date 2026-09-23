import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fxModeShort } from '../fxMeta.js';

const LABELS = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Startet…',
  stopping: 'Stoppt…',
  restarting: 'Neustart…',
};

export function statusTone(status) {
  if (status === 'online') return 'ok';
  if (status === 'offline') return 'bad';
  return 'warn';
}

export function statusLabel(status) {
  return LABELS[status] || LABELS.offline;
}

/**
 * @param {{
 *   status?: string,
 *   controlEnabled?: boolean,
 *   busy?: boolean,
 *   compact?: boolean,
 *   onDone?: () => void,
 *   canControl?: boolean,
 *   fxControlMode?: string,
 *   fxCommandReady?: boolean,
 * }} props
 */
export default function ServerControls({
  status = 'offline',
  controlEnabled = false,
  busy = false,
  compact = false,
  onDone,
  canControl = true,
  fxControlMode = 'systemd',
  fxCommandReady = false,
}) {
  const [pending, setPending] = useState('');
  const [err, setErr] = useState('');
  const locked = busy || !!pending || status === 'starting' || status === 'stopping' || status === 'restarting';

  async function run(action) {
    if (!canControl || locked) return;
    setErr('');
    setPending(action);
    try {
      await api('/api/server/control', { method: 'POST', body: { action } });
      onDone?.();
    } catch (error) {
      setErr(error.message);
    } finally {
      setPending('');
    }
  }

  return (
    <div className={`srv-ctl${compact ? ' compact' : ''}`}>
      <div className={`srv-badge tone-${statusTone(status)}`}>
        <span className="srv-dot" />
        {statusLabel(status)}
        <em className="srv-mode">{fxModeShort(fxControlMode)}</em>
      </div>
      {!fxCommandReady && status === 'online' && (
        <p className="srv-hint muted">
          Konsole/Ressourcen: {fxControlMode === 'orbit' ? 'Orbit hält den Prozess nicht' : 'RCON oder Orbit-Modus'} —
          <Link to="/settings"> Setup</Link>
        </p>
      )}
      {canControl && (
        <div className="srv-actions" role="group" aria-label="Server-Steuerung">
          <button
            type="button"
            className="btn btn-sm srv-start"
            disabled={locked || status === 'online'}
            onClick={() => run('start')}
          >
            {pending === 'start' ? '…' : 'Start'}
          </button>
          <button
            type="button"
            className="btn btn-sm srv-stop"
            disabled={locked || status === 'offline'}
            onClick={() => run('stop')}
          >
            {pending === 'stop' ? '…' : 'Stop'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary srv-restart"
            disabled={locked}
            onClick={() => run('restart')}
          >
            {pending === 'restart' ? '…' : 'Restart'}
          </button>
        </div>
      )}
      {err && <p className="srv-err">{err}</p>}
    </div>
  );
}

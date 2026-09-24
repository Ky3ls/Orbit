import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fxModeShort } from '../fxMeta.js';
import { CATALOG } from '../i18n/catalog.js';
import { getLang, translate } from '../i18n/core.js';
import { useI18n } from '../i18n/I18nProvider.jsx';

const STATUS_KEYS = {
  online: 'status.online',
  offline: 'status.offline',
  starting: 'status.starting',
  stopping: 'status.stopping',
  restarting: 'status.restarting',
};

export function statusTone(status) {
  if (status === 'online') return 'ok';
  if (status === 'offline') return 'bad';
  return 'warn';
}

export function statusLabel(status) {
  const key = STATUS_KEYS[status] || STATUS_KEYS.offline;
  return translate(CATALOG, getLang(), key);
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
  const { t } = useI18n();
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

  const hintMode = fxControlMode === 'orbit' ? t('ctl.hintOrbit') : t('ctl.hintRcon');

  return (
    <div className={`srv-ctl${compact ? ' compact' : ''}`}>
      <div className={`srv-badge tone-${statusTone(status)}`}>
        <span className="srv-dot" />
        {t(STATUS_KEYS[status] || STATUS_KEYS.offline)}
        <em className="srv-mode">{fxModeShort(fxControlMode)}</em>
      </div>
      {!fxCommandReady && status === 'online' && (
        <p className="srv-hint muted">
          {t('ctl.hintPrefix')}: {hintMode} —
          <Link to="/settings"> {t('ctl.setup')}</Link>
        </p>
      )}
      {canControl && (
        <div className="srv-actions" role="group" aria-label={t('shell.serverControls')}>
          <button
            type="button"
            className="btn btn-sm srv-start"
            disabled={locked || status === 'online'}
            onClick={() => run('start')}
          >
            {pending === 'start' ? '…' : t('ctl.start')}
          </button>
          <button
            type="button"
            className="btn btn-sm srv-stop"
            disabled={locked || status === 'offline'}
            onClick={() => run('stop')}
          >
            {pending === 'stop' ? '…' : t('ctl.stop')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary srv-restart"
            disabled={locked}
            onClick={() => run('restart')}
          >
            {pending === 'restart' ? '…' : t('ctl.restart')}
          </button>
        </div>
      )}
      {err && <p className="srv-err">{err}</p>}
    </div>
  );
}

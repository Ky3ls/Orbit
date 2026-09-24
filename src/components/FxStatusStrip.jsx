import { Link } from 'react-router-dom';
import { consoleReadyHint, fxModeLabel, processLabel } from '../fxMeta.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
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
  const { t } = useI18n();
  const proc = { fxControlMode, processActive, unitActive };
  const meta = { fxControlMode, fxCommandReady, online };

  return (
    <div className={`fx-strip${compact ? ' compact' : ''}`} role="status" aria-label={t('fx.aria')}>
      <span className="fx-chip">
        <span className="muted">{t('fx.mode')}</span>
        <b>{fxModeLabel(fxControlMode, t)}</b>
      </span>
      <span className="fx-chip">
        <span className="muted">{t('fx.process')}</span>
        <Badge tone={(processActive ?? unitActive) ? 'ok' : ''}>{processLabel(proc, t)}</Badge>
      </span>
      <span className="fx-chip">
        <span className="muted">{t('fx.game')}</span>
        <Badge tone={online ? 'ok' : 'bad'}>{online ? t('fx.portLive') : t('status.offline')}</Badge>
      </span>
      <span className="fx-chip grow">
        <span className="muted">{t('fx.console')}</span>
        <Badge tone={fxCommandReady ? 'ok' : 'warn'}>{fxCommandReady ? t('fx.connected') : t('fx.notReady')}</Badge>
      </span>
      {!compact && (
        <p className="muted fx-strip-hint">{consoleReadyHint(meta, t)} <Link to="/settings">{t('common.settings')}</Link></p>
      )}
    </div>
  );
}

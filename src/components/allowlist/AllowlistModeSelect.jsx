import { useMemo } from 'react';
import OrbitSelect from '../OrbitSelect.jsx';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import {
  ALLOWLIST_MODE_HINT_KEYS,
  ALLOWLIST_MODE_KEYS,
  ALLOWLIST_MODE_VALUES,
} from './allowlistUtils.js';

/**
 * Dropdown für Allowlist-Modus / -Quelle.
 * @param {{ value: string, modes?: { value: string, label?: string }[], onChange: (mode: string) => void, disabled?: boolean }} props
 */
export default function AllowlistModeSelect({
  value,
  modes,
  onChange,
  disabled = false,
}) {
  const { t } = useI18n();
  const mode = value || 'disabled';

  const options = useMemo(() => {
    const base = Array.isArray(modes) && modes.length
      ? modes.map((m) => m.value)
      : ALLOWLIST_MODE_VALUES;
    return base.map((v) => ({
      value: v,
      label: t(ALLOWLIST_MODE_KEYS[v] || v),
      hint: ALLOWLIST_MODE_HINT_KEYS[v] ? t(ALLOWLIST_MODE_HINT_KEYS[v]) : undefined,
    }));
  }, [modes, t]);

  return (
    <OrbitSelect
      className="al-mode-select"
      label={t('settings.allowlist.modeLabel')}
      value={mode}
      options={options}
      disabled={disabled}
      onChange={(next) => onChange?.(String(next))}
    />
  );
}

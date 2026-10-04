import AllowlistModeSelect from './AllowlistModeSelect.jsx';
import AllowlistDiscordRoles from './AllowlistDiscordRoles.jsx';
import { instructionsDisabled, rolesNeedPanel } from './allowlistUtils.js';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import './allowlist.css';

/**
 * Modulare Allowlist-Felder für Settings → Allowlist & Bans (linke Hälfte).
 * Persistenz: PUT /api/settings (allowlistMode, allowlistInstructions,
 * allowlistDiscordRoles, ipAllowlist).
 */
export default function AllowlistPanel({
  mode,
  modes,
  instructions,
  discordRoles,
  ipAllowlist,
  showIp = false,
  onChange,
}) {
  const { t } = useI18n();
  const current = mode || 'disabled';
  const showRoles = rolesNeedPanel(current);
  const patch = (partial) => onChange?.(partial);

  return (
    <div className="al-panel">
      <AllowlistModeSelect
        value={current}
        modes={modes}
        onChange={(next) => patch({ allowlistMode: next })}
      />

      <label className="field">
        <span>{t('settings.allowlist.instructions')}</span>
        <textarea
          rows={3}
          value={instructions || ''}
          onChange={(e) => patch({ allowlistInstructions: e.target.value })}
          disabled={instructionsDisabled(current)}
        />
      </label>

      {showRoles ? (
        <AllowlistDiscordRoles
          value={discordRoles || ''}
          onChange={(csv) => patch({ allowlistDiscordRoles: csv })}
          defaultOpen
        />
      ) : null}

      {showIp ? (
        <label className="field">
          <span>{t('settings.allowlist.ip')}</span>
          <textarea
            placeholder={t('settings.allowlist.ipPh')}
            value={ipAllowlist || ''}
            onChange={(e) => patch({ ipAllowlist: e.target.value })}
            rows={2}
          />
        </label>
      ) : null}
    </div>
  );
}

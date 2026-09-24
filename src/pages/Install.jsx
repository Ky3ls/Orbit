import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Mark } from '../components/Ui.jsx';
import './install.css';

const CFX_HINTS = {
  pin: 'PIN zuerst bestätigen, dann Cfx.re verknüpfen.',
  taken: 'Dieses Cfx.re-Konto ist bereits verknüpft.',
  error: 'Cfx.re-Verknüpfung fehlgeschlagen.',
  rate: 'Zu viele Versuche. Kurz warten.',
};

export default function Install({
  phase = 'pin',
  pendingCfx = null,
  setupPin = null,
  onMasterDone,
  onPhaseRefresh,
}) {
  const [params] = useSearchParams();
  const urlPin = (params.get('pin') || '').replace(/\D/g, '').slice(0, 4);
  const serverPin = String(setupPin?.pin || '').replace(/\D/g, '').slice(0, 4);
  const [pin, setPin] = useState(urlPin || serverPin);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState(CFX_HINTS[params.get('cfx')] || '');
  const [busy, setBusy] = useState(false);

  const createMode = phase === 'create' || params.get('step') === 'create';
  const pinOk = useMemo(() => /^\d{4}$/.test(pin), [pin]);

  useEffect(() => {
    if (urlPin) setPin(urlPin);
    else if (serverPin) setPin(serverPin);
  }, [urlPin, serverPin]);

  useEffect(() => {
    if (params.get('step') === 'create') onPhaseRefresh?.();
  }, [params]);

  async function linkAccount(e) {
    e.preventDefault();
    setErr('');
    if (!pinOk) {
      setErr('PIN muss 4 Ziffern haben.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/bootstrap/pin', { method: 'POST', body: { pin } });
      window.location.assign('/api/auth/cfx/start?mode=claim');
    } catch (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  async function createMaster(e) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) {
      setErr('Passwörter stimmen nicht überein.');
      return;
    }
    if (!accept) {
      setErr('Bitte die Bedingungen akzeptieren.');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/api/bootstrap/master', {
        method: 'POST',
        body: { password, accept: true, discordId },
      });
      onMasterDone?.(data);
    } catch (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  if (createMode) {
    return (
      <div className="orb-boot">
        <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
        <form className="orb-boot-card" onSubmit={createMaster}>
          <div className="brand-link"><Mark /> Orbit</div>
          <div className="orb-cfx-id">
            <div className="orb-cfx-avatar" aria-hidden="true">
              {(pendingCfx?.name || 'C').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <span className="eyebrow">Cfx.re Account</span>
              <strong>{pendingCfx?.name || 'cfx_user'}</strong>
              <div className="mono muted" style={{ fontSize: 12, marginTop: 2 }}>
                {pendingCfx?.fivem || (pendingCfx?.id ? `fivem:${pendingCfx.id}` : '')}
              </div>
            </div>
          </div>
          <h1>Master registrieren</h1>
          <p className="lede">
            Backup-Passwort setzen und optional Discord-ID verknüpfen.
          </p>
          {err && <div className="err">{err}</div>}
          <label className="field">
            <span>Discord ID (optional)</span>
            <input
              inputMode="numeric"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, '').slice(0, 20))}
              placeholder="z. B. 123456789012345678"
            />
          </label>
          <label className="field">
            <span>Backup-Passwort (6–128 Zeichen)</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mind. 6 Zeichen" />
          </label>
          <label className="field">
            <span>Passwort bestätigen</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <label className="orb-tos">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>
              Ich akzeptiere die{' '}
              <a href="https://fivem.net/terms" target="_blank" rel="noreferrer">Cfx.re Nutzungsbedingungen</a>
              {' '}und nutze Orbit nur für eigene Server.
            </span>
          </label>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Lege an…' : 'Registrieren'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="orb-boot">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <form className="orb-boot-card" onSubmit={linkAccount}>
        <div className="brand-link"><Mark /> Orbit</div>
        <p className="orb-boot-status">Ersteinrichtung</p>
        <h1>PIN &amp; Cfx.re</h1>
        <p className="lede">
          PIN eingeben und mit Cfx.re verknüpfen.
        </p>
        {err && <div className="err">{err}</div>}
        <label className="field">
          <span>PIN</span>
          <div className="orb-pin-row">
            <input
              className="orb-pin mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="····"
            />
            {pinOk && <span className="orb-pin-ok" aria-hidden="true">✓</span>}
          </div>
        </label>
        <button className="btn btn-primary" disabled={busy || !pinOk} type="submit">
          {busy ? 'Weiter zu Cfx.re…' : 'Konto verknüpfen'}
        </button>
      </form>
    </div>
  );
}

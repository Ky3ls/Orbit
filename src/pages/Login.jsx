import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Mark } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

export default function Login({ onUser }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState(params.get('totp') === '1');
  const masterOk = params.get('master') === '1';
  const hintKey = {
    unknown: 'login.hint.unknown',
    error: 'login.hint.error',
    rate: 'login.hint.rate',
    locked: 'login.hint.locked',
  }[params.get('cfx')];
  const [err, setErr] = useState(hintKey ? t(hintKey) : '');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (!totp) {
        const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
        if (data.totpRequired) setTotp(true);
        else onUser(data);
      } else {
        const data = await api('/api/auth/totp', { method: 'POST', body: { code } });
        onUser(data);
      }
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen login-page">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <form className="login-card login-box login-page-card" onSubmit={submit}>
        <div className="brand-link"><Mark /> Orbit</div>
        <h2>{totp ? t('login.totpTitle') : t('login.title')}</h2>
        <p className="sub">
          {totp
            ? t('login.subTotp')
            : masterOk
              ? t('login.subMaster')
              : t('login.sub')}
        </p>
        {masterOk && !err && (
          <div className="ok" style={{ marginBottom: 12, fontSize: 13 }}>
            {t('login.masterOk')}
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {!totp && <a className="btn cfx" href="/api/auth/cfx/start?mode=login">{t('login.cfx')}</a>}
        {!totp && <div className="or">{t('login.orPassword')}</div>}
        {!totp ? (
          <>
            <label className="field"><span>{t('login.user')}</span><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label className="field"><span>{t('login.password')}</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </>
        ) : (
          <label className="field"><span>{t('login.code')}</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        )}
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? t('login.checking') : totp ? t('login.confirm') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}

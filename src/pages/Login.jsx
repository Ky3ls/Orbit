import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Mark } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './login.css';

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
    <div className="auth">
      <aside className="auth-hero" aria-hidden="true">
        <div className="auth-hero-bg" />
        <div className="auth-brand"><Mark /><b>Orbit</b></div>
        <div className="auth-visual">
          <div className="auth-planet" />
          <i className="auth-ring r1"><b /></i>
          <i className="auth-ring r2"><b /></i>
          <i className="auth-ring r3"><b /></i>
        </div>
        <div className="auth-copy">
          <h1>{t('login2.headline')}</h1>
          <p>{t('login2.lead')}</p>
          <ul>
            <li><NavIcon name="activity" />{t('login2.f1')}</li>
            <li><NavIcon name="users" />{t('login2.f2')}</li>
            <li><NavIcon name="command" />{t('login2.f3')}</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-brand"><Mark /><b>Orbit</b></div>
          <h2>{totp ? t('login.totpTitle') : t('login.title')}</h2>
          <p className="sub">
            {totp ? t('login.subTotp') : masterOk ? t('login.subMaster') : t('login.sub')}
          </p>
          {masterOk && !err && <div className="ok">{t('login.masterOk')}</div>}
          {err && <div className="err">{err}</div>}
          {!totp && (
            <a className="btn cfx" href="/api/auth/cfx/start?mode=login">
              <NavIcon name="bolt" />{t('login.cfx')}
            </a>
          )}
          {!totp && <div className="auth-or"><span>{t('login.orPassword')}</span></div>}
          {!totp ? (
            <>
              <label className="field"><span>{t('login.user')}</span><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
              <label className="field"><span>{t('login.password')}</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            </>
          ) : (
            <label className="field"><span>{t('login.code')}</span><input className="auth-otp mono" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          )}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">
            {busy ? <span className="auth-spin" /> : null}
            {busy ? t('login.checking') : totp ? t('login.confirm') : t('login.submit')}
          </button>
          <p className="auth-foot"><NavIcon name="audit" />{t('login2.secure')}</p>
        </form>
      </main>
    </div>
  );
}

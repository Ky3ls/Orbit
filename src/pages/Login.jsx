import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import GameMark from '../components/GameMark.jsx';
import { Brand, Mark } from '../components/Ui.jsx';
import { GAME_ORDER } from '../games.js';
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
        <Brand size={36} sub="Game Server Panel" className="auth-brand" />
        <div className="auth-visual">
          <i className="auth-glow" />
          <div className="auth-orbit o1">
            {GAME_ORDER.slice(0, 2).map((g, i) => (
              <span key={g} className="auth-sat" style={{ '--a': `${i * 180 + 20}deg` }}><span className="auth-sat-in"><GameMark game={g} size={44} /></span></span>
            ))}
          </div>
          <div className="auth-orbit o2">
            {GAME_ORDER.slice(2).map((g, i) => (
              <span key={g} className="auth-sat" style={{ '--a': `${i * 180 + 110}deg` }}><span className="auth-sat-in"><GameMark game={g} size={38} /></span></span>
            ))}
          </div>
          <div className="auth-core"><Mark size={104} /></div>
        </div>
        <div className="auth-copy">
          <h1>{t('login2.headline')}</h1>
          <p>{t('login2.lead')}</p>
          <ul>
            <li><NavIcon name="activity" />{t('login2.f1')}</li>
            <li><NavIcon name="users" />{t('login2.f2')}</li>
            <li><NavIcon name="archive" />{t('login2.f3')}</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-brand"><Brand size={40} sub="Game Server Panel" /></div>
          <h2>{totp ? t('login.totpTitle') : t('login.title')}</h2>
          <p className="sub">
            {totp ? t('login.subTotp') : masterOk ? t('login.subMaster') : t('login.sub')}
          </p>
          {masterOk && !err && <div className="ok">{t('login.masterOk')}</div>}
          {err && <div className="err">{err}</div>}
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
          {!totp && (
            <>
              <div className="auth-or"><span>oder</span></div>
              <a className="btn btn-block auth-cfx" href="/api/auth/cfx/start?mode=login">
                <GameMark game="fivem" size={20} />{t('login.cfx')}
              </a>
            </>
          )}
          <p className="auth-foot"><NavIcon name="audit" />{t('login2.secure')}</p>
        </form>
      </main>
    </div>
  );
}

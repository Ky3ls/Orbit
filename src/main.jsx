import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { initAppearance } from './appearance.js';
import { I18nProvider } from './i18n/I18nProvider.jsx';
import { applyDocumentLang, readStoredLang } from './i18n/core.js';
import App from './App.jsx';
import './theme/tokens.css';
import './theme/base.css';
import './theme/components.css';

if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  // Domain → HTTPS; IP:Port bleibt auf http.
  if (protocol === 'http:' && !isLocal && !isIpv4) {
    window.location.replace(window.location.href.replace(/^http:/i, 'https:'));
  }
}
import './pages/settings.css';
import './pages/cfg-editor.css';
import './styles-live-console.css';

initAppearance();
applyDocumentLang(readStoredLang() || 'de');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);

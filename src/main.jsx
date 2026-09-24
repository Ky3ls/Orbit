import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/outfit';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { initAppearance } from './appearance.js';
import App from './App.jsx';
import './styles.css';

if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  // Domain → HTTPS; IP:Port bleibt auf http.
  if (protocol === 'http:' && !isLocal && !isIpv4) {
    window.location.replace(window.location.href.replace(/^http:/i, 'https:'));
  }
}
import './theme/tokens.css';
import './workspace/workspace.css';
import './workspace/appearance.css';
import './cockpit/cockpit.css';
import './pages/settings.css';
import './pages/cfg-editor.css';
import './styles-live-console.css';
import './styles-responsive.css';

initAppearance();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

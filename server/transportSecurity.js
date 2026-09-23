import { ORIGIN } from './config.js';

/** API nur über TLS, wenn öffentliche URL https ist (abschaltbar: ORBIT_TLS_RELAX=1). */
export const REQUIRE_TLS = process.env.ORBIT_TLS_RELAX !== '1'
  && (process.env.ORBIT_REQUIRE_TLS === '1' || String(ORIGIN).startsWith('https://'));

function forwardedProto(req) {
  const raw = req.headers['x-forwarded-proto'];
  if (typeof raw !== 'string') return '';
  return raw.split(',')[0].trim().toLowerCase();
}

/**
 * Anfrage gilt als verschlüsselt: TLS-Termination am Proxy oder direktes TLS-Socket.
 */
export function requestIsSecure(req) {
  if (req.socket?.encrypted) return true;
  const proto = forwardedProto(req);
  if (proto === 'https') return true;
  if (proto === 'http') return false;
  const remote = req.socket?.remoteAddress || '';
  const localClient = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  // Direktzugriff nur auf 127.0.0.1 (Node hinter Reverse-Proxy) — kein TLS auf dem Socket nötig.
  if (localClient && !proto) return true;
  return !REQUIRE_TLS;
}

export function tlsRequiredResponse() {
  return {
    status: 403,
    body: {
      error: 'API nur über HTTPS (TLS). Bitte das Panel per https:// öffnen; Proxy muss X-Forwarded-Proto: https setzen.',
      code: 'tls_required',
    },
  };
}

export function extraSecurityHeaders(secure) {
  const h = {
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (secure && String(ORIGIN).startsWith('https://')) {
    h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
    h['Content-Security-Policy'] = "upgrade-insecure-requests; default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'";
  }
  return h;
}

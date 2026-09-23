# Verschlüsselte APIs (TLS)

Orbit erwartet **HTTPS** für alle Browser- und externen API-Zugriffe.

## Was das Panel macht

- Cookies: `Secure`, `HttpOnly`, `__Host-` (nur über HTTPS im Browser)
- API: ohne TLS am Proxy → `403` (`code: tls_required`)
- Antwort-Header: **HSTS**, **CSP** `upgrade-insecure-requests`
- Frontend: Redirect von `http://` auf `https://` (außer localhost)

## Reverse-Proxy (nginx)

```nginx
location / {
  proxy_pass http://127.0.0.1:40220;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Einrichtung (Wizard)

Im Setup-Schritt **Panel-Zugang**:

- **IP & Port** — `ORBIT_BIND_HOST=0.0.0.0`, öffentliche URL `http://<IP>:40220` (txAdmin-ähnlich)
- **Domain** — Reverse-Proxy (nginx/Apache/Caddy, automatische Erkennung), URL `https://<domain>`, Node bleibt auf `127.0.0.1`

Erfordert `sudo` für User `tx2` (systemd drop-in + Webserver-Reload).

## Umgebungsvariablen

| Variable | Bedeutung |
|----------|-----------|
| `ORBIT_PUBLIC_URL` | Öffentliche Panel-URL (`https://…` oder `http://IP:Port`) |
| `ORBIT_BIND_HOST` | `127.0.0.1` (Domain) oder `0.0.0.0` (IP:Port) |
| `ORBIT_PANEL_PORT` | Panel-Port (Standard `40220`) |
| `ORBIT_REQUIRE_TLS=1` | TLS erzwingen (Standard wenn URL https) |
| `ORBIT_TLS_RELAX=1` | TLS-Check aus (IP:Port-Zugang) |

Der Node-Prozess lauscht nur auf **127.0.0.1**; TLS terminiert am Proxy.

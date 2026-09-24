/** Sendet orbitEvent an FX (Base64-JSON, sicher für Konsole). */
export function orbitEventCommand(eventName, payload = {}) {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return `orbitEvent ${eventName} ${b64}`;
}

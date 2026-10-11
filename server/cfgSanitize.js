/**
 * Entfernt / ersetzt veraltete Orbit-Meta-Kommentare in server.cfg.
 * Funktionale Zeilen (ensure/set/add_ace/…) bleiben unberührt.
 */
export function sanitizeCfgMetaComments(text) {
  let out = String(text || '');

  // Meta-Header / Admin-Hinweis komplett weg
  out = out.replace(/^\s*#\s*Orbit Game Server\b.*$/gim, '');
  out = out.replace(/^\s*##?\s*Orbit Admin-Men[uü].*$/gim, '');
  out = out.replace(/^\s*#\s*Orbit\s*$/gim, '');

  // Entfernt: Warning „sv_endpointPrivacy has been removed“
  out = out.replace(/^\s*#{0,3}\s*Endpoints?\s*Privacy\s*#{0,3}\s*$/gim, '');
  out = out.replace(/^\s*(?:set\s+)?sv_endpointPrivacy\b.*$/gim, '');

  // onesync ist internes ConVar — nur Kommentar behalten (Wert via FX-Launch +set)
  out = out.replace(
    /^\s*##\s*\[txAdmin CFG validator\]:\s*onesync\s+(\w+)\s*$/gim,
    '# OneSync: $1',
  );
  out = out.replace(/^\s*(?:##\s*)?set\s+onesync\s+(on|off|legacy)\s*$/gim, '# OneSync: $1');
  out = out.replace(/^\s*#\s*set\s+onesync\s+(on|off|legacy)\s*$/gim, '# OneSync: $1');

  // OneSync-Hinweis vereinheitlichen (Wert behalten)
  out = out.replace(
    /^\s*##\s*\[Orbit\]:\s*onesync\s+(\w+)\b.*$/gim,
    '# OneSync: $1',
  );
  out = out.replace(
    /^\s*##\s*\[Orbit\]:\s*onesync\b.*$/gim,
    '# OneSync: on',
  );

  // CFX-Defaults → kurzer Abschnittstitel, ohne „Ende“-Marker
  out = out.replace(/^\s*#\s*---\s*Orbit CFX Defaults\s*---\s*$/gim, '# Basis-Ressourcen');
  out = out.replace(/^\s*#\s*---\s*Ende CFX Defaults\s*---\s*$/gim, '');

  // Profil-Blöcke → „# ESX Legacy“ / „# QBCore“
  out = out.replace(/^\s*#\s*---\s*Orbit Profil:\s*(.+?)\s*---\s*$/gim, '# $1');
  out = out.replace(/^\s*#\s*---\s*Ende Orbit Profil\s*---\s*$/gim, '');

  // Lizenz-Hinweis
  out = out.replace(
    /^\s*#\s*Lizenz\s*\+\s*MySQL setzt Orbit-Setup.*$/gim,
    '# Lizenz und MySQL:',
  );

  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

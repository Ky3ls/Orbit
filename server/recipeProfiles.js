/** Profil + server.cfg-Vorlagen (txAdmin-Recipe-Ersatz: Setup statt YAML-Runner). */

export const RECIPE_PACKS = {
  blank: {
    title: 'Minimal',
    profile: 'blank',
    ensures: ['oxmysql', 'sessionmanager', 'hardcap', 'chat'],
    zips: [{ name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' }],
    clones: [],
    cfgBlock: '',
  },
  esx: {
    title: 'ESX Legacy (Profil)',
    profile: 'esx',
    ensures: ['oxmysql', 'es_extended', 'ox_lib', 'esx_identity', 'esx_multicharacter', 'hardcap', 'chat'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
      { name: 'ox_lib', url: 'https://github.com/overextended/ox_lib/releases/latest/download/ox_lib.zip', dest: '[standalone]/ox_lib' },
    ],
    clones: [
      { url: 'https://github.com/esx-framework/esx_core.git', dest: '[core]/esx_core', depth: 1 },
    ],
    cfgBlock: `
# --- Orbit Profil: ESX Legacy ---
setr esx:locale "de"
setr inventory:framework "esx"
{{MYSQL_LINE}}
ensure oxmysql
ensure es_extended
ensure ox_lib
ensure esx_identity
ensure esx_multicharacter
`,
  },
  qb: {
    title: 'QBCore (Profil)',
    profile: 'qb',
    ensures: ['oxmysql', 'qb-core', 'qb-multicharacter', 'hardcap', 'chat'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
    ],
    clones: [
      { url: 'https://github.com/qbcore-framework/qb-core.git', dest: '[qb]/qb-core', depth: 1 },
    ],
    cfgBlock: `
# --- Orbit Profil: QBCore ---
setr qb_locale "de"
{{MYSQL_LINE}}
ensure oxmysql
ensure qb-core
`,
  },
};

export function renderProfileCfgBlock(pack, { mysqlConnection = '' } = {}) {
  const mysql = String(mysqlConnection || '').trim();
  const mysqlLine = mysql
    ? `set mysql_connection_string "${mysql.replace(/"/g, '')}"`
    : '# set mysql_connection_string "mysql://user:pass@127.0.0.1/orbit?charset=utf8mb4"';
  const block = String(pack.cfgBlock || '').replace('{{MYSQL_LINE}}', mysqlLine);
  return block.trim();
}

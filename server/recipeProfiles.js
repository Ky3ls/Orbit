/** Profil + server.cfg-Vorlagen (txAdmin-Recipe-Ersatz: Setup statt YAML-Runner). */

export const RECIPE_PACKS = {
  blank: {
    title: 'Minimal',
    profile: 'blank',
    ensures: ['oxmysql'],
    zips: [{ name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' }],
    clones: [],
    cfgBlock: '',
  },
  esx: {
    title: 'ESX Legacy (Profil)',
    profile: 'esx',
    // FiveM startet Ressourcen in [core]/ und [esx_addons]/ per Ordner-ensure
    // sessionmanager/hardcap/chat = Citizen-Systemressourcen (nicht unter resources/)
    ensures: ['oxmysql', 'ox_lib', '[core]', '[esx_addons]'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
      { name: 'ox_lib', url: 'https://github.com/overextended/ox_lib/releases/latest/download/ox_lib.zip', dest: '[standalone]/ox_lib' },
    ],
    clones: [
      {
        url: 'https://github.com/esx-framework/esx_core.git',
        dest: '[core]',
        promote: '[core]',
        depth: 1,
      },
      {
        url: 'https://github.com/esx-framework/ESX-Legacy-Addons.git',
        dest: '[esx_addons]',
        promote: '[esx_addons]',
        depth: 1,
      },
    ],
    cfgBlock: `
# --- Orbit Profil: ESX Legacy ---
setr esx:locale "de"
setr inventory:framework "esx"
`,
  },
  qb: {
    title: 'QBCore (Profil)',
    profile: 'qb',
    ensures: ['oxmysql', 'qb-core', 'qb-multicharacter'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
    ],
    clones: [
      { url: 'https://github.com/qbcore-framework/qb-core.git', dest: '[qb]/qb-core', depth: 1 },
    ],
    cfgBlock: `
# --- Orbit Profil: QBCore ---
setr qb_locale "de"
`,
  },
};

export function renderProfileCfgBlock(pack) {
  return String(pack.cfgBlock || '').trim();
}

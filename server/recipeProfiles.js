/** Profil + server.cfg-Vorlagen (txAdmin-Recipe-Ersatz: Setup statt YAML-Runner). */

const PMA_VOICE_ZIP = {
  name: 'pma-voice',
  url: 'https://github.com/AvarianKnight/pma-voice/releases/latest/download/pma-voice.zip',
  dest: '[standalone]/pma-voice',
};

export const RECIPE_PACKS = {
  blank: {
    title: 'Minimal',
    profile: 'blank',
    ensures: ['oxmysql', 'pma-voice'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
      { ...PMA_VOICE_ZIP },
    ],
    clones: [],
    cfgBlock: '',
  },
  esx: {
    title: 'ESX Legacy (Profil)',
    profile: 'esx',
    // FiveM startet Ressourcen in [core]/ und [esx_addons]/ per Ordner-ensure
    // CFX-Defaults (mapmanager/chat/…) via cfxDefaults.js
    ensures: ['oxmysql', 'ox_lib', 'pma-voice', '[core]', '[esx_addons]'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
      { name: 'ox_lib', url: 'https://github.com/overextended/ox_lib/releases/latest/download/ox_lib.zip', dest: '[standalone]/ox_lib' },
      { ...PMA_VOICE_ZIP },
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
# ESX Legacy
setr esx:locale "de"
setr inventory:framework "esx"
setr sv_stateBagStrictMode true
`,
  },
  qb: {
    title: 'QBCore (Profil)',
    profile: 'qb',
    ensures: ['oxmysql', 'pma-voice', 'qb-core', 'qb-multicharacter'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
      { ...PMA_VOICE_ZIP },
    ],
    clones: [
      { url: 'https://github.com/qbcore-framework/qb-core.git', dest: '[qb]/qb-core', depth: 1 },
    ],
    cfgBlock: `
# QBCore
setr qb_locale "de"
setr sv_stateBagStrictMode true
`,
  },
};

export function renderProfileCfgBlock(pack) {
  return String(pack.cfgBlock || '').trim();
}

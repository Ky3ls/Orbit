/** Profil + server.cfg-Vorlagen (txAdmin-Recipe-Ersatz: Setup statt YAML-Runner). */

/** pma-voice: GitHub Releases hat kein Asset-ZIP — Clone statt Download. */
const PMA_VOICE_CLONE = {
  url: 'https://github.com/AvarianKnight/pma-voice.git',
  dest: '[standalone]/pma-voice',
  depth: 1,
};

export const RECIPE_PACKS = {
  blank: {
    title: 'Minimal',
    profile: 'blank',
    ensures: ['oxmysql', 'pma-voice'],
    zips: [
      { name: 'oxmysql', url: 'https://github.com/overextended/oxmysql/releases/latest/download/oxmysql.zip', dest: '[standalone]/oxmysql' },
    ],
    clones: [{ ...PMA_VOICE_CLONE }],
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
      { ...PMA_VOICE_CLONE },
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
    ],
    clones: [
      { url: 'https://github.com/qbcore-framework/qb-core.git', dest: '[qb]/qb-core', depth: 1 },
      { ...PMA_VOICE_CLONE },
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

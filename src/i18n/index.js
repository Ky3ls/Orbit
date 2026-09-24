export {
  STORAGE_KEY,
  SUPPORTED,
  normalizeLang,
  toBcp47,
  toSettingsValue,
  getLang,
  readStoredLang,
  writeStoredLang,
  translate,
  applyDocumentLang,
} from './core.js';
export { CATALOG, LANGUAGE_OPTIONS } from './catalog.js';
export { I18nProvider, useI18n } from './I18nProvider.jsx';

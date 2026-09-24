import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { CATALOG } from './catalog.js';
import {
  applyDocumentLang,
  normalizeLang,
  readStoredLang,
  toBcp47,
  toSettingsValue,
  translate,
  writeStoredLang,
} from './core.js';

const I18nContext = createContext(null);

function initialLang() {
  return readStoredLang() || 'de';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const setLanguage = useCallback((raw) => {
    const next = writeStoredLang(raw);
    applyDocumentLang(next);
    setLangState(next);
    try {
      window.dispatchEvent(new CustomEvent('orbit:language', { detail: next }));
    } catch { /* */ }
    return next;
  }, []);

  useEffect(() => {
    const onSet = (e) => {
      if (e?.detail) setLanguage(e.detail);
    };
    window.addEventListener('orbit:set-language', onSet);
    return () => window.removeEventListener('orbit:set-language', onSet);
  }, [setLanguage]);

  /** Settings aus API übernehmen (nach Login / Save). */
  const syncFromSettings = useCallback((settings) => {
    const raw = settings?.language || settings?.locale;
    if (!raw) return lang;
    return setLanguage(raw);
  }, [lang, setLanguage]);

  useEffect(() => {
    let cancelled = false;
    api('/api/settings')
      .then((d) => {
        if (cancelled || !d?.settings) return;
        const raw = d.settings.language || d.settings.locale;
        if (raw) {
          const next = writeStoredLang(raw);
          applyDocumentLang(next);
          setLangState(next);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const t = useCallback((key, vars) => translate(CATALOG, lang, key, vars), [lang]);

  const value = useMemo(() => ({
    lang,
    locale: toBcp47(lang),
    settingsValue: toSettingsValue(lang),
    t,
    setLanguage,
    syncFromSettings,
    normalizeLang,
  }), [lang, t, setLanguage, syncFromSettings]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: 'de',
      locale: 'de-DE',
      settingsValue: 'de-DE',
      t: (key, vars) => translate(CATALOG, 'de', key, vars),
      setLanguage: () => 'de',
      syncFromSettings: () => 'de',
      normalizeLang,
    };
  }
  return ctx;
}

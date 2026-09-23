import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  applyAppearance,
  getAppearanceUserId,
  persistAppearance,
  readAppearance,
  writeAppearance,
} from '../appearance.js';

export function useAppearance() {
  const [prefs, setPrefs] = useState(() => readAppearance(getAppearanceUserId()));

  useEffect(() => {
    applyAppearance(prefs);
    const onStorage = (e) => {
      if (e.key === 'orbit.appearance' || (e.key && e.key.startsWith('orbit.appearance.'))) {
        setPrefs(readAppearance(getAppearanceUserId()));
      }
    };
    const onCustom = (e) => setPrefs(e.detail || readAppearance(getAppearanceUserId()));
    window.addEventListener('storage', onStorage);
    window.addEventListener('orbit:appearance', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('orbit:appearance', onCustom);
    };
  }, []);

  const setAppearance = useCallback((partial) => {
    const uid = getAppearanceUserId();
    void persistAppearance(partial, api, uid).then((next) => setPrefs(next));
  }, []);

  return [prefs, setAppearance];
}

/** Sofort lokal anwenden ohne API (z. B. Bootstrap-Hydrate). */
export function applyPrefsLocal(prefs, userId) {
  return writeAppearance(prefs, userId);
}

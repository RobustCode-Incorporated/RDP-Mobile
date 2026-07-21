import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { defaultLocale, getStrings, type Locale, type Strings } from './strings';

const LOCALE_STORAGE_KEY = 'driver-mobile.locale';

interface I18nContextValue {
  locale: Locale;
  strings: Strings;
  setLocale: (nextLocale: Locale) => void;
}

const i18nContextDefaultValue: I18nContextValue = {
  locale: defaultLocale,
  strings: getStrings(defaultLocale),
  setLocale: () => {},
};

const I18nContext = createContext<I18nContextValue>(i18nContextDefaultValue);

function getDeviceLocale(): Locale {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  return locale.startsWith('en') ? 'en' : 'fr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const restoreLocale = async () => {
      const storedLocale = await SecureStore.getItemAsync(LOCALE_STORAGE_KEY);

      if (storedLocale === 'fr' || storedLocale === 'en') {
        setLocaleState(storedLocale);
        return;
      }

      setLocaleState(getDeviceLocale());
    };

    void restoreLocale();
  }, []);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    void SecureStore.setItemAsync(LOCALE_STORAGE_KEY, nextLocale);
  };

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    strings: getStrings(locale),
    setLocale,
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

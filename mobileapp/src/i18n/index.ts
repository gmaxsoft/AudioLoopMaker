import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en.json';
import pl from './pl.json';
import { ASYNC_LOCALE_KEY } from '../constants';

const deviceLang = Localization.getLocales()?.[0]?.languageCode;
const fallbackLng = 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pl: { translation: pl },
  },
  lng: fallbackLng,
  fallbackLng,
  interpolation: { escapeValue: false },
});

/** Load saved locale, else keep English as app default (not device). */
export async function loadSavedLocale(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(ASYNC_LOCALE_KEY);
    if (saved === 'en' || saved === 'pl') {
      await i18n.changeLanguage(saved);
      return saved;
    }
  } catch {
    /* ignore */
  }
  await i18n.changeLanguage(fallbackLng);
  return fallbackLng;
}

export async function setAppLocale(lng: 'en' | 'pl'): Promise<void> {
  await i18n.changeLanguage(lng);
  await AsyncStorage.setItem(ASYNC_LOCALE_KEY, lng);
}

export { deviceLang };
export default i18n;

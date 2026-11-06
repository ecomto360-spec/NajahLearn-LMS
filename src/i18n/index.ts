/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import i18n from 'i18next';
import type { TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import { normalizeLanguage } from './format.js';
import type { SupportedLanguage } from '../types/index.js';

const GUEST_LANG_STORAGE_KEY = 'nl_lang_guest';
const USER_LANG_STORAGE_PREFIX = 'nl_lang_user_';

export function getStoredGuestLanguage(): SupportedLanguage {
  try {
    if (typeof window === 'undefined') return 'fr';
    const raw = window.localStorage.getItem(GUEST_LANG_STORAGE_KEY);
    if (raw === 'ar' || raw === 'fr') return raw;
  } catch {
    // Ignore storage errors in restricted environments
  }
  return 'fr';
}

export function setStoredGuestLanguage(lang: SupportedLanguage): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(GUEST_LANG_STORAGE_KEY, lang);
    }
  } catch {
    // Ignore
  }
}

export function getStoredUserLanguage(userId?: string | null): SupportedLanguage | null {
  if (!userId) return null;
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(`${USER_LANG_STORAGE_PREFIX}${userId}`);
    if (raw === 'ar' || raw === 'fr') return raw;
  } catch {
    // Ignore
  }
  return null;
}

export function setStoredUserLanguage(userId: string, lang: SupportedLanguage): void {
  if (!userId) return;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${USER_LANG_STORAGE_PREFIX}${userId}`, lang);
    }
  } catch {
    // Ignore
  }
}

export function syncDocumentDirectionAndLang(langInput?: string | null): SupportedLanguage {
  const lang = normalizeLanguage(langInput);
  if (typeof document !== 'undefined') {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const title = i18n.isInitialized ? i18n.t('meta.documentTitle', { lng: lang }) : '';
    if (title && title !== 'meta.documentTitle') {
      document.title = title;
    }
  }
  return lang;
}

export function translatePaymentMethod(t: TFunction, method?: string | null): string {
  if (!method) return '—';
  const key = `paymentMethods.${method}`;
  const translated = t(key);
  return translated === key ? method : translated;
}

export function translateStatus(t: TFunction, status?: string | null): string {
  if (!status) return '—';
  const key = `statuses.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

const initialLanguage = getStoredGuestLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: initialLanguage,
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'ar'],
  interpolation: {
    escapeValue: false,
  },
});

syncDocumentDirectionAndLang(initialLanguage);

i18n.on('languageChanged', (lng) => {
  syncDocumentDirectionAndLang(lng);
});

export default i18n;

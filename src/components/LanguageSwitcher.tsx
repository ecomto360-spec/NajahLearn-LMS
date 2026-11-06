/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import type { SupportedLanguage } from '../types/index.js';

interface LanguageSwitcherProps {
  variant?: 'dark' | 'light';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'dark' }) => {
  const { t } = useTranslation();
  const { language, setLanguage } = useAuth();

  const handleSelect = (next: SupportedLanguage) => {
    if (next !== language) {
      void setLanguage(next);
    }
  };

  const containerClasses =
    variant === 'dark'
      ? 'inline-flex items-center gap-1 p-1 rounded-lg bg-white/10 border border-white/15 text-white shrink-0'
      : 'inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 shrink-0';

  const getBtnClasses = (active: boolean) => {
    if (variant === 'dark') {
      return active
        ? 'px-2.5 py-1 text-xs font-bold rounded-md bg-white text-slate-900 shadow-2xs transition-colors cursor-pointer whitespace-nowrap'
        : 'px-2.5 py-1 text-xs font-medium rounded-md text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap';
    }
    return active
      ? 'px-2.5 py-1 text-xs font-bold rounded-md bg-white text-slate-900 shadow-2xs transition-colors cursor-pointer whitespace-nowrap'
      : 'px-2.5 py-1 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-white/60 transition-colors cursor-pointer whitespace-nowrap';
  };

  return (
    <div
      role="group"
      aria-label={t('meta.languageLabel')}
      className={containerClasses}
    >
      <Globe className="w-3.5 h-3.5 ms-1.5 opacity-80 shrink-0" aria-hidden="true" />
      <button
        type="button"
        onClick={() => handleSelect('fr')}
        aria-pressed={language === 'fr'}
        title={t('meta.switchToFrench')}
        className={getBtnClasses(language === 'fr')}
      >
        {t('meta.frShort')}
      </button>
      <button
        type="button"
        onClick={() => handleSelect('ar')}
        aria-pressed={language === 'ar'}
        title={t('meta.switchToArabic')}
        className={getBtnClasses(language === 'ar')}
      >
        {t('meta.arShort')}
      </button>
    </div>
  );
};

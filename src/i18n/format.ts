/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupportedLanguage } from '../types/index.js';

const EASTERN_ARABIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

/**
 * Guarantees Western Arabic / Latin numerals (0-9) even if an older ICU runtime
 * ignores the `-u-nu-latn` Unicode extension.
 */
export function ensureWesternDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[٠-٩۰-۹]/g, (ch) => EASTERN_ARABIC_DIGITS[ch] ?? ch);
}

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) return 'fr';
  return lang.toLowerCase().startsWith('ar') ? 'ar' : 'fr';
}

export function getLocaleTag(lang?: string | null): string {
  return normalizeLanguage(lang) === 'ar' ? 'ar-DZ-u-nu-latn' : 'fr-DZ';
}

export function formatNumber(
  value: number | null | undefined,
  lang?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  const safeVal = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    const formatted = new Intl.NumberFormat(getLocaleTag(lang), {
      numberingSystem: 'latn',
      ...options,
    } as Intl.NumberFormatOptions).format(safeVal);
    return ensureWesternDigits(formatted);
  } catch {
    return ensureWesternDigits(safeVal.toLocaleString('fr-FR', options));
  }
}

export function formatDzd(
  amount: number | null | undefined,
  lang?: string | null,
  withCurrency = true
): string {
  const num = formatNumber(amount, lang, { maximumFractionDigits: 0 });
  return withCurrency ? `${num} DZD` : num;
}

export function formatPercent(value: number | null | undefined, lang?: string | null): string {
  const num = formatNumber(value, lang, { maximumFractionDigits: 1 });
  return `${num}%`;
}

export function formatDate(
  dateInput: string | Date | null | undefined,
  lang?: string | null,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }
): string {
  if (!dateInput) return '—';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return ensureWesternDigits(String(dateInput));
  try {
    const formatted = new Intl.DateTimeFormat(getLocaleTag(lang), {
      numberingSystem: 'latn',
      ...options,
    } as Intl.DateTimeFormatOptions).format(d);
    return ensureWesternDigits(formatted);
  } catch {
    return ensureWesternDigits(d.toISOString().split('T')[0]);
  }
}

export function formatDateTime(
  dateInput: string | Date | null | undefined,
  lang?: string | null
): string {
  return formatDate(dateInput, lang, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(
  dateInput: string | Date | null | undefined,
  lang?: string | null
): string {
  if (!dateInput) return '—';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return ensureWesternDigits(String(dateInput));
  try {
    const formatted = new Intl.DateTimeFormat(getLocaleTag(lang), {
      numberingSystem: 'latn',
      hour: '2-digit',
      minute: '2-digit',
    } as Intl.DateTimeFormatOptions).format(d);
    return ensureWesternDigits(formatted);
  } catch {
    return ensureWesternDigits(d.toTimeString().slice(0, 5));
  }
}

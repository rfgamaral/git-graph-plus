import { t } from '../i18n/index.svelte';

/**
 * Format a date string using a small token-based pattern.
 *
 * Tokens (longer tokens are matched first so `YYYY` wins over `YY`):
 *   YYYY  full year        MM  month 01-12     DD  day 01-31
 *   HH    hour 24h 00-23   hh  hour 12h 01-12  mm  minute 00-59
 *   ss    second 00-59     A   AM/PM
 *   MMM   abbreviated month (Jan-Dec)       D   day without leading zero
 *   R     today/yesterday as a localized word, or the configured fallback
 * Any other characters pass through verbatim, so "DD.MM.YYYY HH:mm" works.
 */
const TOKENS: Record<string, (d: Date) => string> = {
  YYYY: d => String(d.getFullYear()),
  YY: d => String(d.getFullYear()).slice(-2),
  MMM: d => d.toLocaleString('en-US', { month: 'short' }),
  MM: d => String(d.getMonth() + 1).padStart(2, '0'),
  DD: d => String(d.getDate()).padStart(2, '0'),
  D: d => String(d.getDate()),
  HH: d => String(d.getHours()).padStart(2, '0'),
  hh: d => String((d.getHours() % 12) || 12).padStart(2, '0'),
  mm: d => String(d.getMinutes()).padStart(2, '0'),
  ss: d => String(d.getSeconds()).padStart(2, '0'),
  A: d => d.getHours() < 12 ? 'AM' : 'PM',
};

function formatPattern(d: Date, pattern: string, relativeDate = 'R'): string {
  return pattern.replace(/YYYY|YY|MMM|MM|DD|D|HH|hh|mm|ss|A|R/g,
    token => token === 'R' ? relativeDate : TOKENS[token](d));
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `R` token: localized "today"/"yesterday", or null for other dates. */
function relativeDayOrDate(d: Date): string | null {
  const now = new Date();
  if (isSameDay(d, now)) return t('date.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return t('date.yesterday');
  return null;
}

export function formatDateTime(dateStr: string, pattern: string, relativeDateFallbackFormat = 'DD.MM.YYYY'): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const fallback = relativeDateFallbackFormat.trim() && !relativeDateFallbackFormat.includes('R')
    ? relativeDateFallbackFormat : 'DD.MM.YYYY';
  return formatPattern(d, pattern, relativeDayOrDate(d) ?? formatPattern(d, fallback));
}

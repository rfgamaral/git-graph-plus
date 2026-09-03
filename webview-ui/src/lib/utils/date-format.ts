import { t } from '../i18n/index.svelte';

/**
 * Format a date string using a small token-based pattern.
 *
 * Tokens (longer tokens are matched first so `YYYY` wins over `YY`):
 *   YYYY  full year        MM  month 01-12     DD  day 01-31
 *   HH    hour 24h 00-23   hh  hour 12h 01-12  mm  minute 00-59
 *   ss    second 00-59     A   AM/PM
 *   R     today/yesterday as a localized word, or the numeric DD.MM.YYYY
 * Any other characters pass through verbatim, so "DD.MM.YYYY HH:mm" works.
 */
const TOKENS: Array<[RegExp, (d: Date) => string]> = [
  [/YYYY/g, (d) => String(d.getFullYear())],
  [/YY/g, (d) => String(d.getFullYear()).slice(-2)],
  [/MM/g, (d) => String(d.getMonth() + 1).padStart(2, '0')],
  [/DD/g, (d) => String(d.getDate()).padStart(2, '0')],
  [/HH/g, (d) => String(d.getHours()).padStart(2, '0')],
  [/hh/g, (d) => String((d.getHours() % 12) || 12).padStart(2, '0')],
  [/mm/g, (d) => String(d.getMinutes()).padStart(2, '0')],
  [/ss/g, (d) => String(d.getSeconds()).padStart(2, '0')],
  [/A/g, (d) => (d.getHours() < 12 ? 'AM' : 'PM')],
];

const pad = (n: number) => String(n).padStart(2, '0');

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `R` token: localized "today"/"yesterday", else the numeric DD.MM.YYYY. */
function relativeDayOrDate(d: Date): string {
  const now = new Date();
  if (isSameDay(d, now)) return t('date.today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return t('date.yesterday');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatDateTime(dateStr: string, pattern: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  let out = pattern.replace(/R/g, () => relativeDayOrDate(d));
  for (const [re, fn] of TOKENS) {
    out = out.replace(re, fn(d));
  }
  return out;
}

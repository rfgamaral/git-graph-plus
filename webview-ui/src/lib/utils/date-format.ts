/**
 * Format a date string using a small token-based pattern.
 *
 * Tokens (longer tokens are matched first so `YYYY` wins over `YY`):
 *   YYYY  full year        MM  month 01-12     DD  day 01-31
 *   HH    hour 24h 00-23   hh  hour 12h 01-12  mm  minute 00-59
 *   ss    second 00-59     A   AM/PM
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

export function formatDateTime(dateStr: string, pattern: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  let out = pattern;
  for (const [re, fn] of TOKENS) {
    out = out.replace(re, fn(d));
  }
  return out;
}

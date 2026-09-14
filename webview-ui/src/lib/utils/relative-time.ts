import { t } from '../i18n/index.svelte';

export function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return t('reflog.timeSecond', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60)  return t('reflog.timeMinute', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24)  return t('reflog.timeHour',   { n: h });
  const dy = Math.floor(h / 24);
  if (dy < 30) return t('reflog.timeDay',    { n: dy });
  const mo = Math.floor(dy / 30);
  if (mo < 12) return t('reflog.timeMonth',  { n: mo });
  return t('reflog.timeYear', { n: Math.floor(mo / 12) });
}

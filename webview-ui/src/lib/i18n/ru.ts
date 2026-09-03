// Minimal Russian dictionary: only the date/time-format words are translated
// so far. Every other key falls back to English via the per-key fallback in
// i18n.t(), so the rest of the UI stays English until a full translation lands.
export const ru: Record<string, string> = {
  'date.today': 'сегодня',
  'date.yesterday': 'вчера',
};

import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../date-format';

const ISO = '2026-09-03T14:05:09.000Z'; // local time depends on TZ; use explicit parts below
const LOCAL = new Date(2026, 8, 3, 14, 5, 9); // Sep 3 2026 14:05:09 local

describe('formatDateTime', () => {
  const d = LOCAL.toISOString();

  it('renders DD.MM.YYYY HH:mm:ss', () => {
    expect(formatDateTime(d, 'DD.MM.YYYY HH:mm:ss')).toBe('03.09.2026 14:05:09');
  });

  it('renders DD.MM.YYYY HH:mm without seconds', () => {
    expect(formatDateTime(d, 'DD.MM.YYYY HH:mm')).toBe('03.09.2026 14:05');
  });

  it('renders ISO-like YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime(d, 'YYYY-MM-DD HH:mm')).toBe('2026-09-03 14:05');
  });

  it('renders 12-hour with AM/PM', () => {
    expect(formatDateTime(d, 'YYYY-MM-DD hh:mm A')).toBe('2026-09-03 02:05 PM');
  });

  it('renders 12-hour midnight as 12 AM', () => {
    const midnight = new Date(2026, 8, 3, 0, 5, 9).toISOString();
    expect(formatDateTime(midnight, 'hh:mm A')).toBe('12:05 AM');
  });

  it('passes literal punctuation through', () => {
    expect(formatDateTime(d, 'YYYY/MM/DD [HH:mm]')).toBe('2026/09/03 [14:05]');
  });

  it('returns the input unchanged for an invalid date', () => {
    expect(formatDateTime('not-a-date', 'YYYY-MM-DD')).toBe('not-a-date');
  });
});

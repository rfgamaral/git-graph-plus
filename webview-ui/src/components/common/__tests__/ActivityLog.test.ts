import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ActivityLog from '../ActivityLog.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';

interface LogEntry {
  command: string;
  timestamp: string;
  success: boolean;
  duration: number;
}

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    command: 'git status',
    timestamp: new Date().toISOString(),
    success: true,
    duration: 50,
    ...over,
  };
}

function deliverLog(entries: LogEntry[]) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'activityLogData', payload: entries },
  }));
}

beforeEach(() => {
  i18n.setLocale('en');
  globalThis.__postedMessages = [];
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ActivityLog', () => {
  it('requests activity log on mount', () => {
    render(ActivityLog);
    expect(globalThis.__postedMessages.some(
      (m) => (m.data as { type?: string }).type === 'getActivityLog'
    )).toBe(true);
  });

  it('filters out non-user-action commands by default', async () => {
    const { container } = render(ActivityLog);
    deliverLog([
      entry({ command: 'git status' }), // hidden
      entry({ command: 'git commit -m fix' }), // shown
      entry({ command: 'git log --format=...' }), // hidden
    ]);
    await waitFor(() => {
      expect(container.querySelectorAll('.log-entry').length).toBe(1);
    });
  });

  it('View menu toggles background commands and reflects the checked state', async () => {
    const { container, getByRole } = render(ActivityLog);
    deliverLog([
      entry({ command: 'git status' }),
      entry({ command: 'git commit -m fix' }),
    ]);
    await waitFor(() => expect(container.querySelectorAll('.log-entry')).toHaveLength(1));
    await fireEvent.click(getByRole('button', { name: 'View' }));
    const showAll = getByRole('menuitemcheckbox', { name: 'Show background commands' });
    expect(showAll.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(showAll);
    expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
    await fireEvent.click(getByRole('button', { name: 'View' }));
    const checked = getByRole('menuitemcheckbox', { name: 'Show background commands' });
    expect(checked.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(checked);
    expect(container.querySelectorAll('.log-entry')).toHaveLength(1);
  });

  it('failed entries get the failed class', async () => {
    const { container } = render(ActivityLog);
    deliverLog([entry({ command: 'git push', success: false })]);
    await waitFor(() => container.querySelector('.log-entry'));
    expect(container.querySelector('.log-entry')?.classList.contains('failed')).toBe(true);
  });

  it('shows empty state when there are no entries', async () => {
    const { container } = render(ActivityLog);
    deliverLog([]);
    await waitFor(() => {
      expect(container.querySelector('.log-empty')).not.toBeNull();
    });
  });

  it('refreshes every 2s and stops after unmount', async () => {
    const { unmount } = render(ActivityLog);
    globalThis.__postedMessages = [];
    vi.advanceTimersByTime(4000);
    expect(globalThis.__postedMessages.map(m => m.data)).toEqual([
      { type: 'getActivityLog' }, { type: 'getActivityLog' },
    ]);
    await unmount();
    globalThis.__postedMessages = [];
    vi.advanceTimersByTime(4000);
    expect(globalThis.__postedMessages).toEqual([]);
  });

  it('searches only commands, ignoring case and intersecting the background filter', async () => {
    const { container, getByRole } = render(ActivityLog);
    deliverLog([
      entry({ command: 'git commit -m Needle' }),
      entry({ command: 'git log --grep=needle' }),
      entry({ command: 'git push', duration: 12345 }),
    ]);
    const input = getByRole('textbox', { name: 'Search commands…' });
    await fireEvent.input(input, { target: { value: '  NEEDLE  ' } });
    expect(Array.from(container.querySelectorAll('.log-command'), el => el.textContent)).toEqual(['commit -m Needle']);
    await fireEvent.click(getByRole('button', { name: 'View' }));
    await fireEvent.click(getByRole('menuitemcheckbox', { name: 'Show background commands' }));
    expect(container.querySelectorAll('.log-entry')).toHaveLength(2);
    await fireEvent.input(input, { target: { value: '12.3s' } });
    expect(container.querySelectorAll('.log-entry')).toHaveLength(0);
    expect(container.querySelector('.log-empty')?.textContent).toBe('No matching commands');
  });

  it('Escape dismisses the View menu before clearing the search query', async () => {
    const { getByRole, queryByRole } = render(ActivityLog);
    const input = getByRole('textbox', { name: 'Search commands…' });
    await fireEvent.input(input, { target: { value: 'push' } });
    await fireEvent.click(getByRole('button', { name: 'View' }));
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
    expect(input).toHaveProperty('value', 'push');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveProperty('value', '');
  });

  it('shows relative times with the exact timestamp in a tooltip', async () => {
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
    const { container } = render(ActivityLog);
    const timestamp = '2026-09-15T11:55:00Z';
    deliverLog([
      entry({ command: 'git push' }),
      entry({ command: 'git fetch', timestamp }),
    ]);
    await waitFor(() => expect(container.querySelectorAll('.log-time')).toHaveLength(2));
    const times = container.querySelectorAll('.log-time');
    expect(Array.from(times, el => el.textContent)).toEqual(['just now', '5m ago']);
    await fireEvent.mouseEnter(times[1]);
    vi.advanceTimersByTime(500);
    expect(document.querySelector('.vsg-tooltip')?.textContent).toBe(new Date(timestamp).toLocaleString());
  });

  it('formats duration in ms for sub-second commands', async () => {
    const { container } = render(ActivityLog);
    deliverLog([entry({ command: 'git commit fast', duration: 50 })]);
    await waitFor(() => container.querySelector('.log-duration'));
    expect(container.querySelector('.log-duration')?.textContent?.trim()).toBe('50ms');
  });

  it('formats duration in seconds for commands taking >= 1s', async () => {
    const { container } = render(ActivityLog);
    deliverLog([entry({ command: 'git rebase slow', duration: 2500 })]);
    await waitFor(() => container.querySelector('.log-duration'));
    expect(container.querySelector('.log-duration')?.textContent?.trim()).toBe('2.5s');
  });

  it('truncates --format=... values in the displayed command', async () => {
    const { container } = render(ActivityLog);
    deliverLog([entry({ command: 'git commit --format=%H' })]);
    await waitFor(() => container.querySelector('.log-command'));
    expect(container.querySelector('.log-command')?.textContent).toContain('--format=…');
  });
});

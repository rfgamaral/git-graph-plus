import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import InteractiveRebase from '../InteractiveRebase.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit } from '../../../lib/types';

function commit(over: Partial<Commit>): Commit {
  return {
    hash: over.hash ?? 'h',
    abbreviatedHash: (over.hash ?? 'h').slice(0, 7),
    author: { name: 'A', email: 'a@x.com', date: '' },
    committer: { name: 'A', email: 'a@x.com', date: '' },
    subject: 'subject',
    body: '',
    parents: [],
    refs: [],
    ...over,
  };
}

function deliverCommits(commits: Commit[]) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'rebaseCommitsData', payload: { commits } },
  }));
}

async function deliverRebaseSettings() {
  await tick();
  const requestId = (globalThis.__postedMessages.find(m =>
    (m.data as { type: string }).type === 'getRebaseSettings',
  )!.data as { payload: { requestId: string } }).payload.requestId;
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'rebaseSettings', payload: { requestId, supported: true, updateRefs: false } },
  }));
  await tick();
}

const baseProps = {
  base: 'baseHash1234567',
  branchName: 'feature/x',
  baseSubject: 'init',
  onClose: vi.fn(),
};

beforeEach(() => {
  i18n.setLocale('en');
  globalThis.__postedMessages = [];
});

// Unmount between tests so a prior modal's window 'message' listener doesn't
// also handle the next test's deliverCommits (which corrupts shared state).
afterEach(() => cleanup());

describe('InteractiveRebase — initial flow', () => {
  it('requests rebase commits on mount with the base', () => {
    render(InteractiveRebase, baseProps);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getRebaseCommits'
    );
    expect(req).toBeDefined();
    expect((req!.data as { payload: { base: string } }).payload.base).toBe('baseHash1234567');
  });

  it('shows loading spinner before commits arrive', () => {
    const { container } = render(InteractiveRebase, baseProps);
    expect(container.querySelector('.rebase-loading')).not.toBeNull();
  });

  it('shows empty state when zero commits returned', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([]);
    await waitFor(() => {
      expect(container.querySelector('.rebase-empty')).not.toBeNull();
    });
  });

  it('renders one todo row per commit', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
      commit({ hash: 'c3', subject: 'three' }),
    ]);
    await waitFor(() => {
      expect(container.querySelectorAll('.todo-item').length).toBe(3);
    });
  });
});

describe('InteractiveRebase — action changes', () => {
  it('changing an action via the dropdown updates the badge label', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    // Open the second badge dropdown (squash/fixup are disabled on the first row)
    await fireEvent.click(badges[1]);
    await waitFor(() => container.querySelector('.action-dropdown'));
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    const dropOpt = Array.from(opts).find(o => o.textContent?.toLowerCase().includes('drop'))!;
    await fireEvent.click(dropOpt);
    await waitFor(() => {
      expect(badges[1].textContent?.toLowerCase()).toContain('drop');
    });
  });

  it('drop warning appears when at least one row is set to drop', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    expect(container.querySelector('.rebase-warning')).toBeNull();
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[1]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('drop'))!);
    await waitFor(() => {
      expect(container.querySelector('.rebase-warning')).not.toBeNull();
    });
  });

  it('squash and fixup options are disabled for the first (oldest) row', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[0]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    const squash = Array.from(opts).find(o => o.textContent?.toLowerCase().includes('squash')) as HTMLButtonElement;
    const fixup = Array.from(opts).find(o => o.textContent?.toLowerCase().includes('fixup')) as HTMLButtonElement;
    expect(squash.disabled).toBe(true);
    expect(fixup.disabled).toBe(true);
  });

  it('selecting reword shows an editable message input', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[1]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('reword'))!);
    await waitFor(() => {
      const inputs = container.querySelectorAll('.todo-message-input');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  it('pre-fills the full commit message (subject + body) when selecting reword on a commit with body', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one', body: 'line two\nline three' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[0]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('reword'))!);
    await waitFor(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>('.todo-message-input');
      expect(textarea).not.toBeNull();
      expect(textarea!.value).toContain('line two');
      expect(textarea!.value).toContain('line three');
      expect(textarea!.value).toContain('one');
    });
  });

  it('shows combined subject+body for squash-target, excluding fixup messages', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'a', subject: 'target', body: 'target body' }),
      commit({ hash: 'b', subject: 'squash msg', body: 'squash body' }),
      commit({ hash: 'c', subject: 'fixup msg', body: 'fixup body' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    // Squash commit b, fixup commit c
    await fireEvent.click(badges[1]);
    const squashOpts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(squashOpts).find(o => o.textContent?.toLowerCase().includes('squash'))!);
    await fireEvent.click(badges[2]);
    const fixupOpts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(fixupOpts).find(o => o.textContent?.toLowerCase().includes('fixup'))!);
    await waitFor(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>('.todo-message-input');
      expect(textarea).not.toBeNull();
      expect(textarea!.value).toContain('target');
      expect(textarea!.value).toContain('target body');
      expect(textarea!.value).toContain('squash msg');
      expect(textarea!.value).toContain('squash body');
      // fixup messages should be excluded
      expect(textarea!.value).not.toContain('fixup msg');
      expect(textarea!.value).not.toContain('fixup body');
    });
  });
});

describe('InteractiveRebase — submit', () => {
  it('Start button is disabled until something changes', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    await deliverRebaseSettings();
    const start = container.querySelector<HTMLButtonElement>('button.primary')!;
    expect(start.disabled).toBe(true);
  });

  it('Start posts interactiveRebase with current todos and calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(InteractiveRebase, { ...baseProps, onClose });
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[1]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('drop'))!);
    await deliverRebaseSettings();
    globalThis.__postedMessages = [];
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'interactiveRebase'
    );
    expect(req).toBeDefined();
    const payload = (req!.data as { payload: { base: string; todos: Array<{ action: string; hash: string }>; updateRefs?: boolean } }).payload;
    expect(payload.base).toBe('baseHash1234567');
    expect(payload.updateRefs).toBe(false);
    expect(payload.todos.map(t => t.action)).toEqual(['pick', 'drop']);
    expect(payload.todos.map(t => t.hash)).toEqual(['c1', 'c2']);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('InteractiveRebase — reordering', () => {
  it('move-down on row 0 swaps it with row 1', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    // Each row has [move up, move down] buttons. Click row-0's down button.
    const moveBtns = container.querySelectorAll<HTMLButtonElement>('.move-btn');
    await fireEvent.click(moveBtns[1]); // row 0, down
    await waitFor(() => {
      const hashes = Array.from(container.querySelectorAll('.todo-hash')).map(h => h.textContent?.trim());
      expect(hashes).toEqual(['c2', 'c1']);
    });
  });

  it('reordering enables the Start button (hasChanges via orderChanged)', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    const moveBtns = container.querySelectorAll<HTMLButtonElement>('.move-btn');
    await fireEvent.click(moveBtns[1]);
    expect(container.querySelector<HTMLButtonElement>('button.primary')!.disabled).toBe(true);
    await deliverRebaseSettings();
    await waitFor(() => {
      const start = container.querySelector<HTMLButtonElement>('button.primary')!;
      expect(start.disabled).toBe(false);
    });
  });

  it('move-up on row 1 swaps it with row 0', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    const moveBtns = container.querySelectorAll<HTMLButtonElement>('.move-btn');
    // Each row has [up, down]; row 1's up button is at index 2
    await fireEvent.click(moveBtns[2]);
    await waitFor(() => {
      const hashes = Array.from(container.querySelectorAll('.todo-hash')).map(h => h.textContent?.trim());
      expect(hashes).toEqual(['c2', 'c1']);
    });
  });

  it('drag-over from row 1 onto row 0 reorders', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    const items = container.querySelectorAll<HTMLDivElement>('.todo-item');
    await fireEvent.dragStart(items[1]);
    await fireEvent.dragOver(items[0]);
    await fireEvent.dragEnd(items[1]);
    await waitFor(() => {
      const hashes = Array.from(container.querySelectorAll('.todo-hash')).map(h => h.textContent?.trim());
      expect(hashes).toEqual(['c2', 'c1']);
    });
  });

  it('dragging a squash row to position 0 demotes it back to "pick"', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    // First set row 1 to squash
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[1]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('squash'))!);
    // Move it to position 0 via drag → guardFirstItem should reset to pick
    const items = container.querySelectorAll<HTMLDivElement>('.todo-item');
    await fireEvent.dragStart(items[1]);
    await fireEvent.dragOver(items[0]);
    await fireEvent.dragEnd(items[1]);
    await waitFor(() => {
      const firstBadge = container.querySelectorAll<HTMLButtonElement>('.action-badge')[0];
      expect(firstBadge.textContent?.toLowerCase()).toContain('pick');
    });
  });

  it('clicking outside closes the open action dropdown', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([commit({ hash: 'c1', subject: 'one' })]);
    await waitFor(() => container.querySelector('.todo-item'));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('.action-badge')!);
    await waitFor(() => container.querySelector('.action-dropdown'));
    // Window click closes the dropdown (registered in onMount)
    await fireEvent.click(window);
    await waitFor(() => {
      expect(container.querySelector('.action-dropdown')).toBeNull();
    });
  });
});

describe('InteractiveRebase — layout', () => {
  it('renders in a wider modal than the default 480px', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([commit({ hash: 'c1', subject: 'one' })]);
    await waitFor(() => container.querySelector('.todo-item'));
    const modal = container.querySelector<HTMLDivElement>('.modal')!;
    // happy-dom doesn't parse CSS min() into style.width, so assert on the
    // inline style attribute the component sets.
    expect(modal.getAttribute('style')).toContain('760');
  });
});

describe('InteractiveRebase — keyboard navigation', () => {
  it('selects the first row by default', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const items = container.querySelectorAll('.todo-item');
    expect(items[0].classList.contains('selected')).toBe(true);
    expect(items[1].classList.contains('selected')).toBe(false);
  });

  it('arrow keys move the selection down and up', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
      commit({ hash: 'c3', subject: 'three' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));

    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(container.querySelectorAll('.todo-item')[1].classList.contains('selected')).toBe(true);
    });

    await fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(container.querySelectorAll('.todo-item')[0].classList.contains('selected')).toBe(true);
    });
  });

  it('j / k do not move the selection', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    await fireEvent.keyDown(window, { key: 'j' });
    await fireEvent.keyDown(window, { key: 'k' });
    expect(container.querySelectorAll('.todo-item')[0].classList.contains('selected')).toBe(true);
  });

  it('arrow keys clamp the selection at the ends', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));

    // Up at the top stays on row 0.
    await fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(container.querySelectorAll('.todo-item')[0].classList.contains('selected')).toBe(true);

    // Down twice clamps at the last row.
    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(container.querySelectorAll('.todo-item')[1].classList.contains('selected')).toBe(true);
    });
  });

  it('action keys set the selected row\'s action', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    // Select row 1, then press 'd' for drop.
    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => {
      const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
      expect(badges[1].textContent?.toLowerCase()).toContain('drop');
    });
  });

  it('squash / fixup keys are ignored on the first row', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    // Row 0 is selected by default; 's' must not turn it into squash.
    await fireEvent.keyDown(window, { key: 's' });
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    expect(badges[0].textContent?.toLowerCase()).toContain('pick');
  });

  it('Shift+ArrowDown reorders the selected row down and selection follows', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelectorAll('.todo-item').length === 2);
    await fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => {
      const hashes = Array.from(container.querySelectorAll('.todo-hash')).map(h => h.textContent?.trim());
      expect(hashes).toEqual(['c2', 'c1']);
      // selection follows the moved row to index 1
      expect(container.querySelectorAll('.todo-item')[1].classList.contains('selected')).toBe(true);
    });
  });

  it('Ctrl+Enter starts the rebase when there are changes', async () => {
    const onClose = vi.fn();
    const { container } = render(InteractiveRebase, { ...baseProps, onClose });
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    // Make a change so the rebase is allowed to start.
    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await fireEvent.keyDown(window, { key: 'd' });
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
    await deliverRebaseSettings();
    globalThis.__postedMessages = [];
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      const req = globalThis.__postedMessages.find(
        (m) => (m.data as { type?: string }).type === 'interactiveRebase'
      );
      expect(req).toBeDefined();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not start the rebase via Ctrl+Enter when nothing changed', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    await deliverRebaseSettings();
    globalThis.__postedMessages = [];
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'interactiveRebase'
    );
    expect(req).toBeUndefined();
  });

  it('ignores action shortcuts while typing in a message textarea', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'one' }),
      commit({ hash: 'c2', subject: 'two' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    // Turn row 1 into reword to get a textarea.
    const badges = container.querySelectorAll<HTMLButtonElement>('.action-badge');
    await fireEvent.click(badges[1]);
    const opts = container.querySelectorAll<HTMLButtonElement>('.action-option');
    await fireEvent.click(Array.from(opts).find(o => o.textContent?.toLowerCase().includes('reword'))!);
    const textarea = await waitFor(() => container.querySelector<HTMLTextAreaElement>('.todo-message-input')!);
    // Pressing 'd' inside the textarea must not drop row 0.
    await fireEvent.keyDown(textarea, { key: 'd' });
    const firstBadge = container.querySelectorAll<HTMLButtonElement>('.action-badge')[0];
    expect(firstBadge.textContent?.toLowerCase()).toContain('pick');
  });
});

describe('InteractiveRebase — autosquash', () => {
  it('auto-arranges fixup! commits under their target on load (toggle on)', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'Add feature' }),
      commit({ hash: 'c2', subject: 'Unrelated work' }),
      commit({ hash: 'c3', subject: 'fixup! Add feature' }),
    ]);
    await waitFor(() => {
      // No click needed — the fixup! (c3) is arranged right under its target.
      const order = [...container.querySelectorAll('.todo-hash')].map(n => n.textContent);
      expect(order).toEqual(['c1', 'c3', 'c2']);
      const badges = [...container.querySelectorAll('.action-badge')].map(b => b.textContent?.toLowerCase());
      expect(badges[1]).toContain('fixup');
    });
    expect(container.querySelector<HTMLInputElement>('.autosquash-switch input')!.checked).toBe(true);
  });

  it('restores the original order when the autosquash toggle is turned off', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'Add feature' }),
      commit({ hash: 'c2', subject: 'Unrelated work' }),
      commit({ hash: 'c3', subject: 'fixup! Add feature' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));

    await fireEvent.click(container.querySelector<HTMLInputElement>('.autosquash-switch input')!);

    await waitFor(() => {
      const order = [...container.querySelectorAll('.todo-hash')].map(n => n.textContent);
      expect(order).toEqual(['c1', 'c2', 'c3']);
      const badges = [...container.querySelectorAll('.action-badge')].map(b => b.textContent?.toLowerCase());
      expect(badges.every(b => b?.includes('pick'))).toBe(true);
    });
  });

  it('keeps reordering on every toggle and leaves other controls responsive', async () => {
    // Regression: the squash-message effect read & wrote `todos`, so replacing
    // the list on each toggle spun into an update-depth loop that froze the
    // component — the toggle (a native checkbox) kept flipping while every
    // Svelte-handled button went dead. Toggle several times, then confirm a
    // move button still reorders.
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'Add feature' }),
      commit({ hash: 'c2', subject: 'Unrelated work' }),
      commit({ hash: 'c3', subject: 'fixup! Add feature' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    const sw = () => container.querySelector<HTMLInputElement>('.autosquash-switch input')!;
    const order = () => [...container.querySelectorAll('.todo-hash')].map(n => n.textContent);

    // Loads with autosquash on (fixup grouped under its target).
    await waitFor(() => expect(order()).toEqual(['c1', 'c3', 'c2']));

    // Toggle off → on → off → on; each flip must re-arrange, not freeze.
    for (const expected of [['c1', 'c2', 'c3'], ['c1', 'c3', 'c2'], ['c1', 'c2', 'c3'], ['c1', 'c3', 'c2']]) {
      await fireEvent.click(sw());
      await waitFor(() => expect(order()).toEqual(expected));
    }

    // A non-native control still works after all that toggling (not frozen).
    // Currently arranged c1,c3,c2 with c2 last; move c2 up.
    const moveBtns = container.querySelectorAll<HTMLButtonElement>('.move-btn');
    await fireEvent.click(moveBtns[moveBtns.length - 2]); // last row, up
    await waitFor(() => expect(order()).toEqual(['c1', 'c2', 'c3']));
  });

  it('hides the toggle and keeps order when there are no fixup!/squash! commits', async () => {
    const { container } = render(InteractiveRebase, baseProps);
    deliverCommits([
      commit({ hash: 'c1', subject: 'Add feature' }),
      commit({ hash: 'c2', subject: 'Add tests' }),
    ]);
    await waitFor(() => container.querySelector('.todo-item'));
    expect(container.querySelector('.autosquash-row')).toBeNull();
    const order = [...container.querySelectorAll('.todo-hash')].map(n => n.textContent);
    expect(order).toEqual(['c1', 'c2']);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import RebaseBranchModal from '../RebaseBranchModal.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { defaultsStore } from '../../../lib/stores/defaults.svelte';
import { DEFAULT_MODAL_DEFAULTS } from '../../../lib/defaults-shape';

beforeEach(() => { i18n.setLocale('en'); });
afterEach(() => { cleanup(); defaultsStore.current = structuredClone(DEFAULT_MODAL_DEFAULTS); });

async function deliverRebaseSettings(updateRefs = false) {
  const requestId = (globalThis.__postedMessages.find(m =>
    (m.data as { type: string }).type === 'getRebaseSettings',
  )!.data as { payload: { requestId: string } }).payload.requestId;
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'rebaseSettings', payload: { requestId, supported: true, updateRefs } },
  }));
  await tick();
}

describe('RebaseBranchModal', () => {
  it('on mount, posts predictConflicts with mode=rebase and ours=branch, theirs=onto', () => {
    render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase: vi.fn(),
    });
    const posted = globalThis.__postedMessages.map(m => m.data) as Array<{ type: string; payload?: Record<string, unknown> }>;
    const predict = posted.find(p => p.type === 'predictConflicts');
    expect(predict).toBeDefined();
    expect(predict!.payload!.ours).toBe('topic');
    expect(predict!.payload!.theirs).toBe('main');
    expect(predict!.payload!.mode).toBe('rebase');
  });

  it('shows spinner before conflict response arrives', () => {
    const { container } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase: vi.fn(),
    });
    expect(container.querySelector('.spinner')).not.toBeNull();
    expect(container.querySelector('.conflict-truncated')).toBeNull();
  });

  it('switches to success class when prediction reports no conflict', async () => {
    const { container } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase: vi.fn(),
    });
    const requestId = (globalThis.__postedMessages.find(m =>
      (m.data as { type: string }).type === 'predictConflicts',
    )!.data as { payload: { requestId: string } }).payload.requestId;

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'conflictPrediction', payload: { hasConflict: false, files: [], requestId } },
    }));
    await tick();

    expect(container.querySelector('.conflict-status.is-success')).not.toBeNull();
  });

  it.each([
    { hasConflict: false, truncated: false },
    { hasConflict: false, truncated: true },
    { hasConflict: true, truncated: false },
    { hasConflict: true, truncated: true },
  ])('renders a separate truncation note only when truncated: %j', async ({ hasConflict, truncated }) => {
    const { container } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase: vi.fn(),
    });
    const requestId = (globalThis.__postedMessages.find(m =>
      (m.data as { type: string }).type === 'predictConflicts',
    )!.data as { payload: { requestId: string } }).payload.requestId;

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'conflictPrediction',
        payload: { hasConflict, files: hasConflict ? ['src/a.ts'] : [], truncated, requestId },
      },
    }));
    await tick();

    const status = container.querySelector('.conflict-status')!;
    expect(status.textContent?.trim()).toBe(hasConflict ? 'Rebase conflict in 1 file(s)' : 'No rebase conflicts');
    const note = container.querySelector('.conflict-truncated');
    if (truncated) {
      expect(note?.textContent).toBe('Checked the first 20 commits only');
      expect(status.nextElementSibling).toBe(note);
      expect(note?.tagName).toBe('P');
    } else {
      expect(note).toBeNull();
    }
  });

  it('forwards autostash flag to onRebase', async () => {
    const onRebase = vi.fn();
    const { container, getByLabelText } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase,
    });
    await deliverRebaseSettings();
    const autostash = getByLabelText(/Stash and reapply local changes/);
    await fireEvent.click(autostash);
    await fireEvent.click(getByLabelText(/Update dependent branches/));
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    expect(onRebase).toHaveBeenCalledWith({ autostash: true, pushAfter: false, updateRefs: true });
  });

  it('forwards pushAfter flag to onRebase', async () => {
    const onRebase = vi.fn();
    const { container, getByLabelText } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase,
    });
    await deliverRebaseSettings();
    const pushAfter = getByLabelText(/Push the branch after a successful rebase/);
    await fireEvent.click(pushAfter);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    expect(onRebase).toHaveBeenCalledWith({ autostash: false, pushAfter: true, updateRefs: false });
  });

  it('initializes autostash and pushAfter from defaultsStore', async () => {
    defaultsStore.current.rebase = { autostash: true, pushAfter: true };
    const { getByLabelText } = render(RebaseBranchModal, {
      branch: 'topic', onto: 'main',
      onClose: vi.fn(), onRebase: vi.fn(),
    });
    await deliverRebaseSettings(true);
    expect((getByLabelText(/Update dependent branches/) as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(/Stash and reapply local changes/) as HTMLInputElement).checked).toBe(true);  // autostash
    expect((getByLabelText(/Push the branch after a successful rebase/) as HTMLInputElement).checked).toBe(true);  // pushAfter
  });
});

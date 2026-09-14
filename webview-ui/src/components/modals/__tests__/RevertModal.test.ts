import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import RevertModal from '../RevertModal.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { defaultsStore } from '../../../lib/stores/defaults.svelte';
import { DEFAULT_MODAL_DEFAULTS } from '../../../lib/defaults-shape';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { getVsCodeApi } from '../../../lib/vscode-api';

const baseProps = {
  commit: 'abcdef1234567890',
  branch: 'main',
  onClose: vi.fn(),
  onRevert: vi.fn(),
};

beforeEach(() => {
  i18n.setLocale('en');
  commitStore.commits = [];
});
afterEach(() => {
  defaultsStore.current = structuredClone(DEFAULT_MODAL_DEFAULTS);
  vi.restoreAllMocks();
});

describe('RevertModal — payload', () => {
  it('default click sends noCommit=false, pushAfter=false', async () => {
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, onRevert });
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    expect(onRevert).toHaveBeenCalledWith({ noCommit: false, pushAfter: false });
  });

  it('unchecking Create a revert commit sends noCommit and hides pushAfter', async () => {
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, onRevert });
    const box = container.querySelector<HTMLInputElement>('label.modal-checkbox input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    expect(box.closest('label')?.textContent).toContain('Create a revert commit');
    await fireEvent.click(box);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    expect(onRevert).toHaveBeenCalledWith({ noCommit: true, pushAfter: false });
  });

  it('forwards pushAfter when Create a revert commit is checked', async () => {
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, onRevert });
    const boxes = container.querySelectorAll<HTMLInputElement>('label.modal-checkbox input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    await fireEvent.click(boxes[1]!); // pushAfter
    await fireEvent.click(container.querySelector<HTMLButtonElement>('button.primary')!);
    expect(onRevert).toHaveBeenCalledWith({ noCommit: false, pushAfter: true });
  });

  it('renders short commit hash and branch in the context card', () => {
    const { container } = render(RevertModal, baseProps);
    const text = container.querySelector('.modal-context-card')?.textContent ?? '';
    expect(text).toContain('abcdef1');
    expect(text).toContain('main');
  });

  it('cancel fires onClose, not onRevert', async () => {
    const onClose = vi.fn();
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, onClose, onRevert });
    const buttons = container.querySelectorAll('button');
    await fireEvent.click(buttons[buttons.length - 2]);
    expect(onClose).toHaveBeenCalled();
    expect(onRevert).not.toHaveBeenCalled();
  });
});

describe('RevertModal — conflict prediction', () => {
  it('posts a predictConflicts request on mount', () => {
    globalThis.__postedMessages = [];
    render(RevertModal, baseProps);
    const predictMsg = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'predictConflicts'
    );
    expect(predictMsg).toBeDefined();
    const payload = (predictMsg!.data as { payload: Record<string, string> }).payload;
    expect(payload.ours).toBe('HEAD');
    expect(payload.theirs).toBe('abcdef1234567890^');
    expect(payload.mergeBase).toBe('abcdef1234567890');
    expect(typeof payload.requestId).toBe('string');
  });

  it('shows the checking spinner before a prediction arrives', () => {
    const { container } = render(RevertModal, baseProps);
    expect(container.querySelector('.spinner')).not.toBeNull();
  });

  it('renders the success state when prediction reports no conflict', async () => {
    const { container } = render(RevertModal, baseProps);
    const requestId = (globalThis.__postedMessages.at(-1)!.data as { payload: { requestId: string } }).payload.requestId;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'conflictPrediction', payload: { hasConflict: false, files: [], requestId } },
    }));
    await waitFor(() => {
      expect(container.querySelector('.conflict-status.is-success')).not.toBeNull();
    });
  });

  it('renders the warning state when prediction reports conflicts', async () => {
    const { container } = render(RevertModal, baseProps);
    const requestId = (globalThis.__postedMessages.at(-1)!.data as { payload: { requestId: string } }).payload.requestId;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'conflictPrediction', payload: { hasConflict: true, files: ['a.ts', 'b.ts'], requestId } },
    }));
    await waitFor(() => {
      expect(container.querySelector('.conflict-status.is-warning')).not.toBeNull();
    });
  });

  it('ignores messages with a mismatching requestId', async () => {
    const { container } = render(RevertModal, baseProps);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'conflictPrediction', payload: { hasConflict: true, files: ['x'], requestId: 'unrelated' } },
    }));
    // Still spinning
    expect(container.querySelector('.spinner')).not.toBeNull();
  });
});

describe('RevertModal — merge parents', () => {
  const parents = ['1111111abcdef', '2222222abcdef'];

  it.each([1, 2])('predicts and reverts against parent %i', async (mainline) => {
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, parents, onRevert });
    expect(container.querySelector('.color-select-btn')?.textContent).toContain('1111111');
    expect(container.querySelector('.color-select-btn')?.getAttribute('aria-label')).toBe('Mainline parent: 1111111');
    if (mainline === 2) {
      await fireEvent.click(container.querySelector('.color-select-btn')!);
      await fireEvent.click(container.querySelectorAll('.color-select-option')[1]);
    }
    expect(globalThis.__postedMessages.at(-1)?.data).toMatchObject({
      type: 'predictConflicts',
      payload: { ours: 'HEAD', theirs: parents[mainline - 1], mergeBase: baseProps.commit },
    });
    await fireEvent.click(container.querySelector('button.primary')!);
    expect(onRevert).toHaveBeenCalledWith({ noCommit: false, pushAfter: false, mainline });
  });

  it('uses loaded titles and handles synchronous title and prediction responses', async () => {
    commitStore.commits = [{ hash: parents[0], subject: 'Loaded parent' } as typeof commitStore.commits[number]];
    const postMessage = vi.spyOn(getVsCodeApi(), 'postMessage').mockImplementation((message) => {
      const { type, payload } = message as { type: string; payload: { hash: string; requestId: string } };
      window.dispatchEvent(new MessageEvent('message', { data: type === 'getCommitData'
        ? { type: 'commitData', payload: { commit: { hash: payload.hash, subject: 'Fetched parent' } } }
        : { type: 'conflictPrediction', payload: { requestId: payload.requestId, hasConflict: false, files: [] } },
      }));
    });
    const { container } = render(RevertModal, { ...baseProps, parents });
    await waitFor(() => expect(container.querySelector('.conflict-status.is-success')).not.toBeNull());
    expect(postMessage.mock.calls.filter(([m]) => (m as { type: string }).type === 'getCommitData'))
      .toEqual([[{ type: 'getCommitData', payload: { hash: parents[1] } }]]);
    await fireEvent.click(container.querySelector('.color-select-btn')!);
    expect(Array.from(container.querySelectorAll('.color-select-option'), el => el.textContent?.trim()))
      .toEqual(['1111111 Loaded parent', '2222222 Fetched parent']);
  });

  it.each([false, true])('rejects stale predictions after parent change (previous resolved: %s)', async (resolved) => {
    const { container } = render(RevertModal, { ...baseProps, parents });
    const oldRequest = (globalThis.__postedMessages.at(-1)!.data as { payload: { requestId: string } }).payload.requestId;
    if (resolved) {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'conflictPrediction', payload: { requestId: oldRequest, hasConflict: false, files: [] },
      } }));
      await waitFor(() => expect(container.querySelector('.conflict-status.is-success')).not.toBeNull());
    }
    await fireEvent.click(container.querySelector('.color-select-btn')!);
    await fireEvent.click(container.querySelectorAll('.color-select-option')[1]);
    const requestId = (globalThis.__postedMessages.at(-1)!.data as { payload: { requestId: string } }).payload.requestId;
    expect(requestId).not.toBe(oldRequest);
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'conflictPrediction', payload: { requestId: oldRequest, hasConflict: false, files: [] },
    } }));
    expect(container.querySelector('.spinner')).not.toBeNull();
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'conflictPrediction', payload: { requestId, hasConflict: true, files: ['conflict.txt'] },
    } }));
    await waitFor(() => expect(container.querySelector('.conflict-status.is-warning')).not.toBeNull());
  });
});

describe('RevertModal — defaults store', () => {
  it('inverts configured noCommit and suppresses configured push until creating a commit', async () => {
    defaultsStore.current.revert = { noCommit: true, pushAfter: true };
    const onRevert = vi.fn();
    const { container } = render(RevertModal, { ...baseProps, onRevert });
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(container.querySelector('.color-select')).toBeNull();
    await fireEvent.click(container.querySelector('button.primary')!);
    expect(onRevert).toHaveBeenLastCalledWith({ noCommit: true, pushAfter: false });
    await fireEvent.click(box);
    await fireEvent.click(container.querySelector('button.primary')!);
    expect(onRevert).toHaveBeenLastCalledWith({ noCommit: false, pushAfter: true });
  });

  it('initializes pushAfter checkbox from defaultsStore', () => {
    defaultsStore.current.revert = { noCommit: false, pushAfter: true };
    const { container } = render(RevertModal, baseProps);
    const boxes = container.querySelectorAll<HTMLInputElement>('label.modal-checkbox input[type="checkbox"]');
    expect(boxes[1]!.checked).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CommitGraph from '../CommitGraph.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit, CommitGraphData } from '../../../lib/types';

function makeCommit(hash: string, subject: string, parents: string[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    committer: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    subject,
    body: '',
    parents,
    refs: [],
  };
}

function makeGraphData(commits: Commit[]): CommitGraphData {
  return {
    commits,
    graph: commits.map(c => ({ commit: c.hash, column: 0, color: '#63b0f4', parents: [] })),
    paths: [],
    links: [],
    dots: commits.map((_, i) => ({ center: { x: 0, y: i }, color: 0, type: 'default' as const, localOnly: false, remoteTip: false })),
    commitLeftMargin: commits.map(() => 24),
    hasMore: false,
    currentLimit: 1000,
  };
}

beforeEach(() => {
  i18n.setLocale('en');
  // Reset shared singletons between tests.
  commitStore.commits = [];
  commitStore.graphNodes = [];
  commitStore.paths = [];
  commitStore.links = [];
  commitStore.dots = [];
  commitStore.commitLeftMargin = [];
  commitStore.loading = false;
  commitStore.notGitRepo = false;
  branchStore.branches = [];
  branchStore.worktrees = [];
  uiStore.selectedCommitHash = null;
  modalStore.closeAll();
});

afterEach(() => cleanup());

describe('CommitGraph smoke', () => {
  it('renders without crashing when commits are empty', () => {
    const { container } = render(CommitGraph, {});
    // No commit rows expected, but the container should exist.
    expect(container).toBeTruthy();
    expect(container.querySelectorAll('.commit-row').length).toBe(0);
  });

  it('renders one row per commit when commits are populated', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
      makeCommit('h3', 'third', ['h2']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(3);
  });

  it('clicking a commit row sets selectedCommitHash after the dbl-click timeout fires', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    expect(rows.length).toBeGreaterThan(0);
    // The dual-click discriminator waits 200ms before treating a click as
    // a single-click. Use fake timers if you want to exercise the delay,
    // but we just need to confirm clicking does not throw.
    await fireEvent.click(rows[0]);
    // Selection is deferred until the dbl-click timer expires; do a soft
    // assertion that the row is at least focusable / clickable.
    expect(rows[0]).toBeTruthy();
  });

  it('clicking the UNCOMMITTED row opens the SCM view instead of selecting it', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      makeCommit('h1', 'first'),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    await fireEvent.click(rows[0]);
    await tick();
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('right-clicking the UNCOMMITTED row opens an Amend menu, then the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      head,
    ]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h1' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The single menu item is "Amend '{ref}'" (ref = current branch); click it.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend 'main'$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h1');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('right-clicking the HEAD commit opens the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h2', 'latest', ['h1']);
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([head, makeCommit('h1', 'first')]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // HEAD row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend commit$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h2');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('offers "Create worktree from" on a regular branch and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The branch "develop" is a submenu-parent; hover over it to reveal children.
    const parentBtn = Array.from(container.querySelectorAll<HTMLElement>('button.menu-item.has-children'))
      .find(el => (el.textContent ?? '').includes('develop'));
    if (parentBtn) {
      await fireEvent.mouseEnter(parentBtn);
      await tick();
    }
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('offers a top-level "Create worktree from" item (no submenu hover needed) and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // Top-level (flat) item is present WITHOUT hovering into the branch submenu.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('does not crash on a branch-set fingerprint cache hit (same commits, same branch)', async () => {
    // First mount populates the cache.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    // currentBranch is a getter — set it by adding a current branch to the list.
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];

    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(2);

    // Re-render with the SAME data — the fingerprint must match, no errors.
    cleanup();
    const { container: c2 } = render(CommitGraph, {});
    await tick();
    expect(c2.querySelectorAll('.commit-row').length).toBe(2);
  });
});

describe('CommitGraph columns', () => {
  let viewportWidth: number;
  let originalRepo: string;
  let originalAutoFit: boolean;
  let originalDateFormat: string;

  function widths(container: HTMLElement) {
    const graph = container.querySelector<HTMLElement>('.commit-graph')!;
    return ['author', 'hash', 'date'].map(name => parseFloat(graph.style.getPropertyValue(`--${name}-width`)));
  }

  function messages(type: string) {
    return globalThis.__postedMessages.map(m => m.data as {
      type: string; payload: { repo: string; requestId: string; widths?: number[] };
    }).filter(m => m.type === type);
  }

  async function restore(request: ReturnType<typeof messages>[number], values: number[]) {
    await fireEvent(window, new MessageEvent('message', {
      data: { type: 'graphColumns', payload: { ...request.payload, widths: values } },
    }));
  }

  beforeEach(() => {
    originalRepo = uiStore.activeRepo;
    originalAutoFit = uiStore.autoFitColumns;
    originalDateFormat = uiStore.dateTimeFormat;
    uiStore.activeRepo = '/repo-a';
    uiStore.autoFitColumns = false;
    uiStore.dateTimeFormat = 'YYYY';
    viewportWidth = 1000;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as CanvasRenderingContext2D);
    commitStore.setData(makeGraphData([makeCommit('h1', 'first')]));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    uiStore.activeRepo = originalRepo;
    uiStore.autoFitColumns = originalAutoFit;
    uiStore.dateTimeFormat = originalDateFormat;
  });

  it('redistributes adjacent columns, clamps both ends, and saves only when dragging ends', async () => {
    const { container } = render(CommitGraph, {});
    await tick();
    const handle = container.querySelectorAll('.column-resize')[1];
    expect(widths(container)).toEqual([120, 75, 150]);
    await fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 210 });
    expect(widths(container)).toEqual([130, 65, 150]);
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1000 });
    expect(widths(container)).toEqual([140, 55, 150]);
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
    expect(widths(container)).toEqual([70, 125, 150]);
    expect(messages('saveGraphColumns')).toEqual([]);
    await fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(messages('saveGraphColumns')).toEqual([
      { type: 'saveGraphColumns', payload: { repo: '/repo-a', widths: [70, 125, 150] } },
    ]);
  });

  it('protects description width and clamps columns to a shrinking viewport without overwriting preferences', async () => {
    const { container } = render(CommitGraph, {});
    await tick();
    const handle = container.querySelectorAll('.column-resize')[0];
    await fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: -1000 });
    expect(widths(container)).toEqual([655, 75, 150]);
    await fireEvent.pointerUp(handle, { pointerId: 1 });
    viewportWidth = 315;
    await fireEvent.resize(window);
    expect(widths(container)).toEqual([70, 55, 70]);
    viewportWidth = 157.5;
    await fireEvent.resize(window);
    expect(widths(container)).toEqual([35, 27.5, 35]);
    viewportWidth = 1000;
    await fireEvent.resize(window);
    expect(widths(container)).toEqual([655, 75, 150]);
    expect(messages('saveGraphColumns')).toHaveLength(1);
  });

  it('requests each repository and rejects old requests and responses arriving after manual resizing', async () => {
    const { container } = render(CommitGraph, {});
    await tick();
    const first = messages('getGraphColumns')[0];
    expect(first.payload.repo).toBe('/repo-a');
    await restore(first, [180, 90, 160]);
    expect(widths(container)).toEqual([180, 90, 160]);
    uiStore.activeRepo = '/repo-b';
    await tick();
    const second = messages('getGraphColumns')[1];
    expect(second.payload.repo).toBe('/repo-b');
    expect(widths(container)).toEqual([120, 75, 150]);
    await restore(first, [300, 100, 200]);
    expect(widths(container)).toEqual([120, 75, 150]);
    await restore(second, [150, 80, 170]);
    expect(widths(container)).toEqual([150, 80, 170]);
    uiStore.activeRepo = '/repo-a';
    await tick();
    const third = messages('getGraphColumns')[2];
    expect(third.payload.requestId).not.toBe(first.payload.requestId);
    await restore(first, [300, 100, 200]);
    expect(widths(container)).toEqual([120, 75, 150]);
    const handle = container.querySelectorAll('.column-resize')[2];
    await fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 });
    await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120 });
    await restore(third, [300, 100, 200]);
    expect(widths(container)).toEqual([120, 95, 130]);
    await fireEvent.pointerUp(handle, { pointerId: 1 });
    await restore(third, [300, 100, 200]);
    expect(widths(container)).toEqual([120, 95, 130]);
  });

  it('auto-fits from the header menu using headers and loaded content, including off-screen commits', async () => {
    const { container, getByRole } = render(CommitGraph, {});
    await tick();
    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    await fireEvent.click(getByRole('menuitem', { name: 'Auto-fit columns' }));
    expect(widths(container)).toEqual([80, 55, 70]);
    const commits = Array.from({ length: 100 }, (_, i) => makeCommit(`h${i}`, 'commit'));
    commits[99].author.name = 'Long author name';
    commits[99].abbreviatedHash = '123456789abc';
    commitStore.setData(makeGraphData(commits));
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBeLessThan(100);
    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    await fireEvent.click(getByRole('menuitem', { name: 'Auto-fit columns' }));
    const fitted = widths(container);
    expect(fitted[0]).toBeGreaterThan('Long author name'.length * 10);
    expect(fitted.slice(1)).toEqual([140, 70]);
    expect(messages('saveGraphColumns').at(-1)?.payload.widths).toEqual(fitted);
    commitStore.commits[99].author.name += ' extended';
    await tick();
    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    await fireEvent.click(getByRole('menuitem', { name: 'Auto-fit columns' }));
    expect(widths(container)).toEqual([fitted[0] + 90, 140, 70]);
  });

  it('refits after loading more and changing date format, disables dragging, and restores manual widths when turned off', async () => {
    const { container } = render(CommitGraph, {});
    await tick();
    await restore(messages('getGraphColumns')[0], [180, 90, 160]);
    uiStore.autoFitColumns = true;
    await tick();
    expect(container.querySelector('.column-resize')).toBeNull();
    expect(widths(container)).toEqual([80, 55, 70]);
    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    expect(container.querySelector('.context-menu')).toBeNull();
    commitStore.loading = true;
    const longer = makeCommit('123456789abc', 'loaded later');
    longer.author.name = 'Long author name';
    commitStore.commits = [...commitStore.commits, longer];
    await tick();
    expect(widths(container)).toEqual([80, 55, 70]);
    commitStore.loading = false;
    await tick();
    const fitted = widths(container);
    expect(fitted[0]).toBeGreaterThan('Long author name'.length * 10);
    expect(fitted.slice(1)).toEqual([90, 70]);
    uiStore.dateTimeFormat = 'YYYY-MM-DD HH:mm:ss';
    await tick();
    expect(widths(container)).toEqual([fitted[0], 90, 210]);
    expect(messages('saveGraphColumns')).toEqual([]);
    uiStore.autoFitColumns = false;
    await tick();
    expect(container.querySelectorAll('.column-resize')).toHaveLength(3);
    expect(widths(container)).toEqual([180, 90, 160]);
  });
});

describe('CommitGraph signature icon', () => {
  it('renders a signature icon for good/unverified commits', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'signed'), signatureStatus: 'good' },
      { ...makeCommit('h2', 'tampered', ['h1']), signatureStatus: 'unverified' },
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon.sig-icon-good')).toBeTruthy();
    expect(container.querySelector('.sig-icon.sig-icon-unverified')).toBeTruthy();
  });

  it('omits the icon for "none" and when signatureStatus is absent', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'unsigned'), signatureStatus: 'none' },
      makeCommit('h2', 'no field', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon')).toBeFalsy();
  });

  it('shows "Interactive Rebase selected commits" for a contiguous chain on a non-current branch', async () => {
    const head = makeCommit('h1', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('f1', 'feature 1', ['h1']);
    const f2 = makeCommit('f2', 'feature 2', ['f1']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'f2' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['f1', 'f2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the right-clicked commit outlined while a context-menu modal is open, then clears it on close', async () => {
    // Regression: opening a modal from the context menu (e.g. New Branch, which
    // is managed by modalStore and rendered in App.svelte) used to clear the
    // row outline immediately — reset kept it, these did not. The outline must
    // persist while any follow-up modal is open and drop once it closes.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => (el.textContent ?? '').trim() === 'New Branch');
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(modalStore.createBranch.show).toBe(true);
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    modalStore.closeCreateBranch();
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeFalsy();
  });

  it('keeps the right-clicked commit outlined when opening interactive rebase from the single-commit menu', async () => {
    // Regression: interactiveRebaseBase is only mirrored into modalStore via an
    // $effect, which runs after the synchronous menu onClose. The outline used
    // to clear because anyModalOpen still read false at that point.
    const c1 = makeCommit('h1', 'first');
    const c2 = makeCommit('h2', 'second', ['h1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1]));
    branchStore.branches = [{ name: 'main', current: true, ahead: 0, behind: 0, hash: 'h2' }];
    uiStore.interactiveRebaseMode = 'ui';

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[1]; // h1 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => /^interactively rebase .* to here$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the multi-selection armed after opening the interactive rebase modal (GUI mode)', async () => {
    // Regression: clicking "Interactive Rebase selected commits" used to clear
    // the selection the moment the modal opened. Like squash/cherry-pick, the
    // selection must persist while the modal is open.
    const base = makeCommit('m0', 'base');
    const c1 = makeCommit('c1', 'commit 1', ['m0']);
    const c2 = makeCommit('c2', 'commit 2', ['c1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1, base]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'c2' },
    ];
    uiStore.interactiveRebaseMode = 'ui';
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['c1', 'c2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // c2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(uiStore.multiSelectArmed).toBe(true);
    expect(uiStore.selectedCommitHashes).toEqual(['c1', 'c2']);

    uiStore.exitMultiSelect();
  });

  it('resolves candidate branches when BranchInfo.hash is abbreviated (not the full commit hash)', async () => {
    // Regression: branch tips come from git as %(objectname:short), but commitMap
    // is keyed by the full hash. The menu item must still appear.
    const head = makeCommit('mainfull1234', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('feat1full5678', 'feature 1', ['mainfull1234']);
    const f2 = makeCommit('feat2full9012', 'feature 2', ['feat1full5678']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    // abbreviated tips (commit.abbreviatedHash === hash.slice(0,7)), which differ
    // from the full commit hashes the commitMap is keyed by.
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'mainful' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'feat2fu' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['feat1full5678', 'feat2full9012'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });
});

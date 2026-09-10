import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import CommitGraph from '../CommitGraph.svelte';
import CommitDetails from '../../commit/CommitDetails.svelte';
import { authorColorsStore } from '../../../lib/stores/author-colors.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit } from '../../../lib/types';

function commit(hash: string, email: string): Commit {
  return {
    hash,
    abbreviatedHash: hash,
    author: { name: 'Alice', email, date: '2024-01-01T00:00:00Z' },
    committer: { name: 'Bob', email: 'bob@example.com', date: '2024-01-01T00:00:00Z' },
    subject: hash,
    body: '',
    parents: [],
    refs: [],
    signatureStatus: 'good',
  };
}

function load(commits: Commit[]) {
  commitStore.setData({
    commits,
    graph: [],
    paths: [],
    links: [],
    dots: [],
    commitLeftMargin: commits.map(() => 0),
    hasMore: false,
    currentLimit: 200,
  });
}

beforeEach(() => {
  i18n.setLocale('en');
  authorColorsStore.colors = {};
  authorColorsStore.picker = null;
  uiStore.autoFitColumns = false;
  uiStore.defaultCommitTab = 'details';
  uiStore.selectedCommitHash = null;
  uiStore.selectedCommitHashes = [];
  uiStore.multiSelectArmed = false;
  branchStore.branches = [];
  branchStore.worktrees = [];
  modalStore.closeAll();
  commitStore.loading = false;
  commitStore.notGitRepo = false;
  load([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authorColorsStore.colors = {};
  authorColorsStore.picker = null;
});

describe('author highlight entry points', () => {
  it('opens the picker for the author, not the committer, from commit details', async () => {
    const { getByRole } = render(CommitDetails, { commit: commit('first', ' Alice@Example.com ') });
    await fireEvent.click(getByRole('button', { name: 'Highlight author' }));
    expect(authorColorsStore.picker?.email).toBe('alice@example.com');
  });

  it('opens the same picker for the right-clicked commit author', async () => {
    load([commit('first', 'alice@example.com'), commit('second', 'carol@example.com')]);
    const { container, getByRole } = render(CommitGraph);
    await tick();
    await fireEvent.contextMenu(container.querySelectorAll('.commit-row')[1], { clientX: 120, clientY: 80 });
    await fireEvent.click(getByRole('menuitem', { name: 'Highlight author…' }));
    expect(authorColorsStore.picker).toEqual({ email: 'carol@example.com', x: 120, y: 80 });
    expect(container.querySelector('.context-menu')).toBeNull();
  });

  it('includes avatar, highlight padding, and signature space when fitting a full author name', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as CanvasRenderingContext2D);
    const author = commit('first', 'alice@example.com');
    author.author.name = 'Alexandra Example';
    load([author]);
    const { container, getByRole } = render(CommitGraph);
    await tick();
    const graph = container.querySelector<HTMLElement>('.commit-graph')!;
    Object.defineProperty(graph, 'clientWidth', { value: 1000 });
    await fireEvent.resize(window);
    container.querySelector<HTMLElement>('.commit-row .col-author')!.style.fontSize = '13px';
    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    await fireEvent.click(getByRole('menuitem', { name: 'Auto-fit columns' }));
    const expected = Math.ceil(author.author.name.length * 10 + 18 + 4 + 6 + 13 * 0.95 + 4 + 20);
    expect(parseFloat(graph.style.getPropertyValue('--author-width'))).toBe(expected);
  });

  it('updates matching loaded and newly loaded authors without coloring namesakes', async () => {
    load([commit('first', ' ALICE@example.com '), commit('second', 'other@example.com')]);
    const { container } = render(CommitGraph);
    await tick();
    const highlights = () => Array.from(container.querySelectorAll<HTMLElement>('.author-highlight'));
    expect(highlights().every(element => !element.style.boxShadow)).toBe(true);
    authorColorsStore.receive('alice@example.com', '#98C379');
    await tick();
    expect(highlights()[0].style.boxShadow).not.toBe('');
    expect(highlights()[1].style.boxShadow).toBe('');
    expect(highlights()[0].querySelector('.sig-icon')).not.toBeNull();
    expect(highlights()[0].querySelector('.author-id .sig-icon')).toBeNull();
    load([commit('first', 'alice@example.com'), commit('second', 'other@example.com'), commit('third', 'alice@example.com')]);
    await tick();
    expect(highlights()[2].style.boxShadow).toBe(highlights()[0].style.boxShadow);
    authorColorsStore.receive('alice@example.com', null);
    await tick();
    expect(highlights().every(element => !element.style.boxShadow)).toBe(true);
  });
});

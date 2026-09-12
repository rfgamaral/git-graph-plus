import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo, runGit, writeFile } from './helpers';

describe('GitService integration: cached pagination', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    repo.cleanup();
  });

  it('appends only the remaining raw commits and rebuilds stash and dirty rows', async () => {
    commit(repo.path, 'base', { 'a.txt': 'base\n' });
    runGit(repo.path, ['checkout', '-b', 'discarded']);
    const ancestor = commit(repo.path, 'stash ancestor');
    const stashBase = commit(repo.path, 'stash base');
    writeFile(repo.path, 'a.txt', 'stashed\n');
    runGit(repo.path, ['stash', 'push', '-m', 'saved work']);
    const stashHash = runGit(repo.path, ['rev-parse', 'refs/stash']).trim();
    runGit(repo.path, ['checkout', 'main']);
    runGit(repo.path, ['branch', '-D', 'discarded']);
    for (let i = 0; i < 5; i++) commit(repo.path, `main ${i}`);
    writeFile(repo.path, 'a.txt', 'dirty\n');

    const reachable = runGit(repo.path, ['rev-list', '--branches', '--tags']).trim().split('\n');
    expect(reachable).not.toContain(stashBase);
    expect(reachable).not.toContain(ancestor);

    const first = await svc.log({ limit: 7, loadMore: false, sortOrder: 'topological' });
    expect(first.some(c => c.hash === stashHash)).toBe(true);
    expect(first[0].hash).toBe('UNCOMMITTED');
    runGit(repo.path, ['add', 'a.txt']);
    writeFile(repo.path, 'untracked.txt', 'new\n');

    const exec = vi.spyOn(svc as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await svc.log({ limit: 8, loadMore: true, sortOrder: 'topological' });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--topo-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0]).toEqual(expect.arrayContaining(['--skip=7', '--max-count=1', stashBase]));
    const fresh = await new GitService(repo.path).log({ limit: 8, sortOrder: 'topological' });

    expect(paginated).toEqual(fresh);
    expect(paginated.filter(c => c.hash === 'UNCOMMITTED')).toHaveLength(1);
    expect(JSON.parse(paginated[0].body)).toEqual({ staged: 1, unstaged: 1 });
    expect(paginated.filter(c => c.hash === stashHash)).toHaveLength(1);
    expect(paginated.find(c => c.hash === stashHash)?.parents).toEqual([stashBase]);
    expect(paginated.map(c => c.hash)).toEqual(expect.arrayContaining([ancestor, stashBase]));
    expect(new Set(paginated.map(c => c.hash)).size).toBe(paginated.length);
  });

  it('restarts the walk when a ref changes between pages', async () => {
    for (let i = 0; i < 5; i++) commit(repo.path, `commit ${i}`);
    await svc.log({ limit: 2, loadMore: false });
    const tip = commit(repo.path, 'new tip');

    const exec = vi.spyOn(svc as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await svc.log({ limit: 4, loadMore: true });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--author-date-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0]).toContain('--max-count=4');
    expect(walks[0].some(arg => arg.startsWith('--skip='))).toBe(false);
    expect(paginated).toEqual(await new GitService(repo.path).log({ limit: 4 }));
    expect(paginated[0].hash).toBe(tip);
    expect(paginated.map(c => c.subject)).toEqual(['new tip', 'commit 4', 'commit 3', 'commit 2']);
  });

  it.each([
    { branches: ['main'] },
    { remoteFilter: ['local'] },
  ])('pages filtered history with an unborn HEAD: %j', async (filter) => {
    const hashes = Array.from({ length: 5 }, (_, i) => commit(repo.path, `commit ${i}`));
    runGit(repo.path, ['checkout', '--orphan', 'orphan']);

    const first = await svc.log({ ...filter, limit: 2, loadMore: false });
    expect(first.map(c => c.hash)).toEqual(hashes.slice(-2).reverse());

    const exec = vi.spyOn(svc as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await svc.log({ ...filter, limit: 4, loadMore: true });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--author-date-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0]).toEqual(expect.arrayContaining(['--skip=2', '--max-count=2']));
    expect(paginated).toEqual(await new GitService(repo.path).log({ ...filter, limit: 4 }));
    expect(paginated.map(c => c.hash)).toEqual(hashes.slice(-4).reverse());
  });

  it('restarts filtered pagination after the first commit on an orphan branch', async () => {
    for (let i = 0; i < 5; i++) commit(repo.path, `commit ${i}`);
    runGit(repo.path, ['checkout', '--orphan', 'orphan']);
    await svc.log({ remoteFilter: ['local'], limit: 2, loadMore: false });
    const tip = commit(repo.path, 'first orphan commit');

    const exec = vi.spyOn(svc as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await svc.log({ remoteFilter: ['local'], limit: 6, loadMore: true });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--author-date-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0]).toContain('--max-count=6');
    expect(walks[0].some(arg => arg.startsWith('--skip='))).toBe(false);
    expect(paginated).toEqual(await new GitService(repo.path).log({ remoteFilter: ['local'], limit: 6 }));
    expect(paginated.map(c => c.hash)).toContain(tip);
    expect(paginated).toHaveLength(6);
  });

  it.each([false, true])('restarts pagination when detached HEAD moves without ref changes, linked worktree: %s', async (linked) => {
    const hashes = Array.from({ length: 5 }, (_, i) => commit(repo.path, `commit ${i}`));
    const path = linked ? join(repo.path, 'linked') : repo.path;
    if (linked) {
      runGit(repo.path, ['worktree', 'add', '--detach', path, hashes[4]]);
    } else {
      runGit(path, ['checkout', '--detach', hashes[4]]);
    }
    const service = new GitService(path);
    const refs = runGit(path, ['show-ref']);
    await service.log({ limit: 2, loadMore: false });
    runGit(path, ['checkout', '--detach', hashes[3]]);
    expect(runGit(path, ['show-ref'])).toBe(refs);
    if (linked) expect(runGit(repo.path, ['rev-parse', 'HEAD']).trim()).toBe(hashes[4]);

    const exec = vi.spyOn(service as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await service.log({ limit: 4, loadMore: true });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--author-date-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0]).toContain('--max-count=4');
    expect(walks[0].some(arg => arg.startsWith('--skip='))).toBe(false);
    expect(paginated).toEqual(await new GitService(path).log({ limit: 4 }));
  });

  it.each(['other', '--detach'])('invalidates HEAD decorations when switching to %s at the same commit', async (target) => {
    for (let i = 0; i < 5; i++) commit(repo.path, `commit ${i}`);
    runGit(repo.path, ['branch', 'other']);
    await svc.log({ limit: 2, loadMore: false });
    runGit(repo.path, ['checkout', target]);
    const exec = vi.spyOn(svc as unknown as { exec(args: string[]): Promise<string> }, 'exec');
    const paginated = await svc.log({ limit: 4, loadMore: true });
    const walks = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log' && args.includes('--author-date-order'));
    expect(walks).toHaveLength(1);
    expect(walks[0].some(arg => arg.startsWith('--skip='))).toBe(false);
    expect(paginated).toEqual(await new GitService(repo.path).log({ limit: 4 }));
  });

  it('refreshes cached boundary parents after deepening without moving refs', async () => {
    const hashes = Array.from({ length: 6 }, (_, i) => commit(repo.path, `commit ${i}`));
    const clone = join(repo.path, 'shallow-clone');
    runGit(repo.path, ['clone', '--depth=2', pathToFileURL(repo.path).href, clone]);
    const shallowSvc = new GitService(clone);
    const refs = runGit(clone, ['show-ref']);
    const head = runGit(clone, ['rev-parse', 'HEAD']);
    const first = await shallowSvc.log({ limit: 2, loadMore: false });
    expect(first.map(c => c.hash)).toEqual([hashes[5], hashes[4]]);
    expect(first[1].parents).toEqual([]);

    runGit(clone, ['fetch', '--deepen=2', 'origin']);
    expect(runGit(clone, ['show-ref'])).toBe(refs);
    expect(runGit(clone, ['rev-parse', 'HEAD'])).toBe(head);
    const paginated = await shallowSvc.log({ limit: 4, loadMore: true });
    expect(paginated).toEqual(await new GitService(clone).log({ limit: 4 }));
    expect(paginated.map(c => c.hash)).toEqual(hashes.slice(2).reverse());
    expect(paginated.find(c => c.hash === hashes[4])?.parents).toEqual([hashes[3]]);
    expect(paginated[3].parents).toEqual([]);
  });
});

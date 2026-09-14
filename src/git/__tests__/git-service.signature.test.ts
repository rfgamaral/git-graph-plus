import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import * as childProcess from 'child_process';
import { GitService } from '../git-service';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({ readFile: vi.fn().mockResolvedValue('') }));
vi.mock('../../services/file-watcher-helpers', () => ({
  resolveGitDirs: () => ({ gitDir: '/tmp/repo/.git', commonDir: '/tmp/repo/.git' }),
}));

function fakeProc() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    stdout: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { destroy: vi.fn() }),
    kill: vi.fn(),
  });
}

function mockExec(service: GitService) {
  return vi.spyOn(service as unknown as {
    exec: (args: string[], options?: object) => Promise<string>;
  }, 'exec');
}

const spawnMock = vi.mocked(childProcess.spawn);
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('GitService signature isolation', () => {
  let service: GitService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawnMock.mockReset();
    vi.mocked(readFile).mockResolvedValue('');
    service = new GitService('/tmp/repo');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deduplicates verification and reuses the parsed result without another process', async () => {
    let finish!: (value: string) => void;
    const exec = mockExec(service).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = service.getCommitSignature('abc1234');
    const second = service.getCommitSignature('abc1234');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(service.getCachedCommitSignature('abc1234')).toBeUndefined();
    finish('G\x00 Alice \x00 KEY123 \n');
    const signature = { status: 'good', signer: 'Alice', keyId: 'KEY123' };
    await expect(first).resolves.toEqual(signature);
    await expect(second).resolves.toEqual(signature);
    expect(service.getCachedCommitSignature('abc1234')).toEqual(signature);
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual(signature);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      ['show', '--no-show-signature', '--no-patch', '--format=%G?%x00%GS%x00%GK', 'abc1234'],
      { silent: true, timeout: 5000, killProcessTree: true },
    );
  });

  it('expires cached signatures at sixty seconds and verifies again', async () => {
    const exec = mockExec(service).mockResolvedValue('G\x00\x00');
    await service.getCommitSignature('abc1234');
    vi.advanceTimersByTime(59999);
    expect(service.getCachedCommitSignature('abc1234')).toEqual({ status: 'good' });
    vi.advanceTimersByTime(1);
    expect(service.getCachedCommitSignature('abc1234')).toBeUndefined();
    exec.mockResolvedValue('B\x00\x00');
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual({ status: 'unverified' });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('keeps at most one thousand cached signatures and evicts the oldest', async () => {
    const exec = mockExec(service).mockResolvedValue('N\x00\x00');
    for (let i = 0; i < 1000; i++) await service.getCommitSignature(i.toString(16).padStart(40, '0'));
    const oldest = '0'.repeat(40);
    const second = '1'.padStart(40, '0');
    expect(service.getCachedCommitSignature(oldest)).toEqual({ status: 'none' });
    await service.getCommitSignature('f'.repeat(40));
    expect(service.getCachedCommitSignature(oldest)).toBeUndefined();
    expect(service.getCachedCommitSignature(second)).toEqual({ status: 'none' });
    expect(service.getCachedCommitSignature('f'.repeat(40))).toEqual({ status: 'none' });
    await service.getCommitSignature(oldest);
    expect(exec).toHaveBeenCalledTimes(1002);
    expect(service.getCachedCommitSignature(second)).toBeUndefined();
  });

  it('caches verification failure as unverified without invoking the warning callback', async () => {
    const warn = vi.fn();
    service.setWarningHandler(warn);
    const exec = mockExec(service).mockRejectedValue(new Error('verifier unavailable'));
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual({ status: 'unverified' });
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual({ status: 'unverified' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    exec.mockResolvedValue('G\x00\x00');
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual({ status: 'good' });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it.each(['', '?\x00\x00'])('treats unexpected signature output %j as unverified', async output => {
    mockExec(service).mockResolvedValue(output);
    await expect(service.getCommitSignature('abc1234')).resolves.toEqual({ status: 'unverified' });
  });

  it.each([5000, 250])('terminates the POSIX process group at the bounded timeout of %i ms', async timeout => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    service.setDefaultTimeout(timeout === 5000 ? 120000 : timeout);
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc as unknown as ReturnType<typeof childProcess.spawn>);
    const warn = vi.fn();
    service.setWarningHandler(warn);
    const result = service.getCommitSignature('abc1234');
    const settled = vi.fn();
    void result.then(settled);
    expect(spawnMock).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ detached: true }));
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ status: 'unverified' });
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(-proc.pid, 'SIGKILL');
    expect(proc.kill).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to killing the child if POSIX process-group termination fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    vi.mocked(process.kill).mockImplementation(() => { throw new Error('ESRCH'); });
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc as unknown as ReturnType<typeof childProcess.spawn>);
    const result = service.getCommitSignature('abc1234');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({ status: 'unverified' });
    expect(proc.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  });

  it.each(['success', 'error', 'exit failure'])('terminates the Windows process tree: %s', async outcome => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const proc = fakeProc();
    const taskkill = new EventEmitter();
    spawnMock
      .mockReturnValueOnce(proc as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(taskkill as ReturnType<typeof childProcess.spawn>);
    const result = service.getCommitSignature('abc1234');
    expect(spawnMock.mock.calls[0][2]).not.toHaveProperty('detached');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({ status: 'unverified' });
    expect(spawnMock).toHaveBeenNthCalledWith(2, 'taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    if (outcome === 'error') taskkill.emit('error', new Error('taskkill unavailable'));
    else taskkill.emit('exit', outcome === 'success' ? 0 : 1);
    if (outcome === 'success') expect(proc.kill).not.toHaveBeenCalled();
    else expect(proc.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('disables configured signature verification for the main log and both cache snapshots', async () => {
    const exec = mockExec(service).mockResolvedValue('');
    await service.log({ limit: 10, loadMore: false, showStashEntries: false });
    const logs = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'log');
    expect(logs).toHaveLength(1);
    const snapshots = exec.mock.calls.map(([args]) => args).filter(args => args[0] === 'rev-parse');
    expect(snapshots).toEqual([['rev-parse', '--revs-only', 'HEAD'], ['rev-parse', '--revs-only', 'HEAD']]);
    for (const args of logs) {
      expect(args).toContain('--no-show-signature');
      expect(args.join(' ')).not.toMatch(/%G[?SK]/);
    }
  });

  it('disables configured signature verification for stash listing and stash history', async () => {
    const exec = mockExec(service).mockImplementation(async args => {
      if (args[0] === 'stash') return 'stash@{0}\x00WIP\x002026-01-01\x00abcdef1\x00abcdef2';
      return '';
    });
    await service.log();
    const calls = exec.mock.calls.map(([args]) => args);
    const stashList = calls.find(args => args[0] === 'stash' && args[1] === 'list');
    const stashLog = calls.find(args => args[0] === 'log' && args.includes('--no-walk'));
    expect(stashList).toBeDefined();
    expect(stashLog).toBeDefined();
    for (const args of [stashList!, stashLog!]) {
      expect(args).toContain('--no-show-signature');
      expect(args.join(' ')).not.toMatch(/%G[?SK]/);
    }
    expect(stashLog).toContain('abcdef2');
  });
});

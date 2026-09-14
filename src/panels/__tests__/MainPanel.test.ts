import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MainPanel hosts the webview and routes ~80 message types to GitService. We
// can't run a real WebviewPanel, but with a vscode mock (panel + webview) and a
// controllable GitService we can capture the onDidReceiveMessage handler and
// assert the routing, refresh, sequence-guard, and error-handling behaviour.
const H = vi.hoisted(() => {
  const git: Record<string, ReturnType<typeof vi.fn>> = {
    log: vi.fn(async () => []),
    branches: vi.fn(async () => []),
    tags: vi.fn(async () => []),
    remotes: vi.fn(async () => []),
    stashList: vi.fn(async () => []),
    searchByHash: vi.fn(async () => null),
    worktreeList: vi.fn(async () => []),
    merge: vi.fn(async () => {}),
    revert: vi.fn(async () => {}),
    fastForwardRef: vi.fn(async () => {}),
    stashPop: vi.fn(async () => {}),
    showCommitDiff: vi.fn(async () => []),
    showCommitFiles: vi.fn(async () => []),
    resolveDiffBaseRef: vi.fn(async () => 'parentsha'),
    getEmptyTreeRef: vi.fn(async () => '4b825dc642cb6eb9a060e54bf8d69288fbee4904'),
    fileExistsAtRef: vi.fn(async () => true),
    getConflictFiles: vi.fn(async () => []),
    getOperationState: vi.fn(async () => ({ type: null })),
    getRemoteUrl: vi.fn(async () => ''),
    stashSave: vi.fn(async () => {}),
    checkout: vi.fn(async () => {}),
    pull: vi.fn(async () => {}),
    clean: vi.fn(async () => {}),
    setWarningHandler: vi.fn(),
    setAuthRetryHandler: vi.fn(),
    setExtraEnv: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  return {
    git,
    config: {} as Record<string, unknown>,
    updateConfig: vi.fn(),
    configHandler: null as null | ((e: { affectsConfiguration: (key: string) => boolean }) => void),
    messageHandler: null as null | ((m: unknown) => unknown),
    panel: null as null | { webview: { postMessage: ReturnType<typeof vi.fn> } },
    repos: [] as Array<{ path: string; name: string; type: string }>,
  };
});

vi.mock('vscode', () => {
  const makePanel = () => {
    const webview = {
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (u: unknown) => u,
      postMessage: vi.fn(),
      onDidReceiveMessage: (cb: (m: unknown) => unknown) => { H.messageHandler = cb; return { dispose() {} }; },
    };
    const panel = {
      webview,
      onDidDispose: () => ({ dispose() {} }),
      reveal: vi.fn(),
      dispose: vi.fn(),
      iconPath: undefined as unknown,
      viewColumn: 1,
    };
    H.panel = panel;
    return panel;
  };
  return {
    window: {
      createWebviewPanel: vi.fn(makePanel),
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(async () => undefined),
      showSaveDialog: vi.fn(async () => undefined),
      showTextDocument: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string, fallback?: unknown) => H.config[key] ?? fallback,
        update: H.updateConfig,
      }),
      getWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }),
      workspaceFolders: [{ uri: { fsPath: '/repo' } }],
      onDidChangeConfiguration: (cb: NonNullable<typeof H.configHandler>) => { H.configHandler = cb; return { dispose() {} }; },
      fs: { writeFile: vi.fn(async () => {}) },
    },
    commands: { executeCommand: vi.fn() },
    l10n: { t: (message: string, ...args: Array<string | number | boolean>) => message.replace(/\{(\d+)\}/g, (placeholder, index) => args[Number(index)] === undefined ? placeholder : String(args[Number(index)])) },
    env: { language: 'en', clipboard: { writeText: vi.fn() } },
    Uri: {
      joinPath: () => ({}),
      file: (p: string) => ({ fsPath: p, with(o: object) { return { ...this, ...o }; } }),
      parse: () => ({ with: () => ({}) }),
    },
    ViewColumn: { One: 1 },
    ConfigurationTarget: { Global: 1 },
  };
});

vi.mock('../../git/git-service', async (orig) => {
  const actual = await orig<typeof import('../../git/git-service')>();
  return { ...actual, GitService: vi.fn(() => H.git) };
});
vi.mock('../../services/file-watcher', () => ({ FileWatcher: class { enabled = true; suppress() {} dispose() {} } }));
vi.mock('../../services/repo-discovery', () => ({ RepoDiscoveryService: { discoverRepos: vi.fn(async () => H.repos), clearCache: vi.fn() } }));
vi.mock('../../git/vscode-git-bridge', () => ({ triggerVSCodeGitAuth: vi.fn(async () => false), openVSCodeGitConflict: vi.fn() }));

import { MainPanel } from '../MainPanel';
import { GitError, GitService } from '../../git/git-service';
import { window } from 'vscode';
import { openVSCodeGitConflict } from '../../git/vscode-git-bridge';

const extUri = { fsPath: '/ext' } as unknown as import('vscode').Uri;

function posted() {
  return (H.panel!.webview.postMessage.mock.calls.map(c => c[0])) as Array<{ type: string; payload?: Record<string, unknown> }>;
}
function postedOfType(type: string) {
  return posted().filter(m => m.type === type);
}
async function dispatch(msg: unknown) {
  await H.messageHandler!(msg);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openVSCodeGitConflict).mockReset().mockResolvedValue(false);
  vi.mocked(window.showTextDocument).mockReset();
  H.config = {};
  H.configHandler = null;
  H.updateConfig.mockReset().mockImplementation(async (key: string, value: unknown) => { H.config[key] = value; });
  // Reset default git behaviour after clearAllMocks wiped implementations.
  for (const k of Object.keys(H.git)) H.git[k].mockReset();
  H.git.log.mockResolvedValue([]);
  H.git.branches.mockResolvedValue([]);
  H.git.tags.mockResolvedValue([]);
  H.git.remotes.mockResolvedValue([]);
  H.git.stashList.mockResolvedValue([]);
  H.git.worktreeList.mockResolvedValue([]);
  H.git.getOperationState.mockResolvedValue({ type: null });
  H.git.getConflictFiles.mockResolvedValue([]);
  H.git.getRemoteUrl.mockResolvedValue('');
  H.git.showCommitDiff.mockResolvedValue([]);
  H.git.fileExistsAtRef.mockResolvedValue(true);
  H.git.getEmptyTreeRef.mockResolvedValue('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  H.repos = [{ path: '/repo', name: 'repo', type: 'root' }];
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
  MainPanel.createOrShow(extUri, '/repo');
});

afterEach(() => {
  (MainPanel.currentPanel as unknown as { dispose?: () => void } | undefined)?.dispose?.();
  (MainPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
});

const commit = (hash: string) => ({
  hash, abbreviatedHash: hash.slice(0, 7), subject: 's', body: '', parents: [], refs: [],
  author: { name: '', email: '', date: '' }, committer: { name: '', email: '', date: '' },
});

describe('MainPanel conflict opening', () => {
  it('delegates the validated file to native Git without opening a second editor', async () => {
    vi.mocked(openVSCodeGitConflict).mockResolvedValue(true);
    await dispatch({ type: 'openConflictFile', payload: { file: 'dir/file.txt' } });
    expect(openVSCodeGitConflict).toHaveBeenCalledWith('/repo', expect.objectContaining({ fsPath: '/repo/dir/file.txt' }));
    expect(window.showTextDocument).not.toHaveBeenCalled();
  });

  it.each([false, true])('opens the working file when native Git cannot open it (throws: %s)', async (throws) => {
    if (throws) vi.mocked(openVSCodeGitConflict).mockRejectedValue(new Error('native unavailable'));
    await dispatch({ type: 'openConflictFile', payload: { file: 'file.txt' } });
    expect(window.showTextDocument).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fsPath: '/repo/file.txt' }));
    expect(postedOfType('error')).toHaveLength(0);
  });

  it('reports a failed working-file fallback instead of silently doing nothing', async () => {
    vi.mocked(window.showTextDocument).mockRejectedValue(new Error('File not found'));
    await dispatch({ type: 'openConflictFile', payload: { file: 'missing.txt' } });
    expect(postedOfType('error')).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ message: expect.stringContaining('File not found') }),
    })]);
  });

  it('rejects paths outside the repository before attempting to open an editor', async () => {
    await dispatch({ type: 'openConflictFile', payload: { file: '../outside.txt' } });
    expect(openVSCodeGitConflict).not.toHaveBeenCalled();
    expect(window.showTextDocument).not.toHaveBeenCalled();
    expect(postedOfType('error')).toHaveLength(1);
  });
});

describe('MainPanel revert', () => {
  it.each([1, 2])('forwards mainline parent %i and noCommit', async (mainline) => {
    await dispatch({ type: 'revert', payload: { commit: 'merge-sha', mainline, noCommit: true } });
    expect(H.git.revert).toHaveBeenCalledWith('merge-sha', { mainline, noCommit: true });
  });
});

describe('MainPanel construction', () => {
  it('creates a webview panel and sends settings only when requested', async () => {
    expect(H.panel).not.toBeNull();
    expect(H.panel!.webview).toBeDefined();
    expect(postedOfType('setLocale')).toHaveLength(0);
    await dispatch({ type: 'getSettings' });
    expect(postedOfType('setLocale')).toHaveLength(1);
  });
});

describe('MainPanel startup settings', () => {
  it('delivers configured dates and the other initial settings after the request', async () => {
    H.config['dateTimeFormat'] = 'R HH:mm:ss';
    H.config['relativeDateFallbackFormat'] = 'D MMM YYYY';
    expect(postedOfType('setDateTimeFormat')).toHaveLength(0);
    await dispatch({ type: 'getSettings' });
    expect(postedOfType('setDateTimeFormat')).toEqual([{
      type: 'setDateTimeFormat',
      payload: { format: 'R HH:mm:ss', relativeDateFallbackFormat: 'D MMM YYYY' },
    }]);
    expect(posted().map(m => m.type)).toEqual(expect.arrayContaining([
      'setLocale', 'setDefaults', 'setBadgeBarThickness', 'setGraphColors',
      'setGraphLaneSpacing', 'setLoadMoreCount', 'setInteractiveRebaseMode',
      'setAlwaysShowCommitDetails', 'setCommitDetailsPosition', 'setDefaultCommitTab',
      'setCommitLinkRules',
    ]));
  });

  it('reads current dates on another request and retains live updates', async () => {
    await dispatch({ type: 'getSettings' });
    H.config['dateTimeFormat'] = 'R HH:mm';
    H.config['relativeDateFallbackFormat'] = 'D MMM YYYY';
    await dispatch({ type: 'getSettings' });
    expect(postedOfType('setDateTimeFormat').at(-1)?.payload).toEqual({
      format: 'R HH:mm', relativeDateFallbackFormat: 'D MMM YYYY',
    });
    H.config['relativeDateFallbackFormat'] = 'YYYY-MM-DD';
    H.configHandler!({ affectsConfiguration: key => key === 'gitGraphPlus.relativeDateFallbackFormat' });
    expect(postedOfType('setDateTimeFormat').at(-1)?.payload).toEqual({
      format: 'R HH:mm', relativeDateFallbackFormat: 'YYYY-MM-DD',
    });
  });
});

describe('MainPanel native restoration', () => {
  afterEach(() => {
    MainPanel.onRepoChange = null;
  });

  it('revives the supplied panel with options, icon, HTML, and message routing without creating another', async () => {
    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    H.repos = [{ path: '/saved/repo', name: 'repo', type: 'root' }];
    const panel = vi.mocked(window.createWebviewPanel).getMockImplementation()!(
      MainPanel.viewType, 'Git Graph+', 1, {},
    );
    vi.mocked(window.createWebviewPanel).mockClear();
    vi.mocked(GitService).mockClear();
    MainPanel.onRepoChange = vi.fn();

    H.config['dateTimeFormat'] = 'R HH:mm:ss';
    H.config['relativeDateFallbackFormat'] = 'D MMM YYYY';
    MainPanel.revive(panel, extUri, '/saved/repo');

    expect(window.createWebviewPanel).not.toHaveBeenCalled();
    expect(GitService).toHaveBeenCalledExactlyOnceWith('/saved/repo');
    expect(MainPanel.currentPanel).toBeDefined();
    expect(MainPanel.onRepoChange).toHaveBeenCalledExactlyOnceWith('/saved/repo');
    expect(panel.webview.options).toEqual({ enableScripts: true, localResourceRoots: [{}, {}] });
    expect(panel.iconPath).toEqual({ light: {}, dark: {} });
    expect(panel.webview.html).not.toBe('');
    expect(postedOfType('setLocale')).toHaveLength(0);
    await dispatch({ type: 'getSettings' });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'setLocale' }));
    expect(postedOfType('setDateTimeFormat').at(-1)?.payload).toEqual({
      format: 'R HH:mm:ss', relativeDateFallbackFormat: 'D MMM YYYY',
    });
    expect(panel.dispose).not.toHaveBeenCalled();

    await dispatch({ type: 'getLog', payload: {} });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'logData' }));
    MainPanel.createOrShow(extUri, '/saved/repo');
    expect(panel.reveal).toHaveBeenCalledWith(1);
    expect(window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it('disposes a duplicate restored panel without replacing the active panel', () => {
    const current = MainPanel.currentPanel;
    const activePanel = H.panel!;
    const panel = { dispose: vi.fn() } as unknown as import('vscode').WebviewPanel;
    MainPanel.onRepoChange = vi.fn();
    vi.mocked(window.createWebviewPanel).mockClear();
    vi.mocked(GitService).mockClear();

    MainPanel.revive(panel, extUri, '/saved/repo');

    expect(panel.dispose).toHaveBeenCalledOnce();
    expect(MainPanel.currentPanel).toBe(current);
    expect(GitService).not.toHaveBeenCalled();
    expect(MainPanel.onRepoChange).not.toHaveBeenCalled();
    expect(window.createWebviewPanel).not.toHaveBeenCalled();
    expect((activePanel as unknown as import('vscode').WebviewPanel).dispose).not.toHaveBeenCalled();
  });
});

describe('MainPanel commit details settings', () => {
  it('posts bottom position and disabled always-visible mode by default', async () => {
    await dispatch({ type: 'getSettings' });
    expect(postedOfType('setCommitDetailsPosition').at(-1)?.payload).toEqual({ position: 'bottom' });
    expect(postedOfType('setAlwaysShowCommitDetails').at(-1)?.payload).toEqual({ enabled: false });
  });

  it('forwards live changes to both commit details settings', () => {
    H.config.commitDetailsPosition = 'right';
    H.config.alwaysShowCommitDetails = true;
    H.configHandler!({ affectsConfiguration: key => [
      'gitGraphPlus.commitDetailsPosition', 'gitGraphPlus.alwaysShowCommitDetails',
    ].includes(key) });
    expect(postedOfType('setCommitDetailsPosition').at(-1)?.payload).toEqual({ position: 'right' });
    expect(postedOfType('setAlwaysShowCommitDetails').at(-1)?.payload).toEqual({ enabled: true });
  });

  it('persists layout requests at user scope and rejects invalid positions', async () => {
    const vscode = await import('vscode');
    for (const position of ['right', 'bottom']) {
      await dispatch({ type: 'setCommitDetailsPosition', payload: { position } });
      expect(H.updateConfig).toHaveBeenLastCalledWith('commitDetailsPosition', position, vscode.ConfigurationTarget.Global);
      expect(postedOfType('setCommitDetailsPosition').at(-1)?.payload).toEqual({ position });
    }
    H.panel!.webview.postMessage.mockClear();
    await dispatch({ type: 'setCommitDetailsPosition', payload: { position: 'left' } });
    expect(H.updateConfig).toHaveBeenCalledTimes(2);
    expect(postedOfType('setCommitDetailsPosition')).toEqual([]);
  });
});

describe('MainPanel message routing', () => {
  it('getLog fetches log + branches and posts logData', async () => {
    H.git.log.mockResolvedValue([commit('aaaaaaa1'), commit('bbbbbbb2')]);
    await dispatch({ type: 'getLog', payload: {} });
    expect(H.git.log).toHaveBeenCalled();
    expect(H.git.branches).toHaveBeenCalled();
    const data = postedOfType('logData').at(-1)!;
    expect((data.payload!.commits as unknown[]).length).toBe(2);
    expect(data.payload!.hasMore).toBe(false);
  });

  it('getLog reports hasMore and trims to the requested limit', async () => {
    // Requesting limit 1 fetches limit+1; returning 2 means "there is more".
    H.git.log.mockResolvedValue([commit('a1'), commit('b2')]);
    await dispatch({ type: 'getLog', payload: { limit: 1 } });
    const data = postedOfType('logData').at(-1)!;
    expect(data.payload!.hasMore).toBe(true);
    expect((data.payload!.commits as unknown[]).length).toBe(1);
  });

  it('openDiff for a commit builds the left URI from the resolved parent SHA, not the ~1 shorthand', async () => {
    const vscode = await import('vscode');
    H.git.resolveDiffBaseRef.mockResolvedValue('1111111111111111111111111111111111111111');

    await dispatch({ type: 'openDiff', payload: { file: 'doc.md', commitHash: '2222222' } });

    expect(H.git.resolveDiffBaseRef).toHaveBeenCalledWith('2222222');
    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftUri = diffCall[1] as { query: string };
    const leftRef = JSON.parse(leftUri.query).ref;
    expect(leftRef).toBe('1111111111111111111111111111111111111111');
    expect(leftRef).not.toContain('~1');
  });

  it('openDiff for a new staged file diffs the empty tree against the index (HEAD has no such file)', async () => {
    const vscode = await import('vscode');
    // HEAD lacks the new file, the index has it.
    H.git.fileExistsAtRef.mockImplementation(async (ref: string) => ref !== 'HEAD');

    await dispatch({ type: 'openDiff', payload: { file: 'added.txt', staged: true } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    const rightRef = JSON.parse((diffCall[2] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree
    expect(rightRef).toBe(''); // index
  });

  it('openDiff for a new untracked file diffs the empty tree as the base (index has no such file)', async () => {
    const vscode = await import('vscode');
    // The file is absent from the index (untracked).
    H.git.fileExistsAtRef.mockResolvedValue(false);

    await dispatch({ type: 'openDiff', payload: { file: 'untracked.txt', staged: false } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree base
  });

  it('openDiff for a file added in a commit diffs the empty tree against the commit (parent lacks it)', async () => {
    const vscode = await import('vscode');
    H.git.resolveDiffBaseRef.mockResolvedValue('1111111111111111111111111111111111111111');
    // The file exists at the commit but not at its parent (it was added there).
    H.git.fileExistsAtRef.mockImplementation(async (ref: string) => ref === '2222222');

    await dispatch({ type: 'openDiff', payload: { file: 'rebase-demo.txt', commitHash: '2222222' } });

    const diffCall = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'vscode.diff')!;
    expect(diffCall).toBeDefined();
    const leftRef = JSON.parse((diffCall[1] as { query: string }).query).ref;
    const rightRef = JSON.parse((diffCall[2] as { query: string }).query).ref;
    expect(leftRef).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904'); // empty tree (parent has no file)
    expect(rightRef).toBe('2222222');
  });

  it('revealInExplorer resolves the repo path and runs revealFileInOS', async () => {
    const vscode = await import('vscode');

    await dispatch({ type: 'revealInExplorer', payload: { file: 'src/app.ts' } });

    const call = (vscode.commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls
      .find(c => c[0] === 'revealFileInOS')!;
    expect(call).toBeDefined();
    expect((call[1] as { fsPath: string }).fsPath).toBe('/repo/src/app.ts');
  });

  it('copyFilePath copies the absolute path to the clipboard', async () => {
    const vscode = await import('vscode');

    await dispatch({ type: 'copyFilePath', payload: { file: 'src/app.ts' } });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/repo/src/app.ts');
    expect(postedOfType('operationComplete').some(m => m.payload?.operation === 'copied')).toBe(true);
  });

  it('getBranches posts branchData with all the sidebar collections', async () => {
    await dispatch({ type: 'getBranches' });
    const data = postedOfType('branchData').at(-1)!;
    expect(data.payload).toHaveProperty('branches');
    expect(data.payload).toHaveProperty('tags');
    expect(data.payload).toHaveProperty('worktrees');
  });

  it('getCommitDiff posts the file list for the commit', async () => {
    H.git.showCommitFiles.mockResolvedValue([{ path: 'a.ts', status: 'M' }]);
    await dispatch({ type: 'getCommitDiff', payload: { hash: 'h1' } });
    expect(H.git.showCommitFiles).toHaveBeenCalledWith('h1');
    const data = postedOfType('commitDiffData').at(-1)!;
    expect(data.payload!.hash).toBe('h1');
  });

  it('merge calls GitService.merge then refreshes the whole view', async () => {
    await dispatch({ type: 'merge', payload: { branch: 'feature' } });
    expect(H.git.merge).toHaveBeenCalledWith('feature', expect.anything());
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
    expect(postedOfType('fullRefresh').length).toBeGreaterThan(0);
  });

  it('checkout with stash stashes before checking out', async () => {
    await dispatch({ type: 'checkout', payload: { ref: 'main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', expect.anything());
  });

  it('rejects switchRepo to a path outside the discovered repo list', async () => {
    await new Promise(r => setTimeout(r, 0)); // let sendRepoList populate cachedRepos
    await dispatch({ type: 'switchRepo', payload: { path: '/somewhere/else' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });
});

describe('MainPanel error handling', () => {
  it('posts notGitRepo when git reports "not a git repository"', async () => {
    H.git.log.mockRejectedValue(new GitError('fatal: not a git repository', 128, ['log']));
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('notGitRepo').length).toBeGreaterThan(0);
  });

  it('surfaces a plain error when a mutation fails without a conflict', async () => {
    H.git.merge.mockRejectedValue(new GitError('fatal: some failure', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue([]);
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    expect(postedOfType('error').length).toBeGreaterThan(0);
  });

  it('includes the branch and original error in a failed publication message', async () => {
    H.git.createBranch = vi.fn(async () => {});
    H.git.publishBranch = vi.fn(async () => { throw new Error('remote rejected $&'); });
    await dispatch({ type: 'createBranch', payload: { name: 'feature/test', publish: true } });
    expect(postedOfType('error').at(-1)?.payload?.message).toBe("Branch created, but publishing 'feature/test' failed: remote rejected $&");
    expect(window.showInformationMessage).toHaveBeenCalledWith("Branch 'feature/test' created");
  });

  it('preserves the failure reason in a follow-up push error', async () => {
    H.git.pushCurrentBranch = vi.fn(async () => { throw new Error('permission denied'); });
    await dispatch({ type: 'merge', payload: { branch: 'feature/test', pushAfter: true } });
    expect(postedOfType('error').at(-1)?.payload?.message).toBe('Merge succeeded, but the follow-up push failed: permission denied');
    expect(window.showInformationMessage).toHaveBeenCalledWith("Merged 'feature/test'");
  });

  it('posts conflictData when a failing mutation leaves conflicted files', async () => {
    H.git.merge.mockRejectedValue(new GitError('CONFLICT', 1, ['merge']));
    H.git.getConflictFiles.mockResolvedValue(['a.ts']);
    H.git.getOperationState.mockResolvedValue({ type: 'merge' });
    await dispatch({ type: 'merge', payload: { branch: 'x' } });
    const data = postedOfType('conflictData').at(-1)!;
    expect(data.payload!.operation).toBe('merge');
    expect((data.payload!.files as unknown[]).length).toBe(1);
  });
});

// These cover the non-trivial orchestration the simpler route+post+refresh
// cases don't: stash/pop recovery, no-op detection, and the stale-response
// sequence guard. The rest of the ~80 message cases mirror `merge` and aren't
// worth duplicating.
describe('MainPanel orchestration logic', () => {
  it.each([false, true])('uses a readable stash notification with drop=%s', async (drop) => {
    H.git.stashApply = vi.fn(async () => {});
    await dispatch({ type: 'stashApply', payload: { index: 0, drop } });
    expect(window.showInformationMessage).toHaveBeenCalledWith(drop ? 'Stash popped' : 'Stash applied');
  });

  it('formats nested commit counts in success notifications', async () => {
    H.git.cherryPick = vi.fn(async () => {});
    await dispatch({ type: 'cherryPick', payload: { commits: ['abc1234', 'def5678'] } });
    expect(window.showInformationMessage).toHaveBeenCalledWith('Cherry-picked 2 commits');
  });

  it('fastForward (checkout path) stashes, checks out, ff-merges, then pops', async () => {
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.checkout).toHaveBeenCalledWith('main', {});
    expect(H.git.merge).toHaveBeenCalledWith('origin/main', { ffOnly: true });
    expect(H.git.stashPop).toHaveBeenCalledWith(0);
    expect(postedOfType('operationComplete').length).toBeGreaterThan(0);
  });

  it('fastForward surfaces an error when the post-merge stash pop fails', async () => {
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'fastForward', payload: { local: 'main', remote: 'origin/main', stash: true } });
    const err = postedOfType('error').at(-1)!;
    expect(err.payload!.message).toBe("Fast-forward succeeded, but failed to restore stashed changes. Use 'git stash pop' manually.");
  });

  it('pull with stash pops afterwards and surfaces a failed pop', async () => {
    H.git.pull = vi.fn(async () => '');
    H.git.stashPop.mockRejectedValueOnce(new Error('pop conflict'));
    await dispatch({ type: 'pull', payload: { stash: true } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(H.git.pull).toHaveBeenCalled();
    expect(postedOfType('error').at(-1)!.payload!.message).toBe("Pull succeeded, but failed to restore stashed changes. Use 'git stash pop' manually.");
  });

  it('stashSave reports "no changes" when the stash count does not grow', async () => {
    H.git.stashList.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // before == after
    await dispatch({ type: 'stashSave', payload: {} });
    expect(postedOfType('error').at(-1)!.payload!.message).toBe('No local changes to stash');
  });

  it('stashSave confirms success when a new stash entry appears', async () => {
    H.git.stashList
      .mockResolvedValueOnce([])                    // before
      .mockResolvedValueOnce([{ index: 0 }] as never); // after
    await dispatch({ type: 'stashSave', payload: { message: 'wip' } });
    expect(H.git.stashSave).toHaveBeenCalled();
    expect(postedOfType('operationComplete').some(m => m.payload!.operation === 'stashSave')).toBe(true);
  });

  it('drops a stale file-diff response so a slower earlier request cannot clobber a newer one', async () => {
    let resolveFirst!: (v: unknown) => void;
    H.git.showCommitDiff
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r as (v: unknown) => void; }))
      .mockResolvedValueOnce([{ file: 'b.ts', hunks: [] }] as never);

    const p1 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'a.ts' } });
    const p2 = dispatch({ type: 'getFileDiff', payload: { hash: 'h', file: 'b.ts' } });
    await p2; // newest request resolves and is delivered
    resolveFirst([{ file: 'a.ts', hunks: [] }]); // older request resolves late
    await p1;

    const diffs = postedOfType('fileDiffData');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].payload!.file).toBe('b.ts');
  });

  it('discards a stale getLog from the previous repo after switching repos', async () => {
    // Two repos so the switchRepo allow-list check passes.
    H.repos = [
      { path: '/repo', name: 'repo', type: 'root' },
      { path: '/repo-b', name: 'repo-b', type: 'nested' },
    ];
    await dispatch({ type: 'getRepoList' }); // populate cachedRepos

    // First getLog (against the old repo) is held in-flight; later log() calls
    // (the switch's refreshAll + the new repo's getLog) return the new commits.
    let resolveOld!: (v: unknown) => void;
    H.git.log
      .mockImplementationOnce(() => new Promise(r => { resolveOld = r as (v: unknown) => void; }))
      .mockResolvedValue([commit('bbbbbbb2')] as never);

    const pOld = dispatch({ type: 'getLog', payload: {} }); // old repo, in-flight

    // Switching must not reset the sequence counter, or the next getLog reuses
    // the same seq number and the stale in-flight response sneaks past the guard.
    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    await dispatch({ type: 'getLog', payload: {} }); // new repo

    // The old repo's log resolves late with its (foreign) commits.
    resolveOld([commit('aaaaaaa1')]);
    await pOld;

    const logs = postedOfType('logData');
    const lastCommits = logs.at(-1)!.payload!.commits as Array<{ hash: string }>;
    expect(lastCommits.map(c => c.hash)).toEqual(['bbbbbbb2']);
    // The foreign commit from the old repo must never reach the webview.
    expect(logs.some(l => (l.payload!.commits as Array<{ hash: string }>).some(c => c.hash === 'aaaaaaa1'))).toBe(false);
  });
});

describe('MainPanel log filters', () => {
  let values: Map<string, unknown>;

  beforeEach(() => {
    values = new Map();
    MainPanel.setGlobalState({
      keys: () => [...values.keys()],
      get: <T>(key: string, fallback?: T) => values.has(key) ? values.get(key) as T : fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) values.delete(key);
        else values.set(key, value);
      },
    } as import('vscode').Memento);
    H.git.branches.mockResolvedValue([
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'a' },
      { name: 'origin/main', remote: 'origin', current: false, ahead: 0, behind: 0, hash: 'a' },
    ]);
    H.git.remotes.mockResolvedValue([{ name: 'origin', fetchUrl: '', pushUrl: '' }]);
  });

  afterEach(() => values.clear());

  it('saves before the log completes and restores filters after reopening', async () => {
    const filters = { remoteFilter: ['local'], branches: ['main'] };
    let finishLog!: (commits: unknown[]) => void;
    H.git.log.mockImplementationOnce(() => new Promise(resolve => { finishLog = resolve; }));
    const request = dispatch({ type: 'getLog', payload: filters });
    expect(values.get('logFilters:/repo')).toEqual(filters);
    finishLog([]);
    await request;

    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    values = new Map(JSON.parse(JSON.stringify([...values])));
    MainPanel.createOrShow(extUri, '/repo');
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('logData').at(-1)?.payload).toMatchObject(filters);

    await dispatch({ type: 'getLog', payload: { limit: 2000 } });
    expect(H.git.log.mock.calls.at(-1)?.[0]).toMatchObject(filters);
    expect(values.get('logFilters:/repo')).toEqual(filters);
  });

  it('restores each repository independently and ignores requests from the previous one', async () => {
    const local = { remoteFilter: ['local'], branches: ['main'] };
    const remote = { remoteFilter: ['origin'], branches: ['origin/main'] };
    H.repos.push({ path: '/repo-b', name: 'repo-b', type: 'root' });
    await dispatch({ type: 'getRepoList' });
    await dispatch({ type: 'getLog', payload: local });
    values.set('logFilters:/repo-b', remote);

    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    expect(postedOfType('fullRefresh').at(-1)?.payload?.logData).toMatchObject(remote);
    const calls = H.git.log.mock.calls.length;
    await dispatch({ type: 'getLog', payload: { repo: '/repo', remoteFilter: [], branches: [] } });
    expect(H.git.log).toHaveBeenCalledTimes(calls);
    expect(values.get('logFilters:/repo-b')).toEqual(remote);

    await dispatch({ type: 'switchRepo', payload: { path: '/repo' } });
    expect(postedOfType('fullRefresh').at(-1)?.payload?.logData).toMatchObject(local);
  });

  it('applies saved filters to a refresh before the first getLog', async () => {
    const filters = { remoteFilter: ['origin'], branches: ['origin/main'] };
    values.set('logFilters:/repo', filters);
    await (MainPanel.currentPanel as unknown as { refreshAll(): Promise<void> }).refreshAll();
    expect(H.git.log.mock.calls.at(-1)?.[0]).toMatchObject(filters);
    expect(postedOfType('fullRefresh').at(-1)?.payload?.logData).toMatchObject(filters);
  });

  it.each([
    { remoteFilter: ['origin', 'gone'], branches: ['origin/main', 'deleted'], expected: { remoteFilter: ['origin'], branches: ['origin/main'] } },
    { remoteFilter: ['gone'], branches: ['deleted'], expected: { remoteFilter: [], branches: [] } },
  ])('drops missing selections from $remoteFilter and $branches', async ({ remoteFilter, branches, expected }) => {
    values.set('logFilters:/repo', { remoteFilter, branches });
    await dispatch({ type: 'getLog', payload: {} });
    expect(H.git.log.mock.calls.at(-1)?.[0]).toMatchObject(expected);
    expect(postedOfType('logData').at(-1)?.payload).toMatchObject(expected);
    expect(values.get('logFilters:/repo')).toEqual(expected.branches.length ? expected : undefined);
  });

  it('keeps an explicit clear after reopening', async () => {
    values.set('logFilters:/repo', { remoteFilter: ['local'], branches: ['main'] });
    await dispatch({ type: 'getLog', payload: { remoteFilter: [], branches: [] } });
    expect(values.has('logFilters:/repo')).toBe(false);
    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    MainPanel.createOrShow(extUri, '/repo');
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('logData').at(-1)?.payload).toMatchObject({ remoteFilter: [], branches: [] });
  });
});

describe('MainPanel graph view options', () => {
  let values: Map<string, unknown>;
  let update: ReturnType<typeof vi.fn>;
  const defaults = { showTagLabels: true, showStashEntries: true, showLostCommits: false };

  beforeEach(() => {
    values = new Map();
    update = vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    });
    MainPanel.setGlobalState({
      keys: () => [...values.keys()],
      get: <T>(key: string, fallback?: T) => values.has(key) ? values.get(key) as T : fallback,
      update,
    } as import('vscode').Memento);
  });

  afterEach(() => values.clear());

  it.each([
    { saved: undefined, expected: defaults },
    { saved: { showTagLabels: false, showStashEntries: false }, expected: { ...defaults, showTagLabels: false, showStashEntries: false } },
    { saved: { showLostCommits: 'true' }, expected: defaults },
  ])('defaults lost commits to false while restoring existing preferences %#', async ({ saved, expected }) => {
    values.set('graphViewOptions:/repo', saved);
    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    MainPanel.createOrShow(extUri, '/repo');
    await dispatch({ type: 'getRepoList' });
    await dispatch({ type: 'getLog', payload: {} });

    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(expected);
    expect(H.git.log).toHaveBeenLastCalledWith(expect.objectContaining({
      showStashEntries: expected.showStashEntries, showLostCommits: false,
    }));
  });

  it('persists and restores lost commits independently for each repository and after reopening', async () => {
    const enabled = { ...defaults, showLostCommits: true };
    H.repos.push({ path: '/repo-b', name: 'repo-b', type: 'root' });
    await dispatch({ type: 'getRepoList' });
    await dispatch({ type: 'saveGraphViewOptions', payload: { repo: '/repo', ...enabled } });
    expect(values.get('graphViewOptions:/repo')).toEqual(enabled);

    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(defaults);
    expect(H.git.log).toHaveBeenLastCalledWith(expect.objectContaining({ showLostCommits: false }));
    await dispatch({ type: 'saveGraphViewOptions', payload: { repo: '/repo-b', ...defaults } });
    expect(values.get('graphViewOptions:/repo-b')).toEqual(defaults);

    await dispatch({ type: 'switchRepo', payload: { path: '/repo' } });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(enabled);
    expect(H.git.log).toHaveBeenLastCalledWith(expect.objectContaining({ showLostCommits: true }));
    expect(values.get('graphViewOptions:/repo-b')).toEqual(defaults);

    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    values = new Map(JSON.parse(JSON.stringify([...values])));
    MainPanel.createOrShow(extUri, '/repo');
    await dispatch({ type: 'getRepoList' });
    await dispatch({ type: 'getLog', payload: {} });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(enabled);
    expect(H.git.log).toHaveBeenLastCalledWith(expect.objectContaining({ showLostCommits: true }));
  });

  it('reloads the current limit when lost commits change, but not when saving unchanged options', async () => {
    await dispatch({ type: 'getLog', payload: { limit: 500 } });
    for (const showLostCommits of [true, false]) {
      H.git.log.mockClear();
      H.panel!.webview.postMessage.mockClear();
      const payload = { repo: '/repo', ...defaults, showLostCommits };
      await dispatch({ type: 'saveGraphViewOptions', payload });
      expect(H.git.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ limit: 501, showLostCommits }));
      expect(postedOfType('logData')).toHaveLength(1);
      expect(postedOfType('logData')[0].payload?.currentLimit).toBe(500);

      await dispatch({ type: 'saveGraphViewOptions', payload });
      expect(H.git.log).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['status', 'full'] as const)('passes the saved lost commits option through a %s refresh', async (scope) => {
    await dispatch({ type: 'saveGraphViewOptions', payload: { repo: '/repo', ...defaults, showLostCommits: true } });
    H.git.log.mockClear();
    H.panel!.webview.postMessage.mockClear();

    await (MainPanel.currentPanel as unknown as { refreshAll(scope: 'status' | 'full'): Promise<void> }).refreshAll(scope);

    expect(H.git.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ showLostCommits: true }));
    expect(postedOfType(scope === 'status' ? 'logData' : 'fullRefresh')).toHaveLength(1);
  });

  it.each([
    { repo: '/repo', ...defaults, showLostCommits: undefined },
    { repo: '/repo', ...defaults, showLostCommits: 'true' },
    { repo: '/repo', ...defaults, showLostCommits: 1 },
    { repo: '/repo', ...defaults, showLostCommits: null },
    { repo: '/repo', ...defaults, showTagLabels: undefined, showLostCommits: true },
    { repo: '/repo', ...defaults, showStashEntries: 'true', showLostCommits: true },
    { repo: 42, ...defaults, showLostCommits: true },
    { ...defaults, showLostCommits: true },
  ])('rejects invalid graph view option saves %#', async (payload) => {
    await dispatch({ type: 'saveGraphViewOptions', payload });
    expect(update).not.toHaveBeenCalled();
    expect(H.git.log).not.toHaveBeenCalled();
    await dispatch({ type: 'getRepoList' });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(defaults);
  });

  it('does not reload the previous repository when its pending save finishes after switching', async () => {
    H.repos.push({ path: '/repo-b', name: 'repo-b', type: 'root' });
    await dispatch({ type: 'getRepoList' });
    let finishSave!: () => void;
    update.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const save = dispatch({ type: 'saveGraphViewOptions', payload: { repo: '/repo', ...defaults, showLostCommits: true } });
    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    H.git.log.mockClear();
    H.panel!.webview.postMessage.mockClear();

    finishSave();
    await save;

    expect(H.git.log).not.toHaveBeenCalled();
    expect(postedOfType('logData')).toHaveLength(0);
    await dispatch({ type: 'getRepoList' });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(defaults);
  });

  it('rejects a save from the previous repository without changing the active options', async () => {
    H.repos.push({ path: '/repo-b', name: 'repo-b', type: 'root' });
    await dispatch({ type: 'getRepoList' });
    await dispatch({ type: 'switchRepo', payload: { path: '/repo-b' } });
    update.mockClear();
    H.git.log.mockClear();

    await dispatch({ type: 'saveGraphViewOptions', payload: { repo: '/repo', ...defaults, showLostCommits: true } });

    expect(update).not.toHaveBeenCalled();
    expect(H.git.log).not.toHaveBeenCalled();
    await dispatch({ type: 'getRepoList' });
    expect(postedOfType('repoList').at(-1)?.payload?.viewOptions).toEqual(defaults);
  });
});

describe('MainPanel author colors', () => {
  it('persists normalized author emails and reloads their colors in another repository', async () => {
    await dispatch({ type: 'saveAuthorColor', payload: { email: ' Alice@Example.COM ', color: '#61afef' } });
    const { ConfigurationTarget } = await import('vscode');
    expect(H.updateConfig).toHaveBeenCalledExactlyOnceWith('authorColors', { 'alice@example.com': '#61afef' }, ConfigurationTarget.Global);
    expect(postedOfType('authorColor').at(-1)?.payload).toEqual({ email: 'alice@example.com', color: '#61afef' });

    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    MainPanel.createOrShow(extUri, '/another-repo');
    await dispatch({ type: 'getAuthorColors' });
    expect(postedOfType('authorColors').at(-1)?.payload).toEqual({ colors: { 'alice@example.com': '#61afef' } });
  });

  it('clears only the selected email and leaves it absent on reload', async () => {
    H.config.authorColors = { 'alice@example.com': '#61AFEF', 'bob@example.com': '#E06C75' };
    await dispatch({ type: 'saveAuthorColor', payload: { email: ' ALICE@example.com ', color: null } });
    const { ConfigurationTarget } = await import('vscode');
    expect(H.updateConfig).toHaveBeenCalledExactlyOnceWith('authorColors', { 'bob@example.com': '#E06C75' }, ConfigurationTarget.Global);
    expect(postedOfType('authorColor').at(-1)?.payload).toEqual({ email: 'alice@example.com', color: null });
    await dispatch({ type: 'getAuthorColors' });
    expect(postedOfType('authorColors').at(-1)?.payload).toEqual({ colors: { 'bob@example.com': '#E06C75' } });
  });

  it('loads only author color entries containing six-digit hex colors', async () => {
    H.config.authorColors = { 'alice@example.com': '#61AFEF', 'invalid@example.com': '#abc', 'object@example.com': {} };
    H.config.unrelated = '#E06C75';
    await dispatch({ type: 'getAuthorColors' });
    expect(postedOfType('authorColors').at(-1)?.payload).toEqual({ colors: { 'alice@example.com': '#61AFEF' } });
  });

  it.each([
    { email: ' ', color: '#61AFEF' },
    { email: 42, color: '#61AFEF' },
    { email: 'x'.repeat(1001), color: '#61AFEF' },
    { email: 'alice@example.com', color: '#abc' },
    { email: 'alice@example.com', color: '#GGGGGG' },
    { email: 'alice@example.com', color: 123456 },
    {},
  ])('rejects invalid author color payload %#', async (payload) => {
    await dispatch({ type: 'saveAuthorColor', payload });
    expect(H.updateConfig).not.toHaveBeenCalled();
    expect(postedOfType('authorColor')).toHaveLength(0);
  });
});

describe('MainPanel file list preference', () => {
  let values: Map<string, unknown>;
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    values = new Map();
    update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
    MainPanel.setGlobalState({
      keys: () => [...values.keys()],
      get: <T>(key: string, fallback?: T) => values.has(key) ? values.get(key) as T : fallback,
      update,
    } as import('vscode').Memento);
  });

  afterEach(() => values.clear());

  it.each([undefined, 'invalid', false])('defaults to tree for saved value %s', async (saved) => {
    values.set('fileListMode', saved);
    await dispatch({ type: 'getFileListMode' });
    expect(postedOfType('setFileListMode').at(-1)?.payload).toEqual({ mode: 'tree' });
  });

  it.each(['tree', 'list'])('remembers %s after reopening in another repository', async (mode) => {
    await dispatch({ type: 'saveFileListMode', payload: { mode } });
    expect(update).toHaveBeenCalledWith('fileListMode', mode);
    (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    MainPanel.createOrShow(extUri, '/another-repo');
    await dispatch({ type: 'getFileListMode' });
    expect(postedOfType('setFileListMode').at(-1)?.payload).toEqual({ mode });
  });

  it.each(['invalid', null, true])('rejects invalid mode %s without overwriting the preference', async (mode) => {
    values.set('fileListMode', 'list');
    await dispatch({ type: 'saveFileListMode', payload: { mode } });
    expect(update).not.toHaveBeenCalled();
    expect(values.get('fileListMode')).toBe('list');
  });
});

describe('MainPanel sidebar stash previews', () => {
  const stash = { hash: 'a'.repeat(40), index: 2, message: 'saved work', date: '' };

  beforeEach(() => {
    H.git.stashList.mockResolvedValue([{ ...stash, index: 1 }]);
    H.git.searchByHash.mockImplementation(async hash => commit(hash));
  });

  it('queues the preview until the webview is ready and uses the current stash index', async () => {
    await MainPanel.showStashWithPanel(extUri, '/repo', stash);
    expect(postedOfType('showStash')).toEqual([]);

    await dispatch({ type: 'getBranches' });

    expect(postedOfType('showStash')).toEqual([{
      type: 'showStash', payload: {
        repo: '/repo', commit: { ...commit(stash.hash), refs: [{ type: 'stash', name: 'stash@{1}' }] },
      },
    }]);
    expect(H.git.searchByHash).toHaveBeenCalledWith(stash.hash);
    expect(H.git.log).not.toHaveBeenCalled();
    expect(H.git.stashPop).not.toHaveBeenCalled();
  });

  it('opens a stash immediately when the webview is ready', async () => {
    await dispatch({ type: 'getBranches' });
    await MainPanel.showStashWithPanel(extUri, '/repo', stash);
    expect(postedOfType('showStash')).toHaveLength(1);
  });

  it('rejects a removed stash instead of selecting the stash now at its old index', async () => {
    H.git.stashList.mockResolvedValue([{ ...stash, hash: 'b'.repeat(40) }]);
    await expect(MainPanel.showStashWithPanel(extUri, '/repo', stash)).rejects.toThrow('This stash is no longer available.');
    expect(H.git.searchByHash).not.toHaveBeenCalled();
    expect(postedOfType('showStash')).toEqual([]);
  });

  it('rejects unavailable commit data', async () => {
    H.git.searchByHash.mockResolvedValue(null);
    await expect(MainPanel.showStashWithPanel(extUri, '/repo', stash)).rejects.toThrow('This stash is no longer available.');
    expect(postedOfType('showStash')).toEqual([]);
  });

  it('ignores an older preview that finishes after a newer click', async () => {
    const second = { ...stash, hash: 'b'.repeat(40), index: 0 };
    H.git.stashList.mockResolvedValue([stash, second]);
    await dispatch({ type: 'getBranches' });
    let finish!: (value: ReturnType<typeof commit>) => void;
    H.git.searchByHash.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = MainPanel.showStashWithPanel(extUri, '/repo', stash);
    await vi.waitFor(() => expect(H.git.searchByHash).toHaveBeenCalledOnce());
    await MainPanel.showStashWithPanel(extUri, '/repo', second);
    finish(commit(stash.hash));
    await first;
    expect(postedOfType('showStash')).toHaveLength(1);
    expect(postedOfType('showStash')[0].payload?.commit).toMatchObject({ hash: second.hash });
  });

  it.each(['branch', 'repo', 'dispose'])('ignores pending previews after %s navigation', async action => {
    await dispatch({ type: 'getBranches' });
    let finish!: (value: ReturnType<typeof commit>) => void;
    H.git.searchByHash.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = MainPanel.showStashWithPanel(extUri, '/repo', stash);
    await vi.waitFor(() => expect(H.git.searchByHash).toHaveBeenCalledOnce());
    if (action === 'branch') await MainPanel.showBranchWithPanel(extUri, '/repo', 'main');
    if (action === 'repo') await MainPanel.currentPanel!.switchRepo('/repo-b');
    if (action === 'dispose') (MainPanel.currentPanel as unknown as { dispose(): void }).dispose();
    finish(commit(stash.hash));
    await pending;
    expect(postedOfType('showStash')).toEqual([]);
    if (action === 'branch') expect(postedOfType('showBranch')).toEqual([{ type: 'showBranch', payload: { name: 'main' } }]);
  });
});


describe('detached commit checkout', () => {
  it('enables confirmation by default and updates it when the setting changes', async () => {
    await dispatch({ type: 'getSettings' });
    expect(postedOfType('setDefaults').at(-1)?.payload?.checkout).toMatchObject({ confirmDetached: true });
    H.config['defaults.checkout.confirmDetached'] = false;
    H.configHandler!({ affectsConfiguration: key => key === 'gitGraphPlus.defaults' });
    expect(postedOfType('setDefaults').at(-1)?.payload?.checkout).toMatchObject({ confirmDetached: false });
  });

  it.each([true, false])('forwards detach=%s without changing ordinary branch checkout', async detach => {
    await dispatch({ type: 'checkout', payload: { ref: 'a'.repeat(40), detach, merge: true } });
    expect(H.git.checkout).toHaveBeenCalledWith('a'.repeat(40), {
      force: undefined, merge: true, ...(detach ? { detach: true } : {}),
    });
    expect(H.git.pull).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  getExtension: vi.fn(),
  getRepository: vi.fn(),
  executeCommand: vi.fn(),
  activate: vi.fn(),
  getAPI: vi.fn(),
}));

vi.mock('vscode', () => ({
  extensions: { getExtension: H.getExtension },
  commands: { executeCommand: H.executeCommand },
}));

import type { Uri } from 'vscode';
import { openVSCodeGitConflict } from '../vscode-git-bridge';

const fileUri = { fsPath: '/repo/file.txt' } as Uri;
const repo = {
  rootUri: { fsPath: '/repo' },
  state: { mergeChanges: [] as { uri: Uri }[] },
  status: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  repo.state.mergeChanges = [];
  repo.status.mockImplementation(async () => { repo.state.mergeChanges = [{ uri: fileUri }]; });
  H.getRepository.mockReturnValue(repo);
  H.getAPI.mockReturnValue({ getRepository: H.getRepository });
  H.getExtension.mockReturnValue({ isActive: true, exports: { getAPI: H.getAPI }, activate: H.activate });
});

describe('openVSCodeGitConflict', () => {
  it('refreshes native status before delegating the matching conflict to git.openChange', async () => {
    expect(await openVSCodeGitConflict('/repo', fileUri)).toBe(true);
    expect(H.getRepository).toHaveBeenCalledWith(fileUri);
    expect(repo.status).toHaveBeenCalledOnce();
    expect(H.executeCommand).toHaveBeenCalledExactlyOnceWith('git.openChange', fileUri);
  });

  it('activates the built-in extension before using API version 1', async () => {
    H.getExtension.mockReturnValue({ isActive: false, exports: { getAPI: H.getAPI }, activate: H.activate });
    expect(await openVSCodeGitConflict('/repo', fileUri)).toBe(true);
    expect(H.activate).toHaveBeenCalledOnce();
    expect(H.getAPI).toHaveBeenCalledWith(1);
    expect(H.activate.mock.invocationCallOrder[0]).toBeLessThan(H.getAPI.mock.invocationCallOrder[0]);
  });

  it.each(['missing', 'activation failure', 'API failure'])('returns false for extension %s', async (failure) => {
    if (failure === 'missing') H.getExtension.mockReturnValue(undefined);
    if (failure === 'activation failure') {
      H.getExtension.mockReturnValue({ isActive: false, activate: H.activate });
      H.activate.mockRejectedValue(new Error('disabled'));
    }
    if (failure === 'API failure') H.getAPI.mockImplementation(() => { throw new Error('disabled'); });
    expect(await openVSCodeGitConflict('/repo', fileUri)).toBe(false);
    expect(H.executeCommand).not.toHaveBeenCalled();
  });

  it.each([null, { rootUri: { fsPath: '/parent-repo' } }])('rejects a missing or different native repository: %s', async (nativeRepo) => {
    H.getRepository.mockReturnValue(nativeRepo);
    expect(await openVSCodeGitConflict('/repo', fileUri)).toBe(false);
    expect(repo.status).not.toHaveBeenCalled();
    expect(H.executeCommand).not.toHaveBeenCalled();
  });

  it('does not delegate a conflict removed by the status refresh', async () => {
    repo.state.mergeChanges = [{ uri: fileUri }];
    repo.status.mockImplementation(async () => {
      repo.state.mergeChanges = [{ uri: { fsPath: '/repo/another.txt' } as Uri }];
    });
    expect(await openVSCodeGitConflict('/repo', fileUri)).toBe(false);
    expect(H.executeCommand).not.toHaveBeenCalled();
  });

  it.each(['status', 'command'])('propagates %s failures to the editor fallback', async (step) => {
    const error = new Error('native Git failed');
    (step === 'status' ? repo.status : H.executeCommand).mockRejectedValue(error);
    await expect(openVSCodeGitConflict('/repo', fileUri)).rejects.toBe(error);
    if (step === 'status') expect(H.executeCommand).not.toHaveBeenCalled();
  });
});

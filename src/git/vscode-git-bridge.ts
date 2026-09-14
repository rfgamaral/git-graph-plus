import * as vscode from 'vscode';
import { samePath } from '../utils/path';

/**
 * Minimal shape of the built-in `vscode.git` extension API that we use here.
 * The full type definition lives in vscode.git's `git.d.ts`; declaring only
 * the bits we touch keeps us decoupled from version drift.
 */
interface GitRepository {
  rootUri: vscode.Uri;
  state: { mergeChanges: { uri: vscode.Uri }[] };
  status(): Promise<void>;
  fetch(options?: { remote?: string; ref?: string; all?: boolean; prune?: boolean; depth?: number }): Promise<void>;
}

interface GitApi {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

async function getGitApi(): Promise<GitApi | null> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return null;
  if (!ext.isActive) {
    try { await ext.activate(); } catch { return null; }
  }
  try { return ext.exports.getAPI(1); } catch { return null; }
}

export async function openVSCodeGitConflict(repoPath: string, fileUri: vscode.Uri): Promise<boolean> {
  const api = await getGitApi();
  const repo = api?.getRepository(fileUri);
  if (!repo || !samePath(repo.rootUri.fsPath, repoPath)) return false;
  await repo.status();
  if (!repo.state.mergeChanges.some(change => samePath(change.uri.fsPath, fileUri.fsPath))) return false;
  await vscode.commands.executeCommand('git.openChange', fileUri);
  return true;
}

/**
 * Run a fetch through the built-in `vscode.git` extension so its GIT_ASKPASS
 * pipeline (the same flow used by the SCM panel) gets invoked. Once the user
 * supplies credentials they are cached by the OS credential helper, allowing
 * the caller's subsequent spawn-based git command to succeed.
 *
 * Returns `true` if the fetch ran successfully (auth was either already valid
 * or the user just supplied it). Returns `false` if no matching repository
 * exists in the git extension's view of the workspace.
 *
 * Note: a thrown error from the inner fetch (e.g., the user cancelled the
 * prompt) propagates to the caller as-is so they can surface a sensible
 * message.
 */
export async function triggerVSCodeGitAuth(repoPath: string, remote?: string): Promise<boolean> {
  const api = await getGitApi();
  if (!api) return false;
  const repo = api.repositories.find(r => samePath(r.rootUri.fsPath, repoPath));
  if (!repo) return false;
  await repo.fetch({ remote, prune: false });
  return true;
}

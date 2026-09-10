import * as vscode from 'vscode';
import { normalizeInteractiveRebaseMode, type InteractiveRebaseMode } from '../git/classic-rebase';

/**
 * Reads the `gitGraphPlus.timeout` setting (in seconds) and returns the
 * equivalent in milliseconds for `GitService.setDefaultTimeout`. Falls back to
 * the 60s default when the value is missing or non-positive.
 */
export function readTimeoutMs(): number {
  const seconds = vscode.workspace.getConfiguration('gitGraphPlus').get<number>('timeout', 60);
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

/** Default number of commits loaded on the first graph render / refresh. */
export const DEFAULT_INITIAL_COMMIT_COUNT = 200;
/** Default number of extra commits fetched each time "Load more" is clicked. */
export const DEFAULT_LOAD_MORE_COMMIT_COUNT = 50;

function readPositiveIntSetting(key: string, fallback: number): number {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<number>(key, fallback);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

/**
 * Reads `gitGraphPlus.initialCommitCount` — how many commits to load when the
 * graph first renders (and on refresh). Falls back to 200 when unset/invalid.
 */
export function readInitialCommitCount(): number {
  return readPositiveIntSetting('initialCommitCount', DEFAULT_INITIAL_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.loadMoreCommitCount` — how many additional commits each
 * "Load more" click fetches. Falls back to 50 when unset/invalid.
 */
export function readLoadMoreCommitCount(): number {
  return readPositiveIntSetting('loadMoreCommitCount', DEFAULT_LOAD_MORE_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.interactiveRebase.mode` — whether interactive rebase
 * opens the GUI editor (`ui`, default) or runs classic `git rebase -i` in the
 * integrated terminal (`classic`).
 */
export function readInteractiveRebaseMode(): InteractiveRebaseMode {
  return normalizeInteractiveRebaseMode(
    vscode.workspace.getConfiguration('gitGraphPlus').get<string>('interactiveRebase.mode', 'ui'),
  );
}

/**
 * Reads `gitGraphPlus.avatarOverrides` — an object mapping commit-author emails
 * to explicit https avatar URLs. It lets an author whose email has neither a
 * Gravatar account nor a GitHub noreply address still show a real avatar.
 * Keys are normalized (trimmed + lowercased); entries whose value is empty or
 * not an https URL are ignored (the fetch is https-only).
 */
export function readAvatarOverrides(): Record<string, string> {
  const raw = vscode.workspace
    .getConfiguration('gitGraphPlus')
    .get<Record<string, unknown>>('avatarOverrides', {});
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [email, url] of Object.entries(raw)) {
      if (typeof url === 'string' && url.trim().startsWith('https://')) {
        out[email.trim().toLowerCase()] = url.trim();
      }
    }
  }
  return out;
}

/**
 * Reads `gitGraphPlus.fetchLfsLocks` — whether to fetch LFS file-lock status
 * from the remote. Defaults to true; disabled on hosts without an LFS lock
 * server to avoid background `git lfs locks` requests and their error popups.
 */
export function readFetchLfsLocks(): boolean {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('fetchLfsLocks', true);
}

/**
 * Reads `gitGraphPlus.defaultCommitTab` — which tab the commit details panel
 * opens on when a commit is selected. Falls back to `details`.
 */
export function readDefaultCommitTab(): 'details' | 'changes' {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('defaultCommitTab', 'details');
  return raw === 'changes' ? 'changes' : 'details';
}

/** Default format pattern for commit timestamps. */
const DEFAULT_DATE_TIME_FORMAT = 'R HH:mm:ss';

/**
 * Reads `gitGraphPlus.dateTimeFormat` — the token pattern used to render
 * commit timestamps. Falls back to the default when unset/empty.
 */
export function readDateTimeFormat(): string {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('dateTimeFormat', DEFAULT_DATE_TIME_FORMAT);
  return typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_DATE_TIME_FORMAT;
}

export function readAuthorColors(): Record<string, string> {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<unknown>('authorColors', {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .filter(([email, color]) => email.trim() && email.length <= 1000 && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    .map(([email, color]) => [email.trim().toLowerCase(), color]));
}

export function readCommitDetailsPosition(): 'bottom' | 'right' {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<string>('commitDetailsPosition', 'bottom') === 'right' ? 'right' : 'bottom';
}

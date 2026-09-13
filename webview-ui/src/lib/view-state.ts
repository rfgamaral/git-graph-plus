import { getVsCodeApi } from './vscode-api';

type Value = string | number | boolean | null | string[];

function savedState(): Record<string, unknown> {
  const state = getVsCodeApi().getState();
  return state && typeof state === 'object' && !Array.isArray(state) ? state as Record<string, unknown> : {};
}

export function readViewState<T extends Record<string, Value>>(
  key: string,
  defaults: T,
  choices: Partial<{ [K in keyof T]: readonly T[K][] }> = {},
): T {
  const sections = savedState().viewState;
  const saved = sections && typeof sections === 'object' ? (sections as Record<string, unknown>)[key] : null;
  if (!saved || typeof saved !== 'object') return defaults;
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = (saved as Record<string, unknown>)[name];
    const valid = Array.isArray(fallback)
      ? Array.isArray(value) && value.every(item => typeof item === 'string')
      : fallback === null ? value === null || typeof value === 'string'
      : typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value));
    const allowed = choices[name];
    return [name, valid && (!allowed || allowed.includes(value as T[string])) ? value : fallback];
  })) as T;
}

export function writeViewState(key: string, values: Record<string, Value>): void {
  const state = savedState();
  const sections = state.viewState && typeof state.viewState === 'object' ? state.viewState : {};
  getVsCodeApi().setState({ ...state, viewState: { ...sections, [key]: values } });
}

export function saveRepoPath(repoPath: string): void {
  getVsCodeApi().setState({ ...savedState(), repoPath });
}

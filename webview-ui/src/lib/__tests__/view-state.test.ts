import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVsCodeApi } from '../vscode-api';
import { readViewState, saveRepoPath, writeViewState } from '../view-state';
import { rememberScroll } from '../actions/rememberScroll';

let state: unknown;

beforeEach(() => {
  state = undefined;
  vi.spyOn(getVsCodeApi(), 'getState').mockImplementation(() => state);
  vi.spyOn(getVsCodeApi(), 'setState').mockImplementation(value => { state = structuredClone(value); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('view state', () => {
  it('preserves the repository and other sections when saving a section', () => {
    state = { repoPath: '/repo', unrelated: true };
    writeViewState('search', { query: 'fix', currentIndex: 2 });
    writeViewState('ui', { selectedCommitHash: 'abc' });
    saveRepoPath('/other');
    expect(state).toEqual({
      repoPath: '/other', unrelated: true,
      viewState: { search: { query: 'fix', currentIndex: 2 }, ui: { selectedCommitHash: 'abc' } },
    });
    expect(readViewState('search', { query: '', currentIndex: -1 })).toEqual({ query: 'fix', currentIndex: 2 });
  });

  it.each([undefined, null, 'invalid', [], { viewState: null }, { viewState: { ui: false } }])(
    'uses defaults for malformed saved state: %j', saved => {
      state = saved;
      expect(readViewState('ui', { selected: null, height: 300 })).toEqual({ selected: null, height: 300 });
    },
  );

  it('rejects invalid types, nonfinite numbers and unknown choices without discarding valid fields', () => {
    state = { viewState: { ui: {
      selected: 'abc', height: Infinity, width: NaN, visible: 'true', hashes: ['abc', 2], mode: 'unknown', query: 'fix',
    } } };
    expect(readViewState('ui', {
      selected: null, height: 300, width: 400, visible: false, hashes: [] as string[], mode: 'graph', query: '',
    }, { mode: ['graph', 'log', 'stats'] })).toEqual({
      selected: 'abc', height: 300, width: 400, visible: false, hashes: [], mode: 'graph', query: 'fix',
    });
  });
});

describe('rememberScroll', () => {
  let frames: Map<number, FrameRequestCallback>;
  let resize: () => void;
  let disconnect: ReturnType<typeof vi.fn>;
  let node: HTMLDivElement;
  let action: ReturnType<typeof rememberScroll> | undefined;

  function flushFrame() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  }

  beforeEach(() => {
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    node = document.createElement('div');
    Object.defineProperties(node, { clientHeight: { value: 400, configurable: true }, clientWidth: { value: 600 } });
    state = { viewState: { 'scroll:graph': { top: 1500, left: 40, identity: '/repo' } } };
  });

  afterEach(() => {
    action?.destroy();
    action = undefined;
  });

  it('waits for both data and layout without overwriting the saved position', () => {
    const onRestore = vi.fn();
    action = rememberScroll(node, { key: 'graph', identity: '/repo', ready: false, onRestore });
    node.dispatchEvent(new Event('scroll'));
    flushFrame();
    expect(getVsCodeApi().setState).not.toHaveBeenCalled();
    Object.defineProperty(node, 'clientHeight', { value: 0, configurable: true });
    action.update({ key: 'graph', identity: '/repo', ready: true, onRestore });
    flushFrame();
    expect(node.scrollTop).toBe(0);
    Object.defineProperty(node, 'clientHeight', { value: 400, configurable: true });
    resize();
    flushFrame();
    expect([node.scrollTop, node.scrollLeft]).toEqual([1500, 40]);
    expect(onRestore).toHaveBeenCalledOnce();
    node.scrollTop = 1700;
    node.dispatchEvent(new Event('scroll'));
    expect(readViewState('scroll:graph', { top: 0 })).toEqual({ top: 1700 });
    resize();
    flushFrame();
    expect(node.scrollTop).toBe(1700);
  });

  it('restores after a loading cycle but never applies another repository’s position', () => {
    action = rememberScroll(node, { key: 'graph', identity: '/repo' });
    flushFrame();
    action.update({ key: 'graph', identity: '/repo', ready: false });
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
    action.update({ key: 'graph', identity: '/repo', ready: true });
    flushFrame();
    expect(node.scrollTop).toBe(1500);
    node.scrollTop = 0;
    action.update({ key: 'graph', identity: '/other' });
    flushFrame();
    expect(node.scrollTop).toBe(0);
    expect(readViewState('scroll:graph', { identity: '' }).identity).toBe('/other');
  });

  it('cancels pending restoration and removes its observer and listener on destroy', () => {
    action = rememberScroll(node, { key: 'graph', identity: '/repo' });
    action.destroy();
    action = undefined;
    flushFrame();
    node.dispatchEvent(new Event('scroll'));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(node.scrollTop).toBe(0);
    expect(getVsCodeApi().setState).not.toHaveBeenCalled();
  });
});

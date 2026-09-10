import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import boring from 'boring-avatars-vanilla';
import { avatarStore } from '../avatars.svelte';

let stopWatchingTheme: () => void;

beforeEach(() => {
  stopWatchingTheme = avatarStore.watchTheme();
});

afterEach(() => stopWatchingTheme());

function svgContent(uri: string) {
  return decodeURIComponent(uri.slice('data:image/svg+xml,'.length)).replace(/boring-avatar-\d+-[a-z0-9]+/g, 'avatar');
}

function postedTypes(): string[] {
  return globalThis.__postedMessages.map((m) => (m.data as { type: string }).type);
}

describe('avatarStore', () => {
  it('returns a themed Bauhaus avatar and requests the real image on first read', () => {
    const result = avatarStore.url('first@example.com', 32);
    expect(result).toMatch(/^data:image\/svg\+xml,/);
    const style = getComputedStyle(document.body);
    const colors = ['blue', 'green', 'yellow', 'orange', 'purple'].map(name => style.getPropertyValue(`--vscode-charts-${name}`).trim());
    const expected = boring({ name: 'first@example.com', variant: 'bauhaus', colors, size: 32 });
    expect(svgContent(result)).toBe(expected.replace(/boring-avatar-\d+-[a-z0-9]+/g, 'avatar'));
    expect(postedTypes()).toContain('getAvatar');
    const msg = globalThis.__postedMessages.at(-1)?.data as {
      type: string;
      payload: { email: string; size: number };
    };
    expect(msg.payload).toEqual({ email: 'first@example.com', size: 32 });
  });

  it('does not re-request a key that is already pending', () => {
    avatarStore.url('second@example.com', 32);
    const countAfterFirst = globalThis.__postedMessages.length;
    avatarStore.url('second@example.com', 32);
    expect(globalThis.__postedMessages.length).toBe(countAfterFirst);
  });

  it('replaces a generated fallback with the resolved real image', () => {
    expect(avatarStore.url('third@example.com', 32)).toMatch(/^data:image\/svg\+xml,/);
    const dataUri = 'data:image/png;base64,AAAA';
    avatarStore.receive('third@example.com', 32, dataUri);
    expect(avatarStore.url('third@example.com', 32)).toBe(dataUri);
  });

  it('keeps a generated fallback when no real image is available without re-requesting', () => {
    const fallback = avatarStore.url('fourth@example.com', 32);
    avatarStore.receive('fourth@example.com', 32, null);
    const countBefore = globalThis.__postedMessages.length;
    expect(avatarStore.url('fourth@example.com', 32)).toBe(fallback);
    expect(globalThis.__postedMessages.length).toBe(countBefore);
  });

  it('normalizes email casing and whitespace into the same cache key', () => {
    avatarStore.receive('Fifth@Example.com', 32, 'data:image/png;base64,BBBB');
    expect(avatarStore.url('  fifth@example.com  ', 32)).toBe('data:image/png;base64,BBBB');
  });

  it('normalizes generated avatars and produces different patterns for different authors', () => {
    const first = avatarStore.url(' Pattern@Example.com ', 32);
    expect(avatarStore.url('pattern@example.com', 32)).toBe(first);
    expect(svgContent(avatarStore.url('different@example.com', 32))).not.toBe(svgContent(first));
  });

  it('recolors fallbacks on theme changes without replacing real avatars or refetching', async () => {
    const before = avatarStore.url('theme@example.com', 32);
    const real = 'data:image/png;base64,CCCC';
    avatarStore.receive('real-theme@example.com', 32, real);
    const requests = globalThis.__postedMessages.length;
    for (const name of ['blue', 'green', 'yellow', 'orange', 'purple']) {
      document.body.style.setProperty(`--vscode-charts-${name}`, '#123456');
    }
    await waitFor(() => expect(avatarStore.url('theme@example.com', 32)).not.toBe(before));
    const svg = svgContent(avatarStore.url('theme@example.com', 32));
    expect(svg).toContain('#123456');
    expect(svg.replace(/#[0-9a-f]{6}/gi, 'color')).toBe(svgContent(before).replace(/#[0-9a-f]{6}/gi, 'color'));
    expect(svg).not.toMatch(/#3794ff|#89d185|#cca700|#d18616|#b180d7/);
    expect(avatarStore.url('real-theme@example.com', 32)).toBe(real);
    expect(globalThis.__postedMessages).toHaveLength(requests);
  });
});

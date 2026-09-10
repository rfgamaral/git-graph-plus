import { beforeEach, describe, it, expect } from 'vitest';
import { authorColorsStore } from '../author-colors.svelte';

beforeEach(() => {
  authorColorsStore.colors = {};
  authorColorsStore.picker = null;
});

describe('authorColorsStore', () => {
  it('opens at the requested position with a normalized email and ignores blank emails', () => {
    authorColorsStore.open('  ', 1, 2);
    expect(authorColorsStore.picker).toBeNull();
    authorColorsStore.open(' Alice@Example.COM ', 20, 30);
    expect(authorColorsStore.picker).toEqual({ email: 'alice@example.com', x: 20, y: 30 });
  });

  it.each(['#61AFEF', null])('sends a saved color of %s for the selected email and closes', (color) => {
    authorColorsStore.open(' Alice@Example.COM ', 20, 30);
    authorColorsStore.save(color);
    expect(globalThis.__postedMessages.map(m => m.data)).toEqual([
      { type: 'saveAuthorColor', payload: { email: 'alice@example.com', color } },
    ]);
    expect(authorColorsStore.picker).toBeNull();
  });

  it('does not save without a picker or with an invalid color', () => {
    authorColorsStore.save('#61AFEF');
    authorColorsStore.open('alice@example.com', 20, 30);
    authorColorsStore.save('#abc');
    expect(globalThis.__postedMessages).toHaveLength(0);
    expect(authorColorsStore.picker?.email).toBe('alice@example.com');
  });

  it('looks up and removes colors by email without changing another author', () => {
    authorColorsStore.receive('alice@example.com', '#61AFEF');
    authorColorsStore.receive('bob@example.com', '#E06C75');
    expect(authorColorsStore.color(' Alice@Example.COM ')).toBe('#61AFEF');
    expect(authorColorsStore.color('unknown@example.com')).toBeUndefined();
    authorColorsStore.receive('alice@example.com', null);
    expect(authorColorsStore.color('alice@example.com')).toBeUndefined();
    expect(authorColorsStore.color('bob@example.com')).toBe('#E06C75');
    expect(authorColorsStore.colors).toEqual({ 'bob@example.com': '#E06C75' });
  });

  it('does not expose invalid or inherited colors', () => {
    authorColorsStore.colors = { 'alice@example.com': 'red' };
    expect(authorColorsStore.color('alice@example.com')).toBeUndefined();
    expect(authorColorsStore.color('__proto__')).toBeUndefined();
  });
});

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Markdown from '../Markdown.svelte';
import { commitLinkRulesStore } from '../../../lib/stores/commit-link-rules.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';

beforeEach(() => {
  i18n.setLocale('en');
  commitLinkRulesStore.set([]);
  globalThis.__postedMessages = [];
});

describe('Markdown', () => {
  it('renders a heading', () => {
    const { container } = render(Markdown, { props: { text: '# Title' } });
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Title');
  });

  it('renders bold, italic and strikethrough', () => {
    const { container } = render(Markdown, { props: { text: '**b** *i* ~~s~~' } });
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('del')?.textContent).toBe('s');
  });

  it('renders inline and fenced code', () => {
    const { container } = render(Markdown, { props: { text: 'use `x`\n\n```\ncode\n```' } });
    expect(container.querySelector('code')?.textContent).toBe('x');
    expect(container.querySelector('pre code')?.textContent).toContain('code');
  });

  it('renders markup characters in inline code instead of visible HTML entities', () => {
    const snippet = '<if test="onlyHasVideo==true">';
    const { container } = render(Markdown, { props: { text: `- \`${snippet}\`` } });

    expect(container.querySelector('code')?.textContent).toBe(snippet);
    expect(container.querySelector('if')).toBeNull();
  });

  it('decodes marked inline-code entities exactly once', () => {
    const { container } = render(Markdown, {
      props: { text: '`&lt;script&gt;alert(1)&lt;/script&gt;`' },
    });

    expect(container.querySelector('code')?.textContent)
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders quotes in Markdown text instead of visible HTML entities', () => {
    const { container } = render(Markdown, {
      props: { text: '- getEnumByCode("250")' },
    });

    expect(container.querySelector('li')?.textContent?.trim()).toBe('getEnumByCode("250")');
  });

  it('decodes marked text entities exactly once', () => {
    const { container } = render(Markdown, {
      props: { text: '- &amp;lt;script&amp;gt;' },
    });

    expect(container.querySelector('li')?.textContent?.trim()).toBe('&lt;script&gt;');
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders escaped markup characters as inert text', () => {
    const { container } = render(Markdown, { props: { text: '- \\<tag\\>' } });

    expect(container.querySelector('li')?.textContent?.trim()).toBe('<tag>');
    expect(container.querySelector('tag')).toBeNull();
  });

  it('renders nested unordered lists', () => {
    const { container } = render(Markdown, { props: { text: '- a\n  - b' } });
    const outer = container.querySelector('ul');
    expect(outer?.querySelector('ul')).not.toBeNull();
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  it('renders a blockquote', () => {
    const { container } = render(Markdown, { props: { text: '> quoted' } });
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted');
  });

  it('reflows single line breaks', () => {
    const { container } = render(Markdown, { props: { text: 'line1\nline2' } });
    expect(container.querySelector('br')).toBeNull();
  });

  it('routes markdown link clicks through openExternalUrl', () => {
    const { container } = render(Markdown, { props: { text: '[gh](https://example.com)' } });
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('gh');
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(globalThis.__postedMessages).toContainEqual({
      data: { type: 'openExternalUrl', payload: { url: 'https://example.com' } },
    });
  });

  it('renders quotes in markdown link labels without changing the href', () => {
    const { container } = render(Markdown, {
      props: { text: '[getEnumByCode("250")](https://example.com)' },
    });
    const link = container.querySelector('a') as HTMLAnchorElement;

    expect(link.textContent).toBe('getEnumByCode("250")');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('renders responsive HTTPS images with safe loading attributes', () => {
    const { container } = render(Markdown, { text: '![alt "x"](https://example.com/x.png)' });
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://example.com/x.png');
    expect(image.getAttribute('alt')).toBe('alt "x"');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sanitizes raw HTML and blocks unsafe image URLs', () => {
    const { container } = render(Markdown, { text: '<script>alert(1)</script><iframe src="https://example.com"></iframe><img src="http://example.com/x" onerror="alert(1)" srcset="https://example.com/x 2x"><img src="data:image/svg+xml,bad"><div style="position:fixed">Safe</div>' });
    expect(container.querySelector('script, iframe, [onerror], [srcset], [style]')).toBeNull();
    expect(container.querySelectorAll('img[src]')).toHaveLength(0);
    expect(container.textContent).toContain('Safe');
  });

  it('does not forward non-http(s) link schemes to openExternalUrl', () => {
    const { container } = render(Markdown, { props: { text: '[x](javascript:alert(1))' } });
    const link = container.querySelector('a') as HTMLAnchorElement;
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(globalThis.__postedMessages).toEqual([]);
  });

  it('autolinks issue references via linkify in plain text', () => {
    commitLinkRulesStore.set([{ pattern: '#(\\d+)', url: 'https://gh/issues/$1' }]);
    const { container } = render(Markdown, { props: { text: 'fix #12' } });
    const link = container.querySelector('a[href]') as HTMLAnchorElement;
    expect(link?.getAttribute('href')).toBe('https://gh/issues/12');
  });
  it('preserves explicit Markdown line breaks', () => {
    const { container } = render(Markdown, { text: 'one  \ntwo' });
    expect(container.querySelector('br')).not.toBeNull();
  });

  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])('renders a %s alert with formatted content', (type) => {
    const { container } = render(Markdown, { text: `> [!${type}]\n> Some **bold** text.` });
    const alert = container.querySelector(`.markdown-alert-${type.toLowerCase()}`)!;
    expect(alert.querySelector('.codicon')).not.toBeNull();
    expect(alert.querySelector('strong')?.textContent).toBe('bold');
    expect(alert.textContent).not.toContain('[!');
  });

  it('renders aligned tables, HTML images, and disabled task checkboxes', () => {
    const { container } = render(Markdown, { text: '| Before | After |\n| :--- | ---: |\n| <img src="https://example.com/a.png" width="200" height="100" alt="Before"> | ~~removed~~ |\n\n- [x] Done\n- [ ] Pending' });
    expect(container.querySelector('.markdown-table table')).not.toBeNull();
    expect(container.querySelector('td')?.getAttribute('align')).toBe('left');
    expect(container.querySelectorAll('td')[1].getAttribute('align')).toBe('right');
    expect(container.querySelector('td img')?.getAttribute('width')).toBe('200');
    expect(container.querySelector('del')?.textContent).toBe('removed');
    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    expect(inputs).toHaveLength(2);
    expect([...inputs].every(input => input.disabled)).toBe(true);
    expect(inputs[0].checked).toBe(true);
    expect(inputs[1].checked).toBe(false);
  });

  it('navigates footnotes locally and preserves accessible references', () => {
    const { container } = render(Markdown, { text: 'First[^a b], second[^a%20b].\n\n[^a b]: First note.\n[^a%20b]: Second note.' });
    const reference = container.querySelectorAll<HTMLAnchorElement>('sup a')[1];
    const id = reference.getAttribute('href')!.slice(1);
    const target = [...container.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === id)!;
    target.scrollIntoView = vi.fn();
    reference.click();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(target);
    expect(globalThis.__postedMessages).toEqual([]);
    const description = reference.getAttribute('aria-describedby');
    if (description) expect([...container.querySelectorAll('[id]')].some(element => element.id === description)).toBe(true);
    const backlink = target.querySelector<HTMLAnchorElement>('a[href^="#"]')!;
    expect(backlink.getAttribute('href')).toBe(`#${reference.id}`);
    reference.scrollIntoView = vi.fn();
    backlink.click();
    expect(reference.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(reference);
  });

  it('does not linkify code or nested links', () => {
    commitLinkRulesStore.set([{ pattern: '#(\\d+)', url: 'https://gh/issues/$1' }]);
    const { container } = render(Markdown, { text: '`#12` [#12](https://example.com) #12' });
    expect(container.querySelector('code a, a a')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(2);
  });

  it('handles middle-clicks through the extension', () => {
    const { container } = render(Markdown, { text: '[Link](https://example.com)' });
    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    container.querySelector('a')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(globalThis.__postedMessages).toHaveLength(1);
  });

  it('isolates HTML ids and strips classes that could reuse app styling', () => {
    const { container } = render(Markdown, { text: '<h2 id="location" class="modal-overlay">Heading</h2><a href="#location">Jump</a><input type="text" value="bad">' });
    expect(container.querySelector('h2')?.id).toBe('user-content-location');
    expect(container.querySelector('.modal-overlay, input')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#user-content-location');
  });

});

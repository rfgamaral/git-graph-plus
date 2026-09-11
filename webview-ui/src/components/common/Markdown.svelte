<script lang="ts">
  import { renderMarkdown } from '../../lib/render-markdown';
  import { commitLinkRulesStore } from '../../lib/stores/commit-link-rules.svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { tooltip } from '../../lib/actions/tooltip';
  import { t } from '../../lib/i18n/index.svelte';

  const { text }: { text: string } = $props();
  const html = $derived(renderMarkdown(text, commitLinkRulesStore.rules));
  const vscode = getVsCodeApi();

  function images(node: HTMLDivElement, _html: string) {
    let requestId = '';
    const requested = new Set<string>();
    function request(image: HTMLImageElement) {
      const url = image.getAttribute('data-github-src') ?? '';
      if (!/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(url) || requested.has(url)) return;
      requested.add(url);
      vscode.postMessage({ type: 'getMarkdownImage', payload: { url, requestId } });
    }
    function receive(event: MessageEvent) {
      const message = event.data;
      if (message?.type !== 'markdownImage' || message.payload?.requestId !== requestId) return;
      const { url, dataUrl } = message.payload;
      if (!requested.has(url) || (dataUrl !== null && (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/.test(dataUrl)))) return;
      for (const image of node.querySelectorAll('img[data-github-src]')) {
        if (image.getAttribute('data-github-src') !== url) continue;
        image.setAttribute('src', dataUrl ?? url);
        image.removeAttribute('data-github-src');
        image.removeAttribute('hidden');
      }
    }
    function refresh() {
      requestId = crypto.randomUUID();
      requested.clear();
      for (const image of node.querySelectorAll<HTMLImageElement>('img[data-github-src]')) request(image);
    }
    window.addEventListener('message', receive);
    refresh();
    return {
      update: refresh,
      destroy() {
        window.removeEventListener('message', receive);
      },
    };
  }

  function links(node: HTMLDivElement, _html: string) {
    let tips: ReturnType<typeof tooltip>[] = [];
    function refresh() {
      tips.forEach(tip => tip.destroy());
      tips = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .filter(link => /^https?:\/\//i.test(link.getAttribute('href') ?? ''))
        .map(link => tooltip(link, t('graph.openLink')));
    }
    function open(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || !node.contains(link)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'auxclick' && event.button !== 1) return;
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch {}
        const targets = [...node.querySelectorAll<HTMLElement>('[id]')];
        const target = targets.find(element => element.id === href.slice(1))
          ?? targets.find(element => element.id === id);
        if (target) {
          target.scrollIntoView({ block: 'nearest' });
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      } else if (/^https?:\/\//i.test(href)) {
        vscode.postMessage({ type: 'openExternalUrl', payload: { url: href } });
      }
    }
    refresh();
    node.addEventListener('click', open);
    node.addEventListener('auxclick', open);
    return {
      update: refresh,
      destroy() {
        tips.forEach(tip => tip.destroy());
        node.removeEventListener('click', open);
        node.removeEventListener('auxclick', open);
      },
    };
  }
</script>

<div class="md-root" use:links={html} use:images={html}>{@html html}</div>

<style>
  .md-root {
    white-space: normal;
    overflow-wrap: anywhere;
    font-variant-emoji: emoji;
    font-family: var(--vscode-font-family), 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  }
  .md-root :global(h1), .md-root :global(h2), .md-root :global(h3),
  .md-root :global(h4), .md-root :global(h5), .md-root :global(h6) {
    margin: 1.25em 0 0.5em;
    font-size: 1em;
    font-weight: 600;
    line-height: 1.4;
  }
  .md-root :global(h1) { font-size: 1.5em; }
  .md-root :global(h2) { font-size: 1.35em; }
  .md-root :global(h3) { font-size: 1.15em; }
  .md-root :global(h1), .md-root :global(h2) {
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .md-root :global(p), .md-root :global(ul), .md-root :global(ol),
  .md-root :global(pre), .md-root :global(blockquote), .md-root :global(.markdown-alert),
  .md-root :global(.markdown-table), .md-root :global(details) { margin: 0.75em 0; }
  .md-root :global(ul), .md-root :global(ol) { padding-left: 1.5em; list-style-position: outside; }
  .md-root :global(li > ul), .md-root :global(li > ol) { padding-left: 1.4em; }
  .md-root :global(li) { margin: 0.25em 0; }
  .md-root :global(ul > li::marker) { content: '•\00a0'; }
  .md-root :global(.task-list-item) { list-style: none; padding-left: 0.4em; }
  .md-root :global(.task-list-item::marker) { content: ''; }
  .md-root :global(input[type='checkbox']) { width: 1em; height: 1em; margin: 0 0.4em 0 -1.4em; vertical-align: middle; }
  .md-root :global(blockquote) {
    padding: 0.5em 0.8em;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    color: var(--vscode-descriptionForeground);
  }
  .md-root :global(.markdown-alert) { padding: 0.5em 0.8em; border-left: 3px solid var(--alert-color); }
  .md-root :global(.markdown-alert-note) { --alert-color: var(--vscode-editorInfo-foreground); }
  .md-root :global(.markdown-alert-tip) { --alert-color: var(--vscode-charts-green); }
  .md-root :global(.markdown-alert-important) { --alert-color: var(--vscode-charts-purple); }
  .md-root :global(.markdown-alert-warning) { --alert-color: var(--vscode-editorWarning-foreground); }
  .md-root :global(.markdown-alert-caution) { --alert-color: var(--vscode-editorError-foreground); }
  .md-root :global(.markdown-alert-title) {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0 0 0.5em;
    color: var(--alert-color);
    font-weight: 600;
  }
  .md-root :global(code), .md-root :global(kbd), .md-root :global(samp) {
    padding: 0.1em 0.3em;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
  }
  .md-root :global(pre) {
    padding: 0.5em 0.7em;
    overflow-x: auto;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border-radius: 4px;
  }
  .md-root :global(pre code) { padding: 0; background: transparent; }
  .md-root :global(hr) { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 1em 0; }
  .md-root :global(.markdown-table) { overflow-x: auto; }
  .md-root :global(table) { border-collapse: collapse; width: 100%; }
  .md-root :global(th), .md-root :global(td) { border: 1px solid var(--vscode-panel-border); padding: 0.5em 0.75em; }
  .md-root :global(img) { max-width: 100%; height: auto; vertical-align: middle; }
  .md-root :global(a[href]) { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  .md-root :global(a[href]:hover) { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
  .md-root :global(a:focus-visible), .md-root :global(summary:focus-visible) { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 2px; }
  .md-root :global(.footnotes) { margin-top: 1.5em; padding-top: 0.75em; border-top: 1px solid var(--vscode-panel-border); font-size: 0.9em; }
  .md-root :global(.sr-only) { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .md-root > :global(:first-child), .md-root :global(blockquote > :first-child) { margin-top: 0; }
  .md-root > :global(:last-child), .md-root :global(blockquote > :last-child), .md-root :global(.markdown-alert > :last-child) { margin-bottom: 0; }
</style>

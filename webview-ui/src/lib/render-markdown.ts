import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import { linkify, type LinkRule } from './linkify';
import { wrappedMarkdownTables } from './wrapped-markdown-tables';

const parser = new Marked({ gfm: true, breaks: false, async: false }).use(
  wrappedMarkdownTables,
  markedFootnote(),
  markedAlert({ variants: [
    { type: 'note', icon: '<i class="codicon codicon-info" aria-hidden="true"></i>' },
    { type: 'tip', icon: '<i class="codicon codicon-lightbulb" aria-hidden="true"></i>' },
    { type: 'important', icon: '<i class="codicon codicon-comment-discussion" aria-hidden="true"></i>' },
    { type: 'warning', icon: '<i class="codicon codicon-warning" aria-hidden="true"></i>' },
    { type: 'caution', icon: '<i class="codicon codicon-error" aria-hidden="true"></i>' },
  ] }),
);

export function renderMarkdown(text: string, rules: LinkRule[]): string {
  const fragment = DOMPurify.sanitize(parser.parse(text, { async: false }), {
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_NAMED_PROPS: true,
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img', 'br', 'div', 'span', 'sup', 'sub', 'section', 'details', 'summary', 'input', 'kbd', 'samp', 'dl', 'dt', 'dd', 'abbr'],
    ALLOWED_ATTR: ['href', 'title', 'id', 'alt', 'src', 'width', 'height', 'align', 'class', 'start', 'checked', 'disabled', 'type', 'aria-label', 'aria-describedby', 'aria-hidden', 'data-footnote-ref', 'data-footnote-backref', 'data-footnotes'],
    ALLOW_DATA_ATTR: false,
  });

  for (const element of fragment.querySelectorAll('[class]')) {
    element.className = [...element.classList].filter(name => /^(?:markdown-alert(?:-(?:note|tip|important|warning|caution|title))?|footnotes|footnote-(?:ref|backref)|task-list-item|contains-task-list|sr-only|codicon(?:-(?:info|lightbulb|comment-discussion|warning|error))?|language-[\w-]+)$/.test(name)).join(' ');
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      link.setAttribute('href', `#user-content-${href.slice(1)}`);
    } else if (!/^https?:\/\//i.test(href)) {
      link.removeAttribute('href');
    }
  }
  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    if (!/^https:\/\//i.test(src)) image.removeAttribute('src');
    else if (/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(src)) {
      image.setAttribute('data-github-src', src);
      image.removeAttribute('src');
      image.setAttribute('hidden', '');
    }
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }
  for (const element of fragment.querySelectorAll('[aria-describedby]')) {
    element.setAttribute('aria-describedby', (element.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => `user-content-${id}`).join(' '));
  }
  for (const input of fragment.querySelectorAll('input')) {
    if (input.getAttribute('type') !== 'checkbox') input.remove();
    else {
      input.setAttribute('disabled', '');
      input.closest('li')?.classList.add('task-list-item');
    }
  }

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a, code, pre')) nodes.push(node);
  }
  for (const node of nodes) {
    const segments = linkify(node.data, rules);
    if (!segments.some(segment => 'url' in segment)) continue;
    node.replaceWith(...segments.map(segment => {
      if (!('url' in segment)) return document.createTextNode(segment.text);
      const link = document.createElement('a');
      link.href = segment.url;
      link.textContent = segment.text;
      return link;
    }));
  }

  const container = document.createElement('div');
  container.append(fragment);
  for (const table of container.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table';
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  return container.innerHTML;
}

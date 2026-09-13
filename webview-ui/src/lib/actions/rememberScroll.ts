import { readViewState, writeViewState } from '../view-state';

type Options = { key: string; ready?: boolean; identity?: string; onRestore?: () => void };

export function rememberScroll(node: HTMLElement, options: Options) {
  let pending = true;
  let frame: number | undefined;
  let saved = readViewState(`scroll:${options.key}`, { top: 0, left: 0, identity: '' });

  function save() {
    if (pending || options.ready === false || !node.clientHeight || !node.clientWidth) return;
    writeViewState(`scroll:${options.key}`, {
      top: node.scrollTop, left: node.scrollLeft, identity: options.identity ?? '',
    });
  }

  function restore() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!pending || options.ready === false || !node.clientHeight || !node.clientWidth) return;
      options.onRestore?.();
      if (saved.identity === (options.identity ?? '')) {
        node.scrollTop = Math.max(0, saved.top);
        node.scrollLeft = Math.max(0, saved.left);
      }
      pending = false;
      node.dispatchEvent(new Event('scroll'));
    });
  }

  node.addEventListener('scroll', save);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
  observer?.observe(node);
  restore();

  return {
    update(next: Options) {
      if (next.key !== options.key || next.identity !== options.identity || (next.ready === false && options.ready !== false)) {
        saved = readViewState(`scroll:${next.key}`, { top: 0, left: 0, identity: '' });
        pending = true;
      }
      options = next;
      restore();
    },
    destroy() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      node.removeEventListener('scroll', save);
    },
  };
}

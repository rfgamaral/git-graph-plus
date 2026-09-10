import { SvelteMap } from 'svelte/reactivity';
import boring from 'boring-avatars-vanilla';
import { getVsCodeApi } from '../vscode-api';

const THEME_COLORS = ['blue', 'green', 'yellow', 'orange', 'purple'];

class AvatarStore {
  private cache = new SvelteMap<string, string>();
  private requested = new Set<string>();
  private fallbacks = new Map<string, string>();
  private colors = $state(this.readThemeColors());

  private key(email: string, size: number): string {
    return `${email.trim().toLowerCase()}:${size}`;
  }

  private readThemeColors() {
    const style = getComputedStyle(document.body);
    return THEME_COLORS.map(name => style.getPropertyValue(`--vscode-charts-${name}`).trim());
  }

  watchTheme() {
    const update = () => {
      const colors = this.readThemeColors();
      if (colors.join() === this.colors.join()) return;
      this.fallbacks.clear();
      this.colors = colors;
    };
    update();
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    return () => observer.disconnect();
  }

  url(email: string, size: number): string {
    const key = this.key(email, size);
    const hit = this.cache.get(key);
    if (hit === undefined && !this.requested.has(key)) {
      this.requested.add(key);
      getVsCodeApi().postMessage({ type: 'getAvatar', payload: { email, size } });
    }
    if (hit) return hit;
    const colors = this.colors;
    let fallback = this.fallbacks.get(key);
    if (!fallback) {
      const svg = boring({ name: email.trim().toLowerCase(), variant: 'bauhaus', colors, size });
      fallback = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      this.fallbacks.set(key, fallback);
    }
    return fallback;
  }

  receive(email: string, size: number, dataUri: string | null): void {
    this.cache.set(this.key(email, size), dataUri ?? '');
  }
}

export const avatarStore = new AvatarStore();

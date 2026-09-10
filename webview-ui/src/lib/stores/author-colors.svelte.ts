import { getVsCodeApi } from '../vscode-api';

class AuthorColorsStore {
  colors = $state<Record<string, string>>({});
  picker = $state<{ email: string; x: number; y: number } | null>(null);

  color(email: string) {
    const color = this.colors[email.trim().toLowerCase()];
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
  }

  open(email: string, x: number, y: number) {
    if (email.trim()) this.picker = { email: email.trim().toLowerCase(), x, y };
  }

  save(color: string | null) {
    if (!this.picker || (color !== null && !/^#[0-9a-f]{6}$/i.test(color))) return;
    getVsCodeApi().postMessage({ type: 'saveAuthorColor', payload: { email: this.picker.email, color } });
    this.picker = null;
  }

  receive(email: string, color: string | null) {
    const colors = { ...this.colors };
    if (color === null) delete colors[email];
    else colors[email] = color;
    this.colors = colors;
  }
}

export const authorColorsStore = new AuthorColorsStore();

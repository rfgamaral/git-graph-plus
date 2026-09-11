import type { MarkedExtension, Tokens } from 'marked';

export const wrappedMarkdownTables: MarkedExtension = {
  tokenizer: {
    table(src) {
      if (!src.startsWith('|')) return false;
      const raw = src.split(/\n[ \t]*\n/, 1)[0].trimEnd();
      if (/\\\|/.test(raw)) return false;
      const lines = raw.split('\n');
      if (lines.some(line => /^(?:[ \t]*(?:`{3,}|~{3,}|#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s)| {4}|\t)/.test(line))) return false;
      const separator = lines.findIndex(line => /^\|(?:[ \t]*:?-{3,}:?[ \t]*\|){2,}[ \t]*$/.test(line));
      if (separator < 1) return false;
      const columns = lines[separator].split('|').length - 2;
      const header = lines.slice(0, separator).map(line => line.trim()).join(' ');
      if (!header.endsWith('|') || header.split('|').length !== columns + 2) return false;

      const rows: string[] = [];
      let parts: string[] = [];
      let pipes = 0;
      let wrapped = separator > 1;
      for (const line of lines.slice(separator + 1)) {
        const part = line.trim();
        if (part !== '|' && part.startsWith('|') && part.endsWith('|')) {
          if (parts.length) return false;
          rows.push(part);
          continue;
        }
        if (parts.length === 0 && !part.startsWith('|')) return false;
        parts.push(part);
        pipes += part.split('|').length - 1;
        if (pipes > columns + 1) return false;
        if (pipes === columns + 1) {
          if (!part.endsWith('|')) return false;
          wrapped ||= parts.length > 1;
          rows.push(parts.join(' '));
          parts = [];
          pipes = 0;
        }
      }
      if (!wrapped || parts.length || !rows.length) return false;

      const repaired = [header, lines[separator], ...rows].join('\n');
      const tokens = this.lexer.blockTokens(repaired);
      if (tokens.length !== 1 || tokens[0].type !== 'table') return false;
      tokens[0].raw = raw;
      return tokens[0] as Tokens.Table;
    },
  },
};

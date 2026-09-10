import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  test: {
    projects: [
      {
        // Backend: extension host code, runs against the real `git` CLI in
        // a node environment with no DOM shims.
        extends: true,
        test: {
          name: 'backend',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          // Integration tests spawn real git/git-flow/git-lfs processes and
          // can exceed the default 5s budget on slower runners (CI). Raise
          // both the test timeout and the per-hook timeout for setup/cleanup.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        // Webview: Svelte 5 components and rune-based stores. happy-dom
        // gives us DOM + window + microtask scheduling that Svelte's
        // reactivity expects without paying jsdom's startup cost.
        extends: true,
        plugins: [svelte({ hot: false })],
        resolve: {
          conditions: ['browser'],
        },
        test: {
          name: 'webview',
          include: ['webview-ui/src/**/*.test.ts'],
          // The shared setup file does not match the include glob (no
          // `.test.ts` suffix), but we still need it loaded before each
          // test file — that's what setupFiles is for.
          setupFiles: ['webview-ui/src/__tests__/setup.ts'],
          environment: 'happy-dom',
          // @testing-library/svelte ships rune-using helpers in `.svelte.js`
          // files inside node_modules; vite externalises those by default,
          // which strips them of svelte preprocessing. Inline so the svelte
          // plugin compiles them and `$state` resolves at runtime.
          server: { deps: { inline: [/@testing-library\/svelte/] } },
        },
      },
    ],
  },
});

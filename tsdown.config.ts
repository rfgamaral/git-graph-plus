import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  fixedExtension: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: [/.*/],
  },
});

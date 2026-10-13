// dist/inject/: the same app as a classic IIFE script + one CSS file, for dist/spotify-inject.js
// (the host runs `js` as part of its init script, so no import/export and no type=module).
// tools/postbuild.js wraps the pair into the {html, css, js} JSON.
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function pageBuild(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return 'local-' + execSync('git rev-parse --short HEAD').toString().trim() + '-' + Date.now(); } catch { return 'local-' + Date.now(); }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // __PAGE_BUILD__ keys what ui/persist.ts keeps between launches: a CI build is its commit; a local
  // one is unique, so a working tree's changed data shapes never meet an older build's results.
  define: { 'process.env.NODE_ENV': '"production"', __PAGE_BUILD__: JSON.stringify(pageBuild()) },
  build: {
    outDir: 'dist/inject',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'AlchemyPage',
      fileName: () => 'page.js',
      cssFileName: 'page',
    },
  },
});

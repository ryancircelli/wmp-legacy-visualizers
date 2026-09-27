// dist/inject/: the same app as a classic IIFE script + one CSS file, for dist/spotify-inject.js
// (the host runs `js` as part of its init script, so no import/export and no type=module).
// tools/postbuild.js wraps the pair into the {html, css, js} JSON.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': '"production"' },
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

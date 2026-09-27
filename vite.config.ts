// The page: dist/index.html as one self-contained file (vite-plugin-singlefile).
// `npm run build` also runs vite.inject.config.ts (dist/spotify-inject.js's classic script),
// vite.engine.config.ts (dist/engine.js for the A/B tools) and tools/postbuild.js.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { target: 'es2022', modulePreload: { polyfill: false } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});

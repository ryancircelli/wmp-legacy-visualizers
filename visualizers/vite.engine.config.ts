// dist/engine.js: the engine alone as a classic IIFE that sets window.Alchemy (src/global.ts).
// The A/B drivers (the private harness) load this file, so the exactness gate
// runs the same TypeScript -> esbuild -> minify pipeline the page ships.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    target: 'es2022',
    lib: { entry: 'src/global.ts', formats: ['iife'], name: 'AlchemyEngine', fileName: () => 'engine.js' },
  },
});

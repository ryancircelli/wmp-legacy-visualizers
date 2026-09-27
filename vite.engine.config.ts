// dist/engine.js: the engine alone as a classic IIFE that sets window.Alchemy (src/engine/global.ts).
// The A/B drivers (tools/js_render*.js, js_bat.js, js_bars.js) load this file, so the exactness gate
// runs the same TypeScript -> esbuild -> minify pipeline the page ships.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    target: 'es2022',
    lib: { entry: 'src/engine/global.ts', formats: ['iife'], name: 'AlchemyEngine', fileName: () => 'engine.js' },
  },
});

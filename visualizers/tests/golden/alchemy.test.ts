// @vitest-environment node
// Golden guard, alchemy runs on the WebAssembly gather + blur (see ./harness.ts). npm test checks a
// prefix; npm run test:golden all of it. alchemy-js/alchemy-mixed run the same fixtures on the JS
// path and on a path that flips between the two every 37 frames.
import { goldenSuite } from './suite';

goldenSuite('alchemy', 'wasm');

// @vitest-environment node
// Golden guard, bars runs on the WebAssembly drawing (see ./harness.ts). npm test checks a prefix;
// npm run test:golden all of it. bars-js/bars-mixed run the same fixtures on the JS path and on a
// path that flips between the two every 37 frames.
import { goldenSuite } from './suite';

goldenSuite('bars', 'wasm');

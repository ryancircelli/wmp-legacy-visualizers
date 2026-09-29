// @vitest-environment node
// Golden guard, battery runs on the WebAssembly warp/blur/palette (see ./harness.ts). npm test checks
// a prefix; npm run test:golden all of it. battery-js/battery-mixed run the same fixtures on the JS
// path and on a path that flips between the two every 37 frames.
import { goldenSuite } from './suite';

goldenSuite('battery', 'wasm');

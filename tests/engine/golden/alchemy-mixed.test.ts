// @vitest-environment node
// Golden guard, alchemy runs switching between the WASM and JS gather + blur every 37 frames
// (see ./alchemy.test.ts): a mid-run switch must not change a byte.
import { goldenSuite } from './suite';

goldenSuite('alchemy', 'alternate');

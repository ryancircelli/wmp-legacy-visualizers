// @vitest-environment node
// Golden guard, bars runs switching between the WASM and JS drawing every 37 frames
// (see ./bars.test.ts): a mid-run switch must not change a byte.
import { goldenSuite } from './suite';

goldenSuite('bars', 'alternate');

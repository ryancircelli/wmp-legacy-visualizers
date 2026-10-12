// @vitest-environment node
// Golden guard, battery runs switching between the WASM and JS blur/palette every 37 frames
// (see ./battery.test.ts): a mid-run switch must not change a byte.
import { goldenSuite } from './suite';

goldenSuite('battery', 'alternate');

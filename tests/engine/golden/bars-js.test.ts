// @vitest-environment node
// Golden guard, bars runs on the JavaScript drawing (see ./bars.test.ts).
import { goldenSuite } from './suite';

goldenSuite('bars', 'js');

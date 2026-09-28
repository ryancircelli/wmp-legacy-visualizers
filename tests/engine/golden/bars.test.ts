// @vitest-environment node
// Golden guard, bars runs (see ./harness.ts). npm test checks a prefix; npm run test:golden all of it.
import { goldenSuite } from './suite';

goldenSuite('bars');

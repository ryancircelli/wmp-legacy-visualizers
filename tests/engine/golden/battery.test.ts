// @vitest-environment node
// Golden guard, battery runs (see ./harness.ts). npm test checks a prefix; npm run test:golden all of it.
import { goldenSuite } from './suite';

goldenSuite('battery');

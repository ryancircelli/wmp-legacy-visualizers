// @vitest-environment node
// Golden guard, alchemy runs on the JavaScript gather + blur (see ./alchemy.test.ts).
import { goldenSuite } from './suite';

goldenSuite('alchemy', 'js');

// The vitest side of the golden guard (./harness.ts): one test file per visualizer so the three
// run in parallel workers.
//   npm test               -> a short prefix of every run marked `short`
//   npm run test:golden    -> every run in full (GOLDEN=full)
//   GOLDEN_UPDATE=1 npx vitest run tests/engine/golden
//                          -> rewrite ./fixtures (only ever from a known-exact engine)
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK, RUNS, firstDivergence, runGolden, type Vis } from './harness';

const FULL = process.env.GOLDEN === 'full';
const UPDATE = !!process.env.GOLDEN_UPDATE;

export function goldenSuite(vis: Vis): void {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', vis + '.json');
  const fixture: Record<string, string[]> = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>) : {};
  const fresh: Record<string, string[]> = {};
  const runs = RUNS.filter((r) => r.vis === vis && (FULL || UPDATE || r.short > 0));
  describe(`golden ${vis} (${FULL || UPDATE ? 'full' : 'short prefix'}, ${BLOCK}-frame blocks)`, () => {
    for (const run of runs) {
      const frames = FULL || UPDATE ? run.frames : run.short;
      it(`${run.id} x ${frames} frames`, () => {
        const got = runGolden(run, frames);
        if (UPDATE) { fresh[run.id] = got; return; }
        expect(firstDivergence(run, got, fixture[run.id])).toBe(null);
      }, 600_000);
    }
    afterAll(() => {
      if (UPDATE) writeFileSync(file, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
    });
  });
}

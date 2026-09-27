// node --test deno-webview/rebuild.test.mjs — the dev watch loop (rebuild.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coalesce, watchAndRebuild } from './rebuild.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What sed -i / git checkout do: a new file renamed over the old one. */
const replace = (f, text) => { fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); };

test('a burst is one run; a change during a run queues exactly one more', async () => {
  let runs = 0;
  const poke = coalesce(async () => { runs++; await sleep(200); }, 50);
  for (let i = 0; i < 20; i++) poke();
  await sleep(120);
  assert.equal(runs, 1);
  poke(); poke(); poke();             // lands while the first run is still going
  await sleep(500);
  assert.equal(runs, 2);
});

test('a pull-sized burst of replaced files rebuilds once, and replaced files stay watched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-'));
  const src = path.join(dir, 'src'), sub = path.join(src, 'ui');
  fs.mkdirSync(sub, { recursive: true });
  const files = Array.from({ length: 50 }, (_, i) => path.join(i % 2 ? sub : src, `f${i}.ts`));
  files.forEach((f) => fs.writeFileSync(f, 'a'));
  const cfg = path.join(dir, 'vite.inject.config.ts');
  fs.writeFileSync(cfg, 'x');
  let runs = 0;
  const stop = watchAndRebuild({ dirs: [src], files: [cfg], run: () => { runs++; }, ms: 300 });
  try {
    await sleep(100);
    files.forEach((f) => replace(f, 'b'));          // "git pull"
    await sleep(900);
    assert.equal(runs, 1, 'one rebuild for the whole pull');
    fs.appendFileSync(files[7], 'c');                // an in-place edit of a file that was replaced
    await sleep(900);
    assert.equal(runs, 2, 'the replaced file is still watched');
    replace(cfg, 'y');                               // a replaced single file (vite config)
    await sleep(900);
    assert.equal(runs, 3);
    fs.appendFileSync(cfg, 'z');
    await sleep(900);
    assert.equal(runs, 4, 'and still watched after being replaced');
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

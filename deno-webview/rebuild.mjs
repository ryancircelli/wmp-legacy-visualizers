// The dev watch loop for dev.mjs: rebuild once per burst of changes, however the files change.
//
// Rollup's own watcher (vite build --watch) watches the files it saw, by inode: a file replaced
// rather than written in place (sed -i, git checkout, git pull) drops out and is never watched
// again. This watches directories instead, so a replaced file is just another
// event, and debounces: a `git pull` that rewrites fifty files is one rebuild. A change that lands
// while a build runs queues exactly one more build after it.
import fs from 'node:fs';
import path from 'node:path';

/** Call `run` once `ms` after the last of a burst of `poke()`s; never two runs at once. */
export function coalesce(run, ms = 300) {
  let timer = null, running = false, again = false;
  const fire = async () => {
    timer = null;
    if (running) { again = true; return; }
    running = true;
    try { await run(); } catch (e) { console.error(e); }
    running = false;
    if (again) { again = false; poke(); }
  };
  const poke = () => { if (timer) clearTimeout(timer); timer = setTimeout(fire, ms); };
  return poke;
}

/** Watch `dirs` recursively and `files` one by one; `run` once per settled burst. Returns stop().
 * Every directory gets its own non-recursive watch: Node's `recursive: true` on Linux watches each
 * file, which is the same lost-after-replace trap (measured). A directory watch reports its
 * children by name however they change; new subdirectories are picked up as they appear. */
export function watchAndRebuild({ dirs = [], files = [], run, ms = 300, ignore = () => false }) {
  const poke = coalesce(run, ms);
  const ws = new Map();
  const watchDir = (d) => {
    if (ws.has(d)) return;
    let w;
    try {
      w = fs.watch(d, (_e, f) => {
        const name = String(f || '');
        if (ignore(name)) return;
        const full = path.join(d, name);
        try { if (name && fs.statSync(full).isDirectory()) walk(full); } catch { /* gone */ }
        poke();
      });
    } catch { return; }
    w.on('error', () => { w.close(); ws.delete(d); });
    ws.set(d, w);
  };
  const walk = (d) => {
    watchDir(d);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name));
  };
  dirs.forEach(walk);
  // A single file is watched through its directory (by name), so replacing it is still seen.
  const singles = files.map((f) => {
    const name = path.basename(f);
    return fs.watch(path.dirname(f), (_e, n) => { if (String(n) === name) poke(); });
  });
  return () => { ws.forEach((w) => w.close()); singles.forEach((w) => w.close()); };
}

// npm run dev:spotify — WmpSpotify's host against live sources, one command.
//
// `vite build -c vite.inject.config.ts` on every settled change to src/, index.html or a vite config
// (rebuild.mjs: directory watches, 300 ms debounce — Rollup's own watch loses replaced files),
// re-wrapping dist/spotify-inject.js after every build, then the host with --mode=spotify --dev: CSS changes swap in place, script or markup
// changes reload the page (open.spotify.com's CSP blocks Vite's HMR client, so there is no HMR).
// The website has real HMR: `npm run dev`.
//
// The host is Windows-only (WebView2), the repo may live in WSL: from WSL the host is started with
// the Windows deno through powershell.exe on the \\wsl$ path; on Windows it is `deno task dev:spotify`.
// Closing the window ends the host; this script then stops watching and exits.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { watchAndRebuild } from './rebuild.mjs';

const mode = 'spotify';
const HOST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HOST_DIR, '..'), DIST = path.join(ROOT, 'dist');
process.chdir(ROOT);

/** tools/postbuild.js's wrap, alone: it also rewrites alchemy.html and the site files, which a
 * watch loop has no business touching. */
function wrapInject() {
  const inj = path.join(DIST, 'inject'), out = path.join(DIST, 'spotify-inject.js');
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  const page = read(path.join(DIST, 'index.html'));
  let html = (/<body[^>]*>([\s\S]*)<\/body>/.exec(page) || ['', ''])[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
  if (!html) html = (JSON.parse(read(out) || '{}').html) || '<div id="root"></div>';
  const next = JSON.stringify({ html, css: read(path.join(inj, 'page.css')), js: read(path.join(inj, 'page.js')) });
  if (next !== read(out)) fs.writeFileSync(out, next);
}

function startHost() {
  const args = ['run', '-A', '--unstable-ffi'];
  const hostArgs = [`--mode=${mode}`, '--dev'];
  let child;
  if (process.platform === 'win32') {
    child = spawn('deno', ['task', `dev:${mode}`], { cwd: HOST_DIR, stdio: 'inherit' });
  } else {
    const main = execFileSync('wslpath', ['-w', path.join(HOST_DIR, 'main.ts')], { encoding: 'utf8' }).trim();
    const cmd = `& deno ${args.join(' ')} '${main}' ${hostArgs.join(' ')}`;
    child = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { cwd: '/mnt/c', stdio: 'inherit' });
  }
  console.log(`dev: host started (${mode})`);
  return child;
}

async function rebuild() {
  try {
    await build({ configFile: 'vite.inject.config.ts', logLevel: 'warn' });
    wrapInject();
    console.log(`dev: dist/spotify-inject.js rebuilt ${new Date().toLocaleTimeString()}`);
  } catch (e) { console.error('dev: build failed:', e.message); }
}
await rebuild();
const stop = watchAndRebuild({
  dirs: [path.join(ROOT, 'src')],
  files: ['index.html', 'vite.config.ts', 'vite.inject.config.ts'].map((f) => path.join(ROOT, f)),
  run: rebuild,
});
const host = startHost();
host.on('exit', (code) => { stop(); process.exit(code ?? 0); });
process.on('SIGINT', () => { host.kill(); stop(); process.exit(130); });

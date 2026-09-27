// npm run build, last step (replaces build.py + site/make_dist.py):
//   dist/spotify-inject.js  JSON {html, css, js} (CONTRACT.md v6) from dist/inject/ (vite.inject.config.ts)
//   alchemy.html            copy of dist/index.html; dist/alchemy.html too (stable download name)
//   dist/_headers, dist/_redirects  as site/make_dist.py wrote them
//   dist/version.json       {"version": <git sha>} as deno/build.ts wrote it ($GITHUB_SHA / $GIT_SHA / git rev-parse / "dev")
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), DIST = path.join(ROOT, 'dist'), INJ = path.join(DIST, 'inject');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

const page = read(path.join(DIST, 'index.html'));
// html = the body's markup minus scripts: just the mount node.
const body = (/<body[^>]*>([\s\S]*)<\/body>/.exec(page) || ['', ''])[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const inject = { html: body, css: read(path.join(INJ, 'page.css')), js: read(path.join(INJ, 'page.js')) };
fs.writeFileSync(path.join(DIST, 'spotify-inject.js'), JSON.stringify(inject));
fs.rmSync(INJ, { recursive: true, force: true });

fs.copyFileSync(path.join(DIST, 'index.html'), path.join(ROOT, 'alchemy.html'));
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, 'alchemy.html'));
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  Cache-Control: public, max-age=300
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: microphone=(self), display-capture=(self), autoplay=(self)
`);
fs.writeFileSync(path.join(DIST, '_redirects'), '/alchemy /alchemy.html 200\n');
function gitSha() {
  const env = process.env.GITHUB_SHA || process.env.GIT_SHA;
  if (env) return env;
  try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return 'dev'; }
}
fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify({ version: gitSha() }) + '\n');
for (const f of fs.readdirSync(DIST).sort()) console.log(`  dist/${f}  ${(fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1)} KiB`);

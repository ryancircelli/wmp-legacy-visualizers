// npm run build, last step (replaces build.py + site/make_dist.py):
//   dist/spotify-inject.js  JSON {html, css, js} (CONTRACT.md v6) from dist/inject/ (vite.inject.config.ts)
//   alchemy.html            copy of dist/index.html; dist/alchemy.html too (stable download name)
//   dist/_headers, dist/_redirects  as site/make_dist.py wrote them
//   dist/version.json       {"version": <git sha>} as deno/build.ts wrote it ($GITHUB_SHA / $GIT_SHA / git rev-parse / "dev")
//   dist/update.json        the page update manifest (deno-webview/update.ts); CI signs it (tools/sign-update.js)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
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

// dist/update.json: what a page update is (deno-webview/update.ts). Deployed and signed by CI for the
// exes to fetch; also embedded in each exe as the manifest of the page it was built with.
const git = (...a) => { try { return cp.execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// the host's identity: its tracked sources, minus docs, tests and dev-only tools
const HOST_SKIP = /(\.md|_test\.ts|\.test\.mjs|\/dev\.mjs|\/rebuild\.mjs)$/;
const hostFiles = git('ls-files', 'deno-webview').split('\n').filter((f) => f && !HOST_SKIP.test(f)).sort();
const host = hostFiles.length
  ? sha256(hostFiles.map((f) => f + '\0' + sha256(fs.readFileSync(path.join(ROOT, f))) + '\n').join('')).slice(0, 16)
  : 'unknown';
const update = {
  version: gitSha(),
  built: Number(git('log', '-1', '--format=%ct')) || 0,
  needs: JSON.parse(read(path.join(ROOT, 'deno-webview', 'host-api.json'))).hostApi,
  host,
  files: Object.fromEntries(['index.html', 'spotify-inject.js'].map((f) => [f, sha256(fs.readFileSync(path.join(DIST, f)))])),
};
fs.writeFileSync(path.join(DIST, 'update.json'), JSON.stringify(update) + '\n');
for (const f of fs.readdirSync(DIST).sort()) console.log(`  dist/${f}  ${(fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1)} KiB`);

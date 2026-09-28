// CI, deploy only: signs dist/update.json into dist/update.json.sig (base64 Ed25519) with
// UPDATE_SIGNING_KEY (base64 PKCS#8 DER; a GitHub secret, never in the repo). The exes verify it
// with the public half baked into deno-webview/update.ts before they take a page update.
//   node tools/sign-update.js [distDir]
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'dist');
const key = process.env.UPDATE_SIGNING_KEY;
if (!key) { console.error('sign-update: UPDATE_SIGNING_KEY is not set'); process.exit(1); }
const pk = crypto.createPrivateKey({ key: Buffer.from(key.trim(), 'base64'), format: 'der', type: 'pkcs8' });
const manifest = fs.readFileSync(path.join(dir, 'update.json'));
fs.writeFileSync(path.join(dir, 'update.json.sig'), crypto.sign(null, manifest, pk).toString('base64') + '\n');
console.log(`sign-update: signed ${JSON.parse(manifest).version.slice(0, 7)}`);

// NODE_PATH=$(npm root -g) node tests/gl.smoke.js  (after npm run build)
// The WebGL2 presenter (src/engine/gl.ts) against the 2D path it replaces, on the same frame:
// channel order, Bars and Waves texel for texel, Alchemy's cubic (Mitchell-Netravali 1/3, 1/3 was
// the closest of three to imageSmoothingQuality 'high', measured 2026-09-28: max 1 level against
// 34 for a B-spline and 18 for Catmull-Rom), Battery nearest. Battery is drawn from its 8-bit frame
// and palette (drawIndexed) until something reads px: that draw must be the one of px expanded on
// the CPU, pixel for pixel, on the same frame and on frames through a palette fade. ?gl=1: headless
// WebGL is software, which the page otherwise declines.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const HTML = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'alchemy.html');

const b = await chromium.launch();
for (const [vis, preset, limit] of [['bars', 0, { max: 0 }], ['alchemy', 0, { max: 1 }], ['battery', 5, { share: 0.01 }]]) {
  const p = await b.newPage({ viewport: { width: 1100, height: 720 } });
  await p.goto(`${HTML}?gl=1&src=tone&vis=${vis}&preset=${preset}`);
  await p.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const S = Alchemy.Shell, e = S.engine, view = document.getElementById('view');
    S.paused = true;
    const s = e.render(S.level), W = view.width, H = view.height, gl = view.getContext('webgl2');
    const grab = () => { const g = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, g); return g; };
    const differ = (a, b) => a.reduce((n, v, i) => n + (v !== b[i]), 0);
    // Battery: drawn before anything reads px, so from its indices and palette
    const indexed = !!s.idx;
    if (indexed) e.present();
    const g0 = indexed ? grab() : null;
    // the 2D path, same frame
    const tmp = document.createElement('canvas'); tmp.width = s.w; tmp.height = s.h;
    const tx = tmp.getContext('2d'), img = tx.createImageData(s.w, s.h), o32 = new Uint32Array(img.data.buffer);
    for (let i = 0; i < s.px.length; i++) { const q = s.px[i]; o32[i] = 0xff000000 | ((q & 0xff) << 16) | (q & 0xff00) | ((q >>> 16) & 0xff); }
    tx.putImageData(img, 0, 0);
    const ref = document.createElement('canvas'); ref.width = W; ref.height = H;
    const rx = ref.getContext('2d'); rx.imageSmoothingEnabled = e.kind !== 'battery'; rx.imageSmoothingQuality = 'high';
    rx.drawImage(tmp, 0, 0, W, H);
    const a = rx.getImageData(0, 0, W, H).data;
    e.present();                                  // px has been read: drawn from px
    const g1 = grab(), g = g0 || g1, cpu = g0 ? differ(g0, g1) : 0;
    let max = 0, over = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[(y * W + x) * 4 + c] - g[((H - 1 - y) * W + x) * 4 + c]);
      if (d > max) max = d;
      if (d > 2) over++;
    }
    // channel order: one known colour through the GPU path
    s.px.fill(0x123456); e.present();
    const one = new Uint8Array(4); gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
    // Battery through a palette fade: each frame from its indices, then the same frame from px
    const fade = [];
    if (indexed) {
      const at = () => /fade (\d+)\/(\d+)/.exec(e.debug().palette);
      for (let i = 0; i < 3000; i++) { const m = at(); if (m && m[2] - m[1] > 4) break; e.render(S.level); }
      let prev = null;
      for (let k = 0; k < 4; k++) {
        const f = e.render(S.level), was = !!f.idx, pal = [...f.pal];
        e.present(); const a = grab(); void f.px; e.present();
        fade.push({ at: e.debug().palette, was, differ: differ(a, grab()), newPal: !!prev && pal.some((v, i) => v !== prev[i]) });
        prev = pal;
      }
    }
    return { present: e.debug().present, max, share: over / (W * H * 3), one: [...one], indexed, cpu, fade };
  });
  assert.strictEqual(r.present, 'webgl2', vis + ': not on the WebGL2 path');
  assert.strictEqual(r.indexed, vis === 'battery', vis + ': drawn from indices ' + r.indexed);
  assert.strictEqual(r.cpu, 0, vis + ': the GPU palette lookup differs from px in ' + r.cpu + ' bytes');
  if (r.indexed) {
    assert.strictEqual(r.fade.length, 4, 'battery: no palette fade reached');
    for (const [k, f] of r.fade.entries()) {
      assert(f.was && /fade/.test(f.at) && f.differ === 0, 'battery fade frame ' + k + ': ' + JSON.stringify(f));
    }
    assert(r.fade.some((f) => f.newPal), 'battery: the palette did not move across the fade frames');
    console.log(`  battery: GPU palette = CPU px on the frame and 4 fade frames (${r.fade.map((f) => f.at).join(', ')})`);
  }
  assert.deepStrictEqual(r.one, [0x12, 0x34, 0x56, 255], vis + ': channel order ' + r.one);
  if ('max' in limit) assert(r.max <= limit.max, `${vis}: max difference ${r.max} > ${limit.max}`);
  // Battery: headless Skia steps columns in fixed point and takes the lower texel at a few exact ties
  if ('share' in limit) assert(r.share <= limit.share, `${vis}: ${(r.share * 100).toFixed(2)}% of channels differ`);
  console.log(`  ${vis}: max ${r.max}, ${(r.share * 100).toFixed(2)}% over 2`);
  await p.close();
}
await b.close();
console.log('gl smoke: all checks passed');

// node js_bat.js frames.bin outdir preset maxFrames seed [idxEvery]
// Port-side twin of hostP.ps1 -Vis battery: 384x288 engine, nearest upscale to 640x480, the same
// per-frame FNV-1a (B,G,R), per-frame rand() count, and the palette control block every frame.
// One probe render first (zero level, state 2), like the host's Prepare().  No PROBEPAL rewind.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
// The engine under test: dist/engine.js from `npm run build:engine` (src/engine/*.ts as one classic
// script that sets window.Alchemy). ALCHEMY_ENGINE=<path> points it at another build.
const ENGINE = process.env.ALCHEMY_ENGINE || path.join(__dirname, '..', 'dist', 'engine.js');
const [binPath, outDir] = process.argv.slice(2);
const preset = +(process.argv[4] || 0), maxF = +(process.argv[5] || 0), seed = +(process.argv[6] || 1700000000);
const idxEvery = +(process.argv[7] || 0);

const fakeDate = { now: () => seed * 1000 };
const sandbox = {
  window: {}, Math, Date: fakeDate, console, Object, Array, Number, String, JSON, isNaN, parseInt, parseFloat,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, Uint8ClampedArray, ArrayBuffer
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ENGINE, 'utf8'), sandbox, { filename: ENGINE });
const AL = sandbox.window.Alchemy;

const NW = 384, NH = 288, W = 640, H = 480, PER = 4100;
fs.mkdirSync(outDir, { recursive: true });
const XMAP = new Int32Array(W), YMAP = new Int32Array(H);
for (let x = 0; x < W; x++) XMAP[x] = (x * NW / W) | 0;
for (let y = 0; y < H; y++) YMAP[y] = (y * NH / H) | 0;
const up = new Uint32Array(W * H);
function upscale(px) {
  for (let y = 0; y < H; y++) { const sr = YMAP[y] * NW, dr = y * W;
    for (let x = 0; x < W; x++) up[dr + x] = px[sr + XMAP[x]]; }
  return up;
}
function fnv32(px) {
  let h = 2166136261;
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    h = Math.imul(h ^ (v & 255), 16777619);
    h = Math.imul(h ^ ((v >> 8) & 255), 16777619);
    h = Math.imul(h ^ ((v >> 16) & 255), 16777619);
  }
  return h >>> 0;
}
function fnvPal(p) {                      // PALETTEENTRY{R,G,B,flags} x 256, as the host reads it
  let h = 2166136261;
  for (let i = 0; i < 1024; i++) h = Math.imul(h ^ p[i], 16777619);
  return h >>> 0;
}

let randN = 0;
const realRand = AL.rand;
AL.rand = function () { randN++; return realRand(); };

const eng = new AL.Battery({ width: NW, height: NH, options: {} });
const ctorDraws = randN;
eng.setPreset(preset);
const afterSet = randN;
console.log('ctor draws=' + ctorDraws + ' after setPreset=' + afterSet);

const level = { freq: [new Uint8Array(1024), new Uint8Array(1024)],
                wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };
const live = [];
const pal = ['frame,paused,autocycle,countdown,req,fading,dirty,fadeLen,fadeCtr,hFROM,hLIVE,hTO'];
function palRow(f) {
  return [f, eng.palettePaused ? 1 : 0, eng.paletteAutoCycle ? 1 : 0, eng.paletteChangeCountdown,
    eng.paletteChangeRequested ? 1 : 0, eng.paletteFading ? 1 : 0, eng.paletteDirty ? 1 : 0,
    eng.paletteFadeLen, eng.paletteFadeCtr,
    fnvPal(eng.FROM).toString(16), fnvPal(eng.LIVE).toString(16), fnvPal(eng.TO).toString(16)].join(',');
}
function fnv8(b) {                        // FNV-1a over the 8-bit FRONT surface, as hostP's IdxHash
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return h >>> 0;
}
const rows = ['frame,rand,ihash,hash,mean_lum'];
const buf = fs.readFileSync(binPath);
let n = Math.floor(buf.length / PER);
if (maxF > 0 && maxF < n) n = maxF;
for (let f = -1; f < n; f++) {
  if (f < 0) {
    level.freq[0].fill(0); level.freq[1].fill(0); level.wave[0].fill(0); level.wave[1].fill(0);
    level.state = 2; level.timeStamp = 0;
  } else {
    const off = f * PER;
    for (let c = 0; c < 2; c++) {
      buf.copy(level.freq[c], 0, off + c * 1024, off + (c + 1) * 1024);
      buf.copy(level.wave[c], 0, off + 2048 + c * 1024, off + 2048 + (c + 1) * 1024);
    }
    level.state = buf.readInt32LE(off + 4096);
    level.timeStamp = f * 166667;
  }
  const r0 = randN;
  const surf = eng.render(level);
  const u = upscale(surf.px);
  let lsum = 0;
  for (let i = 0; i < u.length; i++) {
    const v = u[i];
    lsum += (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5) | 0;
  }
  rows.push(f + ',' + (randN - r0) + ',' + fnv8(eng.front).toString(16).padStart(8, '0') + ',' +
            fnv32(u).toString(16) + ',' + (lsum / u.length).toFixed(5));
  if (idxEvery > 0 && (f < 0 || (f % idxEvery) === 0))
  { var tag = f < 0 ? '-001' : String(f).padStart(4, '0');
    fs.writeFileSync(path.join(outDir, 'frame_' + tag + '.idx'), Buffer.from(eng.front));
    fs.writeFileSync(path.join(outDir, 'frame_' + tag + '.bidx'), Buffer.from(eng.back)); }
  pal.push(palRow(f));
  live.push(f + ',' + Array.from({ length: 256 }, function (_, i) {
    return eng.LIVE[i * 4] + ',' + eng.LIVE[i * 4 + 1] + ',' + eng.LIVE[i * 4 + 2]; }).join(' '));
}
fs.writeFileSync(path.join(outDir, 'stats.csv'), rows.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'pal.csv'), pal.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'live.csv'), live.join('\n') + '\n');
console.log('total rand=' + randN);

// node js_renderP.js frames.bin outdir maxFrames seed [rawFrames=csv list]
// Port-side twin of hostP.ps1: same 640x480 surface, same per-frame FNV-1a hash (B,G,R order),
// per-frame rand() call count, and raw BGRX dumps for named frames.
// Renders ONE extra zero-audio probe frame first (state=2, freq=0, wave=0) because the DLL host's
// Prepare() does exactly that before frame 0.  Port frame i+1 == DLL frame i.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

// The engine under test: dist/engine.js from `npm run build:engine` (src/engine/*.ts as one classic
// script that sets window.Alchemy). ALCHEMY_ENGINE=<path> points it at another build.
const ENGINE = process.env.ALCHEMY_ENGINE || path.join(__dirname, '..', 'dist', 'engine.js');
const sandbox = {
  window: {}, Math, Date, console, Object, Array, Number, String, JSON,
  Uint8Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ENGINE, 'utf8'), sandbox, { filename: ENGINE });
const AL = sandbox.window.Alchemy;

const W = 640, H = 480, PER = 4100;
const [binPath, outDir] = process.argv.slice(2);
const maxF = +(process.argv[4] || 0), seed = +(process.argv[5] || 1700000000);
const rawSet = new Set((process.argv[6] || '').split(',').filter(Boolean).map(Number));
fs.mkdirSync(outDir, { recursive: true });

// ---- rand instrumentation: count draws per frame, and keep the whole value sequence
let randN = 0;
const seq = [];
const realRand = AL.rand;
AL.rand = function () { const v = realRand(); randN++; seq.push(v); return v; };

const buf = fs.readFileSync(binPath);
let n = Math.floor(buf.length / PER);
if (maxF > 0 && maxF < n) n = maxF;

const engine = new AL.Engine({ width: W, height: H, options: { intended: false } });
engine.seed(seed);
const ctorDraws = randN;

const level = { freq: [new Uint8Array(1024), new Uint8Array(1024)],
                wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };

function fnv(px) {
  let h = 2166136261;
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    h = Math.imul(h ^ (v & 255), 16777619);
    h = Math.imul(h ^ ((v >> 8) & 255), 16777619);
    h = Math.imul(h ^ ((v >> 16) & 255), 16777619);
  }
  return h >>> 0;
}
function saveRaw(file, px) {
  const o = Buffer.alloc(px.length * 4);
  for (let i = 0; i < px.length; i++) o.writeUInt32LE(px[i] >>> 0, i * 4);
  fs.writeFileSync(file, o);
}

const rows = ['frame,rand,hash,mean_lum'];
const marks = [];
// frame -1 = the probe: all-zero TimedLevel, state 2
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
  marks.push(randN);
  const r0 = randN;
  const surf = engine.render(level);
  let lsum = 0;
  for (let i = 0; i < surf.px.length; i++) {
    const v = surf.px[i];
    lsum += (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5) | 0;
  }
  rows.push(f + ',' + (randN - r0) + ',' + fnv(surf.px).toString(16) + ',' + (lsum / surf.px.length).toFixed(5));
  if (rawSet.has(f)) saveRaw(path.join(outDir, 'frame_' + String(f).padStart(4, '0') + '.raw'), surf.px);
}
fs.writeFileSync(path.join(outDir, 'stats.csv'), rows.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'rand_seq.txt'),
  seq.map((v, i) => v).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'rand_marks.txt'), marks.join('\n') + '\n');
console.log('ctor draws=' + ctorDraws + ' total rand=' + randN + ' frames=' + (n + 1));

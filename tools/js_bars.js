// node js_bars.js frames.bin outdir preset maxFrames [W=354] [H=345] [rawEvery=0]
// Port-side twin of hostP.ps1 -Vis bars: Alchemy.Bars at WxH, the same per-frame FNV-1a (B,G,R)
// of the 0x00RRGGBB surface, and the per-frame rand() count.  One probe render first (zero level,
// state 2, timeStamp 0), like the host's Prepare().  Bars never calls srand (the DLL log shows
// srand(seed)=-1), so both sides start from the CRT's seed 1 and the pinned clock is irrelevant.
// Preset 0: the port ships WMP's skin colours; the bare DLL uses its literals (spec §2.7), so they
// are restored here.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
// The engine under test: dist/engine.js from `npm run build:engine` (src/engine/*.ts as one classic
// script that sets window.Alchemy). ALCHEMY_ENGINE=<path> points it at another build.
const ENGINE = process.env.ALCHEMY_ENGINE || path.join(__dirname, '..', 'dist', 'engine.js');
const [binPath, outDir] = process.argv.slice(2);
const preset = +(process.argv[4] || 0), maxF = +(process.argv[5] || 0);
const W = +(process.argv[6] || 354), H = +(process.argv[7] || 345), rawEvery = +(process.argv[8] || 0);

const sandbox = { window: {}, Math, console, Object, Array, Number, String, JSON,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, Uint8ClampedArray, ArrayBuffer };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ENGINE, 'utf8'), sandbox, { filename: ENGINE });
const AL = sandbox.window.Alchemy;
fs.mkdirSync(outDir, { recursive: true });

let randN = 0;
const realRand = AL.rand;
AL.rand = function () { randN++; return realRand(); };

const eng = new AL.Bars({ width: W, height: H, preset });
if (preset === 0) { eng.levelColor = 0x00B020; eng.peakColor = 0x2020FF; eng.rebuildTrailPalette(); }

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
const level = { freq: [new Uint8Array(1024), new Uint8Array(1024)],
                wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };
const buf = fs.readFileSync(binPath);
let n = Math.floor(buf.length / 4100);
if (maxF > 0 && maxF < n) n = maxF;
const rows = ['frame,rand,hash'];
for (let f = -1; f < n; f++) {
  if (f >= 0) {
    const off = f * 4100;
    for (let c = 0; c < 2; c++) {
      buf.copy(level.freq[c], 0, off + c * 1024, off + (c + 1) * 1024);
      buf.copy(level.wave[c], 0, off + 2048 + c * 1024, off + 2048 + (c + 1) * 1024);
    }
    level.state = buf.readInt32LE(off + 4096);
    level.timeStamp = f * 166667;
  }
  const r0 = randN;
  const s = eng.render(level);
  rows.push(f + ',' + (randN - r0) + ',' + fnv(s.px).toString(16));
  if (rawEvery > 0 && f >= 0 && f % rawEvery === 0) {
    const o = Buffer.alloc(s.px.length * 4);
    for (let i = 0; i < s.px.length; i++) o.writeUInt32LE(s.px[i] >>> 0, i * 4);
    fs.writeFileSync(path.join(outDir, 'frame_' + String(f).padStart(4, '0') + '.raw'), o);
  }
}
fs.writeFileSync(path.join(outDir, 'stats.csv'), rows.join('\n') + '\n');
console.log('frames=' + (n + 1) + ' total rand=' + randN);

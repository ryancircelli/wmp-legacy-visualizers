// node js_render.js frames.bin outdir [maxFrames] [pngEvery] [seed]
// Runs the JS port over the same frames.bin the real DLL host eats, writes the same stats CSV
// (frame,state,hr,mean_lum,black_frac,p90_lum,mean_sat) and PNGs frame_NNNN.png.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib');

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
const maxF = +(process.argv[4] || 0), pngEvery = +(process.argv[5] || 1), seed = +(process.argv[6] || 12345);
fs.mkdirSync(outDir, { recursive: true });

const buf = fs.readFileSync(binPath);
let n = Math.floor(buf.length / PER);
if (maxF > 0 && maxF < n) n = maxF;

const engine = new AL.Engine({ width: W, height: H, options: { intended: false } });
engine.seed(seed);

const level = { freq: [new Uint8Array(1024), new Uint8Array(1024)],
                wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };

function crc32(b) {
  let c, t = crc32.t;
  if (!t) { t = crc32.t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } }
  c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, px) {                 // px: Uint32Array 0x00RRGGBB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0, o = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) { const v = px[y * W + x]; raw[o++] = (v >> 16) & 255; raw[o++] = (v >> 8) & 255; raw[o++] = v & 255; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

function stats(px) {
  let lsum = 0, ssum = 0, litsat = 0, litlum = 0, rs = 0, gs = 0, bs = 0, black = 0, lit = 0;
  const hist = new Int32Array(256);
  for (let i = 0; i < px.length; i++) {
    const v = px[i], r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b + 0.5) | 0;
    lsum += lum; hist[lum]++; rs += r; gs += g; bs += b;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    ssum += sat;
    if (mx < 8) black++; else { lit++; litsat += sat; litlum += lum; }
  }
  const need = 0.9 * px.length; let acc = 0, p90 = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= need) { p90 = i; break; } }
  let esum = 0, ecnt = 0;
  for (let y = 0; y < 480; y++) {
    const row = y * 640; let prev = -1;
    for (let x = 0; x < 640; x++) {
      const v = px[row + x];
      const l = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5) | 0;
      if (x > 0) { esum += Math.abs(l - prev); ecnt++; }
      prev = l;
    }
  }
  const n = px.length;
  return [(lsum / n).toFixed(5), (black / n).toFixed(6), p90, (ssum / n).toFixed(6),
          (lit ? litsat / lit : 0).toFixed(6), (lit ? litlum / lit : 0).toFixed(4),
          (rs / n).toFixed(4), (gs / n).toFixed(4), (bs / n).toFixed(4), (esum / ecnt).toFixed(4)].join(',');
}

const rows = ['frame,state,hr,mean_lum,black_frac,p90_lum,mean_sat,lit_sat,lit_lum,mean_r,mean_g,mean_b,edge'];
const t0 = Date.now();
for (let f = 0; f < n; f++) {
  const off = f * PER;
  for (let c = 0; c < 2; c++) {
    buf.copy(level.freq[c], 0, off + c * 1024, off + (c + 1) * 1024);
    buf.copy(level.wave[c], 0, off + 2048 + c * 1024, off + 2048 + (c + 1) * 1024);
  }
  level.state = buf.readInt32LE(off + 4096);
  level.timeStamp = f * 166667;
  const surf = engine.render(level);
  rows.push(f + ',' + level.state + ',0,' + stats(surf.px));
  if (pngEvery > 0 && f % pngEvery === 0) writePng(path.join(outDir, 'frame_' + String(f).padStart(4, '0') + '.png'), surf.px);
  if (f % 300 === 0) console.log('  f=' + f + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
fs.writeFileSync(path.join(outDir, 'stats.csv'), rows.join('\n') + '\n');
console.log('done ' + n + ' frames in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's -> ' + path.join(outDir, 'stats.csv'));

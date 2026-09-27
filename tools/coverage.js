// node tools/coverage.js PIN FRAMES.bin MAXFRAMES
// Prints one tag per line for every effect / warp-kernel / parameter branch the run exercised.
// Used to check that a bit-exactness battery actually covered the animation space, rather than
// hitting the same handful of parameterisations over and over.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const scripts = ['00-rand.js', '15-effect.js', '20-shift.js', '30-kernels.js', '40-draw.js', '50-engine.js']
  .map(f => new vm.Script(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f }));
const [pinS, binPath, nS] = process.argv.slice(2);
const pin = +pinS, nf = +nS, W = 640, H = 480, PER = 4100;
const sandbox = { window: {}, Math, isFinite, Date, console, Object, Array, Number, String, JSON,
  Uint8Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray };
sandbox.globalThis = sandbox; vm.createContext(sandbox);
for (const sc of scripts) sc.runInContext(sandbox);
const AL = sandbox.window.Alchemy;
const tags = new Set(), add = t => tags.add(t);
function kern(k) {
  if (!k) return;
  if (k.nameId === 109) add('SCOPE refl' + k.reflectionMode + ' mode' + k.shiftMode);
  else if (k.nameId === 105) add('LINEAR falloff' + (k.falloff ? 1 : 0) + ' shake' + (k.sinShake ? 1 : 0));
  else if (k.flowPoint !== undefined) add('STRETCH shake' + (k.sinShake ? 1 : 0) + ' flow' + (k.flowPoint ? 1 : 0));
  else add('COMB vert' + (k.vertical ? 1 : 0));
}
const e = new AL.Engine({ width: W, height: H, options: { intended: false } });
e.seed(pin);
const level = { freq: [new Uint8Array(1024), new Uint8Array(1024)],
                wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };
e.render(level);                                  // the host's probe frame
const buf = fs.readFileSync(binPath);
let n = Math.floor(buf.length / PER); if (nf > 0 && nf < n) n = nf;
for (let f = 0; f < n; f++) {
  const off = f * PER;
  for (let c = 0; c < 2; c++) {
    buf.copy(level.freq[c], 0, off + c * 1024, off + (c + 1) * 1024);
    buf.copy(level.wave[c], 0, off + 2048 + c * 1024, off + 2048 + (c + 1) * 1024);
  }
  level.state = buf.readInt32LE(off + 4096); level.timeStamp = f * 166667;
  e.render(level);
  for (const s of e.cycle.slots) for (const eff of s.active) {
    if (eff.name === 'Shift') {
      kern(eff.F1); kern(eff.F2);
      if (eff.F2) add('Shift chained pair');
      if (eff.transitionActive) add('Shift transition mode' + eff.TransitionMode);
    } else if (eff.name === 'WonderWave') {
      add('WonderWave mode' + eff.RenderMode + ' scale' + eff.ScaleMode + ' spin' + eff.SpinMode);
      add('WW cross' + (eff.CrossLine ? eff.CrossMode : 'off') + ' mirror' + (eff.Mirrored ? 1 : 0) +
          ' bassflex' + (eff.BassFlex ? 1 : 0));
      add('brushMode' + eff.pen.brushMode);
    } else if (eff.name === 'SuperStar') add('SuperStar div' + eff.Divisions);
    else if (eff.name === 'AtomBalls') add('AtomBalls' + (eff.flashFrames > 0 ? ' flash' : '') + (eff.invertColors ? ' invert' : ''));
    if (eff.state === 2) add(eff.name + ' fadeout');
  }
  if (e.ctx.bigBeat) add('bigBeat'); if (e.ctx.beat) add('beat');
}
for (const t of Array.from(tags).sort()) console.log(t);

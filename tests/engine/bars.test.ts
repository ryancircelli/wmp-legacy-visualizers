// Ported from tests/bars.test.js — asserts spec/wmp/FUNCTION-MAP-WMP.md §2 (Bars and Waves).
// Load order mirrors src/engine/index.ts (rand, then effect for A.makeSurface, then bars — bars.ts
// itself only imports rand.ts, so effect.ts must be pulled in explicitly here, same as the old
// vm-sandboxed load('00-rand.js'); load('15-effect.js'); load('60-bars.js')).
import { describe, expect, it } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/effect';
import '../../src/engine/bars';
import { level, mirror } from './helpers-2';

const Bars = (A as any).Bars;

function hex(n: number): string { return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6); }

describe('Bars: presets (§2.7)', () => {
  it('preset 0 (Bars) and switching presets', () => {
    const b = new Bars({ width: 354, height: 345 });
    expect(b.preset).toBe(0);
    expect(b.displayMode).toBe(1);
    expect(b.levelWidth).toBe(5);
    expect(b.horizontalSpacing).toBe(1);
    expect(b.levelFallbackSpeed).toBe(4);
    expect(b.peakHangTime).toBe(4);
    expect(b.fadeMode).toBe(0);
    expect(hex(b.levelColor)).toBe('#a4eb0c');
    expect(hex(b.peakColor)).toBe('#dfeaf7');

    b.setPreset(1);
    expect(b.displayMode).toBe(2);
    expect(b.levelWidth).toBe(0);
    expect(b.fadeMode).toBe(4);
    expect(b.fadeRate).toBe(20);
    expect(hex(b.levelColor)).toBe('#0000ff');
    expect(hex(b.peakColor)).toBe('#ffffff');

    b.setPreset(2);
    expect(b.fadeMode).toBe(1);
    expect(b.fadeRate).toBe(15);
    expect(hex(b.levelColor)).toBe('#ffa500');
    expect(hex(b.peakColor)).toBe('#ff0000');

    b.setPreset(3);
    expect(b.displayMode).toBe(3);
    expect(hex(b.levelColor)).toBe('#a0ffa0');
    expect(hex(b.peakColor)).toBe('#ff0000');       // Scope sets no peakColor: keeps Fire Storm's red
    expect(b.levelWidth).toBe(0);                    // Scope sets no levelWidth: keeps the previous 0
    expect(b.setPreset(4)).toBe(false);               // E_INVALIDARG
    expect(b.setPreset(-1)).toBe(false);
    expect(b.preset).toBe(3);                          // a rejected preset does not change the current one
  });
});

describe('Bars: band edges (§2.8a)', () => {
  it('buildBandEdges is log-spaced from 20Hz to 22050Hz', () => {
    const b = new Bars({ width: 354, height: 345 });
    b.buildBandEdges(50);
    expect(b.bandEdge[0]).toBe(20);
    expect(Math.abs(b.bandEdge[50] - 22050)).toBeLessThanOrEqual(2);
    for (const i of [1, 7, 25, 49]) {
      const want = 20 * Math.pow(1102.5, i / 50);
      expect(Math.abs(b.bandEdge[i] - want)).toBeLessThanOrEqual(0.02 * want / 100);
    }
    // the ratio is constant (log-spaced)
    expect(Math.abs(b.bandEdge[2] / b.bandEdge[1] - b.bandEdge[40] / b.bandEdge[39])).toBeLessThanOrEqual(1e-4);
    b.buildBandEdges(355);          // the 1024-line presets' visible count at 354 px wide
    expect(b.bandEdge[0]).toBe(20);
    expect(Math.abs(b.bandEdge[355] - 22050)).toBeLessThanOrEqual(4);
    // band 0 is narrower than one FFT bin at 355 bands: 20*(1102.5^(1/355)-1) = 0.4 Hz
    expect((b.bandEdge[1] - b.bandEdge[0]) / 21.513671875).toBeLessThan(0.03);
  });
});

describe('Bars: ReduceSpectrum (§2.8b)', () => {
  it('reduces a spectrum into log-power bytes per band', () => {
    const b = new Bars({ width: 354, height: 345 });
    b.buildBandEdges(50);
    const out = new Uint8Array(1024);

    b.reduceSpectrum(new Uint8Array(1024), out, 50);          // silence
    expect(out.reduce((a: number, v: number) => a + v, 0)).toBe(0);

    const loud = new Uint8Array(1024).fill(255);
    b.reduceSpectrum(loud, out, 50);
    expect(out[49]).toBe(255);
    expect(out[0]).toBe(228);
    expect([...out.slice(0, 50)].every((v, i, a) => !i || v >= a[i - 1]!)).toBe(true);
    expect([...out.slice(15, 50)].every((v) => v === 255)).toBe(true);

    // hand-computed single band: put one bin of value v in the widest band and check the byte.
    const one = new Uint8Array(1024);
    one[600] = 100;
    b.reduceSpectrum(one, out, 50);
    let edge = 0, expected = -1;
    for (let i = 0; i < 50; i++) {
      const w = (b.bandEdge[i + 1] - b.bandEdge[i]) / 21.513671875;
      if (600 >= edge && 600 < edge + w) {
        const take = Math.min(1, edge + w - 600);            // this band's share of bin 600
        expected = Math.round(32 * Math.log10(take * Math.pow(10, 8 * 100 / 255)));
      }
      edge += w;
    }
    expect(expected).toBeGreaterThan(0);
    const idx = Math.max(0, [...out.slice(0, 50)].findIndex((v) => v > 0));
    expect(Math.abs(out[idx]! - expected)).toBeLessThanOrEqual(1);
  });
});

describe('Bars: height + jitter (§2.8c)', () => {
  function heightRun(seed: number, byte: number, H: number, channels: number) {
    const b = new Bars({ width: 354, height: H });
    b.channels = channels;
    b.showPeaks = false;
    b.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(byte, 0, n); };   // synthetic bar bytes
    (A as any).srand(seed);
    b.render(level(2, (L) => { L.timeStamp = 1; }));
    return b;
  }

  it('jitters level bytes into pixel heights, per channel, LOUDER wins', () => {
    const H = 345, byte = 100;
    const base = (byte * H / 255) | 0;                       // (int)((float)(byte*H)/255.0f * 1.0f)
    expect(base).toBe(135);

    const b = heightRun(7, byte, H, 1);
    expect(b.bars).toBe(50);
    expect(b.barW).toBe(5);
    expect(b.xoff).toBe(27);

    const r = mirror(7);
    let inRange = 0;
    const distinct = new Set<number>();
    const failures: string[] = [];
    for (let i = 0; i < 50; i++) {
      const want = base + (((r() * 20 / 32767) | 0) - 10);
      if (b.levelValue[i] !== want) failures.push('bar ' + i + ' height = base + predicted rand() jitter');
      if (b.levelValue[i] >= base - 10 && b.levelValue[i] <= base + 10) inRange++;
      distinct.add(b.levelValue[i]);
    }
    expect(failures).toEqual([]);
    expect(inRange).toBe(50);
    expect(distinct.size).toBeGreaterThan(8);

    // two channels: one rand() per channel per bar, and the LOUDER channel wins
    const b2 = heightRun(7, byte, H, 2);
    const r2 = mirror(7);
    const stereoFailures: string[] = [];
    for (let i = 0; i < 50; i++) {
      const a = base + (((r2() * 20 / 32767) | 0) - 10), c = base + (((r2() * 20 / 32767) | 0) - 10);
      if (b2.levelValue[i] !== Math.max(a, c)) stereoFailures.push('stereo bar ' + i + ' takes max(L,R)');
    }
    expect(stereoFailures).toEqual([]);

    // 255 saturates to full height, and the bar is clipped to H-2 when drawn
    const bs = heightRun(3, 255, H, 1);
    expect(bs.levelValue[0] >= 345 - 10 && bs.levelValue[0] <= 345 + 10).toBe(true);
    let col = 0;
    for (let y = 0; y < H; y++) if (bs.surface.px[y * bs.surface.w + bs.xoff] !== 0) col++;
    expect(col).toBeLessThanOrEqual(H - 2);
    expect(col).toBeGreaterThanOrEqual(H - 12);

    // silent bars get no jitter at all
    const bz = heightRun(3, 0, H, 1);
    expect(bz.levelValue[0]).toBe(0);
  });
});

describe('Bars: fall-off (§2.9)', () => {
  it('level fall and peak hang/fall', () => {
    const b = new Bars({ width: 64, height: 200 });          // preset 0: level 4 px/frame, hang 4
    expect(b.levelFallbackSpeed).toBe(4);
    expect(b.levelFallbackAcceleration).toBe(0);
    expect(b.levelFall(100, 0)).toBe(100);
    expect(b.levelValue[0]).toBe(100);
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) seq.push(b.levelFall(0, 0));
    expect(seq.join(',')).toBe('100,96,92,88');
    b.skipUpdate = true;
    expect(b.levelFall(0, 0)).toBe(84);
    expect(b.levelValue[0]).toBe(84);
    b.skipUpdate = false;

    // peak: hangs peakHangTime frames, then 1.0 px/frame accelerating by 0.2
    expect(b.peakUpdate(100, 0)).toBe(100);
    const hung: number[] = [];
    for (let i = 0; i < 5; i++) hung.push(b.peakUpdate(0, 0));
    expect(hung.join(',')).toBe('100,100,100,100,100');
    const fall: number[] = [];
    for (let i = 0; i < 8; i++) fall.push(b.peakUpdate(0, 0));
    expect(fall.join(',')).toBe('100,99,98,97,96,95,93,91');
    expect(Math.abs(b.peakSpeed[0] - (1 + 0.2 * 8))).toBeLessThanOrEqual(1e-5);

    const b1 = new Bars({ width: 64, height: 200, preset: 1 });
    expect(b1.peakHangTime).toBe(0);
    b1.peakUpdate(50, 3);
    expect(b1.peakUpdate(0, 3)).toBe(50);
    expect(b1.peakUpdate(0, 3)).toBe(50);
    expect(b1.peakValue[3]).toBe(49);
  });
});

describe('Bars: a cap on every bar (measured against WMP)', () => {
  it('draws a peak cap on every bar even on a rising bar', () => {
    const b = new Bars({ width: 354, height: 345 });
    b.channels = 1;
    b.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(120, 0, n); };
    (A as any).srand(99);
    b.render(Object.assign(level(2), { timeStamp: 1 }));      // frame 1: every bar rises, peak == level
    const S = b.surface;
    let capPx = 0;
    const capRows = new Set<number>();
    for (let i = 0; i < S.px.length; i++) if (S.px[i] === 0xDFEAF7) { capPx++; capRows.add((i / 354) | 0); }
    expect(capPx).toBe(50 * 5);
    // and it sits exactly one pixel above the bar top
    const failures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const x = b.xoff + 6 * i;
      let top = 345;
      for (let y = 0; y < 345; y++) if (S.px[y * 354 + x] === 0xA4EB0C) { top = y; break; }
      if (!capRows.has(top - 1)) failures.push('bar ' + i + ': the cap is 1 px above the bar top row');
    }
    expect(failures).toEqual([]);
  });
});

describe('Bars: trail ring + palette (§2.10)', () => {
  it('level/peak trail palettes and the 16-deep history ring', () => {
    const om = new Bars({ width: 64, height: 64, preset: 1 });    // fadeRate 20, blue on black
    expect(hex(om.levelTrail[0])).toBe('#0000ff');
    expect(hex(om.levelTrail[1])).toBe('#0000eb');
    expect(hex(om.levelTrail[12])).toBe('#00000f');
    expect(hex(om.levelTrail[13])).toBe('#000000');
    expect(hex(om.peakTrail[0])).toBe('#ffffff');
    expect(hex(om.peakTrail[1])).toBe('#ebebeb');
    expect(om.terminator).toBe(0);

    const fs2 = new Bars({ width: 64, height: 64, preset: 2 });   // fadeRate 15, orange
    expect(hex(fs2.levelTrail[0])).toBe('#ffa500');
    expect(hex(fs2.levelTrail[1])).toBe('#f09600');
    expect(hex(fs2.levelTrail[11])).toBe('#5a0000');

    const bars0 = new Bars({ width: 64, height: 64, preset: 0 });
    expect(bars0.trailActive).toBe(0);
    expect(hex(bars0.peakTrail[0])).toBe('#dfeaf7');

    // the ring: 16 deep, head walks backward, history rows = 2*nBars
    const L = level(2, (l) => { l.freq[0].fill(180); l.freq[1].fill(180); });
    om.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(120, 0, n); };
    for (let f = 1; f <= 3; f++) { L.timeStamp = f; om.render(L); }
    expect(om.trailActive).toBe(1);
    expect(om.trailHead).toBe((0 - 3) & 0xF);
    expect(om.trailRows).toBe(om.bars * 2);
    const row0 = [...om.history.slice(0, 16)].filter((v) => v >= 0);
    expect(row0.length).toBe(3);

    // Fire Storm sinks the remembered heights by 1 px/frame, Ocean Mist does not
    const sink = new Bars({ width: 64, height: 64, preset: 2 });
    sink.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(120, 0, n); };
    sink.render(Object.assign(level(2), { timeStamp: 1 }));
    const h1 = sink.history[sink.trailHead];
    sink.render(Object.assign(level(2), { timeStamp: 2 }));
    expect(sink.history[(sink.trailHead + 1) & 0xF]).toBe(h1 - 1);
    const still = new Bars({ width: 64, height: 64, preset: 1 });
    still.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(120, 0, n); };
    still.render(Object.assign(level(2), { timeStamp: 1 }));
    const s1 = still.history[still.trailHead];
    still.render(Object.assign(level(2), { timeStamp: 2 }));
    expect(still.history[(still.trailHead + 1) & 0xF]).toBe(s1);
  });
});

describe('Bars: Render gating (§2.6)', () => {
  it('gates on state and stale timestamps', () => {
    const b = new Bars({ width: 32, height: 32 });
    const S = b.render(level(0));
    expect([...S.px].every((v: number) => v === 0)).toBe(true);
    b.reduceSpectrum = function (_f: unknown, out: Uint8Array, n: number) { out.fill(200, 0, n); };
    b.render(Object.assign(level(2), { timeStamp: 5 }));
    const lit = b.surface.px.filter((v: number) => v !== 0).length;
    expect(lit).toBeGreaterThan(0);
    const before = b.frame;
    b.render(Object.assign(level(2), { timeStamp: 5 }));       // same timestamp: stale audio
    expect(b.skipUpdate).toBe(true);
    expect(b.surface.px.filter((v: number) => v !== 0).length).toBe(lit);
    expect(b.frame).toBe(before + 1);
    b.render(Object.assign(level(1), { timeStamp: 6 }));
    expect(b.skipUpdate).toBe(true);
  });
});

describe('Bars: Scope (§2.11)', () => {
  it('draws a flat waveform at H/2 in the scope colour', () => {
    const b = new Bars({ width: 100, height: 60, preset: 3 });
    const L = level(2, (l) => l.wave[0].fill(128));
    L.timeStamp = 1;
    b.render(L);
    const m = Math.min(100, 60), yc = (60 >> 1) - (m >> 2);
    const y = ((128 * ((m >> 1) * 0.00390625)) | 0) + yc;
    expect(y).toBe(30);
    const rows = new Set<number>();
    for (let yy = 0; yy < 60; yy++) for (let x = 0; x < 100; x++) if (b.surface.px[yy * 100 + x]) rows.add(yy);
    expect([...rows].join(',')).toBe('30');
    expect(hex(b.surface.px[30 * 100 + 50])).toBe('#a0ffa0');
  });
});

describe('Bars: no out-of-bounds writes', () => {
  // the Proxy-guarded surface over 5 sizes (up to 1281x61) x 4 presets x 20 frames is slow.
  it('every preset at every size writes only inside the surface', () => {
    // a surface whose pixel store traps every write (same idiom as the old tests/draw.test.js)
    function guardSurface(w: number, h: number) {
      const store = new Array(w * h).fill(0);
      const bad: string[] = [];
      const px = new Proxy(store, {
        set(t, k, v) {
          if (typeof k === 'string' && /^-?\d+$/.test(k)) {
            const i = +k;
            if (i < 0 || i >= w * h) { bad.push('index ' + i); return true; }
            if (!Number.isFinite(v) || v < 0 || v > 0xFFFFFF) bad.push('value ' + v + ' at ' + i);
          }
          (t as any)[k as any] = v; return true;
        }
      });
      return { w, h, px, bad };
    }

    const sizes: Array<[number, number]> = [[1, 1], [3, 2], [17, 9], [354, 345], [1281, 61]];
    const allFailures: string[] = [];
    for (const [w, h] of sizes) {
      for (let p = 0; p < 4; p++) {
        const b = new Bars({ width: w, height: h, preset: p });
        const G = guardSurface(w, h);
        b.surface = G;
        (A as any).srand(12345);
        for (let f = 1; f <= 20; f++) {
          const L = level(2, (l) => {
            for (let i = 0; i < 1024; i++) {
              l.freq[0][i] = (i * 7 + f * 13) & 0xFF;
              l.freq[1][i] = (i * 3 + f * 29) & 0xFF;
              l.wave[0][i] = (i * 11 + f) & 0xFF;
            }
          });
          L.timeStamp = f;
          b.render(L);
        }
        if (G.bad.length) allFailures.push('preset ' + p + ' at ' + w + 'x' + h + ' writes only inside the surface — ' + G.bad.slice(0, 3).join(', '));
      }
    }
    expect(allFailures).toEqual([]);

    // resize mid-flight must not leave stale indices behind either
    const b = new Bars({ width: 200, height: 100, preset: 2 });
    b.render(Object.assign(level(2, (l) => l.freq[0].fill(200)), { timeStamp: 1 }));
    b.resize(37, 300);
    const G = guardSurface(37, 300);
    b.surface = G;
    for (let f = 2; f < 8; f++) b.render(Object.assign(level(2, (l) => l.freq[0].fill(200)), { timeStamp: f }));
    expect(G.bad).toEqual([]);
  }, 30000);
});

describe('Bars: debug()', () => {
  it('reports preset name, size, and live colours', () => {
    const b = new Bars({ width: 354, height: 345, preset: 1 });
    const d = b.debug();
    expect(d.presetName).toBe('Ocean Mist');
    expect(d.size).toBe('354x345');
    expect(d.peakColor).toBe('#ffffff');
  });
});

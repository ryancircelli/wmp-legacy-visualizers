// Energy Bliss' equalizer panel (src/averett/mp10/eqpanel.ts) on synthetic input with our own button art
// (eqart.ts): the heap fields it keeps, where the buttons land, and a golden of the port's own output over a run
// of calls (the port was checked against gdiplus.dll 10.0.26100.9711 privately; nothing here comes from the DLL).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { makeEqPanel } from '../src/averett/mp10/eqpanel';
import { eqButtons } from '../src/averett/mp10/eqart';
import type { EqPanelHeap } from '../src/averett/mp10/eqpanel-api';

function heap(W: number, H: number, OW: number, OH: number): EqPanelHeap {
  const buf = new ArrayBuffer(0x10000 * 4);
  const h = { I: new Int32Array(buf), U: new Uint32Array(buf), F: new Float32Array(buf), B: new Uint8Array(buf) };
  h.I[0xf11f] = W; h.I[0xf120] = H; h.I[0xf116] = OW; h.I[0xf117] = OH;
  return h;
}
/** W x H BGRA backdrop: a dark blue wash with alpha falling to the right */
function backdrop(W: number, H: number): Uint8Array {
  const o = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    o[i] = 0x60 + (y & 31); o[i + 1] = 0x20; o[i + 2] = x & 0x3f; o[i + 3] = 255 - ((x * 200 / W) | 0);
  }
  return o;
}
/** spectrum levels for call n: left half at I[0xcf86 + 9b + 1], right half at I[0xd18e + 0x162 - 9b] */
function feed(h: EqPanelHeap, n: number): void {
  for (let b = 1; b < 19; b++) h.I[0xcf86 + b * 9 + 1] = n % 7 === 0 ? (b * 37 + n * 11) % 200 : 0;
  for (let b = 21; b < 39; b++) h.I[0xd18e + 0x162 - b * 9] = n % 5 === 0 ? (b * 53 + n * 7) % 200 : 0;
}

describe('Energy Bliss equalizer panel', () => {
  const draw = makeEqPanel(eqButtons());

  it('keeps the levels, the peaks and the loop fields', () => {
    const h = heap(600, 122, 320, 65), src = backdrop(600, 122);
    h.I[0xcf86 + 9 + 1] = 150;                   // band 1 jumps to 150
    h.F[0x246e + 1] = 80;                        // its peak at the top
    expect(draw({ heap: h, src, hd: false }).length).toBe(320 * 65 * 4);
    expect(h.I[0x241e + 1]).toBe(150);
    expect(h.I[0x2446 + 1]).toBe(150);
    expect(h.I[0xd89f]).toBe(39);
    expect(h.I[0xd8d6]).toBe(10);
    expect(h.I[0xd8d5]).toBe(10);
    expect(h.I[0x1f82]).toBe(1);
    // band 1's peak was capped by the rows it lit (level 150 lights rows up to 149 -> cap 21), then grew once
    expect(h.F[0x246e + 1]).toBe(Math.fround(21 * Math.fround(1.015) + Math.fround(0.7)));   // x87: one rounding
    h.I[0xcf86 + 9 + 1] = 0;
    draw({ heap: h, src, hd: false });
    expect(h.I[0x241e + 1]).toBe(142);           // ftol(150 * 0.95)
  });

  it('puts the buttons where the DLL does (a 1:1 scale shows b1 shifted by the (2, 2) crop)', () => {
    const W = 600, H = 122, h = heap(W, H, W - 4, H - 4), art = eqButtons();
    h.I[0xcf86 + 3 * 9 + 1] = 45;                // band 3: rows 1 (lit: raw >= 40) and 2 (dim: raw < 80)
    const out = new Uint32Array(draw({ heap: h, src: backdrop(W, H), hd: false }).buffer);
    const px = (s: Uint8Array, x: number, y: number): number => new Uint32Array(s.buffer)[y * 10 + x]!;
    const at = (x: number, y: number): number => out[(y - 2) * (W - 4) + x - 2]!;
    expect(at(3 * 15 + 2 + 4, 75 + 5)).toBe(px(art['1A'].px, 4, 5));
    expect(at(3 * 15 + 2 + 4, 63 + 5)).toBe(px(art['1B'].px, 4, 5));
  });

  it('draws the hd variant with levels and peaks (2x buttons, reflections stretched 2x)', () => {
    const quiet = heap(1200, 244, 1024, 208), loud = heap(1200, 244, 1024, 208), src = backdrop(1200, 244);
    for (const h of [quiet, loud]) { h.I[0xf118] = 1200; h.I[0xf119] = 244; }
    feed(loud, 0);                                // every band gets a level
    for (let b = 1; b < 39; b++) loud.F[0x246e + b] = b % 3 ? 40 : 83;   // peaks mid-way and at the top
    const a = draw({ heap: quiet, src, hd: true }), b = draw({ heap: loud, src, hd: true });
    expect(b.length).toBe(1024 * 208 * 4);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
    expect(createHash('sha1').update(b).digest('hex')).toBe('a2b30ddf696be89345c8e82d6d97861047c91e9a');
  });

  it('golden: the port\'s own output over a run of calls', () => {
    const h = heap(600, 122, 320, 65), src = backdrop(600, 122), sha = createHash('sha1');
    for (let n = 0; n < 40; n++) { feed(h, n); sha.update(draw({ heap: h, src, hd: false })); }
    const hd = heap(1200, 244, 1024, 208);
    hd.I[0xf118] = 1200; hd.I[0xf119] = 244;
    sha.update(draw({ heap: hd, src: backdrop(1200, 244), hd: true }));
    expect(sha.digest('hex')).toBe('1b48bd0e81538c57c754ebbec37b08c159f4991d');
  }, 60_000);
});

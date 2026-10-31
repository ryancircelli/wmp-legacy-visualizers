// Alchemy.WM3DSpectrum: "3D Spectrum Analyzer" (WM3DSpectrum.dll, 2009, Carlo McWhirter / Hyteq Systems; a Direct3D 9
// plug-in for Windows Media Player 11, Effects key WM3DSpectrum), the stereo spectrum's history as a landscape: each
// frame's spectrum is a new row at the back of a 1024 x 1024 height field, the older rows marching forward, drawn as a
// million-vertex grid (or a million points) whose heights a vertex shader reads from that field, coloured by height.
// Eight presets: Rose Garden and City Lights (two colourings), each as triangles or points, each from the raw
// spectrum or a 20-bin running mean of it ("Smooth").
//
// Licence: the plug-in was published under the Code Project Open License. Nothing of it is in this repository: this
// is our own implementation of what its binary does, written from its machine code and its observed output.
//
// Wiring: the DLL draws through Direct3D 9 into a device on WMP's window (the back buffer the window's size, D24S8
// depth), with HLSL compiled by D3DX 9 (d3dx9_40.dll) to vs_3_0 / ps_3_0. Frame for frame the port gives the pixels
// that device gives on Microsoft's reference rasterizer (d3dref9.dll), with D3DX on its x87 path (DisableD3DXPSGP),
// as the ground truth pins it. Per frame (the window's FUN_0f303260):
//  * the spectrum (TimedLevel.freq, both channels): bins paired, (uint8)(a + b) >> 1, 512 per channel; Smooth then
//    takes each one's mean over 20 neighbours in place (0f302c50).
//  * the height field: two 1024 x 1024 A32B32G32R32F render targets; the older one is drawn one row up into the other
//    (an exact copy: texel-aligned, no blending), and the new row goes in at y = 1023: green = byte / 128 at x = 4..507
//    (left) and 516..1019 (right), 0 elsewhere. Only green reaches the shaders, so the field here is bytes.
//  * the camera: D3DXMatrixLookAtLH from (-cos 1.85 * 530, 250, sin 1.85 * 530) to the origin, y up (the mouse drag
//    that turns and zooms it is WMP's window's, not the engine's), D3DXMatrixPerspectiveFovLH(pi/4, w / h, 0.1, 5000).
//  * the grid: vertices (0.5 i - 256, 0, 256 - 0.5 j); its index buffer steps 1023 vertices a row over rows of 1024
//    (so each row's triangles lean, and the last of a row reaches back across the grid), drawn in that order.
//  * the vertex shader samples the field bilinearly (REF's vertex texture fetch: 1/32 texel weights, WRAP) at
//    u = 1 - x / 512.5, v = 0.5 + z / 512.5, lifts the vertex to 100 x height and picks its colour from the height.
//  * the credit text (D3DXFont, Verdana 12 bold, colour 0xff688cd3, at (10, 10)): Windows' font, so the port does not
//    draw it (options.overlay can).
import { A } from '../ns';
import type { Surface, TimedLevel } from '../ns';
import * as E from '../d3d8/ref/ext';
import { linCoord } from '../d3d9/ref/tex';
import { f, matMul, vec3Normalize } from '../psychedelia/d3dx9';
import { Raster, Target, Verts, snap } from './raster';
import { type Arena, newArena, reserve } from './kernel';

const PRESET_NAMES = ['Rose Garden', 'City Lights', 'Rose Garden Points', 'City Lights Points', 'Rose Garden - Smooth',
  'City Lights - Smooth', 'Rose Garden Points - Smooth', 'City Lights Points - Smooth'];

export interface WM3DSpectrumOptions {
  /** drawn over each frame before it is returned (the DLL's credit text goes here) */
  overlay?: (px: Uint32Array, w: number, h: number) => void;
}
export interface WM3DSpectrumConfig {
  width?: number;
  height?: number;
  options?: WM3DSpectrumOptions;
  preset?: number;
}

const N = 1024, NV = N * N;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const float = (u: number): number => { U1[0] = u >>> 0; return F1[0]; };

// ---- the camera (D3DX 9 on its x87 path, 24-bit precision) ----
/** the eye: -cos(1.85) * 530, 250, sin(1.85) * 530 as the DLL's x87 gives them (FCOS / FSIN at 64 bits, the
 *  product rounded to a float) */
const EYE = [float(0x43121017), 250, float(0x43febce9)];
/** D3DXMatrixLookAtLH (d3dx9_40 0x102000bf): z = normalize(at - eye), x = normalize(up x z), y = z x x */
function lookAtLH(eye: number[]): Float32Array {
  const z = vec3Normalize(Float32Array.of(f(0 - eye[0]), f(0 - eye[1]), f(0 - eye[2])));
  // up = (0, 1, 0): (z.z up.y - up.z z.y, up.z z.x - up.x z.z, up.x z.y - z.x up.y)
  const x = vec3Normalize(Float32Array.of(f(f(z[2] * 1) - f(0 * z[1])), f(f(0 * z[0]) - f(0 * z[2])), f(f(0 * z[1]) - f(z[0] * 1))));
  const y = Float32Array.of(f(f(z[1] * x[2]) - f(z[2] * x[1])), f(f(z[2] * x[0]) - f(z[0] * x[2])), f(f(z[0] * x[1]) - f(z[1] * x[0])));
  const dot = (a: Float32Array): number => f(f(f(a[0] * eye[0]) + f(a[1] * eye[1])) + f(a[2] * eye[2]));
  return Float32Array.of(x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1);
}
/** D3DXMatrixPerspectiveFovLH (0x102003aa) for fovy pi/4 (FSINCOS of f32(fovy * 0.5) stored as floats: yScale =
 *  f32(cos / sin) = 0x401a8279), zn 0.1, zf 5000 */
function perspectiveFovLH(aspect: number): Float32Array {
  const ys = float(0x401a8279), zn = f(0.1), Q = f(5000 / f(5000 - zn));
  const m = new Float32Array(16);
  m[0] = f(ys / aspect); m[5] = ys; m[10] = Q; m[11] = 1; m[14] = f(-f(Q * zn));
  return m;
}
/** the effect's c0..c3: the transposed view * projection (rows of 4) for a w x h window (aspect FILD / FIDIV) */
export function wvp(w: number, h: number): Float32Array {
  const m = matMul(new Float32Array(16), lookAtLH(EYE), perspectiveFovLH(f(w / h)));
  const c = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) c[r * 4 + k] = m[k * 4 + r];
  return c;
}

// ---- the spectrum providers ----
/** FUN_0f302b50: bins paired, (uint8)(a + b) >> 1 (the add wraps at 8 bits); then for Smooth FUN_0f302c50's running
 *  mean: o = 0..511 in turn, the 20 bins o - 10 .. o + 9 (clamped to 0..511, the ones below o already replaced)
 *  summed as floats, out = trunc(sum / 20) */
export function spectrum(freq: Uint8Array, out: Uint8Array, smooth: boolean): void {
  for (let k = 0; k < 512; k++) out[k] = ((freq[2 * k] + freq[2 * k + 1]) & 255) >> 1;
  if (!smooth) return;
  for (let o = 0; o < 512; o++) {
    let s = 0;
    for (let i = o - 10; i < o + 10; i++) s += out[i < 0 ? 0 : i > 511 ? 511 : i];
    out[o] = (s / 20) | 0;
  }
}

// ---- the vertex shaders, by height ----
const fr = Math.fround;
const lrp = (s0: number, s1: number, s2: number): number => { E.ld(s1); E.fsub(s2); E.fmul(s0); E.fadd(s2); return E.st32(); };
const mad = (a: number, b: number, c: number): number => E.add32(a * b, c);
const C001 = fr(0.001), C02 = fr(0.2), C501 = fr(0.501), C751 = fr(0.751);
/** ColorGridCityLights' colour (o1.rgb) for height h (REF's ops: slt / sge give 0 or 1, lrp f32((s1 - s2) s0 + s2)
 *  at 64 bits, mad f32(a b + c) at 64 bits) */
function cityLights(h: number, out: Float32Array, o: number): void {
  const ah = Math.abs(h);
  const r1x = 0.5 < ah ? 1 : 0, r1y = 1 < ah ? 1 : 0;
  const r0y = C001 >= ah ? 1 : 0, r0z = C02 >= ah ? 1 : 0, r0w = 0.5 >= ah ? 1 : 0;
  const t = lrp(r0w, 1, r1y);
  const r1z = mad(t, 1, 0);
  const r3x = lrp(r0z, 0, r1x), r3y = lrp(r0z, 0, r1z), r3z = r0z;
  out[o] = mad(r0y, fr(-r3x + 0), r3x); out[o + 1] = mad(r0y, fr(-r3y + 0), r3y); out[o + 2] = mad(r0y, fr(-r3z + 0), r3z);
}
/** ColorGridRoseGardenTech's colour for height h (c4 = (1, 0, 0, 0) from the effect) */
function roseGarden(h: number, out: Float32Array, o: number): void {
  let r1x = fr(-h + 1);
  const r1y = fr(-h + 0.5);
  let r0y = fr(-r1x + 1);
  r1x = fr(-h + 0.5);
  r0y = fr(r0y + -r1x);
  r1x = h < C001 ? 1 : 0;
  const r1z = h < C501 ? 1 : 0, r1w = h < C751 ? 1 : 0;
  const r2y = fr(mad(r1w, r0y, r1y) * 1), r2x = fr(lrp(r1w, 1, h) * 1), r2z = fr(lrp(r1w, 1, h) * 0);
  const r3x = lrp(r1z, 0, r2x), r3y = lrp(r1z, h, r2y), r3z = lrp(r1z, 0, r2z);
  out[o] = mad(r1x, fr(-r3x + 0), r3x); out[o + 1] = mad(r1x, fr(-r3y + 0), r3y); out[o + 2] = mad(r1x, fr(-r3z + 0), r3z);
}
/** heights are S / 131072 for integers S (texels byte / 128, weights multiples of 1/1024): 0 .. 255 * 1024 */
const SMAX = 255 * 1024;

class WM3DSpectrum {
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: WM3DSpectrumOptions;
  /** the height field's bytes, row r of the texture at ((r + head) & 1023) * 1024 */
  declare field: Uint8Array;
  declare head: number;
  declare L: Uint8Array;
  declare R: Uint8Array;
  declare verts: Verts | null;
  declare target: Target | null;
  declare raster: Raster | null;
  declare c: Float32Array;
  declare out: Surface;
  /** per column i: the two texel columns and the weight (in 32nds) of the second; per row j likewise */
  declare iu: Int32Array;
  declare jv: Int32Array;
  /** the colours by S for [Rose Garden, City Lights], filled on first use */
  declare cols: [Float32Array, Float32Array];
  declare have: [Uint8Array, Uint8Array];
  /** the palette the vertex arrays were computed for (-1: none, or the size changed) */
  declare lastCity: number;
  /** the WebAssembly kernel holding every buffer above (null: plain arrays, JavaScript only) */
  declare arena: Arena | null;
  /** the palette is complete (the kernel cannot shade a missing colour) */
  declare full: [boolean, boolean];

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: WM3DSpectrumConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    this.w = Math.max(1, (cfg.width || 640) | 0);
    this.h = Math.max(1, (cfg.height || 480) | 0);
    this.preset = cfg.preset ? cfg.preset | 0 : 0;
    if (this.preset < 0 || this.preset >= PRESET_NAMES.length) this.preset = 0;
    this.frame = 0;
    this.head = 0;
    this.L = new Uint8Array(512); this.R = new Uint8Array(512);
    this.target = null; this.raster = null; this.lastCity = -1;
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.have = [new Uint8Array(SMAX + 1), new Uint8Array(SMAX + 1)];
    this.full = [false, false];
    this.arena = newArena(NV, 3 * (SMAX + 1));
    this.views();
    // the sampling coordinates: u = f32(x * -c + 1), v = f32(z * c + 0.5) (mad at 64 bits), c = 1 / 512.5 as a float
    const cu = float(0xbaffc010), cv = float(0x3affc010);
    for (let i = 0; i < N; i++) {
      const n = linCoord(E.add32(f(f(i * 0.5) - 256) * cu, 1), N), i0 = n >> 5;
      this.iu[3 * i] = i0 & 1023; this.iu[3 * i + 1] = (i0 + 1) & 1023; this.iu[3 * i + 2] = n & 31;
      const m = linCoord(E.add32(f(256 - f(0.5 * i)) * cv, 0.5), N), j0 = m >> 5;
      this.jv[3 * i] = j0 & 1023; this.jv[3 * i + 1] = (j0 + 1) & 1023; this.jv[3 * i + 2] = m & 31;
    }
  }

  /** the buffers, as views of the kernel's memory (made again whenever it grows: the contents stay) or arrays */
  private views(): void {
    const ar = this.arena, buf = ar ? ar.k.memory.buffer : undefined;
    this.field = ar ? new Uint8Array(buf as ArrayBuffer, ar.field, NV) : new Uint8Array(NV);
    this.iu = ar ? new Int32Array(buf as ArrayBuffer, ar.iu, 3 * N) : new Int32Array(3 * N);
    this.jv = ar ? new Int32Array(buf as ArrayBuffer, ar.jv, 3 * N) : new Int32Array(3 * N);
    this.c = ar ? new Float32Array(buf as ArrayBuffer, ar.c, 16) : new Float32Array(16);
    const nc = 3 * (SMAX + 1);
    this.cols = ar ? [new Float32Array(buf as ArrayBuffer, ar.cols[0], nc), new Float32Array(buf as ArrayBuffer, ar.cols[1], nc)]
      : [new Float32Array(nc), new Float32Array(nc)];
    this.verts = new Verts(NV, buf, ar ? ar.verts : 0);
    this.target = null; this.lastCity = -1;
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return true;
  }

  /** the update (FUN_0f3017d0): scroll the field a row, the new spectrum in at the bottom */
  private update(level: TimedLevel | null): void {
    const smooth = this.preset >= 4, L = this.L, R = this.R;
    if (level) { spectrum(level.freq[0], L, smooth); spectrum(level.freq[1], R, smooth); } else { L.fill(0); R.fill(0); }
    this.head = (this.head + 1) & 1023;
    const o = ((1023 + this.head) & 1023) * N, fd = this.field;
    fd.fill(0, o, o + N);
    for (let x = 4; x < 508; x++) { fd[o + x] = L[x]; fd[o + 512 + x] = R[x]; }
    this.frame++;
  }

  render(level: TimedLevel | null): Surface {
    this.update(level);
    return this.draw();
  }

  /** the scene from the current field (the device's draws after the update) */
  private draw(): Surface {
    const w = this.w, h = this.h;
    if (!this.target || this.target.w !== w || this.target.h !== h) {
      let ar = this.arena;
      if (ar) {
        try { if (reserve(ar, w * h)) this.views(); } catch {
          // no memory for this window: the JavaScript from now on, on arrays of its own
          const { field, iu, jv, cols } = this;
          this.arena = ar = null;
          this.views();
          this.field.set(field); this.iu.set(iu); this.jv.set(jv); this.cols[0].set(cols[0]); this.cols[1].set(cols[1]);
        }
      }
      this.target = ar ? new Target(w, h, ar.k.memory.buffer, ar.target) : new Target(w, h);
      this.raster = new Raster(this.target, this.verts as Verts);
      this.c.set(wvp(w, h));
      this.lastCity = -1;
      this.out = { w, h, px: this.target.px };
    }
    const t = this.target, ras = this.raster as Raster, v = this.verts as Verts, city = this.preset & 1;
    // a vertex's outputs depend only on its place, its S, the palette and the size: where S is what it was last
    // frame (the flat ground, quiet bands) they are still in the vertex arrays
    if (this.lastCity !== city) { v.s.fill(-1); this.lastCity = city; v.cols = this.cols[city]; }
    t.clear();
    const ar = A.wm3dKernel === 'js' ? null : this.arena;
    if (!ar && A.wm3dKernel === 'wasm') throw new Error('3D Spectrum Analyzer: the WebAssembly kernel is unavailable here');
    if (ar) {
      if (!this.full[city]) {
        const cols = this.cols[city], have = this.have[city], shade = city ? cityLights : roseGarden;
        for (let S = 0; S <= SMAX; S++) if (!have[S]) { shade(S / 131072, cols, 3 * S); have[S] = 1; }
        this.full[city] = true;
      }
      const k = ar.k, o = ar.verts;
      k.bind(ar.field, ar.iu, ar.jv, ar.c, o, o + 4 * NV, o + 8 * NV, o + 12 * NV, o + 16 * NV, o + 20 * NV, o + 24 * NV,
        t.px.byteOffset, t.zb.byteOffset, w, h);
      k.palette(ar.cols[city]);
      k.vertices(this.head, w, h);
      if (this.preset & 2) k.points(); else k.triangles();
    } else {
      this.vertices();
      if (this.preset & 2) for (let i = 0; i < NV; i++) ras.point(i);
      // the index buffer: per b, (b, b + 1, b + 1023) and (b + 1023, b + 1, b + 1024)
      else for (let b = 0; b < 1023 * 1023; b++) { ras.triangle(b, b + 1, b + 1023); ras.triangle(b + 1023, b + 1, b + 1024); }
    }
    if (this.options.overlay) this.options.overlay(t.px, w, h);
    return this.out;
  }

  /** the vertex shader and REF's clip-space to screen for every vertex */
  private vertices(): void {
    const v = this.verts as Verts, c = this.c, fd = this.field, head = this.head, iu = this.iu, jv = this.jv;
    const city = this.preset & 1, cols = this.cols[city], have = this.have[city], shade = city ? cityLights : roseGarden;
    const last = v.s;
    const W = this.w, H = this.h;
    const c00 = c[0], c01 = c[1], c02 = c[2], c03 = c[3], c10 = c[4], c11 = c[5], c12 = c[6], c13 = c[7];
    const c20 = c[8], c21 = c[9], c22 = c[10], c23 = c[11], c30 = c[12], c31 = c[13], c32 = c[14], c33 = c[15];
    for (let j = 0; j < N; j++) {
      const z = f(256 - f(0.5 * j));
      const r0 = ((jv[3 * j] + head) & 1023) * N, r1 = ((jv[3 * j + 1] + head) & 1023) * N, fv = jv[3 * j + 2], gv = 32 - fv;
      for (let i = 0; i < N; i++) {
        const x = f(f(i * 0.5) - 256), n = j * N + i;
        const i0 = iu[3 * i], i1 = iu[3 * i + 1], fu = iu[3 * i + 2], gu = 32 - fu;
        // texldl: (i0, j0), (i1, j0), (i1, j1), (i0, j1), weights in 1024ths; green = byte / 128
        const S = gv * (gu * fd[r0 + i0] + fu * fd[r0 + i1]) + fv * (fu * fd[r1 + i1] + gu * fd[r1 + i0]);
        if (last[n] === S) continue;
        last[n] = S;
        if (!have[S]) { shade(S / 131072, cols, 3 * S); have[S] = 1; }
        const y = fr(S * (100 / 131072));
        // dp4 o0, (x, y, z, 1), c#: f32(((y c.y + x c.x) + z c.z) + c.w) at 64 bits
        const cx = E.sum32(y * c01, x * c00, z * c02, c03), cy = E.sum32(y * c11, x * c10, z * c12, c13);
        const cz = E.sum32(y * c21, x * c20, z * c22, c23), cw = E.sum32(y * c31, x * c30, z * c32, c33);
        // clip space [0, w]: x' = f32((x + w) * 0.5) at 64 bits; rhw = f32(1 / w); screen f32(rhw x' W + 0),
        // f32(y' rhw (-H) + H), f32(z rhw)
        const xc = E.add32(cx, cw) * 0.5, yc = E.add32(cy, cw) * 0.5, rhw = fr(1 / cw);
        let p = rhw * xc * W, e = Math.abs(p) * E.EPS, sx = fr(p - e);
        if (sx !== fr(p + e)) { E.ldMul(rhw, xc); E.fmul(W); E.fadd(0); sx = E.st32(); }
        const q = yc * rhw * -H;
        p = q + H; e = (Math.abs(q) + H) * E.EPS;
        let sy = fr(p - e);
        if (sy !== fr(p + e)) { E.ldMul(yc, rhw); E.fmul(-H); E.fadd(H); sy = E.st32(); }
        v.x[n] = sx; v.y[n] = sy; v.z[n] = cz * rhw; v.rhw[n] = rhw;
        v.X[n] = snap(sx); v.Y[n] = snap(sy);
      }
    }
  }

  debug(): Record<string, unknown> {
    return { engine: 'WM3DSpectrum', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frame: this.frame };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    WM3DSpectrum: typeof WM3DSpectrum;
  }
}

A.WM3DSpectrum = WM3DSpectrum;
export { WM3DSpectrum };

/* eslint-disable */
// @ts-nocheck
// AssemblyScript source of ./kernel-wasm.ts: the rasterizer of ./rast.ts (triangle setup and culling, edges, attribute
// planes, the 2x2-quad scan, texture sampling, stage blending, pixel operations, points) compiled to WebAssembly, the
// same arithmetic operation for operation (doubles where rast.ts uses doubles, an f32 store where it calls
// Math.fround, the same 64-bit x87 emulation for the fallbacks: see ./ext.ts), so its pixels are rast.ts's. rast.ts
// stays the reference and the path without WebAssembly; every comment on the arithmetic is there. The JS glue
// (./kernel.ts) writes the draw state into this module's memory at STATE (layout below, mirrored in kernel.ts), keeps
// the TL vertices, textures and targets in this memory, and calls triangle / point with byte addresses of TL vertices.
// Build: tools/d3d/ref8_build_wasm.mjs in the private repo (AssemblyScript, -O3 --noAssert --runtime stub).

// ---- layout (byte offsets from STATE; kernel.ts mirrors these) ----
// i32 at STATE + 4*i:
//  0 clipL 1 clipT 2 clipR 3 clipB 4 cull 5 flat 6 zOn 7 zWrite 8 zFunc 9 specOn 10 aTest 11 aFunc 12 aRef 13 cwe
//  14 blendMode 15 srcBlend 16 destBlend 17 blendOp 18 rtX8 19 dither 20 tfactor 21 nStages 22 hasDiffuse
//  23 hasSpecular 24 hasPsize 25 rt 26 rtPitch 27 ds 28 dsPitch 29 zEnable (render state) 30 pointSprite
//  31 POINTSIZE bits 32 POINTSIZE_MIN bits 33 POINTSIZE_MAX bits 34 fillMode
//  40..103 per stage (8 each): COLOROP, COLORARG1, COLORARG2, COLORARG0, ALPHAOP, ALPHAARG1, ALPHAARG2, RESULTARG
// f64 at STATE + 1024 + 8*i: 0..3 TFACTOR as floats
// stages at STATE + 2048 + 512*s: i32 0 hasTex 1 set 2 dims 3 minF 4 magF 5 mipF 6 needLod 7 maxMip 8 addrU 9 addrV
//  10 width 11 height 12 levels 13 format; f64 at +64 bias; levels at +128 + 16*l: i32 ptr, w, h, pitch
const STATE: usize = 1024;
const SI: usize = STATE, SF: usize = STATE + 1024, SS: usize = STATE + 2048;
// TL vertex (doubles): 0..3 clip, 4 sx 5 sy 6 sz 7 rhw 8..11 diffuse 12..15 specular 16 fog 17 psize 18.. texcoords
const SX = 4, SY = 5, SZ = 6, RHW = 7, DIF = 8, SPE = 12, PSZ = 17, TEX = 18, ST = 52;
// scratch at 16384.. : planes, quad buffers, corner vertices, tables
const PL: usize = 16384;                 // planes: pz, pd, ps, pt[8]: each A[4] B[4] C[4] M[4] K[4] (f64), flags i32 x2
const PLS: usize = 192;                  // bytes per plane (20 f64 + 2 i32 + pad)
const QB: usize = 16384 + 11 * 192;      // W[4], tu[32], tv[32], texc[128], dif[4], spe[4], cur, res, tmp, a1, a2, a0, texv, dstv, k0001
const CV: usize = 24576;                 // three corner vertices for points (52 f64 each)
const B255: usize = 26624;               // 256 f64
const B15: usize = 28672;                // 16 f64
// (the glue allocates from heapBase(), after the module's own data)

// AssemblyScript keeps its own static data from 65536 (--memoryBase 65536), above these fixed regions
export function heapBase(): usize { return (__heap_base + 15) & ~(<usize>15); }
export function stateBase(): usize { return STATE; }

const EPS: f64 = 8.881784197001252e-16;
const INV255D: f64 = 1.0 / 255.0;

function fr(x: f64): f64 { return <f64><f32>x; }
function bitsOf(x: f64): i32 { return reinterpret<i32>(<f32>x); }
function fromBits(u: i32): f64 { return <f64>reinterpret<f32>(u); }
function ftol(v: f64): i32 { return v > -2147483649.0 && v < 2147483648.0 ? <i32>v : -2147483648; }
function clamp01(v: f64): f64 { return v > 1 ? 1 : v < 0 ? 0 : v; }   // NaN stays NaN, as REF's
function si(i: i32): i32 { return load<i32>(SI + (<usize>i << 2)); }
function sf(i: i32): f64 { return load<f64>(SF + (<usize>i << 3)); }

export function init(): void {
  for (let i = 0; i < 256; i++) store<f64>(B255 + (<usize>i << 3), fr(<f64>i * fr(1.0 / 255.0)));
  for (let i = 0; i < 16; i++) store<f64>(B15 + (<usize>i << 3), fr(<f64>i * fr(1.0 / 15.0)));
  store<f64>(QK0001 + 24, 1.0);   // the (0, 0, 0, 1) argument
}
function lut(b: i32): f64 { return load<f64>(B255 + (<usize>b << 3)); }
function lut15(b: i32): f64 { return load<f64>(B15 + (<usize>b << 3)); }

// ---- the 64-bit x87 emulation (./ext.ts) ----
let T0: f64 = 0, T1: f64 = 0, T2: f64 = 0, A0: f64 = 0, A1: f64 = 0;
const SPLIT: f64 = 134217729;
function twoProd(a: f64, b: f64): void {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  T0 = p; T1 = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
function renorm(): void { const s = T0 + T1; T1 = T1 - (s - T0); T0 = s; }
function round64(): f64 {
  const h = T0, l = T1;
  if (l == 0 || h == 0 || !isFinite<f64>(h)) { T2 = 0; return h + l; }
  const hb = reinterpret<u64>(h);
  let e = <i32>((hb >> 52) & 0x7ff) - 1023;
  if ((hb & 0xfffffffffffff) == 0 && (l < 0) != (h < 0)) e--;
  const q = reinterpret<f64>(<u64>(e - 63 + 1023) << 52);
  const x = l / q;
  const f = Math.floor(x), d = x - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 == 0 ? f : f + 1);
  const nl = r * q;
  const s = h + nl;
  T2 = nl - (s - h);
  return s;
}
function eadd(ah: f64, al: f64, bh: f64, bl: f64): f64 {
  let s = ah + bh, bb = s - ah, e = (ah - (s - bb)) + (bh - bb);
  const t = al + bl; bb = t - al; const f = (al - (t - bb)) + (bl - bb);
  e += t;
  let u = s + e; e = e - (u - s); s = u;
  e += f;
  u = s + e; e = e - (u - s);
  T0 = u; T1 = e;
  return round64();
}
function emul(ah: f64, al: f64, bh: f64, bl: f64): f64 {
  twoProd(ah, bh);
  T1 += ah * bl + al * bh;
  renorm();
  return round64();
}
function ediv(ah: f64, al: f64, bh: f64, bl: f64): f64 {
  const q1 = ah / bh;
  twoProd(q1, bh); let rh = ah - T0, rl = al - T1 - q1 * bl;
  let s = rh + rl; rl = rl - (s - rh); rh = s;
  const q2 = rh / bh;
  twoProd(q2, bh); rh = rh - T0; rl = rl - T1 - q2 * bl;
  const q3 = (rh + rl) / bh;
  s = q1 + q2; let e = q2 - (s - q1);
  e += q3;
  T0 = s + e; T1 = e - (T0 - s);
  return round64();
}
function nextUp32(x: f64): f64 {
  if (x == 0) return 1.401298464324817e-45;
  const b = reinterpret<i32>(<f32>x);
  return <f64>reinterpret<f32>(x > 0 ? b + 1 : b - 1);
}
function toF32(h: f64, l: f64): f64 {
  const r = fr(h);
  if (l == 0 || r == h) return r;
  const other = r < h ? nextUp32(r) : -nextUp32(-r);
  const mid = (r + other) / 2;
  if (h != mid) return r;
  return (l > 0) == (other > r) ? other : r;
}
function ld(x: f64): void { A0 = x; A1 = 0; }
function ldE(h: f64, l: f64): void { A0 = h; A1 = l; }
function fadd(x: f64): void { A0 = eadd(A0, A1, x, 0); A1 = T2; }
function fsub(x: f64): void { A0 = eadd(A0, A1, -x, 0); A1 = T2; }
function fsubr(x: f64): void { A0 = eadd(x, 0, -A0, -A1); A1 = T2; }
function fmul(x: f64): void { A0 = emul(A0, A1, x, 0); A1 = T2; }
function fdivr(x: f64): void { A0 = ediv(x, 0, A0, A1); A1 = T2; }
function faddE(h: f64, l: f64): void { A0 = eadd(A0, A1, h, l); A1 = T2; }
function fsubE(h: f64, l: f64): void { A0 = eadd(A0, A1, -h, -l); A1 = T2; }
function fmulE(h: f64, l: f64): void { A0 = emul(A0, A1, h, l); A1 = T2; }
function st32(): f64 { return toF32(A0, A1); }
function truncE(h: f64, l: f64): f64 {
  const t = Math.trunc(h);
  if (t != h || l == 0) return t;
  return h > 0 ? (l < 0 ? t - 1 : t) : (l > 0 ? t + 1 : t);
}
// (the 64-bit fallbacks live in separate functions so the fast checks stay small enough to inline)
function add32(a: f64, b: f64): f64 {
  const s = a + b;
  if (s - a == b && s - b == a) return fr(s);
  return add32slow(a, b);
}
function add32slow(a: f64, b: f64): f64 { ld(a); fadd(b); return st32(); }
function add32b(a: f64, b: f64): f64 {
  const r = a + b, e = (abs<f64>(a) + abs<f64>(b)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  if (r - a == b && r - b == a) return fr(r);
  ld(a); fadd(b); return st32();
}
function twoErr(a: f64, b: f64, s: f64): f64 { const bb = s - a; return (a - (s - bb)) + (b - bb); }
function sum3Exact(a: f64, b: f64, c: f64): bool {
  const ab = a + b, s = ab + c;
  return ab - a == b && ab - b == a && s - ab == c && s - c == ab;
}
function evalW(a: f64, b: f64, c: f64, w: f64): f64 {
  const r = (a + b + c) * w, e = (abs<f64>(a) + abs<f64>(b) + abs<f64>(c)) * abs<f64>(w) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  if (r == 0 && sum3Exact(a, b, c)) return r;
  ld(a); fadd(b); fadd(c); fmul(w); return st32();
}
function recip(a: f64, b: f64, c: f64): f64 {
  const s = a + b + c, d = (abs<f64>(a) + abs<f64>(b) + abs<f64>(c)) * EPS;
  if (abs<f64>(s) > 4 * d) {
    const r = 1 / s, e = abs<f64>(r) * (2 * d / abs<f64>(s) + EPS);
    const lo = fr(r - e);
    if (lo == fr(r + e)) return lo;
  }
  ld(a); fadd(b); fadd(c);
  if (A0 == 0 && A1 == 0) return 0;
  fdivr(1); return st32();
}
function depth16(a: f64, b: f64, c: f64): i32 {
  const ab = a + b, z = ab + c;
  if (twoErr(a, b, ab) == 0 && twoErr(ab, c, z) == 0 && fr(z) == z && z >= 0 && z <= 1) return <i32>Math.floor(z * 65535 + 0.5);
  const d = (abs<f64>(a) + abs<f64>(b) + abs<f64>(c)) * EPS;
  if (z - d > 0 && z + d < 1) {
    const v = z * 65535 + 0.5, e = d * 65536 + v * EPS;
    const q = Math.floor(v - e);
    if (q == Math.floor(v + e)) return <i32>q;
  }
  ld(a); fadd(b); fadd(c);
  const zc = A0; ld(zc > 1 ? 1 : zc >= 0 ? zc : 0); fmul(65535); fadd(0.5);
  return <i32>truncE(A0, A1);
}
function lenE(a: f64, b: f64): void {
  const x = abs<f64>(a), y = abs<f64>(b);
  ld(x); fadd(y); fmul(0.34375); const h = A0, l = A1;
  ld(max<f64>(x, y) * 0.65625); faddE(h, l);
}
function linCoord(c: f64, size: f64): i32 {
  const p = c * size, t = (p - 0.5) + 393216, e = (abs<f64>(p) + 393217) * EPS;
  const r = fr(t - e);
  if (r == fr(t + e)) return (bitsOf(r) << 10) >> 10;
  ld(p); fsub(0.5); fadd(393216);
  return (bitsOf(st32()) << 10) >> 10;
}
function pointCoord(c: f64, size: f64): i32 {
  const t = c * size - 0.5;
  return ftol(c < 0 ? t - 0.5 : t + 0.5);
}
function address(i: i32, n: i32, mode: i32): i32 {
  if (i >= 0 && i <= n - 1) return i;
  if (mode == 3) return i < 0 ? 0 : n - 1;
  if (mode == 2) { if (i < 0) i = -1 - i; const r = i % n; return ((i / n) & 1) ? n - 1 - r : r; }
  if (mode == 5) { if (i < 0) i = -1 - i; return i > n - 1 ? n - 1 : i; }
  i = i % n; return i < 0 ? i + n : i;
}
function cmpFunc(f: i32, a: i32, b: i32): bool {
  switch (f) {
    case 1: return false; case 2: return a < b; case 3: return a == b; case 4: return a <= b;
    case 5: return a > b; case 6: return a != b; case 7: return a >= b; default: return true;
  }
}

// ---- planes (PL): A, B, C, M, K per component, flat, konst ----
function pA(p: usize, i: i32): f64 { return load<f64>(p + (<usize>i << 3)); }
function pB(p: usize, i: i32): f64 { return load<f64>(p + 32 + (<usize>i << 3)); }
function pC(p: usize, i: i32): f64 { return load<f64>(p + 64 + (<usize>i << 3)); }
function pM(p: usize, i: i32): f64 { return load<f64>(p + 96 + (<usize>i << 3)); }
function pK(p: usize, i: i32): f64 { return load<f64>(p + 128 + (<usize>i << 3)); }
function pFlat(p: usize): bool { return load<i32>(p + 160) != 0; }
function pKonst(p: usize): bool { return load<i32>(p + 164) != 0; }
const PZ: usize = PL, PD: usize = PL + PLS, PS: usize = PL + 2 * PLS, PT: usize = PL + 3 * PLS;
function ptex(i: i32): usize { return PT + <usize>i * PLS; }

// ---- quad buffers ----
const QW: usize = QB, QTU: usize = QB + 32, QTV: usize = QB + 32 + 256, QTEXC: usize = QB + 32 + 512;
const QDIF: usize = QTEXC + 1024, QSPE: usize = QDIF + 32, QCUR: usize = QSPE + 32, QRES: usize = QCUR + 32;
const QTMP: usize = QRES + 32, QA1: usize = QTMP + 32, QA2: usize = QA1 + 32, QA0: usize = QA2 + 32;
const QTEXV: usize = QA0 + 32, QDST: usize = QTEXV + 32, QK0001: usize = QDST + 32, QTFV: usize = SF;

// ---- per-triangle state ----
let X0: i32 = 0, Y0: i32 = 0, X1: i32 = 0, Y1: i32 = 0, X2: i32 = 0, Y2: i32 = 0;
let fX0: f64 = 0, fY0: f64 = 0, dX10: f64 = 0, dX02: f64 = 0, dY01: f64 = 0, dY20: f64 = 0;
let invDet: f64 = 0, det: f64 = 0;
let xmin: i32 = 0, xmax: i32 = 0, ymin: i32 = 0, ymax: i32 = 0, bx: f64 = 0, by: f64 = 0;
let Arhw: f64 = 0, Brhw: f64 = 0, Crhw: f64 = 0, wConst: f64 = 0, Mrhw: f64 = 0;
let eA0: f64 = 0, eB0: f64 = 0, eC0: f64 = 0, eI0: i32 = 0, eA1: f64 = 0, eB1: f64 = 0, eC1: f64 = 0, eI1: i32 = 0;
let eA2: f64 = 0, eB2: f64 = 0, eC2: f64 = 0, eI2: i32 = 0, eA3: f64 = 0, eB3: f64 = 0, eC3: f64 = 0, eI3: i32 = 0, nEdges: i32 = 3;
let sprite: bool = false;
let cov0: bool = false, cov1: bool = false, cov2: bool = false, cov3: bool = false;

function edge(k: i32, flip: bool, xa: i32, ya: i32, xb: i32, yb: i32): void {
  let A = <f64>(ya - yb), B = <f64>(xb - xa);
  if (flip) { A = -A; B = -B; }
  const C = -(B * <f64>ya + A * <f64>xa), I = (A != 0 ? A > 0 : B > 0) ? 1 : 0;
  if (k == 0) { eA0 = A; eB0 = B; eC0 = C; eI0 = I; }
  else if (k == 1) { eA1 = A; eB1 = B; eC1 = C; eI1 = I; }
  else if (k == 2) { eA2 = A; eB2 = B; eC2 = C; eI2 = I; }
  else { eA3 = A; eB3 = B; eC3 = C; eI3 = I; }
}
function snapI(x: f64): i32 { return (bitsOf(fr(x + 786432)) << 10) >> 10; }

/** setup (rast.ts setup): true = dropped */
function setup(a: usize, b: usize, c: usize, cull: i32): bool {
  const ax = load<f64>(a + SX * 8), ay = load<f64>(a + SY * 8), bxv = load<f64>(b + SX * 8), byv = load<f64>(b + SY * 8);
  const cx = load<f64>(c + SX * 8), cy = load<f64>(c + SY * 8);
  X0 = snapI(ax); Y0 = snapI(ay); X1 = snapI(bxv); Y1 = snapI(byv); X2 = snapI(cx); Y2 = snapI(cy);
  det = <f64>(Y2 - Y0) * <f64>(X1 - X0) - <f64>(Y0 - Y1) * <f64>(X0 - X2);
  if (det == 0 || (cull == 2 && det > 0) || (cull == 3 && det < 0)) return true;
  // bbox
  const mnx = min<f64>(ax, min<f64>(bxv, cx)), mxx = max<f64>(ax, max<f64>(bxv, cx));
  const mny = min<f64>(ay, min<f64>(byv, cy)), mxy = max<f64>(ay, max<f64>(byv, cy));
  xmin = max<i32>(ftol(mnx + 0.5), si(0)); xmax = min<i32>(ftol(mxx + 0.5), si(2));
  ymin = max<i32>(ftol(mny + 0.5), si(1)); ymax = min<i32>(ftol(mxy + 0.5), si(3));
  bx = <f64>max<i32>(abs<i32>(xmin), abs<i32>(xmax + 1)); by = <f64>max<i32>(abs<i32>(ymin), abs<i32>(ymax + 1));
  fX0 = <f64>X0 * 0.0625; fY0 = <f64>Y0 * 0.0625;
  dX10 = <f64>(X1 - X0) * 0.0625; dX02 = <f64>(X0 - X2) * 0.0625; dY01 = <f64>(Y0 - Y1) * 0.0625; dY20 = <f64>(Y2 - Y0) * 0.0625;
  const q = det * 0.00390625, iv = 1 / q, ei = abs<f64>(iv) * EPS;
  invDet = fr(iv - ei);
  if (invDet != fr(iv + ei)) { ld(q); fdivr(1); invDet = st32(); }
  const w0 = load<f64>(a + RHW * 8), w1 = load<f64>(b + RHW * 8), w2 = load<f64>(c + RHW * 8);
  if (w0 == w1 && w1 == w2) { Arhw = 0; Brhw = 0; Crhw = w0; return false; }
  {
    const d1d = w1 - w0, d2 = w2 - w0;
    const d1 = fr(d1d);
    if (twoErr(w1, -w0, d1d) == 0) {
      const e2 = twoErr(w2, -w0, d2) == 0 ? 0 : (abs<f64>(w2) + abs<f64>(w0)) * EPS;
      const ta = d2 * dY01, tb = dY20 * d1;
      const ra = (tb + ta) * iv, ea = ((abs<f64>(ta) + abs<f64>(tb)) * EPS + e2 * abs<f64>(dY01)) * abs<f64>(iv) * 2;
      const A = fr(ra - ea);
      if (A == fr(ra + ea)) {
        const tc = d2 * dX10, td = dX02 * d1;
        const rb = (td + tc) * iv, eb = ((abs<f64>(tc) + abs<f64>(td)) * EPS + e2 * abs<f64>(dX10)) * abs<f64>(iv) * 2;
        const B = fr(rb - eb);
        if (B == fr(rb + eb)) {
          const u = A * fX0, v = rb * fY0;
          const rc = w0 - u - v, ec = (abs<f64>(w0) + abs<f64>(u) + abs<f64>(v)) * EPS + eb * abs<f64>(fY0);
          const C = fr(rc - ec);
          if (C == fr(rc + ec)) { Arhw = A; Brhw = B; Crhw = C; return false; }
        }
      }
    }
  }
  ld(q); fdivr(1); const ih = A0, il = A1;
  ld(w1); fsub(w0); const d1 = st32();
  ld(w2); fsub(w0); const d2h = A0, d2l = A1;
  ldE(d2h, d2l); fmul(dY01); fadd(dY20 * d1); fmulE(ih, il);
  Arhw = st32();
  ldE(d2h, d2l); fmul(dX10); fadd(dX02 * d1); fmulE(ih, il);
  const bh = A0, bl = A1; Brhw = st32();
  ld(Arhw * fX0); fsubr(w0); const ch = A0, cl = A1;
  ldE(bh, bl); fmul(fY0); ldE(-A0, -A1); faddE(ch, cl);
  Crhw = st32();
  return false;
}

/** one component's plane (rast.ts plane) */
function plane(p: usize, i: i32, a0: f64, a1: f64, a2: f64, w0: f64, w1: f64, w2: f64): void {
  {
    const p0 = w0 * a0, x1 = w1 * a1, x2 = w2 * a2;
    const d1d = x1 - p0, d2 = x2 - p0;
    let d1 = fr(d1d);
    if (twoErr(x1, -p0, d1d) != 0) { const e1 = (abs<f64>(x1) + abs<f64>(p0)) * EPS; d1 = fr(d1d - e1); if (d1 != fr(d1d + e1)) d1 = NaN; }
    if (d1 == d1) {
      const iv = invDet;
      const e2 = twoErr(x2, -p0, d2) == 0 ? 0 : (abs<f64>(x2) + abs<f64>(p0)) * EPS;
      const ta = d2 * dY01, tb = d1 * dY20;
      const ra = (ta + tb) * iv, ea = ((abs<f64>(ta) + abs<f64>(tb)) * EPS + e2 * abs<f64>(dY01)) * abs<f64>(iv);
      const A = fr(ra - ea);
      if (A == fr(ra + ea)) {
        const tc = d2 * dX10, td = d1 * dX02;
        const rb = (tc + td) * iv, eb = ((abs<f64>(tc) + abs<f64>(td)) * EPS + e2 * abs<f64>(dX10)) * abs<f64>(iv);
        const B = fr(rb - eb);
        if (B == fr(rb + eb)) {
          const pf = fr(p0), u = fX0 * A, v = rb * fY0;
          const rc = pf - u - v, ec = (abs<f64>(pf) + abs<f64>(u) + abs<f64>(v)) * EPS + eb * abs<f64>(fY0);
          const C = fr(rc - ec);
          if (C == fr(rc + ec)) { setPlane(p, i, A, B, C); return; }
        }
      }
    }
  }
  ld(w0 * a0); const p0h = A0, p0l = A1; const p0 = st32();
  ld(w1 * a1); fsubE(p0h, p0l); const d1 = st32();
  ld(w2 * a2); fsubE(p0h, p0l); const d2h = A0, d2l = A1;
  fmul(dY01); fadd(d1 * dY20); fmul(invDet); const A = st32();
  ldE(d2h, d2l); fmul(dX10); fadd(d1 * dX02); fmul(invDet); const bh = A0, bl = A1; const B = st32();
  ld(fX0 * A); fsubr(p0); const ch = A0, cl = A1;
  ldE(bh, bl); fmul(fY0); ldE(-A0, -A1); faddE(ch, cl);
  setPlane(p, i, A, B, st32());
}
function setPlane(p: usize, i: i32, A: f64, B: f64, C: f64): void {
  store<f64>(p + (<usize>i << 3), A); store<f64>(p + 32 + (<usize>i << 3), B); store<f64>(p + 64 + (<usize>i << 3), C);
  store<f64>(p + 96 + (<usize>i << 3), (abs<f64>(A) * bx + abs<f64>(B) * by + abs<f64>(C)) * EPS);
}
function konst(p: usize): void {
  let k = !pFlat(p) && wConst == wConst;
  for (let i = 0; k && i < 4; i++) k = pA(p, i) == 0 && pB(p, i) == 0;
  store<i32>(p + 164, k ? 1 : 0);
  if (k) for (let i = 0; i < 4; i++) store<f64>(p + 128 + (<usize>i << 3), clamp01(evalW(0, 0, pC(p, i), wConst)));
}
function colByte(v: usize, base: i32, has: bool, dflt: f64, k: i32): f64 {
  return has ? fr(<f64>(ftol(load<f64>(v + <usize>(base + k) * 8) * 255) & 0xff) * INV255D) : dflt;
}

/** attribute setup (rast.ts attributes) */
function attributes(a: usize, b: usize, c: usize, o0: usize): void {
  const w0 = load<f64>(a + RHW * 8), w1 = load<f64>(b + RHW * 8), w2 = load<f64>(c + RHW * 8);
  if (si(29)) plane(PZ, 0, load<f64>(a + SZ * 8), load<f64>(b + SZ * 8), load<f64>(c + SZ * 8), 1, 1, 1);
  const flat = si(5) != 0, doSpec = si(9) != 0, hd = si(22) != 0, hs = si(23) != 0;
  store<i32>(PD + 160, flat ? 1 : 0); if (doSpec) store<i32>(PS + 160, flat ? 1 : 0);
  for (let k = 0; k < 4; k++) {
    if (flat) {
      store<f64>(PD + 64 + (<usize>k << 3), colByte(o0, DIF, hd, 1, k));
      if (doSpec) store<f64>(PS + 64 + (<usize>k << 3), colByte(o0, SPE, hs, 0, k));
    } else {
      plane(PD, k, colByte(a, DIF, hd, 1, k), colByte(b, DIF, hd, 1, k), colByte(c, DIF, hd, 1, k), w0, w1, w2);
      if (doSpec) plane(PS, k, colByte(a, SPE, hs, 0, k), colByte(b, SPE, hs, 0, k), colByte(c, SPE, hs, 0, k), w0, w1, w2);
    }
  }
  konst(PD);
  if (doSpec) konst(PS);
  const ns = si(21);
  for (let i = 0; i < ns; i++) {
    const sd = SS + <usize>i * 512;
    if (!load<i32>(sd)) continue;
    const p = ptex(i);
    if (sprite) {
      plane(p, 0, 0, 1, 0, w0, w1, w2); plane(p, 1, 0, 0, 1, w0, w1, w2);
    } else {
      const set = load<i32>(sd + 4), dims = load<i32>(sd + 8), t = <usize>(TEX + set * 4) * 8;
      const d0 = dims > 0, d1 = dims > 1;
      plane(p, 0, d0 ? load<f64>(a + t) : 0, d0 ? load<f64>(b + t) : 0, d0 ? load<f64>(c + t) : 0, w0, w1, w2);
      plane(p, 1, d1 ? load<f64>(a + t + 8) : 0, d1 ? load<f64>(b + t + 8) : 0, d1 ? load<f64>(c + t + 8) : 0, w0, w1, w2);
    }
  }
}

/** DrawTriangle (rast.ts triangle); returns 0 */
export function triangle(v0: usize, v1: usize, v2: usize): i32 {
  const x0 = load<f64>(v0 + SX * 8), y0 = load<f64>(v0 + SY * 8), x1 = load<f64>(v1 + SX * 8), y1 = load<f64>(v1 + SY * 8);
  const x2 = load<f64>(v2 + SX * 8), y2 = load<f64>(v2 + SY * 8);
  let best = 0, bxx = x0, byy = y0;
  if (x1 < bxx || (x1 == bxx && y1 < byy)) { best = 1; bxx = x1; byy = y1; }
  if (x2 < bxx || (x2 == bxx && y2 < byy)) best = 2;
  let r0 = v0, r1 = v1, r2 = v2;
  if (best == 1) { r0 = v1; r1 = v2; r2 = v0; } else if (best == 2) { r0 = v2; r1 = v0; r2 = v1; }
  if (setup(r0, r1, r2, si(4))) return 0;
  const flip = det > 0;
  edge(0, flip, X0, Y0, X1, Y1); edge(1, flip, X1, Y1, X2, Y2); edge(2, flip, X2, Y2, X0, Y0);
  nEdges = 3;
  wConst = Arhw == 0 && Brhw == 0 ? recip(0, 0, Crhw) : NaN;
  Mrhw = (abs<f64>(Arhw) * bx + abs<f64>(Brhw) * by + abs<f64>(Crhw)) * EPS;
  attributes(r0, r1, r2, v0);
  scan();
  return 0;
}

/** DrawPoint (rast.ts point) */
export function point(v: usize): void {
  let size = si(24) ? load<f64>(v + PSZ * 8) : fromBits(si(31));
  const mn = fromBits(si(32)), mxr = fromBits(si(33));
  if (size < mn) size = mn;
  const m = 64 <= mxr ? 64.0 : mxr;
  if (m < size) size = m;
  ld(size); fmul(0.5); const hh = A0, hl = A1;
  const x = load<f64>(v + SX * 8), y = load<f64>(v + SY * 8);
  ld(x); faddE(hh, hl); const xR = st32();
  ld(y); faddE(hh, hl); const yB = st32();
  ld(x); fsubE(hh, hl); const xL = st32();
  ld(y); fsubE(hh, hl); const yT = st32();
  const c0 = CV, c1 = CV + ST * 8, c2 = CV + 2 * ST * 8;
  memory.copy(c0, v, ST * 8); memory.copy(c1, v, ST * 8); memory.copy(c2, v, ST * 8);
  store<f64>(c0 + SX * 8, xL); store<f64>(c0 + SY * 8, yT);
  store<f64>(c1 + SX * 8, xR); store<f64>(c1 + SY * 8, yT);
  store<f64>(c2 + SX * 8, xL); store<f64>(c2 + SY * 8, yB);
  sprite = si(30) != 0;
  if (!setup(c0, c1, c2, 1)) {
    const X3 = snapI(xR), Y3 = snapI(yB);
    const flip = det > 0;
    edge(0, flip, X0, Y0, X1, Y1); edge(1, flip, X1, Y1, X3, Y3); edge(2, flip, X3, Y3, X2, Y2); edge(3, flip, X2, Y2, X0, Y0);
    nEdges = 4;
    wConst = Arhw == 0 && Brhw == 0 ? recip(0, 0, Crhw) : NaN;
    Mrhw = (abs<f64>(Arhw) * bx + abs<f64>(Brhw) * by + abs<f64>(Crhw)) * EPS;
    attributes(c0, c1, c2, c0);
    scan();
  }
  sprite = false;
}

function scan(): void {
  const n = nEdges;
  const a0 = eA0 * 16, b0 = eB0 * 16, c0 = eC0 - (eI0 ? 0 : 1);
  const a1 = eA1 * 16, b1 = eB1 * 16, c1 = eC1 - (eI1 ? 0 : 1);
  const a2 = eA2 * 16, b2 = eB2 * 16, c2 = eC2 - (eI2 ? 0 : 1);
  const a3 = n > 3 ? eA3 * 16 : 0, b3 = n > 3 ? eB3 * 16 : 0, c3 = n > 3 ? eC3 - (eI3 ? 0 : 1) : -1;
  const x0 = xmin, x1 = xmax, y1 = ymax;
  for (let y = ymin; y <= y1; y += 2) {
    const lastRow = y + 1 > y1;
    for (let x = x0; x <= x1; x += 2) {
      let any = false;
      for (let k = 0; k < 4; k++) {
        const px = <f64>(x + (k & 1)), py = <f64>(y + (k >> 1));
        const inn = x + (k & 1) <= x1 && !(lastRow && k > 1) &&
          a0 * px + b0 * py + c0 < 0 && a1 * px + b1 * py + c1 < 0 && a2 * px + b2 * py + c2 < 0 && a3 * px + b3 * py + c3 < 0;
        if (k == 0) cov0 = inn; else if (k == 1) cov1 = inn; else if (k == 2) cov2 = inn; else cov3 = inn;
        any = any || inn;
      }
      if (any) quad(x, y);
    }
  }
}

function quad(x: i32, y: i32): void {
  const wc = wConst;
  if (wc == wc) { store<f64>(QW, wc); store<f64>(QW + 8, wc); store<f64>(QW + 16, wc); store<f64>(QW + 24, wc); }
  else {
    const d = Mrhw;
    for (let k = 0; k < 4; k++) {
      const a = <f64>(x + (k & 1)) * Arhw, b = <f64>(y + (k >> 1)) * Brhw;
      const s = a + b + Crhw;
      let v: f64 = NaN;
      if (abs<f64>(s) > 4 * d) { const r = 1 / s, e = abs<f64>(r) * (2 * d / abs<f64>(s) + EPS); v = fr(r - e); if (v != fr(r + e)) v = NaN; }
      store<f64>(QW + (<usize>k << 3), v == v ? v : recip(a, b, Crhw));
    }
  }
  const ns = si(21);
  for (let i = 0; i < ns; i++) {
    const sd = SS + <usize>i * 512;
    if (!load<i32>(sd)) continue;
    const p = ptex(i), b = <usize>(i * 4) << 3;
    const Au = pA(p, 0), Bu = pB(p, 0), Cu = pC(p, 0), Av = pA(p, 1), Bv = pB(p, 1), Cv = pC(p, 1), Mu = pM(p, 0), Mv = pM(p, 1);
    for (let k = 0; k < 4; k++) {
      const xf = <f64>(x + (k & 1)), yf = <f64>(y + (k >> 1)), w = load<f64>(QW + (<usize>k << 3)), aw = abs<f64>(w);
      let xa = xf * Au, yb = yf * Bu, r = (xa + yb + Cu) * w, e = Mu * aw;
      let v = fr(r - e);
      store<f64>(QTU + b + (<usize>k << 3), v == fr(r + e) || (r == 0 && sum3Exact(xa, yb, Cu)) ? fr(r) : evalW(xa, yb, Cu, w));
      xa = xf * Av; yb = yf * Bv; r = (xa + yb + Cv) * w; e = Mv * aw;
      v = fr(r - e);
      store<f64>(QTV + b + (<usize>k << 3), v == fr(r + e) || (r == 0 && sum3Exact(xa, yb, Cv)) ? fr(r) : evalW(xa, yb, Cv, w));
    }
    sample(i, sd);
  }
  const zOn = si(6) != 0, spec = si(9) != 0;
  const Az = pA(PZ, 0), Bz = pB(PZ, 0), Cz = pC(PZ, 0);
  for (let k = 0; k < 4; k++) {
    const c = k == 0 ? cov0 : k == 1 ? cov1 : k == 2 ? cov2 : cov3;
    if (!c) continue;
    const px = x + (k & 1), py = y + (k >> 1), w = load<f64>(QW + (<usize>k << 3));
    let zq: i32 = 0;
    if (zOn) {
      const a = <f64>px * Az, b = <f64>py * Bz, ab = a + b, z = ab + Cz;
      if (ab - a == b && ab - b == a && z - ab == Cz && z - Cz == ab && fr(z) == z && z >= 0 && z <= 1) zq = <i32>Math.floor(z * 65535 + 0.5);
      else zq = depth16(a, b, Cz);
    }
    color(PD, QDIF, px, py, w);
    if (spec) color(PS, QSPE, px, py, w);
    pixel(px, py, k, zq);
  }
}

function color(p: usize, out: usize, x: i32, y: i32, w: f64): void {
  if (pKonst(p)) { memory.copy(out, p + 128, 32); return; }
  if (pFlat(p)) { for (let i = 0; i < 4; i++) store<f64>(out + (<usize>i << 3), clamp01(pC(p, i))); return; }
  const aw = abs<f64>(w);
  for (let i = 0; i < 4; i++) {
    const xa = <f64>x * pA(p, i), yb = <f64>y * pB(p, i), c = pC(p, i), r = (xa + yb + c) * w, e = pM(p, i) * aw;
    let v = fr(r - e);
    if (v != fr(r + e)) v = r == 0 && sum3Exact(xa, yb, c) ? r : evalW(xa, yb, c, w);
    store<f64>(out + (<usize>i << 3), v > 1 ? 1 : v < 0 ? 0 : v);
  }
}

// ---- texture sampling (rast.ts sample / lodOf / acc) ----
function lodOf(sd: usize, b: usize): i32 {
  const W0 = <f64>load<i32>(sd + 40), H0 = <f64>load<i32>(sd + 44), bias = load<f64>(sd + 64);
  const u0 = load<f64>(QTU + b), u1 = load<f64>(QTU + b + 8), u2 = load<f64>(QTU + b + 16);
  const v0 = load<f64>(QTV + b), v1 = load<f64>(QTV + b + 8), v2 = load<f64>(QTV + b + 16);
  const g0 = fr(W0 * add32(u1, -u0)), g1 = fr(W0 * add32(u2, -u0));
  const g2 = fr(H0 * add32(v1, -v0)), g3 = fr(H0 * add32(v2, -v0));
  let x = abs<f64>(g0), y = abs<f64>(g2);
  const rx = (x + y) * 0.34375 + max<f64>(x, y) * 0.65625, ex = (x + y + rx) * EPS;
  x = abs<f64>(g1); y = abs<f64>(g3);
  const ry = (x + y) * 0.34375 + max<f64>(x, y) * 0.65625, ey = (x + y + ry) * EPS;
  const Lx = fr(rx - ex);
  let m: f64 = NaN;
  if (Lx == fr(rx + ex)) {
    if (Lx > ry + ey) m = Lx;
    else if (Lx < ry - ey) { const my = fr(ry - ey); if (my == fr(ry + ey)) m = my; }
  }
  if (m != m) {
    lenE(g0, g2); const lx = st32();
    lenE(g1, g3); const lyh = A0, lyl = A1;
    m = (lx > lyh || (lx == lyh && 0 > lyl)) ? lx : toF32(lyh, lyl);
  }
  const lod = fr(<f64>(bitsOf(m) - 0x3f800000) * 1.1920928955078125e-7);
  const t = (bias + lod) + 393216, e = (abs<f64>(bias) + abs<f64>(lod) + 393216) * EPS;
  let r = fr(t - e);
  if (r != fr(t + e)) { ld(bias); fadd(lod); fadd(393216); r = st32(); }
  return (bitsOf(r) << 16) >> 16;
}

function acc(o: usize, lv: usize, fmt: i32, iu: i32, iv: i32, au: i32, av: i32, w: f64): void {
  if (w == 0) return;
  const N = load<i32>(lv + 4), M = load<i32>(lv + 8);
  if (iu < 0 || iu >= N) iu = address(iu, N, au);
  if (iv < 0 || iv >= M) iv = address(iv, M, av);
  const p = <usize>load<i32>(lv) + <usize>(iv * load<i32>(lv + 12));
  let r: f64, g: f64, b: f64, a: f64;
  if (fmt == 26) {
    const q = p + <usize>(iu * 2), wd = <i32>load<u16>(q);
    r = lut15((wd >> 8) & 15); g = lut15((wd >> 4) & 15); b = lut15(wd & 15); a = lut15(wd >> 12);
  } else {
    const q = p + <usize>(iu * 4);
    b = lut(load<u8>(q)); g = lut(load<u8>(q + 1)); r = lut(load<u8>(q + 2));
    a = fmt == 22 ? 1.0 : lut(load<u8>(q + 3));
  }
  store<f64>(o, fr(r * w + load<f64>(o))); store<f64>(o + 8, fr(g * w + load<f64>(o + 8)));
  store<f64>(o + 16, fr(b * w + load<f64>(o + 16))); store<f64>(o + 24, fr(a * w + load<f64>(o + 24)));
}

function sample(i: i32, sd: usize): void {
  const b = <usize>(i * 4) << 3;
  let levels = 1, l0 = 0, l1 = 0, w0: f64 = 1, w1: f64 = 0;
  const minF = load<i32>(sd + 12), magF = load<i32>(sd + 16), mipF = load<i32>(sd + 20);
  let filt = minF;
  if (load<i32>(sd + 24)) {
    const iLOD = lodOf(sd, b);
    const mag = iLOD <= 0;
    filt = mag ? magF : minF;
    const base = load<i32>(sd + 28), maxL = load<i32>(sd + 48) - 1;   // maxMip (as unsigned: never negative here)
    if (mag || mipF == 0) l0 = min<i32>(max<i32>(0, base), maxL);
    else if (mipF == 1) l0 = min<i32>(max<i32>((iLOD + 16) >> 5, base), maxL);
    else {
      l0 = min<i32>(max<i32>(iLOD >> 5, base), maxL); l1 = min<i32>(max<i32>((iLOD >> 5) + 1, base), maxL);
      if (l0 != l1 && (iLOD & 31) != 0) { levels = 2; w1 = fr(<f64>(iLOD & 31) * 0.03125); w0 = fr(1 - w1); }
    }
  }
  const fmt = load<i32>(sd + 52), au = load<i32>(sd + 32), av = load<i32>(sd + 36), x8 = fmt == 22;
  for (let k = 0; k < 4; k++) {
    // an uncovered pixel's texel is never used (its coordinates, which the LOD needs, are already done)
    if (!(k == 0 ? cov0 : k == 1 ? cov1 : k == 2 ? cov2 : cov3)) continue;
    const o = QTEXC + ((<usize>(i * 4 + k)) << 5);
    const uk = load<f64>(QTU + b + (<usize>k << 3)), vk = load<f64>(QTV + b + (<usize>k << 3));
    let r: f64 = 0, g: f64 = 0, bb: f64 = 0, a: f64 = 0;
    store<f64>(o, 0); store<f64>(o + 8, 0); store<f64>(o + 16, 0); store<f64>(o + 24, 0);
    for (let l = 0; l < levels; l++) {
      const lv = sd + 128 + (<usize>(l == 0 ? l0 : l1) << 4), lw = l == 0 ? w0 : w1;
      const N = load<i32>(lv + 4), M = load<i32>(lv + 8);
      if (filt == 2 && fmt != 26) {
        let pu = uk * <f64>N, t = (pu - 0.5) + 393216, e = (abs<f64>(pu) + 393217) * EPS, q = fr(t - e);
        const nu = q == fr(t + e) ? (bitsOf(q) << 10) >> 10 : linCoord(uk, <f64>N);
        pu = vk * <f64>M; t = (pu - 0.5) + 393216; e = (abs<f64>(pu) + 393217) * EPS; q = fr(t - e);
        const nv = q == fr(t + e) ? (bitsOf(q) << 10) >> 10 : linCoord(vk, <f64>M);
        let u0 = nu >> 5, v0 = nv >> 5, u1 = u0 + 1, v1 = v0 + 1;
        if (u0 < 0 || u1 >= N) { u0 = address(u0, N, au); u1 = address(u1, N, au); }
        if (v0 < 0 || v1 >= M) { v0 = address(v0, M, av); v1 = address(v1, M, av); }
        const fu = <f64>(nu & 31) * 0.03125, fv = <f64>(nv & 31) * 0.03125, ou = 1 - fu, ov = 1 - fv;
        const d = <usize>load<i32>(lv), pitch = load<i32>(lv + 12);
        const p0 = d + <usize>(v0 * pitch), p1 = d + <usize>(v1 * pitch);
        const q0 = p0 + <usize>(u0 * 4), q1 = p0 + <usize>(u1 * 4), q2 = p1 + <usize>(u1 * 4), q3 = p1 + <usize>(u0 * 4);
        const w0s = ov * ou * lw, w1s = ov * fu * lw, w2s = fv * fu * lw, w3s = ou * fv * lw;
        r = fr(lut(load<u8>(q0 + 2)) * w0s + r); g = fr(lut(load<u8>(q0 + 1)) * w0s + g); bb = fr(lut(load<u8>(q0)) * w0s + bb); a = fr((x8 ? 1.0 : lut(load<u8>(q0 + 3))) * w0s + a);
        r = fr(lut(load<u8>(q1 + 2)) * w1s + r); g = fr(lut(load<u8>(q1 + 1)) * w1s + g); bb = fr(lut(load<u8>(q1)) * w1s + bb); a = fr((x8 ? 1.0 : lut(load<u8>(q1 + 3))) * w1s + a);
        r = fr(lut(load<u8>(q2 + 2)) * w2s + r); g = fr(lut(load<u8>(q2 + 1)) * w2s + g); bb = fr(lut(load<u8>(q2)) * w2s + bb); a = fr((x8 ? 1.0 : lut(load<u8>(q2 + 3))) * w2s + a);
        r = fr(lut(load<u8>(q3 + 2)) * w3s + r); g = fr(lut(load<u8>(q3 + 1)) * w3s + g); bb = fr(lut(load<u8>(q3)) * w3s + bb); a = fr((x8 ? 1.0 : lut(load<u8>(q3 + 3))) * w3s + a);
        store<f64>(o, r); store<f64>(o + 8, g); store<f64>(o + 16, bb); store<f64>(o + 24, a);
      } else if (filt == 2) {
        const nu = linCoord(uk, <f64>N), nv = linCoord(vk, <f64>M);
        const iu = nu >> 5, iv = nv >> 5;
        const fu = <f64>(nu & 31) * 0.03125, fv = <f64>(nv & 31) * 0.03125, ou = 1 - fu, ov = 1 - fv;
        acc(o, lv, fmt, iu, iv, au, av, ov * ou * lw);
        acc(o, lv, fmt, iu + 1, iv, au, av, ov * fu * lw);
        acc(o, lv, fmt, iu + 1, iv + 1, au, av, fv * fu * lw);
        acc(o, lv, fmt, iu, iv + 1, au, av, ou * fv * lw);
        r = load<f64>(o); g = load<f64>(o + 8); bb = load<f64>(o + 16); a = load<f64>(o + 24);
      } else {
        acc(o, lv, fmt, pointCoord(uk, <f64>N), pointCoord(vk, <f64>M), au, av, lw);
        r = load<f64>(o); g = load<f64>(o + 8); bb = load<f64>(o + 16); a = load<f64>(o + 24);
      }
    }
  }
}

// ---- stage blending and pixel operations (rast.ts pixel, colorOp, alphaOp, blend) ----
function argSrc(sel: i32): usize {
  switch (sel) {
    case 0: return QDIF; case 1: return QCUR; case 2: return QTEXV; case 3: return QTFV; case 4: return QSPE; case 5: return QTMP;
    default: return QK0001;
  }
}
function arg(a: i32, scratch: usize): usize {
  const s = argSrc(a & 0xf);
  if (!(a & 0x30)) return s;
  if (a & 0x10) { for (let i = 0; i < 4; i++) store<f64>(scratch + (<usize>i << 3), fr(1 - load<f64>(s + (<usize>i << 3)))); }
  else memory.copy(scratch, s, 32);
  if (a & 0x20) { const al = load<f64>(scratch + 24); store<f64>(scratch, al); store<f64>(scratch + 8, al); store<f64>(scratch + 16, al); }
  return scratch;
}
function subtract32(x1: f64, x2: f64): f64 {
  const u = 1 - x1, v = u + x2, r = 1 - v, e = (1 + abs<f64>(u) + abs<f64>(x2) + abs<f64>(v)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  if (u + x1 == 1 && v - u == x2 && v - x2 == u && r + v == 1) return fr(r);
  return subtract32slow(x1, x2);
}
function subtract32slow(x1: f64, x2: f64): f64 { ld(1); fsub(x1); fadd(x2); fsubr(1); return st32(); }
function lerp32(x1: f64, x2: f64, f: f64): f64 {
  const dd = x1 - x2, r = dd * f + x2, e = ((abs<f64>(x1) + abs<f64>(x2)) * abs<f64>(f) + abs<f64>(x2) + abs<f64>(r)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  ld(x1); fsub(x2); fmul(f); fadd(x2); return st32();
}
function tfAlphaMulAdd(x1: f64, x2: f64): f64 {
  // f32(E(E(E(x1 - x2) * f) + x2)) with f = E(alpha byte * f64(1/255)), exact as a double-double
  const ab = <f64>((<u32>si(20)) >>> 24);
  twoProd(ab, INV255D);
  const fh = T0, fl = T1;
  ld(x1); fsub(x2); fmulE(fh, fl); fadd(x2); return st32();
}
function colorOp(op: i32, x1: f64, x2: f64, x0: f64, difA: f64, texA: f64, curA: f64): f64 {
  switch (op) {
    case 2: case 17: return x1;
    case 3: return x2;
    case 4: return fr(x2 * x1);
    case 5: ld(x2 * 2); fmul(x1); return st32();
    case 6: ld(x2 * 4); fmul(x1); return st32();
    case 7: return add32(x2, x1);
    case 8: ld(x2); fadd(x1); fsub(0.5); return st32();
    case 9: ld(x2); fadd(x1); fsub(0.5); fmul(2); return st32();
    case 10: return subtract32(x1, x2);
    case 11: ld(1); fsub(x1); fmul(x2); fadd(x1); return st32();
    case 12: return lerp32(x1, x2, difA);
    case 13: return lerp32(x1, x2, texA);
    case 16: return lerp32(x1, x2, curA);
    case 14: return tfAlphaMulAdd(x1, x2);
    case 15: ld(1); fsub(texA); fmul(x2); fadd(x1); return st32();
    case 25: ld(x2 * x1); fadd(x0); return st32();
    case 26: ld(x1); fsub(x2); fmul(x0); fadd(x2); return st32();
    default: return 0;
  }
}
function alphaOp(op: i32, a1: f64, a2: f64, c1: f64, c2: f64, c0: f64, difA: f64, texA: f64, curA: f64): f64 {
  switch (op) {
    case 2: return a1;
    case 3: return a2;
    case 4: return fr(a2 * a1);
    case 5: return fr(a2 * a1 * 2);
    case 6: return fr(a2 * a1 * 4);
    case 7: return add32(a2, a1);
    case 8: ld(a2); fadd(a1); fsub(0.5); return st32();
    case 9: ld(a2); fadd(a1); fsub(0.5); fmul(2); return st32();
    case 10: return subtract32(a1, a2);
    case 11: ld(1); fsub(a1); fmul(a2); fadd(a1); return st32();
    case 12: return lerp32(a1, a2, difA);
    case 13: return lerp32(a1, a2, texA);
    case 16: return lerp32(a1, a2, curA);
    case 14: return tfAlphaMulAdd(a1, a2);
    case 15: ld(1); fsub(texA); fmul(a2); fadd(a1); return st32();
    case 25: ld(c2 * c1); fadd(c0); return st32();
    case 26: ld(c1); fsub(c2); fmul(c0); fadd(c2); return st32();
    default: return 1;
  }
}

/** the stage chain for the common case (i32 35 set by the glue: every op in SELECTARG1/2, MODULATE, MODULATE2X, ADD, alpha also
 *  DISABLE and SUBTRACT, arguments DIFFUSE / CURRENT / TEXTURE / TFACTOR without modifiers, results to CURRENT):
 *  the same arithmetic as the generic loop below, in locals */
function stagesFast(k: i32): void {
  const dr = load<f64>(QDIF), dg = load<f64>(QDIF + 8), db = load<f64>(QDIF + 16), da = load<f64>(QDIF + 24);
  const f0 = load<f64>(QTFV), f1 = load<f64>(QTFV + 8), f2 = load<f64>(QTFV + 16), f3 = load<f64>(QTFV + 24);
  let cr = dr, cg = dg, cb = db, ca = da;
  const ns = si(21);
  for (let c = 0; c < ns; c++) {
    const q = 40 + c * 8, op = si(q);
    if (op == 1) break;
    let t0: f64 = 0, t1: f64 = 0, t2: f64 = 0, t3: f64 = 1;
    if (load<i32>(SS + <usize>c * 512)) {
      const o = QTEXC + ((<usize>(c * 4 + k)) << 5);
      t0 = load<f64>(o); t1 = load<f64>(o + 8); t2 = load<f64>(o + 16); t3 = load<f64>(o + 24);
    }
    const s1 = si(q + 1), s2 = si(q + 2);
    const x1r = s1 == 0 ? dr : s1 == 1 ? cr : s1 == 2 ? t0 : f0, x1g = s1 == 0 ? dg : s1 == 1 ? cg : s1 == 2 ? t1 : f1;
    const x1b = s1 == 0 ? db : s1 == 1 ? cb : s1 == 2 ? t2 : f2;
    const x2r = s2 == 0 ? dr : s2 == 1 ? cr : s2 == 2 ? t0 : f0, x2g = s2 == 0 ? dg : s2 == 1 ? cg : s2 == 2 ? t1 : f1;
    const x2b = s2 == 0 ? db : s2 == 1 ? cb : s2 == 2 ? t2 : f2;
    let rr: f64, rg: f64, rb: f64;
    if (op == 2) { rr = x1r; rg = x1g; rb = x1b; }
    else if (op == 3) { rr = x2r; rg = x2g; rb = x2b; }
    else if (op == 4) { rr = fr(x2r * x1r); rg = fr(x2g * x1g); rb = fr(x2b * x1b); }
    else if (op == 5) { ld(x2r * 2); fmul(x1r); rr = st32(); ld(x2g * 2); fmul(x1g); rg = st32(); ld(x2b * 2); fmul(x1b); rb = st32(); }
    else { rr = add32(x2r, x1r); rg = add32(x2g, x1g); rb = add32(x2b, x1b); }
    const aop = si(q + 4), m1 = si(q + 5), m2 = si(q + 6);
    const al1 = m1 == 0 ? da : m1 == 1 ? ca : m1 == 2 ? t3 : f3, al2 = m2 == 0 ? da : m2 == 1 ? ca : m2 == 2 ? t3 : f3;
    let ra: f64;
    if (aop == 2) ra = al1;
    else if (aop == 3) ra = al2;
    else if (aop == 4) ra = fr(al2 * al1);
    else if (aop == 1) ra = 1;
    else ra = subtract32(al1, al2);
    cr = clamp01(rr); cg = clamp01(rg); cb = clamp01(rb); ca = clamp01(ra);
  }
  store<f64>(QCUR, cr); store<f64>(QCUR + 8, cg); store<f64>(QCUR + 16, cb); store<f64>(QCUR + 24, ca);
}

function pixel(px: i32, py: i32, k: i32, zq: i32): void {
  if (si(35)) { stagesFast(k); pixelTail(px, py, zq); return; }
  memory.copy(QCUR, QDIF, 32);
  store<f64>(QTMP, 0); store<f64>(QTMP + 8, 0); store<f64>(QTMP + 16, 0); store<f64>(QTMP + 24, 0);
  const ns = si(21);
  for (let c = 0; c < ns; c++) {
    const q = 40 + c * 8, op = si(q);
    if (op == 1) break;
    if (op == 22 || op == 23) continue;
    if (load<i32>(SS + <usize>c * 512)) memory.copy(QTEXV, QTEXC + ((<usize>(c * 4 + k)) << 5), 32);
    else { store<f64>(QTEXV, 0); store<f64>(QTEXV + 8, 0); store<f64>(QTEXV + 16, 0); store<f64>(QTEXV + 24, 1); }
    const x1 = arg(si(q + 1), QA1), x2 = arg(si(q + 2), QA2);
    const texA = load<f64>(QTEXV + 24), difA = load<f64>(QDIF + 24), curA = load<f64>(QCUR + 24);
    if (op == 2) memory.copy(QRES, x1, 24);
    else if (op == 3) memory.copy(QRES, x2, 24);
    else if (op == 4) { for (let ch = 0; ch < 3; ch++) store<f64>(QRES + (<usize>ch << 3), fr(load<f64>(x2 + (<usize>ch << 3)) * load<f64>(x1 + (<usize>ch << 3)))); }
    else if (op == 7) { for (let ch = 0; ch < 3; ch++) store<f64>(QRES + (<usize>ch << 3), add32(load<f64>(x2 + (<usize>ch << 3)), load<f64>(x1 + (<usize>ch << 3)))); }
    else {
      const x0 = arg(si(q + 3), QA0);
      for (let ch = 0; ch < 3; ch++) store<f64>(QRES + (<usize>ch << 3), colorOp(op, load<f64>(x1 + (<usize>ch << 3)), load<f64>(x2 + (<usize>ch << 3)), load<f64>(x0 + (<usize>ch << 3)), difA, texA, curA));
    }
    const aop = si(q + 4), m1 = si(q + 5), m2 = si(q + 6);
    let al1 = load<f64>(argSrc(m1 & 0xf) + 24), al2 = load<f64>(argSrc(m2 & 0xf) + 24);
    if (m1 & 0x10) al1 = fr(1 - al1);
    if (m2 & 0x10) al2 = fr(1 - al2);
    let ra: f64;
    if (aop == 2) ra = al1;
    else if (aop == 3) ra = al2;
    else if (aop == 4) ra = fr(al2 * al1);
    else if (aop == 1) ra = 1;
    else if (aop == 10) ra = subtract32(al1, al2);
    else { const x0 = arg(si(q + 3), QA0); ra = alphaOp(aop, al1, al2, load<f64>(x1 + 24), load<f64>(x2 + 24), load<f64>(x0 + 24), difA, texA, curA); }
    store<f64>(QRES + 24, ra);
    const dst = si(q + 7) == 5 ? QTMP : QCUR;
    for (let ch = 0; ch < 4; ch++) store<f64>(dst + (<usize>ch << 3), clamp01(load<f64>(QRES + (<usize>ch << 3))));
  }
  pixelTail(px, py, zq);
}

/** specular add, alpha test, depth, blend, write (rast.ts pixel after the stage loop), on QCUR */
function pixelTail(px: i32, py: i32, zq: i32): void {
  let c0 = load<f64>(QCUR), c1 = load<f64>(QCUR + 8), c2 = load<f64>(QCUR + 16), c3 = load<f64>(QCUR + 24);
  if (si(9)) {
    c0 = add32(c0, load<f64>(QSPE)); c1 = add32(c1, load<f64>(QSPE + 8)); c2 = add32(c2, load<f64>(QSPE + 16));
    if (c0 > 1) c0 = 1; if (c1 > 1) c1 = 1; if (c2 > 1) c2 = 1; if (c3 > 1) c3 = 1;
  }
  if (si(10) && !cmpFunc(si(11), ftol(c3 * 255) & 0xff, si(12))) return;
  let zo: usize = 0;
  if (si(6)) {
    zo = <usize>si(27) + <usize>(py * si(28) + px * 2);
    if (!cmpFunc(si(8), zq, <i32>load<u16>(zo))) return;
  }
  const ro = <usize>si(25) + <usize>(py * si(26) + px * 4);
  const cwe = si(13), bm = si(14), x8 = si(18) != 0;
  if (cwe != 0xf || bm) {
    const d0 = lut(load<u8>(ro + 2)), d1 = lut(load<u8>(ro + 1)), d2 = lut(load<u8>(ro)), d3 = x8 ? 1.0 : lut(load<u8>(ro + 3));
    if (bm == 1) {
      // SRCALPHA / INVSRCALPHA (rast.ts blendSrcAlpha)
      const as = c3, om = 1 - as, omf = fr(om);
      const s0 = fr(as * c0), s1 = fr(as * c1), s2 = fr(as * c2), s3 = fr(as * as);
      let dr: f64;
      const pr = om * d0, er = abs<f64>(pr) * EPS;
      if (1 - om == as && fr(pr - er) == fr(pr + er)) dr = fr(pr);
      else { ld(1); fsub(as); fmul(d0); dr = st32(); }
      // add32 inline (exact double sums round once; else the 64-bit path)
      let xx = dr, yy = s0, ss = xx + yy;
      c0 = clamp01(ss - xx == yy && ss - yy == xx ? fr(ss) : add32slow(xx, yy));
      xx = omf * d1; yy = s1; ss = xx + yy;
      c1 = clamp01(ss - xx == yy && ss - yy == xx ? fr(ss) : add32slow(xx, yy));
      xx = fr(omf * d2); yy = s2; ss = xx + yy;
      c2 = clamp01(ss - xx == yy && ss - yy == xx ? fr(ss) : add32slow(xx, yy));
      xx = fr(omf * d3); yy = s3; ss = xx + yy;
      c3 = clamp01(ss - xx == yy && ss - yy == xx ? fr(ss) : add32slow(xx, yy));
    } else if (bm == 2) {
      c0 = clamp01(add32(d0, c0)); c1 = clamp01(add32(d1, c1)); c2 = clamp01(add32(d2, c2)); c3 = clamp01(add32(d3, c3));
    } else if (bm == 4) {
      store<f64>(QRES, c0); store<f64>(QRES + 8, c1); store<f64>(QRES + 16, c2); store<f64>(QRES + 24, c3);
      store<f64>(QDST, d0); store<f64>(QDST + 8, d1); store<f64>(QDST + 16, d2); store<f64>(QDST + 24, d3);
      blend(si(15), si(16), si(17));
      c0 = load<f64>(QRES); c1 = load<f64>(QRES + 8); c2 = load<f64>(QRES + 16); c3 = load<f64>(QRES + 24);
    }
    if (!(cwe & 1)) c0 = d0;
    if (!(cwe & 2)) c1 = d1;
    if (!(cwe & 4)) c2 = d2;
    if (!(cwe & 8)) c3 = d3;
  }
  const off = si(19) ? DITHER((px & 3) * 4 + (py & 3)) : 0.5;
  store<u8>(ro, <u8>(<i32>(c2 * 255 + off))); store<u8>(ro + 1, <u8>(<i32>(c1 * 255 + off))); store<u8>(ro + 2, <u8>(<i32>(c0 * 255 + off)));
  store<u8>(ro + 3, x8 ? 0 : <u8>(<i32>(c3 * 255 + off)));
  if (si(7)) store<u16>(zo, <u16>zq);
}
function DITHER(i: i32): f64 {
  switch (i) {
    case 0: return 0.03125; case 1: return 0.53125; case 2: return 0.15625; case 3: return 0.65625;
    case 4: return 0.78125; case 5: return 0.28125; case 6: return 0.90625; case 7: return 0.40625;
    case 8: return 0.21875; case 9: return 0.71875; case 10: return 0.09375; case 11: return 0.59375;
    case 12: return 0.96875; case 13: return 0.46875; case 14: return 0.84375; default: return 0.34375;
  }
}

// generic blend (rast.ts blend / factor / factorE) on QRES (src -> result) and QDST
function cS(i: i32): f64 { return load<f64>(QRES + (<usize>i << 3)); }
function cD(i: i32): f64 { return load<f64>(QDST + (<usize>i << 3)); }
function factor(m: i32, i: i32, as: f64, ad: f64, src: bool): f64 {
  switch (m) {
    case 1: return 0;
    case 2: return 1;
    case 3: return cS(i);
    case 4: return fr(1 - cS(i));
    case 5: return as;
    case 6: return fr(1 - as);
    case 7: return ad;
    case 8: return fr(1 - ad);
    case 9: return cD(i);
    case 10: return fr(1 - cD(i));
    case 11: return i == 3 ? 1 : min<f64>(as, fr(1 - ad));
    case 12: return src ? as : fr(1 - as);
    case 13: return src ? fr(1 - as) : as;
    default: return 0;
  }
}
function factorE(m: i32, i: i32, as: f64, ad: f64): void {
  switch (m) {
    case 6: case 12: if (i == 0) { ld(1); fsub(as); } else ld(fr(1 - as)); return;
    case 8: if (i == 0) { ld(1); fsub(ad); } else ld(fr(1 - ad)); return;
    case 4: ld(1); fsub(cS(i)); return;
    case 10: ld(1); fsub(cD(i)); return;
    default: ld(factor(m, i, as, ad, false));
  }
}
function blend(sb: i32, db: i32, op: i32): void {
  if (op == 4 || op == 5) {
    for (let i = 0; i < 4; i++) store<f64>(QRES + (<usize>i << 3), op == 4 ? min<f64>(cS(i), cD(i)) : max<f64>(cS(i), cD(i)));
  } else {
    const as = cS(3), ad = cD(3);
    const S0 = fr(factor(sb, 0, as, ad, true) * cS(0)), S1 = fr(factor(sb, 1, as, ad, true) * cS(1));
    const S2 = fr(factor(sb, 2, as, ad, true) * cS(2)), S3 = fr(factor(sb, 3, as, ad, true) * cS(3));
    factorE(db, 0, as, ad); fmul(cD(0)); const DR = st32();
    factorE(db, 1, as, ad); fmul(cD(1)); const gh = A0, gl = A1;
    const DB = fr(factor(db, 2, as, ad, false) * cD(2)), DA = fr(factor(db, 3, as, ad, false) * cD(3));
    let r0: f64, r1: f64, r2: f64, r3: f64;
    if (op == 2) { r0 = add32(S0, -DR); ld(S1); fsubE(gh, gl); r1 = st32(); r2 = add32(S2, -DB); r3 = add32(S3, -DA); }
    else if (op == 3) { r0 = add32(DR, -S0); ldE(gh, gl); fsub(S1); r1 = st32(); r2 = add32(DB, -S2); r3 = add32(DA, -S3); }
    else { r0 = add32(DR, S0); ldE(gh, gl); fadd(S1); r1 = st32(); r2 = add32(DB, S2); r3 = add32(DA, S3); }
    store<f64>(QRES, r0); store<f64>(QRES + 8, r1); store<f64>(QRES + 16, r2); store<f64>(QRES + 24, r3);
  }
  for (let i = 0; i < 4; i++) store<f64>(QRES + (<usize>i << 3), clamp01(cS(i)));
}

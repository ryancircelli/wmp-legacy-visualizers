/* eslint-disable */
// @ts-nocheck
// AssemblyScript source of ./kernel-wasm.ts: the per-quad part of ./rast.ts (the 2x2-quad scan, EVAL, the pixel
// shader of ./ps.ts with texld's LOD and bilinear sampling from ./tex.ts, the pixel operations) compiled to
// WebAssembly, the same arithmetic operation for operation (doubles where the JS uses doubles, an f32 conversion where
// it calls Math.fround, the same 64-bit x87 emulation for the fallbacks: see ../../d3d8/ref/ext.ts, ported here as
// ../../d3d8/ref/kernel-as.ts did), so its pixels are the JS path's. The JS stays the reference and the path without
// WebAssembly; every comment on the arithmetic is there. Triangle setup stays in JS (rast.ts), which writes the
// triangle (bounding box, edges, planes), the draw (target, blend, shader program, samplers) and the constants into
// this module's memory (layout below, mirrored in ./kernel.ts); surfaces live in this memory too.
// Build: priv/tools/build9_wasm.mjs in the private scratch (AssemblyScript, -O3 --noAssert --runtime stub).

// ---- layout (byte offsets; ./kernel.ts mirrors these) ----
// i32 at SI + 4*i: 0 xmin 1 xmax 2 ymin 3 ymax 4..6 edge inclusive flags 7 live0 8 nInputs 9 rt 10 rtPitch 11 rtX8
//  12 readDst 13 blend 14 srcBlend 15 destBlend 16 cwe 17 nOps; inputs at 32 + 2*i: register (f64 index in a
//  pixel's file), coord flag
// f64 at SF + 8*i: 0..2 edge A 3..5 edge B 6..8 edge C (exact integers), 9 wConst (NaN: none), 10..12 rhw plane
//  A B C; input planes at 16 + 4*i: A B C K (K NaN: not constant)
// samplers at SAMP + 256*s: i32 0 hasTex 1 nLevels 2 mag 3 min 4 mip 5 bias bits 6 maxMip 7 addrU 8 addrV
//  9 format; levels at i32 16 + 4*l: ptr, width, height, texel plane (f64 r g b a per texel: tex.ts planeFor)
// ops at PROG + 96*n: i32 op dst mask sat sampler a0 a1 a2 a3 na b0 b1 b2 b3 nb c0 c1 c2 c3 nc (register indices)
// the LOD memo at PROGF: f64 key 0..3 derivatives 4..8 mag min mip bias maxMip 9 level-0 size and level count,
//  results 10 filter 11 n 12 l0 13 l1 14 w0 15 w1 (the LOD depends on nothing else: texlds of a quad reading the
//  same coordinates through equal states on textures of the same size share it)
const STATE: usize = 1024;
const SI: usize = STATE, SF: usize = STATE + 1024;
const SAMP: usize = 4096, PROG: usize = 8192, PROGF: usize = 14336, B255: usize = 22528, REGS: usize = 24576;
const SMP: usize = 34816, DER: usize = 34880, SCA: usize = 35072, SCW: usize = 35328, SMPQ: usize = 35840, LODC: usize = 36864;
const PS_REGS: i32 = 312, PS_OC: i32 = 168;

export function heapBase(): usize { return (__heap_base + 15) & ~(<usize>15); }
export function stateBase(): usize { return STATE; }
export function init(): void {
  for (let i = 0; i < 256; i++) store<f64>(B255 + (<usize>i << 3), fr(<f64>i * 0.003921568859368563));
  for (let i = 0; i < 10; i++) store<f64>(PROGF + (<usize>i << 3), NaN);
  for (let i = 0; i < 256; i++) store<f64>(LODC + (<usize>i << 4), NaN);
}

/** fdlibm's __ieee754_log (V8's Math.log; tex.ts flog), bit for bit */
function flog(x: f64): f64 {
  let hx = <i32>(reinterpret<u64>(x) >> 32), lx = <u32>reinterpret<u64>(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= 1.80143985094819840000e+16; hx = <i32>(reinterpret<u64>(x) >> 32);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  x = reinterpret<f64>((<u64>(hx | (i0 ^ 0x3ff00000)) << 32) | (reinterpret<u64>(x) & 0xffffffff));
  k += i0 >> 20;
  const f = x - 1.0;
  const ln2_hi: f64 = 6.93147180369123816490e-01, ln2_lo: f64 = 1.90821492927058770002e-10;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f == 0) { if (k == 0) return 0; const dk = <f64>k; return dk * ln2_hi + dk * ln2_lo; }
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k == 0) return f - R;
    const dk = <f64>k; return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f), dk = <f64>k, z = s * s;
  let i = hx - 0x6147a;
  const w = z * z, j = 0x6b851 - hx;
  const t1 = w * (3.999999999940941908e-01 + w * (2.222219843214978396e-01 + w * 1.531383769920937332e-01));
  const t2 = z * (6.666666666666735130e-01 + w * (2.857142874366239149e-01 + w * (1.818357216161805012e-01 + w * 1.479819860511658591e-01)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k == 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k == 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

const EPS: f64 = 8.881784197001252e-16;
const LOG2E: f64 = 1.4426950408889634;
function fr(x: f64): f64 { return <f64><f32>x; }
function bitsOf(x: f64): i32 { return reinterpret<i32>(<f32>x); }
function si(i: i32): i32 { return load<i32>(SI + (<usize>i << 2)); }
function sf(i: i32): f64 { return load<f64>(SF + (<usize>i << 3)); }
function rg(i: i32): f64 { return load<f64>(REGS + (<usize>i << 3)); }
function setRg(i: i32, v: f64): void { store<f64>(REGS + (<usize>i << 3), v); }
function lut(b: i32): f64 { return load<f64>(B255 + (<usize>b << 3)); }

// ---- the 64-bit x87 emulation (../../d3d8/ref/ext.ts) ----
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
function fadd(x: f64): void { A0 = eadd(A0, A1, x, 0); A1 = T2; }
function st32(): f64 { return toF32(A0, A1); }
/** ext.ts add32: f32(a + b) at 64 bits */
function add32(a: f64, b: f64): f64 {
  const r = a + b, e = (abs<f64>(a) + abs<f64>(b)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  return add32slow(a, b, r);
}
function add32slow(a: f64, b: f64, r: f64): f64 {
  if (r - a == b && r - b == a) return fr(r);
  ld(a); fadd(b); return st32();
}
/** ext.ts sum32x3: f32((a + b) + c) at 64 bits */
function sum32x3(a: f64, b: f64, c: f64): f64 {
  const r = (a + b) + c, e = (abs<f64>(a) + abs<f64>(b) + abs<f64>(c)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  return sum32x3slow(a, b, c, r);
}
function sum32x3slow(a: f64, b: f64, c: f64, r: f64): f64 {
  // both additions exact (as for most EVAL sums, whose terms are float products of small integers): the float of the
  // exact sum; else the 64-bit path
  const ab = a + b;
  if (ab - a == b && ab - b == a && r - ab == c && r - c == ab) return fr(r);
  ld(a); fadd(b); fadd(c); return st32();
}

// ---- SIMD helpers: two lanes of f64, each operation the scalar one per lane ----
function pair(a: f64, b: f64): v128 { return f64x2.replace_lane(f64x2.splat(a), 1, b); }
/** f32 rounding of both lanes (demote / promote: the scalar <f64><f32>) */
function frv(v: v128): v128 { return f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(v)); }
/** clamp01 per lane: v > 1 ? 1 : v >= 0 ? v : 0 (NaN -> 0) */
function clampv(v: v128): v128 {
  const one = f64x2.splat(1), zero = f64x2.splat(0);
  return v128.bitselect(one, v128.bitselect(v, zero, f64x2.ge(v, zero)), f64x2.gt(v, one));
}
/** add32 on both lanes (f32(q + c) at 64 bits, q exact): the fast path per lane, the scalar slow path for a lane
 *  whose bound straddles */
function add32v(q: v128, c: v128): v128 {
  const t = f64x2.add(q, c), e = f64x2.mul(f64x2.add(f64x2.abs(q), f64x2.abs(c)), f64x2.splat(EPS));
  const lo = frv(f64x2.sub(t, e)), hi = frv(f64x2.add(t, e));
  if (i64x2.all_true(f64x2.eq(lo, hi))) return lo;
  const l0 = f64x2.extract_lane(lo, 0), l1 = f64x2.extract_lane(lo, 1);
  const r0 = l0 == f64x2.extract_lane(hi, 0) ? l0 : add32slow(f64x2.extract_lane(q, 0), f64x2.extract_lane(c, 0), f64x2.extract_lane(t, 0));
  const r1 = l1 == f64x2.extract_lane(hi, 1) ? l1 : add32slow(f64x2.extract_lane(q, 1), f64x2.extract_lane(c, 1), f64x2.extract_lane(t, 1));
  return pair(r0, r1);
}

// ---- texture sampling (tex.ts) ----
function filterOf(v: i32): i32 { return v < 1 || (v > 3 && v - 6 > 2) ? 1 : v; }
function address(i: i32, n: i32, mode: i32): i32 {
  if (i >= 0 && i <= n - 1) return i;
  if (mode == 3) return i < 0 ? 0 : n - 1;
  if (mode == 1) { const r = i % n; return r < 0 ? r + n : r; }
  if (mode == 2) { const u = i < 0 ? ~i : i, r = u % n; return ((u / n) & 1) != 0 ? n - 1 - r : r; }
  unreachable(); return 0;
}
function smp(s: i32, i: i32): i32 { return load<i32>(SAMP + (<usize>s << 8) + (<usize>i << 2)); }
function lvPtr(s: i32, l: i32): usize { return <usize>smp(s, 16 + 4 * l); }
function lvW(s: i32, l: i32): i32 { return smp(s, 17 + 4 * l); }
function lvH(s: i32, l: i32): i32 { return smp(s, 18 + 4 * l); }
function lvPlane(s: i32, l: i32): usize { return <usize>smp(s, 19 + 4 * l); }

/** lodControls / lodCompute / lodFromValue (tex.ts) for texld n on sampler s; derivatives at DER */
function lod(n: i32, s: i32): void {
  const m: usize = PROGF;
  const d0 = load<f64>(DER), d1 = load<f64>(DER + 8), d2 = load<f64>(DER + 16), d3 = load<f64>(DER + 24);
  const k4 = <f64>smp(s, 2), k5 = <f64>smp(s, 3), k6 = <f64>smp(s, 4), k7 = <f64>smp(s, 5), k8 = <f64>smp(s, 6), k9 = <f64>(lvW(s, 0) * 65536 + lvH(s, 0)) * 64 + <f64>smp(s, 1);
  if (load<f64>(m) == d0 && load<f64>(m + 8) == d1 && load<f64>(m + 16) == d2 && load<f64>(m + 24) == d3 &&
      load<f64>(m + 32) == k4 && load<f64>(m + 40) == k5 && load<f64>(m + 48) == k6 && load<f64>(m + 56) == k7 &&
      load<f64>(m + 64) == k8 && load<f64>(m + 72) == k9) return;
  store<f64>(m, d0); store<f64>(m + 8, d1); store<f64>(m + 16, d2); store<f64>(m + 24, d3);
  store<f64>(m + 32, k4); store<f64>(m + 40, k5); store<f64>(m + 48, k6); store<f64>(m + 56, k7); store<f64>(m + 64, k8); store<f64>(m + 72, k9);
  const mag0 = smp(s, 2), min0 = smp(s, 3), mip0 = smp(s, 4);
  const needLod = mip0 == 1 || mip0 == 2 || mag0 != min0;
  const magF = filterOf(mag0), minF = filterOf(min0), mip = mip0 > 2 ? 0 : mip0;
  let filter = minF, nl = 1, l0 = 0, l1 = 0, w0: f64 = 1, w1: f64 = 1;
  if (needLod) {
    const W = <f64>lvW(s, 0), H = <f64>lvH(s, 0);
    const g0 = fr(W * d0), g1 = fr(W * d1), g2 = fr(H * d2), g3 = fr(H * d3);
    const lx = fr(Math.sqrt(add32(g2 * g2, g0 * g0))), ly = fr(Math.sqrt(add32(g3 * g3, g1 * g1)));
    const mm = ly < lx ? lx : ly;
    // the LOD of a texel-space length: a function of the float mm alone, kept in a direct-mapped cache
    const mb = bitsOf(mm), ce: usize = LODC + (<usize>((mb ^ (mb >> 9) ^ (mb >> 17)) & 255) << 4);
    let lv: f64;
    if (load<f64>(ce) == mm) lv = load<f64>(ce + 8);
    else {
      const ln = fr(flog(mm));
      const p = ln * LOG2E, e = abs<f64>(p) * 4.440892098500626e-16;
      lv = fr(p - e);
      if (lv != fr(p + e)) { A0 = emul(ln, 0, LOG2E, 0); A1 = T2; lv = st32(); }
      store<f64>(ce, mm); store<f64>(ce + 8, lv);
    }
    // lodFromValue
    const lodv = fr(<f64>reinterpret<f32>(smp(s, 5)) + lv);
    const iLOD = (bitsOf(fr(lodv + 393216)) << 16) >> 16;
    const mag = iLOD <= 0;
    filter = mag ? magF : minF;
    const base = smp(s, 6), maxL = smp(s, 1) - 1;
    if (mip != 0) {
      if (mag) l0 = max<i32>(0, base);
      else if (mip == 1) l0 = max<i32>((iLOD + 16) >> 5, base);
      else l0 = max<i32>(iLOD >> 5, base);
      if (maxL <= l0) l0 = maxL;
      if (!mag && mip != 1) {
        l1 = max<i32>((iLOD >> 5) + 1, base);
        if (maxL <= l1) l1 = maxL;
        if (l0 != l1 && (iLOD & 31) != 0) { const f = <f64>(iLOD & 31) * 0.03125; nl = 2; w1 = f; w0 = 1 - f; }
      }
    }
  }
  store<f64>(m + 80, <f64>filter); store<f64>(m + 88, <f64>nl); store<f64>(m + 96, <f64>l0); store<f64>(m + 104, <f64>l1);
  store<f64>(m + 112, w0); store<f64>(m + 120, w1);
}

/** one level's four samples for each pixel of the quad (tex.ts level's coordinates and weights): texel addresses at
 *  SCA and weights at SCW, slot ((slot * 4 + k) * 4 + p) for sample k of pixel p. A dead pixel takes pixel q's
 *  coordinates (its result is never used). */
function setupLevel(s: i32, l: i32, lw: f64, slot: i32, su: i32, sv: i32, live: i32, q: i32): void {
  const N = lvW(s, l), M = lvH(s, l), au = smp(s, 7), av = smp(s, 8), d = lvPlane(s, l);
  for (let p = 0; p < 4; p++) {
    const b = (((live >> p) & 1) != 0 ? p : q) * PS_REGS;
    const nu = (bitsOf(fr(<f64>N * rg(b + su) - 0.5) + 393216) << 10) >> 10;
    const nv = (bitsOf(fr(<f64>M * rg(b + sv) - 0.5) + 393216) << 10) >> 10;
    const i0 = nu >> 5, j0 = nv >> 5;
    const fu = <f64>(nu & 31) * 0.03125, fv = <f64>(nv & 31) * 0.03125, gu = 1 - fu, gv = 1 - fv;
    let x0 = i0, x1 = i0 + 1, y0 = j0, y1 = j0 + 1;
    if (x0 < 0 || x1 > N - 1) { x0 = address(x0, N, au); x1 = address(x1, N, au); }
    if (y0 < 0 || y1 > M - 1) { y0 = address(y0, M, av); y1 = address(y1, M, av); }
    const r0 = d + (<usize>(y0 * N) << 5), r1 = d + (<usize>(y1 * N) << 5);
    const i = slot * 16 + p;
    store<i32>(SCA + (<usize>i << 2), <i32>(r0 + (<usize>x0 << 5))); store<f64>(SCW + (<usize>i << 3), gv * gu * lw);
    store<i32>(SCA + (<usize>(i + 4) << 2), <i32>(r0 + (<usize>x1 << 5))); store<f64>(SCW + (<usize>(i + 4) << 3), gv * fu * lw);
    store<i32>(SCA + (<usize>(i + 8) << 2), <i32>(r1 + (<usize>x1 << 5))); store<f64>(SCW + (<usize>(i + 8) << 3), fv * fu * lw);
    store<i32>(SCA + (<usize>(i + 12) << 2), <i32>(r1 + (<usize>x0 << 5))); store<f64>(SCW + (<usize>(i + 12) << 3), gu * fv * lw);
  }
}

/** the samples of SCA / SCW accumulated per pixel in REF's order (level 0's four, then level 1's), each step
 *  f32(texel * w + acc) per channel; two channels to a SIMD vector (f64x2: (r, g), (b, a), the demote / promote pair
 *  is the f32 rounding), the four pixels interleaved (independent chains); results at SMPQ + 32 * p */
function accumulate(n: i32): void {
  let rg0 = f64x2.splat(0), ba0 = rg0, rg1 = rg0, ba1 = rg0, rg2 = rg0, ba2 = rg0, rg3 = rg0, ba3 = rg0;
  for (let i = 0; i < n; i += 4) {
    let a = <usize>load<i32>(SCA + (<usize>i << 2)), w = f64x2.splat(load<f64>(SCW + (<usize>i << 3)));
    rg0 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a), w), rg0)));
    ba0 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a, 16), w), ba0)));
    a = <usize>load<i32>(SCA + (<usize>(i + 1) << 2)); w = f64x2.splat(load<f64>(SCW + (<usize>(i + 1) << 3)));
    rg1 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a), w), rg1)));
    ba1 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a, 16), w), ba1)));
    a = <usize>load<i32>(SCA + (<usize>(i + 2) << 2)); w = f64x2.splat(load<f64>(SCW + (<usize>(i + 2) << 3)));
    rg2 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a), w), rg2)));
    ba2 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a, 16), w), ba2)));
    a = <usize>load<i32>(SCA + (<usize>(i + 3) << 2)); w = f64x2.splat(load<f64>(SCW + (<usize>(i + 3) << 3)));
    rg3 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a), w), rg3)));
    ba3 = f64x2.promote_low_f32x4(f32x4.demote_f64x2_zero(f64x2.add(f64x2.mul(v128.load(a, 16), w), ba3)));
  }
  v128.store(SMPQ, rg0); v128.store(SMPQ + 16, ba0); v128.store(SMPQ + 32, rg1); v128.store(SMPQ + 48, ba1);
  v128.store(SMPQ + 64, rg2); v128.store(SMPQ + 80, ba2); v128.store(SMPQ + 96, rg3); v128.store(SMPQ + 112, ba3);
}

// ---- the pixel shader (ps.ts run / texld) ----
/** the texel offsets / weights at SCA / SCW: set up for coordinate registers cSu / cSv (-1: none valid) */
let cSu = -1, cSv = -1, cLive = 0, cNl = 0, cL0 = 0, cL1 = 0, cAu = 0, cAv = 0, cW0d = 0, cH0d = 0, cW1d = 0, cH1d = 0, cP0 = 0, cP1 = 0;
let cW0: f64 = 0, cW1: f64 = 0;
function op(n: i32, i: i32): i32 { return load<i32>(PROG + <usize>n * 96 + (<usize>i << 2)); }

function texld(n: i32, live: i32): void {
  const s = op(n, 4), su = op(n, 5), sv = op(n, 6), dst = op(n, 1), mask = op(n, 2), sat = op(n, 3);
  const has = smp(s, 0) != 0;
  const m: usize = PROGF;
  if (has) {
    const u0 = rg(su), v0 = rg(sv);
    store<f64>(DER, fr(rg(PS_REGS + su) - u0)); store<f64>(DER + 8, fr(rg(2 * PS_REGS + su) - u0));
    store<f64>(DER + 16, fr(rg(PS_REGS + sv) - v0)); store<f64>(DER + 24, fr(rg(2 * PS_REGS + sv) - v0));
    lod(n, s);
    if (load<f64>(m + 80) != 2) unreachable();   // only LINEAR (the JS throws)
  }
  const nl = <i32>load<f64>(m + 88), l0 = <i32>load<f64>(m + 96), l1 = <i32>load<f64>(m + 104), w0 = load<f64>(m + 112), w1 = load<f64>(m + 120);
  if (has) {
    const q = ctz<i32>(live), au = smp(s, 7), av = smp(s, 8);
    const W0 = lvW(s, l0), H0 = lvH(s, l0), W1 = lvW(s, l1), H1 = lvH(s, l1), P0 = <i32>lvPlane(s, l0), P1 = <i32>lvPlane(s, l1);
    if (cSu == su && cSv == sv && (live & ~cLive) == 0 && cNl == nl && cL0 == l0 && cL1 == l1 && cW0 == w0 && cW1 == w1 && cAu == au && cAv == av &&
        cW0d == W0 && cH0d == H0 && cW1d == W1 && cH1d == H1) {
      // the previous texld of this quad set up the same coordinates on levels of the same sizes with the same
      // controls: its texel offsets and weights are this one's, on this texture's levels (only the bases differ);
      // the live pixels are a subset of its (an alpha kill only removes pixels)
      const d0 = P0 - cP0, d1 = P1 - cP1;
      for (let i = 0; i < 16; i++) store<i32>(SCA + (<usize>i << 2), load<i32>(SCA + (<usize>i << 2)) + d0);
      if (nl == 2) for (let i = 16; i < 32; i++) store<i32>(SCA + (<usize>i << 2), load<i32>(SCA + (<usize>i << 2)) + d1);
    } else {
      setupLevel(s, l0, w0, 0, su, sv, live, q);
      if (nl == 2) setupLevel(s, l1, w1, 1, su, sv, live, q);
      cSu = su; cSv = sv; cLive = live; cNl = nl; cL0 = l0; cL1 = l1; cW0 = w0; cW1 = w1; cAu = au; cAv = av;
      cW0d = W0; cH0d = H0; cW1d = W1; cH1d = H1;
    }
    cP0 = P0; cP1 = P1;
    // the destination is a register the next texld may read its coordinates from
    if (((dst ^ su) & ~3) == 0 || ((dst ^ sv) & ~3) == 0) cSu = -1;
    accumulate(nl * 16);
  }
  if (has && mask == 15 && sat == 0) {
    for (let p = 0; p < 4; p++) {
      if (((live >> p) & 1) == 0) continue;
      const r: usize = REGS + (<usize>(p * PS_REGS + dst) << 3), sm: usize = SMPQ + (<usize>p << 5);
      v128.store(r, v128.load(sm)); v128.store(r, v128.load(sm, 16), 16);
    }
    return;
  }
  for (let p = 0; p < 4; p++) {
    if (((live >> p) & 1) == 0) continue;
    const b = p * PS_REGS, o = b + dst, sm: usize = SMPQ + (<usize>p << 5);
    for (let j = 0; j < 4; j++) {
      if (((mask >> j) & 1) == 0) continue;
      let x: f64 = has ? load<f64>(sm + (<usize>j << 3)) : (j == 3 ? 1 : 0);
      if (sat != 0) x = min<f64>(max<f64>(x, 0), 1);
      setRg(o + j, x);
    }
  }
}

/** runPS: the pixels still live (an alpha-kill texld, SI 18 / 19, drops those whose alpha is 0: see rast.ts) */
function runPS(live: i32): i32 {
  const nOps = si(17), kill = si(18);
  cSu = -1;
  for (let n = 0; n < nOps; n++) {
    const o = op(n, 0);
    if (o == 66) {
      texld(n, live);
      if (n == kill) {
        const reg = si(19);
        for (let p = 0; p < 4; p++) if (((live >> p) & 1) != 0 && rg(p * PS_REGS + reg) == 0) live &= ~(1 << p);
        if (live == 0) return 0;
      }
      continue;
    }
    cSu = -1;
    const dst = op(n, 1), mask = op(n, 2), sat = op(n, 3);
    const a0 = op(n, 5), a1 = op(n, 6), a2 = op(n, 7), a3 = op(n, 8), na = op(n, 9) != 0;
    const b0 = op(n, 10), b1 = op(n, 11), b2 = op(n, 12), b3 = op(n, 13), nb = op(n, 14) != 0;
    const c0 = op(n, 15), c1 = op(n, 16), c2 = op(n, 17), c3 = op(n, 18), nc = op(n, 19) != 0;
    for (let p = 0; p < 4; p++) {
      if (((live >> p) & 1) == 0) continue;
      const b = p * PS_REGS, d = b + dst;
      // sources first (the destination may be a source)
      let ax = rg(b + a0), ay = rg(b + a1), az = rg(b + a2), aw = rg(b + a3);
      if (na) { ax = -ax; ay = -ay; az = -az; aw = -aw; }
      let vx = ax, vy = ay, vz = az, vw = aw;
      if (o != 1) {
        let bx = rg(b + b0), by = rg(b + b1), bz = rg(b + b2), bw = rg(b + b3);
        if (nb) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
        if (o == 4) {
          let cx = rg(b + c0), cy = rg(b + c1), cz = rg(b + c2), cw = rg(b + c3);
          if (nc) { cx = -cx; cy = -cy; cz = -cz; cw = -cw; }
          // add32 on lane pairs (x, y) and (z, w); an unwritten lane's value is computed and dropped
          if ((mask & 3) != 0) { const v = add32v(f64x2.mul(pair(ax, ay), pair(bx, by)), pair(cx, cy)); vx = f64x2.extract_lane(v, 0); vy = f64x2.extract_lane(v, 1); }
          if ((mask & 12) != 0) { const v = add32v(f64x2.mul(pair(az, aw), pair(bz, bw)), pair(cz, cw)); vz = f64x2.extract_lane(v, 0); vw = f64x2.extract_lane(v, 1); }
        } else if (o == 2) { vx = fr(ax + bx); vy = fr(ay + by); vz = fr(az + bz); vw = fr(aw + bw); }
        else { vx = fr(ax * bx); vy = fr(ay * by); vz = fr(az * bz); vw = fr(aw * bw); }
      }
      if (sat != 0) {
        vx = vx > 1 ? 1 : vx >= 0 ? vx : 0; vy = vy > 1 ? 1 : vy >= 0 ? vy : 0;
        vz = vz > 1 ? 1 : vz >= 0 ? vz : 0; vw = vw > 1 ? 1 : vw >= 0 ? vw : 0;
      }
      if ((mask & 1) != 0) setRg(d, vx);
      if ((mask & 2) != 0) setRg(d + 1, vy);
      if ((mask & 4) != 0) setRg(d + 2, vz);
      if ((mask & 8) != 0) setRg(d + 3, vw);
    }
  }
  return live;
}

// ---- the quad scan and the pixel operations (rast.ts scan / quad / pixel) ----
/** the draw's target and blend state, read once per triangle by scan() */
let gRt: usize = 0, gPitch = 0, gX8 = false, gRead = false, gBlend = false, gSb = 0, gDb = 0, gCwe = 0, gLive0 = 0, gNIn = 0;
let gWc: f64 = 0, gRA: f64 = 0, gRB: f64 = 0, gRC: f64 = 0;

function pixel(px: i32, py: i32, o: i32): void {
  if (gRead && gCwe == 15) { pixelBlend(px, py, o); return; }
  let v = rg(o), r = v > 1 ? 1 : v >= 0 ? v : 0;
  v = rg(o + 1); let g = v > 1 ? 1 : v >= 0 ? v : 0;
  v = rg(o + 2); let b = v > 1 ? 1 : v >= 0 ? v : 0;
  v = rg(o + 3); let a = v > 1 ? 1 : v >= 0 ? v : 0;
  const x8 = gX8;
  const ro: usize = gRt + <usize>(py * gPitch + px * 4);
  if (gRead) {
    const t = load<u32>(ro);
    const tr = lut((t >> 16) & 255), tg = lut((t >> 8) & 255), tb = lut(t & 255), ta: f64 = x8 ? 1 : lut(t >> 24);
    if (gBlend) {
      const sb = gSb, db = gDb;
      const sfc: f64 = sb == 5 ? a : sb == 6 ? fr(1 - a) : sb == 2 ? 1 : 0, dfc: f64 = db == 6 ? fr(1 - a) : db == 5 ? a : db == 2 ? 1 : 0;
      r = fr(fr(r * sfc) + fr(tr * dfc)); g = fr(fr(g * sfc) + fr(tg * dfc)); b = fr(fr(b * sfc) + fr(tb * dfc)); a = fr(fr(a * sfc) + fr(ta * dfc));
    }
    const cwe = gCwe;
    if ((cwe & 1) == 0) r = tr;
    if ((cwe & 2) == 0) g = tg;
    if ((cwe & 4) == 0) b = tb;
    if ((cwe & 8) == 0) a = ta;
    r = r > 1 ? 1 : r >= 0 ? r : 0; g = g > 1 ? 1 : g >= 0 ? g : 0; b = b > 1 ? 1 : b >= 0 ? b : 0; a = a > 1 ? 1 : a >= 0 ? a : 0;
  }
  store<u8>(ro, <u8><i32>(b * 255 + 0.5)); store<u8>(ro + 1, <u8><i32>(g * 255 + 0.5)); store<u8>(ro + 2, <u8><i32>(r * 255 + 0.5));
  store<u8>(ro + 3, x8 ? 0 : <u8><i32>(a * 255 + 0.5));
}

/** pixel() for a blended (or not) full colour write, on lane pairs (r, g), (b, a) */
function pixelBlend(px: i32, py: i32, o: i32): void {
  const ra: usize = REGS + (<usize>o << 3);
  let rgv = clampv(v128.load(ra)), bav = clampv(v128.load(ra, 16));
  const x8 = gX8;
  const ro: usize = gRt + <usize>(py * gPitch + px * 4);
  const t = load<u32>(ro);
  if (gBlend) {
    const a = f64x2.extract_lane(bav, 1), sb = gSb, db = gDb;
    const sfc: f64 = sb == 5 ? a : sb == 6 ? fr(1 - a) : sb == 2 ? 1 : 0, dfc: f64 = db == 6 ? fr(1 - a) : db == 5 ? a : db == 2 ? 1 : 0;
    const sv = f64x2.splat(sfc), dv = f64x2.splat(dfc);
    const trg = pair(lut((t >> 16) & 255), lut((t >> 8) & 255)), tba = pair(lut(t & 255), x8 ? 1 : lut(t >> 24));
    rgv = clampv(frv(f64x2.add(frv(f64x2.mul(rgv, sv)), frv(f64x2.mul(trg, dv)))));
    bav = clampv(frv(f64x2.add(frv(f64x2.mul(bav, sv)), frv(f64x2.mul(tba, dv)))));
  }
  const h = f64x2.splat(255), half = f64x2.splat(0.5);
  const crg = f64x2.add(f64x2.mul(rgv, h), half), cba = f64x2.add(f64x2.mul(bav, h), half);
  store<u8>(ro, <u8><i32>f64x2.extract_lane(cba, 0)); store<u8>(ro + 1, <u8><i32>f64x2.extract_lane(crg, 1));
  store<u8>(ro + 2, <u8><i32>f64x2.extract_lane(crg, 0)); store<u8>(ro + 3, x8 ? 0 : <u8><i32>f64x2.extract_lane(cba, 1));
}

function quad(x: i32, y: i32, cov: i32): void {
  const wc = gWc, live = cov | gLive0, nIn = gNIn;
  const rA = gRA, rB = gRB, rC = gRC;
  for (let k = 0; k < 4; k++) {
    const lk = (live >> k) & 1;
    if (lk == 0 && k == 3) continue;
    const px = <f64>(x + (k & 1)), py = <f64>(y + (k >> 1)), b = k * PS_REGS;
    let W = wc;
    if (W != W) { const r = sum32x3(rA * px, rB * py, rC); W = r == 0 ? 0 : fr(1 / r); }
    for (let i = 0; i < nIn; i++) {
      if (lk == 0 && si(33 + 2 * i) == 0) continue;
      const pl = 16 + 4 * i, K = sf(pl + 3), reg = si(32 + 2 * i);
      if (K == K) { setRg(b + reg, K); continue; }
      setRg(b + reg, fr(sum32x3(sf(pl) * px, sf(pl + 1) * py, sf(pl + 2)) * W));
    }
  }
  const left = runPS(live);
  for (let k = 0; k < 4; k++) {
    if (((cov >> k) & 1) == 0) continue;
    if (((left >> k) & 1) != 0) pixel(x + (k & 1), y + (k >> 1), k * PS_REGS + PS_OC);
    // a killed pixel blends to the target's own colour; an X8 target's byte 3 is written 0
    else if (gX8) store<u8>(gRt + <usize>((y + (k >> 1)) * gPitch + (x + (k & 1)) * 4) + 3, 0);
  }
}

/** rast.ts scan: the triangle written at SI / SF */
export function scan(): void {
  gRt = <usize>si(9); gPitch = si(10); gX8 = si(11) != 0; gRead = si(12) != 0; gBlend = si(13) != 0; gSb = si(14); gDb = si(15);
  gCwe = si(16); gLive0 = si(7); gNIn = si(8); gWc = sf(9); gRA = sf(10); gRB = sf(11); gRC = sf(12);
  const a0 = sf(0) * 16, a1 = sf(1) * 16, a2 = sf(2) * 16, b0 = sf(3) * 16, b1 = sf(4) * 16, b2 = sf(5) * 16;
  const xmin = si(0), xmax = si(1), ymax = si(3);
  for (let y = si(2); y <= ymax; y += 2) {
    const d = y + 1 <= ymax;
    let e0 = b0 * <f64>y + a0 * <f64>xmin + sf(6) - (si(4) != 0 ? 0 : 1);
    let e1 = b1 * <f64>y + a1 * <f64>xmin + sf(7) - (si(5) != 0 ? 0 : 1);
    let e2 = b2 * <f64>y + a2 * <f64>xmin + sf(8) - (si(6) != 0 ? 0 : 1);
    for (let x = xmin; x <= xmax; x += 2) {
      const r = x + 1 <= xmax;
      let cov = (e0 < 0 && e1 < 0 && e2 < 0) ? 1 : 0;
      if (r && e0 + a0 < 0 && e1 + a1 < 0 && e2 + a2 < 0) cov |= 2;
      if (d && e0 + b0 < 0 && e1 + b1 < 0 && e2 + b2 < 0) cov |= 4;
      if (r && d && e0 + a0 + b0 < 0 && e1 + a1 + b1 < 0 && e2 + a2 + b2 < 0) cov |= 8;
      if (cov != 0) quad(x, y, cov);
      e0 += 2 * a0; e1 += 2 * a1; e2 += 2 * a2;
    }
  }
}

// AssemblyScript source of src/wm3dspectrum/kernel-wasm.ts (npm run build:wasm regenerates it).
// 3D Spectrum Analyzer's per-frame work (src/wm3dspectrum): the vertex stage of index.ts's vertices() and the
// triangles and points of raster.ts, op for op in f64 and f32: WebAssembly's f64 + - * /, f32 demotion and
// comparisons round exactly as JavaScript's do, so every vertex, plane and pixel here is the JavaScript's
// (tests/wm3dspectrum.test.ts runs both paths over the same frames and compares every pixel). The x87 64-bit
// arithmetic the error-bound fallbacks need is d3d8/ref/ext.ts's double-double, ported as it is.
// Pointers are byte offsets in this module's memory, laid out by the glue (src/wm3dspectrum/kernel.ts) and
// handed over once with bind().

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize {
  return (__heap_base + 15) & ~(<usize>15);
}

const N: i32 = 1024;
const EPS: f64 = 8.881784197001252e-16;
const SPLIT: f64 = 134217729;

@inline function fr(x: f64): f64 { return <f64><f32>x; }

// ---- ext.ts: x87 extended precision as a double-double rounded to 64 significant bits ----
let T0: f64 = 0, T1: f64 = 0, T2: f64 = 0;
let A0: f64 = 0, A1: f64 = 0;

function twoProd(a: f64, b: f64): void {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  T0 = p; T1 = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
function renorm(): void { const s = T0 + T1; T1 = T1 - (s - T0); T0 = s; }
function round64(): f64 {
  const h = T0, l = T1;
  if (l == 0 || h == 0 || !isFinite(h)) { T2 = 0; return h + l; }
  const bits = reinterpret<u64>(h);
  let e = <i32>((bits >> 52) & 0x7ff) - 1023;
  if ((bits & 0xfffffffffffff) == 0 && (l < 0) != (h < 0)) e--;
  const q = reinterpret<f64>(<u64>(e - 63 + 1023) << 52);   // 2^(e - 63), the 64th bit's weight
  const x = l / q;
  const f = Math.floor(x), d = x - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 == 0 ? f : f + 1);
  const nl = r * q;
  const s = h + nl;
  T2 = nl - (s - h);
  return s;
}
function add(ah: f64, al: f64, bh: f64, bl: f64): f64 {
  let s = ah + bh, bb = s - ah, e = (ah - (s - bb)) + (bh - bb);
  const t = al + bl; bb = t - al; const f = (al - (t - bb)) + (bl - bb);
  e += t;
  let u = s + e; e = e - (u - s); s = u;
  e += f;
  u = s + e; e = e - (u - s);
  T0 = u; T1 = e;
  return round64();
}
function mul(ah: f64, al: f64, bh: f64, bl: f64): f64 {
  twoProd(ah, bh);
  T1 += ah * bl + al * bh;
  renorm();
  return round64();
}
function nextUp32(x: f64): f64 {
  if (x == 0) return 1.401298464324817e-45;
  return <f64>reinterpret<f32>(reinterpret<i32>(<f32>x) + (x > 0 ? 1 : -1));
}
function toF32(h: f64, l: f64): f64 {
  const r = fr(h);
  if (l == 0 || r == h) return r;
  const other = r < h ? nextUp32(r) : -nextUp32(-r);
  const mid = (r + other) / 2;
  if (h != mid) return r;
  return (l > 0) == (other > r) ? other : r;
}
@inline function ld(x: f64): void { A0 = x; A1 = 0; }
function ldMul(a: f64, b: f64): void { A0 = mul(a, 0, b, 0); A1 = T2; }
function fadd(x: f64): void { A0 = add(A0, A1, x, 0); A1 = T2; }
function fsub(x: f64): void { A0 = add(A0, A1, -x, 0); A1 = T2; }
function fmul(x: f64): void { A0 = mul(A0, A1, x, 0); A1 = T2; }
function st32(): f64 { return toF32(A0, A1); }

@inline function add32(a: f64, b: f64): f64 {
  const r = a + b, e = (Math.abs(a) + Math.abs(b)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  return add32slow(a, b, r);
}
function add32slow(a: f64, b: f64, r: f64): f64 {
  if (r - a == b && r - b == a) return fr(r);
  ld(a); fadd(b); return st32();
}
@inline function sum32(a: f64, b: f64, c: f64, d: f64): f64 {
  const r = ((a + b) + c) + d, e = (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  return sum32slow(a, b, c, d, r);
}
function sum32slow(a: f64, b: f64, c: f64, d: f64, r: f64): f64 {
  if (r == 0) { const ab = a + b, abc = ab + c; if (ab - a == b && ab - b == a && abc - ab == c && abc - c == ab && r - abc == d && r - d == abc) return r; }
  ld(a); fadd(b); fadd(c); fadd(d); return st32();
}
@inline function sum32x3(a: f64, b: f64, c: f64): f64 {
  const r = (a + b) + c, e = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  const lo = fr(r - e);
  if (lo == fr(r + e)) return lo;
  return sum32x3slow(a, b, c, r);
}
function sum32x3slow(a: f64, b: f64, c: f64, r: f64): f64 {
  if (r == 0) { const ab = a + b; if (ab - a == b && ab - b == a && r - ab == c && r - c == ab) return r; }
  ld(a); fadd(b); fadd(c); return st32();
}

// ---- raster.ts's chains ----
function sub32(a: f64, b: f64): f64 {
  const t = a - b, e = Math.abs(t) * EPS, r = fr(t - e);
  if (r == fr(t + e)) return r;
  ld(a); fsub(b); return st32();
}
function sumMul32(x: f64, y: f64, inv: f64): f64 {
  if (x == 0 && y == 0) return 0;
  const t = (x + y) * inv, e = (Math.abs(x) + Math.abs(y)) * Math.abs(inv) * EPS, r = fr(t - e);
  if (r == fr(t + e) && r != 0) return r;
  ld(x); fadd(y); fmul(inv); return st32();
}
function subSub32(p: f64, a: f64, b: f64): f64 {
  if (p == 0 && a == 0 && b == 0) return 0;
  const t = (p - a) - b, e = (Math.abs(p) + Math.abs(a) + Math.abs(b)) * EPS, r = fr(t - e);
  if (r == fr(t + e) && r != 0) return r;
  ld(p); fsub(a); fsub(b); return st32();
}
@inline function byte(c: f64): i32 { return <i32>((c > 1 ? 1 : c >= 0 ? c : 0) * 255 + 0.5); }
@inline function snap(v: f64): i32 { return (reinterpret<i32>(<f32>(v + 786432)) << 10) >> 10; }

// ---- the buffers ----
let FIELD: usize = 0, IU: usize = 0, JV: usize = 0, C: usize = 0;
let VX: usize = 0, VY: usize = 0, VZ: usize = 0, VW: usize = 0, VXS: usize = 0, VYS: usize = 0, VS: usize = 0;
let COLS: usize = 0, PX: usize = 0, ZB: usize = 0, TW: i32 = 0, TH: i32 = 0;

export function bind(field: usize, iu: usize, jv: usize, c: usize, vx: usize, vy: usize, vz: usize, vw: usize,
  vxs: usize, vys: usize, vs: usize, px: usize, zb: usize, tw: i32, th: i32): void {
  FIELD = field; IU = iu; JV = jv; C = c; VX = vx; VY = vy; VZ = vz; VW = vw; VXS = vxs; VYS = vys; VS = vs;
  PX = px; ZB = zb; TW = tw; TH = th;
}
export function palette(cols: usize): void { COLS = cols; }

@inline function ldf(p: usize, i: i32): f64 { return <f64>load<f32>(p + (<usize>i << 2)); }
@inline function ldi(p: usize, i: i32): i32 { return load<i32>(p + (<usize>i << 2)); }

/** index.ts vertices(): every vertex whose S changed since its outputs were computed (VS holds the S they are for) */
export function vertices(head: i32, W: f64, H: f64): void {
  const c00 = ldf(C, 0), c01 = ldf(C, 1), c02 = ldf(C, 2), c03 = ldf(C, 3), c10 = ldf(C, 4), c11 = ldf(C, 5), c12 = ldf(C, 6), c13 = ldf(C, 7);
  const c20 = ldf(C, 8), c21 = ldf(C, 9), c22 = ldf(C, 10), c23 = ldf(C, 11), c30 = ldf(C, 12), c31 = ldf(C, 13), c32 = ldf(C, 14), c33 = ldf(C, 15);
  for (let j = 0; j < N; j++) {
    const z = fr(256 - fr(0.5 * <f64>j));
    const r0 = FIELD + <usize>(((ldi(JV, 3 * j) + head) & 1023) * N), r1 = FIELD + <usize>(((ldi(JV, 3 * j + 1) + head) & 1023) * N);
    const fv = ldi(JV, 3 * j + 2), gv = 32 - fv;
    for (let i = 0; i < N; i++) {
      const n = j * N + i;
      const i0 = <usize>ldi(IU, 3 * i), i1 = <usize>ldi(IU, 3 * i + 1), fu = ldi(IU, 3 * i + 2), gu = 32 - fu;
      const S = gv * (gu * <i32>load<u8>(r0 + i0) + fu * <i32>load<u8>(r0 + i1)) + fv * (fu * <i32>load<u8>(r1 + i1) + gu * <i32>load<u8>(r1 + i0));
      const sp = VS + (<usize>n << 2);
      if (load<i32>(sp) == S) continue;
      store<i32>(sp, S);
      const x = fr(fr(<f64>i * 0.5) - 256);
      const y = fr(<f64>S * (100.0 / 131072.0));
      const cx = sum32(y * c01, x * c00, z * c02, c03), cy = sum32(y * c11, x * c10, z * c12, c13);
      const cz = sum32(y * c21, x * c20, z * c22, c23), cw = sum32(y * c31, x * c30, z * c32, c33);
      const xc = add32(cx, cw) * 0.5, yc = add32(cy, cw) * 0.5, rhw = fr(1 / cw);
      let p = rhw * xc * W, e = Math.abs(p) * EPS, sx = fr(p - e);
      if (sx != fr(p + e)) { ldMul(rhw, xc); fmul(W); fadd(0); sx = st32(); }
      const q = yc * rhw * -H;
      p = q + H; e = (Math.abs(q) + H) * EPS;
      let sy = fr(p - e);
      if (sy != fr(p + e)) { ldMul(yc, rhw); fmul(-H); fadd(H); sy = st32(); }
      const o = <usize>n << 2;
      store<f32>(VX + o, <f32>sx); store<f32>(VY + o, <f32>sy); store<f32>(VZ + o, <f32>(cz * rhw)); store<f32>(VW + o, <f32>rhw);
      store<i32>(VXS + o, snap(sx)); store<i32>(VYS + o, snap(sy));
    }
  }
}

// ---- raster.ts ----
let det: f64 = 0, invDet: f64 = 0;
let fX0: f64 = 0, fY0: f64 = 0, dX10: f64 = 0, dX02: f64 = 0, dY01: f64 = 0, dY20: f64 = 0;
let xmin: i32 = 0, xmax: i32 = 0, ymin: i32 = 0, ymax: i32 = 0;
let kx0: i32 = 0, kx1: i32 = 0, ky0: i32 = 0, ky1: i32 = 0;
let va: i32 = 0, vb: i32 = 0, vc: i32 = 0;
let rhA: f64 = 0, rhB: f64 = 0, rhC: f64 = 0, zA: f64 = 0, zB: f64 = 0, zC: f64 = 0;
let rA: f64 = 0, rB: f64 = 0, rC: f64 = 0, gA: f64 = 0, gB: f64 = 0, gC: f64 = 0, bA: f64 = 0, bB: f64 = 0, bC: f64 = 0;
let pA: f64 = 0, pB: f64 = 0, pC: f64 = 0;
let eA0: f64 = 0, eA1: f64 = 0, eA2: f64 = 0, eB0: f64 = 0, eB1: f64 = 0, eB2: f64 = 0;
let eC0: f64 = 0, eC1: f64 = 0, eC2: f64 = 0, eI0: f64 = 0, eI1: f64 = 0, eI2: f64 = 0;
let s0: i32 = 0, s1: i32 = 0;

/** RDEdge::Set: edge k's A, B, C and (1 - inclusive) */
@inline function edge(k: i32, flip: bool, xa: f64, ya: f64, xb: f64, yb: f64): void {
  let A = ya - yb, B = xb - xa;
  if (flip) { A = -A; B = -B; }
  const Cc = -(ya * B + xa * A), adj: f64 = (A != 0 ? A > 0 : B > 0) ? 0 : 1;
  if (k == 0) { eA0 = A; eB0 = B; eC0 = Cc; eI0 = adj; }
  else if (k == 1) { eA1 = A; eB1 = B; eC1 = Cc; eI1 = adj; }
  else { eA2 = A; eB2 = B; eC2 = Cc; eI2 = adj; }
}

/** RDAttribute::Setup into pA, pB, pC */
function plane(a0: f64, a1: f64, a2: f64, w0: f64, w1: f64, w2: f64): void {
  const p0 = a0 * w0, d2 = sub32(a2 * w2, p0), d1 = sub32(a1 * w1, p0), inv = invDet;
  const A = sumMul32(dY20 * d1, dY01 * d2, inv), B = sumMul32(dX02 * d1, dX10 * d2, inv);
  pA = A; pB = B; pC = subSub32(p0, A * fX0, B * fY0);
}
@inline function evalP(A: f64, B: f64, Cc: f64, px: f64, py: f64): f64 {
  const xa = A * px, yb = B * py, sm = (xa + yb) + Cc, e = (Math.abs(xa) + Math.abs(yb) + Math.abs(Cc)) * EPS;
  const lo = fr(sm - e);
  if (lo == fr(sm + e)) return lo;
  return evalSlow(xa, yb, Cc, sm);
}
function evalSlow(xa: f64, yb: f64, Cc: f64, sm: f64): f64 {
  const ab = xa + yb;
  return ab - xa == yb && ab - yb == xa && sm - ab == Cc && sm - Cc == ab ? fr(sm) : sum32x3(xa, yb, Cc);
}

/** the rhw and colour planes, at the triangle's first visible pixel */
function colours(): void {
  const w0 = ldf(VW, va), w1 = ldf(VW, vb), w2 = ldf(VW, vc);
  const d1 = fr(w1 - w0), d2 = fr(w2 - w0);
  rhA = sumMul32(dY20 * d1, dY01 * d2, invDet);
  rhB = sumMul32(dX10 * d2, dX02 * d1, invDet);
  rhC = subSub32(w0, rhA * fX0, rhB * fY0);
  const sa = 3 * ldi(VS, va), sb = 3 * ldi(VS, vb), sc = 3 * ldi(VS, vc);
  plane(ldf(COLS, sa), ldf(COLS, sb), ldf(COLS, sc), w0, w1, w2); rA = pA; rB = pB; rC = pC;
  plane(ldf(COLS, sa + 1), ldf(COLS, sb + 1), ldf(COLS, sc + 1), w0, w1, w2); gA = pA; gB = pB; gC = pC;
  plane(ldf(COLS, sa + 2), ldf(COLS, sb + 2), ldf(COLS, sc + 2), w0, w1, w2); bA = pA; bB = pB; bC = pC;
}

/** PerTriangleSetup; true = nothing to draw */
function setup(a: i32, b: i32, c: i32): bool {
  const X0 = ldi(VXS, a), Y0 = ldi(VYS, a), X1 = ldi(VXS, b), Y1 = ldi(VYS, b), X2 = ldi(VXS, c), Y2 = ldi(VYS, c);
  const ddX10 = <f64>(X1 - X0), ddY20 = <f64>(Y2 - Y0), ddX02 = <f64>(X0 - X2), ddY01 = <f64>(Y0 - Y1);
  det = ddY20 * ddX10 - ddY01 * ddX02;
  if (det <= 0) return true;
  const xa = ldf(VX, a), xb = ldf(VX, b), xc = ldf(VX, c), ya = ldf(VY, a), yb = ldf(VY, b), yc = ldf(VY, c);
  const x0 = Math.max(Math.trunc(Math.min(Math.min(xa, xb), xc) + 0.5), 0), x1 = Math.min(Math.trunc(Math.max(Math.max(xa, xb), xc) + 0.5), <f64>(TW - 1));
  const y0 = Math.max(Math.trunc(Math.min(Math.min(ya, yb), yc) + 0.5), 0), y1 = Math.min(Math.trunc(Math.max(Math.max(ya, yb), yc) + 0.5), <f64>(TH - 1));
  if (x0 > x1 || y0 > y1) return true;
  xmin = <i32>x0; xmax = <i32>x1; ymin = <i32>y0; ymax = <i32>y1;
  fX0 = <f64>X0 * 0.0625; fY0 = <f64>Y0 * 0.0625;
  dX10 = ddX10 * 0.0625; dX02 = ddX02 * 0.0625; dY01 = ddY01 * 0.0625; dY20 = ddY20 * 0.0625;
  invDet = fr(1 / (fr(det) * 0.00390625));
  return false;
}

/** DrawTriangle's order (smallest x, then y, first) and the setup; true = nothing to draw */
function order(): bool {
  const i0 = va, i1 = vb, i2 = vc;
  const fx0 = ldf(VX, i0), fx1 = ldf(VX, i1), fx2 = ldf(VX, i2), fy0 = ldf(VY, i0), fy1 = ldf(VY, i1);
  let best = 0, bx = fx0, by = fy0;
  if (fx1 < bx || (fx1 == bx && fy1 < by)) { best = 1; bx = fx1; by = fy1; }
  if (fx2 < bx || (fx2 == bx && ldf(VY, i2) < by)) best = 2;
  va = best == 0 ? i0 : best == 1 ? i1 : i2; vb = best == 0 ? i1 : best == 1 ? i2 : i0; vc = best == 0 ? i2 : best == 1 ? i0 : i1;
  return setup(va, vb, vc);
}

/** a column's covered rows lo..hi (s0, s1) under edge (a, b, C, adj) at x, from lo..hi */
@inline function clip(A: f64, B: f64, Cc: f64, adj: f64, x: f64): void {
  const b = 16 * B, e = 16 * A * x + b * <f64>s0 + Cc - adj;
  if (b == 0) { if (e >= 0) s1 = s0 - 1; return; }
  if (b > 0) {
    let d = Math.ceil(-e / b) - 1;
    while (e + b * (d + 1) < 0) d++;
    while (d >= 0 && e + b * d >= 0) d--;
    if (<f64>s0 + d < <f64>s1) s1 = s0 + <i32>d;
  } else {
    let d = e < 0 ? 0 : Math.floor(e / -b) + 1;
    while (d > 0 && e + b * (d - 1) < 0) d--;
    while (e + b * d >= 0) d++;
    s0 += <i32>Math.min(d, <f64>(s1 - s0 + 1));
  }
}

/** DrawTriangle (culling CCW) and the column scan */
function triangle(i0: i32, i1: i32, i2: i32): void {
  const xa = ldi(VXS, i0), xb = ldi(VXS, i1), xc = ldi(VXS, i2), ya = ldi(VYS, i0), yb = ldi(VYS, i1), yc = ldi(VYS, i2);
  if (<i64>(yc - ya) * <i64>(xb - xa) - <i64>(ya - yb) * <i64>(xa - xc) <= 0) return;
  let lo = xa < xb ? xa : xb, hi = xa < xb ? xb : xa;
  if (xc < lo) lo = xc; else if (xc > hi) hi = xc;
  let k0 = (lo + 15) >> 4, k1 = hi >> 4;
  if (k0 < 0) k0 = 0;
  if (k1 > TW - 1) k1 = TW - 1;
  if (k0 > k1) return;
  kx0 = k0; kx1 = k1;
  lo = ya < yb ? ya : yb; hi = ya < yb ? yb : ya;
  if (yc < lo) lo = yc; else if (yc > hi) hi = yc;
  k0 = (lo + 15) >> 4; k1 = hi >> 4;
  if (k0 < 0) k0 = 0;
  if (k1 > TH - 1) k1 = TH - 1;
  if (k0 > k1) return;
  ky0 = k0; ky1 = k1;
  edge(0, true, <f64>xa, <f64>ya, <f64>xb, <f64>yb);
  edge(1, true, <f64>xb, <f64>yb, <f64>xc, <f64>yc);
  edge(2, true, <f64>xc, <f64>yc, <f64>xa, <f64>ya);
  va = i0; vb = i1; vc = i2;
  let ready = false, zs = false, cs = false;
  const y0 = ky0, y1 = ky1, x0 = kx0, x1 = kx1;
  for (let x = x0; x <= x1; x++) {
    const fx = <f64>x;
    s0 = y0; s1 = y1;
    clip(eA0, eB0, eC0, eI0, fx);
    if (s0 <= s1) clip(eA1, eB1, eC1, eI1, fx);
    if (s0 <= s1) clip(eA2, eB2, eC2, eI2, fx);
    for (let y = s0; y <= s1; y++) {
      if (!ready) { if (order()) return; ready = true; }
      if (x < xmin || x > xmax || y < ymin || y > ymax) continue;
      if (!zs) { zs = true; plane(ldf(VZ, va), ldf(VZ, vb), ldf(VZ, vc), 1, 1, 1); zA = pA; zB = pB; zC = pC; }
      const fy = <f64>y;
      const z = sum32x3(zB * fy, zA * fx, zC);
      const u = <u32>Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5);
      const o = ZB + (<usize>(y * TW + x) << 2);
      if (u > load<u32>(o)) continue;
      store<u32>(o, u);
      if (!cs) { cs = true; colours(); }
      const s = sum32x3(rhA * fx, rhB * fy, rhC), Wv = s == 0 ? 0 : fr(1 / s);
      const r = byte(fr(evalP(rA, rB, rC, fx, fy) * Wv)), g = byte(fr(evalP(gA, gB, gC, fx, fy) * Wv)), bl = byte(fr(evalP(bA, bB, bC, fx, fy) * Wv));
      store<u32>(PX + (<usize>(y * TW + x) << 2), <u32>((r << 16) | (g << 8) | bl));
    }
  }
}

export function triangles(): void {
  for (let b = 0; b < 1023 * 1023; b++) { triangle(b, b + 1, b + 1023); triangle(b + 1023, b + 1, b + 1024); }
}

/** RefDev::DrawPoint for vertex i (size 1) */
function point(i: i32): void {
  const px = ldf(VX, i), py = ldf(VY, i);
  const ax = fr(px - 0.5), ay = fr(py - 0.5), bx = fr(px + 0.5), cy = fr(py + 0.5);
  const X0 = snap(ax), Y0 = snap(ay), X1 = snap(bx), Y2 = snap(cy);
  if (X1 == X0 || Y2 == Y0) return;
  // the four edges leave the pixel centres with X0 <= 16 x < X1 and Y0 <= 16 y < Y2 (raster.ts point())
  const fx0 = Math.max(Math.trunc(ax + 0.5), 0), fx1 = Math.min(Math.trunc(bx + 0.5), <f64>(TW - 1));
  const fy0 = Math.max(Math.trunc(ay + 0.5), 0), fy1 = Math.min(Math.trunc(cy + 0.5), <f64>(TH - 1));
  if (fx0 > fx1 || fy0 > fy1) return;
  let x0 = <i32>fx0, x1 = <i32>fx1, y0 = <i32>fy0, y1 = <i32>fy1;
  if (x0 < (X0 + 15) >> 4) x0 = (X0 + 15) >> 4;
  if (x1 > (X1 - 1) >> 4) x1 = (X1 - 1) >> 4;
  if (y0 < (Y0 + 15) >> 4) y0 = (Y0 + 15) >> 4;
  if (y1 > (Y2 - 1) >> 4) y1 = (Y2 - 1) >> 4;
  if (x0 > x1 || y0 > y1) return;
  const z = ldf(VZ, i), u = <u32>Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5);
  let col: u32 = 0, cs = false;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const o = <usize>(yy * TW + xx) << 2;
      if (u > load<u32>(ZB + o)) continue;
      store<u32>(ZB + o, u);
      if (!cs) {   // the colour at the first pixel that passes (most points are hidden)
        cs = true;
        const w = ldf(VW, i), W = fr(1 / w), k = 3 * ldi(VS, i);
        col = <u32>((byte(fr(fr(ldf(COLS, k) * w) * W)) << 16) | (byte(fr(fr(ldf(COLS, k + 1) * w) * W)) << 8) | byte(fr(fr(ldf(COLS, k + 2) * w) * W)));
      }
      store<u32>(PX + o, col);
    }
  }
}

export function points(): void {
  for (let i = 0; i < N * N; i++) point(i);
}

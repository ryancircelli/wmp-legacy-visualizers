// Ambience's displacement maps: the nine per-preset table builders. Each fills, for every destination
// pixel (x, y) of the w x h surface, the offset of the source pixel it is copied from (row-major, the
// surface's own stride), which the engine's warp then gathers every frame. Built once per preset init and
// size; nothing in them is random.
//
// WMP 10 wmp.dll VAs first, WMP 9 in brackets (the code is the same in both, x87 included). The DLL's
// arithmetic is x87 at 53-bit precision control: every +,-,*,/ and sqrt rounds to double exactly as JS
// does; floats are rounded where the DLL stores them (fround). fsin/fcos return 64-bit-mantissa values
// that are multiplied before any rounding to double: trigTrunc() reproduces that where it matters (a
// product within a few ulps of an integer, e.g. Bubble's exact Pythagorean points at 512x384). Every map
// at all three sizes was compared entry by entry with the tables dumped from the running DLL.
//
// Coordinates are the DIB's memory order, which is bottom-up: y = 0 is the bottom row on screen.
import { A } from '../ns';
import '../rand';

const F = Math.fround;
const sin = Math.sin, cos = Math.cos, atan2 = Math.atan2, sqrt = Math.sqrt;

// ---- x87 trig products: ftol(fsin(a) * r) / ftol(fcos(a) * r), the 64-bit sin/cos times a double
// rounded once. Off a near-integer the double product truncates the same; on one, the sin/cos is
// recomputed in double-double (|error| ~1e-31) so the product is rounded from (nearly) the exact value.
type DD = [number, number];
function norm(h: number, l: number): DD { const s = h + l; return [s, l - (s - h)]; }
function add(x: DD, y: DD): DD {
  const s = x[0] + y[0], b = s - x[0], e = (x[0] - (s - b)) + (y[0] - b);
  return norm(s, e + x[1] + y[1]);
}
function mul(x: DD, y: DD): DD {
  const p = x[0] * y[0];
  return norm(p, A.fma(x[0], y[0], -p) + x[0] * y[1] + x[1] * y[0]);
}
function mulD(x: DD, d: number): DD { const p = x[0] * d; return norm(p, A.fma(x[0], d, -p) + x[1] * d); }
function divD(x: DD, d: number): DD {
  const q = x[0] / d, r = add(x, [-q * d, -A.fma(q, d, -q * d)]);
  return norm(q, r[0] / d);
}
const PIO2: DD = [1.5707963267948966, 6.123233995736766e-17], PIO2_3 = -1.4973849048591698e-33;
function ddSinCos(a: number, wantSin: boolean): DD {
  // a = x + k*pi/2, |x| <= pi/4; cos(a) by k & 3: cos x, -sin x, -cos x, sin x; sin(a) = cos(a - pi/2)
  const k = Math.round(a / PIO2[0]), q = (k + (wantSin ? 3 : 0)) & 3;
  const x = add(add([a, 0], mulD(PIO2, -k)), [-k * PIO2_3, 0]), x2 = mul(x, x);
  const odd = (q & 1) === 1;                                      // the sine series
  let t: DD = odd ? x : [1, 0], sum = t;
  for (let j = 1; j < 16 && Math.abs(t[0]) > 1e-34; j++) {
    t = divD(mul(t, x2), odd ? -(2 * j) * (2 * j + 1) : -(2 * j - 1) * (2 * j));
    sum = add(sum, t);
  }
  return q === 1 || q === 2 ? [-sum[0], -sum[1]] : sum;
}
/** ftol(fsin(a) * r) (isSin) or ftol(fcos(a) * r), as the x87 computes it. */
export function trigTrunc(isSin: boolean, a: number, r: number): number {
  const v = (isSin ? sin(a) : cos(a)) * r, n = Math.round(v);
  if (Math.abs(v - n) > 8 * Number.EPSILON * Math.abs(v)) return v | 0;
  return mulD(ddSinCos(a, isSin), r)[0] | 0;
}

/** A destination pixel's own offset when its source falls outside the surface. */
function finish(m: Int32Array, w: number, h: number, stride: number, x: number, y: number,
  cx: number, cy: number, a: number, r: number): void {
  const sy = h - trigTrunc(true, a, r) - cy, sx = w - trigTrunc(false, a, r) - cx;
  m[w * y + x] = sx < 0 || sx >= w || sy < 0 || sy >= h ? x + y * stride : sy * stride + sx;
}

/** Swirl, 0x0786818b [0x0796ce0c]: rotate by rot, pull in by sub; pixels within sub of the centre stay. */
export function swirlMap(w: number, h: number, stride: number, rot: number, sub: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const a = atan2(dy, dx) + rot, r = sqrt(dy * dy + dx * dx) - sub;
      if (r > 0) finish(m, w, h, stride, x, y, cx, cy, a, r); else m[w * y + x] = x + y * stride;
    }
  }
  return m;
}

/** Zoom, 0x078682df [0x0796cf5e]: rotate by rot and move every radius by amt * r / R (amt >= 0: in) or
 *  amt * (R - r) / R (amt < 0: out), R the half diagonal. Warp, Anon, Windmill, X Marks, Down the Drain. */
export function zoomMap(w: number, h: number, stride: number, rot: number, amt: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  const R = sqrt(w * w + h * h) * 0.5;
  for (let x = 0; x < w; x++) {
    const inv = 1 / R;
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const r = sqrt(dy * dy + dx * dx), a = atan2(dy, dx) + rot;
      const k = amt < 0 ? (R - r) * inv : inv * r;
      const r2 = r - k * amt;
      if (r2 > 0) finish(m, w, h, stride, x, y, cx, cy, a, r2); else m[w * y + x] = x + y * stride;
    }
  }
  return m;
}

/** Falloff, 0x07868486 [0x0796d103]: the zoom above without the r > 0 guard, plus a rotation that grows
 *  with |dx| / cx and turns opposite ways in opposite quadrants. */
export function falloffMap(w: number, h: number, stride: number, rot: number, amt: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  const R = sqrt(w * w + h * h) * 0.5;
  for (let x = 0; x < w; x++) {
    const inv = 1 / R;
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const a0 = atan2(dy, dx), r = sqrt(dy * dy + dx * dx);
      let q = dx / cx;
      if (q < 0) q = -q;
      let v = q * rot;
      if ((dx >= 0) !== (dy >= 0)) v = -v;
      const a = v + a0;
      const k = amt < 0 ? (R - r) * inv : inv * r;
      finish(m, w, h, stride, x, y, cx, cy, a, r - k * amt);
    }
  }
  return m;
}

/** Water, 0x07868632 [0x0796d2ad]: rings of width P. Within each ring the radius is pulled in by
 *  ((P - (r mod P)) / P)^3 * P, never below the ring's inner edge; the mod is up to 201 subtractions. */
export function rippleMap(w: number, h: number, stride: number, rot: number, P: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  for (let x = 0; x < w; x++) {
    const inv = 1 / P;
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const r = sqrt(dy * dy + dx * dx), a = atan2(dy, dx) + rot;
      let rv = r, acc = 0, n = 200;
      while (rv > P) { n--; rv -= P; acc += P; if (n < 0) break; }
      const t = (P - rv) * inv;
      const r2 = r - t * t * t * P;
      finish(m, w, h, stride, x, y, cx, cy, a, r2 > acc ? r2 : acc);
    }
  }
  return m;
}

/** Bubble, 0x078687b3 [0x0796d42c]: inside R0 = cy - 10 the radius shrinks by max(1, (r/R0)^3 R0),
 *  floored at 0; outside it nothing moves. (For cy <= 10 the DLL leaves the table unwritten.) */
export function bubbleMap(w: number, h: number, stride: number, rot: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  if (cy <= 10) return m;
  const R0 = cy - 10;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const r = sqrt(dy * dy + dx * dx), a = atan2(dy, dx) + rot;
      if (r <= R0) {
        const q = r / R0;
        let k = q * q * q * R0;
        if (k < 1.0) k = 1;
        let r2 = r - k;
        if (!(r2 > 0)) r2 = 0;
        finish(m, w, h, stride, x, y, cx, cy, a, r2);
      } else m[w * y + x] = x + y * stride;
    }
  }
  return m;
}

/** Dizzy, 0x07868956 [0x0796d5cd]: k = max(1 - |dx|/cx, 0.05f) drives both a twist rot*k and a
 *  push-out r * (1 - k) * k^5. */
export function dizzyMap(w: number, h: number, stride: number, rot: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const a0 = atan2(dy, dx), r = sqrt(dy * dy + dx * dx);
      let k = 1.0 - (dx < 0 ? -dx : dx) / cx;
      if (k < 0.05) k = F(0.05);
      const a = rot * k + a0;
      const r2 = r + (1 - k) * r * k * k * k * k * k;
      finish(m, w, h, stride, x, y, cx, cy, a, r2);
    }
  }
  return m;
}

/** Niagara, 0x07868acd [0x0796d742]: no polar part. Each column samples t1 = q^3 A rows up (a fall that
 *  is fastest mid-screen) and t2 = (1 - q) B columns outward, q = (cx - |cx - x|) / cx; clamped. */
export function niagaraMap(w: number, h: number, stride: number, A: number, B: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const ax = cx - x < 0 ? x - cx : cx - x;
      const q = (cx - ax) / cx;
      const t1 = (q * q * q * A) | 0;
      let t2 = ((1 - q) * B) | 0;
      if (x > cx) t2 = -t2;
      let sx = x - t2, sy = y + t1;
      if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
      m[w * y + x] = sy * stride + sx;
    }
  }
  return m;
}

/** Blender, 0x07868bdc [0x0796d84f]: bands N pixels wide; in each, the twist rises and falls with
 *  (m / (N/2))^2 * rot and alternates sign from band to band. */
export function blenderMap(w: number, h: number, stride: number, rot: number, sub: number, N: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  const half = N >> 1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const r = sqrt(dy * dy + dx * dx) - sub;
      let a = atan2(dy, dx) + rot;
      const ri = r | 0, qd = (ri / N) | 0;
      let b = ri - qd * N;
      if (b > half) b = N - b;
      const t = b / half, v = t * t * rot;
      a = qd % 2 === 0 ? a + v : a - v;
      if (r > 0) finish(m, w, h, stride, x, y, cx, cy, a, r); else m[w * y + x] = x + y * stride;
    }
  }
  return m;
}

/** Thingus, 0x07868d7c [0x0796d9ed]: k = (w/4 - r) / (3w/4); radius r + amt*k, twist rot*k (Battery's
 *  dead CThingusShift is this map). */
export function thingusMap(w: number, h: number, stride: number, rot: number, amt: number): Int32Array {
  const m = new Int32Array(w * h), cx = w >> 1, cy = h >> 1;
  const A = w >> 2, B = (w >> 1) + (w >> 2);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const dx = cx - x, dy = cy - y;
      const r = sqrt(dy * dy + dx * dx);
      const k = (A - r) / B;
      const r2 = amt * k + r;
      const a = atan2(dy, dx) + rot * k;
      if (r2 > 0) finish(m, w, h, stride, x, y, cx, cy, a, r2); else m[w * y + x] = x + y * stride;
    }
  }
  return m;
}

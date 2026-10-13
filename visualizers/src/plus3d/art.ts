// Our own artwork for the public build of Plus! 3-D Visualizations. The DLL's models, textures, camera paths and
// ANL/BEH files (./assets.ts) ship nowhere here; everything below is modelled, painted and choreographed by code,
// deterministically (a seeded lattice and generators, no Math.random), in the forms and roles the engine expects:
//   - "Oddworld: Munch's Oddysee" (ANL_MUNCH, a matrix series): Pip, a round teal pond critter of our own (a big
//     pear-shaped body that is head and torso at once, googly eyes, noodle arms with mitten hands, stubby legs on
//     big sneaker feet, a springy antenna with a glowing bulb), one skinned mesh on fourteen bones plus rigid eyes,
//     hands, feet and bulb, dancing eight looping routines (bop, sway, spin, wave, march, twist, jump, shimmy) on a
//     candy-tiled dance stage in a flowering meadow at sunset under a rainbow;
//   - "Maxx's Kingdom" (ANL_BLOBBY, vertex series): a horned gumdrop blob with a face, marbled in violet, magenta,
//     teal and gold, morphing through five loops (wobble, spikes, twist, star, bounce) that all start and end on
//     its rest shape, in a sky kingdom of floating islands with castles above a sea of clouds;
//   - "Undersea Wonders" (ANL_JELLY, one vertex series): a lantern jelly (a scalloped bell over an inner bell,
//     four glowing gonads, four frilled oral arms, twelve beaded tentacles) pulsing as it drifts, in a deep ocean
//     with light shafts from a rippling surface, kelp and rocks on a rippled sand floor;
//   - the BEH files: a light circle and camera paths that meet end to start wherever the camera graph
//     (./camgraph.ts) lets one follow another.
// Sizes follow the presets' fixed transforms: Pip's model units are 0.055 of the world's (Z up, front -Y), the
// blob's 0.0045, the jelly's about 0.001; the sky box is the cube of half-size 3 (raised by 2.6 in the first two).
import type { XMaterial } from '../yule/d3dx';
import type { Image, Plus3DAssets, XAnimation, XFile, XFrame, XMesh, XSkinWeights } from './assets';

// ------------------------------------------------------------------------------------------------ small tools
const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const TAU = Math.PI * 2;
const hyp = (a: number, b: number): number => Math.sqrt(a * a + b * b);
const hyp3 = (a: number, b: number, c: number): number => Math.sqrt(a * a + b * b + c * c);
/** an angle's difference wrapped into [-pi, pi) */
const wrap = (a: number): number => a - TAU * Math.floor(a / TAU + 0.5);

/** mulberry32: a small seeded generator, [0, 1) */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** an integer hash of (a, b, seed) to [0, 1) */
function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type RGB = readonly [number, number, number];
type Px = Float64Array;
const put = (o: Px, c: RGB): void => { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; };
/** o moves towards (r, g, b) by t */
const towardRGB = (o: Px, r: number, g: number, b: number, t: number): void => { o[0] += (r - o[0]) * t; o[1] += (g - o[1]) * t; o[2] += (b - o[2]) * t; };
const toward = (o: Px, c: RGB, t: number): void => { o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; };
const times = (o: Px, k: number): void => { o[0] *= k; o[1] *= k; o[2] *= k; };
const glow = (o: Px, c: RGB, k: number): void => { o[0] += c[0] * k; o[1] += c[1] * k; o[2] += c[2] * k; };
/** a colour from hue (0..1 around), saturation, value (0..255) */
function hsv(h: number, s: number, v: number): RGB {
  const f = (n: number): number => { const k = (n + h * 6) % 6; return v * (1 - s * clamp(Math.min(k, 4 - k))); };
  return [f(5), f(3), f(1)];
}
/** a colour ramp: stops [t, colour] in ascending t */
function ramp(o: Px, stops: readonly (readonly [number, RGB])[], t: number): void {
  if (t <= stops[0][0]) { put(o, stops[0][1]); return; }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) { put(o, stops[i - 1][1]); toward(o, stops[i][1], smooth(stops[i - 1][0], stops[i][0], t)); return; }
  }
  put(o, stops[stops.length - 1][1]);
}

/** a w x h image painted pixel by pixel: fn(x, y, o) leaves r, g, b, a (0..255) in o; alpha: a 32-bit TGA */
function paint(w: number, h: number, fn: (x: number, y: number, o: Px) => void, alpha = false): Image {
  const bgra = new Uint8Array(w * h * 4), o = new Float64Array(4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    o[3] = 255;
    fn(x, y, o);
    bgra[i] = clamp(o[2], 0, 255); bgra[i + 1] = clamp(o[1], 0, 255); bgra[i + 2] = clamp(o[0], 0, 255); bgra[i + 3] = alpha ? clamp(o[3], 0, 255) : 255;
  }
  return alpha ? { w, h, bgra, alpha } : { w, h, bgra };
}

// 3-D value noise over a 32^3 lattice of seeded values (wrapping at 32 lattice units, beyond any scale used here)
const LAT = ((): Float32Array => { const r = prng(0x5eed), t = new Float32Array(32768); for (let i = 0; i < t.length; i++) t[i] = r() * 2 - 1; return t; })();
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const x0 = ix & 31, x1 = (ix + 1) & 31, y0 = (iy & 31) << 5, y1 = ((iy + 1) & 31) << 5, z0 = (iz & 31) << 10, z1 = ((iz + 1) & 31) << 10;
  const a = LAT[z0 | y0 | x0] + (LAT[z0 | y0 | x1] - LAT[z0 | y0 | x0]) * fx, b = LAT[z0 | y1 | x0] + (LAT[z0 | y1 | x1] - LAT[z0 | y1 | x0]) * fx;
  const c = LAT[z1 | y0 | x0] + (LAT[z1 | y0 | x1] - LAT[z1 | y0 | x0]) * fx, d = LAT[z1 | y1 | x0] + (LAT[z1 | y1 | x1] - LAT[z1 | y1 | x0]) * fx;
  const e = a + (b - a) * fy, g = c + (d - c) * fy;
  return e + (g - e) * fz;
}
/** fractal sums of vnoise, about [-1, 1]; seed shifts the lattice */
function fbm(x: number, y: number, z: number, oct: number, seed: number): number {
  let s = 0, amp = 1, norm = 0;
  x += seed * 3.71; y += seed * 1.93; z += seed * 5.29;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x, y, z); norm += amp; amp *= 0.5; x = x * 2 + 0.37; y = y * 2 + 0.61; z = z * 2 + 0.19; }
  return clamp((s / norm) * 1.6, -1, 1);
}
/** a noise around a circle (periodic in the angle az) */
const around = (az: number, f: number, oct: number, seed: number): number => fbm(Math.cos(az) * f, Math.sin(az) * f, 0.5, oct, seed);
/** jittered cell points over a 64 x 64 wrapping grid */
const JIT = ((): Float32Array => { const r = prng(0xce11), t = new Float32Array(8192); for (let i = 0; i < t.length; i++) t[i] = 0.1 + 0.8 * r(); return t; })();
/** 2-D cellular noise, cells of size 1: f2 - f1, the distance between the two nearest jittered points */
function cellEdge(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, c = (((cy & 63) << 6) | (cx & 63)) << 1, px = cx + JIT[c], py = cy + JIT[c + 1];
    const d = hyp(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}

// ---------------------------------------------------------------------------------------------- vectors
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => scale(a, 1 / (hyp3(a[0], a[1], a[2]) || 1));
/** the sphere direction at (al around from the front -Y, ph down from the top +Z) */
const dirOf = (al: number, ph: number): V3 => [Math.sin(ph) * Math.sin(al), -Math.sin(ph) * Math.cos(al), Math.cos(ph)];
/** two unit vectors across an axis */
function across(a: V3): [V3, V3] {
  const e1 = norm(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [e1, cross(a, e1)];
}

// ------------------------------------------------------------------------------------------------ sky boxes
// A sky box face is painted from the direction each texel looks along from a centre point (0, cy, 0) inside the
// unit cube, so the six faces meet seamlessly; below the horizon a ray from that centre meets the cube's floor
// plane (y = -1), which gives the ground its own coordinates (world units: 3 per cube unit). Faces and their uv as
// ./bgnd.ts draws them: TOP, FRT (z-), BOT, LFT (x-), RGT (x+), BAK (z+). Smooth noise fields are worked out on a
// coarse grid over each face and interpolated (the lattice noise is the costly part); what depends only on the
// direction's azimuth (hill lines, light shafts) comes from tables.
const SUFFIX = ['_TOP', '_FRT', '_BOT', '_LFT', '_RGT', '_BAK'];
/** the cube point of face k at (u, v) */
function facePoint(k: number, u: number, v: number, p: V3): void {
  const a = 2 * u - 1, b = 1 - 2 * v;
  switch (k) {
    case 0: p[0] = a; p[1] = 1; p[2] = b; break;
    case 1: p[0] = a; p[1] = b; p[2] = -1; break;
    case 2: p[0] = a; p[1] = -1; p[2] = -b; break;
    case 3: p[0] = -1; p[1] = b; p[2] = -a; break;
    case 4: p[0] = 1; p[1] = b; p[2] = a; break;
    default: p[0] = -a; p[1] = b; p[2] = 1;
  }
}
const GRID = 64;
/** fn(d, o, n): the colour along unit direction d (x, y up, z), n the fields' values there; faces of S texels, the
 *  top one of topS */
function skyBox(out: Record<string, Image>, name: string, S0: number, topS: number, cy: number, fields: ((d: V3) => number)[],
  fn: (d: V3, o: Px, n: Float64Array) => void): void {
  const d: V3 = [0, 0, 0], p: V3 = [0, 0, 0], nf = fields.length, n = new Float64Array(nf), G1 = GRID + 1;
  const look = (k: number, u: number, v: number): void => {
    facePoint(k, u, v, p);
    const dy = p[1] - cy, l = hyp3(p[0], dy, p[2]);
    d[0] = p[0] / l; d[1] = dy / l; d[2] = p[2] / l;
  };
  for (let k = 0; k < 6; k++) {
    const g = new Float32Array(G1 * G1 * nf), S = k ? S0 : topS;
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      look(k, i / GRID, j / GRID);
      for (let f = 0; f < nf; f++) g[(j * G1 + i) * nf + f] = fields[f](d);
    }
    out['JPG_' + name + SUFFIX[k]] = paint(S, S, (x, y, o) => {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, gx = u * GRID, gy = v * GRID, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
      const a = (j * G1 + i) * nf, b = a + G1 * nf;
      for (let f = 0; f < nf; f++) {
        const top = g[a + f] + (g[a + nf + f] - g[a + f]) * fx, bot = g[b + f] + (g[b + nf + f] - g[b + f]) * fx;
        n[f] = top + (bot - top) * fy;
      }
      look(k, u, v);
      fn(d, o, n);
    });
  }
}
/** a function of the azimuth (-pi .. pi), tabulated */
function azTable(fn: (az: number) => number, size = 2048): (az: number) => number {
  const t = new Float32Array(size + 1);
  for (let i = 0; i <= size; i++) t[i] = fn((i / size) * TAU - Math.PI);
  return (az) => { const x = ((az + Math.PI) / TAU) * size, i = Math.min(size - 1, Math.max(0, Math.floor(x))), f = x - i; return t[i] + (t[i + 1] - t[i]) * f; };
}
/** where a direction meets the plane `drop` cube units above the centre (below: negative), in world units about
 *  the box's axis */
const floorAt = (d: V3, drop: number, g: [number, number]): void => { const t = drop / d[1]; g[0] = 3 * d[0] * t; g[1] = 3 * d[2] * t; };
const angle = (d: V3, a: V3): number => Math.acos(clamp(dot(d, a), -1, 1));
/** white grain per texel */
const grain = (d: V3, k: number): number => hash(Math.floor(d[0] * 4096) * 7 + Math.floor(d[2] * 4096), Math.floor(d[1] * 4096), k) - 0.5;

const CANDY: RGB[] = [[226, 52, 140], [30, 176, 206], [250, 196, 30], [138, 70, 220], [250, 112, 40]];
const PETALS: RGB[] = [[255, 120, 180], [255, 255, 255], [255, 220, 60], [150, 170, 255]];

/** Munch's stage: a round dance floor of candy tiles with a bulb-lit gold rim in a flowering meadow, rolling hills
 *  with lollipop trees, a sunset sky with a rainbow, puffy clouds and the first stars */
function munchSky(out: Record<string, Image>): void {
  const cy = -2 / 3, drop = -1 - cy, G: [number, number] = [0, 0];
  const hillFar = azTable((az) => 0.16 + 0.07 * around(az, 1.5, 3, 31)), hillNear = azTable((az) => 0.075 + 0.05 * around(az, 2.5, 3, 41));
  const trees = Array.from({ length: 10 }, (_, k) => {
    const r = prng(700 + k), az = wrap((k + r() * 0.6) * (TAU / 10));
    return { az, base: hillNear(az) - 0.01, h: 0.07 + 0.05 * r(), rad: 0.03 + 0.02 * r(), col: CANDY[k % 5] };
  });
  const bow = norm([Math.sin(2.4), -0.05, Math.cos(2.4)]), sun = norm([Math.sin(-0.6), 0.1, Math.cos(-0.6)]);
  const SKY: [number, RGB][] = [[0, [255, 206, 150]], [0.12, [252, 160, 160]], [0.35, [196, 110, 186]], [0.7, [86, 66, 160]], [1, [34, 34, 100]]];
  const cloud = (d: V3, dy: number): number => fbm(d[0] * 2.2, d[1] * 5.5 + dy, d[2] * 2.2, 4, 21);
  skyBox(out, 'MUNCH', 256, 128, cy, [
    (d) => { if (d[1] >= -0.001) return cloud(d, 0); floorAt(d, drop, G); return fbm(G[0] * 0.9, 0.2, G[1] * 0.9, 3, 11); },
    (d) => (d[1] >= -0.001 ? cloud(d, 0) - cloud(d, 0.12) : fbm(G[0] * 3, 0, G[1] * 3, 2, 3)),
  ], (d, o, nz) => {
    if (d[1] < -0.001) {
      floorAt(d, drop, G);
      const gx = G[0], gz = G[1], r = hyp(gx, gz), ang = Math.atan2(gz, gx);
      if (r < 1.5) {                                  // the dance floor: rings of tiles, alternate tiles lighter
        const ring = Math.floor(r / 0.3), n = 4 + ring * 4, a = (ang / TAU + 0.5) * n, sec = Math.floor(a);
        put(o, CANDY[ring % 5]);
        if ((sec + ring) % 2) toward(o, WHITE, 0.45);
        const edge = Math.min(r - ring * 0.3, (ring + 1) * 0.3 - r, Math.min(a - sec, sec + 1 - a) * (TAU / n) * r);
        toward(o, GROUT, 1 - smooth(0.006, 0.016, ring ? edge : 9));
        times(o, 0.92 + 0.12 * nz[1]);
      } else if (r < 1.66) {                          // a gold rim with a ring of bulbs
        put(o, GOLD);
        times(o, 0.8 + 0.3 * Math.sin(((r - 1.5) / 0.16) * Math.PI));
        const b = ((ang / TAU) * 48 + 48) % 1, bd = hyp(Math.min(b, 1 - b) * (TAU / 48) * 1.58, r - 1.58);
        toward(o, BULB, 1 - smooth(0.025, 0.045, bd));
      } else {                                        // grass with flowers
        const n = nz[0], fine = grain(d, 1);
        o[0] = 64 + 26 * n; o[1] = 150 + 36 * n + 16 * fine; o[2] = 58 + 14 * n;
        const cx = Math.floor(gx / 0.4), cz = Math.floor(gz / 0.4);
        if (r < 7 && hash(cx, cz, 7) < 0.6) {
          const fx = (cx + 0.2 + 0.6 * hash(cx, cz, 5)) * 0.4, fz = (cz + 0.2 + 0.6 * hash(cx, cz, 6)) * 0.4;
          const fd = hyp(gx - fx, gz - fz), fade = 1 - smooth(3.5, 7, r);
          toward(o, PETALS[Math.floor(hash(cx, cz, 8) * 4)], (1 - smooth(0.04, 0.065, fd)) * fade);
          toward(o, YOLK, (1 - smooth(0.012, 0.024, fd)) * fade);
        }
      }
      times(o, 1 - 0.35 * (1 - smooth(0.3, 0.75, r)));            // the dancer's soft shadow
      toward(o, HAZE_M, smooth(5, 40, r) * 0.8);                    // haze towards the horizon
      return;
    }
    const e = Math.asin(d[1]), az = Math.atan2(d[0], d[2]);
    ramp(o, SKY, e / (Math.PI / 2));
    if (e > 0.45 && hash(Math.floor(d[0] * 70) * 131 + Math.floor(d[2] * 70), Math.floor(d[1] * 70), 9) > 0.993) glow(o, STAR, smooth(0.45, 0.8, e) * 0.8);
    const sd = dot(d, sun);
    glow(o, SUNGLOW, Math.exp((sd - 1) * 25) * 0.7);
    toward(o, SUNDISC, smooth(0.9978, 0.9986, sd));
    const rb = (angle(d, bow) - 0.66) / 0.13;                    // the rainbow, red outside
    if (rb > 0 && rb < 1) toward(o, hsv(0.78 * rb, 0.75, 255), Math.sin(Math.PI * rb) * 0.42 * smooth(0, 0.08, e));
    const cl = smooth(0.05, 0.38, nz[0]) * smooth(0.03, 0.14, e) * (1 - smooth(0.55, 0.85, e));
    if (cl > 0) {
      const sh = clamp(0.5 + 2.5 * nz[1]);
      towardRGB(o, mix(200, 255, sh), mix(150, 236, sh), mix(200, 236, sh), cl * 0.92);
    }
    const h1 = hillFar(az);                           // far hills, violet in the haze
    if (e < h1) { put(o, FARHILL); toward(o, HAZE_F, 0.5 * (1 - e / h1)); }
    for (const tr of trees) {                         // lollipop trees standing on the near hills
      const da = Math.abs(az - tr.az);
      if (e > 0.35 || (da > 0.06 && da < TAU - 0.06)) continue;
      const dx = wrap(az - tr.az);
      const top = tr.base + tr.h, cd = hyp(dx, e - top);
      if (Math.abs(dx) < 0.007 && e < top) put(o, TRUNK);
      if (cd < tr.rad) {
        put(o, tr.col);
        if ((Math.atan2(e - top, dx) + Math.PI + (cd / tr.rad) * 5) % (TAU / 3) < 1) toward(o, WHITE, 0.55);
        times(o, 1 - 0.3 * smooth(0.6, 1, cd / tr.rad));
      }
    }
    const h2 = hillNear(az);                          // near hills, green with crop stripes
    if (e < h2) {
      o[0] = 70; o[1] = 156; o[2] = 70;
      times(o, 0.9 + 0.12 * Math.sin(az * 90 + e * 300) + 0.15 * (e / h2));
    }
  });
}
const WHITE: RGB = [255, 248, 250], GROUT: RGB = [70, 26, 90], GOLD: RGB = [214, 160, 54], BULB: RGB = [255, 250, 210], YOLK: RGB = [255, 200, 40];
const HAZE_M: RGB = [196, 186, 170], STAR: RGB = [255, 250, 220], SUNGLOW: RGB = [255, 210, 120], SUNDISC: RGB = [255, 244, 200];
const FARHILL: RGB = [150, 124, 186], HAZE_F: RGB = [236, 180, 170], TRUNK: RGB = [120, 74, 50];

/** Maxx's Kingdom: floating islands with castles above a sea of clouds, a golden sky, swirled clouds, a pale sun
 *  and a crescent moon */
function blobbySky(out: Record<string, Image>): void {
  const cy = -0.55, drop = -1 - cy, G: [number, number] = [0, 0];
  const isles = Array.from({ length: 6 }, (_, k) => {
    const r = prng(900 + k);
    return { az: wrap((k + 0.2 + 0.5 * r()) * (TAU / 6)), e: 0.05 + 0.16 * r(), w: 0.12 + 0.12 * r(), h: 0.5 + 0.3 * r(), castle: k % 2 === 0, roof: CANDY[(k * 2) % 5] };
  });
  const sun = norm([Math.sin(0.9), 0.35, Math.cos(0.9)]), moon = norm([Math.sin(-2.3), 0.62, Math.cos(-2.3)]), moon2 = norm([Math.sin(-2.27), 0.64, Math.cos(-2.27)]);
  const SKY: [number, RGB][] = [[0, [255, 216, 150]], [0.15, [250, 190, 170]], [0.35, [130, 200, 226]], [0.75, [60, 96, 186]], [1, [36, 46, 128]]];
  const sea = (dx: number, dz: number): number => fbm(G[0] * 0.6 + dx, 0.3, G[1] * 0.6 + dz, 4, 51);
  skyBox(out, 'BLOBBY', 256, 128, cy, [
    (d) => {
      if (d[1] < -0.001) { floorAt(d, drop, G); return sea(0, 0); }
      const q = fbm(d[0] * 1.6, d[1] * 1.6, d[2] * 1.6, 2, 61);
      return fbm(d[0] * 2.6 + q * 1.4, d[1] * 6 + q, d[2] * 2.6 - q * 1.4, 4, 62);
    },
    (d) => (d[1] < -0.001 ? sea(0, 0) - sea(0.08, 0.05) : 0),
  ], (d, o, nz) => {
    if (d[1] < -0.001) {                              // the sea of clouds, deep blue showing through its gaps
      floorAt(d, drop, G);
      const r = hyp(G[0], G[1]), c = nz[0], l = clamp(0.55 + nz[1] * 6);
      put(o, DEEP);
      towardRGB(o, mix(168, 255, l), mix(150, 246, l), mix(214, 250, l), smooth(-0.35, -0.2, c));
      toward(o, HAZE_K, smooth(4, 40, r) * 0.85);
      return;
    }
    const e = Math.asin(d[1]), az = Math.atan2(d[0], d[2]);
    ramp(o, SKY, e / (Math.PI / 2));
    if (e > 0.6 && hash(Math.floor(d[0] * 60) * 97 + Math.floor(d[2] * 60), Math.floor(d[1] * 60), 19) > 0.992) glow(o, STAR_K, smooth(0.6, 1, e) * 0.7);
    const sd = dot(d, sun);
    glow(o, SUNGLOW_K, Math.exp((sd - 1) * 14) * 0.6);
    toward(o, SUNDISC_K, smooth(0.9955, 0.997, sd));
    if (dot(d, moon) > 0.9975 && dot(d, moon2) < 0.9982) toward(o, MOON, 0.9);
    const c = nz[0], cl = smooth(0.12, 0.32, c) * smooth(0.04, 0.18, e) * (1 - smooth(0.6, 0.9, e));
    if (cl > 0) towardRGB(o, 255, mix(214, 244, clamp(c * 2)), mix(220, 236, clamp(c * 2)), cl * 0.85);
    for (const I of isles) {
      const x = wrap(az - I.az) / I.w;
      if (Math.abs(x) > 1.1) continue;
      const de = (e - I.e) / I.w, top = 0.07 * (1 - x * x), bot = -I.h * (1 - Math.abs(x) ** 1.6);
      if (Math.abs(x) < 1 && de < top && de > bot) {
        put(o, ROCK);
        times(o, 0.6 + (0.4 * (de - bot)) / (top - bot) + 0.12 * grain(d, 2));
        if (de > top - 0.06) put(o, GRASS_K);
      }
      if (!I.castle) continue;
      if (Math.abs(x) < 0.5 && de > 0.06 && de < 0.2) { put(o, WALL2); if ((x * 40 + 100) % 2 < 1 && de > 0.17) put(o, WALL3); }
      for (const [tx, tw, th, rf] of TOWERS) {
        const lx = Math.abs(x - tx), base = 0.06;
        if (lx < tw && de > base && de < base + th) {
          put(o, WALL);
          if (lx < tw * 0.35 && Math.abs(de - base - th * 0.65) < 0.025) put(o, WINDOW);
          times(o, x - tx < 0 ? 1 : 0.86);
        }
        if (de >= base + th && de < base + th + rf * (1 - lx / (tw * 1.4)) && lx < tw * 1.4) put(o, I.roof);
        if (Math.abs(x - tx) < 0.006 && de > base + th + rf && de < base + th + rf + 0.08) put(o, POLE);
        if (x - tx > 0 && x - tx < 0.07 && de > base + th + rf + 0.05 && de < base + th + rf + 0.08) put(o, FLAG);
      }
    }
  });
}
const TOWERS = [[-0.42, 0.08, 0.3, 0.16], [-0.16, 0.12, 0.52, 0.26], [0.18, 0.1, 0.4, 0.2], [0.45, 0.07, 0.24, 0.14]];
const DEEP: RGB = [52, 76, 168], HAZE_K: RGB = [250, 214, 190], STAR_K: RGB = [255, 240, 160], SUNGLOW_K: RGB = [255, 236, 170];
const SUNDISC_K: RGB = [255, 252, 226], MOON: RGB = [250, 250, 236], ROCK: RGB = [156, 112, 140], GRASS_K: RGB = [104, 196, 110];
const WALL: RGB = [244, 228, 236], WALL2: RGB = [232, 214, 226], WALL3: RGB = [196, 176, 196], WINDOW: RGB = [255, 200, 70];
const POLE: RGB = [90, 70, 70], FLAG: RGB = [236, 60, 90];

/** Undersea: blue water darkening with depth, a rippling bright surface with caustics, shafts of light, kelp and
 *  rocks around a rippled sand floor, drifting specks */
function jellySky(out: Record<string, Image>): void {
  const G: [number, number] = [0, 0];
  const shafts = Array.from({ length: 14 }, (_, k) => { const r = prng(1100 + k); return { az: r() * TAU, w: 0.03 + 0.07 * r(), a: 0.4 + 0.6 * r() }; });
  const shaft = azTable((az) => { let s = 0; for (const sh of shafts) s += sh.a * Math.exp(-((wrap(az - sh.az) / sh.w) ** 2)); return s; }, 4096);
  const rocks = azTable((az) => -0.18 + 0.12 * around(az, 3, 3, 73));
  const kelp = Array.from({ length: 16 }, (_, k) => { const r = prng(1200 + k); return { az: wrap(r() * TAU), top: -0.05 + 0.3 * r(), w: 0.01 + 0.012 * r(), ph: r() * TAU }; });
  const SEA: [number, RGB][] = [[-1, [2, 8, 24]], [-0.25, [5, 26, 58]], [0.1, [10, 60, 104]], [0.6, [30, 126, 168]], [1, [90, 206, 226]]];
  skyBox(out, 'JELLY', 256, 256, 0, [
    (d) => { if (d[1] > 0.2) { floorAt(d, 1, G); return fbm(G[0] * 0.4, 1.7, G[1] * 0.4, 2, 81) * 0.6; } if (d[1] < -0.15) { floorAt(d, -1, G); return fbm(G[0] * 0.5, 1, G[1] * 0.5, 2, 71); } return 0; },
    (d) => { if (d[1] < -0.15) { floorAt(d, -1, G); return fbm(G[0] * 0.5, 2, G[1] * 0.5, 3, 72); } return vnoise(Math.atan2(d[0], d[2]) * 4 + 50, Math.asin(d[1]) * 3, 7.7); },
  ], (d, o, nz) => {
    const e = Math.asin(d[1]), az = Math.atan2(d[0], d[2]);
    ramp(o, SEA, e / (Math.PI / 2));
    if (d[1] > 0.25) {                                // the surface: caustic network and the sun
      floorAt(d, 1, G);
      const w = nz[0], ce = cellEdge(G[0] * 1.3 + w, G[1] * 1.3 - w);
      glow(o, CAUSTIC, (1 - smooth(0.02, 0.16, ce)) * smooth(0.25, 0.75, d[1]) * 0.38);
      glow(o, SUNWATER, Math.exp((d[1] - 1) * 10) * 0.8);
    }
    const shimmer = d[1] < -0.15 ? 0.6 : 0.6 + 0.4 * nz[1];
    glow(o, SHAFT, shaft(az) * shimmer * smooth(-0.6, 0.5, e) * (1 - smooth(0.85, 1.3, e)) * 0.45);
    if (d[1] < -0.2) {                                // the floor: rippled sand, dark rocks
      floorAt(d, -1, G);
      const sx = G[0], r = hyp(G[0], G[1]), rip = Math.sin(sx * 5 + 2.5 * nz[0]);
      const rock = smooth(0.3, 0.42, nz[1]), f = 1 - smooth(4, 16, r);
      towardRGB(o, 58 + 12 * rip, 72 + 12 * rip, 74 + 6 * rip, f * 0.85);
      toward(o, SEAROCK, rock * f * 0.9);
    }
    if (e < rocks(az) && e > -0.5) toward(o, REEF, 0.85 * smooth(-0.5, -0.4, e));   // rocks and kelp on the horizon
    for (const k of kelp) {
      const da = Math.abs(az - k.az);
      if (e > k.top || (da > 0.06 && da < TAU - 0.06)) continue;
      const x = Math.abs(wrap(az - k.az - 0.03 * Math.sin(e * 14 + k.ph)));
      if (x > 0.03) continue;
      const w = k.w * (0.4 + 0.6 * smooth(k.top, k.top - 0.2, e));
      if (x < w) { put(o, KELP); glow(o, KELP_LIT, (1 - x / w) * 0.4); }
    }
    if (hash(Math.floor(d[0] * 110) * 211 + Math.floor(d[2] * 110), Math.floor(d[1] * 110), 29) > 0.996) glow(o, SNOW, 0.45);
  });
}
const CAUSTIC: RGB = [150, 240, 255], SUNWATER: RGB = [200, 250, 255], SHAFT: RGB = [60, 150, 160], SEAROCK: RGB = [14, 26, 36];
const REEF: RGB = [6, 22, 38], KELP: RGB = [8, 44, 40], KELP_LIT: RGB = [20, 70, 50], SNOW: RGB = [150, 200, 210];

// ---------------------------------------------------------------------------------------------- meshes
const material = (texture: string | null, power = 20): XMaterial =>
  ({ diffuse: [1, 1, 1, 1], power, specular: [0.4, 0.4, 0.4], emissive: [0, 0, 0], texture });

/** a mesh under construction: vertices with uv and (for skinning) up to two bones, triangles each turned so that
 *  its right-hand normal points away from a point inside the solid (the presets cull clockwise; the model's
 *  transforms are rotations and positive scales, which keep that) */
class Builder {
  p: number[] = []; uv: number[] = []; f: number[] = []; fm: number[] = [];
  bone: number[] = [];                                   // per vertex: b0, w0, b1 (b1 -1: one influence)
  v(p: V3, u: number, v: number, b0 = -1, w0 = 1, b1 = -1): number {
    this.p.push(p[0], p[1], p[2]); this.uv.push(u, v);
    if (b1 >= 0 && (w0 > 0.999 || w0 < 0.001)) { if (w0 < 0.001) b0 = b1; b1 = -1; w0 = 1; }
    this.bone.push(b0, w0, b1);
    return this.p.length / 3 - 1;
  }
  private at(i: number): V3 { return [this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]]; }
  tri(a: number, b: number, c: number, m: number, inside: V3): void {
    const pa = this.at(a), n = cross(sub(this.at(b), pa), sub(this.at(c), pa));
    const mid = scale(add(add(pa, this.at(b)), this.at(c)), 1 / 3);
    if (dot(n, sub(mid, inside)) >= 0) this.f.push(a, b, c); else this.f.push(a, c, b);
    this.fm.push(m);
  }
  /** a (nu + 1) x (nv + 1) grid of vertices from at(i, j), quads from (i, j) with their inside point */
  grid(nu: number, nv: number, at: (i: number, j: number) => number, m: number, inside: (i: number, j: number) => V3): void {
    const id: number[] = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) id.push(at(i, j));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = id[j * (nu + 1) + i], b = id[j * (nu + 1) + i + 1], c = id[(j + 1) * (nu + 1) + i + 1], d = id[(j + 1) * (nu + 1) + i];
      const ins = inside(i, j);
      this.tri(a, b, c, m, ins); this.tri(a, c, d, m, ins);
    }
  }
  /** an XMesh: smooth normals (shared by every vertex at the same place: seams and poles) */
  mesh(name: string, mats: XMaterial[]): XMesh {
    const used = new Set(this.fm);
    if (used.size !== mats.length) throw new Error(`plus3d art: ${name} leaves a material without faces`);
    return { name, positions: Float32Array.from(this.p), normals: normals(this.p, this.f), uvs: Float32Array.from(this.uv),
      faces: Uint16Array.from(this.f), faceMaterials: Uint32Array.from(this.fm), materials: mats };
  }
}

function normals(p: ArrayLike<number>, f: ArrayLike<number>): Float32Array {
  const n = p.length / 3, rep = new Int32Array(n), seen = new Map<number, number>(), acc = new Float64Array(n * 3);
  const q = (x: number): number => Math.round(x * 64) + 65536;    // a 1/64 grid, 17 bits an axis (|x| < 1024)
  for (let i = 0; i < n; i++) {
    const k = (q(p[i * 3]) * 131072 + q(p[i * 3 + 1])) * 131072 + q(p[i * 3 + 2]);
    const r = seen.get(k);
    if (r === undefined) { seen.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  for (let t = 0; t < f.length; t += 3) {
    const a = f[t] * 3, b = f[t + 1] * 3, c = f[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [f[t], f[t + 1], f[t + 2]]) { const r = rep[k] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rep[i] * 3, l = hyp3(acc[r], acc[r + 1], acc[r + 2]) || 1;
    out[i * 3] = acc[r] / l; out[i * 3 + 1] = acc[r + 1] / l; out[i * 3 + 2] = acc[r + 2] / l;
  }
  return out;
}

/** an ellipsoid at c with radii r (nA around, nP top to bottom), uv: u around (the front, -Y, at 0.5), v down;
 *  shape may move each point after (direction, point) */
function ellipsoid(b: Builder, c: V3, r: V3, nA: number, nP: number, m: number, shape?: (d: V3, p: V3) => V3): void {
  b.grid(nA, nP, (i, j) => {
    const al = (i / nA - 0.5) * TAU, ph = (j / nP) * Math.PI, d = dirOf(al, ph);
    let p: V3 = [c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]];
    if (shape) p = shape(d, p);
    return b.v(p, i / nA, j / nP);
  }, m, () => c);
}

/** a tube along the points of path(t), t in [0, 1], radius rad(t), nS sides and nR rings; bones(t) gives each
 *  ring's skinning [b0, w0, b1]; uv: u around, v from v0 to v1 along */
function tube(b: Builder, path: (t: number) => V3, rad: (t: number) => number, nS: number, nR: number, m: number,
  bones: (t: number) => [number, number, number] = () => [-1, 1, -1], v0 = 0, v1 = 1, twist = 0): void {
  const ringAt = (j: number): [V3, V3, V3] => {
    const t = j / nR, c = path(t), a = norm(sub(path(Math.min(1, t + 0.01)), path(Math.max(0, t - 0.01))));
    const [e1, e2] = across(a);
    return [c, e1, e2];
  };
  const rings = Array.from({ length: nR + 1 }, (_, j) => ringAt(j));
  b.grid(nS, nR, (i, j) => {
    const t = j / nR, [c, e1, e2] = rings[j], th = (i / nS) * TAU + twist * t, rr = rad(t);
    const [b0, w0, b1] = bones(t);
    return b.v(add(c, add(scale(e1, Math.cos(th) * rr), scale(e2, Math.sin(th) * rr))), i / nS, mix(v0, v1, t), b0, w0, b1);
  }, m, (i, j) => rings[j][0]);
}

// ------------------------------------------------------------------------------------- matrices (row vectors)
type M4 = number[];
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const rotX = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const rotY = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotZ = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
const trans = (t: V3): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];

// ================================================================================================ Munch: Pip
// Model space: Z up, the front towards -Y, the feet's soles at z = -1 (the preset's transform puts that on the sky
// box's floor), the top of the bulb near z = 24.
/** an animation's key times are milliseconds of the actor's clock, which runs at the music's level times 30 (about
 *  7 times real time for typical music: ./modelset.ts Actor.animate): RATE turns real seconds into key time */
const RATE = 7;

interface BoneDef { name: string; parent: string; at: V3 }
const PIP: BoneDef[] = [
  { name: 'hips', parent: 'Pip', at: [0, 0, 4.5] },
  { name: 'spine', parent: 'hips', at: [0, 0, 9.5] },
  { name: 'head', parent: 'spine', at: [0, 0, 13.5] },
  { name: 'eyeL', parent: 'head', at: [-2.3, -3.0, 15.0] },
  { name: 'eyeR', parent: 'head', at: [2.3, -3.0, 15.0] },
  { name: 'ant1', parent: 'head', at: [0, 1.0, 16.6] },
  { name: 'ant2', parent: 'ant1', at: [0, 1.0, 19.2] },
  { name: 'tip', parent: 'ant2', at: [0, 1.0, 21.6] },
  { name: 'armL', parent: 'spine', at: [-6.0, 0, 10.5] },
  { name: 'foreL', parent: 'armL', at: [-9.6, 0, 10.5] },
  { name: 'handL', parent: 'foreL', at: [-13.0, 0, 10.5] },
  { name: 'armR', parent: 'spine', at: [6.0, 0, 10.5] },
  { name: 'foreR', parent: 'armR', at: [9.6, 0, 10.5] },
  { name: 'handR', parent: 'foreR', at: [13.0, 0, 10.5] },
  { name: 'legL', parent: 'hips', at: [-2.6, 0, 4.5] },
  { name: 'shinL', parent: 'legL', at: [-2.6, 0, 2.2] },
  { name: 'footL', parent: 'shinL', at: [-2.6, 0, 0] },
  { name: 'legR', parent: 'hips', at: [2.6, 0, 4.5] },
  { name: 'shinR', parent: 'legR', at: [2.6, 0, 2.2] },
  { name: 'footR', parent: 'shinR', at: [2.6, 0, 0] },
];
const BONE_AT = new Map(PIP.map((b) => [b.name, b.at]));
const localOf = (b: BoneDef): V3 => sub(b.at, BONE_AT.get(b.parent) ?? [0, 0, 0]);
/** the skinned mesh's bones, in its SkinWeights order */
const SKIN = ['hips', 'spine', 'head', 'ant1', 'ant2', 'tip', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'];
const SB = (n: string): number => SKIN.indexOf(n);

/** a blend between bones x (below lo) and y (above hi) along a coordinate */
const blend = (x: string, y: string, lo: number, hi: number, t: number): [number, number, number] => [SB(x), 1 - smooth(lo, hi, t), SB(y)];

/** Pip's body: a pear (wider low down), the face's features painted on its front; the shape as its texture maps it */
const BODY_ZC = 9.5, BODY_RZ = 7.6, BODY_RX = 6.8, BODY_RY = 6.0;
function bodyAt(al: number, ph: number): V3 {
  const w = Math.sin(ph) * (1 - 0.12 * Math.cos(ph));
  return [BODY_RX * w * Math.sin(al), -BODY_RY * w * Math.cos(al), BODY_ZC + BODY_RZ * Math.cos(ph)];
}

function pipSkin(): XMesh {
  const b = new Builder();
  const NA = 28, NP = 20;
  b.grid(NA, NP, (i, j) => {                          // the body: hips, spine and head by height
    const al = (i / NA - 0.5) * TAU, ph = (j / NP) * Math.PI, p = bodyAt(al, ph), z = p[2];
    const w = z < 11 ? blend('hips', 'spine', 5.5, 9, z) : blend('spine', 'head', 12, 14.5, z);
    return b.v(p, i / NA, j / NP, w[0], w[1], w[2]);
  }, 0, (i, j) => [0, 0, BODY_ZC + BODY_RZ * Math.cos(((j + 0.5) / NP) * Math.PI) * 0.9]);
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    tube(b, (t) => [side * mix(4.6, 13.2, t), 0, 10.5], (t) => 1.15 - 0.25 * t, 10, 12, 1, (t) => {
      const x = mix(4.6, 13.2, t);
      return x < 7.5 ? blend('spine', 'arm' + s, 5.0, 6.8, x) : blend('arm' + s, 'fore' + s, 8.8, 10.4, x);
    }, 0, 1);
    tube(b, (t) => [side * 2.6, 0, mix(6.0, -0.2, t)], (t) => 1.6 - 0.35 * t, 10, 10, 1, (t) => {
      const z = mix(6.0, -0.2, t);
      return z > 3.5 ? blend('leg' + s, 'hips', 3.8, 5.4, z) : blend('shin' + s, 'leg' + s, 1.5, 2.9, z);
    }, 0, 1);
  }
  tube(b, (t) => [0, 1.0 + 0.4 * Math.sin(t * 2.2), mix(15.6, 22.2, t)], (t) => 0.55 - 0.15 * t, 6, 12, 1, (t) => {
    const z = mix(15.6, 22.2, t);
    return z < 18 ? blend('head', 'ant1', 16.4, 17.4, z) : z < 20.4 ? blend('ant1', 'ant2', 18.7, 19.7, z) : blend('ant2', 'tip', 21.1, 22.0, z);
  }, 0, 1);
  const base = b.mesh('PipSkin', [material('JPG_MUNCH_PIP_SKIN'), material('JPG_MUNCH_PIP_LIMB')]);
  const nv = b.p.length / 3, sw: XSkinWeights[] = SKIN.map((n) => ({ node: n, vertices: [] as number[], weights: [] as number[], offset: trans(scale(BONE_AT.get(n)!, -1)) }));
  for (let i = 0; i < nv; i++) {
    const b0 = b.bone[i * 3], w0 = b.bone[i * 3 + 1], b1 = b.bone[i * 3 + 2];
    (sw[b0].vertices as number[]).push(i); (sw[b0].weights as number[]).push(w0);
    if (b1 >= 0) { (sw[b1].vertices as number[]).push(i); (sw[b1].weights as number[]).push(1 - w0); }
  }
  return { ...base, duplication: { original: nv, indices: Uint32Array.from({ length: nv }, (_, i) => i) },
    skinHeader: [2, 6, SKIN.length], skinWeights: sw, normalFaces: base.faces };
}

/** the rigid parts, each in its bone's frame (the bone's joint at the origin) */
function pipParts(): Map<string, XMesh[]> {
  const parts = new Map<string, XMesh[]>();
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? -1 : 1;
    const eye = new Builder();
    ellipsoid(eye, [0, 0, 0], [2.0, 2.0, 2.0], 14, 10, 0);
    parts.set('eye' + s, [eye.mesh('eye' + s, [material('JPG_MUNCH_PIP_EYE', 60)])]);
    const hand = new Builder();
    ellipsoid(hand, [side * 1.3, 0, 0], [1.7, 1.35, 1.45], 12, 8, 0);
    ellipsoid(hand, [side * 0.7, -1.1, 0.7], [0.65, 0.65, 0.65], 8, 6, 0);
    parts.set('hand' + s, [hand.mesh('hand' + s, [material('JPG_MUNCH_PIP_LIMB')])]);
    const foot = new Builder();
    ellipsoid(foot, [0, -0.9, -0.15], [1.9, 2.8, 1.0], 14, 8, 0, (d, p) => [p[0], p[1], Math.max(p[2], -1.0)]);
    parts.set('foot' + s, [foot.mesh('foot' + s, [material('JPG_MUNCH_PIP_LIMB')])]);
  }
  const bulb = new Builder();
  ellipsoid(bulb, [0, 0.5, 1.3], [1.4, 1.4, 1.4], 12, 8, 0);
  parts.set('tip', [bulb.mesh('bulb', [material('JPG_MUNCH_PIP_BULB', 80)])]);
  return parts;
}

function pipModel(): XFile {
  const parts = pipParts();
  const frames = new Map<string, XFrame>();
  const root: XFrame = { name: 'Pip', matrix: ident(), meshes: [pipSkin()], children: [] };
  frames.set('Pip', root);
  for (const bd of PIP) {
    const fr: XFrame = { name: bd.name, matrix: trans(localOf(bd)), meshes: parts.get(bd.name) ?? [], children: [] };
    frames.get(bd.parent)!.children.push(fr);
    frames.set(bd.name, fr);
  }
  return { frames: [root], animationSets: [] };
}

// Pip's textures. The body's uv: u around from the back (the front at 0.5), v from the top down by the angle ph.
const pipDir = (u: number, v: number): V3 => dirOf((u - 0.5) * TAU, v * Math.PI);
const SPOT: RGB = [14, 104, 110], BLUSH: RGB = [250, 120, 150];

function pipSkinTex(): Image {
  const S = 256, PH_M = 1.24;                         // the mouth's height (ph)
  const cheeks = [dirOf(-0.78, PH_M - 0.06), dirOf(0.78, PH_M - 0.06)], C1 = Math.cos(0.1), C2 = Math.cos(0.2);
  return paint(S, S, (x, y, o) => {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, al = (u - 0.5) * TAU, ph = v * Math.PI, d = pipDir(u, v);
    o[0] = 30; o[1] = 168; o[2] = 150;                 // teal, darker towards the back and the bottom
    times(o, (0.85 + 0.15 * Math.cos(al)) * (1.05 - 0.25 * smooth(2.2, 3.1, ph)) * (0.94 + 0.08 * fbm(u * 12, v * 8, 0.3, 3, 101)));
    if (Math.abs(al) > 1.4) toward(o, SPOT, (1 - smooth(0.2, 0.35, cellSpot(u * 14, v * 9, 102))) * smooth(1.4, 1.9, Math.abs(al)) * 0.8);   // spots on the back
    const bel = hyp(al / 0.95, (ph - 2.0) / 0.62);             // the belly patch
    toward(o, [190, 236, 196], 1 - smooth(0.9, 1.0, bel));
    for (const c of cheeks) toward(o, BLUSH, smooth(C2, C1, dot(d, c)) * 0.7);   // cheeks
    const w = 0.55, ax = al / w;                      // the mouth: a wide open smile with a tongue
    if (Math.abs(ax) < 1) {
      const up = PH_M + 0.03 - 0.12 * ax * ax, lo = PH_M + 0.2 * (1 - ax * ax) - 0.08 * ax * ax;
      const inM = Math.min(ph - up, lo - ph);
      if (inM > -0.012) {
        put(o, [70, 14, 40]);
        if (ph > lo - 0.09 && Math.abs(ax) < 0.55) toward(o, [236, 96, 128], 1 - smooth(0.5, 0.55, Math.abs(ax)));
        if (ph < up + 0.035 && Math.abs(ax) < 0.6) put(o, [250, 250, 244]);                // a row of teeth
        toward(o, [20, 70, 70], 1 - smooth(-0.012, 0.012, inM));
      }
    }
  });
}
/** the distance to the nearest jittered point of a 2-D cellular noise (cells of size 1) */
function cellSpot(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    d1 = Math.min(d1, hyp(cx + 0.2 + 0.6 * hash(cx, cy, seed) - x, cy + 0.2 + 0.6 * hash(cx, cy, seed + 1) - y));
  }
  return d1;
}
/** the limbs, hands, feet: warm coral with soft rings */
const pipLimbTex = (): Image => paint(128, 128, (x, y, o) => {
  const v = (y + 0.5) / 128;
  o[0] = 246; o[1] = 120; o[2] = 76;
  times(o, 0.9 + 0.1 * Math.sin(v * TAU * 6) + 0.05 * fbm(x / 20, y / 20, 0.7, 2, 111));
});
/** the eyes: white, a violet iris and a big pupil looking ahead (-Y), two highlights */
const pipEyeTex = (): Image => paint(128, 128, (x, y, o) => {
  const d = pipDir((x + 0.5) / 128, (y + 0.5) / 128), a = Math.acos(clamp(-d[1], -1, 1));
  put(o, [250, 250, 246]);
  toward(o, [120, 70, 200], 1 - smooth(0.5, 0.54, a));
  toward(o, [16, 10, 30], 1 - smooth(0.3, 0.34, a));
  toward(o, [255, 255, 255], 1 - smooth(0.07, 0.1, Math.acos(clamp(dot(d, norm([0.25, -1, 0.3])), -1, 1))));
  toward(o, [255, 255, 255], 1 - smooth(0.03, 0.05, Math.acos(clamp(dot(d, norm([-0.18, -1, -0.15])), -1, 1))));
});
/** the bulb: lemon yellow with a swirl */
const pipBulbTex = (): Image => paint(64, 64, (x, y, o) => {
  const u = (x + 0.5) / 64, v = (y + 0.5) / 64;
  o[0] = 255; o[1] = 224; o[2] = 70;
  if ((u * 3 + v * 2) % 1 < 0.35) toward(o, [255, 140, 40], 0.6);
});

// Pip's dances. A pose: each animated bone's rotation (about x, then y, then z, in its parent's axes), translation
// (added to its joint's place) and scale.
interface Joint { r: V3; t: V3; s: V3 }
type Pose = Record<string, Joint>;
const ANIMATED = PIP.map((b) => b.name);
function restPose(): Pose {
  const P: Pose = {};
  for (const n of ANIMATED) P[n] = { r: [0, 0, 0], t: [0, 0, 0], s: [1, 1, 1] };
  for (const side of [-1, 1] as const) { arm(P, side, -1.0, 0.15, 0.35); leg(P, side, 0); }
  return P;
}
/** an arm (side -1 left, +1 right): raised by `raise` (radians above level), swung forward by `swing`, the elbow
 *  bent forward by `bend`, the forearm waved outwards by `wave` */
function arm(P: Pose, side: number, raise: number, swing: number, bend: number, wave = 0): void {
  const s = side < 0 ? 'L' : 'R';
  P['arm' + s].r = [0, -side * raise, -side * swing];
  P['fore' + s].r = [0, -side * wave, -side * bend];
}
/** a leg: the hips lowered by `drop` with the foot kept flat where it stands, the knee lifted by `lift`, the leg
 *  rolled sideways by `roll` (to keep the foot in place under shifted hips) and turned by `yaw` */
function leg(P: Pose, side: number, drop: number, lift = 0, roll = 0, yaw = 0): void {
  const s = side < 0 ? 'L' : 'R', a = Math.acos(clamp(1 - drop / 4.5, -1, 1));
  P['leg' + s].r = [-a - lift, roll, yaw];
  P['shin' + s].r = [2 * a + 1.4 * lift, 0, 0];
  P['foot' + s].r = [-a - 0.4 * lift, -roll, 0];
}
/** one bump of width w at c on a looping phase q in [0, 1) */
const bump = (q: number, c: number, w: number): number => { const x = wrap((q - c) * TAU) / TAU / w; return Math.abs(x) < 1 ? 0.5 + 0.5 * Math.cos(x * Math.PI) : 0; };
const blink = (P: Pose, k: number): void => { P.eyeL.s = [1, 1, 1 - 0.85 * k]; P.eyeR.s = [1, 1, 1 - 0.85 * k]; };
function antenna(P: Pose, x: number, y: number, lag = 0.7, t = 0): void {
  P.ant1.r = [0.3 * Math.sin(x), 0.3 * Math.sin(y), 0];
  P.ant2.r = [0.35 * Math.sin(x - lag), 0.35 * Math.sin(y - lag), 0];
  P.tip.r = [0.3 * Math.sin(x - 2 * lag), 0.3 * Math.sin(y - 2 * lag), t];
}

interface Dance { name: string; seconds: number; beats: number; pose: (P: Pose, s: number, b: number, q: number) => void }
const DANCES: Dance[] = [
  { name: 'BOP', seconds: 4, beats: 8, pose: (P, s, b) => {
    const drop = 0.9 * (0.5 - 0.5 * Math.cos(b)), h = b / 2;
    P.hips.t = [0, 0, -drop]; P.hips.r = [0.1 * Math.sin(b), 0, 0];
    P.head.r = [0.2 * Math.sin(b - 0.8), 0, 0];
    arm(P, 1, -0.3 + 0.7 * Math.sin(h), 0.4, 1.3); arm(P, -1, -0.3 - 0.7 * Math.sin(h), 0.4, 1.3);
    leg(P, 1, drop); leg(P, -1, drop);
    antenna(P, b - 1.2, 0.5 * h);
    blink(P, bump(s, 0.4, 0.03) + bump(s, 0.9, 0.03));
  } },
  { name: 'SWAY', seconds: 4, beats: 8, pose: (P, s, b) => {
    const h = b / 2, dx = 1.3 * Math.sin(h), drop = 0.4 * (0.5 - 0.5 * Math.cos(b));
    P.hips.t = [dx, 0, -drop]; P.hips.r = [0, -0.12 * Math.sin(h), 0];
    P.spine.r = [0, 0.2 * Math.sin(h - 0.5), 0]; P.head.r = [0, 0.14 * Math.sin(h - 1), 0];
    arm(P, 1, 1.15 + 0.3 * Math.sin(h), 0.15, 0.3, 0.5 + 0.3 * Math.sin(h - 0.6));
    arm(P, -1, 1.15 - 0.3 * Math.sin(h), 0.15, 0.3, 0.5 - 0.3 * Math.sin(h - 0.6));
    for (const sd of [-1, 1]) leg(P, sd, drop, 0, (dx / 4.5) * 0.9);
    antenna(P, 0.5 * b, h - 1.5);
    blink(P, bump(s, 0.15, 0.03));
  } },
  { name: 'SPIN', seconds: 4, beats: 8, pose: (P, s, b) => {
    const hop = 1.5 * Math.max(0, Math.sin(b)), drop = 0.7 * Math.max(0, -Math.sin(b));
    P.hips.t = [0, 0, hop - drop]; P.hips.r = [0, 0, TAU * s];
    P.head.r = [-0.12, 0, 0];
    for (const sd of [-1, 1]) { arm(P, sd, 0.3 + 0.25 * Math.sin(b), -0.35, 0.4); leg(P, sd, drop); }
    P.footL.r[0] += 0.4 * hop / 1.5; P.footR.r[0] += 0.4 * hop / 1.5;
    antenna(P, b, b + 1, 0.9);
    P.ant1.r[1] += 0.35;
  } },
  { name: 'WAVE', seconds: 4, beats: 8, pose: (P, s, b) => {
    P.hips.t = [0.5 * Math.sin(b), 0, -0.2 * (0.5 - 0.5 * Math.cos(b))]; P.hips.r = [0, 0.08 * Math.sin(b), 0];
    P.head.r = [0.05 * Math.sin(b), 0.22 + 0.06 * Math.sin(b), 0.15];
    arm(P, 1, 1.25, 0.3, 0.2, 0.55 + 0.5 * Math.sin(2 * b));
    arm(P, -1, -0.45, -0.6, 1.9);
    leg(P, 1, 0.2 * (0.5 - 0.5 * Math.cos(b)), 0.45 * Math.max(0, Math.sin(b)), 0.5 * Math.sin(b) / 4.5);
    leg(P, -1, 0.2 * (0.5 - 0.5 * Math.cos(b)), 0, 0.5 * Math.sin(b) / 4.5);
    antenna(P, b, 2 * b, 0.8);
    blink(P, bump(s, 0.3, 0.025) + bump(s, 0.36, 0.025));
  } },
  { name: 'MARCH', seconds: 4, beats: 8, pose: (P, s, b) => {
    const h = b / 2, liftL = Math.max(0, Math.sin(h)) * 1.1, liftR = Math.max(0, -Math.sin(h)) * 1.1, drop = 0.3 * (0.5 - 0.5 * Math.cos(b));
    P.hips.t = [0, 0, -drop]; P.hips.r = [0.06, 0, 0.18 * Math.sin(h)];
    P.head.r = [0.12 * Math.sin(b), 0, -0.1 * Math.sin(h)];
    arm(P, 1, -0.9, 0.8 * Math.sin(h), 0.8); arm(P, -1, -0.9, -0.8 * Math.sin(h), 0.8);
    leg(P, -1, drop, liftL); leg(P, 1, drop, liftR);
    antenna(P, b - 1, 0.3 * h);
    blink(P, bump(s, 0.62, 0.03));
  } },
  { name: 'TWIST', seconds: 4, beats: 8, pose: (P, s, b) => {
    const h = b / 2, yaw = 0.5 * Math.sin(h), drop = 0.75 + 0.5 * Math.sin(TAU * s - Math.PI / 2);
    P.hips.t = [0, 0, -drop]; P.hips.r = [0.1, 0, yaw];
    P.spine.r = [0, 0, -0.75 * Math.sin(h)]; P.head.r = [0, 0, 0.4 * Math.sin(h)];
    arm(P, 1, 0.05, 0.45 + 0.35 * Math.sin(h), 1.4); arm(P, -1, 0.05, 0.45 - 0.35 * Math.sin(h), 1.4);
    leg(P, 1, drop, 0, 0, -yaw); leg(P, -1, drop, 0, 0, -yaw);
    antenna(P, h, b, 0.6);
    blink(P, bump(s, 0.75, 0.03));
  } },
  { name: 'JUMP', seconds: 4, beats: 4, pose: (P, s, b, q) => {
    const crouch = q < 0.3 ? 1.3 * smooth(0, 0.28, q) : q < 0.4 ? 1.3 * (1 - smooth(0.3, 0.4, q)) : q > 0.78 ? 1.0 * Math.sin(Math.PI * (q - 0.78) / 0.22) : 0;
    const air = q > 0.32 && q < 0.78 ? Math.sin(Math.PI * (q - 0.32) / 0.46) : 0;
    P.hips.t = [0, 0, 4.0 * air - crouch];
    P.spine.s = [1 + 0.1 * crouch, 1 + 0.1 * crouch, 1 - 0.12 * crouch + 0.08 * air];
    P.head.r = [0.25 * crouch - 0.15 * air, 0, 0];
    for (const sd of [-1, 1]) { arm(P, sd, -0.9 + 2.3 * air - 0.3 * crouch, 0.2, 0.3); leg(P, sd, crouch); }
    P.footL.r[0] += 0.5 * air; P.footR.r[0] += 0.5 * air;
    antenna(P, TAU * q - 1.5 - Math.PI / 2, 0.5 * b, 0.9);
    P.eyeL.s = [1, 1, 1 + 0.15 * air]; P.eyeR.s = [1, 1, 1 + 0.15 * air];
  } },
  { name: 'SHIMMY', seconds: 4, beats: 16, pose: (P, s, b) => {
    const drop = 0.5 + 0.25 * (0.5 - 0.5 * Math.cos(2 * b));
    P.hips.t = [0, 0, -drop]; P.hips.r = [-0.14, 0, 0.1 * Math.sin(b / 4)];
    P.spine.r = [0, 0.06 * Math.sin(2 * b), 0.2 * Math.sin(b)];
    P.head.r = [-0.1 + 0.12 * Math.sin(b / 2), 0, -0.1 * Math.sin(b)];
    arm(P, 1, -0.15 + 0.18 * Math.sin(b), 0.3, 0.9 + 0.2 * Math.sin(b)); arm(P, -1, -0.15 + 0.18 * Math.sin(b + Math.PI), 0.3, 0.9 + 0.2 * Math.sin(b));
    leg(P, 1, drop, 0, 0, -0.1 * Math.sin(b / 4)); leg(P, -1, drop, 0, 0, -0.1 * Math.sin(b / 4));
    P.ant1.r = [0.45, 0, TAU * s * 4]; P.ant2.r = [0.2, 0, 0]; P.tip.r = [0.15 * Math.sin(b), 0, 0];
    blink(P, bump(s, 0.5, 0.03));
  } },
];

const LOCAL = new Map(PIP.map((b) => [b.name, localOf(b)]));
/** scale, then rotation about x, y, z, then the joint's place */
function jointMatrix(name: string, j: Joint): M4 {
  const m = mul(mul(rotX(j.r[0]), rotY(j.r[1])), rotZ(j.r[2])), t = add(LOCAL.get(name)!, j.t), s = j.s;
  return [m[0] * s[0], m[1] * s[0], m[2] * s[0], 0, m[4] * s[1], m[5] * s[1], m[6] * s[1], 0, m[8] * s[2], m[9] * s[2], m[10] * s[2], 0, t[0], t[1], t[2], 1];
}

/** one dance as an animation file: every animated bone's matrix keys, 24 a second of the loop, the last equal to
 *  the first */
function danceFile(d: Dance): XFile {
  const n = d.seconds * 24, keys: number[][][] = ANIMATED.map(() => []);
  for (let k = 0; k <= n; k++) {
    const s = (k / n) % 1, P = restPose();
    d.pose(P, s, TAU * d.beats * s, (d.beats * s) % 1);
    const t = Math.round((k / n) * d.seconds * RATE * 1000);
    ANIMATED.forEach((name, i) => keys[i].push([t, ...jointMatrix(name, P[name])]));
  }
  const animations: XAnimation[] = ANIMATED.map((name, i) => ({ name: null, frame: name, keys: [{ type: 4, keys: keys[i] }] }));
  return { frames: [], animationSets: [{ name: d.name.toLowerCase(), animations }] };
}

// ============================================================================================ Maxx's Kingdom
// The blob's model units: 0.0045 of the world's; its centre (-0.2, -0.6, 88) lands at the camera's target.
const BLOB_C: V3 = [-0.2, -0.6, 88], BLOB_R = 135, BNA = 36, BNP = 22;
const HORNS: V3[] = [norm([-0.42, 0.05, 0.9]), norm([0.42, 0.05, 0.9])];
const SPIKES: V3[] = [];
for (let k = 0; k < 14; k++) { const r = prng(500 + k); SPIKES.push(norm(k < 6 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0.3], [0, 0, 1], [0, 0, -1]][k] as V3 : [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1])); }

/** the rest shape: a gumdrop, flatter underneath, two soft horns */
function blobRest(d: V3): V3 {
  let p: V3 = [d[0] * BLOB_R, d[1] * BLOB_R * 0.94, d[2] * BLOB_R * (d[2] < 0 ? 0.82 : 1.04)];
  for (const h of HORNS) { const k = Math.max(0, dot(d, h) - 0.9) / 0.1; p = add(p, scale(h, BLOB_R * 0.34 * k * k)); }
  return p;
}
interface Morph { name: string; seconds: number; keys: number; at: (d: V3, p: V3, s: number) => V3 }
const env = (s: number): number => Math.sin(Math.PI * s);
const MORPHS: Morph[] = [
  { name: 'WOBBLE', seconds: 28, keys: 8, at: (d, p, s) => {
    const al = Math.atan2(d[0], -d[1]), ph = Math.acos(clamp(d[2], -1, 1));
    return scale(p, 1 + env(s) * 0.13 * Math.sin(3 * al + 2 * ph - TAU * 2 * s) * Math.sin(ph));
  } },
  { name: 'SPIKES', seconds: 24, keys: 8, at: (d, p, s) => {
    let k = 0;
    for (const sp of SPIKES) { const x = Math.max(0, dot(d, sp) - 0.86) / 0.14; k += x * x; }
    return scale(p, 1 + env(s) ** 2 * 0.55 * k);
  } },
  { name: 'TWIST', seconds: 30, keys: 8, at: (d, p, s) => {
    const a = env(s) * 1.3 * (p[2] / BLOB_R), c = Math.cos(a), sn = Math.sin(a), st = 1 + 0.22 * Math.sin(TAU * s), w = 1 / Math.sqrt(st);
    return [(p[0] * c - p[1] * sn) * w, (p[0] * sn + p[1] * c) * w, p[2] * st];
  } },
  { name: 'STAR', seconds: 30, keys: 8, at: (d, p, s) => {
    const al = Math.atan2(d[0], -d[1]), k = 1 + env(s) * 0.4 * Math.cos(5 * (al - 0.8 * s)) * Math.sqrt(1 - d[2] * d[2]);
    return [p[0] * k, p[1] * k, p[2] * (1 - 0.25 * env(s))];
  } },
  { name: 'BOUNCE', seconds: 20, keys: 12, at: (d, p, s) => {
    const q = Math.sin(TAU * 2 * s), st = 1 + 0.3 * q, w = 1 / Math.sqrt(st), lift = BLOB_R * 0.45 * Math.max(0, q);
    return [p[0] * w, p[1] * w, p[2] * st + lift];
  } },
];

function blobKey(m: Morph, s: number): XFile {
  const b = new Builder();
  b.grid(BNA, BNP, (i, j) => {
    const d = dirOf((i / BNA - 0.5) * TAU, (j / BNP) * Math.PI);
    return b.v(add(BLOB_C, m.at(d, blobRest(d), s)), i / BNA, j / BNP);
  }, 0, () => BLOB_C);
  return { frames: [{ name: 'blob', matrix: ident(), meshes: [b.mesh('blob', [material('JPG_BLOBBY_SKIN', 30)])], children: [] }], animationSets: [] };
}

/** the blob's skin: marbled violet, magenta, teal and gold, a lighter belly, gold horn tips, a face */
function blobTex(): Image {
  const S = 256;
  const PAL: RGB[] = [[120, 50, 190], [220, 70, 170], [40, 180, 200], [240, 190, 70], [120, 50, 190]];
  const eyes = [-1, 1].map((sd) => [dirOf(sd * 0.33, 1.2), dirOf(sd * 0.31, 1.24), dirOf(sd * 0.29, 1.19)]), belly = norm([0, -1, -0.5]);
  const N = 128, T = new Float32Array((N + 1) * (N + 1));           // the marbling, on a coarse grid
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const d = dirOf((i / N - 0.5) * TAU, (j / N) * Math.PI), w = fbm(d[0] * 1.5, d[1] * 1.5, d[2] * 1.5, 3, 121);
    T[j * (N + 1) + i] = (fbm(d[0] * 2 + w * 1.5, d[1] * 2 + w, d[2] * 2 - w, 4, 122) * 0.5 + 0.5) * 3.999;
  }
  return paint(S, S, (x, y, o) => {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, d = dirOf((u - 0.5) * TAU, v * Math.PI);
    const gx = u * N, gy = v * N, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, a = j * (N + 1) + i;
    const t0 = T[a] + (T[a + 1] - T[a]) * fx, t1 = T[a + N + 1] + (T[a + N + 2] - T[a + N + 1]) * fx, t = t0 + (t1 - t0) * fy;
    put(o, PAL[Math.floor(t)]); toward(o, PAL[Math.floor(t) + 1], smooth(0, 1, t % 1));
    times(o, 0.85 + 0.25 * Math.abs(Math.sin(t * 5)));
    toward(o, BELLY, (1 - smooth(0.7, 0.95, angle(d, belly))) * 0.6);
    for (const h of HORNS) toward(o, HORN, smooth(0.93, 0.97, dot(d, h)));
    for (const [white, pupil, shine] of eyes) {       // eyes
      if (dot(d, white) < 0.98) continue;
      toward(o, WHITE, 1 - smooth(0.16, 0.18, angle(d, white)));
      toward(o, PUPIL, 1 - smooth(0.085, 0.1, angle(d, pupil)));
      toward(o, WHITE, 1 - smooth(0.02, 0.035, angle(d, shine)));
    }
    const al = (u - 0.5) * TAU, ph = v * Math.PI;    // a small smile
    if (Math.abs(al) < 0.32) {
      const c = 1.6 + 0.12 * (1 - (al / 0.32) ** 2);
      toward(o, MOUTH, 1 - smooth(0.02, 0.035, Math.abs(ph - c)));
    }
  });
}

const PUPIL: RGB = [20, 10, 40], BELLY: RGB = [250, 214, 236], HORN: RGB = [255, 210, 90], MOUTH: RGB = [60, 10, 50];

// ========================================================================================= Undersea Wonders
// The jelly's model units: about 0.001 of the world's. Built about its own centre (Z up) and moved so that the
// preset's transform puts that centre at the character's origin, about which it turns.
const JELLY_AT: V3 = [-99.2, -4.19, -170.9];
const JNA = 32;
function jellyKey(s: number): XFile {
  const b = new Builder(), w = TAU * s, c = 0.5 - 0.5 * Math.cos(w);
  const at = (p: V3): V3 => add(p, JELLY_AT);
  const bell = (al: number, ph: number, k: number, kz: number): V3 => {
    const rim = smooth(1.2, 1.75, ph), lobe = 1 + 0.07 * Math.abs(Math.cos(4 * al)) * rim;
    const r = 250 * k * Math.sin(ph) * lobe * (1 - 0.17 * c) * (1 - 0.12 * c * rim);
    return [r * Math.sin(al), -r * Math.cos(al), 30 + 190 * kz * Math.cos(ph) * (1 + 0.14 * c) - 18 * rim * Math.abs(Math.sin(4 * al))];
  };
  for (const [k, kz, v0] of [[1, 1, 0], [0.8, 0.62, 0.25]]) {        // the bell and the inner bell
    b.grid(JNA, 10, (i, j) => b.v(at(bell((i / JNA) * TAU, (j / 10) * 1.75, k, kz)), i / JNA, v0 + (j / 10) * 0.25), 0, () => at([0, 0, 0]));
  }
  for (let g = 0; g < 4; g++) {                       // gonads
    const a = (g / 4) * TAU + Math.PI / 4;
    ellipsoid(b, at([Math.sin(a) * 74 * (1 - 0.1 * c), -Math.cos(a) * 74 * (1 - 0.1 * c), 85 + 10 * c]), [38, 38, 26], 10, 6, 0);
  }
  for (let k = 0; k < 4; k++) {                       // frilled oral arms
    const a0 = (k / 4) * TAU;
    tube(b, (l) => {
      const a = a0 + 0.9 * l + 0.4 * Math.sin(w - 2.5 * l), r = 26 + 54 * l;
      return at([r * Math.sin(a), -r * Math.cos(a), 25 - l * 400 * (1 - 0.08 * c)]);
    }, (l) => 18 * (1 - 0.65 * l) * (1 + 0.35 * Math.sin(l * 40 + k)), 5, 18, 0, undefined, 0.5, 0.75, 2);
  }
  for (let k = 0; k < 12; k++) {                      // beaded tentacles from the rim
    const a0 = ((k + 0.5) / 12) * TAU;
    const root = bell(a0, 1.72, 1, 1);
    tube(b, (l) => {
      const ra = hyp(root[0], root[1]) * (1 + 0.12 * l) + 32 * l ** 1.5 * Math.sin(w - 4 * l + k);
      const a = a0 + 0.12 * l ** 1.3 * Math.cos(w - 4 * l + 2 * k);
      return at([ra * Math.sin(a), -ra * Math.cos(a), root[2] - l * 580 * (1 - 0.06 * c)]);
    }, (l) => 8 * (1 - 0.5 * l), 4, 16, 0, undefined, 0.75, 1);
  }
  return { frames: [{ name: 'jelly', matrix: ident(), meshes: [b.mesh('jelly', [material('TGA_JELLY_SKIN', 50)])], children: [] }], animationSets: [] };
}

/** the jelly's texture (alpha only matters: the preset colours it by its lighting): meridian stripes over the
 *  bells, a rim band, beads along the arms and tentacles */
const jellyTex = (): Image => paint(128, 128, (x, y, o) => {
  const u = (x + 0.5) / 128, v = (y + 0.5) / 128;
  o[0] = 255; o[1] = 255; o[2] = 255;
  if (v < 0.5) {
    const m = 0.5 + 0.5 * Math.cos(u * TAU * 16), bv = (v % 0.25) / 0.25;
    o[3] = 255 * (0.35 + 0.4 * m * smooth(0.1, 0.5, bv) + 0.5 * smooth(0.8, 0.95, bv));
  } else o[3] = 255 * (0.3 + 0.7 * smooth(0.3, 0.9, Math.sin(v * 140) * 0.5 + 0.5));
}, true);

// ------------------------------------------------------------------------------------------------- BEH files
const fmt = (x: number): string => (Math.abs(x) < 5e-5 ? '0' : x.toFixed(4));
/** a path of n spline segments through fn(s), s in [0, 1], with fn's own tangents */
function behPath(name: string, mode: 'LOOP' | 'CLAMP', fn: (s: number) => V3, n: number): string {
  const lines = [`PATH ${name} ${mode}`];
  const tan = (s: number): V3 => {
    const a = Math.max(0, s - 1e-4), b = Math.min(1, s + 1e-4);
    return scale(sub(fn(b), fn(a)), 1 / ((b - a) * n));
  };
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n;
    lines.push('SEG SPLINE ' + [...fn(s0), ...tan(s0), ...fn(s1), ...tan(s1)].map(fmt).join(' '));
  }
  lines.push('ENDPATH');
  return lines.join('\n');
}
const circleXY = (): string => behPath('CircleXY', 'LOOP', (s) => [Math.cos(TAU * s), Math.sin(TAU * s), 0], 8);

/** a point around the y axis: angle (from +z towards +x), radius, height */
type Cyl = readonly [number, number, number];
/** the camera of Munch and Maxx's Kingdom (both walk CAMERA_GRAPH, looking at (0, 0.3, 0)): hubs where paths
 *  meet, each path a swing around the target from one hub to the next; the eye stays inside the sky box */
function cameraBEH(rk: number, yk: number, title: string): string {
  const H: Cyl = [0, 2.2, 0.75], L: Cyl = [0.75, 1.75, 0.15], M: Cyl = [1.9, 2.05, 1.2], N: Cyl = [-0.75, 1.8, 0.3], O: Cyl = [-1.9, 2.0, 1.35];
  const J: Cyl = [2.75, 2.3, 1.5], K: Cyl = [-2.6, 2.45, 0.35], Q: Cyl = [0.45, 1.25, 2.3], P: Cyl = [-0.45, 1.15, 2.55];
  const S: Cyl = [-0.6, 1.55, -0.12], R: Cyl = [0.6, 1.45, -0.05], F: Cyl = [-3.1, 2.4, 4.7];
  // [from, to, extra turn, height bump, radius bump] for CamPath00 .. CamPath26
  const P27: [Cyl, Cyl, number, number, number][] = [
    [F, H, 0, 0, 0], [H, L, 0, 0, 0], [L, M, 0, 0.35, 0.2], [M, L, 0, -0.3, 0], [M, H, 0, 0.2, 0],
    [H, N, 0, 0, 0], [N, O, 0, 0.35, 0.2], [O, N, 0, -0.3, 0], [O, H, 0, 0.2, 0],
    [H, J, 0, 0.3, 0], [J, H, TAU, 0, 0], [H, J, -TAU, 0.8, 0], [J, H, 0, -0.5, 0], [H, H, TAU, 1.2, 0.3],
    [P, H, 0, 0, 0], [Q, P, 0, 0.2, -0.4], [P, Q, 0, 0, 0], [H, Q, 0, 0, 0],
    [R, H, 0, 0, 0], [S, R, 0, -0.05, 0.3], [R, S, 0, 0.1, 0], [H, S, 0, 0, 0],
    [K, H, -TAU, 0, 0], [H, K, 0, 0.3, 0], [K, H, 0, 0.4, 0], [H, K, TAU, 0.6, 0], [H, H, -TAU, 0.9, -0.2],
  ];
  const out = [`# ${title}: the light's circle and the camera's 27 paths (eye positions)`, circleXY()];
  P27.forEach(([a, b, turn, bump, rb], k) => {
    out.push(behPath('CamPath' + String(k).padStart(2, '0'), 'CLAMP', (s) => {
      const e = mix(s, s * s * (3 - 2 * s), 0.5), hb = Math.sin(Math.PI * e);
      const th = mix(a[0], b[0] + turn, e), r = (mix(a[1], b[1], e) + rb * hb) * rk, y = mix(a[2], b[2], e) + bump * hb + yk;
      return [r * Math.sin(th), y, r * Math.cos(th)];
    }, k === 13 || k === 26 ? 12 : 8));
  });
  return out.join('\n') + '\n';
}

/** Undersea's camera (JELLY_GRAPH: paths 0-7 lead from one hub to the other, 8-15 back; the eye is 1.5 times the
 *  path's point, looking at the origin): half circles at radius 1.68 in planes turned about the hubs' axis, eased
 *  to rest at each hub; never straight above or below, where the preset's up vector fails */
function jellyBEH(): string {
  const r = 1.68, y0 = 0.12;
  const A = [15, 55, 125, 165, 195, 235, 305, 345], B = [0, 35, 145, 180, 215, 240, 300, 325];
  const out = ['# Undersea Wonders: the light\'s circle and the camera\'s 16 paths', circleXY()];
  for (let k = 0; k < 16; k++) {
    const phi = ((k < 8 ? A[k] : B[k - 8]) * Math.PI) / 180, sign = k < 8 ? 1 : -1;
    out.push(behPath('CamPath' + String(k).padStart(2, '0'), 'CLAMP', (s) => {
      const e = s * s * (3 - 2 * s), q = Math.sin(Math.PI * e);
      return [r * q * Math.cos(phi), y0 + r * q * Math.sin(phi) * 0.85, sign * r * Math.cos(Math.PI * e)];
    }, 8));
  }
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------------ all
export function makePlus3DArt(): Plus3DAssets {
  const xfiles: Record<string, XFile> = {}, textures: Record<string, Image> = {};
  // Munch: Pip and its dances
  xfiles.X_MUNCH_PIP = pipModel();
  for (const d of DANCES) xfiles['MAF_MUNCH_' + d.name] = danceFile(d);
  textures.JPG_MUNCH_PIP_SKIN = pipSkinTex(); textures.JPG_MUNCH_PIP_LIMB = pipLimbTex();
  textures.JPG_MUNCH_PIP_EYE = pipEyeTex(); textures.JPG_MUNCH_PIP_BULB = pipBulbTex();
  munchSky(textures);
  // Maxx's Kingdom: the blob's morphs, a keyframe file each
  for (const m of MORPHS) for (let k = 0; k <= m.keys; k++) xfiles[`X_BLOBBY_${m.name}${String(k).padStart(4, '0')}`] = blobKey(m, (k / m.keys) % 1);
  textures.JPG_BLOBBY_SKIN = blobTex();
  blobbySky(textures);
  // Undersea Wonders: the jelly's pulse
  const JK = 10;
  for (let k = 0; k <= JK; k++) xfiles[`X_JELLY_PULSE${String(k).padStart(4, '0')}`] = jellyKey((k / JK) % 1);
  textures.TGA_JELLY_SKIN = jellyTex();
  jellySky(textures);
  const text: Record<string, string> = {
    ANL_MUNCH: ['munch', 'matrix', 'X_MUNCH_PIP', ...DANCES.map((d) => 'MAF_MUNCH_' + d.name)].join('\n') + '\n',
    ANL_BLOBBY: ['blobby', 'vertex', ...MORPHS.map((m) => `X_BLOBBY_${m.name} ${m.seconds}`)].join('\n') + '\n',
    ANL_JELLY: ['jelly', 'vertex', 'X_JELLY_PULSE 36'].join('\n') + '\n',
    BEH_MUNCH: cameraBEH(0.85, 0, 'Oddworld: Munch\'s Oddysee'),
    BEH_BLOBBY: cameraBEH(1.05, 0.05, 'Maxx\'s Kingdom'),
    BEH_JELLY: jellyBEH(),
  };
  return { xfiles, textures, text };
}

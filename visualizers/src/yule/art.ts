// Our own fireplace for the public build of Yule Log. The DLL's are photographs, flame images, turbulence maps and
// two modelled keyframes (./assets.ts); none of that ships here. Everything below is drawn and modelled by code,
// deterministically (a seeded generator, no Math.random), at the sizes and roles the engine expects:
//   - walls: a brick firebox (sooty buff firebrick at the back, red brick at the sides) lit from below by the
//     fire, and a hearth floor of flat pavers under ash, glowing where the embers lie;
//   - bricks, stone, iron: small patches of each (the iron also dresses the grate);
//   - logs: bark around the cylinder (furrowed oak, cherry, birch, a split stick, plated pine) in the top three
//     quarters of each image, two end-grain discs with growth rings and checks below; the "b" images are the same
//     logs burnt black with glowing cracks, which the engine fades in with the music;
//   - embers: a bed of charcoal lumps with glowing seams, hot coals, and ash;
//   - flames: tongues rising from the bottom edge on black, alpha = density, white-yellow core to red edges;
//   - turbulence: three independent smooth tileable noise fields per map (B, G, R), centred on 128;
//   - the scene: four walls, an iron grate, a mound of embers with lumps and a charred stick, five logs in three
//     frames, and four upright flame quads, in the frame order and render types the engine draws.
import type { Image, XFrame, YuleAssets } from './assets';
import type { XMaterial, XMesh } from './d3dx';

// ------------------------------------------------------------------------------------------------ small tools
const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

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
/** an integer hash of (a, b, seed) to [0, 1): per-brick and per-cell randomness */
function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Colours are worked in place on the pixel being painted (paint's o: r, g, b, a), so nothing is allocated per pixel.
type RGB = readonly [number, number, number];
type Px = Float64Array;
const put = (o: Px, c: RGB): void => { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; };
/** o moves towards c by t */
const toward = (o: Px, c: RGB, t: number): void => { o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; };
const times = (o: Px, k: number): void => { o[0] *= k; o[1] *= k; o[2] *= k; };

/** a w x h image painted pixel by pixel: fn(x, y, o) leaves r, g, b, a (0..255) in o */
function paint(w: number, h: number, fn: (x: number, y: number, o: Float64Array) => void): Image {
  const bgra = new Uint8Array(w * h * 4), o = new Float64Array(4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    o[3] = 255;
    fn(x, y, o);
    bgra[i] = clamp(o[2], 0, 255); bgra[i + 1] = clamp(o[1], 0, 255); bgra[i + 2] = clamp(o[0], 0, 255); bgra[i + 3] = clamp(o[3], 0, 255);
  }
  return { w, h, bgra };
}

/** tileable value noise over a w x h grid: cx x cy lattice cells, octaves doubling the cells, about [-1, 1] */
function fbm(w: number, h: number, cx: number, cy: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(w * h), r = prng(seed);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = cx << o, ny = cy << o, lat = new Float32Array(nx * ny);
    for (let i = 0; i < lat.length; i++) lat[i] = r() * 2 - 1;
    const x0 = new Int32Array(w), x1 = new Int32Array(w), fx = new Float32Array(w);
    for (let x = 0; x < w; x++) { const g = (x / w) * nx, i = Math.floor(g); x0[x] = i % nx; x1[x] = (i + 1) % nx; fx[x] = smooth(0, 1, g - i); }
    for (let y = 0; y < h; y++) {
      const g = (y / h) * ny, j = Math.floor(g), fy = smooth(0, 1, g - j), r0 = (j % ny) * nx, r1 = ((j + 1) % ny) * nx;
      for (let x = 0, i = y * w; x < w; x++, i++) {
        const a0 = lat[r0 + x0[x]], b0 = lat[r1 + x0[x]], t = fx[x];
        const a = a0 + (lat[r0 + x1[x]] - a0) * t, b = b0 + (lat[r1 + x1[x]] - b0) * t;
        out[i] += amp * (a + (b - a) * fy);
      }
    }
    norm += amp; amp *= gain;
  }
  const k = 1.7 / norm;                                 // a sum of octaves narrows; stretch back towards [-1, 1]
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i] * k, -1, 1);
  return out;
}

/** tileable cellular noise: one jittered point per cell (nx x ny cells), distances in cell units to the nearest
 *  (f1) and second nearest (f2) point, and the nearest cell's id */
function cells(w: number, h: number, nx: number, ny: number, seed: number): { f1: Float32Array; f2: Float32Array; id: Int32Array } {
  const f1 = new Float32Array(w * h), f2 = new Float32Array(w * h), id = new Int32Array(w * h);
  const px = new Float32Array(nx * ny), py = new Float32Array(nx * ny), r = prng(seed);
  for (let i = 0; i < nx * ny; i++) { px[i] = 0.1 + 0.8 * r(); py[i] = 0.1 + 0.8 * r(); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = ((x + 0.5) / w) * nx, gy = ((y + 0.5) / h) * ny, ix = Math.floor(gx), iy = Math.floor(gy);
    let d1 = 99, d2 = 99, best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, c = ((cy + ny) % ny) * nx + ((cx + nx) % nx);
      const ex = cx + px[c] - gx, ey = cy + py[c] - gy, d = ex * ex + ey * ey;
      if (d < d1) { d2 = d1; d1 = d; best = c; } else if (d < d2) d2 = d;
    }
    const i = y * w + x;
    f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); id[i] = best;
  }
  return { f1, f2, id };
}

/** o += k * the glow ramp of fire and coals at t: 0 black, through deep red and orange, to yellow-white at 1 */
function addHeat(o: Px, t: number, k = 1): void {
  t = clamp(t);
  o[0] += k * 255 * clamp(t * 1.9); o[1] += k * 255 * clamp(t * 1.9 - 0.55) ** 1.2; o[2] += k * 255 * clamp(t * 2.2 - 1.3);
}

// ---------------------------------------------------------------------------------------------------- walls
const COURSE = 0.075, BRICK = 0.23, JOINT = 0.011;     // metres: a course of brick, a brick's length, a mortar joint

/** the noise the brick walls share (tileable: each wall reads it shifted) */
interface WallNoise { S: number; fine: Float32Array; blot: Float32Array; mor: Float32Array }
const wallNoise = (S: number): WallNoise =>
  ({ S, fine: fbm(S, S, S / 10, S / 10, 2, 1), blot: fbm(S, S, 6, 6, 3, 2), mor: fbm(S, S, S / 16, S / 16, 2, 3) });

/** brick in running bond over a wall mw x mh metres (courses counted up from the floor line), each pixel then lit:
 *  shade(u, v, s) leaves in s the light, the soot and the fire's glow at that image position */
function brickWall(N: WallNoise, mw: number, mh: number, palette: readonly RGB[], seed: number,
  shade: (u: number, v: number, s: Px) => void): Image {
  const S = N.S, sh = new Float64Array(3), dx = (seed * 197) % S, dy = (seed * 131) % S;
  return paint(S, S, (x, y, o) => {
    const i = ((y + dy) % S) * S + ((x + dx) % S), u = (x + 0.5) / S, v = (y + 0.5) / S;
    const my = (1 - v) * mh, course = Math.floor(my / COURSE), ly = my - course * COURSE;
    const mx = u * mw + (course % 2 ? BRICK / 2 : 0) + hash(course, 7, seed) * 0.02, bx = Math.floor(mx / BRICK), lx = mx - bx * BRICK;
    if (lx < JOINT || ly < JOINT) {                     // mortar, a little darker where it meets the brick above
      const m = 92 + 22 * N.mor[i] - (ly < JOINT && ly > JOINT * 0.6 ? 18 : 0);
      o[0] = m; o[1] = m * 0.95; o[2] = m * 0.88;
    } else {
      put(o, palette[Math.floor(hash(bx, course, seed) * palette.length)]);
      const edge = Math.min(lx - JOINT, BRICK - lx, ly - JOINT, COURSE - ly);
      times(o, (0.85 + 0.3 * hash(bx, course, seed + 9)) * (1 + 0.12 * N.fine[i] + 0.1 * N.blot[i]) * (0.8 + 0.2 * smooth(0, 0.006, edge)));
    }
    shade(u, v, sh);
    times(o, sh[0] * (1 - clamp(sh[1] + 0.15 * N.blot[i]) * 0.88));
    o[0] += 70 * sh[2]; o[1] += 26 * sh[2]; o[2] += 6 * sh[2];
  });
}

const RED_BRICK: RGB[] = [[150, 66, 44], [128, 56, 38], [168, 84, 52], [112, 50, 36], [158, 98, 70]];
const FIREBRICK: RGB[] = [[186, 150, 108], [170, 132, 92], [200, 166, 122], [160, 120, 86]];
/** the fire's light on a wall: a glow around (fu, fv) in image coordinates, with spreads su, sv */
const fireLight = (u: number, v: number, fu: number, fv: number, su: number, sv: number): number =>
  Math.exp(-((u - fu) ** 2) / su - ((v - fv) ** 2) / sv);

/** the back wall (FRT.JPG): firebrick blackened by smoke above the fire */
const backWall = (N: WallNoise): Image => brickWall(N, 0.88, 0.675, FIREBRICK, 11, (u, v, s) => {
  const g = fireLight(u, v, 0.5, 0.88, 0.09, 0.1);
  s[0] = 0.35 + 0.75 * g;
  s[1] = (0.45 + 0.5 * Math.exp(-(((u - 0.5) / 0.3) ** 2)) * (1.1 - 0.5 * v)) * (1 - 0.4 * g);
  s[2] = 0.5 * g;
});
/** a side wall (LFT.JPG, RGT.JPG): red brick, lit on the fire's side; fu is where the fire stands across it, back
 *  where the back wall meets it */
const sideWall = (N: WallNoise, fu: number, back: number, seed: number): Image => brickWall(N, 0.65, 0.675, RED_BRICK, seed, (u, v, s) => {
  const g = fireLight(u, v, fu, 0.9, 0.12, 0.16);
  s[0] = 0.3 + 0.7 * g;
  s[1] = (0.2 + 0.45 * (1 - Math.abs(u - back))) * (1.05 - v) * (1 - 0.5 * g);
  s[2] = 0.3 * g;
});

/** the hearth floor (BOT.JPG): flat pavers in stack bond under ash and charcoal crumbs, the embers' glow in the
 *  middle; u runs left to right, v from the back wall to the front */
function hearth(): Image {
  const S = 512, ash = fbm(S, S, 6, 6, 3, 21), speck = fbm(S, S, 128, 128, 1, 22), grit = fbm(S, S, 40, 40, 2, 23);
  return paint(S, S, (x, y, o) => {
    const i = y * S + x, u = (x + 0.5) / S, v = (y + 0.5) / S;
    const mx = u * 0.88, mz = v * 0.65, px = Math.floor(mx / 0.22), pz = Math.floor(mz / 0.11);
    const k = 0.85 + 0.25 * hash(px, pz, 24) + 0.08 * grit[i];
    if (mx - px * 0.22 < 0.006 || mz - pz * 0.11 < 0.006) { o[0] = 55; o[1] = 50; o[2] = 46; } else { o[0] = 120 * k; o[1] = 92 * k; o[2] = 74 * k; }
    const g = fireLight(u, v, 0.5, 0.46, 0.1, 0.05);                       // under the fire
    const a = 140 + 30 * ash[i] + 12 * grit[i];
    toward(o, [a, a * 0.97, a * 0.93], clamp(0.2 + 0.9 * g + 0.4 * ash[i]) * 0.85);   // ash, thickest under the fire
    if (speck[i] > 0.62 - 0.2 * g) toward(o, [30, 26, 24], 0.75);           // charcoal crumbs
    times(o, 0.45 + 0.6 * fireLight(u, v, 0.5, 0.45, 0.25, 0.2));
    addHeat(o, clamp(g * 1.4 - 0.25) * (0.6 + 0.4 * ash[i]) * 0.75, 0.8);
  });
}

/** STONE.JPG: grey speckled granite */
function stone(): Image {
  const S = 128, a = fbm(S, S, 4, 4, 4, 41), b = fbm(S, S, 64, 64, 1, 42);
  return paint(S, S, (x, y, o) => {
    const i = y * S + x, g = (118 + 30 * a[i] + 26 * b[i]) * (b[i] > 0.5 ? 0.45 : b[i] < -0.6 ? 1.3 : 1);
    o[0] = g; o[1] = g * 0.98; o[2] = g * 0.94;
  });
}
/** IRON.JPG: dark cast iron, pitted, with patches of rust */
function iron(): Image {
  const S = 256, a = fbm(S, S, 8, 8, 4, 51), pit = fbm(S, S, 64, 64, 1, 52), rust = fbm(S, S, 5, 5, 3, 53);
  return paint(S, S, (x, y, o) => {
    const i = y * S + x, g = 48 + 16 * a[i] - (pit[i] > 0.55 ? 22 : 0);
    o[0] = g; o[1] = g * 1.02; o[2] = g * 1.08;
    toward(o, [96 + 20 * a[i], 52, 30], smooth(0.35, 0.75, rust[i]) * 0.7);
  });
}

// ------------------------------------------------------------------------------------------------------ logs
// A log image: bark in rows [0, 0.75) (u around the trunk, v along it: what the cylinders map), end grain in two
// discs of radius 0.115 centred at (0.125, 0.875) and (0.375, 0.875) (the end caps), more bark to their right.
const BARK_V = 0.735, CAP_R = 0.115, CAP_V = 0.875, CAP_U = [0.125, 0.375];

interface Species {
  furrow: RGB; ridge: RGB;     // bark colours: in the cracks, on the ridges
  around: number; along: number; // bark texture cells around and along the trunk
  plates: boolean;             // scaly plates (cellular) rather than long furrows
  birch: boolean;              // pale bark with dark dashes across the trunk
  wood: RGB; late: RGB;        // end grain: early and late wood
  rings: number;
}
const SPECIES: Record<string, Species> = {
  oak: { furrow: [38, 30, 24], ridge: [134, 118, 100], around: 14, along: 2, plates: false, birch: false, wood: [176, 134, 88], late: [128, 88, 56], rings: 14 },
  cherry: { furrow: [44, 26, 18], ridge: [130, 80, 58], around: 22, along: 3, plates: false, birch: false, wood: [190, 128, 90], late: [140, 82, 56], rings: 18 },
  birch: { furrow: [70, 64, 58], ridge: [226, 220, 206], around: 6, along: 2, plates: false, birch: true, wood: [214, 190, 150], late: [176, 148, 108], rings: 10 },
  split: { furrow: [92, 66, 44], ridge: [170, 130, 88], around: 40, along: 1, plates: false, birch: false, wood: [188, 150, 104], late: [140, 104, 66], rings: 12 },
  pine: { furrow: [34, 22, 16], ridge: [146, 88, 58], around: 9, along: 4, plates: true, birch: false, wood: [206, 166, 110], late: [160, 112, 66], rings: 20 },
};

/** a log image, and with burning its "b" version: the log charred to black blocks parted by glowing cracks, the
 *  end rims aglow */
function logImages(S: number, sp: Species, seed: number, burning: boolean): [Image, Image | null] {
  const n1 = fbm(S, S, sp.around, sp.along, 3, seed), n2 = fbm(S, S, 3, 2, 3, seed + 1), fine = fbm(S, S, 64, 32, 1, seed + 2);
  const pl = sp.plates ? cells(S, S, sp.around, sp.along * 3, seed + 3) : null;
  const dash = sp.birch ? fbm(S, S, 3, 40, 2, seed + 5) : null, wob = fbm(S, S, 6, 6, 1, seed + 6);
  const char = new Float32Array(S * S), capR = new Float32Array(S * S).fill(-1);
  const base = paint(S, S, (x, y, o) => {
    const i = y * S + x, u = (x + 0.5) / S, v = (y + 0.5) / S;
    const cap = v < 0.75 ? -1 : Math.abs(u - CAP_U[0]) < CAP_R + 0.008 ? 0 : Math.abs(u - CAP_U[1]) < CAP_R + 0.008 ? 1 : -1;
    const dx = cap < 0 ? 1 : u - CAP_U[cap], dy = v - CAP_V, r = Math.sqrt(dx * dx + dy * dy) / CAP_R;
    if (r < 1.07) {                                     // end grain: rings, darker heart, bark rim, radial checks
      capR[i] = r;
      const ring = 0.5 + 0.5 * Math.sin(r * (1 + 0.06 * wob[i]) * sp.rings * TAU + 0.6 * n2[i]);
      put(o, sp.wood);
      toward(o, sp.late, ring ** 3 * 0.8);
      toward(o, sp.late, 0.35 * (1 - smooth(0, 0.35, r)));
      if (r > 0.15 && Math.abs(Math.sin(Math.atan2(dy, dx) * 3.5 + cap * 1.7 + 0.4 * wob[i])) < 0.04 * r) toward(o, [30, 20, 14], 0.8);
      if (r > 0.88) { put(o, sp.furrow); toward(o, sp.ridge, 0.4); }
      char[i] = smooth(0.6, 1.0, r) * 0.7;
      toward(o, [26, 20, 16], char[i]);
    } else {
      let t: number;                                    // 0 deep in a crack, 1 on a ridge
      if (pl) t = smooth(0.02, 0.18, pl.f2[i] - pl.f1[i]) * (0.75 + 0.25 * hash(pl.id[i], 1, seed));
      else t = clamp(1 - Math.abs(n1[i]) * 1.6) ** 0.7;
      put(o, sp.furrow); toward(o, sp.ridge, t);
      if (dash) {
        if (dash[i] > 0.62) toward(o, [40, 34, 30], 0.85);                   // lenticels across the trunk
        if (n1[i] > 0.7) toward(o, [30, 26, 24], 0.9);                      // black patches
      }
      times(o, 0.9 + 0.1 * fine[i]);
      char[i] = smooth(0.3, 0.9, n2[i] + 0.2 * (1 - t)) * 0.8;               // charred patches, cracks first
      toward(o, [22, 18, 16], char[i]);
    }
  });
  if (!burning) return [base, null];
  const crack = cells(S, S, 12, 9, seed + 4), live = fbm(S, S, 4, 4, 1, seed + 7);
  const glow = paint(S, S, (x, y, o) => {
    const i = y * S + x, j = i * 4, gap = crack.f2[i] - crack.f1[i];
    const on = smooth(-0.3, 0.3, live[i] + 0.6 * char[i]);                   // which stretches of the cracks are alight
    let t = (1 - smooth(0, 0.045, gap)) * on * 0.95 + (1 - smooth(0, 0.2, gap)) * on * 0.3;
    if (capR[i] >= 0) t = Math.max(t * 0.6, smooth(0.72, 0.98, capR[i]) * 0.8);
    const k = 0.3 * (1 - clamp(t * 1.5));                                  // the charcoal between the cracks
    o[0] = base.bgra[j + 2] * k; o[1] = base.bgra[j + 1] * k; o[2] = base.bgra[j] * k;
    addHeat(o, t);
  });
  return [base, glow];
}

// ---------------------------------------------------------------------------------------------------- embers
/** EMBER1/EMBER2 and their b versions: charcoal lumps (n x n cells) with glowing seams; hot makes the lumps
 *  themselves glow */
function emberImages(S: number, n: number, hot: number, seed: number): [Image, Image] {
  const cl = cells(S, S, n, n, seed), a = fbm(S, S, 8, 8, 3, seed + 1);
  const make = (boost: number): Image => paint(S, S, (x, y, o) => {
    const i = y * S + x, seam = 1 - smooth(0, 0.18, cl.f2[i] - cl.f1[i]), lump = hash(cl.id[i], 3, seed);
    const coal = 30 + 26 * a[i] + 20 * lump, t = clamp((seam * 0.85 + hot * lump * (0.6 + 0.4 * a[i])) * boost) * 0.85;
    o[0] = coal; o[1] = coal * 0.92; o[2] = coal * 0.88;
    times(o, 1 - t);
    addHeat(o, t);
  });
  return [make(1), make(1.4)];
}
/** EMBER3: grey ash with a few live sparks */
function ash(): Image {
  const S = 32, a = fbm(S, S, 4, 4, 3, 71), b = fbm(S, S, 16, 16, 1, 72);
  return paint(S, S, (x, y, o) => {
    const i = y * S + x, g = 84 + 34 * a[i];
    o[0] = g; o[1] = g * 0.96; o[2] = g * 0.92;
    addHeat(o, clamp(b[i] * 1.6 - 0.7), 0.9);
  });
}

// ---------------------------------------------------------------------------------------------------- flames
interface Tongue { x: number; w: number; h: number; lean: number }

/** a flame image: tongues standing on the bottom edge (x their centre, w half-width at the base, h height, all as
 *  fractions of the image; lean shifts the tip sideways) over a bed of fire, on black, alpha = density; the top
 *  rows and the side columns are clear, so the engine's clamped, turbulent sampling never reaches an edge of flame */
function flame(S: number, tongues: readonly Tongue[], seed: number): Image {
  const n = fbm(S, S, 6, 6, 3, seed), d = fbm(S, S, 3, 3, 2, seed + 1);
  let lo = 1, hi = 0;
  for (const g of tongues) { lo = Math.min(lo, g.x - g.w * 0.8); hi = Math.max(hi, g.x + g.w * 0.8); }
  return paint(S, S, (x, y, o) => {
    const i = y * S + x, u = (x + 0.5) / S, t = 1 - (y + 0.5) / S;            // t: 0 at the bottom, 1 at the top
    let rho = 0;
    for (const g of tongues) {
      if (t >= g.h) continue;
      const s = t / g.h, cx = g.x + g.lean * s * s + 0.02 * d[i] * s;
      const half = g.w * (1 - s) ** 0.75 * (1 + 0.25 * Math.sin(s * 5 + g.x * 9)) + 0.004;
      const q = Math.abs(u - cx) / half;
      if (q < 1) rho = Math.max(rho, (1 - q * q) * (1 - s ** 2.5));
    }
    rho = Math.max(rho, (1 - smooth(0.02, 0.16, t)) * smooth(lo, lo + 0.06, u) * (1 - smooth(hi - 0.06, hi, u)));
    rho = clamp(rho * (0.85 + 0.45 * n[i]) - 0.08 * Math.max(0, n[i]) * t);
    rho *= smooth(0.0, 0.05, u) * smooth(0.0, 0.05, 1 - u) * (1 - smooth(0.86, 0.95, t));
    const a = smooth(0.02, 0.5, rho);
    o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 255 * Math.sqrt(a);
    if (a > 0) addHeat(o, rho * (1.05 - 0.35 * t) + 0.08);
  });
}

// ------------------------------------------------------------------------------------------------ turbulence
/** a turbulence map: three independent smooth tileable fields in B, G and R, 128 +- about 9 */
function turbulence(S: number, seed: number): Image {
  const f = [0, 1, 2].map((k) => fbm(S, S, S / 32, S / 32, 2, seed + k * 101, 0.45));
  return paint(S, S, (x, y, o) => {
    const i = y * S + x;
    o[2] = 128 + 9 * f[0][i]; o[1] = 128 + 9 * f[1][i]; o[0] = 128 + 9 * f[2][i];      // B, G, R
  });
}

// ---------------------------------------------------------------------------------------------------- meshes
// Geometry is written in world space as the camera sees it: x to the right, y up, z towards the camera (the eye at
// (0, -0.05, 1.02) looking at (0, -0.15, 0)); the floor at y = -0.375, the back wall at z = -0.3. The engine turns
// the model half a turn about y before drawing, so a mesh stores (-x, y, -z): a rotation, so windings survive it.
//
// Winding: the engine culls clockwise (D3DCULL_CW) after a right-handed view and projection, which mirror nothing,
// so a visible triangle is counter-clockwise as the viewer sees it, i.e. its right-hand normal (b - a) x (c - a)
// points towards the viewer. Every triangle goes through tri(), which orders its corners so that this normal
// agrees with the vertex normals (outwards on solids, into the room on the walls, at the camera on the flames).
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

const material = (texture: string): XMaterial =>
  ({ diffuse: [1, 1, 1, 1], power: 51.2, specular: [0, 0, 0], emissive: [1, 1, 1], texture: 'fire\\' + texture });

class Builder {
  private p: number[] = []; private n: number[] = []; private uv: number[] = [];
  private f: number[] = []; private fm: number[] = [];
  constructor(private mats: XMaterial[]) {}
  v(p: V3, n: V3, u: number, v: number): number {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }
  private at(i: number, a: number[]): V3 { return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]; }
  tri(a: number, b: number, c: number, m: number): void {
    const pa = this.at(a, this.p), g = cross(sub(this.at(b, this.p), pa), sub(this.at(c, this.p), pa));
    const want = add(add(this.at(a, this.n), this.at(b, this.n)), this.at(c, this.n));
    if (dot(g, want) >= 0) this.f.push(a, b, c); else this.f.push(a, c, b);
    this.fm.push(m);
  }
  quad(a: number, b: number, c: number, d: number, m: number): void { this.tri(a, b, c, m); this.tri(a, c, d, m); }
  /** the XMesh in model space, faces grouped by material (every material must have faces: the engine pairs the
   *  i-th attribute range with the i-th material) */
  mesh(name: string): XMesh {
    const order = this.fm.map((_, i) => i).sort((x, y) => this.fm[x] - this.fm[y] || x - y);
    const used = new Set(this.fm);
    if (used.size !== this.mats.length) throw new Error(`yule art: ${name} leaves a material without faces`);
    const pos = new Float32Array(this.p.length), nor = new Float32Array(this.n.length);
    for (let i = 0; i < this.p.length; i += 3) {
      pos[i] = -this.p[i]; pos[i + 1] = this.p[i + 1]; pos[i + 2] = -this.p[i + 2];
      nor[i] = -this.n[i]; nor[i + 1] = this.n[i + 1]; nor[i + 2] = -this.n[i + 2];
    }
    return {
      name, positions: pos, normals: nor, uvs: Float32Array.from(this.uv),
      faces: Uint16Array.from(order.flatMap((k) => this.f.slice(k * 3, k * 3 + 3))),
      faceMaterials: Uint32Array.from(order.map((k) => this.fm[k])), materials: this.mats,
    };
  }
}

/** a flat rectangle: corner, the two edge vectors (u along e1, v along e2), facing n */
function rect(b: Builder, o: V3, e1: V3, e2: V3, n: V3, m: number): void {
  const c = (s: number, t: number): number => b.v(add(o, add(scale(e1, s), scale(e2, t))), n, s, t);
  b.quad(c(0, 0), c(1, 0), c(1, 1), c(0, 1), m);
}

/** two unit vectors across an axis */
function across(a: V3): [V3, V3] {
  const e1 = norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [e1, cross(a, e1)];
}

/** a box from 8 corners (corner k = bit 0 along the first edge, bit 1 the second, bit 2 the third), 4 vertices a
 *  face; each face maps the strip v in [v0, v0 + 0.2] of the image */
function box(b: Builder, k: readonly V3[], m: number, ulen: number): void {
  const mid = scale(k.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / 8);
  for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) {
    const p = (axis + 1) % 3, q = (axis + 2) % 3, bit = side << axis;
    const ids = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => bit | (s << p) | (t << q));
    const fc = scale(ids.reduce((s, i) => add(s, k[i]), [0, 0, 0] as V3), 1 / 4), n = norm(sub(fc, mid));
    const v0 = ((axis * 2 + side) % 4) * 0.2 + 0.05;
    const vs = ids.map((i, j) => b.v(k[i], n, j === 1 || j === 2 ? ulen : 0.02, v0 + (j >= 2 ? 0.2 : 0)));
    b.quad(vs[0], vs[1], vs[2], vs[3], m);
  }
}
/** an iron bar of square section t from p0 to p1 */
function bar(b: Builder, p0: V3, p1: V3, t: number, m: number): void {
  const a = sub(p1, p0), [e1, e2] = across(norm(a)), h = t / 2, k: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const c = add(i & 4 ? p1 : p0, add(scale(e1, i & 1 ? h : -h), scale(e2, i & 2 ? h : -h)));
    k.push(c);
  }
  box(b, k, m, clamp(Math.hypot(a[0], a[1], a[2]) * 1.5, 0.1, 0.98));
}

/** a log: a slightly knobbly cylinder of radius r from p0 to p1, bark around it, end grain on the caps */
function log(b: Builder, p0: V3, p1: V3, r: number, m: number, seed: number, cap = 0): void {
  const SEG = 18, RING = 6, rnd = prng(seed), axis = norm(sub(p1, p0)), [e1, e2] = across(axis);
  const bump = Array.from({ length: (RING + 1) * SEG }, () => 1 + 0.07 * (rnd() * 2 - 1));
  const at = (i: number, j: number): [V3, V3] => {
    const t = i / RING, th = (j / SEG) * TAU, dir = add(scale(e1, Math.cos(th)), scale(e2, Math.sin(th)));
    const taper = 1 - 0.12 * (1 - Math.sin(t * Math.PI)) ** 4;
    const rr = r * taper * bump[i * SEG + (j % SEG)];
    return [add(add(p0, scale(sub(p1, p0), t)), scale(dir, rr)), dir];
  };
  const id: number[] = [];
  for (let i = 0; i <= RING; i++) for (let j = 0; j <= SEG; j++) {
    const [p, n] = at(i, j);
    id.push(b.v(p, n, 0.004 + (j / SEG) * 0.992, 0.006 + (i / RING) * (BARK_V - 0.012)));
  }
  for (let i = 0; i < RING; i++) for (let j = 0; j < SEG; j++) {
    const a = i * (SEG + 1) + j;
    b.quad(id[a], id[a + 1], id[a + SEG + 2], id[a + SEG + 1], m);
  }
  for (const [i, n, cu] of [[0, scale(axis, -1), CAP_U[cap]], [RING, axis, CAP_U[1 - cap]]] as [number, V3, number][]) {
    const c = b.v(add(p0, scale(sub(p1, p0), i / RING)), n, cu, CAP_V), ring: number[] = [];
    for (let j = 0; j < SEG; j++) {
      const th = (j / SEG) * TAU;
      ring.push(b.v(at(i, j)[0], n, cu + CAP_R * 0.97 * Math.cos(th), CAP_V + CAP_R * 0.97 * Math.sin(th)));
    }
    for (let j = 0; j < SEG; j++) b.tri(c, ring[j], ring[(j + 1) % SEG], m);
  }
}

const FLOOR = -0.375, BACK = -0.3, FRONT = 0.35, SIDE = 0.44, TOP = 0.3, GRATE = -0.3;

/** the firebox: floor, back, left and right walls (bot, frt, lft, rgt), each one rectangle facing into the room */
function walls(): XMesh {
  const b = new Builder([material('bot.jpg'), material('frt.jpg'), material('lft.jpg'), material('rgt.jpg')]);
  const H = TOP - FLOOR;
  rect(b, [-SIDE, FLOOR, BACK], [2 * SIDE, 0, 0], [0, 0, FRONT - BACK], [0, 1, 0], 0);   // v from the back to the front
  rect(b, [-SIDE, TOP, BACK], [2 * SIDE, 0, 0], [0, -H, 0], [0, 0, 1], 1);
  rect(b, [-SIDE, TOP, FRONT], [0, 0, BACK - FRONT], [0, -H, 0], [1, 0, 0], 2);         // u from the front to the back
  rect(b, [SIDE, TOP, BACK], [0, 0, FRONT - BACK], [0, -H, 0], [-1, 0, 0], 3);          // u from the back to the front
  return b.mesh('walls');
}

/** the grate: front and back rails, cross bars the logs lie on, legs, a row of uprights along the front and two
 *  taller posts at its ends */
function grate(): XMesh {
  const b = new Builder([material('iron.jpg')]), T = 0.014, zf = 0.15, zb = -0.15, xs = 0.31;
  bar(b, [-xs, GRATE, zf], [xs, GRATE, zf], T, 0);
  bar(b, [-xs, GRATE, zb], [xs, GRATE, zb], T, 0);
  for (let k = 0; k < 6; k++) { const x = -0.25 + k * 0.1; bar(b, [x, GRATE + 0.004, zb], [x, GRATE + 0.004, zf], T * 0.8, 0); }
  for (const x of [-xs + 0.02, xs - 0.02]) for (const z of [zf, zb]) bar(b, [x, FLOOR, z], [x, GRATE, z], T, 0);
  for (let k = 0; k < 5; k++) { const x = -0.2 + k * 0.1; bar(b, [x, GRATE, zf], [x, GRATE + 0.075, zf + 0.012], T * 0.75, 0); }
  for (const x of [-xs, xs]) {
    bar(b, [x, FLOOR, zf + 0.01], [x, GRATE + 0.13, zf + 0.01], T * 1.3, 0);
    bar(b, [x, GRATE + 0.13, zf + 0.01], [x, GRATE + 0.155, zf + 0.01], T * 2.2, 0);          // a knob on top
  }
  return b.mesh('iron');
}

/** the embers: a low bumpy mound on the hearth under the grate (ember1), lumps of coal on and around it (ember2,
 *  ember3) and a half-burnt split stick lying in it (log4) */
function embers(): XMesh {
  const b = new Builder([material('ember1.jpg'), material('ember2.jpg'), material('ember3.jpg'), material('log4.jpg')]);
  const R = 7, SEG = 28, rx = 0.33, rz = 0.17, cz = 0.0, top = 0.055, rnd = prng(81);
  const bumps = Array.from({ length: SEG }, () => rnd());
  const id: number[][] = [];
  for (let i = 0; i <= R; i++) {
    id.push([]);
    for (let j = 0; j < (i ? SEG : 1); j++) {
      const r = i / R, th = (j / SEG) * TAU, x = rx * r * Math.cos(th), z = cz + rz * r * Math.sin(th);
      const y = FLOOR + 0.002 + top * (1 - r * r) ** 0.8 * (0.8 + 0.4 * bumps[(j * 7 + i * 3) % SEG]);
      const n = norm([x / rx * 0.4, 1, (z - cz) / rz * 0.4]);
      id[i].push(b.v([x, y, z], n, 0.5 + x / (2 * rx), 0.5 + (z - cz) / (2 * rz)));
    }
  }
  for (let j = 0; j < SEG; j++) b.tri(id[0][0], id[1][j], id[1][(j + 1) % SEG], 0);
  for (let i = 1; i < R; i++) for (let j = 0; j < SEG; j++) {
    const j1 = (j + 1) % SEG;
    b.quad(id[i][j], id[i][j1], id[i + 1][j1], id[i + 1][j], 0);
  }
  for (let k = 0; k < 34; k++) {                        // lumps: jittered boxes
    const th = rnd() * TAU, r = 0.3 + 0.8 * rnd(), s = 0.007 + 0.012 * rnd();
    const x = rx * r * Math.cos(th), z = cz + rz * r * Math.sin(th);
    const y = FLOOR + (r < 1 ? top * (1 - r * r) ** 0.8 * 0.9 : 0) + s * 0.4;
    const corners: V3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push([x + (i & 1 ? s : -s) * (0.8 + 0.4 * rnd()), y + (i & 4 ? s : -s) * (0.5 + 0.3 * rnd()), z + (i & 2 ? s : -s) * (0.8 + 0.4 * rnd())]);
    }
    box(b, corners, k % 3 === 2 ? 2 : 1, 0.9);
  }
  log(b, [-0.27, FLOOR + 0.03, 0.09], [-0.02, FLOOR + 0.022, 0.13], 0.017, 3, 82);
  return b.mesh('embers');
}

/** a flame quad: upright, facing the camera, x0..x1 across, y0..y1 up, at depth z; uv (0, 0) at its top left */
function flameQuad(name: string, tex: string, x0: number, x1: number, y0: number, y1: number, z: number): XMesh {
  const b = new Builder([material(tex)]), n: V3 = [0, 0, 1];
  b.quad(b.v([x0, y1, z], n, 0, 0), b.v([x1, y1, z], n, 1, 0), b.v([x1, y0, z], n, 1, 1), b.v([x0, y0, z], n, 0, 1), 0);
  return b.mesh(name);
}

const frame = (name: string, renderType: number | null, mesh: XMesh): XFrame =>
  ({ name, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], renderType, meshes: [mesh], children: [] });

/** the scene's frames. The engine draws the children in the order walls, iron, embers, log1, Flame4, log2, Flame3,
 *  Flame2, log3, Flame1, and a flame quad writes depth even where it is clear, so each flame stands behind
 *  everything drawn after it: Flame4 furthest back (inside the back log), then Flame3 and Flame2 (inside log2),
 *  log3 in front of them, Flame1 nearest (inside log3). */
function scene(): XFrame[] {
  const on = GRATE + 0.007 + 0.006;                     // the top of the cross bars
  const log1 = new Builder([material('log1.jpg')]);
  log(log1, [-0.34, on + 0.06, -0.085], [0.35, on + 0.06, -0.115], 0.06, 0, 91);
  const log2 = new Builder([material('log2.jpg'), material('log5.jpg')]);
  log(log2, [-0.37, on + 0.048, 0.01], [0.24, on + 0.048, -0.025], 0.048, 0, 92, 1);
  log(log2, [0.02, on + 0.05, -0.035], [0.33, on + 0.17, -0.07], 0.04, 1, 93);
  const log3 = new Builder([material('log3.jpg')]);
  log(log3, [-0.25, on + 0.044, 0.105], [0.31, on + 0.044, 0.085], 0.044, 0, 94, 1);
  return [{
    name: 'fire', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], renderType: null, meshes: [], children: [
      frame('cage', null, walls()),
      frame('Flame1', 2, flameQuad('flame1', 'flame1.tga', -0.15, 0.13, -0.27, 0.0, 0.1)),
      frame('log3', 3, log3.mesh('log3')),
      frame('Flame2', 2, flameQuad('flame2', 'flame2.tga', -0.04, 0.32, -0.27, 0.12, -0.002)),
      frame('Flame3', 2, flameQuad('flame3', 'flame3.tga', -0.32, 0.03, -0.27, 0.07, -0.04)),
      frame('log2', 3, log2.mesh('log2')),
      frame('Flame4', 2, flameQuad('flame4', 'flame4.tga', -0.26, 0.26, -0.27, 0.16, -0.15)),
      frame('log1', 3, log1.mesh('log1')),
      frame('embers', null, embers()),
      frame('iron', null, grate()),
    ],
  }];
}

// ------------------------------------------------------------------------------------------------------ all
export function makeYuleArt(): YuleAssets {
  const [log1, log1b] = logImages(256, SPECIES.oak, 101, true), [log2, log2b] = logImages(256, SPECIES.cherry, 102, true);
  const [log3, log3b] = logImages(128, SPECIES.birch, 103, true), [log4] = logImages(256, SPECIES.split, 104, false);
  const [log5, log5b] = logImages(256, SPECIES.pine, 105, true);
  const [ember1, ember1b] = emberImages(64, 7, 0.15, 111), [ember2, ember2b] = emberImages(64, 5, 0.5, 112);
  const N = wallNoise(512);
  const textures: Record<string, Image> = {
    'FRT.JPG': backWall(N), 'BOT.JPG': hearth(), 'LFT.JPG': sideWall(N, 0.54, 1, 12), 'RGT.JPG': sideWall(N, 0.46, 0, 13),
    'BRICKS.JPG': brickWall(wallNoise(128), 0.46, 0.46, RED_BRICK, 31, (u, v, s) => { s[0] = 1; s[1] = 0; s[2] = 0; }),
    'STONE.JPG': stone(), 'IRON.JPG': iron(),
    'EMBER1.JPG': ember1, 'EMBER2.JPG': ember2, 'EMBER3.JPG': ash(),
    'LOG1.JPG': log1, 'LOG2.JPG': log2, 'LOG3.JPG': log3, 'LOG4.JPG': log4, 'LOG5.JPG': log5,
    'FLAME1.TGA': flame(128, [{ x: 0.36, w: 0.14, h: 0.7, lean: -0.04 }, { x: 0.55, w: 0.16, h: 0.9, lean: 0.03 },
      { x: 0.72, w: 0.11, h: 0.55, lean: 0.06 }], 121),
    'FLAME2.TGA': flame(256, [{ x: 0.22, w: 0.1, h: 0.5, lean: -0.05 }, { x: 0.38, w: 0.14, h: 0.82, lean: -0.02 },
      { x: 0.56, w: 0.15, h: 0.92, lean: 0.03 }, { x: 0.74, w: 0.11, h: 0.62, lean: 0.06 }], 122),
    'FLAME3.TGA': flame(128, [{ x: 0.3, w: 0.13, h: 0.62, lean: -0.06 }, { x: 0.5, w: 0.17, h: 0.92, lean: -0.02 },
      { x: 0.7, w: 0.12, h: 0.7, lean: 0.04 }], 123),
    'FLAME4.TGA': flame(256, [{ x: 0.16, w: 0.08, h: 0.45, lean: -0.04 }, { x: 0.3, w: 0.12, h: 0.75, lean: -0.03 },
      { x: 0.47, w: 0.15, h: 0.95, lean: 0.0 }, { x: 0.64, w: 0.13, h: 0.8, lean: 0.03 }, { x: 0.82, w: 0.08, h: 0.5, lean: 0.05 }], 124),
    'EMBER1b.JPG': ember1b, 'EMBER2b.JPG': ember2b, 'LOG1b.JPG': log1b!, 'LOG2b.JPG': log2b!, 'LOG3b.JPG': log3b!, 'LOG5b.JPG': log5b!,
  };
  const turb: Record<string, Image> = {};
  for (let k = 1; k <= 4; k++) {
    const S = k % 2 ? 128 : 256;                        // as the flame each pair warps
    turb[`TURBX${k}.TGA`] = turbulence(S, 200 + k); turb[`TURBY${k}.TGA`] = turbulence(S, 300 + k);
  }
  const frames = scene();
  return { textures, turbulence: turb, keyframes: [frames, frames] };   // the two keyframes are the same scene
}

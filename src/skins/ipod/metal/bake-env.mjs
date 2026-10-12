// Bakes env.ts, the rendered metal's surroundings (docs/ipod-skin.md §1.7), from ios/icon-studio.hdr
// (Poly Haven, CC0): a daylit room with three windows on the horizon. Run from the repo's root:
//   node src/skins/ipod/metal/bake-env.mjs
// Kept: its luminance only (the dye is the body's only colour) as two maps over the elevations the
// body and the wheel reflect, and the light falling on a matte surface:
// - sharp: blurred by the brushing's narrow lobe along it, for the body and the centre button. The wide
//   lobe across the brushing is the shader's (gl.ts), so its roughness stays a constant there;
// - rough: blurred as the wheel's satin plastic's lobe (RING_SIGMA);
// - sh: the irradiance as nine spherical harmonics (Ramamoorthi and Hanrahan's), the plastic's diffuse.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** the map: W x H texels over azimuth 360° and elevation ±BAND° */
const W = 64, H = 32, BAND = 45;
/** the source's azimuth (its columns, 0-360°) behind the viewer: between the middle and right windows,
 *  so the two reflect either side of the body's centre, as the classic look's two bands */
const BEHIND = 214;
/** the blur, degrees: along the brushing (elevation) the lobe of gl.ts's finish, about twice its alpha
 *  that way (ROUGH² × (1 - ANISO) = .025 rad); across it (azimuth) only enough to smooth between the
 *  shader's reflections, which spread it far wider */
const SIGMA = [3, 8];
/** the flags: from this azimuth, full by this one, leaving this much of the room */
const FLAG = [50, 80, .4];
/** the floor, a studio's sweep: below FLOOR[0]° each azimuth keeps at least the light it has there,
 *  easing to FLOOR[2] of it by FLOOR[1]°. The room's own floor fell to a tenth by -20°, so the phone tipped
 *  a few degrees took the body's lower half off the windows into the dark ("gets way too dark", the owner,
 *  2026-10-06), and the wheel's domes, which reflect further down than the body, were black there */
const FLOOR = [-10, -30, .6];
/** the satin ring's lobe, degrees: GGX at roughness .5 (alpha .25) reflects over about this */
const RING_SIGMA = 15;
/** stored as log2, 8 bits over these stops: 1/64 to 64 times the mean, 3 % a step */
const STOPS = [-6, 6];

const here = fileURLToPath(new URL('.', import.meta.url));
const src = readHdr(here + '../../../../ios/icon-studio.hdr');
const R = Math.PI / 180;

// the source boxed down to 256 x 128 (each texel's luminance and its solid angle), then a Gaussian
// over angle on the sphere for each of the map's texels
const SW = 256, SH = 128, sy = src.H / SH, sx = src.W / SW;
const lum = new Float64Array(SW * SH);
for (let y = 0; y < src.H; y++) for (let x = 0; x < src.W; x++) {
  const i = (y * src.W + x) * 3, d = src.data;
  lum[Math.floor(y / sy) * SW + Math.floor(x / sx)] += (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) / (sx * sy);
}
const map = new Float64Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const el = BAND - (y + .5) / H * 2 * BAND, az = BEHIND + (x + .5) / W * 360 - 180;
  let s = 0, n = 0;
  for (let j = 0; j < SH; j++) {
    const e = 90 - (j + .5) / SH * 180, de = e - el;
    if (Math.abs(de) > 4 * SIGMA[0]) continue;
    const c = Math.cos(e * R);
    for (let i = 0; i < SW; i++) {
      const da = ((((i + .5) / SW * 360 - az) % 360) + 540) % 360 - 180, g = da * c;
      const w = c * Math.exp(-(de * de) / (2 * SIGMA[0] ** 2) - (g * g) / (2 * SIGMA[1] ** 2));
      s += w * lum[j * SW + i]; n += w;
    }
  }
  map[y * W + x] = s / n;
}
// mirrored about the viewer's axis and averaged: the right window is twice the middle one, and the
// classic body is lit evenly from both sides (§1.3); the hand's tilt turns it off the axis
for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) {
  const a = y * W + x, b = y * W + W - 1 - x;
  map[a] = map[b] = (map[a] + map[b]) / 2;
}
// in units of the room's mean over the eye's band (about ±15°), so the shader's exposure reads as a level
let m = 0, k = 0;
for (let y = 0; y < H; y++) { const el = BAND - (y + .5) / H * 2 * BAND; if (Math.abs(el) <= 15) for (let x = 0; x < W; x++) { m += map[y * W + x]; k++; } }
// a product shot's black flags either side (past FLAG[0]° from behind the viewer, full by FLAG[1]°):
// the rounded long edges turn to them and go dark, the classic body's edges (§1.3); without them they
// catch the room's far windows, a bright line down each side
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = Math.abs((x + .5) / W * 360 - 180), t = Math.min(1, Math.max(0, (a - FLAG[0]) / (FLAG[1] - FLAG[0])));
  map[y * W + x] *= 1 - (1 - FLAG[2]) * t * t * (3 - 2 * t);
}
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const flag = (az) => 1 - (1 - FLAG[2]) * smooth((Math.abs(az) - FLAG[0]) / (FLAG[1] - FLAG[0]));
const floor = (el) => 1 - (1 - FLOOR[2]) * smooth((FLOOR[0] - el) / (FLOOR[0] - FLOOR[1]));
/** below the floor's start, each column at least its light there (its row `ref`), eased by floor() */
function fillFloor(a, w, h, elOf) {
  let ref = 0;
  while (elOf(ref + 1) >= FLOOR[0]) ref++;
  for (let y = ref + 1; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.max(a[y * w + x], a[ref * w + x] * floor(elOf(y)));
}
fillFloor(map, W, H, (y) => BAND - (y + .5) / H * 2 * BAND);

// the whole room as the shader sees it (azimuth 0 behind the viewer), at the source's 256 x 128:
// mirrored, flagged, floored, in the same units
const G = new Float64Array(SW * SH), gEl = (j) => 90 - (j + .5) / SH * 180, gAz = (i) => (i + .5) / SW * 360 - 180;
const raw = (az, j) => lum[j * SW + ((Math.floor(((BEHIND + az) % 360 + 360) % 360 / 360 * SW)) % SW)];
for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) G[j * SW + i] = (raw(gAz(i), j) + raw(-gAz(i), j)) / 2 * flag(gAz(i)) / (m / k);
fillFloor(G, SW, SH, gEl);
// the rough map: a Gaussian over angle on the sphere
const rough = new Float64Array(W * H);
const dirOf = (az, el) => [Math.cos(el * R) * Math.sin(az * R), Math.sin(el * R), Math.cos(el * R) * Math.cos(az * R)];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = dirOf((x + .5) / W * 360 - 180, BAND - (y + .5) / H * 2 * BAND);
  let s = 0, n = 0;
  for (let j = 0; j < SH; j++) {
    const c = Math.cos(gEl(j) * R);
    for (let i = 0; i < SW; i++) {
      const e = dirOf(gAz(i), gEl(j)), cos = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
      if (cos < .5) continue;
      const a = Math.acos(Math.min(1, cos)) / R, w = c * Math.exp(-(a * a) / (2 * RING_SIGMA ** 2));
      s += w * G[j * SW + i]; n += w;
    }
  }
  rough[y * W + x] = s / n;
}
// the irradiance: the room's radiance projected on the nine bands' basis, each convolved with the cosine
// (π, 2π/3, π/4 by band); the shader evaluates it over π, a white matte surface's radiance
const sh = new Array(9).fill(0), dw = (2 * Math.PI / SW) * (Math.PI / SH);
for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
  const [x, y, z] = dirOf(gAz(i), gEl(j)), L = G[j * SW + i] * Math.cos(gEl(j) * R) * dw;
  const Y = [.282095, .488603 * y, .488603 * z, .488603 * x, 1.092548 * x * y, 1.092548 * y * z, .315392 * (3 * z * z - 1), 1.092548 * x * z, .546274 * (x * x - y * y)];
  for (let b = 0; b < 9; b++) sh[b] += L * Y[b];
}
const A = [Math.PI, 2 * Math.PI / 3, 2 * Math.PI / 3, 2 * Math.PI / 3, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];
const irr = sh.map((c, b) => +(c * A[b] / Math.PI).toFixed(4));

const enc = (v) => Math.max(0, Math.min(255, Math.round((Math.log2(v) - STOPS[0]) / (STOPS[1] - STOPS[0]) * 255)));
const bytes = new Uint8Array(W * H * 2);
for (let i = 0; i < W * H; i++) { bytes[2 * i] = enc(map[i] * k / m); bytes[2 * i + 1] = enc(rough[i]); }
fs.writeFileSync(here + 'env.ts', `// Baked by bake-env.mjs from ios/icon-studio.hdr (Poly Haven, CC0); not edited by hand.
/** ${W} x ${H} texels, azimuth 0 behind the viewer, elevation +${BAND}° (row 0) to -${BAND}°, two bytes each
 *  (the sharp map, the rough): log2 of the luminance over [${STOPS.join(', ')}] stops in 8 bits. sh: the
 *  irradiance over π as nine spherical harmonics (x, y, z: right, up, toward the viewer) */
export const ENV = { w: ${W}, h: ${H}, band: ${BAND}, stops: [${STOPS.join(', ')}] as const,
  sh: [${irr.join(', ')}] as const,
  data: '${Buffer.from(bytes).toString('base64')}' };
`);
console.log('env.ts:', W, 'x', H, 'x 2,', Buffer.from(bytes).toString('base64').length, 'base64 chars; sh', irr.join(' '));

/** Radiance RGBE, flat or run-length rows, as float RGB */
function readHdr(path) {
  const b = fs.readFileSync(path);
  let p = 0;
  const line = () => { let s = ''; while (b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  while (line() !== '') { /* the header, up to its blank line */ }
  const [, h, , w] = line().split(' ').map(Number);
  const data = new Float32Array(w * h * 3), row = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (b[p] === 2 && b[p + 1] === 2) {
      p += 4;
      for (let c = 0; c < 4; c++) for (let x = 0; x < w;) {
        let n = b[p++];
        if (n > 128) { n -= 128; const v = b[p++]; while (n--) row[(x++) * 4 + c] = v; } else while (n--) row[(x++) * 4 + c] = b[p++];
      }
    } else for (let x = 0; x < w * 4; x++) row[x] = b[p++];
    for (let x = 0; x < w; x++) {
      const e = row[x * 4 + 3], f = e ? 2 ** (e - 136) : 0;
      for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = row[x * 4 + c] * f;
    }
  }
  return { W: w, H: h, data };
}

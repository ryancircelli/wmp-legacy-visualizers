// Our own pictures for the public build of Rhythm and Waves. The DLL draws its floor and its sky and hills with GDI+
// (LinearGradientBrush, PathGradientBrush, anti-aliased, HighQualityBicubic), puts the Windows Media and Microsoft
// logos (PNG files) over them, and decodes a JPEG resource for the particle glow. None of that ships here, and GDI+'s
// arithmetic is not reproduced: these are drawn by our own code from the scene's own numbers (the key colours, the
// hills' Bezier control points and focus, the cover size the DLL scales to), so they follow the same layout, with
// our own mark where the logos were. The engine treats them exactly as it treats the DLL's (mp9.ts Mp9Art).
import type { Mp9Art, Mp9Background } from './mp9';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** BGRA bytes of an 0xRRGGBB lerp */
function mix(o: Uint8Array, i: number, c0: number, c1: number, t: number, a = 0): void {
  o[i] = lerp(c0 & 255, c1 & 255, t); o[i + 1] = lerp((c0 >> 8) & 255, (c1 >> 8) & 255, t);
  o[i + 2] = lerp((c0 >> 16) & 255, (c1 >> 16) & 255, t); o[i + 3] = a;
}

/** 512x512 BGRA top-down: the water's floor, 0x000068 at the top to 0x00ffff at the bottom (sprite 5's colours) */
function floor(): Uint8Array {
  const o = new Uint8Array(512 * 512 * 4);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) mix(o, (y * 512 + x) * 4, 0x000068, 0x00ffff, (y + 0.5) / 512);
  return o;
}

const SS = 4;                                                     // supersampling per axis for the hills' edges
/** the 512x512 picture as straight-alpha 0xAARRGGBB: sky over the top half, the three hills */
function picture(s: Mp9Background): Float32Array {
  const P = new Float32Array(512 * 512 * 4);                       // premultiplied r, g, b, a in 0..1
  // the sky: 0xcc9bc1f7 at the top to 0xff4787c0 at row 256
  for (let y = 0; y < 256; y++) {
    const t = (y + 0.5) / 256, a = lerp(0xcc, 0xff, t) / 255;
    const r = lerp(0x9b, 0x47, t) / 255, g = lerp(0xc1, 0x87, t) / 255, b = lerp(0xf7, 0xc0, t) / 255;
    for (let x = 0; x < 512; x++) { const i = (y * 512 + x) * 4; P[i] = r * a; P[i + 1] = g * a; P[i + 2] = b * a; P[i + 3] = a; }
  }
  for (let k = 0; k < 3; k++) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = s.beziers[k];
    // the curve flattened, then closed through (512, 512) and (0, 512)
    const pts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, u = 1 - t;
      pts.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
    pts.push(512, 512, 0, 512);
    const n = pts.length / 2, focus = Math.min(0.95, Math.max(0, s.focus[k]));
    const cov = new Float32Array(512 * 512), top = new Float32Array(512).fill(512);
    for (let sy = 0; sy < 512 * SS; sy++) {
      const yy = (sy + 0.5) / SS, xs: number[] = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ya = pts[i * 2 + 1], yb = pts[j * 2 + 1];
        if ((ya > yy) !== (yb > yy)) xs.push(pts[i * 2] + ((yy - ya) / (yb - ya)) * (pts[j * 2] - pts[i * 2]));
      }
      xs.sort((a, b) => a - b);
      const row = Math.floor(yy) * 512;
      for (let q = 0; q + 1 < xs.length; q += 2) {                 // even-odd spans, coverage per subsample
        const a = Math.max(0, Math.ceil(xs[q] * SS - 0.5)), b = Math.min(512 * SS - 1, Math.floor(xs[q + 1] * SS - 0.5));
        for (let sx = a; sx <= b; sx++) { const x = Math.floor(sx / SS); cov[row + x] += 1 / (SS * SS); if (yy < top[x]) top[x] = yy; }
      }
    }
    // the gradient: surround at the curve, centre colour toward the bottom; the focus widens the centre's band
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const c = cov[y * 512 + x];
      if (c <= 0) continue;
      const d = Math.max(0, Math.min(1, (y + 0.5 - top[x]) / Math.max(1, 512 - top[x])));
      const t = Math.min(1, d / (1 - focus));
      const r = lerp(0x4a, 0x9a, t) / 255, g = lerp(0x88, 0xb7, t) / 255, b = lerp(0xc1, 0xde, t) / 255;
      const i = (y * 512 + x) * 4, inv = 1 - c;
      P[i] = r * c + P[i] * inv; P[i + 1] = g * c + P[i + 1] * inv; P[i + 2] = b * c + P[i + 2] * inv; P[i + 3] = c + P[i + 3] * inv;
    }
  }
  return P;
}

/** our mark in place of the logos: a white disc with a play triangle and three rising bars, at (x, y), size u */
function mark(o: Uint8Array, w: number, h: number, x0: number, y0: number, u: number): void {
  const inside = (px: number, py: number): number => {
    const dx = px - (x0 + u / 2), dy = py - (y0 + u / 2), r = u / 2;
    if (dx * dx + dy * dy <= r * r) {
      // the triangle cut out of the disc
      const tx = (px - x0) / u, ty = (py - y0) / u;
      return tx > 0.36 && tx < 0.74 && Math.abs(ty - 0.5) < (0.74 - tx) * 0.62 ? 0 : 1;
    }
    for (let k = 0; k < 3; k++) {
      const bx = x0 + u * (1.25 + k * 0.4), bh = u * (0.45 + k * 0.25);
      if (px >= bx && px < bx + u * 0.26 && py >= y0 + u - bh && py < y0 + u) return 2;
    }
    return -1;
  };
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y0 + u)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x0 + u * 2.3)); x++) {
      let cov = 0, kind = 1;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const v = inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (v > 0) { cov++; kind = v; }
      }
      if (!cov) continue;
      const a = cov / (SS * SS), i = (y * w + x) * 4, c = kind === 2 ? 0xffb347 : 0xffffff;
      o[i] = lerp(o[i], c & 255, a); o[i + 1] = lerp(o[i + 1], (c >> 8) & 255, a); o[i + 2] = lerp(o[i + 2], (c >> 16) & 255, a); o[i + 3] = 0xff;
    }
  }
}

/** w x h BGRA: the picture scaled (bilinear) to cover x cover, its centre kept, alpha byte 0; the mark when logos */
function background(w: number, h: number, s: Mp9Background): Uint8Array {
  const P = picture(s), [cw, ch] = s.cover, o = new Uint8Array(w * h * 4);
  const ox = (cw - w) >> 1, oy = (ch - h) >> 1, kx = 512 / cw, ky = 512 / ch;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(511, Math.max(0, (y + oy + 0.5) * ky - 0.5)), y0 = Math.floor(fy), y1 = Math.min(511, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(511, Math.max(0, (x + ox + 0.5) * kx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(511, x0 + 1), tx = fx - x0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {                               // premultiplied, as GDI+'s PARGB bitmap keeps it
        const v = lerp(lerp(P[(y0 * 512 + x0) * 4 + c], P[(y0 * 512 + x1) * 4 + c], tx), lerp(P[(y1 * 512 + x0) * 4 + c], P[(y1 * 512 + x1) * 4 + c], tx), ty);
        o[i + 2 - c] = Math.round(v * 255);
      }
    }
  }
  if (s.logos) { const u = Math.max(8, Math.round(w * 0.06)); mark(o, w, h, u * 0.4, u * 0.3, u); }
  return o;
}

/** 128x128 X8R8G8B8: a soft round glow (the particles are never emitted in this scene; the texture is still made) */
function particle(): Uint8Array {
  const o = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const d = Math.hypot(x - 63.5, y - 63.5) / 64, k = d >= 1 ? 0 : (1 - d) * (1 - d);
    const i = (y * 128 + x) * 4;
    o[i] = 255 * k; o[i + 1] = 230 * k; o[i + 2] = 200 * k; o[i + 3] = 0xff;
  }
  return o;
}

export const ownArt: Mp9Art = { floor, background, particle };

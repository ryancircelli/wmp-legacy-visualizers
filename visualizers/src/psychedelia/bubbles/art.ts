// Our own artwork for Bubbles' four textures (the DLL ships its own images as resources; they are not used here).
// Every texture is 256 x 256 BGRA, a sphere of radius ~110 px centred in the square, like the shapes the effect's
// shaders expect: rgb = diffuse (or fresnel) * the bubble's colour + specular, alpha = specular's alpha.
//   diffuse:  a soft lit sphere, bright at the top, dark at the bottom (the coloured body of Random/Centered/Gravity)
//   fresnel:  a dark centre that brightens toward the rim (Pop's glassy bubbles)
//   specular: a white highlight up left, a faint rim and a crescent of reflected light; alpha = the disc
//   album:    the first bubble's picture until the song's cover art arrives: a stylised iris (concentric hues)
export const SIZE = 256;
const C = 127.5, R = 110;

function make(fn: (x: number, y: number, d: number) => [number, number, number, number]): Uint8Array {
  const px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - C) / R, dy = (y - C) / R, d = Math.sqrt(dx * dx + dy * dy);
      const [r, g, b, a] = fn(dx, dy, d);
      const i = (y * SIZE + x) * 4;
      px[i] = clamp(b); px[i + 1] = clamp(g); px[i + 2] = clamp(r); px[i + 3] = clamp(a);
    }
  }
  return px;
}
const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
/** coverage of the disc's edge, 1.5 px wide */
const edge = (d: number): number => Math.max(0, Math.min(1, (1 - d) * R / 1.5 + 0.5));
const smooth = (a: number, b: number, t: number): number => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

export function diffuse(): Uint8Array {
  return make((x, y, d) => {
    const z = Math.sqrt(Math.max(0, 1 - d * d));
    const l = Math.max(0, -0.55 * y + 0.35 * z - 0.1 * x + 0.45);
    const v = 250 * Math.min(1, l) * edge(d);
    return [v, v, v, 255];
  });
}

export function fresnel(): Uint8Array {
  return make((_x, _y, d) => {
    const v = 185 * Math.pow(smooth(0.35, 1, d), 2.2) * edge(d);
    return [v, v, v, 255];
  });
}

export function specular(): Uint8Array {
  return make((x, y, d) => {
    const hx = (x + 0.42) / 0.16, hy = (y + 0.55) / 0.08;
    const hl = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy));
    const rim = smooth(0.82, 0.98, d) * 0.55;
    const cx = (x - 0.25) / 0.55, cy = (y - 0.35) / 0.4;
    const cres = Math.max(0, 1 - Math.abs(Math.sqrt(cx * cx + cy * cy) - 1) * 8) * 0.18 * smooth(0.5, 0.9, d);
    const v = 255 * Math.min(1, smooth(0, 0.35, hl) + rim + cres) * edge(d);
    return [v, v, v, 255 * edge(d)];
  });
}

export function album(): Uint8Array {
  return make((x, y, d) => {
    const a = Math.atan2(y, x), r = d * 1.05;
    if (r > 1) return [235, 232, 228, 255];
    if (r < 0.28) return [8, 8, 12, 255];
    const fib = 0.75 + 0.25 * Math.sin(a * 37 + Math.sin(a * 5) * 2) * Math.sin(a * 23 + r * 9);
    const t = (r - 0.28) / 0.72;
    const g = [40 + 90 * t, 110 - 30 * t, 150 + 40 * Math.sin(t * 3)];
    const ring = r > 0.9 ? 0.4 : 1;
    return [g[0] * fib * ring, g[1] * fib * ring, g[2] * fib * ring, 255];
  });
}

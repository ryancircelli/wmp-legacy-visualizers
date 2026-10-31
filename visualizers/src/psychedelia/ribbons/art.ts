// Our own data for Ribbons (the DLL ships its own; neither is used here):
//   glow: the 128 x 128 BGRA texture every ribbon is drawn with (modulated by its colour, added to the target): a
//         soft white disc, brightest at the centre, falling to black at the edge (u runs along the ribbon, v across)
//   perm: the noise's 256-entry permutation, a Fisher-Yates shuffle of 0..255 driven by a small LCG of our own
export function glow(): Uint8Array {
  const px = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 63.5) / 64, dy = (y - 63.5) / 64, r2 = Math.min(1, dx * dx + dy * dy);
      const v = Math.round(240 * (1 - r2) * (1 - r2) * (0.75 + 0.25 * Math.cos(Math.PI * Math.sqrt(r2))));
      const i = (y * 128 + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

export function perm(): Int32Array {
  const p = Int32Array.from({ length: 256 }, (_, i) => i);
  let s = 2026;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 16) % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
}

// Our own button pictures for the public build of Energy Bliss' equalizer panel (eqpanel.ts). The DLL loads 24-bit
// bitmaps from its resources; none of them ship here. These are drawn by our own code at the same sizes (10x10, the
// reflections 10x8, the hd set 20x20): a rounded pad with a vertical shade and a highlight, green at the bottom of
// the stack to red at the top, a dim pad for unlit rows, a pale peak, and faded upside-down pads for the reflections.
import type { EqButtons, EqSprite } from './eqpanel';

/** w x h BGRA (alpha 0xff): a rounded pad of colour rgb (0xRRGGBB), lit from above, or from below when flipped */
function pad(w: number, h: number, rgb: number, fade = 1, flip = false): EqSprite {
  const px = new Uint8Array(w * h * 4), r = Math.max(1, w / 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.max(r - x - 0.5, x + 0.5 - (w - r), 0), cy = Math.max(r - y - 0.5, y + 0.5 - (h - r), 0);
    const edge = Math.min(1, Math.max(0, r - Math.hypot(cx, cy) + 0.5));       // 1 inside, 0 past the corner
    const t = (flip ? h - 1 - y : y) / (h - 1);
    const shade = (1.25 - 0.6 * t) * edge * fade, glint = t < 0.3 && x > w * 0.2 && x < w * 0.8 ? 0.35 * edge * fade : 0;
    const c = (s: number): number => Math.min(255, Math.round(((rgb >> s) & 255) * shade + 255 * glint));
    const i = (y * w + x) * 4;
    px[i] = c(0); px[i + 1] = c(8); px[i + 2] = c(16); px[i + 3] = 255;
  }
  return { w, h, px };
}

const LIT = [0x20d040, 0x70e030, 0xc0e020, 0xf0c020, 0xf07020, 0xf02828];   // 1A (bottom) .. 6A (top)
const DIM = 0x283848, PEAK = 0xe8f0ff;

/** the full set eqpanel.ts takes */
export function eqButtons(): EqButtons {
  const set = (s: number): Record<string, EqSprite> => ({
    '1A': pad(s, s, LIT[0]), '2A': pad(s, s, LIT[1]), '3A': pad(s, s, LIT[2]), '4A': pad(s, s, LIT[3]),
    '5A': pad(s, s, LIT[4]), '6A': pad(s, s, LIT[5]), '1B': pad(s, s, DIM), Peak: pad(s, s, PEAK),
  });
  const hd = Object.fromEntries(Object.entries(set(20)).map(([k, v]) => [`hd_${k}`, v]));
  return {
    ...set(10), ...hd,
    R1: pad(10, 8, LIT[0], 0.45, true), R2: pad(10, 8, LIT[0], 0.3, true), R3: pad(10, 8, LIT[0], 0.18, true),
    R_Peak: pad(10, 8, PEAK, 0.4, true),
  } as EqButtons;
}

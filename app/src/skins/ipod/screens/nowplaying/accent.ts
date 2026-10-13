// Over Cover's colour for Bars and Waves: the cover's accent by Android's Palette method (node-vibrant's
// swatches), held to a WCAG contrast of 3:1 against the cover's dominant colour so the bars read over
// it. The engine paints it (its 'luma' output's tint).

export interface SwatchLike { rgb: readonly number[]; population: number }
export type PaletteLike = Partial<Record<string, SwatchLike | null>>;

/** WCAG 2's relative luminance of an sRGB colour (channels 0..255) */
export function luminance([r = 0, g = 0, b = 0]: readonly number[]): number {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2's contrast ratio of two colours, 1..21 */
export function contrast(a: readonly number[], b: readonly number[]): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** the swatches the accent is looked for in, in order */
export const ACCENT_ORDER = ['Vibrant', 'LightVibrant', 'DarkVibrant', 'LightMuted', 'DarkMuted'] as const;
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const hex = (c: readonly number[]) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

/** The accent, '#rrggbb', and where it came from: the first swatch of ACCENT_ORDER at 3:1 or more
 *  against the dominant one (the largest population), else white or black, whichever contrasts
 *  more; no swatches: white. */
export function pickAccent(p: PaletteLike): { color: string; from: string } {
  const all = Object.values(p).filter((s): s is SwatchLike => !!s);
  const dom = all.reduce<SwatchLike | null>((m, s) => (!m || s.population > m.population ? s : m), null);
  if (!dom) return { color: hex(WHITE), from: 'no swatches' };
  const hit = ACCENT_ORDER.find((k) => { const s = p[k]; return s && contrast(s.rgb, dom.rgb) >= 3; });
  if (hit) return { color: hex(p[hit]!.rgb), from: hit };
  const white = contrast(WHITE, dom.rgb) >= contrast(BLACK, dom.rgb);
  return { color: hex(white ? WHITE : BLACK), from: (white ? 'white' : 'black') + ': no swatch at 3:1' };
}

/** '#rrggbb' as [r, g, b] */
export const rgbOf = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

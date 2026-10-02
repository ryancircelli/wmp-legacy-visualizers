// Cover Bars' colour: the cover's accent by Android's Palette method (node-vibrant's swatches), held to
// a WCAG contrast of 3:1 against the cover's dominant colour so the bars read over it; and the
// feColorMatrix that paints the visualizer's canvas in it.

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

/** The accent as '#rrggbb': the first swatch of ACCENT_ORDER at 3:1 or more against the dominant one
 *  (the largest population), else white or black, whichever contrasts more; no swatches: white. */
export function pickAccent(p: PaletteLike): string {
  const all = Object.values(p).filter((s): s is SwatchLike => !!s);
  const dom = all.reduce<SwatchLike | null>((m, s) => (!m || s.population > m.population ? s : m), null);
  if (!dom) return hex(WHITE);
  const hit = ACCENT_ORDER.map((k) => p[k]).find((s) => s && contrast(s.rgb, dom.rgb) >= 3);
  return hex(hit?.rgb ?? (contrast(WHITE, dom.rgb) >= contrast(BLACK, dom.rgb) ? WHITE : BLACK));
}

/** alpha's gain: Bars' own green (#A4EB0C, luminance about .8) comes out opaque */
export const GAIN = 1.25;

/** feColorMatrix values (sRGB) painting a canvas in `accent`: RGB the accent, alpha the source's
 *  luminance (so the engine's black is transparent and its bars and peaks are the accent) */
export function tintMatrix(accent: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255);
  return [`0 0 0 0 ${r}`, `0 0 0 0 ${g}`, `0 0 0 0 ${b}`, `${0.2126 * GAIN} ${0.7152 * GAIN} ${0.0722 * GAIN} 0 0`].join('  ');
}

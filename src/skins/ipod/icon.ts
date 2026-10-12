// The app's icon in the body's colour (the iOS app's alchemyIcon). iOS takes alternate icons only from
// the bundle, so they are made at build time (ios/icons.py): one per preset, and for Custom a grid this
// snaps to (the same HUES, LIGHTS and GREYS there).
import type { IpodSettings } from './screens/contract';

const HUE_STEP = 30, LIGHTS = [35, 55], GREYS = [25, 50, 72];
const near = (xs: number[], v: number) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** the icon's name for these settings: the preset's own, or Custom's nearest of the grid (grey under 20 % saturation) */
export function iconFor(s: IpodSettings): string {
  if (s.color !== 'custom') return s.color;
  if (s.sat < 20) return 'c-grey-l' + near(GREYS, s.light);
  const h = (Math.round((((s.hue % 360) + 360) % 360) / HUE_STEP) * HUE_STEP) % 360;
  return 'c-h' + String(h).padStart(3, '0') + '-l' + near(LIGHTS, s.light);
}

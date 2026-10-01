// The iPod skin's own options (screens/contract.ts IpodSettings), apart from the app's settings and
// persisted in localStorage under 'ipod.settings'. The body colours are the nano 5G's nine, as HSL
// (docs/ipod-skin.md §1.2: sampled from Apple's render, saturated to match photos).
import type { CSSProperties } from 'react';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { IpodSettings } from './screens/contract';
export type { IpodSettings } from './screens/contract';

type Preset = Exclude<IpodSettings['color'], 'custom'>;
/** hue, saturation %, lightness % of each body colour */
export const COLORS: Record<Preset, readonly [number, number, number]> = {
  silver: [0, 0, 66], black: [0, 0, 19], purple: [268, 42, 44], blue: [196, 89, 44], green: [140, 70, 34],
  yellow: [52, 89, 49], orange: [30, 85, 50], red: [357, 62, 47], pink: [331, 70, 62],
};
export const DEFAULTS: IpodSettings = { color: 'silver', hue: 0, sat: 0, clicker: true, wheel: 'white' };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
/** Whatever localStorage held (an older or hand-edited blob) as valid settings. */
function normalize(p: Partial<IpodSettings>): IpodSettings {
  return {
    color: p.color === 'custom' || (p.color && p.color in COLORS) ? p.color : DEFAULTS.color,
    hue: clamp(p.hue, 0, 360, DEFAULTS.hue),
    sat: clamp(p.sat, 0, 100, DEFAULTS.sat),
    clicker: typeof p.clicker === 'boolean' ? p.clicker : DEFAULTS.clicker,
    wheel: p.wheel === 'black' ? 'black' : 'white',
  };
}

const store = createStore<IpodSettings>()(persist(() => DEFAULTS, {
  name: 'ipod.settings',
  merge: (saved, cur) => normalize({ ...cur, ...(saved as Partial<IpodSettings>) }),
}));
const set = (p: Partial<IpodSettings>) => store.setState(normalize({ ...store.getState(), ...p }));

export function useIpodSettings(): [IpodSettings, (patch: Partial<IpodSettings>) => void] {
  return [useStore(store), set];
}
/** For what runs outside render (the wheel's clicker). */
export const ipodSettings = () => store.getState();

/** The body colour as the one hue knob the module's .body reads (§1.3: --h --s --l; the highlight,
 *  shadow and centre button derive from it). 'custom' is a hue at the spec's saturation and lightness
 *  unless a saturation was set. */
export function bodyVars(s: IpodSettings): CSSProperties {
  const [h, sat, l] = s.color === 'custom' ? [s.hue, s.sat || 85, 50] : COLORS[s.color];
  return { '--h': h, '--s': sat + '%', '--l': l + '%' } as CSSProperties;
}

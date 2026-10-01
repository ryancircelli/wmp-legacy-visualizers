// The iPod skin's own options (screens/contract.ts IpodSettings), apart from the app's settings and
// persisted in localStorage under 'ipod.settings'. The body colours are the nano 5G's nine, as HSL;
// the spec retunes them here.
import type { CSSProperties } from 'react';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { IpodSettings } from './screens/contract';
export type { IpodSettings } from './screens/contract';

type Preset = Exclude<IpodSettings['color'], 'custom'>;
/** hue, saturation %, lightness % of each body colour */
export const COLORS: Record<Preset, readonly [number, number, number]> = {
  silver: [0, 0, 78], black: [0, 0, 16], purple: [275, 40, 45], blue: [212, 60, 48], green: [95, 45, 45],
  yellow: [50, 85, 56], orange: [28, 85, 52], red: [355, 70, 44], pink: [330, 65, 62],
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

/** The body colour as the CSS variables the module's .body reads. 'custom' keeps a mid lightness. */
export function bodyVars(s: IpodSettings): CSSProperties {
  const [h, sat, l] = s.color === 'custom' ? [s.hue, s.sat, 55] : COLORS[s.color];
  return { '--ipod-hue': h, '--ipod-sat': sat + '%', '--ipod-light': l + '%' } as CSSProperties;
}

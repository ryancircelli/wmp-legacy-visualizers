// The iPod skin's own options (screens/contract.ts IpodSettings), apart from the app's settings and
// persisted in localStorage under 'ipod.settings'. The body colours are the nano 5G's nine, as HSL
// (docs/ipod-skin.md §1.2: sampled from Apple's render, saturated to match photos), then the owner's
// Mocha Tan and Espresso Brown.
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
  // the owner's two (2026-10-02): a greyed tan and a deep brown, set darker and greyer than they read,
  // since the cylinder's lights (below) lift a muted colour more than a vivid one (his: "a little too bright")
  // Mocha again (the owner: "not mocha enough and too pale", "too orangish"): the hue toward brown, darker, a touch richer
  mocha: [24, 32, 40], espresso: [22, 36, 17],
};
/** Custom's lightness range: the body's lights top out at 72 % (ipod.module.css --hi), so past 75 the
 *  cylinder goes flat (its centre as bright as its bands); under 15 its edge and shade go black */
export const LIGHT = [15, 75] as const;
export const DEFAULTS: IpodSettings = { color: 'green', hue: 0, sat: 85, light: 50, clicker: true, wheel: 'white' };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
/** Whatever localStorage held (an older or hand-edited blob) as valid settings. */
function normalize(p: Partial<IpodSettings>): IpodSettings {
  return {
    color: p.color === 'custom' || (p.color && p.color in COLORS) ? p.color : DEFAULTS.color,
    hue: clamp(p.hue, 0, 360, DEFAULTS.hue),
    sat: clamp(p.sat, 0, 100, DEFAULTS.sat),
    light: clamp(p.light, LIGHT[0], LIGHT[1], DEFAULTS.light),
    clicker: typeof p.clicker === 'boolean' ? p.clicker : DEFAULTS.clicker,
    wheel: p.wheel === 'black' ? 'black' : 'white',
  };
}

const store = createStore<IpodSettings>()(persist(() => DEFAULTS, {
  name: 'ipod.settings',
  // version 0 had no lightness (Custom was 50) and its saturation 0 meant the spec's 85
  version: 1,
  migrate: (old) => ({ ...(old as Partial<IpodSettings>), sat: (old as Partial<IpodSettings>).sat || DEFAULTS.sat }),
  merge: (saved, cur) => normalize({ ...cur, ...(saved as Partial<IpodSettings>) }),
}));
/** a patch that changes nothing writes nothing (a drag reports every move) */
const set = (p: Partial<IpodSettings>) => {
  const cur = store.getState(), next = normalize({ ...cur, ...p });
  if ((Object.keys(next) as (keyof IpodSettings)[]).some((k) => next[k] !== cur[k])) store.setState(next);
};

export function useIpodSettings(): [IpodSettings, (patch: Partial<IpodSettings>) => void] {
  return [useStore(store), set];
}
/** For what runs outside render (the wheel's clicker). */
export const ipodSettings = () => store.getState();

/** A body colour (the one chosen, by default) as [hue, saturation %, lightness %]: a preset's, or Custom's three. */
export const bodyHsl = (s: IpodSettings, color = s.color): readonly [number, number, number] =>
  color === 'custom' ? [s.hue, s.sat, s.light] : COLORS[color];

/** The body colour as the one hue knob the module's .body reads (§1.3: --h --s --l; the highlight,
 *  shadow and centre button derive from it). */
export function bodyVars(s: IpodSettings): CSSProperties {
  const [h, sat, l] = bodyHsl(s), k = s.color === 'custom' ? LOOK : 1;
  return { '--h': h, '--s': sat / k + '%', '--l': l / k + '%' } as CSSProperties;
}
/** The cylinder's lights (ipod.module.css --hi and its neighbours: up to 1.36 times the base's lightness
 *  and 1.3 its saturation, over most of what shows beside the screen) make the body read about this much
 *  brighter and richer than its base. A preset's numbers are the base, tuned by eye; Custom's are what the
 *  picker shows, so its base is taken down to look like the colour picked. */
const LOOK = 1.15;

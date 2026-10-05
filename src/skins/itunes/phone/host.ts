// The phone around the iTunes layout (the iOS app's window.alchemy* bindings, ios/README.md; this
// skin's own copies, as a skin imports no other skin). Each call is optional: in a browser none of
// them exist and the layout is just the page.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useShell } from '../../../ui';

/** The layout is drawn for the iPhone 4's 320-point width (2010, the phone iTunes 10 synced): the
 *  screen's narrow side is always this many CSS px, scaled up to the phone. iTunes' 12 px text then
 *  reads at about 15 points on a 390-point phone and its 20 px rows can be fingertip-tall. */
export const NARROW = 320;

export interface Fit {
  /** the scale onto the page's CSS px (the iOS app's viewport is the desktop-wide one: Root.tsx) */
  s: number;
  /** the layout's size in its own px */
  w: number;
  h: number;
  /** the layout's px per point (the host's insets and keyboard come in points) */
  pt: number;
  landscape: boolean;
}

/** The layout's scale for a viewport of `vw` × `vh` CSS px on a screen whose narrow side is
 *  `narrowPt` points (0: unknown, a point taken as a CSS px). */
export function fit(vw: number, vh: number, narrowPt: number): Fit {
  const short = Math.max(1, Math.min(vw, vh)), s = short / NARROW;
  return { s, w: vw / s, h: vh / s, pt: NARROW / (narrowPt > 0 ? narrowPt : short), landscape: vw > vh };
}

const onResize = (f: () => void) => {
  window.addEventListener('resize', f);
  return () => window.removeEventListener('resize', f);
};
const size = () => window.innerWidth + 'x' + window.innerHeight;

/** The fit for the window now, re-read on a resize (a turn of the phone). */
export function useFit(): Fit {
  const key = useSyncExternalStore(onResize, size);
  const [w, h] = key.split('x').map(Number) as [number, number];
  return fit(w, h, Math.min(screen.width, screen.height));
}

/** A host report (window.__wmpSafeArea, __wmpBattery, ...), re-read on its event. */
export function useHostGlobal<K extends keyof Window>(key: K, event: string): Window[K] {
  const sub = useCallback((f: () => void) => {
    window.addEventListener(event, f);
    return () => window.removeEventListener(event, f);
  }, [event]);
  return useSyncExternalStore(sub, () => window[key]);
}

/** A tap's feel, as the iPod gives its taps (the iOS app's haptics). */
export const haptic = (kind: 'light' | 'medium' | 'selection' = 'light') => window.alchemyHaptic?.(kind);

/** While the phone layout shows: edge to edge (the layout keeps clear of the notch and the home
 *  indicator itself, drawing the time and battery in the toolbar's top as the iPod draws them in its
 *  status row), the log band hidden, any orientation (the iPhone's Music app of 2010 turned to Cover
 *  Flow on its side), and the screen let sleep as that app let it. Unmounted with the skin switched,
 *  the app's defaults come back; with this skin still chosen (a refresh in place) they stay, so the
 *  layout does not flash. */
export function useHostChrome(): void {
  const { store } = useShell();
  useEffect(() => {
    const w = window;
    w.alchemyLayout?.('edge');
    w.alchemyStatusBar?.(true);
    w.alchemyHomeIndicator?.(false);
    w.alchemyBand?.(true);
    w.alchemyOrientation?.('any');
    w.alchemyBackground?.('#000000');
    w.alchemyAwake?.(false);
    return () => {
      if (store.getState().settings.skin === 'itunes') return;
      w.alchemyLayout?.('safe');
      w.alchemyStatusBar?.(false);
      w.alchemyBand?.(false);
    };
  }, [store]);
}

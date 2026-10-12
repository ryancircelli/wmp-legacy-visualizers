// The phone around the iPod (the iOS app's window.alchemy* bindings, ios/README.md). Each call is
// optional: in a browser none of them exist and the skin is just the page.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useShell } from '../../ui';

/** A host report (window.__wmpBattery, __wmpSafeArea, ...), re-read on its event. */
export function useHostGlobal<K extends keyof Window>(key: K, event: string): Window[K] {
  const sub = useCallback((f: () => void) => {
    window.addEventListener(event, f);
    return () => window.removeEventListener(event, f);
  }, [event]);
  return useSyncExternalStore(sub, () => window[key]);
}

/** While the iPod shows: edge to edge, no status bar, home indicator or log band, portrait, a black
 *  backdrop and the screen kept awake. Unmounted with the skin switched, the app's defaults come back;
 *  unmounted with the iPod still the skin (a refresh in place, whose new page sets them all again),
 *  they stay, so the phone's layout does not flash. */
export function useHostChrome(): void {
  const { store } = useShell();
  useEffect(() => {
    const w = window;
    w.alchemyLayout?.('edge');
    w.alchemyStatusBar?.(true);
    w.alchemyHomeIndicator?.(true);
    w.alchemyBand?.(true);
    w.alchemyOrientation?.('portrait');
    w.alchemyBackground?.('#000000');
    w.alchemyAwake?.(true);
    return () => {
      if (store.getState().settings.skin === 'ipod') return;
      w.alchemyLayout?.('safe');
      w.alchemyStatusBar?.(false);
      w.alchemyHomeIndicator?.(false);
      w.alchemyBand?.(false);
      w.alchemyOrientation?.('any');
      w.alchemyAwake?.(false);
    };
  }, [store]);
}

/** CSS pixels a point: in the desktop-wide viewport (below) the phone scales the page, so a point is
 *  (viewport width / screen width) of them; 1 in a browser. */
export const pointPx = () => Math.min(4, Math.max(1, window.innerWidth / (window.screen?.width || window.innerWidth)));

const ASKED = 'ipod.viewport';
/** The desktop viewport, as the WMP 9 skin has: measured on the phone (2026-09-30), Spotify's web
 *  player at a phone-wide viewport stops reporting its state (no song info, nothing in the lists),
 *  so the iPod draws itself in the desktop-wide one and the phone scales it, which costs nothing:
 *  every size is relative to the viewport. A host still in 'mobile' from an earlier build is asked
 *  for 'desktop' once per session (a change reloads the page). */
export function useDesktopViewport(): void {
  useEffect(() => {
    if (!window.alchemyViewport) return;
    const check = () => {
      try {
        if (window.__wmpHost?.viewport !== 'mobile') { sessionStorage.removeItem(ASKED); return; }
        if (sessionStorage.getItem(ASKED)) return;
        sessionStorage.setItem(ASKED, '1');
      } catch { return; }                  // no storage, no guard: never risk a reload loop
      window.alchemyViewport?.('desktop');
    };
    window.addEventListener('wmp-host', check);
    window.alchemyHost?.();
    return () => window.removeEventListener('wmp-host', check);
  }, []);
}

// The phone around the iPod (the iOS app's window.alchemy* bindings, ios/README.md). Each call is
// optional: in a browser none of them exist and the skin is just the page.
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** A host report (window.__wmpBattery, __wmpSafeArea, ...), re-read on its event. */
export function useHostGlobal<K extends keyof Window>(key: K, event: string): Window[K] {
  const sub = useCallback((f: () => void) => {
    window.addEventListener(event, f);
    return () => window.removeEventListener(event, f);
  }, [event]);
  return useSyncExternalStore(sub, () => window[key]);
}

/** While the iPod shows: edge to edge, no status bar, home indicator or log band, portrait, a black
 *  backdrop, the screen kept awake, and the broadcast sheet never offered (no visualizer here).
 *  Unmounted (the skin switched), the app's defaults come back. */
export function useHostChrome(): void {
  useEffect(() => {
    const w = window;
    w.alchemyBroadcast?.('manual');
    w.alchemyLayout?.('edge');
    w.alchemyStatusBar?.(true);
    w.alchemyHomeIndicator?.(true);
    w.alchemyBand?.(true);
    w.alchemyOrientation?.('portrait');
    w.alchemyBackground?.('#000000');
    w.alchemyAwake?.(true);
    return () => {
      w.alchemyLayout?.('safe');
      w.alchemyStatusBar?.(false);
      w.alchemyHomeIndicator?.(false);
      w.alchemyBand?.(false);
      w.alchemyOrientation?.('any');
      w.alchemyAwake?.(false);
    };
  }, []);
}

const ASKED = 'ipod.viewport';
/** The desktop viewport, as the WMP 9 skin has: measured on the phone (2026-09-30), Spotify's web
 *  player at a phone-wide viewport stops reporting its state (no song info, nothing in the lists),
 *  so the iPod draws itself in the desktop-wide one and the phone scales it, which costs nothing:
 *  every size is relative to the viewport. A host still in 'mobile' from an earlier build is asked
 *  for 'desktop' once per session (a change reloads the page). */
export function useMobileViewport(): void {
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

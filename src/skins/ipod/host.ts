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
/** The iPod is drawn for a phone-wide viewport, so it asks WebKit for the mobile content mode. That
 *  is kept across launches and a change reloads the page, so it is asked once per session at most
 *  (a host that reloads and still says 'desktop' is never asked again), and the flag clears once
 *  the host says 'mobile'. The WMP 9 skin wants 'desktop' back: not done here; it should ask for it
 *  the same way on its own mount under the iOS app. */
export function useMobileViewport(): void {
  useEffect(() => {
    if (!window.alchemyViewport) return;
    const check = () => {
      try {
        if (window.__wmpHost?.viewport === 'mobile') { sessionStorage.removeItem(ASKED); return; }
        if (sessionStorage.getItem(ASKED)) return;
        sessionStorage.setItem(ASKED, '1');
      } catch { return; }                  // no storage, no guard: never risk a reload loop
      window.alchemyViewport?.('mobile');
    };
    window.addEventListener('wmp-host', check);
    window.alchemyHost?.();
    return () => window.removeEventListener('wmp-host', check);
  }, []);
}

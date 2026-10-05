// The iTunes 10 skin's root: the phone layout (phone/, its own agent's) on a phone, the Windows window
// (desktop/) anywhere else. A phone is a touch screen no wider than a phone at its narrow side: the
// screen's, not the viewport's, since the iOS app draws the page in a desktop-wide viewport (Spotify's
// web player stops reporting its state at a phone-wide one: src/skins/ipod/host.ts) and scales it.
import { useEffect, useState } from 'react';
import { DesktopRoot } from './desktop/Root';
import { PhoneRoot } from './phone/Root';

/** a touch screen whose narrow side is under 600 CSS px (every phone; an iPad's is 744 and up) */
export const isPhone = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

export function Root() {
  const [phone] = useState(isPhone);
  useDesktopViewport();
  return phone ? <PhoneRoot /> : <DesktopRoot />;
}

const ASKED = 'itunes.viewport';
/** The desktop-wide viewport, as WMP 9 and the iPod ask for it (their copies: skins import no skin): an
 *  earlier skin may have left the iOS app in its 'mobile' content mode, kept across launches; 'desktop'
 *  is asked once per session at most (a change reloads the page), the flag cleared once the host says
 *  anything but 'mobile'. */
function useDesktopViewport() {
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

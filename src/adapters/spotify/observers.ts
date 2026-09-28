// The host's observers (deno-webview/spotify.ts) start at document creation and this runs later:
// read what window.__wmpSpotify already has, then follow its events.
import type { Device } from '../../model';
import { onState } from './state';
import { deviceVolume } from './connect';
import { W, type PlayerState, type Sp } from './sp';

/** The overlay shows while /api/token says isAnonymous === false, and before it says anything when
 *  the last session here was logged in (the skin comes up at once, with what ui/persist.ts kept;
 *  a session that turns out anonymous goes to the login page anyway). Otherwise Spotify's own page
 *  is what the user sees. The host element is outside the shadow root. */
function show(on: boolean): void {
  const h = document.getElementById('wmp-root');
  if (h) h.style.display = on ? '' : 'none';
}

const HINT = 'wmp.loggedIn';
/** Whether the last session in this profile was logged in. */
export function wasLoggedIn(): boolean {
  try { return localStorage.getItem(HINT) === '1'; } catch { return false; }
}

export function onAuth(sp: Sp, loggedIn: unknown): void {
  if (typeof loggedIn !== 'boolean') { show(wasLoggedIn()); return; } // not known yet
  sp.store.getState().actions.setAuth({ loggedIn });
  try { if (loggedIn) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT); } catch { /* no storage: no head start */ }
  show(loggedIn);
}

export function onDevices(sp: Sp, list: unknown): void {
  const l = (Array.isArray(list) ? list : []) as (Device | null)[];
  const devs = l.filter((d): d is Device => !!d?.id);
  sp.store.getState().actions.setDevices(devs, W().deviceId ?? '');
  // The slider follows the device the volume PUTs go to: the active one, else this web player.
  const to = W().activeDeviceId || W().deviceId, d = devs.find((x) => x.id === to);
  if (d && typeof d.volume === 'number') deviceVolume(sp, d.volume);
}

export function observe(sp: Sp): () => void {
  const on: [string, (e: Event) => void][] = [
    ['wmp-spotify-auth', (e) => onAuth(sp, (e as CustomEvent<{ loggedIn?: boolean } | null>).detail?.loggedIn)],
    ['wmp-spotify-state', (e) => onState(sp, (e as CustomEvent<PlayerState>).detail)],
    ['wmp-spotify-devices', (e) => onDevices(sp, (e as CustomEvent<unknown>).detail)],
  ];
  show(wasLoggedIn());
  for (const [t, f] of on) window.addEventListener(t, f);
  onDevices(sp, W().devices);
  if (W().state) onState(sp, W().state as PlayerState);
  onAuth(sp, W().loggedIn);
  return () => { for (const [t, f] of on) window.removeEventListener(t, f); };
}

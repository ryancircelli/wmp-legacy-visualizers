// The nano's boot screen, in the iOS app only (window.alchemyLayout): while the page waits for
// Spotify at launch, the screen is black with the white note and a thin bar under it in the nano's
// blue, which fills on what has really arrived and never goes back. The body and the wheel draw at
// once around it; neither the wheel nor the screen takes input while it shows. Elsewhere nothing waits
// behind the skin's first frame, so nothing shows.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppState } from '../../model';
import { useShell } from '../../ui';
import s from './boot.module.css';

/** the bar at mount; the milestones read every STEP ms; the boot gives up at CAP, then fades for FADE */
const START = .15, STEP = 100, CAP = 6000, FADE = 250;
/** the skin's ♪ (ui.tsx Art) */
const NOTE = 'M4.5 2.2 11 .5v7.8a1.9 1.6 0 1 1-1.3-1.5V3.1L5.8 4.2v5.6a1.9 1.6 0 1 1-1.3-1.5z';

/** What the boot waits for past mounting, each true once in: Spotify's sign-in, its first player state
 *  or device list, and on a host with its own speaker (window.__wmpSpeaker) that speaker's session.
 *  null when logged out: Spotify's login page shows, nothing to wait for. Read from the store and from
 *  what the host's observer has seen (window.__wmpSpotify), which the adapter copies into the store
 *  only after the first frame: after a refresh in place it is all known at mount. */
export function milestones(st: AppState): boolean[] | null {
  const w = window.__wmpSpotify, spk = window.__wmpSpeaker, auth = st.auth.loggedIn ?? w?.loggedIn;
  if (auth === false) return null;
  return [
    auth === true,
    st.playback.status !== 'none' || st.devices.list.length > 0 || !!w?.state || !!(w?.devices as unknown[] | undefined)?.length,
    ...(spk ? [spk.id != null] : []),
  ];
}

/** The boot screen: shown at mount in the iOS app unless logged out or everything is in already; ends
 *  when every milestone is in, or at CAP with whatever is there, with a short fade; logged out, at once. */
export function Boot() {
  const { store } = useShell();
  const [phase, setPhase] = useState<'on' | 'fade' | 'off'>(() =>
    window.alchemyLayout && milestones(store.getState())?.includes(false) ? 'on' : 'off');
  const [v, setV] = useState(START), off = phase === 'off', el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (off) return;
    let waited = 0, fade = 0;
    const poll = window.setInterval(() => {
      const m = milestones(store.getState());
      if (!m) { clearInterval(poll); setPhase('off'); return; }
      const n = m.length, done = m.filter(Boolean).length, at = START + (1 - START) * done / n;
      if (done === n || (waited += STEP) >= CAP) {
        clearInterval(poll);
        setV(1);
        setPhase('fade');
        fade = window.setTimeout(() => setPhase('off'), FADE);
        return;
      }
      // between milestones: slowly on towards the next one, never reaching it
      const next = START + (1 - START) * (done + .9) / n;
      setV((x) => Math.max(x, at, x + (next - x) * .04));
    }, STEP);
    // No input while it shows. On window in the capture phase, added before the wheel's own key
    // listener there (this effect runs first: the screen comes before the wheel), so nothing behind
    // the boot hears a key, or a press on the page (the overlay's shadow root in the app): Spotify's
    // own page, showing while the overlay is hidden, keeps its presses.
    const page = el.current?.getRootNode();
    const block = (e: Event) => { if (e.type === 'keydown' || (page && e.composedPath().includes(page))) e.stopImmediatePropagation(); };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, block, true);
    return () => {
      clearInterval(poll);
      clearTimeout(fade);
      for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, block, true);
    };
  }, [off, store]);
  if (off) return null;
  return (
    <div ref={el} className={s.boot} data-fade={phase === 'fade' || undefined}>
      <svg className={s.mark} viewBox="0 0 12 12" aria-hidden="true"><path d={NOTE} /></svg>
      <div className={s.bar} role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(v * 100)} style={{ '--v': v } as CSSProperties} />
    </div>
  );
}

// The host's observers (the Deno host's spotify.ts; bridge.ts on Tauri) start at document creation and
// this runs later: read what window.__wmpSpotify already has, then follow its events.
import type { Device } from '../../model';
import * as hostPlayer from '../host/player';
import { onHostPlayer, onState } from './state';
import { deviceVolume, speakerFull, transfer, transport as play } from './connect';
import { W, type PlayerState, type Sp } from './sp';
import { transport } from './transport';

/** Our player shows while /api/token says isAnonymous === false, and before it says anything when
 *  the last session here was logged in (the skin comes up at once, with what ui/persist.ts kept;
 *  a session that turns out anonymous goes to the login page anyway). Otherwise Spotify's own page
 *  is what the user sees. */
const show = (on: boolean) => transport().show(on);

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
  const spk = window.__wmpSpeaker?.id;
  // The host's speaker has no level of its own to follow (the slider follows the system's volume,
  // index.ts): it stays at full, and is put back there when found lower (at most once every 10 s).
  if (d && typeof d.volume === 'number' && to !== spk) deviceVolume(sp, d.volume);
  const own = spk ? devs.find((x) => x.id === spk) : undefined;
  if (own && typeof own.volume === 'number' && own.volume < 65000 && Date.now() - fullAt > 10_000) {
    fullAt = Date.now();
    speakerFull(sp, own.id);
  }
  // On a phone with its own speaker (CONTRACT: __wmpSpeaker), playback that lands on this page's
  // player (hidden, heard by nothing) moves to the speaker: at most once every 10 s, so a refused
  // move does not loop.
  if (spk && W().activeDeviceId && to === W().deviceId && devs.some((x) => x.id === spk) && Date.now() - movedAt > 10_000) {
    movedAt = Date.now();
    window.alchemyLog?.('spotify: playing on this page: moving to the speaker');
    void transfer(sp, spk);
  }
  // The speaker's connection to Spotify dropped while it played (2026-10-02, three times in an evening:
  // "Connection to server closed", then its session back up with no active device and the track lost).
  // It comes back idle and waits; the owner pulled playback back by hand (a resume: the transfer first,
  // then the cluster's kept track and position). Done for him here: once, within 3 minutes of the loss.
  const active = W().activeDeviceId, playing = sp.store.getState().playback.status === 'playing';
  if (spk && was.active === spk && was.playing && active !== spk && !devs.some((x) => x.id === spk)) lostAt = Date.now();
  if (spk && lostAt && !active && devs.some((x) => x.id === spk)) {
    if (Date.now() - lostAt < 180_000) {
      window.alchemyLog?.('spotify: the speaker is back after losing its connection: resuming on it');
      void play(sp, 'play');
    }
    lostAt = 0;
  }
  // a resume asked for while the speaker was away (connect.ts): now that it is back, within half a minute
  if (spk && sp.wantPlay && devs.some((x) => x.id === spk)) {
    if (Date.now() - sp.wantPlay < 30_000) {
      window.alchemyLog?.('spotify: the speaker is back: the resume asked for meanwhile');
      void play(sp, 'play');
    }
    sp.wantPlay = 0;
  }
  was = { active, playing };
}
let movedAt = 0, fullAt = 0, lostAt = 0, was: { active: string | null | undefined; playing: boolean } = { active: null, playing: false };

export function observe(sp: Sp): () => void {
  const on: [string, (e: Event) => void][] = [
    ['wmp-spotify-auth', (e) => onAuth(sp, (e as CustomEvent<{ loggedIn?: boolean } | null>).detail?.loggedIn)],
    ['wmp-spotify-state', (e) => onState(sp, (e as CustomEvent<PlayerState>).detail)],
    ['wmp-spotify-devices', (e) => onDevices(sp, (e as CustomEvent<unknown>).detail)],
    // the host's speaker named its track: the state it left bare is read again
    ['wmp-speaker-track', () => { if (sp.last) onState(sp, sp.last, true); }],
  ];
  show(wasLoggedIn());
  for (const [t, f] of on) window.addEventListener(t, f);
  // the host's own player (CONTRACT v10), where it has one: its reports
  const offHost = hostPlayer.subscribe(() => onHostPlayer(sp));
  onDevices(sp, W().devices);
  if (W().state) onState(sp, W().state as PlayerState);
  onHostPlayer(sp);
  onAuth(sp, W().loggedIn);
  return () => { for (const [t, f] of on) window.removeEventListener(t, f); offHost(); };
}

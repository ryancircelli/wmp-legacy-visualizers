// Connect-state commands: the player command the web player sends itself, from our device to
// whichever device is playing. A command that fails (network, or non-2xx: Spotify's own account
// rules) goes to the host's mediaCmd (SMTC) instead — that command only, never the session.
import { LIKED, positionNow, type Playback, type RepeatMode } from '../../model';
import { optimistic, pausedPatch } from '../host/media';
import { query } from './pathfinder';
import { W, post, status, type Sp } from './sp';
import { transport as via } from './transport';

const authed = () => via().authed();

const SPCLIENT = 'gue1-spclient.spotify.com';   // the host the web player used in spike 2

/** The spclient host the page itself uses (resource timing), else spike 2's. */
export function spclient(): string {
  if (W().spclient) return W().spclient!;
  const es = performance.getEntriesByType?.('resource') ?? [];
  for (let i = es.length - 1; i >= 0; i--) {
    const m = /^https:\/\/([a-z0-9-]*spclient[a-z0-9.-]*\.spotify\.com)\/connect-state\//.exec(es[i]!.name);
    if (m) return m[1]!;
  }
  return SPCLIENT;
}

export type Cmd = { endpoint: string; value?: unknown } & Record<string, unknown>;

/** true when the player took it (2xx); false after the fallback ran (refused, offline, no device). */
/** Where a command goes: the active device, else the host's own speaker (iOS's librespot, while its
 *  session is up: the web view's player is hidden there and heard by nothing), else this page's player.
 *  An active device that is this page counts as none, for the same reason. */
export function target(w: ReturnType<typeof W>): string | null | undefined {
  const active = w.activeDeviceId && w.activeDeviceId !== w.deviceId ? w.activeDeviceId : '';
  return active || window.__wmpSpeaker?.id || w.deviceId;
}

export async function command(sp: Sp, cmd: Cmd, orElse?: (() => void) | null, retried = false): Promise<boolean> {
  const w = W(), to = target(w);
  // The host's log (a no-op on the website): what a command was sent as, and how it went.
  const log = (how: string) => window.alchemyLog?.('spotify: ' + cmd.endpoint + ' from ' + (w.deviceId || '-').slice(0, 8)
    + ' to ' + (to || '-').slice(0, 8) + ': ' + how);
  if (!authed() || !w.deviceId || !to) { log(!authed() ? 'no token' : 'no device'); orElse?.(); return false; }
  // The host's speaker, not yet the active device, has no session to act on: a resume there is taken
  // (200) and does nothing (librespot: "context is not available"). A transfer hands it Spotify's
  // remembered session first, as a pick in a device list does; a play carries its own context.
  if (to === window.__wmpSpeaker?.id && to !== w.activeDeviceId && cmd.endpoint !== 'play' && !retried) {
    log('speaker idle: transferring first');
    await transfer(sp, to);
    return command(sp, cmd, orElse, true);
  }
  const url = 'https://' + spclient() + '/connect-state/v1/player/command/from/' + w.deviceId + '/to/' + to;
  try {
    const r = await post(sp, url, { command: cmd });
    if (r.status >= 200 && r.status < 300) { log(String(r.status)); return true; }
    const msg = (r.json as { error?: { message?: string } } | null)?.error?.message;
    log(r.status + ' ' + (msg || ''));
    // 410 Gone: the active device went away while this page was in the background (the phone,
    // measured) and the cluster that said so was missed. Forget it and play here, once.
    if (r.status === 410 && to !== w.deviceId && !retried) {
      if (window.__wmpSpotify) window.__wmpSpotify.activeDeviceId = '';
      return command(sp, cmd, orElse, true);
    }
    // A resume to the host's speaker while it is away (the app was suspended in the background, paused;
    // back in front, its session takes a few seconds to come up again: 502, then 404, 2026-10-03): kept,
    // and played when the speaker is back (observers.ts onDevices).
    if (to === window.__wmpSpeaker?.id && cmd.endpoint === 'resume' && (r.status === 404 || r.status >= 500)) {
      if (window.__wmpSpotify) window.__wmpSpotify.activeDeviceId = '';
      sp.wantPlay = Date.now();
      status(sp, 'Spotify: reconnecting…');
      return false;
    }
    status(sp, 'Spotify: ' + (msg || 'command refused (' + r.status + ')'));
  } catch { log('offline'); status(sp, 'Spotify: command failed (offline)'); }
  orElse?.();
  return false;
}

export type Transport = 'playpause' | 'play' | 'pause' | 'next' | 'prev' | 'seek';
/** Play/pause/next/prev/seek (ms) through connect-state, falling back to the host per command.
 *  Optimistic: the playback slice shows the result at once (next/prev: playing from 0; the track
 *  itself comes with the state), rolled back if the player refuses. */
export function transport(sp: Sp, cmd: Transport, posMs?: number): Promise<void> {
  const st = sp.store;
  if (cmd === 'playpause') cmd = st.getState().playback.status === 'playing' ? 'pause' : 'play';
  const ms = Math.round(+(posMs ?? 0) || 0), now = Date.now();
  const c: Cmd = cmd === 'play' ? { endpoint: 'resume' } : cmd === 'pause' ? { endpoint: 'pause' }
    : cmd === 'next' ? { endpoint: 'skip_next' } : cmd === 'prev' ? { endpoint: 'skip_prev' }
    : { endpoint: 'seek_to', value: ms };
  const patch: Partial<Playback> = cmd === 'play' || cmd === 'pause' ? pausedPatch(st, cmd === 'pause')
    : cmd === 'seek' ? { position: ms, at: now } : { status: 'playing', paused: false, position: 0, at: now };
  const k = cmd;
  return optimistic(st, patch, () => command(sp, c, () => sp.fallback(k, k === 'seek' ? posMs : undefined)));
}

/** WMP's Stop: pause and back to the start. */
export function stop(sp: Sp): Promise<void> {
  return optimistic(sp.store, { status: 'paused', paused: true, position: 0, at: Date.now() }, async () => {
    const [a, b] = await Promise.all([command(sp, { endpoint: 'pause' }, () => sp.fallback('pause')),
                                      command(sp, { endpoint: 'seek_to', value: 0 }, () => sp.fallback('seek', 0))]);
    return a && b;
  });
}

/** The player's volume (PUT connect-state/v1/connect/volume, 0..65535 as the web player sends it).
 *  ponytail: one-way — a change made in another Spotify client is not read back into the slider
 *  (the cluster's devices[id].volume has it). */
export function volume(sp: Sp, pct: number): boolean {
  const w = W(), to = target(w);
  if (!sp.hasState || !authed() || !w.deviceId || !to) return false;
  // This device, on a host whose page cannot set its own volume (iOS): the host sets the system's.
  // The host's own speaker too, and that is all it gets: it plays at full and the system's volume is
  // the one to turn. A Connect volume sent to it turned librespot's own level down instead (the wheel
  // left it at 13 %, the phone's volume untouched: "volume control with wheel broke audio").
  const spk = window.__wmpSpeaker?.id;
  if (to === w.deviceId || to === spk) window.alchemySetVolume?.(Math.max(0, Math.min(100, +pct || 0)));
  if (to === spk) return true;
  const url = 'https://' + spclient() + '/connect-state/v1/connect/volume/from/' + w.deviceId + '/to/' + to;
  const value = Math.round((Math.max(0, Math.min(100, +pct || 0)) / 100) * 65535);
  const now = Date.now();
  sp.sentVolume = sp.sentVolume.filter((x) => now - x.at < 1500).concat({ value, at: now });
  post(sp, url, { volume: value }, 'PUT').then((r) => {
    if (r.status < 200 || r.status >= 300) status(sp, 'Spotify: volume refused (' + r.status + ')');
  }, () => {});
  return true;
}

/** The host's own speaker back at full: its level is not ours to turn (volume, above), and one turned
 *  down by an earlier page or by another Spotify client's slider stays down, kept across launches. */
export function speakerFull(sp: Sp, id: string): void {
  const w = W();
  if (!authed() || !w.deviceId) return;
  window.alchemyLog?.('spotify: the speaker was turned down: back to full');
  const now = Date.now();
  sp.sentVolume = sp.sentVolume.filter((x) => now - x.at < 1500).concat({ value: 65535, at: now });
  post(sp, 'https://' + spclient() + '/connect-state/v1/connect/volume/from/' + w.deviceId + '/to/' + id, { volume: 65535 }, 'PUT').catch(() => {});
}

/** The device's own volume (the cluster's devices[id].volume, 0..65535) -> the slider and mute.
 *  Our own PUT echoing back within 1.5 s is not a change. 0 while unmuted = muted with the level
 *  kept (unmute restores it); a level while muted = unmuted at that level. Never PUTs back. */
export function deviceVolume(sp: Sp, raw: number): void {
  if (!Number.isFinite(raw)) return;
  const now = Date.now();
  if (sp.sentVolume.some((x) => Math.abs(raw - x.value) <= 1 && now - x.at < 1500)) return;
  const { settings, actions } = sp.store.getState();
  const pct = Math.round((Math.max(0, Math.min(65535, raw)) / 65535) * 100);
  const p = raw === 0 ? (settings.muted ? null : { muted: true })
    : settings.muted || pct !== settings.volume ? { muted: false, volume: pct } : null;
  if (!p) return;
  sp.fromDevice = true;
  try { actions.setSettings(p); } finally { sp.fromDevice = false; }
}

/** Rewind / Fast Forward: seconds relative to the shown position (optimistic seeks included). */
export function skip(sp: Sp, sec: number): void {
  if (!sp.last?.track) return;
  const dur = +(sp.last.duration ?? 0) || 0;
  let to = Math.max(0, positionNow(sp.store.getState()) + sec * 1000);
  if (dur) to = Math.min(to, dur - 1);
  void transport(sp, 'seek', to);
}

/** Repeat as shown (the state's options, or an optimistic change awaiting it). */
export function repeatMode(sp: Sp): RepeatMode {
  return sp.store.getState().playback.repeat;
}
export function setRepeat(sp: Sp, m: RepeatMode): Promise<void> {
  if (m === repeatMode(sp)) return Promise.resolve();
  // One set_options (what the web player's own client has), not two set_repeating_* commands: those
  // race and one is lost (measured live: Off -> Track left context off, Track -> Off left track on).
  return optimistic(sp.store, { repeat: m },
    () => command(sp, { endpoint: 'set_options', repeating_context: m !== 'off', repeating_track: m === 'track' }));
}
export function cycleRepeat(sp: Sp): Promise<void> {
  const m = repeatMode(sp);
  return setRepeat(sp, m === 'off' ? 'context' : m === 'context' ? 'track' : 'off');
}
export function toggleShuffle(sp: Sp): Promise<void> {
  const on = !sp.store.getState().playback.shuffle;
  return optimistic(sp.store, { shuffle: on }, () => command(sp, { endpoint: 'set_shuffling_context', value: on }));
}

/** The web player's Liked Songs context, spotify:user:<username>:collection (sp.ts LIKED_CTX):
 *  learned from a state that played it, else from profileAttributes (the query the page sends
 *  itself at load; its hash from W.hashes or the scan, none baked). null = unknown. */
export async function likedContext(sp: Sp): Promise<string | null> {
  if (!sp.liked) {
    const d = await query<{ me?: { profile?: { uri?: string; username?: string } } }>(sp, 'profileAttributes', {}, { quiet: true }).catch(() => null);
    const p = d?.me?.profile, user = p?.uri || (p?.username ? 'spotify:user:' + encodeURIComponent(p.username) : '');
    if (/^spotify:user:[^:]+$/.test(user)) sp.liked = user + ':collection';
  }
  return sp.liked ?? null;
}

/** A context (playlist/album/artist/station, LIKED), optionally starting at one of its tracks.
 *  shuffle: the play turns shuffle on with it (player_options_override), whatever the old context had. */
export async function playContext(sp: Sp, ctx: string, track?: string | null, shuffle = false): Promise<void> {
  if (ctx === LIKED) {
    const liked = await likedContext(sp);
    if (!liked) {   // no username known: the track in its album, as before Liked Songs had a context
      const t = track ?? sp.cache.lists.get(LIKED)?.[0]?.uri, al = t && sp.cache.tracks.get(t)?.albumUri;
      return t ? playContext(sp, al || t, al ? t : null, shuffle) : undefined;
    }
    ctx = liked;
  }
  const c: Cmd = { endpoint: 'play', context: { uri: ctx, url: 'context://' + ctx },
                   play_origin: { feature_identifier: 'playlist', feature_version: 'xpui' } };
  // options always present, even empty: librespot's play command requires the field (an absent
  // one is "unknown endpoint" → 400), so a shelf play with no starting track died on the speaker.
  const o: Record<string, unknown> = {};
  if (track) o.skip_to = { track_uri: track };
  if (shuffle) o.player_options_override = { shuffling_context: true };
  c.options = o;
  await command(sp, c, null);
}

/** Add to queue: the web player's add_to_queue (the track marked queued, from the queue provider).
 *  The queue (queue.next) follows from the cluster Spotify pushes next. */
export function addToQueue(sp: Sp, uri: string): Promise<void> {
  return command(sp, { endpoint: 'add_to_queue', track: { uri, metadata: { is_queued: 'true' }, provider: 'queue' } }, null).then(() => {});
}

/** Connect transfer (spike 3 §3). The target lights at once (pending 'device'); the cluster push
 *  that follows confirms it, a refusal puts the old device back. */
export function transfer(sp: Sp, id: string): Promise<void> {
  const w = W();
  if (!authed() || !w.deviceId) return Promise.resolve();
  const url = 'https://' + spclient() + '/connect-state/v1/connect/transfer/from/' + w.deviceId + '/to/' + id;
  const light = () => {
    const { devices, actions } = sp.store.getState(), before = devices.list;
    actions.setDevices(before.map((d) => ({ ...d, active: d.id === id })));
    return () => { if (sp.store.getState().devices.list !== before) sp.store.getState().actions.setDevices(before); };
  };
  return optimistic(sp.store, {}, async () => {
    // 'restore' resumes whatever the state says, and an idle session (no active device) keeps a stale
    // is_paused:false: it would start playing on the target. Only a session actually playing moves playing.
    const playing = !!W().activeDeviceId && sp.store.getState().playback.status === 'playing';
    try {
      const r = await post(sp, url, { transfer_options: { restore_paused: playing ? 'restore' : 'pause' } });
      const ok = r.status >= 200 && r.status < 300;
      status(sp, ok ? 'Moving playback…' : 'Spotify: could not move playback (' + r.status + ')');
      return ok;
    } catch { status(sp, 'Spotify: could not move playback'); return false; }
  }, { field: 'device', apply: light });
}

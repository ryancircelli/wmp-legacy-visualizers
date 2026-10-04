// player_state -> playback + queue (CONTRACT v6.1). Every number in it is a string; is_playing
// stays true while paused, so is_paused is the one to read (SPIKE2.md §3).
import { LIKED, type Playback, type Track } from '../../model';
import { setSession } from '../host/media';
import * as hostPlayer from '../host/player';
import { fetchCollectionPage, midImage, remember, trackRow } from './library';
import { query } from './pathfinder';
import { hostLive } from './player';
import { LIKED_CTX, W, cap, kindOf, type PlayerState, type Sp } from './sp';

export function img(u: string | undefined): string | null {
  const m = /^spotify:image:([0-9a-f]+)$/.exec(u || '');
  return m ? 'https://i.scdn.co/image/' + m[1] : u || null;
}

/** An album cover's address at its largest size. Spotify's cover ids carry the size in a fixed prefix
 *  (ab67616d0000 + 4851 the 64 px, 1e02 the 300 px, b273 the 640 px, then the cover's own hash), so the
 *  640 px one needs no lookup: a list row's thumbnail or a state's 300 px cover becomes it. Anything
 *  else (a playlist's mosaic, an artist's picture, a data URL) is returned as it is. */
export function bigCover(u: string | null | undefined): string | null {
  return u ? u.replace(/(\/image\/ab67616d0000)(?:4851|1e02)(?=[0-9a-f]{24}$)/, '$1b273') : null;
}
const none = (a: string[] | undefined) => !a || !a.length;

/** The context's name: the state's own description, the current track's album title when the
 *  context is that album, a library row we already hold, else what loadTracks learned — until
 *  then, the kind of thing it is. */
function contextName(sp: Sp, ps: PlayerState): string {
  const ctx = ps.context_uri ?? '', cm = ps.context_metadata ?? {}, md = ps.track?.metadata ?? {};
  if (sp.ctxNames[ctx]) return sp.ctxNames[ctx];
  if (cm.context_description) return (sp.ctxNames[ctx] = cm.context_description);
  if (md.album_uri === ctx && md.album_title) return (sp.ctxNames[ctx] = md.album_title);
  const known = sp.cache.names.get(ctx);
  if (known) return (sp.ctxNames[ctx] = known);
  const k = kindOf(ctx);
  return k ? cap(k) : 'Spotify';
}
/** "Playlist: lawnmower classics", "Album: Silver Side Up" — or just the kind until the name is known. */
export function fromText(sp: Sp, ps: PlayerState): string {
  if (LIKED_CTX.test(ps.context_uri ?? '')) return 'Liked Songs';
  const k = kindOf(ps.context_uri), name = contextName(sp, ps), label = k ? cap(k) : 'Spotify';
  return name === label ? label : label + ': ' + name;
}

/** A track row some fetch returned for this uri (the enrichment cache), else the queue's. */
function rowFor(sp: Sp, uri: string | undefined): Track | undefined {
  if (!uri) return undefined;
  return sp.cache.tracks.get(uri) ?? sp.store.getState().queue.next.find((x) => x.uri === uri);
}
/** The artist's name: the state's own, a row we hold, else the artist being played as a context
 *  (artist-context plays carry artist_uri but no artist_name). */
function artistName(sp: Sp, uri: string | undefined, ctx: string | undefined, md: Record<string, string>): string {
  if (md.artist_name) return md.artist_name;
  const row = rowFor(sp, uri);
  if (row?.artist) return row.artist;
  // an episode in its show: the show's name (fetchShows remembered it)
  const a = md.artist_uri || (/^spotify:(artist|show):/.test(ctx ?? '') ? ctx : undefined);
  return (a && sp.cache.names.get(a)) || '';
}
/** Episodes' state metadata keys are not the tracks' (unconfirmed): each episode's keys go to the host's log once. */
const toldEpisodes = new Set<string>();

/** What the host's own speaker says it is playing (CONTRACT: __wmpSpeakerTrack), when it is this uri. */
function speakerTrack(uri?: string | null) {
  const t = window.__wmpSpeakerTrack;
  return t && uri && t.uri === uri && t.title ? t : null;
}

/** A track by uri: the web player's getTrack (data.trackUnion: name, duration, albumOfTrack, the
 *  artists as firstArtist + otherArtists), as the row a list gives plus `art`, the cover near 300 px
 *  (the state's image_url); remembered for rowFor. null for an episode or no such track. */
export async function fetchTrack(sp: Sp, uri: string): Promise<Track | null> {
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri)) return null;
  type Artists = { items?: unknown[] };
  type D = { trackUnion?: { artists?: Artists; firstArtist?: Artists; otherArtists?: Artists; albumOfTrack?: { coverArt?: { sources?: unknown[] } } } | null };
  const u = (await query<D>(sp, 'getTrack', { uri }, { quiet: true })).trackUnion;
  const row = u && trackRow({ ...u, artists: u.artists ?? { items: [...(u.firstArtist?.items ?? []), ...(u.otherArtists?.items ?? [])] } }, null, uri);
  if (!row) return null;
  const t: Track = { ...row, art: midImage(u.albumOfTrack?.coverArt?.sources) ?? null };
  remember(sp, [t]);
  return t;
}
/** fetchTrack once per uri for a track the state names by uri alone (librespot sends no metadata),
 *  the state re-read when it lands. The uri stays in sp.loading after: a track Spotify could not name
 *  is not asked again; a failed request is, with the next state. */
function want(sp: Sp, uri: string): void {
  if (uri in sp.loading) return;
  sp.loading[uri] = fetchTrack(sp, uri).then((t) => { if (t && sp.last) onState(sp, sp.last, true); },
                                             () => { delete sp.loading[uri]; });
}

/** The playback slice for a state. A state with no active device is Spotify's memory of the
 *  last session, not something playing anywhere: shown paused, the clock standing still. */
export function toPlayback(sp: Sp, ps: PlayerState): Partial<Playback> {
  const t = ps.track ?? {}, md = t.metadata ?? {}, rs = ps.restrictions ?? {};
  const own = speakerTrack(t.uri); // the host's speaker, on what it plays itself
  // The speaker's own word that it is paused, and where, wins over a state that still says playing: a
  // pause from Control Center with the app in the background reached the speaker and not this page
  // (the app was suspended before Spotify's update came: the clock had run to the end on return, 2026-10-03).
  const held = !!own && !own.playing && W().activeDeviceId === window.__wmpSpeaker?.id;
  const now = Date.now(), paused = !!ps.is_paused || !W().activeDeviceId || held, speed = +(ps.playback_speed ?? 1) || 1;
  const pos = held && !ps.is_paused ? own.position
    : (+(ps.position_as_of_timestamp ?? 0) || 0) + (paused ? 0 : (now - (+(ps.timestamp ?? 0) || now)) * speed);
  const row = rowFor(sp, t.uri);   // what librespot leaves out (it sends the uri alone)
  const dur = +(ps.duration ?? 0) || +(md.duration ?? 0) || own?.duration || row?.duration || 0;
  const o = ps.options ?? {}, repeat = o.repeating_track ? 'track' : o.repeating_context ? 'context' : 'off';
  if (ps.options) { note(sp, 'cluster.shuffle', !!o.shuffling_context); note(sp, 'cluster.repeat', repeat); }
  const ctx = LIKED_CTX.test(ps.context_uri ?? '') ? LIKED : ps.context_uri;   // Liked Songs: its library uri
  return hostOver(sp, {
    status: !t.uri ? 'stopped' : paused ? 'paused' : 'playing', source: 'spotify', paused, at: now,
    position: Math.max(0, dur ? Math.min(pos, dur) : pos),
    track: t.uri ? { uri: t.uri, title: md.title || own?.title || row?.title || '',
                     artist: md.artist_name || own?.artist || artistName(sp, t.uri, ctx, md),
                     album: md.album_title || own?.album || row?.album || (/^spotify:show:/.test(ctx ?? '') && sp.cache.names.get(ctx!)) || '', duration: dur,
                     art: bigCover(img(md.image_url || md.image_large_url) || own?.art || row?.art || row?.image || null), ctx: ctx ?? null } : null,
    canSeek: !!t.uri && none(rs.disallow_seeking_reasons),
    canNext: !!t.uri && none(rs.disallow_skipping_next_reasons),
    canPrev: !!t.uri && none(rs.disallow_skipping_prev_reasons),
    shuffle: !!o.shuffling_context,
    repeat,
    context: ctx === LIKED ? { uri: LIKED, kind: 'liked', label: 'Liked Songs' }
      : ctx && /^spotify:(playlist|album|artist|show):/.test(ctx) ? { uri: ctx, kind: kindOf(ctx), label: fromText(sp, ps) } : null,
    from: t.uri ? fromText(sp, ps) : '',
    app: 'Spotify',
  }, ctx ?? null);
}

/** A source's shuffle or repeat as seen: when it last changed (0 = as first seen). */
function note(sp: Sp, k: string, v: unknown): void {
  const o = sp.opts[k];
  if (!o) sp.opts[k] = { v, at: 0 };
  else if (o.v !== v) sp.opts[k] = { v, at: Date.now() };
}
/** The host's next report of shuffle and repeat counts as a change even with the same value: it follows
 *  a toggle or a play sent from here, after which the host's are right (player/host.ts). */
export function trustHost(sp: Sp): void {
  for (const k of ['host.shuffle', 'host.repeat']) sp.opts[k] = { v: null, at: sp.opts[k]?.at ?? 0 };
}
/** The host's shuffle or repeat over the cluster's: only when it changed last. */
const hostWins = (sp: Sp, f: string) => (sp.opts['host.' + f]?.at ?? -1) > (sp.opts['cluster.' + f]?.at ?? -1);

/** The host's own player, while it is in charge (player/ hostLive): what plays, in its own word, its
 *  position true at its `at`; the context, "Playing from", the restrictions and the queue stay the
 *  cluster's. A track the cluster has no state for yet is shown all the same (skippable then). Shuffle
 *  and repeat are whichever source changed them last: the host's are stale once it has taken the
 *  playback (its own settings from before, not the session's) and say nothing of a play another client
 *  started with its own. */
function hostOver(sp: Sp, p: Partial<Playback>, ctx: string | null): Partial<Playback> {
  const h = hostLive();
  if (!h) return p;
  // a track still loading comes bare (its uri alone): named from the cluster's state, else the queue's row
  const same: Partial<Track> | null = p.track?.uri === h.uri ? p.track : h.loading ? rowFor(sp, h.uri) ?? null : null;
  const now = Date.now(), paused = !h.playing;
  const dur = h.duration || same?.duration || 0, pos = h.position + (paused || h.loading ? 0 : now - h.at);
  return {
    // loading: still 'playing' to the eye, its clock held (paused) until the track plays
    ...p, status: !h.uri ? 'stopped' : paused ? 'paused' : 'playing', paused: paused || !!h.loading, at: now,
    position: Math.max(0, dur ? Math.min(pos, dur) : pos),
    shuffle: hostWins(sp, 'shuffle') ? h.shuffle : p.shuffle, repeat: hostWins(sp, 'repeat') ? h.repeat : p.repeat,
    track: h.uri ? { uri: h.uri, title: h.title || same?.title || '', artist: h.artist || same?.artist || '',
                     album: h.album || same?.album || '', duration: dur, art: bigCover(h.art || same?.art || same?.image || null), ctx } : null,
    ...(p.track ? {} : { canSeek: !!h.uri, canNext: !!h.uri, canPrev: !!h.uri }),
  };
}

/** The host's player reported (CONTRACT v10 'wmp-player'): the playback read again. Its word, while
 *  it is in charge, is the player's answer (a pending optimistic change gives way); otherwise the last
 *  state is only re-read. Before any state from Spotify, its track alone. */
export function onHostPlayer(sp: Sp): void {
  const s = hostPlayer.state();
  if (!s) return;                                    // a host without one: nothing of it to read
  note(sp, 'host.shuffle', s.shuffle); note(sp, 'host.repeat', s.repeat);
  const live = !!hostLive();
  if (sp.last) return onState(sp, sp.last, !live);
  if (!live) return;
  sp.hasState = true;
  setSession(sp.store, toPlayback(sp, {}));
}

/** A player state: it wins over any optimistic change. `replay` = the last state again, re-read
 *  because a name arrived (a context's tracks, an artist, a track): an optimistic change still pending keeps
 *  its fields then, it is not an answer from the player. */
export function onState(sp: Sp, ps: PlayerState | null | undefined, replay = false): void {
  if (!ps) return;
  sp.hasState = true;
  sp.last = ps;
  if (LIKED_CTX.test(ps.context_uri ?? '')) sp.liked = ps.context_uri;
  const st = sp.store.getState(), p = toPlayback(sp, ps);
  let pending = replay ? st.playback.pending : null;
  // A seek still pending against a state that does not show it: Spotify pushes a cluster on the
  // command's receipt, before the device has sought, and that one would snap the slider back for a
  // moment. The seek's position stays until a state within 1.5 s of it, or optimistic()'s 2 s.
  const pend = st.playback.pending;
  if (!pending && pend?.fields.includes('position') && Date.now() - pend.since < 2000) {
    const shown = st.playback.position + (st.playback.paused ? 0 : Date.now() - st.playback.at);
    if (Math.abs((p.position ?? 0) - shown) > 1500) { p.position = shown; p.at = Date.now(); pending = pend; }
  }
  const keep: Record<string, unknown> = {};
  if (pending) for (const f of pending.fields) if (f in st.playback) keep[f] = st.playback[f as keyof typeof st.playback];
  setSession(sp.store, p);
  if (pending) sp.store.getState().actions.setPlayback({ ...keep, pending });
  // The playing context is fetched by itself: it names the "Playing from" row and the queue.
  const ctx = p.context?.uri;
  if (ctx && /^spotify:(playlist|album):/.test(ctx) && !sp.cache.lists.has(ctx) && !sp.loading[ctx]) {
    sp.loading[ctx] = fetchCollectionPage(sp, ctx, 0, true).catch(() => {}).finally(() => { delete sp.loading[ctx]; });
  }
  // A device that sends the uri alone (librespot, the app's own speaker; the web player and Spotify's
  // apps send metadata): getTrack names the track, its cover at full size.
  const uri = p.track?.uri, bare = !!uri && !ps.track?.metadata?.title;
  const h = hostLive();
  if (bare && !speakerTrack(uri) && !(h?.uri === uri && h.title) && !rowFor(sp, uri)?.art) want(sp, uri);
  if (uri?.startsWith('spotify:episode:') && !toldEpisodes.has(uri)) {
    toldEpisodes.add(uri);
    window.alchemyLog?.('spotify: episode ' + uri.slice(16) + ' metadata keys: ' + (Object.keys(ps.track?.metadata ?? {}).sort().join(', ') || 'none')
      + (p.track?.title ? '' : ' (unnamed)'));
  }
  // Up Next: the web player sends metadata for the first queued track only, librespot for none; the
  // rest are named from rows the fetches returned (the playing context's first page above), left out
  // until then; a bare device's by getTrack once that page is in (30 asked at most).
  // Each row's place in next_tracks is kept (sp.queueAt): an edit of Up Next (queue.ts) maps back through it.
  const next: Track[] = [], at: number[] = [], ask = bare && !(ctx && sp.loading[ctx] && !sp.cache.lists.has(ctx));
  let n = 30;
  for (const [i, t] of (ps.next_tracks ?? []).entries()) {
    if (!t?.uri || !/^spotify:(track|episode):/.test(t.uri)) continue;
    const m = t.metadata ?? {}, k = rowFor(sp, t.uri);
    // its cover too (the web player sends image_url with the first queued track): the Queue's tile and rows show it
    const pic = img(m.image_small_url || m.image_url) ?? k?.image;
    const row: Track | null = m.title ? { uri: t.uri, title: m.title, artist: artistName(sp, t.uri, ctx, m), album: m.album_title || k?.album || '', duration: 0,
                                          ctx: ctx ?? null, ...(pic ? { image: pic, art: bigCover(pic) } : {}) }
      : k ? { ...k, ctx: ctx ?? null, ...(k.art || !k.image ? {} : { art: bigCover(k.image) }) } : null;
    if (row) { next.push(row); at.push(i); } else if (ask && n-- > 0) want(sp, t.uri);
    if (next.length === 30) break;
  }
  sp.queueAt = at;
  sp.store.getState().actions.setQueue(next);
}

// player_state -> playback + queue (CONTRACT v6.1). Every number in it is a string; is_playing
// stays true while paused, so is_paused is the one to read (SPIKE2.md §3).
import { LIKED, type Playback, type Track } from '../../model';
import { setSession } from '../host/media';
import { fetchCollectionPage, midImage, remember, trackRow } from './library';
import { query } from './pathfinder';
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
  const a = md.artist_uri || (/^spotify:artist:/.test(ctx ?? '') ? ctx : undefined);
  return (a && sp.cache.names.get(a)) || '';
}

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
  const now = Date.now(), paused = !!ps.is_paused || !W().activeDeviceId, speed = +(ps.playback_speed ?? 1) || 1;
  const pos = (+(ps.position_as_of_timestamp ?? 0) || 0) + (paused ? 0 : (now - (+(ps.timestamp ?? 0) || now)) * speed);
  const row = rowFor(sp, t.uri);   // what librespot leaves out (it sends the uri alone)
  const own = speakerTrack(t.uri); // the host's speaker, on what it plays itself
  const dur = +(ps.duration ?? 0) || +(md.duration ?? 0) || own?.duration || row?.duration || 0;
  const o = ps.options ?? {};
  const ctx = LIKED_CTX.test(ps.context_uri ?? '') ? LIKED : ps.context_uri;   // Liked Songs: its library uri
  return {
    status: !t.uri ? 'stopped' : paused ? 'paused' : 'playing', source: 'spotify', paused, at: now,
    position: Math.max(0, dur ? Math.min(pos, dur) : pos),
    track: t.uri ? { uri: t.uri, title: md.title || own?.title || row?.title || '',
                     artist: md.artist_name || own?.artist || artistName(sp, t.uri, ctx, md),
                     album: md.album_title || own?.album || row?.album || '', duration: dur,
                     art: bigCover(img(md.image_url || md.image_large_url) || own?.art || row?.art || row?.image || null), ctx: ctx ?? null } : null,
    canSeek: !!t.uri && none(rs.disallow_seeking_reasons),
    canNext: !!t.uri && none(rs.disallow_skipping_next_reasons),
    canPrev: !!t.uri && none(rs.disallow_skipping_prev_reasons),
    shuffle: !!o.shuffling_context,
    repeat: o.repeating_track ? 'track' : o.repeating_context ? 'context' : 'off',
    context: ctx === LIKED ? { uri: LIKED, kind: 'liked', label: 'Liked Songs' }
      : ctx && /^spotify:(playlist|album|artist|show):/.test(ctx) ? { uri: ctx, kind: kindOf(ctx), label: fromText(sp, ps) } : null,
    from: t.uri ? fromText(sp, ps) : '',
    app: 'Spotify',
  };
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
  if (bare && !speakerTrack(uri) && !rowFor(sp, uri)?.art) want(sp, uri);
  // Up Next: the web player sends metadata for the first queued track only, librespot for none; the
  // rest are named from rows the fetches returned (the playing context's first page above), left out
  // until then; a bare device's by getTrack once that page is in (30 asked at most).
  const next: Track[] = [], ask = bare && !(ctx && sp.loading[ctx] && !sp.cache.lists.has(ctx));
  let n = 30;
  for (const t of ps.next_tracks ?? []) {
    if (!t?.uri || !/^spotify:(track|episode):/.test(t.uri)) continue;
    const m = t.metadata ?? {}, k = rowFor(sp, t.uri);
    // its cover too (the web player sends image_url with the first queued track): the Queue's tile and rows show it
    const pic = img(m.image_small_url || m.image_url) ?? k?.image;
    if (m.title) next.push({ uri: t.uri, title: m.title, artist: artistName(sp, t.uri, ctx, m), album: m.album_title || k?.album || '', duration: 0, ctx: ctx ?? null,
                             ...(pic ? { image: pic } : {}) });
    else if (k) next.push({ ...k, ctx: ctx ?? null });
    else if (ask && n-- > 0) want(sp, t.uri);
    if (next.length === 30) break;
  }
  sp.store.getState().actions.setQueue(next);
}

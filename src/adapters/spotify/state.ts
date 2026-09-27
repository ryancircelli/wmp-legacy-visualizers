// player_state -> playback + queue (CONTRACT v6.1). Every number in it is a string; is_playing
// stays true while paused, so is_paused is the one to read (SPIKE2.md §3).
import type { Playback, Track } from '../../model';
import { setSession } from '../host/media';
import { fetchCollectionPage } from './library';
import { W, cap, kindOf, type PlayerState, type Sp } from './sp';

export function img(u: string | undefined): string | null {
  const m = /^spotify:image:([0-9a-f]+)$/.exec(u || '');
  return m ? 'https://i.scdn.co/image/' + m[1] : u || null;
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

/** The playback slice for a state. A state with no active device is Spotify's memory of the
 *  last session, not something playing anywhere: shown paused, the clock standing still. */
export function toPlayback(sp: Sp, ps: PlayerState): Partial<Playback> {
  const t = ps.track ?? {}, md = t.metadata ?? {}, rs = ps.restrictions ?? {};
  const now = Date.now(), paused = !!ps.is_paused || !W().activeDeviceId, speed = +(ps.playback_speed ?? 1) || 1;
  const pos = (+(ps.position_as_of_timestamp ?? 0) || 0) + (paused ? 0 : (now - (+(ps.timestamp ?? 0) || now)) * speed);
  const dur = +(ps.duration ?? 0) || +(md.duration ?? 0) || 0;
  const o = ps.options ?? {};
  const ctx = ps.context_uri;
  return {
    status: !t.uri ? 'stopped' : paused ? 'paused' : 'playing', source: 'spotify', paused, at: now,
    position: Math.max(0, dur ? Math.min(pos, dur) : pos),
    track: t.uri ? { uri: t.uri, title: md.title || '', artist: artistName(sp, t.uri, ctx, md),
                     album: md.album_title || rowFor(sp, t.uri)?.album || '',
                     duration: dur, art: img(md.image_url || md.image_large_url), ctx: ctx ?? null } : null,
    canSeek: !!t.uri && none(rs.disallow_seeking_reasons),
    canNext: !!t.uri && none(rs.disallow_skipping_next_reasons),
    canPrev: !!t.uri && none(rs.disallow_skipping_prev_reasons),
    shuffle: !!o.shuffling_context,
    repeat: o.repeating_track ? 'track' : o.repeating_context ? 'context' : 'off',
    context: ctx && /^spotify:(playlist|album|artist|show):/.test(ctx) ? { uri: ctx, kind: kindOf(ctx), label: fromText(sp, ps) } : null,
    from: t.uri ? fromText(sp, ps) : '',
    app: 'Spotify',
  };
}

/** A player state: it wins over any optimistic change. `replay` = the last state again, re-read
 *  because a name arrived (a context's tracks, an artist): an optimistic change still pending keeps
 *  its fields then, it is not an answer from the player. */
export function onState(sp: Sp, ps: PlayerState | null | undefined, replay = false): void {
  if (!ps) return;
  sp.hasState = true;
  sp.last = ps;
  const st = sp.store.getState(), p = toPlayback(sp, ps), pending = replay ? st.playback.pending : null;
  const keep: Record<string, unknown> = {};
  if (pending) for (const f of pending.fields) if (f in st.playback) keep[f] = st.playback[f as keyof typeof st.playback];
  setSession(sp.store, p);
  if (pending) sp.store.getState().actions.setPlayback({ ...keep, pending });
  // The playing context is fetched by itself: it names the "Playing from" row and the queue.
  const ctx = p.context?.uri;
  if (ctx && /^spotify:(playlist|album):/.test(ctx) && !sp.cache.lists.has(ctx) && !sp.loading[ctx]) {
    sp.loading[ctx] = fetchCollectionPage(sp, ctx, 0, true).catch(() => {}).finally(() => { delete sp.loading[ctx]; });
  }
  // Up Next: the web player sends metadata for the first queued track only; the rest are named
  // from rows the fetches returned (the playing context's first page above), left out until then.
  const next: Track[] = [];
  for (const t of ps.next_tracks ?? []) {
    if (!t?.uri || !/^spotify:(track|episode):/.test(t.uri)) continue;
    const m = t.metadata ?? {}, k = rowFor(sp, t.uri);
    if (m.title) next.push({ uri: t.uri, title: m.title, artist: artistName(sp, t.uri, ctx, m), album: m.album_title || k?.album || '', duration: 0, ctx: ctx ?? null });
    else if (k) next.push({ ...k, ctx: ctx ?? null });
    if (next.length === 30) break;
  }
  sp.store.getState().actions.setQueue(next);
}

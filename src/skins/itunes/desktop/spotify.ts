// Spotify's features iTunes 10 had no place for, as the window's own small pieces (docs/itunes-skin.md
// §3.1): radio from any collection (Genius from an album, a playlist, an artist), a shuffled play, a link
// copied, saving to Your Library, the songs this window has played (iTunes DJ's history above Up Next),
// the Canvas's place in the artwork pane, and the song Get Info opens on.
import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LIKED, type Track } from '../../../model';
import { canSave, shareUrl, useAddTo, useLibraryList, useShell, type Shell } from '../../../ui';
import { playUri } from '../shared/content';

/** Radio from a song, album, playlist or artist (Spotify's "Go to radio"; the iPod's Start Radio): the
 *  station seeded from it, played; the status note says when there is none. */
export async function radioFrom(sh: Shell, uri: string, title: string): Promise<void> {
  const name = title + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: uri, name, sub: '' }]).catch(() => [])).find((x) => x.name === name);
  const s = sh.store.getState();
  if (st) s.commands.playContext(st.uri, null);
  else s.actions.setStatus('No radio for ' + title);
}

/** Spotify's radio names for what a station is seeded from (a song's is iTunes' Genius) */
const RADIO: [RegExp, string][] = [[/^spotify:playlist:/, 'Playlist Radio'], [/^spotify:album:/, 'Album Radio'], [/^spotify:artist:/, 'Artist Radio']];
export const radioLabel = (uri: string): string | null => RADIO.find(([r]) => r.test(uri))?.[1] ?? null;

/** Shuffle on, then the collection (or artist, show) from a random song: WMP 9's Details pane's Shuffle. */
export function shufflePlay(sh: Shell, uri: string): void {
  const s = sh.store.getState();
  if (!s.playback.shuffle) s.commands.toggleShuffle();
  playUri(sh, uri);
}

/** iTunes' Copy iTunes Store URL, as the Spotify link (open.spotify.com/…), said in the LCD. */
export function copyLink(sh: Shell, uri: string): void {
  const url = shareUrl(uri), a = sh.store.getState().actions;
  if (!url) return;
  if (!navigator.clipboard) { a.setStatus('Could not copy the link'); return; }
  navigator.clipboard.writeText(url).then(() => a.setStatus('Link copied'), () => a.setStatus('Could not copy the link'));
}

/** Saved to Your Library: a song liked; an album, artist or playlist saved (followed). Spotify's own flag
 *  where it answers one (songs, albums, artists), else whether the library list holds it (playlists);
 *  nothing to save for the user's own playlists (WMP 9's Details pane's rule). */
export function useSave(uri: string | null) {
  const sh = useShell(), a = useAddTo(uri && canSave(uri) ? uri : null), lib = useLibraryList();
  const listed = uri ? lib.items.find((x) => x.uri === uri) : undefined;
  const saved = a.saved ?? (uri?.startsWith('spotify:playlist:') && !lib.loading ? !!listed : undefined);
  return {
    can: !!a.uri && !listed?.editable, saved,
    label: saveLabel(uri ?? '', !!saved),
    toggle: () => { if (uri) void sh.store.getState().commands.addTo(uri, LIKED, !saved); },
  };
}
/** Spotify's words: a song is liked, an artist followed, anything else saved to Your Library. */
export const saveLabel = (uri: string, saved: boolean): string =>
  uri.startsWith('spotify:track:') ? (saved ? 'Unlike' : 'Like')
  : uri.startsWith('spotify:artist:') ? (saved ? 'Unfollow' : 'Follow')
  : saved ? 'Remove from Your Library' : 'Save to Your Library';

// ---- iTunes DJ's history ------------------------------------------------------------------------------

/** how many played songs iTunes DJ shows above the playing one (iTunes' own default, "Display 10
 *  recently played songs") */
export const PLAYED = 10;

/** The songs this window has played this session, oldest first (Spotify gives the app no history of
 *  songs; its Recently Played is collections). A song played again moves to the end. */
export const played = create<{ list: Track[] }>(() => ({ list: [] }));

/** Logs each song as the next one takes its place (mounted with the window). */
export function usePlayedLog(): void {
  const sh = useShell();
  useEffect(() => sh.store.subscribe((s) => s.playback.track, (t, was) => {
    if (!was?.title || was.uri === t?.uri || !/^spotify:(track|episode):/.test(was.uri)) return;
    played.setState((p) => ({ list: [...p.list.filter((x) => x.uri !== was.uri), was].slice(-PLAYED) }));
  }), [sh]);
}

// ---- the window's own choices -------------------------------------------------------------------------

/** View > Show Canvas: the playing song's Canvas (Spotify's looping clip) in the artwork pane, where
 *  iTunes played a video; localStorage 'itunes.desktop' (a blocked storage keeps it for the session). */
export const desk = create<{ canvas: boolean }>()(persist((): { canvas: boolean } => ({ canvas: true }), { name: 'itunes.desktop', version: 1 }));

// ---- Get Info -----------------------------------------------------------------------------------------

let info: Track | null = null;
/** File > Get Info, a song's right-click Get Info: the song the dialog opens on. */
export function openInfo(sh: Shell, t: Track | null): void {
  info = t;
  if (t) sh.store.getState().actions.setUi({ dialog: 'info' });
}
export const infoTrack = (): Track | null => info;

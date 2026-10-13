// The right-click menus (iTunes' context menus, Windows 7's look): a song's, a cover's (an album,
// playlist, artist, show, mix on any grid) and a source's (a playlist or Music in the sidebar). Each is
// a Dropdown on a fixed point at the pointer, built as it opens.
import { useState, type MouseEvent } from 'react';
import { LIKED, type Track } from '../../../model';
import { canSave, Dropdown, isCollectionUri, useAddTo, useApp, useLibraryList, useShell, type MenuEntry, type TileItem } from '../../../ui';
import { isUnplayed, opensPage, playRow, playUri, startGenius, type TracksContent } from '../shared/content';
import type { Source } from '../shared/sources';
import { viewActions } from '../shared/state';
import { MENU } from './Chrome';
import { askDelete, copyLink, openInfo, radioFrom, radioLabel, shufflePlay, useSave } from './spotify';

const SEP = { sep: true } as const;

/** A menu at the pointer for one thing (`T`): `open` from a contextmenu event, `render` its Dropdown. */
function usePointerMenu<T>(owner: string) {
  const sh = useShell(), [at, setAt] = useState<{ x: number; y: number; it: T } | null>(null);
  return {
    it: at?.it ?? null,
    open: (it: T, e: MouseEvent) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY, it }); sh.store.getState().actions.setUi({ menu: owner }); },
    render: (items: () => MenuEntry[]) => (
      <Dropdown owner={owner} items={items} classes={MENU}>
        <span className="fixed w-1 h-1 pointer-events-none" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} aria-hidden="true" />
      </Dropdown>
    ),
  };
}

/** iTunes DJ's rows: Up Next starts at `from` (the played songs and the playing one above it) */
export interface QueueEdits { move: (a: number, b: number) => void; remove: (i: number) => void; from: number }

/** A song's menu: Play, Play Next (iTunes DJ's Up Next rows: Move to Top, Remove from Up Next), Like and
 *  Add to Playlist (an episode: Mark as Played / Unplayed), Show Album, Show Artist, Start Genius, Get Info,
 *  Copy Spotify Link. */
export function useRowMenu(queue?: QueueEdits) {
  const sh = useShell(), m = usePointerMenu<{ t: Track; i: number }>('row');
  const addTo = useAddTo(m.it && canSave(m.it.t.uri) ? m.it.t.uri : null), queues = useApp((s) => !!s.commands.addToQueue);
  const items = (): MenuEntry[] => {
    if (!m.it) return [];
    const { t, i } = m.it, s = sh.store.getState(), c = s.commands, artist = t.artistUris?.[0], album = t.albumUri, up = !!queue && i >= queue.from;
    const unplayed = isUnplayed(t, s.played), mark = c.markPlayed && t.uri.startsWith('spotify:episode:');
    return [
      { label: 'Play', act: () => playRow(sh, { kind: 'tracks', ctx: t.ctx ?? null } as TracksContent, t) },
      ...(queues && !up ? [{ label: 'Play Next', act: () => c.addToQueue?.(t.uri) }] : []),
      ...(up ? [{ label: 'Move to Top', disabled: i === queue.from, act: () => queue.move(i, queue.from) }, { label: 'Remove from Up Next', act: () => queue.remove(i) }] : []),
      SEP,
      ...(addTo.uri ? [{ label: addTo.saved ? 'Unlike' : 'Like', act: addTo.toggle }, addTo.playlistMenu('Add to Playlist'), SEP] : []),
      ...(mark ? [{ label: unplayed ? 'Mark as Played' : 'Mark as Unplayed', act: () => void c.markPlayed?.(t.uri, unplayed) }, SEP] : []),
      { label: 'Show Album', disabled: !album, act: () => { if (album) viewActions.open(album); } },
      { label: 'Show Artist', disabled: !artist, act: () => { if (artist) viewActions.open(artist); } },
      { label: 'Start Genius', disabled: !t.uri.startsWith('spotify:track:'), act: () => startGenius(sh, t.uri) },
      SEP,
      { label: 'Get Info', act: () => openInfo(sh, t) },
      { label: 'Copy Spotify Link', act: () => copyLink(sh, t.uri) },
    ];
  };
  return { onContextMenu: (t: Track, i: number, e: MouseEvent) => m.open({ t, i }, e), menu: m.render(items) };
}

/** A cover's menu (Grid, the store, Podcasts, Genius Mixes, Recently Played, search results, an artist's
 *  albums): Play, Shuffle, Open; Save to Your Library (or Follow, Like) and its radio; Copy Spotify Link. */
export function useTileMenu() {
  const sh = useShell(), m = usePointerMenu<TileItem>('tile'), uri = m.it?.uri ?? null, save = useSave(uri);
  const items = (): MenuEntry[] => {
    const it = m.it;
    if (!it) return [];
    const page = opensPage(it.uri), radio = radioLabel(it.uri);
    return [
      { label: 'Play', act: () => playUri(sh, it.uri) },
      ...(page ? [{ label: 'Shuffle', act: () => shufflePlay(sh, it.uri) }, { label: 'Open', act: () => viewActions.open(it.uri) }] : []),
      SEP,
      ...(save.can ? [{ label: save.label, act: save.toggle }] : []),
      ...(radio ? [{ label: 'Start ' + radio, act: () => void radioFrom(sh, it.uri, it.name) }] : []),
      ...(it.uri.startsWith('spotify:track:') ? [{ label: 'Start Genius', act: () => startGenius(sh, it.uri) }] : []),
      SEP,
      { label: 'Copy Spotify Link', act: () => copyLink(sh, it.uri) },
    ];
  };
  /** for the grid's wrapper: the tile under the pointer, by its data-uri */
  const onContextMenu = (tiles: readonly TileItem[]) => (e: MouseEvent) => {
    const u = (e.target as Element).closest('[data-uri]')?.getAttribute('data-uri'), it = u?.startsWith('spotify:') ? tiles.find((x) => x.uri === u) : undefined;
    if (it) m.open(it, e);
  };
  return { onContextMenu, menu: m.render(items) };
}

/** A source's menu: a playlist (Play, Shuffle, Playlist Radio, Copy Spotify Link; Delete for the user's
 *  own, asked first) or Music (Liked Songs: Play, Shuffle). */
export function useSourceMenu(find: (id: string) => Source | undefined) {
  const sh = useShell(), m = usePointerMenu<Source>('source'), lib = useLibraryList();
  const items = (): MenuEntry[] => {
    const uri = m.it?.uri, name = m.it?.label ?? 'Playlist';
    if (!uri || !isCollectionUri(uri)) return [];
    const del = !!sh.store.getState().commands.deletePlaylist && !!lib.items.find((x) => x.uri === uri)?.editable;
    return [
      { label: 'Play', act: () => sh.store.getState().commands.playAll(uri) },
      { label: 'Shuffle', act: () => shufflePlay(sh, uri) },
      ...(uri !== LIKED ? [SEP, { label: 'Start Playlist Radio', act: () => void radioFrom(sh, uri, name) },
                           { label: 'Copy Spotify Link', act: () => copyLink(sh, uri) }] : []),
      ...(del ? [SEP, { label: 'Delete', act: () => askDelete(sh, uri, name) }] : []),
    ];
  };
  const onContextMenu = (e: MouseEvent) => {
    const x = find((e.target as Element).closest('[data-source]')?.getAttribute('data-source') ?? '');
    if (x?.uri) m.open(x, e);
  };
  return { onContextMenu, menu: m.render(items) };
}

// The behaviour every skin shares, as hooks over the store: what to show and what a click does.
// Skins render what these return; they hold no store logic of their own.
import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react';
import {
  hasMedia, LIKED, lineAt, mmss, lyricsShown, positionNow, trackLabel, trackName, wordAt, wordTimes,
  type AppState, type LibraryItem, type Track, type View,
} from '../model';
import type { TileItem, TileSection } from './Lists';
import { useScrub } from './scrub';
import { isCollectionUri, useArtist, useCollection, useCollectionFirstPages, useLibraryList, useSearch, useSearchAll, type Bucket } from './data';
import {
  artOk, clockText, duration, isAlbum, searchCollections, isBare, isContext, isSpotify, libraryView, uiSettings,
  type LibraryView, type ListItem,
} from './selectors';
import { cycleFamily, cyclePreset, isPlaying, presetLabel, useApp, useClock, useFrame, useShell, VIEW_LABELS } from './shell';

const useGet = () => {
  const sh = useShell();
  return () => sh.store.getState();
};

/** The transport's state: what plays, whether it does, and the switches beside it. */
export function usePlayback() {
  return useApp((s) => ({
    media: hasMedia(s), playing: isPlaying(s), capture: !!s.playback.capture, spotify: isSpotify(s),
    track: s.playback.track, from: s.playback.from, canSeek: s.playback.canSeek, canPrev: s.playback.canPrev, canNext: s.playback.canNext,
    shuffle: s.playback.shuffle, shuffleMode: s.playback.shuffleMode, canSmartShuffle: s.playback.canSmartShuffle,
    repeat: s.playback.repeat, muted: s.settings.muted, volume: s.settings.volume, lyrics: s.settings.lyrics,
    status: s.ui.status,
  }));
}

/** A value derived from the extrapolated track position (the store's position at `at`, run on
 *  while playing). Re-renders only on the frame the derived value changes; `fn` returns a primitive. */
export function usePosition<T extends string | number | boolean>(fn: (ms: number, s: AppState) => T): T {
  const get = useGet();
  return useFrame(() => { const s = get(); return fn(positionNow(s), s); });
}

/** The open menu's owner (store ui.menu: 'top:view', 'side:view', 'pill', 'picker', 'burger'). */
export function useMenus() {
  const get = useGet(), open = useApp((s) => s.ui.menu);
  const set = (owner: string | null) => get().actions.setUi({ menu: owner });
  return {
    open,
    set,
    /** close, but only if `owner` is still the open one (a late close must not shut its successor) */
    close: (owner: string) => { if (get().ui.menu === owner) set(null); },
  };
}

/** The current view, its task-pane label, and the switch (holds the engine off Now Playing). */
export function useView() {
  const get = useGet();
  const { view, spotify } = useApp((s) => ({ view: s.ui.view, spotify: isSpotify(s) }));
  return {
    view, spotify,
    label: VIEW_LABELS.find(([v]) => v === view)?.[1] ?? 'Now Playing',
    set: (v: View) => get().actions.setView(v),
  };
}

/** The clock: elapsed or -remaining (a click flips it while a session exists), the length as a title. */
export function useClockMode() {
  const get = useGet();
  const { media, d, remaining } = useApp((s) => ({ media: hasMedia(s), d: duration(s), remaining: !!s.settings.remaining }));
  const held = useScrub();
  const text = useFrame(() => held === null ? clockText(get()) : remaining && d > 0 ? '-' + mmss(d - held) : mmss(held));
  return {
    text, remaining, clickable: media,
    title: media && d > 0 ? mmss(d) : '',
    toggle: () => { if (media) get().actions.setSettings({ remaining: !remaining }); },
  };
}

export interface KaraokeLine {
  words: { text: string; state: 'sung' | 'now' | '' }[];
  /** 0..1 through the current word (the gold fill), in 2 % steps */
  fill: number;
  next: string;
  /** the line index: a new one fades in */
  index: number;
  /** the current line's text (karaoke off shows it plain) */
  text: string;
  /** settings.karaoke: word-by-word highlight, else a plain lit line */
  karaoke: boolean;
}

/** Synced lyrics as a line of word states (null when none show) and the plain block. */
export function useLyrics(): { synced: KaraokeLine | null; plain: string | null } {
  const { shown, lines, plain, karaoke } = useApp((s) => ({ shown: lyricsShown(s), lines: s.lyrics.lines, plain: s.lyrics.plain,
                                                   karaoke: s.settings.karaoke !== false,
                                                   p: s.playback.position, at: s.playback.at, st: s.playback.status }));
  const L = shown === 'synced' && lines ? lines : null;
  const key = usePosition((p) => {
    if (!L) return '';
    if (!karaoke) return String(lineAt(L, p));              // the line alone: no per-word frames
    const i = lineAt(L, p), w = wordTimes(L, i), k = wordAt(w, p), cur = w[k];
    const f = cur ? Math.round(Math.min(1, Math.max(0, (p - cur.t) / Math.max(50, cur.end - cur.t))) * 50) / 50 : 0;
    return i + '|' + k + '|' + f;
  });
  const [i = -1, k = -1, f = 0] = key.split('|').map(Number);
  const synced = L ? {
    words: karaoke && i >= 0 ? wordTimes(L, i).map((w, j) => ({ text: w.text, state: j < k ? 'sung' as const : j === k ? 'now' as const : '' as const })) : [],
    fill: f, next: i + 1 < L.length ? L[i + 1]!.text : '', index: i, text: i >= 0 ? L[i]!.text : '', karaoke,
  } : null;
  return { synced, plain: shown === 'plain' ? plain : null };
}

/** The unsynced lyrics alone (null unless they show): no clock, so no per-frame re-render. */
export const usePlainLyrics = () => useApp((s) => (lyricsShown(s) === 'plain' ? s.lyrics.plain : null));

/** Unsynced lyrics: scroll `ref` with the track position while `on`. */
export function useLyricScroll(ref: RefObject<HTMLElement | null>, on: boolean) {
  const get = useGet();
  useClock(() => {
    const b = ref.current, s = get(), d = duration(s);
    if (b && on) b.scrollTop = (b.scrollHeight - b.clientHeight) * (d > 0 ? positionNow(s) / d : 0);
  }, on);
}

/** Full screen: bare = the chrome-free view (full screen, the fallback, the screensaver). */
export function useFullscreen() {
  const sh = useShell();
  const { bare, fullscreen } = useApp((s) => ({ bare: isBare(s), fullscreen: s.ui.fullscreen }));
  return { bare, fullscreen, toggle: () => sh.toggleFullscreen() };
}

/** A 400 ms debounce, as the old search boxes had; `.now(v)` runs at once (Enter) and drops the pending call. */
export function useDebounced(fn: (v: string) => void): ((v: string) => void) & { now: (v: string) => void } {
  const t = useRef(0), f = useRef(fn);
  useLayoutEffect(() => { f.current = fn; });
  useEffect(() => () => clearTimeout(t.current), []);
  const [d] = useState(() => {
    const run = (v: string) => { clearTimeout(t.current); t.current = window.setTimeout(() => f.current(v), 400); };
    run.now = (v: string) => { clearTimeout(t.current); f.current(v); };
    return run;
  });
  return d;
}

export interface TreeNode {
  key: string;
  label: string;
  /** what selecting it shows (a collection uri, 'search'); null = a heading */
  target: string | null;
  top: boolean;
}

/** The Search view's scope: what it shows (a collection opened from the results, else the results
 *  themselves) and how a result opens there. useLibrary and useSearch read it inside the view. */
export interface SearchScopeValue { node: string; open(uri: string): void }
export const SearchScope = createContext<SearchScopeValue | null>(null);

/** The Media Library (or, inside the Search view, what it opened): the tree, the node's tracks (or,
 *  for the Playlists / Albums headings, their collections; for an artist its top tracks), the
 *  details / tiles view, and what rows, tiles and buttons do. The data are queries (src/ui/data.ts);
 *  the store holds the selection (ui.libNode, ui.libSel, ui.searchQ). */
export function useLibrary() {
  const get = useGet(), scope = useContext(SearchScope);
  const st = useApp((x) => ({ libNode: x.ui.libNode, sel: x.ui.libSel, now: x.playback.track?.uri ?? null,
                              view: libraryView(x), q: x.ui.searchQ }));
  const list = useLibraryList().items;
  const pls = list.filter((c) => !isAlbum(c.uri)), albs = list.filter((c) => isAlbum(c.uri));
  // Tiles mode is a browse mode: no node = the covers (Liked Songs, Playlists, Albums); an opened
  // collection lists its tracks (tracks are never tiles). Details mode opens on the first playlist.
  const tilesMode = !scope && st.view === 'tiles';
  const opening = useRef(0);
  useEffect(() => () => clearTimeout(opening.current), []);
  const node = scope ? scope.node : st.libNode ?? (tilesMode ? null : pls[0]?.uri ?? null);
  const heading = node === 'playlists' || node === 'albums';
  const artistPage = !!node?.startsWith('spotify:artist:');
  const covers = tilesMode && !isCollectionUri(node) && !artistPage;
  const liked = useCollection(covers ? LIKED : null);
  const col = useCollection(node), artist = useArtist(node), all = useSearchAll(node === 'search' ? st.q : '');
  const results = node === 'search' ? all.results : undefined;
  // "Show all <type>": the header counts that type's paged total ("40 songs", "30+ artists")
  const only = useApp((s) => (node === 'search' ? s.ui.searchOnly : null));
  const onlyPage = useSearch(node === 'search' ? st.q : '', only);
  const tracks: Track[] = node === 'search' ? results?.tracks.items ?? [] : artistPage ? artist.page?.tracks ?? [] : col.rows;
  const total = artistPage ? tracks.length : col.total || tracks.length;
  /** a playlist / album / artist row the page knows (the library list, the search, the artist's discography) */
  const findItem = (uri: string): LibraryItem | undefined =>
    list.find((p) => p.uri === uri) ?? (results ? searchCollections(results).find((p) => p.uri === uri) : undefined)
    ?? artist.page?.albums.find((p) => p.uri === uri);
  const name = covers ? 'Media Library' : node === 'search' ? (st.q ? 'Results for “' + st.q + '”' : 'Search')
    : node === 'playlists' ? 'Playlists' : node === 'albums' ? 'Albums'
    : node ? col.meta?.name ?? artist.page?.meta.name ?? (node === LIKED ? 'Liked Songs' : undefined) ?? findItem(node)?.name ?? 'Loading…'
    : 'Media Library';
  const head = (label: string, target: string | null = null): TreeNode => ({ key: label, label, target, top: true });
  const ctx = (items: LibraryItem[], pre: string): TreeNode[] => items.map((c) => ({ key: pre + c.uri, label: c.name, target: c.uri, top: false }));
  const n = (k: number, one: string) => k + ' ' + one + (k === 1 ? '' : 's');
  // tiles: a collection's own tile says who made it (or how long it is), a track's its artist
  // an album's subtitle is its artist; a playlist's its owner; else how long it is
  const colTile = (c: ListItem): TileItem => ({ key: c.uri, uri: c.uri, name: c.name, img: c.image ?? null, openable: true,
    sub: c.kind === 'artist' ? 'Artist' : isAlbum(c.uri) ? c.artist ?? c.owner ?? (c.total ? n(c.total, 'track') : '')
      : c.owner ? 'by ' + c.owner : c.total ? n(c.total, 'track') : '' });
  // the covers: a click opens (no ▤ corner); Liked Songs first, with its count
  const coverTile = (c: ListItem): TileItem => ({ ...colTile(c), openable: false });
  const tiles: TileSection[] = covers ? [
      { items: [{ key: LIKED, uri: LIKED, name: 'Liked Songs', img: null, sub: liked.loaded ? n(liked.total, 'track') : '' }] },
      { title: 'Playlists', items: pls.map(coverTile) },
      { title: 'Albums', items: albs.map(coverTile) },
    ].filter((g) => g.items.length)
    : node === 'playlists' ? [{ items: pls.map(colTile) }]
    : node === 'albums' ? [{ items: albs.map(colTile) }]
    : [];
  const open = (uri: string) => (scope ? scope.open(uri) : openItem(get(), uri));
  const playable = isCollectionUri(node) || artistPage;
  return {
    node, name, tracks, now: st.now, selected: st.sel, findItem,
    count: node === 'search' ? (st.q && results
        ? (only ? onlyPage.total + (onlyPage.exact ? '' : '+') + ' ' + BUCKET_NOUN[only]
                : results.tracks.total + (results.tracks.exact ? '' : '+') + ' songs')
        : '')
      : covers ? n(pls.length, 'playlist') + ' · ' + n(albs.length, 'album')
      : heading ? n((node === 'playlists' ? pls : albs).length, node === 'playlists' ? 'playlist' : 'album')
      : col.loading || artist.loading ? '' : n(total, 'track'),
    tree: [head('Playlists', 'playlists'), ...ctx(pls, 'p'), head('Albums', 'albums'), ...ctx(albs, 'a'), head('Liked Songs', LIKED),
      ...(artistPage && !scope && artist.page ? [head('Artist: ' + artist.page.meta.name, node), ...ctx(artist.page.albums, 'r')] : [])],
    more: col.hasMore ? { label: col.loadingMore ? 'Loading…' : 'Load more', load: col.loadMore } : null,
    canPlayAll: playable && tracks.length > 0,
    playAll: () => { if (!node || !playable) return; if (artistPage) get().commands.playContext(node, null); else get().commands.playAll(node); },
    /** an artist's page: the table is the top tracks, and these are the discography */
    artistAlbums: artistPage ? (artist.page?.albums ?? []).map(colTile) : null,
    open,
    selectRow: (t: Track) => get().actions.setUi({ libSel: t.uri }),
    playRow: (t: Track) => get().commands.playContext(t.ctx ?? t.uri, t.uri),
    /** back from a selection to the node (Esc in the table or the tiles) */
    deselect: () => get().actions.setUi({ libSel: null }),
    /** the mode the header's buttons show: 'details' (tree + table) or 'tiles' (the browse mode) */
    view: scope ? (heading ? 'tiles' as const : st.view) : st.view,
    /** the body is cover tiles (the Tiles mode's covers, or a Playlists / Albums heading); tracks are always a table */
    showTiles: covers || heading,
    /** the tree shows in Details mode only */
    showTree: !tilesMode,
    /** Tiles mode, a collection opened from the covers: "‹ Playlists" / "‹ Albums" back to them */
    crumb: tilesMode && !covers ? { label: artistPage ? 'Library' : node && isAlbum(node) ? 'Albums' : 'Playlists', back: () => get().actions.setUi({ libNode: null, libSel: null }) } : null,
    setView: (v: LibraryView) => get().actions.setSettings(uiSettings({ libraryView: v })),
    tiles,
    /** a collection tile opens it — a click after a double-click's window (Enter at once), so a
     *  double-click can play it instead */
    clickTile: (t: TileItem, keyboard = false) => {
      clearTimeout(opening.current);
      if (keyboard) open(t.uri);
      else opening.current = window.setTimeout(() => open(t.uri), DOUBLE_CLICK_MS);
    },
    /** double-click and the corner ▶: play the collection whole (an artist as a context), staying put */
    playTile: (t: TileItem) => {
      clearTimeout(opening.current);
      if (isCollectionUri(t.uri)) get().commands.playAll(t.uri);
      else get().commands.playContext(t.uri, null);
    },
    openTile: (t: TileItem) => open(t.uri),
  };
}

/** How long a click on a cover waits for a second one (a double-click plays instead of opening). */
export const DOUBLE_CLICK_MS = 250;

/** The Search view: its box (400 ms debounce, Enter at once: commands.search sets ui.searchQ), the
 *  scope its results open in (a result's artist / album / playlist page, '‹ All results' back) and
 *  sending that page to the Media Library. Render the view inside <SearchScope.Provider value={scope}>. */
export function useSearchView() {
  const get = useGet(), [opened, setOpened] = useState<string | null>(null), q = useApp((s) => s.ui.searchQ);
  const search = useDebounced((v) => { setOpened(null); get().actions.setUi({ libSel: null }); get().commands.search(v); });
  const open = (uri: string) => { setOpened(uri); get().actions.setUi({ libSel: null }); };
  return {
    scope: { node: opened ?? 'search', open },
    opened, search, q,
    back: opened ? () => { setOpened(null); get().actions.setUi({ libSel: null }); } : null,
    /** the opened page, in the Media Library instead */
    toLibrary: opened ? () => {
      const c = get().commands;
      if (opened.startsWith('spotify:artist:')) c.openArtist(opened);
      else c.openInLibrary(opened);
    } : null,
  };
}

/** Open a collection in the Media Library: an artist as its page, anything else as a tree node. */
function openItem(s: AppState, uri: string) {
  if (uri.startsWith('spotify:artist:')) s.commands.openArtist(uri);
  else s.actions.setUi({ libNode: uri, libSel: null });
}

const BUCKETS: [Bucket, string][] = [['tracks', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']];
const BUCKET_NOUN: Record<Bucket, string> = { tracks: 'songs', artists: 'artists', albums: 'albums', playlists: 'playlists' };

export interface SearchRow { uri: string; name: string; sub: string; img: string | null; kind: 'track' | 'artist' | 'album' | 'playlist' }

/** The Search view's results page: the top result, then Songs / Artists / Albums / Playlists (each
 *  with its count, "489+" when the full search's total is a lower bound, and "Show all"), or one type
 *  alone, paged with Load more (a typed search). */
export function useSearchResults() {
  const get = useGet(), scope = useContext(SearchScope), selected = useApp((s) => s.ui.libSel), q = useApp((s) => s.ui.searchQ);
  // "Show all" lives in the store so the view header can count the typed page too (useLibraryView)
  const type = useApp((s) => s.ui.searchOnly);
  const setOnly = (o: { q: string; type: Bucket } | null) => get().actions.setUi({ searchOnly: o ? o.type : null });
  const all = useSearchAll(q), one = useSearch(q, type), results = all.results;
  const rowOf = (x: Track | LibraryItem, kind?: SearchRow['kind']): SearchRow => 'title' in x
    ? { uri: x.uri, name: x.title, sub: x.artist, img: x.image ?? x.art ?? null, kind: 'track' }
    : { uri: x.uri, name: x.name, img: x.image ?? null, kind: kind ?? (x.kind === 'artist' ? 'artist' : isAlbum(x.uri) ? 'album' : 'playlist'),
        sub: x.kind === 'artist' ? 'Artist' : isAlbum(x.uri) ? x.artist ?? x.owner ?? 'Album' : x.owner ? 'by ' + x.owner : 'Playlist' };
  // a typed op that fell back to the full search says so in the status line
  const note = one.note;
  useEffect(() => { if (note) get().actions.setStatus(note); }, [note]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = BUCKETS.filter(([t]) => !type || t === type).map(([t, title]) => {
    const page = type ? { items: one.items, total: one.total, exact: one.exact, hasMore: one.hasMore } : results?.[t];
    const rows = (page?.items ?? []).map((x) => rowOf(x));
    const total = page?.total ?? 0;
    return {
      type: t, title, total, rows,
      tracks: t === 'tracks' ? (page?.items ?? []) as Track[] : null,
      /** "18" or "18+" (exact: false = the full search's under-reported total, a lower bound) */
      count: total + (page && !page.exact ? '+' : ''),
      showAll: !type && page && (page.hasMore || total > rows.length) ? () => setOnly({ q, type: t }) : null,
      more: type && one.hasMore ? { label: one.loading ? 'Loading…' : 'Load more', load: one.loadMore } : null,
    };
  }).filter((x) => x.rows.length || x.type === type);
  const empty = !sections.some((x) => x.rows.length);
  return {
    q, type, sections,
    top: !type && results?.top ? { ...rowOf(results.top.item, results.top.kind), kind: results.top.kind } : null,
    note: (all.loading || one.loading) && empty ? 'Searching…' : !q ? 'Type in the search box to search all of Spotify (Ctrl+E).' : empty ? 'No results.' : '',
    /** back from one type to every section */
    all: type ? () => setOnly(null) : null,
    /** a click: a track selects (the details pane), a collection opens (an artist as its page) */
    click: (r: SearchRow) => {
      if (r.kind === 'track') get().actions.setUi({ libSel: r.uri });
      else if (scope) scope.open(r.uri);
      else openItem(get(), r.uri);
    },
    /** a double-click plays */
    play: (r: SearchRow) => {
      if (r.kind !== 'track') { get().commands.playContext(r.uri, null); return; }
      const t = sections.find((x) => x.tracks)?.tracks?.find((x) => x.uri === r.uri);
      get().commands.playContext(t?.ctx ?? r.uri, r.uri);
    },
    selected,
  };
}

export interface PaneRow {
  key: string;
  label: string;
  title: string;
  on: boolean;
  /** a track shown under its opened playlist/album */
  sub: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
}

/** Spotify's right-hand pane: what plays now and next, the playlists and albums (a click opens,
 *  a double-click plays whole), Liked Songs (search is the Search view's). Where it plays from is
 *  the italic line under the song info (a link into the Media Library), not a group here. */
export function usePaneLibrary() {
  const get = useGet();
  const st = useApp((x) => ({ track: x.playback.track, media: hasMedia(x), ctx: x.playback.context, next: x.queue.next }));
  const playlists = useLibraryList().items;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const opened = useCollectionFirstPages(Object.keys(open).filter((u) => open[u]));
  const liked = useCollection(LIKED).rows;
  const c = () => get().commands;
  const ctxUri = st.ctx?.uri ?? null;
  const row = (key: string, name: string, uri: string, o: { sub?: boolean; on?: boolean; ctx?: string | null } = {}): PaneRow[] => {
    if (isContext(uri) && !o.sub) {
      const isOpen = !!open[uri];
      return [{ key, label: (isOpen ? '▾ ' : '▸ ') + name, title: name, on: !!o.on, sub: false,
        onClick: () => setOpen((m) => ({ ...m, [uri]: !isOpen })),
        onDoubleClick: () => c().playContext(uri, null) },
        ...(isOpen ? (opened[uri] ?? []).flatMap((t) => track(key + '/' + t.uri, t, true)) : [])];
    }
    return [{ key, label: name, title: name, on: !!o.on, sub: !!o.sub, onClick: () => c().playContext(o.ctx ?? uri, o.ctx ? uri : null) }];
  };
  const track = (key: string, t: Track, sub = false, on = false) => row(key, trackLabel(t), t.uri, { sub, on, ctx: t.ctx ?? ctxUri });
  const groups: [string, PaneRow[]][] = [
    ['Now Playing', st.media && st.track?.title ? track('now', st.track, false, true) : []],
    ['Up Next', st.next.flatMap((t, i) => track('next' + i, t))],
    ['Playlists', playlists.flatMap((p) => row('pl' + p.uri, p.name, p.uri))],
    ['Liked Songs', liked.flatMap((t) => track('lk' + t.uri, t))],
  ];
  return { groups };
}

/** The visualizer list: every preset, grouped by engine, the current one lit and scrolled to. */
export function usePresetList(box: RefObject<HTMLElement | null>) {
  const sh = useShell(), cur = useApp((s) => s.vis.kind + ':' + s.vis.preset);
  useEffect(() => { box.current?.querySelector<HTMLElement>('[data-on]')?.scrollIntoView?.({ block: 'nearest' }); }, [cur, box]);
  return sh.presets.map((p, i) => ({
    ...p, key: p.vis + p.preset, on: cur === p.vis + ':' + p.preset, head: p.group !== sh.presets[i - 1]?.group,
    select: () => sh.store.getState().actions.setVis(p.vis, p.preset),
  }));
}

/** The strip under the screen: the visualization's name and the arrows that walk the presets (Shift: the families). */
export function useVisControl() {
  const sh = useShell(), step = (d: number) => (e?: { shiftKey?: boolean }) => (e?.shiftKey ? cycleFamily : cyclePreset)(sh, d);
  return { label: useApp((s) => presetLabel(sh.presets, s)), prev: step(-1), next: step(1) };
}

/** The pane's now-playing plate: art, names, and (Spotify) the links into the Media Library. */
export function useNowPlaying() {
  const get = useGet();
  const { media, t, from, spotify } = useApp((s) => ({ media: hasMedia(s), t: s.playback.track, from: s.playback.from, spotify: isSpotify(s) }));
  const c = () => get().commands;
  const link = (open: () => void) => (spotify ? { title: 'Show in Media Library', onClick: open } : {});
  return {
    media, spotify, art: media ? artOk(t?.art) : '',
    title: media ? t?.title ?? '' : '', artist: media ? t?.artist ?? '' : '', album: media ? t?.album ?? '' : '', from: media ? from : '',
    links: { album: link(() => c().openAlbum()), artist: link(() => void c().openArtist()), from: link(() => c().openFrom()) },
    /** Open in Media Library: the playing playlist/album, else the track's album */
    openPlaying: () => { const s = get(); if (s.playback.context && isContext(s.playback.context.uri)) c().openFrom(); else c().openAlbum(); },
  };
}

/** The debug overlay's text, refreshed four times a second while it is on. */
export function useDebugText() {
  const sh = useShell(), on = useApp((s) => s.settings.debug);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [on]);
  return { on, text: on ? sh.debugText() : '' };
}

/** Screensaver only: "Artist – Title", on for 5 s after a track change. */
export function useCaption() {
  const { ss, name } = useApp((s) => ({ ss: s.auth.mode === 'screensaver',
                                        name: hasMedia(s) && s.playback.track ? trackName(s.playback.track) : '' }));
  const [on, setOn] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the caption is a timed response to a track change
    if (!ss || !name) { setOn(false); return; }
    setOn(true);
    const t = setTimeout(() => setOn(false), 5000);
    return () => clearTimeout(t);
  }, [ss, name]);
  return { on, text: ss ? name : '' };
}

/** The window's caption buttons, drag and resize grip: the desktop host's (auth.hostWindow), else
 *  the browser's nearest equivalents. */
export function useWindowControls() {
  const sh = useShell(), host = useApp((s) => s.auth.hostWindow), lastDown = useRef(0);
  const win = (a: 'drag' | 'min' | 'max' | 'close' | 'size') => sh.store.getState().commands.win(a);
  return {
    host,
    // Under the host the title bar is the real caption: drag it, and a double-click (two
    // mousedowns: Windows' modal move loop swallows the second half of a dblclick) maximizes.
    onCaptionMouseDown: (e: React.MouseEvent) => {
      if (!host || e.button !== 0 || (e.target as Element).closest('button')) return;
      const now = Date.now();
      if (now - lastDown.current < 400) { lastDown.current = 0; win('max'); return; }
      lastDown.current = now;
      win('drag');
    },
    minimize: () => (host ? win('min') : window.blur()),
    maximize: () => (host ? win('max') : sh.toggleFullscreen()),
    close: () => (host ? win('close') : window.close()),
    /** the resize corner: the host's window sizing (its thick frame is outside the client area) */
    onGripMouseDown: host ? (e: React.MouseEvent) => { if (e.button === 0) { e.preventDefault(); win('size'); } } : undefined,
  };
}

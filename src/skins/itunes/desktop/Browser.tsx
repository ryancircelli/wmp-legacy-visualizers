// The window's body under the toolbar (REFERENCE §Window layout): the source list (with the artwork
// pane at its foot) and, beside it, what the selected source shows in its view, then the bottom bar.
// A narrow window (under 760 px) folds the sidebar away; View > Show Sidebar lays it over the content.
// Spotify's features in iTunes' places (docs/itunes-skin.md §3.1): the ♥ column where iTunes had
// Rating, the right-click menus (Pointer.tsx), the Canvas in the artwork pane, iTunes DJ's played songs
// above Up Next, podcast episodes' blue dots, the search's kinds as the store's filter, and a page's
// Play / Shuffle / ♥ / radio on its strip.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { LIKED, type Track } from '../../../model';
import {
  artOk, canSave, clipFailed, cx, Dropdown, SearchScope, toggleSaved, TransportButton, useApp, useCanvas, useDevices, usePlayback, useSaved,
  useSearchResults, useShell, type Bucket, type TileItem, type TileSection,
} from '../../../ui';
import { AlbumGrid } from '../shared/AlbumGrid';
import { AlbumList } from '../shared/AlbumList';
import { albumsOf, opensPage, playRow, playUri, queueOrder, showPlaying, statusLine, useSourceContent, type Content, type TracksContent } from '../shared/content';
import { CoverFlow } from '../shared/CoverFlow';
import { Icon } from '../shared/icons';
import { SourceList } from '../shared/SourceList';
import { ShuffleButton } from '../shared/Transport';
import { useSources, type Source } from '../shared/sources';
import { useItunesView, viewActions, type ViewMode } from '../shared/state';
import { COLUMNS, listColumns, TrackTable, type TrackColumn } from '../shared/TrackTable';
import { MENU, useGenius, withAirPlay } from './Chrome';
import { useRowMenu, useSourceMenu, useTileMenu, type QueueEdits } from './Pointer';
import { desk, makePlaylist, naming, newPlaylist, played, radioFrom, radioLabel, shufflePlay, useSave } from './spotify';

/** The selected source (Music while the selection resolves to nothing: a playlist deleted, a device
 *  gone), what was opened in it, and what that shows. */
export function useSelection() {
  const src = useSources(), v = useItunesView((s) => ({ id: s.source, opened: s.stack[s.stack.length - 1] ?? null, depth: s.stack.length }));
  const source = src.find(v.id) ?? (src.loading ? undefined : src.find('music'));
  const content = useSourceContent(source, v.opened);
  const mode = useItunesView((s) => (source ? s.views[source.id] : undefined) ?? 'list');
  return { src, id: v.id, source, opened: v.opened, depth: v.depth, content, mode };
}

export function Browser({ narrow }: { narrow: boolean }) {
  const sel = useSelection(), open = useItunesView((s) => s.sidebarOpen);
  // a search cleared leaves Search Results: back to the store
  const gone = sel.id === 'search' && !sel.src.find('search');
  useEffect(() => { if (gone) viewActions.select('store'); }, [gone]);
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      <div className="relative flex-auto min-h-0 flex">
        <Sidebar src={sel.src} selected={sel.source?.id ?? ''}
                 className={cx('w-188 flex-none', narrow && (open ? 'absolute left-0 top-0 bottom-0 z-30 shadow-[4px_0_10px_rgba(0,0,0,.3)]' : 'hidden'))} />
        <div className="flex-none w-4 bg-[linear-gradient(90deg,#D1D1D1,#BABABA_60%,#D8D8D8)] border-l border-itunes-split max-[759px]:hidden" aria-hidden="true" />
        <Main sel={sel} />
      </div>
      <BottomBar content={sel.content} mode={sel.mode} />
    </div>
  );
}
function Sidebar({ src, selected, className }: { src: ReturnType<typeof useSources>; selected: string; className?: string }) {
  const artwork = useItunesView((s) => s.artwork), sm = useSourceMenu(src.find), name = naming((x) => x.on);
  return (
    <div className={cx('flex flex-col min-h-0 bg-itunes-side', className)} id="sidebar" onContextMenu={sm.onContextMenu}>
      {sm.menu}
      <SourceList sections={src.sections} selected={selected} onSelect={viewActions.select} className="flex-auto min-h-0 overflow-y-auto overflow-x-hidden pb-8">
        {name && <NameRow />}
      </SourceList>
      {artwork && <ArtworkPane />}
    </div>
  );
}

/** iTunes' new playlist: "untitled playlist" in an edit field at the end of PLAYLISTS, selected to type
 *  over; Enter or leaving the field makes the playlist (an empty name, none), Esc drops it. The keys are the
 *  field's (not the list's arrows, the window's shortcuts). */
function NameRow() {
  const sh = useShell(), left = useRef(false);
  const done = (name: string) => {
    if (left.current) return;                      // once: the field's removal may blur it again
    left.current = true;
    naming.setState({ on: false });
    if (name.trim()) void makePlaylist(sh, name.trim());
  };
  return (
    <div className="flex items-center gap-6 h-20 pl-18 pr-8 bg-itunes-side-sel-on" id="newplaylist">
      <Icon name="playlist" className="flex-none text-white" />
      <input autoFocus defaultValue="untitled playlist" aria-label="New playlist name" spellCheck={false} onFocus={(e) => e.currentTarget.select()}
             className="flex-auto min-w-0 h-17 px-2 border border-[#3B6FB6] bg-white text-12 text-black outline-none select-text"
             onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') done(e.currentTarget.value); else if (e.key === 'Escape') done(''); }}
             onBlur={(e) => done(e.currentTarget.value)} />
    </div>
  );
}

/** The artwork pane: "Now Playing" over the playing song's cover, or its Canvas (Spotify's looping
 *  clip, muted, where iTunes played a video; View > Show Canvas); a click shows the song. A clip that
 *  fails to load gives way to the cover (a clip kept in memory: its own address first). */
function ArtworkPane() {
  const sh = useShell(), { art, has, uri } = useApp((s) => ({ art: artOk(s.playback.track?.art), has: !!s.playback.track, uri: s.playback.track?.uri ?? null }));
  const cv = useCanvas(desk((x) => x.canvas) ? uri : null), [failed, setFailed] = useState(''), canvas = cv && cv.url !== failed ? cv : null;
  const fail = () => setFailed(canvas && clipFailed(canvas.url) ? 'again ' + Date.now() : canvas?.url ?? '');
  const fill = 'block w-full h-full object-cover';
  return (
    <div className="flex-none border-t border-itunes-split bg-[#E2E2E2]" id="artwork">
      <div className="h-18 px-8 text-11 leading-[18px] font-bold text-itunes-side-head text-center border-b border-[#CACACA] bg-itunes-head">{has ? 'Now Playing' : 'Nothing Playing'}</div>
      <button type="button" className="block w-full aspect-square p-0 border-0 bg-[#D6D6D6] cursor-default overflow-hidden" title={has ? 'Show the current song' : undefined}
              onClick={() => showPlaying(sh)}>
        {canvas?.type === 'video' ? <video key={canvas.url} id="canvas" src={canvas.url} poster={art || undefined} muted autoPlay loop playsInline onError={fail} className={fill} />
          : canvas ? <img id="canvas" src={canvas.url} alt="" onError={fail} className={fill} />
          : art ? <img src={art} alt="Album art" className={fill} />
          : <span className="grid place-items-center h-full text-[#B4B4B4]"><Icon name="music" size={56} /></span>}
      </button>
    </div>
  );
}

/** The strip over a page opened inside a source (‹ back, its name), the Grid's Albums / Artists, the
 *  store's dark navigation bar. */
function Strip({ dark, back, title, children }: {
  dark?: boolean;
  /** the ‹ button: absent = none, null = there but nothing to go back to */
  back?: (() => void) | null; title: string; children?: ReactNode;
}) {
  return (
    <div className={cx('flex-none flex items-center gap-8 h-25 px-6 border-b', dark ? 'bg-itunes-store border-black text-white' : 'bg-itunes-head border-itunes-rule text-black')} id="strip">
      {back !== undefined && (
        <button type="button" disabled={!back} onClick={back ?? undefined} title="Back" aria-label="Back"
                className={cx('grid place-items-center w-24 h-18 p-0 rounded-sm border disabled:opacity-40',
                              dark ? 'border-[#111] bg-[linear-gradient(180deg,#5A5A5A,#333)] text-white' : 'border-itunes-rim bg-itunes-seg text-[#333]')}>
          <Icon name="back" size={10} />
        </button>
      )}
      {dark && <button type="button" onClick={() => viewActions.select('store')} title="Spotify Home" aria-label="Spotify Home" className="grid place-items-center w-24 h-18 p-0 border-0 bg-transparent text-white/90"><Icon name="home" size={12} /></button>}
      <span className="flex-auto min-w-0 truncate text-12 font-bold">{title}</span>
      {children}
    </div>
  );
}
/** a strip's small push button (Play, Shuffle, ♥, radio): the ‹ button's face, or the store's dark one */
const STRIP_BTN = (dark?: boolean) => cx('flex-none flex items-center gap-4 h-18 px-7 rounded-sm border text-11',
  dark ? 'border-[#111] bg-[linear-gradient(180deg,#5A5A5A,#333)] text-white' : 'border-itunes-rim bg-itunes-seg text-[#333] active:bg-itunes-btn-down');

/** A strip's segmented switch (the Grid's Albums | Artists, the search's kinds), one segment pressed. */
function Seg<T extends string | null>({ items, value, onChange, dark }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <div className={cx('flex-none flex h-18 rounded-full border overflow-hidden text-11', dark ? 'border-[#111]' : 'border-itunes-rim')} role="tablist">
      {items.map(([v, label], i) => (
        <button key={label} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
                className={cx('px-10 border-0', i > 0 && (dark ? 'border-l border-[#111]' : 'border-l border-itunes-rim'),
                              value === v ? (dark ? 'bg-[#141414] text-white' : 'bg-itunes-seg-on text-white')
                                          : dark ? 'bg-[linear-gradient(180deg,#5A5A5A,#333)] text-white/90' : 'bg-itunes-seg text-black')}>{label}</button>
      ))}
    </div>
  );
}

/** The heart: outlined, filled once liked / saved (currentColor). */
const Heart = ({ on, size = 11 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 10.4C3.3 8.4 1.3 6.8 1.3 4.5 1.3 3 2.5 1.9 3.8 1.9c1 0 1.7.5 2.2 1.3.5-.8 1.2-1.3 2.2-1.3 1.3 0 2.5 1.1 2.5 2.6 0 2.3-2 3.9-4.7 5.9Z"
          fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

/** A page's own buttons on its strip (an album, playlist, artist or show opened): Play, Shuffle, ♥ (save
 *  to Your Library, follow) and its radio (the genius atom: Album / Playlist / Artist Radio). */
function PageActions({ uri, title, dark }: { uri: string; title: string; dark?: boolean }) {
  const sh = useShell(), save = useSave(uri), radio = radioLabel(uri), btn = STRIP_BTN(dark);
  return (
    <div className="flex-none flex items-center gap-5" id="pageacts">
      <button type="button" className={btn} onClick={() => playUri(sh, uri)}><Icon name="play" size={9} />Play</button>
      {!uri.startsWith('spotify:show:') && <button type="button" className={btn} onClick={() => shufflePlay(sh, uri)}><Icon name="shuffle" size={12} />Shuffle</button>}
      {save.can && (
        <button type="button" id="pagesave" className={btn} title={save.label} aria-label={save.label} aria-pressed={!!save.saved} onClick={save.toggle}><Heart on={!!save.saved} /></button>
      )}
      {radio && (
        <button type="button" id="pageradio" className={btn} title={'Start ' + radio} aria-label={'Start ' + radio} onClick={() => void radioFrom(sh, uri, title)}><Icon name="genius" size={12} /></button>
      )}
    </div>
  );
}

const BUCKETS: readonly (readonly [Bucket | null, string])[] = [[null, 'All'], ['tracks', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']];
/** Search Results' kinds, as the iTunes Store's results filtered by kind: one kind alone pages on. */
function Buckets() {
  const sh = useShell(), only = useApp((s) => s.ui.searchOnly);
  return <Seg items={BUCKETS} value={only} dark onChange={(b) => sh.store.getState().actions.setUi({ searchOnly: b })} />;
}

type Sel = ReturnType<typeof useSelection>;

function Main({ sel }: { sel: Sel }) {
  const { content: c, source, depth, mode, opened } = sel;
  const back = depth ? viewActions.back : undefined;
  const store = source?.kind === 'store' || source?.kind === 'search';
  const body = c.kind === 'tracks' ? <Tracks c={c} mode={mode} source={source} />
    : c.kind === 'tiles' ? <Tiles sections={c.sections} empty={c.loading ? 'Loading…' : c.empty} heads={source?.kind === 'store'} />
    : c.kind === 'artist' ? <Artist c={c} />
    : c.kind === 'stations' ? <Stations c={c} />
    : c.kind === 'search' ? <SearchResults />
    : <Note text={c.note} />;
  return (
    <div className="flex-auto min-w-0 min-h-0 flex flex-col bg-white" id="content">
      {(store || depth > 0) && (
        <Strip dark={store} back={store ? back ?? null : back} title={c.title}>
          {opened && opensPage(opened) && <PageActions uri={opened} title={c.title} dark={store} />}
          {source?.kind === 'search' && !depth && <Buckets />}
        </Strip>
      )}
      {body}
    </div>
  );
}

const Note = ({ text }: { text: string }) => <div className="flex-auto grid place-items-center text-12 text-itunes-dim px-20 text-center">{text}</div>;

// ---- songs ------------------------------------------------------------------------------------------

/** The ♥ column, in iTunes' Rating column's place (last): ♥ where the song is liked, ♡ on the row under
 *  the pointer or selected (CSS), a click on it likes or unlikes. The flags are src/ui's batched saved
 *  queries; Liked Songs' own rows are liked without asking.
 *  ponytail: the shared table's cells are text, so the ♡ is the cell's ::after and the click is caught
 *  on a wrapper by cell position; ReactNode cells (docs: wanted in shared/) would make both plain. */
function useLikes(rows: readonly Track[], liked = false) {
  const sh = useShell(), saved = useSaved(rows.map((t) => t.uri), !liked);
  const is = (t: Track) => saved(t.uri) ?? (liked || undefined);
  const column: TrackColumn = { key: 'like', header: '♥', width: 26, cell: (t) => (canSave(t.uri) && is(t) ? '♥' : ''), sort: (t) => (is(t) ? 0 : 1) };
  const hit = (e: MouseEvent): Track | undefined => {
    const td = (e.target as Element).closest('tbody td'), tr = td?.parentElement;
    return td && tr && td === tr.lastElementChild ? rows[Number(tr.getAttribute('data-i'))] : undefined;
  };
  return {
    column,
    wrap: {
      onClickCapture: (e: MouseEvent) => {
        const t = hit(e);
        if (!t || !canSave(t.uri)) return;
        e.stopPropagation();
        const v = is(t);
        void (v === undefined ? toggleSaved(sh, t.uri) : sh.store.getState().commands.addTo(t.uri, LIKED, !v));
      },
      onDoubleClickCapture: (e: MouseEvent) => { if (hit(e)) e.stopPropagation(); },
    },
  };
}
const LIKE_CELLS = "[&_tbody_td:last-child]:px-0 [&_tbody_td:last-child]:text-center [&_tbody_td:last-child]:after:opacity-55 [&_tbody_tr:hover_td:last-child:empty]:after:content-['♡'] [&_tbody_tr[data-sel]_td:last-child:empty]:after:content-['♡']";

/** a podcast episode not played yet: iTunes' blue dot, in the column before its name */
const UNPLAYED: TrackColumn = { key: 'new', header: '', width: 18, cell: (t) => (t.unplayed ? '●' : ''), sort: (t) => (t.unplayed ? 0 : 1) };
const EPISODES = [UNPLAYED, COLUMNS.name, COLUMNS.time, COLUMNS.date];
const DOT_CELLS = '[&_tbody_td:nth-child(2)]:px-0 [&_tbody_td:nth-child(2)]:text-center [&_tbody_td:nth-child(2)]:text-[9px] [&_tbody_td:nth-child(2)]:text-[#3E7FDB] [&_tbody_tr[data-sel]_td:nth-child(2)]:text-inherit';

const isShow = (uri: string | null | undefined) => !!uri?.startsWith('spotify:show:');

function Tracks({ c, mode, source }: { c: TracksContent; mode: ViewMode; source: Source | undefined }) {
  const sh = useShell(), p = usePlayback(), now = p.track?.uri ?? null, reveal = useItunesView((s) => s.reveal);
  const edits = useApp((s) => !!s.commands.reorderQueue), n = c.tracks.length, history = played((x) => x.list);
  // iTunes DJ: the songs played here, then the playing one, then Up Next (the only rows that move)
  const past = c.queue ? history.filter((t) => t.uri !== now) : [], head = c.queue ? [...past, ...(p.media && p.track ? [p.track] : [])] : [];
  const rows = head.length ? [...head, ...c.tracks] : c.tracks, from = head.length;
  const reorder = (order: number[]) => sh.store.getState().commands.reorderQueue?.(order);
  const queue: QueueEdits | undefined = c.queue && edits ? {
    from,
    move: (a, b) => { if (a >= from) reorder(queueOrder(n, { move: [a - from, Math.max(0, b - from)] })); },
    remove: (i) => { if (i >= from) reorder(queueOrder(n, { remove: i - from })); },
  } : undefined;
  const rm = useRowMenu(queue), key = (source?.id ?? '') + '|' + c.title, show = isShow(c.ctx), likes = useLikes(rows, c.ctx === LIKED);
  const clear = useApp((s) => !!c.queue && !!s.commands.clearQueue && s.queue.next.some((t) => t.queued));
  const play = (t: Track) => playRow(sh, c, t);
  // "show the current song": the playing row selected
  const [shown, setShown] = useState(0), at = reveal !== shown && now ? rows.findIndex((t) => t.uri === now) : -1;
  useEffect(() => { if (at >= 0) setShown(reveal); }, [at, reveal]); // eslint-disable-line react-hooks/set-state-in-effect -- once shown, the next reveal waits for a new bump
  const cols = show ? EPISODES : [...(c.queue ? [COLUMNS.name, COLUMNS.time, COLUMNS.artist, COLUMNS.album] : listColumns(rows)), likes.column];
  const table = (cls?: string) => (
    <div className="contents" {...(show ? {} : likes.wrap)} data-dj={c.queue || undefined}>
      {/* iTunes DJ's played songs in grey (ponytail: by row position, the shared table having no row classes) */}
      {past.length > 0 && <style>{`[data-dj] tbody tr:nth-child(-n+${past.length}):not([data-sel]){color:#8C8C8C}`}</style>}
      <TrackTable id="tracks" className={cx(cls, show ? DOT_CELLS : LIKE_CELLS)} rows={rows} columns={cols} now={now} playing={p.playing} onPlay={play} more={c.more} resetKey={key}
                  queue={queue} onContextMenu={rm.onContextMenu} reveal={at >= 0 ? at : null} empty={c.loading ? 'Loading…' : c.empty} />
    </div>
  );
  let body: ReactNode;
  if (mode === 'album') body = <AlbumList rows={c.tracks} now={now} playing={p.playing} onPlay={play} more={c.more} resetKey={key} className="flex-auto" empty={c.loading ? 'Loading…' : c.empty} />;
  else if (mode === 'grid') body = <SongGrid c={c} />;
  else if (mode === 'flow') body = <Flow c={c} table={table} />;
  else body = table('flex-auto');
  return (
    <>
      {rm.menu}{body}
      {/* iTunes DJ's bar under its list, where its Refresh was: Clear, while songs the user queued are in Up Next */}
      {clear && (
        <div id="djbar" className="flex-none flex items-center justify-end h-26 px-8 border-t border-itunes-rule bg-itunes-head">
          <button type="button" id="djclear" className={STRIP_BTN()} title="Remove the songs you queued from Up Next" onClick={() => void sh.store.getState().commands.clearQueue?.()}>Clear</button>
        </div>
      )}
    </>
  );
}

/** Grid of a list of songs: their albums (Music: the saved albums or the followed artists, under its
 *  Albums / Artists switch). A double-click opens an album; a group with no album page plays. */
function SongGrid({ c }: { c: TracksContent }) {
  const sh = useShell(), tab = useItunesView((s) => s.gridTab);
  const groups = albumsOf(c.tracks);
  const tiles: TileItem[] = c.browse ? (tab === 'artists' ? c.browse.artists : c.browse.albums)
    : groups.map((g) => ({ key: g.key, uri: g.uri ?? 'group:' + g.key, name: g.name, sub: g.artist, img: g.img, openable: true }));
  const first = (it: TileItem) => groups.find((g) => (g.uri ?? 'group:' + g.key) === it.uri)?.tracks[0];
  const open = (it: TileItem) => { if (it.uri.startsWith('spotify:')) viewActions.open(it.uri); else { const t = first(it); if (t) playRow(sh, c, t); } };
  const play = (it: TileItem) => { if (it.uri.startsWith('spotify:')) playUri(sh, it.uri); else { const t = first(it); if (t) playRow(sh, c, t); } };
  return (
    <>
      {c.browse && (
        <Strip title={tab === 'artists' ? 'Artists' : 'Albums'}>
          <Seg items={[['albums', 'Albums'], ['artists', 'Artists']] as const} value={tab} onChange={viewActions.setGridTab} />
        </Strip>
      )}
      <Tiles sections={[{ items: tiles }]} empty={c.loading ? 'Loading…' : c.browse ? (tab === 'artists' ? 'No artists followed.' : 'No albums saved.') : c.empty}
             onOpen={open} onPlay={play} more={c.more && !c.browse ? { label: 'More', load: c.more } : null} />
    </>
  );
}

/** Cover Flow: the albums of the songs on the black stage, the songs under it. A cover brought to the
 *  front selects its first song; a song selected brings its album's cover. */
function Flow({ c, table }: { c: TracksContent; table: (cls?: string) => ReactNode }) {
  const sh = useShell(), groups = albumsOf(c.tracks), now = useApp((s) => s.playback.track?.uri ?? null);
  // it opens on the playing song's album when that is in the list
  const [at, setAt] = useState(() => Math.max(0, groups.findIndex((g) => g.tracks.some((t) => t.uri === now))));
  const covers = groups.map((g) => ({ key: g.key, img: g.img, name: g.name, sub: g.artist }));
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      <CoverFlow id="coverflow" className="flex-none h-[46%] min-h-160" covers={covers} index={at} onIndex={setAt}
                 onActivate={(i) => { const t = groups[i]?.tracks[0]; if (t) playRow(sh, c, t); }} />
      <div className="flex-none h-6 bg-[linear-gradient(180deg,#2A2A2A,#0A0A0A)] border-y border-itunes-rule" aria-hidden="true" />
      {table('flex-auto')}
    </div>
  );
}

// ---- covers, artists, stations, search --------------------------------------------------------------

function Tiles({ sections, empty, heads, onOpen, onPlay, more }: {
  sections: TileSection[]; empty: string; heads?: boolean;
  onOpen?: (it: TileItem) => void; onPlay?: (it: TileItem) => void; more?: { label: string; load: () => void } | null;
}) {
  const sh = useShell(), tm = useTileMenu(), any = sections.some((s) => s.items.length);
  if (!any) return <Note text={empty} />;
  return (
    <div className="contents" onContextMenu={tm.onContextMenu(sections.flatMap((s) => s.items))}>
      {tm.menu}
      <AlbumGrid id="grid" className="flex-auto" sections={heads ? sections : sections.map((s) => ({ items: s.items }))} more={more}
                 onOpen={onOpen ?? ((it) => (it.openable ? viewActions.open(it.uri) : playUri(sh, it.uri)))}
                 onPlay={onPlay ?? ((it) => playUri(sh, it.uri))} />
    </div>
  );
}

function Artist({ c }: { c: Extract<Content, { kind: 'artist' }> }) {
  const sh = useShell(), p = usePlayback(), rm = useRowMenu(), likes = useLikes(c.tracks);
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      {rm.menu}
      <div className="contents" {...likes.wrap}>
        <TrackTable rows={c.tracks} columns={[COLUMNS.name, COLUMNS.time, COLUMNS.album, COLUMNS.plays, likes.column]} now={p.track?.uri ?? null} playing={p.playing}
                    onPlay={(t) => playRow(sh, c, t)} onContextMenu={rm.onContextMenu} resetKey={c.ctx} className={cx('flex-none max-h-[45%]', LIKE_CELLS)}
                    empty={c.loading ? 'Loading…' : 'No songs.'} id="tracks" />
      </div>
      <div className="flex-none h-22 px-10 text-12 leading-[22px] font-bold bg-itunes-head border-y border-itunes-rule">Albums</div>
      <Tiles sections={[{ items: c.albums }]} empty={c.loading ? 'Loading…' : 'No albums.'} />
    </div>
  );
}

function Stations({ c }: { c: Extract<Content, { kind: 'stations' }> }) {
  const sh = useShell(), now = useApp((s) => s.playback.context?.uri ?? null);
  const rows: Track[] = (c.stations ?? []).map((x) => ({ uri: x.uri, title: x.name, artist: x.sub ?? '', duration: 0 }));
  const cols: TrackColumn[] = [{ key: 'stream', header: 'Stream', cell: (t) => t.title, width: '1fr' }, { key: 'comments', header: 'Comments', cell: (t) => t.artist, width: '1.6fr' }];
  return <TrackTable id="tracks" className="flex-auto" rows={rows} columns={cols} now={now} onPlay={(t) => playUri(sh, t.uri)}
                     empty={c.stations === null ? 'Tuning…' : 'No stations yet: play something first.'} />;
}

/** STORE > Search Results: the songs first (as rows), then the artists, albums and playlists (as
 *  covers); the strip's kinds show one alone, paged on (More); a result opens inside the source, ‹ back
 *  to the results. */
function SearchResults() {
  return (
    <SearchScope.Provider value={{ node: 'search', open: viewActions.open }}>
      <SearchBody />
    </SearchScope.Provider>
  );
}
function SearchBody() {
  const sh = useShell(), r = useSearchResults(), p = usePlayback(), rm = useRowMenu();
  const songs = r.sections.find((x) => x.type === 'tracks'), rest = r.sections.filter((x) => x.type !== 'tracks'), likes = useLikes(songs?.tracks ?? []);
  if (r.note) return <Note text={r.note.replace(' (Ctrl+E)', ' (Ctrl+F)')} />;
  const tiles: TileSection[] = rest.map((x) => ({ title: x.title + ' (' + x.count + ')', items: x.rows.map((row) => ({
    key: row.uri, uri: row.uri, name: row.name, sub: row.sub, img: row.img, openable: true })) }));
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      {rm.menu}
      {songs?.tracks && (
        <div className="contents" {...likes.wrap}>
          <TrackTable id="tracks" className={cx(r.type ? 'flex-auto' : 'flex-none max-h-[50%]', LIKE_CELLS)} rows={songs.tracks} columns={[...listColumns(songs.tracks), likes.column]}
                      now={p.track?.uri ?? null} playing={p.playing} more={songs.more?.load} resetKey={r.q + '|' + r.type}
                      onPlay={(t) => sh.store.getState().commands.playContext(t.ctx ?? t.uri, t.uri)} onContextMenu={rm.onContextMenu} />
        </div>
      )}
      {!r.type && <div className="flex-none h-6 bg-itunes-head border-y border-itunes-rule" aria-hidden="true" />}
      {tiles.length > 0 && <Tiles sections={tiles} heads empty="" more={rest[0]?.more ?? null} />}
    </div>
  );
}

// ---- the bottom bar ---------------------------------------------------------------------------------

const BAR_BTN = 'grid place-items-center w-34 h-20 p-0 border-0 rounded-xs bg-transparent text-itunes-bar-glyph [filter:drop-shadow(0_1px_0_rgba(255,255,255,.55))] hover:bg-white/25 disabled:opacity-55';

/** + (New Playlist), shuffle (Off, Shuffle, Smart Shuffle: a sparkle), repeat (a small 1 for one song),
 *  the artwork pane; the status text; the AirPlay menu (the Connect devices; the playing one's name beside
 *  it when it is not this window) and Genius. */
function BottomBar({ content, mode }: { content: Content; mode: ViewMode }) {
  const tab = useItunesView((s) => s.gridTab), browse = content.kind === 'tracks' && mode === 'grid' ? content.browse : undefined;
  const n = browse ? (tab === 'artists' ? browse.artists : browse.albums).length : 0;
  const line = statusLine(content), episodes = content.kind === 'tracks' && isShow(content.ctx);
  const status = browse ? n.toLocaleString('en-US') + ' ' + (tab === 'artists' ? (n === 1 ? 'artist' : 'artists') : n === 1 ? 'album' : 'albums')
    : episodes ? line.replace(/\bsong(s?)\b/, 'episode$1') : line;
  const devices = useDevices(() => ''), genius = useGenius(), repeat = usePlayback().repeat, others = useApp((s) => s.devices.list.find((d) => d.active && d.id !== s.devices.self)?.name ?? '');
  const sh = useShell(), create = useApp((s) => !!s.commands.createPlaylist);
  return (
    <div id="bottombar" className="flex-none flex items-center gap-5 h-25 px-14 border-t border-itunes-bar-edge bg-itunes-bar bare:hidden">
      <button type="button" className={BAR_BTN} id="bnew" disabled={!create} title="New Playlist" aria-label="New Playlist" onClick={() => newPlaylist(sh)}><Icon name="add" size={18} /></button>
      <ShuffleButton className={cx(BAR_BTN, 'relative data-on:text-itunes-lit')} size={18} sparkle="right-3 top-0" />
      <TransportButton action="repeat" id="brepeat" className={cx(BAR_BTN, 'relative data-on:text-itunes-lit')}>
        <Icon name="repeat" size={18} />
        {repeat === 'track' && <span className="absolute right-3 top-0 text-[8px] leading-none font-bold">1</span>}
      </TransportButton>
      <button type="button" className={BAR_BTN} id="bartwork" title="Show or hide the artwork" aria-label="Show or hide the artwork" onClick={viewActions.toggleArtwork}><Icon name="artwork" size={17} /></button>
      <div className="flex-auto min-w-0 truncate text-center text-11 text-[#2B2B2B] [text-shadow:0_1px_0_rgba(255,255,255,.5)]" id="status">{status}</div>
      <Dropdown owner="airplay" items={withAirPlay(devices.items)} classes={MENU}>
        <button type="button" id="bdevice" data-menuzone="" title={devices.title} aria-label={devices.title}
                className={cx(BAR_BTN, 'w-auto px-5 gap-5 flex', devices.elsewhere && 'text-itunes-lit')}>
          <Icon name="airplay" />{others && <span className="text-11 text-[#2B2B2B] max-w-140 truncate">{others}</span>}
        </button>
      </Dropdown>
      <button type="button" className={BAR_BTN} id="bgenius" disabled={!genius} title="Start Genius (radio from the playing song)" aria-label="Start Genius" onClick={() => genius?.()}><Icon name="genius" /></button>
    </div>
  );
}

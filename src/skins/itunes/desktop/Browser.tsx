// The window's body under the toolbar (REFERENCE §Window layout): the source list (with the artwork
// pane at its foot) and, beside it, what the selected source shows in its view, then the bottom bar.
// A narrow window (under 760 px) folds the sidebar away; View > Show Sidebar lays it over the content.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import type { Track } from '../../../model';
import {
  artOk, canSave, cx, Dropdown, SearchScope, TransportButton, useAddTo, useApp, useDevices, usePlayback, useSearchResults, useShell,
  type MenuEntry, type TileItem, type TileSection,
} from '../../../ui';
import { AlbumGrid } from '../shared/AlbumGrid';
import { AlbumList } from '../shared/AlbumList';
import { albumsOf, playRow, playUri, queueOrder, showPlaying, startGenius, statusLine, useSourceContent, type Content, type TracksContent } from '../shared/content';
import { CoverFlow } from '../shared/CoverFlow';
import { Icon } from '../shared/icons';
import { SourceList } from '../shared/SourceList';
import { useSources, type Source } from '../shared/sources';
import { useItunesView, viewActions, type ViewMode } from '../shared/state';
import { COLUMNS, TrackTable, type TrackColumn } from '../shared/TrackTable';
import { MENU, useGenius } from './Chrome';

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
        <Sidebar sources={sel.src.sections} selected={sel.source?.id ?? ''}
                 className={cx('w-188 flex-none', narrow && (open ? 'absolute left-0 top-0 bottom-0 z-30 shadow-[4px_0_10px_rgba(0,0,0,.3)]' : 'hidden'))} />
        <div className="flex-none w-4 bg-[linear-gradient(90deg,#D1D1D1,#BABABA_60%,#D8D8D8)] border-l border-itunes-split max-[759px]:hidden" aria-hidden="true" />
        <Main sel={sel} />
      </div>
      <BottomBar content={sel.content} mode={sel.mode} />
    </div>
  );
}
function Sidebar({ sources, selected, className }: { sources: ReturnType<typeof useSources>['sections']; selected: string; className?: string }) {
  const artwork = useItunesView((s) => s.artwork);
  return (
    <div className={cx('flex flex-col min-h-0 bg-itunes-side', className)} id="sidebar">
      <SourceList sections={sources} selected={selected} onSelect={viewActions.select} className="flex-auto min-h-0 overflow-y-auto overflow-x-hidden pb-8" />
      {artwork && <ArtworkPane />}
    </div>
  );
}

/** The artwork pane: "Now Playing" over the playing song's cover, a click shows the song. */
function ArtworkPane() {
  const sh = useShell(), { art, has } = useApp((s) => ({ art: artOk(s.playback.track?.art), has: !!s.playback.track }));
  return (
    <div className="flex-none border-t border-itunes-split bg-[#E2E2E2]" id="artwork">
      <div className="h-18 px-8 text-11 leading-[18px] font-bold text-itunes-side-head text-center border-b border-[#CACACA] bg-itunes-head">{has ? 'Now Playing' : 'Nothing Playing'}</div>
      <button type="button" className="block w-full aspect-square p-0 border-0 bg-[#D6D6D6] cursor-default" title={has ? 'Show the current song' : undefined}
              onClick={() => showPlaying(sh)}>
        {art ? <img src={art} alt="Album art" className="block w-full h-full object-cover" />
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

type Sel = ReturnType<typeof useSelection>;

function Main({ sel }: { sel: Sel }) {
  const { content: c, source, depth, mode } = sel;
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
      {(store || depth > 0) && <Strip dark={store} back={store ? back ?? null : back} title={c.title} />}
      {body}
    </div>
  );
}

const Note = ({ text }: { text: string }) => <div className="flex-auto grid place-items-center text-12 text-itunes-dim px-20 text-center">{text}</div>;

// ---- songs ------------------------------------------------------------------------------------------

/** The row's right-click menu: Play, Play Next, Like, Add to Playlist, the album and the artist,
 *  Start Genius; iTunes DJ's rows Move to Top and Remove. A menu at the pointer: a Dropdown on a
 *  fixed point. */
function useRowMenu(queue?: { move: (a: number, b: number) => void; remove: (i: number) => void }) {
  const sh = useShell(), [at, setAt] = useState<{ x: number; y: number; t: Track; i: number } | null>(null);
  const addTo = useAddTo(at && canSave(at.t.uri) ? at.t.uri : null), queues = useApp((s) => !!s.commands.addToQueue);
  const items = (): MenuEntry[] => {
    if (!at) return [];
    const { t, i } = at, c = sh.store.getState().commands, artist = t.artistUris?.[0], album = t.albumUri;
    return [
      { label: 'Play', act: () => playRow(sh, { kind: 'tracks', ctx: t.ctx ?? null } as TracksContent, t) },
      ...(queues && !queue ? [{ label: 'Play Next', act: () => c.addToQueue?.(t.uri) }] : []),
      ...(queue ? [{ label: 'Move to Top', disabled: i === 0, act: () => queue.move(i, 0) }, { label: 'Remove from Up Next', act: () => queue.remove(i) }] : []),
      { sep: true },
      ...(addTo.uri ? [{ label: addTo.saved ? 'Unlike' : 'Like', act: addTo.toggle }, addTo.playlistMenu('Add to Playlist'), { sep: true as const }] : []),
      { label: 'Show Album', disabled: !album, act: () => { if (album) viewActions.open(album); } },
      { label: 'Show Artist', disabled: !artist, act: () => { if (artist) viewActions.open(artist); } },
      { label: 'Start Genius', disabled: !t.uri.startsWith('spotify:track:'), act: () => startGenius(sh, t.uri) },
    ];
  };
  return {
    onContextMenu: (t: Track, i: number, e: MouseEvent) => { setAt({ x: e.clientX, y: e.clientY, t, i }); sh.store.getState().actions.setUi({ menu: 'row' }); },
    menu: (
      <Dropdown owner="row" items={items} classes={MENU}>
        <span className="fixed w-1 h-1 pointer-events-none" style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} aria-hidden="true" />
      </Dropdown>
    ),
  };
}

function Tracks({ c, mode, source }: { c: TracksContent; mode: ViewMode; source: Source | undefined }) {
  const sh = useShell(), p = usePlayback(), now = p.track?.uri ?? null, reveal = useItunesView((s) => s.reveal);
  const edits = useApp((s) => !!s.commands.reorderQueue), n = c.tracks.length;
  const reorder = (order: number[]) => sh.store.getState().commands.reorderQueue?.(order);
  const queue = c.queue && edits ? { move: (a: number, b: number) => reorder(queueOrder(n, { move: [a, b] })), remove: (i: number) => reorder(queueOrder(n, { remove: i })) } : undefined;
  const rm = useRowMenu(queue), key = (source?.id ?? '') + '|' + c.title;
  const play = (t: Track) => playRow(sh, c, t);
  // "show the current song": the playing row selected
  const [shown, setShown] = useState(0), at = reveal !== shown && now ? c.tracks.findIndex((t) => t.uri === now) : -1;
  useEffect(() => { if (at >= 0) setShown(reveal); }, [at, reveal]); // eslint-disable-line react-hooks/set-state-in-effect -- once shown, the next reveal waits for a new bump
  const table = (cls?: string, cols?: TrackColumn[]) => (
    <TrackTable id="tracks" className={cls} rows={c.tracks} columns={cols} now={now} playing={p.playing} onPlay={play} more={c.more} resetKey={key}
                queue={queue} onContextMenu={rm.onContextMenu} reveal={at >= 0 ? at : null} empty={c.loading ? 'Loading…' : c.empty} />
  );
  const cols = c.queue ? [COLUMNS.name, COLUMNS.time, COLUMNS.artist, COLUMNS.album] : undefined;
  let body: ReactNode;
  if (mode === 'album') body = <AlbumList rows={c.tracks} now={now} playing={p.playing} onPlay={play} more={c.more} resetKey={key} className="flex-auto" empty={c.loading ? 'Loading…' : c.empty} />;
  else if (mode === 'grid') body = <SongGrid c={c} />;
  else if (mode === 'flow') body = <Flow c={c} table={table} />;
  else body = table('flex-auto', cols);
  return <>{rm.menu}{body}</>;
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
          <div className="flex h-18 rounded-full border border-itunes-rim overflow-hidden text-11" role="tablist">
            {(['albums', 'artists'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => viewActions.setGridTab(t)}
                      className={cx('px-10 border-0', tab === t ? 'bg-itunes-seg-on text-white' : 'bg-itunes-seg text-black')}>{t === 'albums' ? 'Albums' : 'Artists'}</button>
            ))}
          </div>
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

// ---- covers, artists, stations, search, devices -----------------------------------------------------

function Tiles({ sections, empty, heads, onOpen, onPlay, more }: {
  sections: TileSection[]; empty: string; heads?: boolean;
  onOpen?: (it: TileItem) => void; onPlay?: (it: TileItem) => void; more?: { label: string; load: () => void } | null;
}) {
  const sh = useShell(), any = sections.some((s) => s.items.length);
  if (!any) return <Note text={empty} />;
  return (
    <AlbumGrid id="grid" className="flex-auto" sections={heads ? sections : sections.map((s) => ({ items: s.items }))} more={more}
               onOpen={onOpen ?? ((it) => (it.openable ? viewActions.open(it.uri) : playUri(sh, it.uri)))}
               onPlay={onPlay ?? ((it) => playUri(sh, it.uri))} />
  );
}

function Artist({ c }: { c: Extract<Content, { kind: 'artist' }> }) {
  const sh = useShell(), p = usePlayback(), rm = useRowMenu();
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      {rm.menu}
      <TrackTable rows={c.tracks} columns={[COLUMNS.name, COLUMNS.time, COLUMNS.album, COLUMNS.plays]} now={p.track?.uri ?? null} playing={p.playing}
                  onPlay={(t) => playRow(sh, c, t)} onContextMenu={rm.onContextMenu} resetKey={c.ctx} className="flex-none max-h-[45%]" empty={c.loading ? 'Loading…' : 'No songs.'}
                  id="tracks" />
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
 *  covers); a result opens inside the source, ‹ back to the results. */
function SearchResults() {
  return (
    <SearchScope.Provider value={{ node: 'search', open: viewActions.open }}>
      <SearchBody />
    </SearchScope.Provider>
  );
}
function SearchBody() {
  const sh = useShell(), r = useSearchResults(), p = usePlayback(), rm = useRowMenu();
  const songs = r.sections.find((x) => x.type === 'tracks'), rest = r.sections.filter((x) => x.type !== 'tracks');
  if (r.note) return <Note text={r.note.replace(' (Ctrl+E)', ' (Ctrl+F)')} />;
  const tiles: TileSection[] = rest.map((x) => ({ title: x.title + ' (' + x.count + ')', items: x.rows.map((row) => ({
    key: row.uri, uri: row.uri, name: row.name, sub: row.sub, img: row.img, openable: true })) }));
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      {rm.menu}
      {songs?.tracks && (
        <TrackTable id="tracks" className="flex-none max-h-[50%]" rows={songs.tracks} now={p.track?.uri ?? null} playing={p.playing}
                    onPlay={(t) => sh.store.getState().commands.playContext(t.ctx ?? t.uri, t.uri)} onContextMenu={rm.onContextMenu} resetKey={r.q} />
      )}
      <div className="flex-none h-6 bg-itunes-head border-y border-itunes-rule" aria-hidden="true" />
      <Tiles sections={tiles} heads empty="" />
    </div>
  );
}

// ---- the bottom bar ---------------------------------------------------------------------------------

const BAR_BTN = 'grid place-items-center w-34 h-20 p-0 border-0 rounded-xs bg-transparent text-itunes-bar-glyph [filter:drop-shadow(0_1px_0_rgba(255,255,255,.55))] hover:bg-white/25 disabled:opacity-55';

/** + (a new playlist: not on Spotify here, greyed), shuffle, repeat (a small 1 for one song), the
 *  artwork pane; the status text; the AirPlay menu (the Connect devices; the playing one's name beside
 *  it when it is not this window) and Genius. */
function BottomBar({ content, mode }: { content: Content; mode: ViewMode }) {
  const tab = useItunesView((s) => s.gridTab), browse = content.kind === 'tracks' && mode === 'grid' ? content.browse : undefined;
  const n = browse ? (tab === 'artists' ? browse.artists : browse.albums).length : 0;
  const status = browse ? n.toLocaleString('en-US') + ' ' + (tab === 'artists' ? (n === 1 ? 'artist' : 'artists') : n === 1 ? 'album' : 'albums') : statusLine(content);
  const devices = useDevices(() => ''), genius = useGenius(), repeat = usePlayback().repeat, others = useApp((s) => s.devices.list.find((d) => d.active && d.id !== s.devices.self)?.name ?? '');
  return (
    <div id="bottombar" className="flex-none flex items-center gap-5 h-25 px-14 border-t border-itunes-bar-edge bg-itunes-bar bare:hidden">
      <button type="button" className={BAR_BTN} disabled title="New playlist (not available for Spotify playlists here)" aria-label="New playlist"><Icon name="add" size={18} /></button>
      <TransportButton action="shuffle" id="bshuffle" className={cx(BAR_BTN, 'data-on:text-itunes-lit')}><Icon name="shuffle" size={18} /></TransportButton>
      <TransportButton action="repeat" id="brepeat" className={cx(BAR_BTN, 'relative data-on:text-itunes-lit')}>
        <Icon name="repeat" size={18} />
        {repeat === 'track' && <span className="absolute right-3 top-0 text-[8px] leading-none font-bold">1</span>}
      </TransportButton>
      <button type="button" className={BAR_BTN} id="bartwork" title="Show or hide the artwork" aria-label="Show or hide the artwork" onClick={viewActions.toggleArtwork}><Icon name="artwork" size={17} /></button>
      <div className="flex-auto min-w-0 truncate text-center text-11 text-[#2B2B2B] [text-shadow:0_1px_0_rgba(255,255,255,.5)]" id="status">{status}</div>
      <Dropdown owner="airplay" items={devices.items} classes={MENU}>
        <button type="button" id="bdevice" data-menuzone="" title={devices.title} aria-label={devices.title}
                className={cx(BAR_BTN, 'w-auto px-5 gap-5 flex', devices.elsewhere && 'text-itunes-lit')}>
          <Icon name="airplay" />{others && <span className="text-11 text-[#2B2B2B] max-w-140 truncate">{others}</span>}
        </button>
      </Dropdown>
      <button type="button" className={BAR_BTN} id="bgenius" disabled={!genius} title="Start Genius (radio from the playing song)" aria-label="Start Genius" onClick={() => genius?.()}><Icon name="genius" /></button>
    </div>
  );
}

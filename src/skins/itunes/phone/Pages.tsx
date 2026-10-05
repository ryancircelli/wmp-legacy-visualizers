// The source list and a source's page on the phone. The list is iTunes' sidebar at full width with
// fingertip rows (LIBRARY, STORE, GENIUS, PLAYLISTS) under the search field, which scrolls with it as
// the iPhone's Music app of 2010 kept its list's search bar; a source's page is what iTunes showed
// beside it, under a strip with ‹ back, its name and, over a list of songs, iTunes' view switch (List,
// Album List, Grid: Cover Flow is the phone turned on its side, Root.tsx). Songs are the striped table,
// the status line ("15 songs, 1.0 hours") a row at the list's end as that Music app counted its lists.
// A tap plays a song or opens a cover (the phone's way; iTunes' was a double-click); a long press opens
// the song's sheet.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { mss, type Track } from '../../../model';
import { cx, SearchScope, useApp, useDebounced, usePlayback, useSearchResults, useShell, type TileItem, type TileSection } from '../../../ui';
import {
  AlbumGrid, albumsOf, COLUMNS, CoverFlow, Icon, playRow, playUri, queueOrder, SourceList, statusLine, styles, TrackTable, useItunesView,
  useSourceContent, useSources, VIEW_NAMES, viewActions, type Content, type FlowCover, type IconName, type Source, type TrackColumn,
  type TracksContent, type ViewMode,
} from '../shared';
import { nav } from './nav';
import { openSheet, TrackSheet, useLongPress, type QueueEdit } from './Sheet';

/** a row a finger can hit: 36 px is 44 points on a 390-point phone (host.ts NARROW) */
export const ROW = 36;

/** The selected source (Music while the selection resolves to nothing: a playlist deleted), what was
 *  opened in it, what that shows and in which view (a source left in Cover Flow on a desktop shows as
 *  List: the phone's Cover Flow is its side). */
export function useSelection() {
  const src = useSources(), id = useItunesView((s) => s.source), opened = useItunesView((s) => s.stack[s.stack.length - 1] ?? null);
  const depth = useItunesView((s) => s.stack.length);
  const source = src.find(id) ?? (src.loading ? undefined : src.find('music'));
  const content = useSourceContent(source, opened);
  const saved = useItunesView((s) => (source ? s.views[source.id] : undefined) ?? 'list'), mode: ViewMode = saved === 'flow' ? 'list' : saved;
  // a search cleared leaves Search Results: back to the source list (and its field)
  const gone = id === 'search' && !src.find('search');
  useEffect(() => { if (gone) { viewActions.select('store'); nav.home(); } }, [gone]);
  return { src, id, source, opened, depth, content, mode };
}
export type Selection = ReturnType<typeof useSelection>;

/** The strip over a page: ‹ and where it goes back to, the name centred, what the page adds at the
 *  right. Dark over the store, as iTunes' store bar, and over Now Playing's black. */
export function Strip({ title, back, backLabel, dark, right }: { title: string; back?: () => void; backLabel?: string; dark?: boolean; right?: ReactNode }) {
  return (
    <div id="strip" className={cx('relative flex-none flex items-center h-36 px-6 border-b',
                                  dark ? 'bg-itunes-store border-black text-white' : 'bg-itunes-head border-itunes-rule text-black')}>
      {back && (
        <button type="button" onClick={back} aria-label={'Back to ' + backLabel} id="bback"
                className={cx('relative z-1 flex items-center gap-3 max-w-[30%] h-26 pl-5 pr-7 rounded-sm border text-11 font-bold after:absolute after:-inset-y-5 after:-inset-x-6 after:content-[""]',
                              dark ? 'border-[#111] bg-[linear-gradient(180deg,#5A5A5A,#333)] text-white active:bg-[linear-gradient(180deg,#333,#555)]'
                                   : 'border-itunes-rim bg-itunes-seg text-[#333] active:bg-itunes-btn-down')}>
          <Icon name="back" size={9} className="flex-none" /><span className="truncate">{backLabel}</span>
        </button>
      )}
      <div className="absolute inset-x-[31%] top-0 h-full flex items-center justify-center pointer-events-none">
        <span className="truncate text-13 font-bold" id="striptitle">{title}</span>
      </div>
      <div className="relative z-1 ml-auto flex items-center gap-4">{right}</div>
    </div>
  );
}

export const Note = ({ text, dark }: { text: string; dark?: boolean }) => (
  <div className={cx('flex-auto grid place-items-center px-24 text-center text-12', dark ? 'bg-black text-itunes-flow-ink' : 'bg-white text-itunes-dim')}>{text}</div>
);

// ---- search -------------------------------------------------------------------------------------------

/** The search bar: iTunes' rounded field on the table header's grey. Typing searches Spotify (400 ms
 *  after the last key; Search Results appears under STORE); `go`: the keyboard's Search opens the
 *  results (the source list's bar), else it puts the keyboard away (the results page's own). The
 *  field's text is 16 px drawn at 13: iOS zooms the page into a field whose text is smaller than 16.
 *  Marked data-search-box (Ctrl+F). */
function SearchBar({ go }: { go?: boolean }) {
  const sh = useShell(), q = useApp((s) => s.ui.searchQ), [text, setText] = useState(q);
  const run = useDebounced((v) => sh.store.getState().commands.search(v));
  // another way in (a cleared search, a link) shows here
  useEffect(() => { setText(q); }, [q]); // eslint-disable-line react-hooks/set-state-in-effect -- the field follows the store's query
  const clear = () => { setText(''); run.now(''); };
  return (
    <div className="flex-none flex items-center h-40 px-8 bg-itunes-head border-b border-itunes-rule" id="searchbar">
      <label className="relative flex-auto min-w-0 h-28 rounded-full border border-itunes-rim border-t-[#9C9D9F] bg-itunes-search shadow-[inset_0_1px_2px_rgba(0,0,0,.2),0_1px_0_rgba(255,255,255,.55)] overflow-hidden has-focus:shadow-[inset_0_1px_2px_rgba(0,0,0,.2),0_0_0_2px_rgba(82,149,227,.55)]">
        <Icon name="search" size={13} className="absolute left-9 top-1/2 -translate-y-1/2 text-[#4F4F4F] pointer-events-none" />
        <input data-search-box="" type="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               aria-label="Search Spotify" placeholder="Search" value={text}
               className="absolute left-28 top-0 h-[34px] w-[calc((100%-54px)/.8125)] origin-top-left scale-[.8125] p-0 border-0 bg-transparent text-[16px] text-black outline-none appearance-none placeholder:text-itunes-hint [&::-webkit-search-cancel-button]:appearance-none select-text"
               onChange={(e) => { setText(e.currentTarget.value); run(e.currentTarget.value); }}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                   e.preventDefault();
                   run.now(text);
                   e.currentTarget.blur();
                   if (go && text.trim()) nav.source('search');
                 } else if (e.key === 'Escape' && text) { e.stopPropagation(); clear(); }
               }} />
        {text && (
          <button type="button" aria-label="Clear the search" onClick={clear}
                  className="absolute right-0 top-0 grid place-items-center w-28 h-full p-0 border-0 bg-transparent">
            <span className="grid place-items-center w-15 h-15 rounded-full bg-[#9A9A9A] text-white"><Icon name="close" size={10} /></span>
          </button>
        )}
      </label>
    </div>
  );
}

// ---- the source list --------------------------------------------------------------------------------

/** iTunes' sidebar at a phone's row height (the shared list's 20 px rows grown to 36; its headers given
 *  room): a tap opens the source's page. */
const SIDEBAR = cx('pb-16',
  '[&_[role=treeitem]]:h-36! [&_[role=treeitem]]:pl-14! [&_[role=treeitem]]:pr-12! [&_[role=treeitem]]:gap-9! [&_[role=treeitem]]:text-13!',
  '[&_[role=treeitem]>svg:first-child]:size-18! [&_[role=group]>div:first-child]:h-30! [&_[role=group]>div:first-child]:pt-13! [&_[role=group]>div:first-child]:pl-12!');

export function SourcesPage({ sel }: { sel: Selection }) {
  return (
    <div className="flex-auto min-h-0 overflow-y-auto overscroll-contain bg-itunes-side" id="sidebar">
      <SearchBar go />
      {sel.src.sections.length
        ? <SourceList sections={sel.src.sections} selected={sel.source?.id ?? ''} onSelect={nav.source} className={SIDEBAR} />
        : <div className="pt-60 text-center text-12 text-itunes-dim">{sel.src.loading ? 'Loading…' : ''}</div>}
    </div>
  );
}

// ---- a source's page --------------------------------------------------------------------------------

/** The page of the selected source (or what was opened in it). */
export function SourcePage({ sel, back, backLabel }: { sel: Selection; back: () => void; backLabel: string }) {
  const { content: c, source, mode } = sel;
  const store = source?.kind === 'store' || source?.kind === 'search';
  const songs = c.kind === 'tracks' && !c.queue, tab = useItunesView((s) => s.gridTab), browse = songs && !!c.browse && mode === 'grid';
  const body = c.kind === 'tracks' ? <Tracks c={c} mode={mode} source={source} />
    : c.kind === 'tiles' ? <Tiles sections={c.sections} empty={c.loading ? 'Loading…' : c.empty} heads={source?.kind === 'store'} />
    : c.kind === 'artist' ? <Artist c={c} />
    : c.kind === 'stations' ? <Stations c={c} />
    : c.kind === 'search' ? <SearchResults />
    : <Note text={c.kind === 'none' ? c.note : ''} />;
  return (
    <>
      <Strip title={c.title} back={back} backLabel={backLabel} dark={store} right={songs && <ViewSwitch mode={mode} />} />
      {c.kind === 'search' && <SearchBar />}
      {browse && <GridTabs tab={tab} />}
      {body}
    </>
  );
}

const VIEW_ICON: Partial<Record<ViewMode, IconName>> = { list: 'view-list', album: 'view-album', grid: 'view-grid' };

/** iTunes' view switch in the strip, small: List / Album List / Grid, the one shown pressed (dark). */
function ViewSwitch({ mode }: { mode: ViewMode }) {
  return (
    <div className="flex h-24 rounded-sm border border-itunes-rim shadow-[0_1px_0_rgba(255,255,255,.55)]" role="radiogroup" aria-label="View">
      {(['list', 'album', 'grid'] as const).map((m, i) => (
        <button key={m} type="button" id={'v' + m} role="radio" aria-checked={m === mode} aria-label={'View as ' + VIEW_NAMES[m]}
                className={cx('relative grid place-items-center w-30 h-full p-0 border-0 after:absolute after:-inset-y-6 after:inset-x-0 after:content-[""]',
                              i > 0 && 'border-l border-itunes-rim', i === 0 && 'rounded-l-[2px]', i === 2 && 'rounded-r-[2px]',
                              m === mode ? 'bg-itunes-seg-on text-white' : 'bg-itunes-seg text-[#2E2F31] active:bg-itunes-btn-down')}
                onClick={() => viewActions.setMode(m)}><Icon name={VIEW_ICON[m]!} size={13} /></button>
      ))}
    </div>
  );
}

/** Music's Grid: the saved albums or the followed artists (iTunes' Albums | Artists pills). */
function GridTabs({ tab }: { tab: 'albums' | 'artists' }) {
  return (
    <div className="flex-none flex items-center justify-center h-32 bg-[#F4F4F4] border-b border-[#D5D5D5]">
      <div className="flex h-22 rounded-full border border-itunes-rim overflow-hidden text-11" role="tablist">
        {(['albums', 'artists'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => viewActions.setGridTab(t)}
                  className={cx('px-14 border-0', tab === t ? 'bg-itunes-seg-on text-white' : 'bg-itunes-seg text-black')}>{t === 'albums' ? 'Albums' : 'Artists'}</button>
        ))}
      </div>
    </div>
  );
}

/** A song played once for a tap: the table reports the press and then, for a double tap, the double
 *  click too; the same song asked again within this long is the same tap. */
const AGAIN_MS = 700;
function usePlayOnce(play: (t: Track) => void): (t: Track) => void {
  const last = useRef({ uri: '', at: 0 });
  return (t) => {
    const now = Date.now();
    if (last.current.uri === t.uri && now - last.current.at < AGAIN_MS) return;
    last.current = { uri: t.uri, at: now };
    play(t);
  };
}

/** The table's columns on a phone: the name, its length, the artist (the album shows as Album List). */
const PHONE_COLUMNS: TrackColumn[] = [COLUMNS.name, { ...COLUMNS.time, width: 44 }, COLUMNS.artist];

/** The rows' long press: the song's sheet (Up Next's moves on iTunes DJ). */
function useRowSheet(rows: readonly Track[], c?: Content, queue?: QueueEdit) {
  return useLongPress((el) => {
    const i = Number(el.getAttribute('data-i')), t = rows[i];
    if (t) openSheet(<TrackSheet t={t} i={i} c={c} queue={queue} />);
  }, '[data-i]');
}

/** A list of songs scrolled with its status line after the last row (the stripes running on under it):
 *  the page scrolls, not the table, so the line is the list's end; the next page is asked here. */
function ListPage({ c, resetKey, lp, id, className, style, children }: {
  c: TracksContent; resetKey: string; lp: ReturnType<typeof useLongPress>; id?: string; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null), line = statusLine(c);
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = 0; }, [resetKey]);
  const nearEnd = () => { const b = box.current; if (c.more && b && b.scrollTop + b.clientHeight > b.scrollHeight - ROW * 10) c.more(); };
  useEffect(nearEnd, [c.tracks.length]); // eslint-disable-line react-hooks/exhaustive-deps -- a short first page asks for the next at once
  return (
    <div ref={box} id={id} onScroll={nearEnd} {...lp} className={cx('flex-auto min-h-0 overflow-y-auto overscroll-contain bg-white', className)} style={style}>
      {children}
      {line && <div id="listfoot" className="flex items-center justify-center text-12 text-itunes-dim" style={{ height: ROW }}>{line}</div>}
    </div>
  );
}

function Tracks({ c, mode, source }: { c: TracksContent; mode: ViewMode; source: Source | undefined }) {
  const sh = useShell(), p = usePlayback(), now = p.track?.uri ?? null, reveal = useItunesView((s) => s.reveal);
  const edits = useApp((s) => !!s.commands.reorderQueue), n = c.tracks.length;
  const reorder = (order: number[]) => sh.store.getState().commands.reorderQueue?.(order);
  const queue: QueueEdit | undefined = c.queue && edits
    ? { n, move: (a, b) => reorder(queueOrder(n, { move: [a, b] })), remove: (i) => reorder(queueOrder(n, { remove: i })) } : undefined;
  const key = (source?.id ?? '') + '|' + c.title, play = usePlayOnce((t) => playRow(sh, c, t)), lp = useRowSheet(c.tracks, c, queue);
  // "show the current song": the playing row selected, once per bump
  const [shown, setShown] = useState(0), at = reveal !== shown && now ? c.tracks.findIndex((t) => t.uri === now) : -1;
  useEffect(() => { if (at >= 0) setShown(reveal); }, [at, reveal]); // eslint-disable-line react-hooks/set-state-in-effect -- once shown, the next reveal waits for a new bump
  const empty = c.loading ? 'Loading…' : c.empty;
  if (mode === 'grid' && !c.queue) return <SongGrid c={c} />;
  if (mode === 'album' && !c.queue) {
    if (!c.tracks.length) return <Note text={empty} />;
    return <ListPage c={c} resetKey={key + '|album'} lp={lp} id="albumlist" className="text-12 select-none"><AlbumRows rows={c.tracks} now={now} playing={p.playing} onPlay={play} /></ListPage>;
  }
  return (
    <ListPage c={c} resetKey={key} lp={lp} className={styles.stripes} style={{ '--row': ROW + 'px', '--head': '23px' } as CSSProperties}>
      {/* the table does not scroll: the page does, the table's header sticking at its top */}
      <TrackTable id="tracks" className="overflow-visible!" rows={c.tracks} columns={PHONE_COLUMNS} now={now} playing={p.playing} onPlay={play} onSelect={play}
                  resetKey={key} reveal={at >= 0 ? at : null} empty={empty} row={ROW} />
    </ListPage>
  );
}

/** Album List on a phone: iTunes' album column narrowed to the cover with the name and artist under
 *  it, the album's songs beside it (#, name, length) in the stripes, a rule between albums. */
function AlbumRows({ rows, now, playing, onPlay }: { rows: Track[]; now: string | null; playing: boolean; onPlay: (t: Track) => void }) {
  return (
    <>
      {albumsOf(rows).map((g) => {
        const art = Math.min(80, g.tracks.length * ROW - 16);
        return (
          <div key={g.key} className="grid grid-cols-[96px_1fr] border-b border-itunes-group">
            <div className="min-w-0 px-8 py-6">
              {art >= 40 && (g.img
                ? <img src={g.img} alt="" loading="lazy" className="block mb-5 object-cover shadow-[0_1px_2px_rgba(0,0,0,.35)]" style={{ width: art, height: art }} />
                : <span className="mb-5 grid place-items-center bg-itunes-side text-itunes-side-icon" style={{ width: art, height: art }}><Icon name="music" size={24} /></span>)}
              <div className="font-bold leading-[14px] line-clamp-2 break-words">{g.name}</div>
              <div className="leading-[15px] truncate text-itunes-dim">{g.artist}</div>
            </div>
            <div className="min-w-0">
              {g.tracks.map((t, j) => {
                const i = g.index[j]!, on = !!now && t.uri === now;
                return (
                  <div key={i + ':' + t.uri} data-i={i} data-now={on || undefined} onClick={() => onPlay(t)} style={{ height: ROW }}
                       className={cx('flex items-center pr-8 cursor-default', i % 2 ? 'bg-itunes-stripe' : 'bg-white')}>
                    <span className="flex-none w-20 text-center text-itunes-glyph">{on && <Icon name={playing ? 'playing' : 'vol-low'} size={12} className="inline-block align-middle" />}</span>
                    <span className="flex-none w-22 pr-6 text-right [font-variant-numeric:tabular-nums] text-itunes-dim">{t.trackNumber ?? j + 1}</span>
                    <span className="flex-auto min-w-0 truncate">{t.title}</span>
                    <span className="flex-none w-40 text-right [font-variant-numeric:tabular-nums]">{t.duration ? mss(t.duration) : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Grid of a list of songs: their albums (Music: the saved albums or the followed artists). A tap opens
 *  an album; a group with no album page plays. */
function SongGrid({ c }: { c: TracksContent }) {
  const sh = useShell(), tab = useItunesView((s) => s.gridTab), groups = albumsOf(c.tracks);
  const tiles: TileItem[] = c.browse ? (tab === 'artists' ? c.browse.artists : c.browse.albums)
    : groups.map((g) => ({ key: g.key, uri: g.uri ?? 'group:' + g.key, name: g.name, sub: g.artist, img: g.img, openable: true }));
  const first = (it: TileItem) => groups.find((g) => (g.uri ?? 'group:' + g.key) === it.uri)?.tracks[0];
  const go = (it: TileItem, f: (uri: string) => void) => { if (it.uri.startsWith('spotify:')) f(it.uri); else { const t = first(it); if (t) playRow(sh, c, t); } };
  return (
    <Tiles sections={[{ items: tiles }]} empty={c.loading ? 'Loading…' : c.browse ? (tab === 'artists' ? 'No artists followed.' : 'No albums saved.') : c.empty}
           onOpen={(it) => go(it, viewActions.open)} onPlay={(it) => go(it, (u) => playUri(sh, u))}
           more={c.more && !c.browse ? { label: 'More', load: c.more } : null} />
  );
}

/** Cover Flow's stage with a tap on the front cover playing it (iTunes' double-click); a flick that
 *  ends on it is a flick. The phone on its side (Root.tsx). */
export function FlowStage({ covers, start, onActivate, className }: { covers: FlowCover[]; start: number; onActivate: (i: number) => void; className?: string }) {
  const [at, setAt] = useState(start), down = useRef({ x: 0, y: 0 }), acted = useRef(0);
  const act = (i: number) => { const now = Date.now(); if (now - acted.current > AGAIN_MS) { acted.current = now; onActivate(i); } };
  return (
    <div className={cx('relative', className)} onPointerDownCapture={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
         onClick={(e) => {
           if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 10) return;
           if ((e.target as Element).closest('[data-front]')) act(at);
         }}>
      <CoverFlow id="coverflow" className="w-full h-full" covers={covers} index={at} onIndex={setAt} onActivate={act} />
    </div>
  );
}

// ---- covers, artists, stations, search ----------------------------------------------------------------

/** Covers (iTunes' Grid at its small size): a tap opens one (a song tile plays), its round ▶ plays it
 *  where it stands. */
function Tiles({ sections, empty, heads, onOpen, onPlay, more, className }: {
  sections: TileSection[]; empty: string; heads?: boolean; onOpen?: (it: TileItem) => void; onPlay?: (it: TileItem) => void;
  more?: { label: string; load: () => void } | null; className?: string;
}) {
  const sh = useShell();
  if (!sections.some((s) => s.items.length)) return <Note text={empty} />;
  const open = onOpen ?? ((it: TileItem) => (it.openable ? viewActions.open(it.uri) : playUri(sh, it.uri)));
  const find = (uri: string | null) => sections.flatMap((s) => s.items).find((x) => x.uri === uri);
  return (
    <div className={cx('flex-auto min-h-0 flex flex-col', className)}
         onClick={(e) => { const it = find((e.target as Element).closest('button[data-uri]')?.getAttribute('data-uri') ?? null); if (it) open(it); }}>
      <AlbumGrid id="grid" className="flex-auto overscroll-contain" size="small" sections={heads ? sections : sections.map((s) => ({ items: s.items }))}
                 more={more} onOpen={open} onPlay={onPlay ?? ((it) => playUri(sh, it.uri))} />
    </div>
  );
}

function Artist({ c }: { c: Extract<Content, { kind: 'artist' }> }) {
  const sh = useShell(), p = usePlayback(), play = usePlayOnce((t) => playRow(sh, c, t)), lp = useRowSheet(c.tracks, c);
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      <div className="flex-none max-h-[45%] min-h-0 flex flex-col" {...lp}>
        <TrackTable id="tracks" className="flex-auto" rows={c.tracks} columns={[COLUMNS.name, { ...COLUMNS.time, width: 44 }, { ...COLUMNS.plays, width: 76 }]}
                    now={p.track?.uri ?? null} playing={p.playing} onPlay={play} onSelect={play} resetKey={c.ctx} row={ROW}
                    empty={c.loading ? 'Loading…' : 'No songs.'} />
      </div>
      <div className="flex-none h-24 px-10 text-12 leading-[24px] font-bold bg-itunes-head border-y border-itunes-rule">Albums</div>
      <Tiles sections={[{ items: c.albums }]} empty={c.loading ? 'Loading…' : 'No albums.'} />
    </div>
  );
}

function Stations({ c }: { c: Extract<Content, { kind: 'stations' }> }) {
  const sh = useShell(), now = useApp((s) => s.playback.context?.uri ?? null), play = usePlayOnce((t) => playUri(sh, t.uri));
  const rows: Track[] = (c.stations ?? []).map((x) => ({ uri: x.uri, title: x.name, artist: x.sub ?? '', duration: 0 }));
  const cols: TrackColumn[] = [{ key: 'stream', header: 'Stream', cell: (t) => t.title, width: '1fr' }, { key: 'comments', header: 'Comments', cell: (t) => t.artist, width: '1.3fr' }];
  return <TrackTable id="tracks" className="flex-auto" rows={rows} columns={cols} now={now} onPlay={play} onSelect={play} row={ROW}
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
  const sh = useShell(), r = useSearchResults(), p = usePlayback();
  const songs = r.sections.find((x) => x.type === 'tracks'), rest = r.sections.filter((x) => x.type !== 'tracks');
  const play = usePlayOnce((t) => sh.store.getState().commands.playContext(t.ctx ?? t.uri, t.uri)), lp = useRowSheet(songs?.tracks ?? []);
  if (r.note) return <Note text={r.note.replace(' (Ctrl+E)', '')} />;
  const tiles: TileSection[] = rest.map((x) => ({ title: x.title + ' (' + x.count + ')', items: x.rows.map((row) => ({
    key: row.uri, uri: row.uri, name: row.name, sub: row.sub, img: row.img, openable: true })) }));
  return (
    <div className="flex-auto min-h-0 flex flex-col">
      {songs?.tracks && (
        <div className="flex-none max-h-[50%] min-h-0 flex flex-col" {...lp}>
          <TrackTable id="tracks" className="flex-auto" rows={songs.tracks} columns={PHONE_COLUMNS} now={p.track?.uri ?? null} playing={p.playing}
                      onPlay={play} onSelect={play} resetKey={r.q} row={ROW} />
        </div>
      )}
      <div className="flex-none h-6 bg-itunes-head border-y border-itunes-rule" aria-hidden="true" />
      <Tiles sections={tiles} heads empty="" />
    </div>
  );
}

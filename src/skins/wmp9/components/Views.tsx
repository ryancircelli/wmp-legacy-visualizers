// The task pane's other views, each in the screen's place (the visualizer hidden and held):
// Media Library (tree + details list), Media Guide (home feed tiles), Radio Tuner, Play on Device.
// Their loading (home once, radio on each visit, the selected collection) is the adapter's.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LIKED } from '../../../model';
import {
  AddTo, canSave, DetailsPane, ListTable, SearchScope, StationList, TileGrid, Tiles, Tree, useHome, usePlayingContext, cx, useLibrary, useRadio, useRadioSeeds,
  useSaved, useSearchResults, useSearchView,
} from '../../../ui';
import type { Track } from '../../../model';
import { ADDTO, MENU } from './Chrome';
import { NoArt } from './Screen';
import s from '../wmp9.module.css';

/** the views' shared frame: the grid cell the screen leaves, XP's field border, 11 px Tahoma on 15 px lines (whole pixels) */
const VIEW = 'col-start-2 row-start-1 min-w-0 min-h-0 mr-8 border border-xp-field font-xp text-11 leading-[15px] text-black';
const SEARCH = 'w-full py-1 px-4 border border-xp-field bg-white text-black';

const TILE = {
  heading: 'py-4 mb-4 font-bold leading-[15px] text-xp-heading border-b border-guide-rule',
  tile: 'group/tile relative flex-none w-104 p-4 border border-transparent rounded-sm bg-transparent bg-none text-left text-black cursor-pointer hover:bg-xp-hover hover:border-list-head-edge data-sel:bg-device-on data-sel:border-lit-edge',
  img: 'block w-96 h-96 object-cover bg-art-plate shadow-[0_1px_3px_rgba(0,0,0,.35)]',
  name: 'block truncate mt-4 font-bold leading-[15px]',
  sub: 'block truncate leading-[15px] text-xp-grey',
  // the corner ▶ (❚❚ on the playing context): a round WMP disc on the cover's bottom-right, 6 px in
  play: cx(s.disc, 'absolute left-70 top-70 w-24 h-24 rounded-full border border-disc-edge hidden place-items-center text-[10px] leading-[1] text-disc-glyph shadow-[0_1px_2px_rgba(40,56,90,.4)] hover:[filter:brightness(1.06)] group-hover/tile:grid group-focus-visible/tile:grid data-current:grid'),
};
/** The track tables' Add to column: the round button on a hovered row, with its ▾ on the selected
 *  one; the rows' saved flags asked 50 at a time. */
function useAddToLead(rows: Track[]) {
  const saved = useSaved(rows.map((t) => t.uri));
  return { className: 'w-40', cell: (t: Track, sel: boolean) => canSave(t.uri) ? (
    <AddTo uri={t.uri} saved={saved(t.uri) ?? null} menu={sel} owner="addto:row" menuClasses={MENU}
           classes={{ ...ADDTO, root: cx(ADDTO.root, 'align-top', !sel && 'invisible group-hover/row:visible') }} />
  ) : null };
}
/** XP Luna's push button: the dark blue rim with 3 px corners over a white-to-face gradient, amber inside on hover */
const XPBTN = 'h-21 py-0 px-8 bg-xp-face bg-xp-button text-black leading-[15px] border border-xp-default rounded-sm shadow-[inset_0_-1px_0_rgba(214,208,197,.9),inset_0_1px_0_#FFFFFF] hover:shadow-[inset_0_0_0_1px_#FFE7A2,inset_0_-2px_0_#F8B330] disabled:bg-none';
/** the list / tiles switch: WMP 9's small view-mode buttons */
const MODE = 'flex-none w-22 h-19 p-0 grid place-items-center bg-transparent border border-transparent rounded-xs hover:border-xp-edge hover:bg-xp-face-hot data-on:bg-xp-face data-on:border-xp-edge data-on:shadow-[inset_1px_1px_0_var(--color-xp-shade)]';

/** The Search view's box: typing searches after 400 ms, Enter at once; × clears it; Ctrl+E focuses it. */
function SearchBox({ search }: { search: ReturnType<typeof useSearchView>['search'] }) {
  const [text, setText] = useState(''), ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex-none relative py-5 px-8 bg-xp-face border-b border-xp-edge">
      <input className={SEARCH + ' pr-18 [&::-webkit-search-cancel-button]:appearance-none'} type="search" id="mlq" ref={ref} data-search-box=""
             placeholder="Search Spotify" aria-label="Search Spotify" value={text}
             onChange={(e) => { setText(e.currentTarget.value); search(e.currentTarget.value); }}
             onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search.now(text); } }} />
      {text && (
        <button type="button" id="mlqclear" title="Clear" aria-label="Clear the search"
                className="absolute right-11 top-1/2 -translate-y-1/2 w-14 h-14 p-0 bg-transparent border-0 text-xp-grey text-13 leading-[1] hover:text-black"
                onClick={() => { setText(''); ref.current?.focus(); }}>×</button>
      )}
    </div>
  );
}

const ROWBTN = 'flex items-center gap-8 w-full py-3 px-10 border-0 border-b border-xp-grid bg-transparent bg-none text-left text-black cursor-default hover:bg-xp-hover data-sel:bg-xp-select data-sel:text-white data-sel:*:text-white';

/** Search results: the top result card, then Songs / Artists / Albums / Playlists (a table and
 *  rows, or tiles), each with "Show all"; one type alone pages with Load more. */
function SearchResults({ tiles }: { tiles: boolean }) {
  const r = useSearchResults(), lib = useLibrary(), current = usePlayingContext(), lead = useAddToLead(r.sections.flatMap((x) => x.tracks ?? []));
  return (
    <div className="flex-auto min-h-0 overflow-auto bg-white" id="mlresults" data-type={r.type ?? 'all'}>
      {r.all && <button type="button" className="m-8 mb-0 p-0 bg-transparent border-0 text-xp-link underline" id="mlall" onClick={r.all}>‹ All results</button>}
      {r.note && <div className={EMPTY} id="mlnote">{r.note}</div>}
      {r.top && (
        <div className="m-10 mb-4 p-8 flex items-center gap-10 max-w-420 border border-list-head-edge rounded-sm bg-ml-head cursor-default hover:border-lit-edge"
             id="mltop" title={r.top.name} onClick={() => r.click(r.top!)} onDoubleClick={() => r.play(r.top!)}>
          {r.top.img ? <img className={'w-64 h-64 object-cover shadow-[0_1px_3px_rgba(0,0,0,.35)]' + (r.top.kind === 'artist' ? ' rounded-full' : '')} src={r.top.img} alt="" />
            : <span className="w-64 h-64 bg-art-plate" />}
          <span className="min-w-0 flex flex-col gap-2">
            <span className="text-10 leading-[13px] uppercase tracking-[.06em] text-xp-grey">Top result</span>
            <span className="font-bold text-14 leading-[17px] text-xp-heading truncate">{r.top.name}</span>
            <span className="text-xp-grey truncate">{r.top.kind.charAt(0).toUpperCase() + r.top.kind.slice(1)}{r.top.sub && r.top.kind !== 'artist' ? ' · ' + r.top.sub : ''}</span>
          </span>
        </div>
      )}
      {r.sections.map((sec) => (
        <section key={sec.type} className="mt-6" data-section={sec.type}>
          <div className="flex items-baseline gap-8 mx-10 mb-4 py-4 border-b border-guide-rule">
            <span className="font-bold text-xp-heading">{sec.title}</span>
            <span className="text-xp-grey">{sec.count}</span>
            {sec.showAll && <button type="button" className="ml-auto p-0 bg-transparent border-0 text-xp-link underline" onClick={sec.showAll}>Show all {sec.count}</button>}
          </div>
          {tiles && !sec.tracks ? (
            <TileGrid sections={[{ items: sec.rows.map((x) => ({ key: x.uri, uri: x.uri, name: x.name, sub: x.sub, img: x.img, openable: x.kind !== 'track' })) }]}
                      selected={r.selected} onClick={(t) => r.click(sec.rows.find((x) => x.uri === t.uri)!)} current={current}
                      onDoubleClick={(t) => r.play(sec.rows.find((x) => x.uri === t.uri)!)} onPlay={(t) => r.play(sec.rows.find((x) => x.uri === t.uri)!)} more={sec.more}
                      classes={{ ...TILE, section: 'px-10 pb-6', row: 'flex flex-wrap gap-10',
                        more: 'flex-none w-104 min-h-[132px] border border-dashed border-xp-edge rounded-sm bg-transparent text-xp-link underline' }} />
          ) : sec.tracks ? (
            <ListTable rows={sec.tracks} lead={lead} selected={lib.selected} now={lib.now} onSelect={lib.selectRow} onActivate={lib.playRow} onEscape={lib.deselect}
                       more={sec.more} className="outline-none" tableClassName="w-full border-collapse table-fixed [font:inherit]"
                       headClassName="py-2 px-6 text-left font-normal text-white bg-list-head border-r border-list-head-edge truncate"
                       cellClassName="py-1 px-6 border-b border-b-xp-grid border-r border-r-xp-grid-v truncate cursor-default"
                       lenClassName="w-52 text-right!"
                       rowClassName="group/row data-now:*:text-xp-link data-now:*:font-bold data-sel:*:bg-xp-select data-sel:*:text-white!"
                       moreClassName="*:text-center *:text-xp-link *:underline *:cursor-pointer" />
          ) : (
            <div>
              {sec.rows.map((x) => (
                <button key={x.uri} type="button" className={ROWBTN} data-sel={r.selected === x.uri || undefined} data-uri={x.uri}
                        onClick={() => r.click(x)} onDoubleClick={() => r.play(x)}>
                  {x.img ? <img className={'flex-none w-24 h-24 object-cover' + (x.kind === 'artist' ? ' rounded-full' : '')} src={x.img} alt="" />
                    : <span className="flex-none w-24 h-24 bg-art-plate" />}
                  <span className="min-w-0 flex flex-col"><span className="font-bold truncate">{x.name}</span><span className="text-xp-grey truncate">{x.sub}</span></span>
                </button>
              ))}
              {sec.more && <button type="button" className="block w-full py-3 text-center bg-transparent border-0 text-xp-link underline" onClick={sec.more.load}>{sec.more.label}</button>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

type Lib = ReturnType<typeof useLibrary>;

/** Liked Songs' cover: a white heart on WMP's blue plate */
function LikedCover() {
  return (
    <svg className={TILE.img} viewBox="0 0 96 96" aria-hidden="true">
      <defs><linearGradient id="gliked" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5E7FD8"/><stop offset="1" stopColor="#2B3E8C"/></linearGradient></defs>
      <rect width="96" height="96" fill="url(#gliked)"/>
      <path d="M48 70 C28 56 22 46 22 38 C22 30 28 25 35 25 C41 25 45 29 48 33 C51 29 55 25 61 25 C68 25 74 30 74 38 C74 46 68 56 48 70 Z" fill="#FFFFFF"/>
    </svg>
  );
}

/** The list header shared by the Media Library and Search: title, count, Details / Tiles, Play all. */
function ListHead({ lib, lead }: { lib: Lib; lead?: ReactNode }) {
  return (
    <div className="flex-none flex items-center gap-8 py-5 px-8 bg-ml-head border-b border-xp-edge" id="mlhead">
      {lead}
      <span className="flex-auto min-w-0 font-bold leading-[15px] text-xp-heading truncate" id="mltitle">{lib.name}</span>
      <span className="flex-none leading-[15px] text-xp-grey" id="mlcount">{lib.count}</span>
      <span className="flex-none flex gap-1" role="group" aria-label="Library view">
        <button type="button" className={MODE} id="mlviewlist" title="Details" aria-pressed={lib.view === 'details'}
                data-on={lib.view === 'details' || undefined} onClick={() => lib.setView('details')}>
          <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
            <g fill="#2B448B"><rect x="1" y="1" width="2" height="2"/><rect x="1" y="5" width="2" height="2"/><rect x="1" y="9" width="2" height="2"/></g>
            <g fill="#5A6BB4"><rect x="4" y="1.5" width="9" height="1"/><rect x="4" y="5.5" width="9" height="1"/><rect x="4" y="9.5" width="9" height="1"/></g>
          </svg>
        </button>
        <button type="button" className={MODE} id="mlviewtiles" title="Tiles" aria-pressed={lib.view === 'tiles'}
                data-on={lib.view === 'tiles' || undefined} onClick={() => lib.setView('tiles')}>
          <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
            <g fill="#5A6BB4" stroke="#2B448B"><rect x="1.5" y="1.5" width="4" height="3.5"/><rect x="8.5" y="1.5" width="4" height="3.5"/>
              <rect x="1.5" y="7" width="4" height="3.5"/><rect x="8.5" y="7" width="4" height="3.5"/></g>
          </svg>
        </button>
      </span>
      <button type="button" className={XPBTN + ' flex-none min-w-60 px-10 disabled:text-xp-edge disabled:border-xp-edge disabled:bg-xp-face disabled:shadow-none'}
              id="mlplay" disabled={!lib.canPlayAll} onClick={lib.playAll}>Play all</button>
    </div>
  );
}

/** A collection as a table or tiles; an artist's page adds its discography strip. */
function ListBody({ lib }: { lib: Lib }) {
  const current = usePlayingContext(), lead = useAddToLead(lib.tracks);
  return (
    <>
      {lib.showTiles ? (
        <TileGrid id="mltiles" className="flex-auto min-h-0 overflow-auto py-6 bg-white outline-none" sections={lib.tiles} selected={lib.selected}
                  cover={(it) => (it.uri === LIKED ? <LikedCover /> : null)}
                  onClick={lib.clickTile} onDoubleClick={lib.playTile} onPlay={lib.playTile} current={current} onEscape={lib.deselect}
                  classes={{ ...TILE, section: 'pt-2 px-10 pb-8', row: 'flex flex-wrap gap-10',
                    more: 'flex-none w-104 min-h-[132px] border border-dashed border-xp-edge rounded-sm bg-transparent text-xp-link underline' }} />
      ) : (
        <ListTable rows={lib.tracks} lead={lead} selected={lib.selected} now={lib.now} onSelect={lib.selectRow} onActivate={lib.playRow}
                   onEscape={lib.deselect} more={lib.more}
                   resetKey={lib.node} id="mlscroll" className="flex-auto min-h-0 overflow-auto outline-none"
                   tableId="mltable" tableClassName="w-full border-collapse table-fixed [font:inherit]" bodyId="mlrows"
                   headClassName="sticky top-0 z-1 py-2 px-6 text-left font-normal text-white bg-list-head border-r border-list-head-edge truncate"
                   cellClassName="py-1 px-6 border-b border-b-xp-grid border-r border-r-xp-grid-v truncate cursor-default"
                   lenClassName="w-52 text-right!"
                   rowClassName="group/row data-now:*:text-xp-link data-now:*:font-bold data-sel:*:bg-xp-select data-sel:*:text-white!"
                   moreClassName="*:text-center *:text-xp-link *:underline *:cursor-pointer" />
      )}
      {/* an artist's page: the top tracks above, the discography as a strip of tiles */}
      {lib.artistAlbums && lib.artistAlbums.length > 0 && (
        <TileGrid id="mlalbums" className="flex-none max-h-[190px] overflow-auto border-t border-xp-edge bg-white" selected={lib.selected}
                  sections={[{ title: 'Albums', items: lib.artistAlbums }]} onClick={lib.clickTile} onDoubleClick={lib.playTile} onPlay={lib.playTile} current={current}
                  classes={{ ...TILE, section: 'pt-2 px-10 pb-6', row: 'flex gap-10 overflow-x-auto pb-4 [scrollbar-width:thin]' }} />
      )}
    </>
  );
}

/** The details pane beside a list (hidden under 900 px) */
function Pane() {
  return (
    <DetailsPane id="mlinfo" placeholder={<NoArt className="block w-full h-auto" />}
                 addTo={(uri, saved) => canSave(uri)
                   ? <AddTo uri={uri} saved={saved} menu={saved === undefined} owner="addto:details" id="daddto" classes={ADDTO} menuClasses={MENU} />
                   : null} classes={{
      root: 'flex-none flex min-h-0 w-12 data-open:w-228 bg-white border-l border-xp-edge lt-900:hidden',
      column: 'flex-auto min-w-0 flex flex-col',
      // the band level with the list's header row (same height, gradient and rule)
      band: 'flex-none h-32 flex items-center px-10 bg-ml-head border-b border-xp-edge font-bold leading-[15px] text-xp-heading truncate',
      grip: 'flex-none w-12 flex items-center justify-center p-0 bg-ml-head border-0 border-r border-xp-edge text-xp-heading text-10 leading-[1] hover:bg-xp-hover',
      body: 'flex-auto min-h-0 overflow-auto p-10 flex flex-col gap-3',
      art: 'self-center w-164 max-w-full p-2 mb-6 bg-pl-art-bg shadow-[0_0_0_1px_var(--color-pl-art-edge),0_2px_4px_rgba(0,0,0,.45)]',
      img: 'block w-full aspect-square object-cover',
      avatar: 'inline-block w-16 h-16 mr-4 rounded-full object-cover align-middle',
      name: 'font-bold text-12 leading-[16px] text-xp-heading break-words',
      titleRow: 'flex items-start justify-between gap-6 *:first:min-w-0',
      line: 'truncate',
      link: 'p-0 bg-transparent border-0 text-xp-link underline hover:text-xp-select',
      badge: 'ml-6 py-0 px-3 align-middle text-[9px] leading-[13px] font-bold text-white bg-xp-grey rounded-xs',
      desc: 'text-xp-hint whitespace-pre-line break-words data-clamped:line-clamp-6',
      more: 'self-start p-0 bg-transparent border-0 text-xp-link underline',
      stats: 'mt-4 pt-6 border-t border-xp-grid flex flex-col gap-2 text-xp-grey',
      small: 'text-10 leading-[13px] text-xp-grey whitespace-pre-line',
      buttons: 'mt-8 flex flex-wrap gap-4',
      button: XPBTN,
      back: 'self-start max-w-full mb-4 p-0 bg-transparent border-0 text-left text-xp-link underline truncate',
    }} />
  );
}

export function MediaLibrary() {
  const lib = useLibrary();
  return (
    <div className={VIEW + ' flex gap-0 bg-xp-face'} id="mlib">
      {lib.showTree && (
        <div className="flex-none w-190 flex flex-col min-h-0 bg-white border-r border-xp-edge" id="mltree">
          <Tree nodes={lib.tree} selected={lib.node} onSelect={lib.open} id="mlnodes" className="flex-auto overflow-auto py-2"
                nodeClassName="block w-full py-1 pr-6 pl-20 border-0 bg-transparent bg-none text-left truncate text-black cursor-default data-top:pl-6 data-top:font-bold data-top:text-xp-heading not-data-on:hover:bg-xp-hover data-on:bg-xp-select data-on:text-white!" />
        </div>
      )}
      <div className="flex-auto min-w-0 flex flex-col bg-white" id="mldetail">
        <ListHead lib={lib} lead={lib.crumb && (
          <span className="flex-none flex items-center gap-4 leading-[15px]">
            <button type="button" className="p-0 bg-transparent border-0 text-xp-link underline" id="mlcrumb" onClick={lib.crumb.back}>‹ {lib.crumb.label}</button>
            <span className="text-xp-grey" aria-hidden="true">›</span>
          </span>
        )} />
        <ListBody lib={lib} />
      </div>
      <Pane />
    </div>
  );
}

/** Search all of Spotify: the box on top, the results (or a result's artist / album / playlist
 *  page) below, the details pane beside them. */
export function SearchView() {
  const v = useSearchView();
  return (
    <SearchScope.Provider value={v.scope}>
      <SearchViewBody v={v} />
    </SearchScope.Provider>
  );
}

function SearchViewBody({ v }: { v: ReturnType<typeof useSearchView> }) {
  const lib = useLibrary();
  const link = 'flex-none p-0 bg-transparent border-0 text-xp-link underline';
  return (
    <div className={VIEW + ' flex flex-col bg-xp-face'} id="msearch">
      <SearchBox search={v.search} />
      <div className="flex-auto min-h-0 flex">
        <div className="flex-auto min-w-0 flex flex-col bg-white" id="mldetail">
          <ListHead lib={lib} lead={v.back && <button type="button" className={link} id="mlall" onClick={v.back}>‹ All results</button>} />
          {v.opened ? (
            <>
              <div className="flex-none flex gap-12 py-3 px-8 border-b border-xp-grid bg-white">
                <button type="button" className={link} id="mltolib" onClick={v.toLibrary!}>Open in Media Library</button>
              </div>
              <ListBody lib={lib} />
            </>
          ) : <SearchResults tiles={lib.view === 'tiles'} />}
        </div>
        <Pane />
      </div>
    </div>
  );
}

function Panel({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <div className={VIEW + ' flex flex-col bg-white'} id={id}>
      <div className="flex-none flex items-baseline gap-10 py-6 px-10 bg-list-head text-white border-b border-view-head-edge">
        <span className="font-xp font-bold text-14 leading-[1.2] [text-shadow:1px_1px_1px_rgba(0,0,0,.35)]">{title}</span>
        <span className="text-view-note" id={id + 'note'}>{note}</span>
      </div>
      <div className="flex-auto min-h-0 overflow-auto py-6 px-0" id={id + 'body'}>{children}</div>
    </div>
  );
}

const EMPTY = 'p-12 text-xp-grey';
const TEXT = { text: 'min-w-0 flex flex-col', name: 'font-bold truncate', sub: 'text-xp-grey truncate', empty: EMPTY };
const ROW = 'flex items-center gap-8 w-full py-4 px-10 border-0 border-b border-xp-grid bg-transparent bg-none text-left text-black hover:bg-xp-hover';

/** Spotify's home feed: sections of 96 px cover tiles. */
export function MediaGuide() {
  const { sections } = useHome();
  return (
    <Panel id="mguide" title="Media Guide" note={sections === null ? 'Loading…' : ''}>
      <Tiles sections={sections} classes={{ ...TILE, section: 'pt-2 px-10 pb-8', row: 'flex gap-10 overflow-x-auto pb-4 [scrollbar-width:thin]' }} />
    </Panel>
  );
}

export function RadioTuner() {
  const { stations } = useRadio(useRadioSeeds());
  return (
    <Panel id="mradio" title="Radio Tuner" note={stations === null ? 'Tuning…' : ''}>
      <StationList stations={stations} classes={{ ...TEXT, row: ROW,
        play: s.radioplay + ' flex-none w-23 h-23 p-0 rounded-full border border-lit-edge text-radio-ink' }} />
    </Panel>
  );
}

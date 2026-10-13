// The black display plate: the visualization (with the lyric overlay, the screensaver caption
// and the debug overlay over it), the right-hand playlist pane and the info strip under both.
import { Fragment, useRef } from 'react';
import { Visualizer } from '../../../app/Visualizer';
import {
  AddTo, cx, Dropdown, Karaoke, playingTrack, useCaption, useDebugText, useFullscreen, useLyricScroll, usePlainLyrics, useMenus, useNowPlaying,
  usePaneLibrary, usePresetList, useScreenShown, useShell, useView, useVisControl, TransportButton, useApp,
} from '../../../ui';
import { nowPlayingMenu, visMenu } from '../../menus';
import { ADDTO, MENU } from './Chrome';
import s from '../wmp9.module.css';

export function Screen() {
  const fs = useFullscreen(), shown = useScreenShown();
  return (
    <div className="col-start-2 row-start-1 min-w-0 mr-8 flex flex-col overflow-hidden bg-black rounded-[0_6px_6px_6px] pb-14 shadow-[0_2px_5px_rgba(20,32,70,.45),0_0_0_1px_rgba(0,0,0,.6)] max-440:mr-4 bare:h-full bare:m-0 bare:p-0 bare:rounded-none bare:shadow-none"
         id="screen" hidden={!shown}>
      <div className="flex-auto min-h-0 flex bare:h-full" id="screenrow">
        <div className="flex-auto min-w-0 flex flex-col bg-black bare:h-full" id="display">
          {/* the visualization fills the area edge to edge: WMP 9's black surround is video letterboxing,
              and the visualizers stretch to fit (a margin here was only a black border) */}
          <div className="flex-auto relative min-h-0 bg-black" id="pane">
            <Visualizer className="block w-full h-full bg-black" id="view" onDoubleClick={fs.toggle} />
            <Debug />
            <Karaoke id="lyr" className="absolute left-[4%] right-[4%] bottom-12 bare:bottom-[6%] flex flex-col items-center gap-2 text-center pointer-events-none font-xp [text-shadow:0_1px_3px_rgba(0,0,0,.9),0_0_8px_rgba(0,0,0,.7)]"
                     ids={{ cur: 'lyrcur', next: 'lyrnext' }}
                     classes={{
                       cur: 'inline-block max-w-full min-h-[1.3em] py-1 px-9 rounded-md bg-[rgba(0,0,0,.42)] text-white font-xp font-bold text-14 leading-[1.3] bare:text-20 empty:invisible',
                       next: 'inline-block max-w-full min-h-[1.3em] py-1 px-9 rounded-md bg-[rgba(0,0,0,.42)] text-[rgba(255,255,255,.5)] font-xp text-13 leading-[1.3] bare:text-17 empty:invisible',
                       sung: 'text-lyric-gold',
                       // the current word fills gold left to right through --f
                       now: 'text-transparent [text-shadow:none] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,.9))] bg-[linear-gradient(90deg,var(--color-lyric-gold)_var(--f,0%),#FFFFFF_var(--f,0%))] bg-clip-text',
                     }} />
            <Caption />
          </div>
        </div>
        <PlaylistPane />
      </div>
      <VizCtl />
    </div>
  );
}

function Debug() {
  const d = useDebugText();
  return (
    <pre className="absolute right-6 top-6 max-w-[60%] max-h-[90%] overflow-auto m-0 py-7 px-9 font-mono text-11 leading-[1.4] text-dbg-ink bg-[rgba(0,0,0,.74)] border border-dbg-edge rounded-md whitespace-pre-wrap pointer-events-none"
         id="dbg" hidden={!d.on}>{d.text}</pre>
  );
}

/** Screensaver only: "Artist – Title" bottom-left, in on a track change, out 5 s later. */
function Caption() {
  const c = useCaption();
  return (
    <div className="absolute left-18 bottom-18 max-w-[40%] pt-3 px-10 pb-4 pointer-events-none border border-[rgba(255,255,255,.35)] rounded-sm bg-caption shadow-[0_1px_4px_rgba(0,0,0,.5)] text-white [text-shadow:1px_1px_1px_rgba(0,0,0,.45)] font-xp text-12 leading-[1.3] truncate opacity-0 [transition:opacity_.8s] data-on:opacity-92"
         id="sscap" data-on={c.on || undefined}>{c.text}</div>
  );
}

/** the WMP "no album art" plate: film strip + note */
export function NoArt({ className, id, style }: { className?: string; id?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} id={id} style={style} viewBox="0 0 112 92" aria-hidden="true">
      <rect width="112" height="92" fill="#4A5689"/>
      <g fill="#C6CBDC">
        <path d="M14 20 h22 v56 h-22 z"/>
        <path d="M40 16 c14 6 26 6 34 2 v54 c-8 4 -20 4 -34 -2 z"/>
      </g>
      <g fill="#2B3350">
        <rect x="14" y="20" width="22" height="6"/><rect x="14" y="70" width="22" height="6"/>
        <rect x="40" y="18" width="34" height="7"/><rect x="40" y="63" width="34" height="7"/>
      </g>
      <g fill="#7E87A8">
        <rect x="17" y="28" width="4" height="4"/><rect x="17" y="36" width="4" height="4"/>
        <rect x="17" y="44" width="4" height="4"/><rect x="17" y="52" width="4" height="4"/>
        <rect x="17" y="60" width="4" height="4"/>
        <rect x="29" y="28" width="4" height="4"/><rect x="29" y="36" width="4" height="4"/>
        <rect x="29" y="44" width="4" height="4"/><rect x="29" y="52" width="4" height="4"/>
        <rect x="29" y="60" width="4" height="4"/>
      </g>
      <path d="M78 14 c8 4 14 10 16 18 c-4 -6 -10 -9 -16 -10 z" fill="#E6E9F2"/>
      <path d="M74 20 v40" stroke="#E6E9F2" strokeWidth="4" fill="none"/>
      <ellipse cx="66" cy="62" rx="11" ry="8" fill="#DDE1EE"/>
      <ellipse cx="63" cy="59" rx="5" ry="3.4" fill="#F6F8FC"/>
    </svg>
  );
}

const LINK = 'cursor-pointer hover:underline';
const LIST = 'flex-auto min-h-50 overflow-auto py-2 bg-listbox [scrollbar-width:thin] [scrollbar-color:var(--color-pl-scroll)_var(--color-pl-scroll-track)]';
const GROUP = 'py-3 px-7 bg-list-group text-pl-group-ink font-bold border-t border-pl-group-edge';
const ITEM = 'block w-full py-2 pr-7 pl-16 bg-transparent bg-none border-0 text-left text-pl-ink truncate hover:bg-pl-hot hover:text-white focus:bg-pl-hot focus:text-white data-on:bg-list-on data-on:text-white data-on:font-bold data-sub:pl-28';

export function PlaylistPane() {
  const np = useNowPlaying(), plain = usePlainLyrics(), pllyr = useRef<HTMLDivElement>(null);
  useLyricScroll(pllyr, plain !== null);
  return (
    <div className="flex-none w-202 flex flex-col min-w-0 overflow-hidden bg-pl-bg border-l border-black max-620:hidden max-620:spotify:flex nopl:hidden! bare:hidden!" id="playlist">
      <div className="flex-none h-26 flex items-center px-9 bg-pl-band shadow-[inset_0_1px_0_rgba(255,255,255,.28)] text-pl-band-ink font-bold tracking-[.02em]" id="plband">Now Playing</div>
      <div {...np.links.album} className={cx('flex-none mt-4 mx-auto mb-8 p-2 w-126 max-w-[84%] bg-pl-art-bg shadow-[0_0_0_1px_var(--color-pl-art-edge),0_2px_4px_rgba(0,0,0,.45)]', np.spotify && 'cursor-pointer')} id="plart">
        {/* the WMP "no album art" plate: film strip + note */}
        {np.art && <img className="block w-full h-auto" id="plimg" alt="Album art" src={np.art} />}
        <NoArt className="block w-full h-auto" id="plph" style={np.art ? { display: 'none' } : undefined} />
      </div>
      <div className="flex-none px-9 pb-7 text-center font-xp *:truncate" id="plmeta" hidden={!np.media}>
        <div className="text-white font-bold" id="pltitle">{np.title}</div>
        <div {...np.links.artist} className={cx('text-pl-ink', np.spotify && LINK)} id="plartist">{np.artist}</div>
        <div {...np.links.album} className={cx('text-pl-album', np.spotify && LINK)} id="plalbum">{np.album}</div>
        {/* Spotify: "Playlist: …" / "Album: …" the track plays from */}
        <div {...np.links.from} className={cx('text-pl-from italic', np.spotify && LINK)} id="plfrom">{np.from}</div>
      </div>
      {/* unsynced lyrics: a block that scrolls with the track position */}
      <div className="flex-none max-h-104 overflow-hidden mx-9 mb-7 text-center text-pl-lyric whitespace-pre-line leading-[1.45]"
           id="pllyr" ref={pllyr} hidden={plain === null}>{plain ?? ''}</div>
      <div className="flex-none h-1 bg-pl-rule shadow-[0_1px_0_var(--color-pl-rule-hi)]"></div>
      {np.spotify ? <SpotifyLibrary /> : <PresetList />}
      <div className="flex-none h-18 flex items-center gap-6 px-6 bg-pl-foot shadow-[inset_0_1px_0_rgba(255,255,255,.1)] max-620:hidden max-620:spotify:flex" id="plfoot">
        {np.spotify && (
          <button type="button" className="ml-auto h-15 py-0 px-6 border border-pl-open-edge rounded-xs bg-pl-open text-pl-ink text-10 leading-[13px] hover:text-white hover:border-pl-open-edge-hot"
                  id="plopen" title="Show what is playing in the Media Library" onClick={np.openPlaying}>
            Open in Media Library
          </button>
        )}
      </div>
    </div>
  );
}

/** The preset list for the visualizers, grouped by engine; the current one lit. */
function PresetList() {
  const box = useRef<HTMLDivElement>(null), rows = usePresetList(box);
  return (
    <div className={LIST} id="visList" ref={box}>
      {rows.map((p) => (
        <Fragment key={p.key}>
          {p.head && <div className={GROUP}>{p.group}</div>}
          <button type="button" className={ITEM} data-on={p.on || undefined} data-vis={p.vis} data-preset={p.preset} onClick={p.select}>{p.name}</button>
        </Fragment>
      ))}
    </div>
  );
}

/** Spotify: the right-hand pane is the library (src/ui usePaneLibrary). */
function SpotifyLibrary() {
  const { groups } = usePaneLibrary(), playing = useApp(playingTrack);
  return (
    <>
      <div className={LIST} id="spLib">
        {groups.map(([label, rows]) => (
          <Fragment key={label}>
            <div className={GROUP}>{label}</div>
            {rows.map((r) => {
              const row = (cls: string) => (
                <button key={r.key} type="button" className={cls} title={r.title} data-on={r.on || undefined}
                        data-sub={r.sub || undefined} onClick={r.onClick} onDoubleClick={r.onDoubleClick}>{r.label}</button>
              );
              // the playing track's row carries its Add to control on the right
              return r.key === 'now' && playing ? (
                <div key={r.key} className="flex items-center gap-2 pr-4 bg-list-on">
                  {row(cx(ITEM, 'flex-auto min-w-0'))}
                  <AddTo uri={playing} owner="addto:pane" id="paddto" classes={{ ...ADDTO, arrow: ADDTO.arrow!.replace('text-xp-heading hover:text-xp-select', 'text-white') }} menuClasses={MENU} />
                </div>
              ) : row(ITEM);
            })}
          </Fragment>
        ))}
      </div>
    </>
  );
}

const RBTN = 'w-15 h-15 flex-none p-0 rounded-full border border-rbtn-edge leading-[0]';
/** the strip's square icon buttons (WMP 9's Now Playing options, fit, full screen, playlist pane);
 *  a toggle that is on (a pane hidden / shown) glows faintly */
const SQBTN = 'flex-none p-0 border-0 bg-transparent leading-[0] cursor-pointer hover:[filter:brightness(1.3)] data-on:[filter:drop-shadow(0_0_1.5px_#9FC3FF)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-white';

function VizCtl() {
  const sh = useShell(), v = useVisControl(), menus = useMenus(), { view } = useView();
  const lyricsAvailable = useApp((s) => s.auth.engine === 'spotify' || s.auth.mode !== 'web');
  const pane = useApp((s) => ({ task: s.settings.taskPane !== false, list: s.settings.playlistPane !== false }));
  const set = (p: { taskPane?: boolean; playlistPane?: boolean }) => sh.store.getState().actions.setSettings(p);
  // "fit": the visualization gets the window (both panes hidden); again brings both back
  const fitted = !pane.task && !pane.list;
  return (
    <div className="flex-none flex items-center gap-6 h-21 px-6 bg-vizctl shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_-1px_0_var(--color-viz-edge)] bare:hidden" id="vizctl">
      <Dropdown owner="npopts" items={() => nowPlayingMenu(sh, lyricsAvailable)} classes={MENU}>
        <button type="button" className={SQBTN} id="vopts" title="Select Now Playing options" aria-label="Select Now Playing options" data-menuzone="">
          <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
            <rect x=".5" y=".5" width="13" height="11" fill="#6E7382" stroke="#C9CDDC"/>
            <rect x="2.5" y="2.5" width="5" height="7" fill="#DDE1EC"/>
            <path d="M9 3.5h3M9 5.5h3M9 7.5h3" stroke="#DDE1EC" fill="none"/>
          </svg>
        </button>
      </Dropdown>
      <button className={cx(s.rbtn, RBTN)} id="vprev" title="Previous visualization" onClick={v.prev}>
        <svg className="mx-auto fill-white" width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><polygon points="5,1 5,6 1.4,3.5"/></svg>
      </button>
      <button className={cx(s.rbtn, RBTN)} id="vnext" title="Next visualization" onClick={v.next}>
        <svg className="mx-auto fill-white" width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><polygon points="2,1 2,6 5.6,3.5"/></svg>
      </button>
      {/* the ▾ beside the visualization name (and the name itself): View > Visualizations */}
      <Dropdown owner="picker" items={() => visMenu(sh)} classes={MENU}>
        <button className={cx(s.rbtn, RBTN)} id="vpick" title="Select visualization" data-menuzone="">
          <svg className="mx-auto fill-white" width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><polygon points="1,2 6,2 3.5,5.6"/></svg>
        </button>
      </Dropdown>
      {/* lyrics on / off (Ctrl+L), lit while on: a visualizer control, so only on Now Playing —
          and only where lyrics exist (the desktop host fetches them; the website never has any) */}
      {view === 'now' && lyricsAvailable && (
        <TransportButton action="lyrics" id="blyrics" className={(on) => cx(on ? s.rbtnlit : s.rbtn, RBTN, 'data-on:border-lit-edge')}>
          <svg className="mx-auto" width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 3h5.5M1 6h5.5M1 9h3.5" stroke="#FFFFFF" strokeWidth="1.4" fill="none"/>
            <path d="M9.6 1.5v6.2" stroke="#FFFFFF" strokeWidth="1.3" fill="none"/>
            <ellipse cx="8.5" cy="8.4" rx="1.8" ry="1.4" fill="#FFFFFF"/>
          </svg>
        </TransportButton>
      )}
      <span className="flex-auto min-w-0 text-viz-label truncate cursor-pointer hover:underline" id="vizlabel" title="Select visualization"
            data-menuzone="" onClick={() => menus.set('picker')}>{v.label}</span>
      <button type="button" className={SQBTN} id="vfit" data-on={fitted || undefined}
              title={fitted ? 'Show the task pane and the playlist pane' : 'Fit the visualization to the window (hide both panes)'}
              aria-label={fitted ? 'Show the task pane and the playlist pane' : 'Fit the visualization to the window'}
              onClick={() => set(fitted ? { taskPane: true, playlistPane: true } : { taskPane: false, playlistPane: false })}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <rect x=".5" y=".5" width="13" height="11" fill="#6E7382" stroke="#C9CDDC"/>
          <path d="M3 6h5M6.5 3.8 8.8 6 6.5 8.2" fill="none" stroke="#DDE1EC"/>
          <rect x="10" y="2.5" width="1.6" height="7" fill="#DDE1EC"/>
        </svg>
      </button>
      <button type="button" className={SQBTN} id="vfull" title="View full screen (F)" aria-label="View full screen" onClick={() => sh.toggleFullscreen()}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <rect x=".5" y=".5" width="13" height="11" fill="#6E7382" stroke="#C9CDDC"/>
          <path d="M4 8.5 L9.5 3 M6.8 3 H9.8 V6" fill="none" stroke="#DDE1EC"/>
        </svg>
      </button>
      <button type="button" className={SQBTN} id="vpane" data-on={pane.list || undefined}
              title={pane.list ? 'Hide the playlist pane' : 'Show the playlist pane'} aria-label={pane.list ? 'Hide the playlist pane' : 'Show the playlist pane'}
              onClick={() => set({ playlistPane: !pane.list })}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <rect x=".5" y=".5" width="13" height="11" fill="#6E7382" stroke="#C9CDDC"/>
          <rect x="3" y="2.5" width="5" height="7" fill="none" stroke="#DDE1EC"/>
          <path d="M9.5 3.2v5.6" stroke="#DDE1EC" fill="none"/>
        </svg>
      </button>
    </div>
  );
}

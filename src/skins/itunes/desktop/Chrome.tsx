// The top of the window (REFERENCE §Window layout, the Windows build): one grey gradient from the top
// edge, its first row the menu bar at the left, "iTunes" centred and the caption buttons at the right
// (the skin draws the window's frame: the Tauri host is frameless, and on Windows takes its own XP
// title bar away while this skin is up, useOwnWindow; the row is the caption, #titlebar); under it
// the toolbar: the transport, the volume, the LCD, the view switcher and the search field.
import { useEffect, useState } from 'react';
import { cx, MenuBar, playingTrack, useAddTo, useApp, useDebounced, useDevices, useShell, useWindowControls, type MenuClasses, type MenuEntry } from '../../../ui';
import { Icon, type IconName } from '../shared/icons';
import { Lcd } from '../shared/Lcd';
import { showPlaying, startGenius } from '../shared/content';
import { useItunesView, VIEW_MODES, VIEW_NAMES, viewActions, type ViewMode } from '../shared/state';
import { TransportCluster, Volume } from '../shared/Transport';
import { menuItems, MENUS } from './menus';

/** Windows 7's menus: the grey face, the icon gutter's rule, a pale blue rounded highlight. */
export const MENU: MenuClasses = {
  content: 'z-60 min-w-190 max-h-[80vh] overflow-auto p-2 bg-itunes-menu bg-[linear-gradient(90deg,transparent_27px,#E2E3E3_27px,#E2E3E3_28px,#FFFFFF_28px,#FFFFFF_29px,transparent_29px)] border border-itunes-menu-edge shadow-[2px_2px_3px_rgba(0,0,0,.3)] font-itunes text-12 leading-[1.3] text-black outline-none',
  item: 'group/mi flex items-center h-22 pr-8 rounded-[3px] border border-transparent text-left whitespace-nowrap cursor-default outline-none data-highlighted:bg-itunes-menu-hot data-highlighted:border-itunes-menu-hot-edge data-disabled:text-itunes-menu-dim',
  check: 'flex-none w-26 text-center text-11',
  label: 'flex-auto flex items-center gap-6 pl-8',
  accel: 'flex-none pl-28 text-12',
  sep: 'h-1 my-3 ml-30 mr-2 bg-[#E0E0E0] border-b border-white',
};

/** the AirPlay menu's icon class per device kind (none: the label says it) */
const noIcon = () => '';

/** The AirPlay menu's entries: the Connect devices, then AirPlay… where the host has the system's own
 *  route picker (the iOS app, on an iPad: the iPod's and the phone's AirPlay…). */
export const withAirPlay = (devices: () => MenuEntry[]) => (): MenuEntry[] =>
  [...devices(), ...(window.alchemyRoutePicker ? [{ sep: true } as const, { label: 'AirPlay…', act: () => window.alchemyRoutePicker?.() }] : [])];

/** The playing song's song radio (Advanced > Start Genius, the bottom bar's ⚛), or null. */
export const useGenius = () => {
  const sh = useShell(), has = useApp((s) => !!playingTrack(s));
  return has ? () => startGenius(sh) : null;
};

/** the chrome's top row (theme.css --background-image-itunes-chrome's first stop) */
const TOP = '#F3F3F4';

/** A host draws the window's title bar over this skin: only one that cannot be asked to step aside
 *  (a Windows exe from before alchemyNativeChrome, given this page by a page update); the skin then
 *  leaves out its title and caption buttons rather than draw a second set under the host's. */
export const useNativeTitle = () => useApp((s) => s.auth.nativeTitle === true) && !window.alchemyNativeChrome;

/** The Windows host's XP title bar and frame away while this window is up, so the window is this
 *  skin's own (tauri/src/titlebar.rs), and back as it goes, for the skin that comes next. */
export function useOwnWindow() {
  const sh = useShell();
  useEffect(() => {
    const native = window.alchemyNativeChrome;
    if (!native) return;
    native(false, TOP);
    return () => {
      native(true);
      sh.store.getState().actions.setAuth({ nativeTitle: true });
    };
  }, [sh]);
}

export function CaptionRow({ narrow, views }: { narrow: boolean; views: boolean }) {
  const sh = useShell(), w = useWindowControls(), addTo = useAddTo(useApp(playingTrack)), devices = useDevices(noIcon), genius = useGenius();
  const native = useNativeTitle();
  const ctx = { addTo, views, narrow, devices: withAirPlay(devices.items), genius };
  const cap = 'flex-none grid place-items-center w-28 h-20 p-0 border border-transparent rounded-xs bg-transparent text-[#3A3A3A] hover:bg-white/45 hover:border-[#8E8F91]';
  return (
    <div id="titlebar" className="relative flex-none flex items-center h-22 pl-2 pr-3 bare:hidden" onMouseDown={w.onCaptionMouseDown}>
      <MenuBar menus={MENUS.map(([name, label]) => [name, label, () => menuItems(name, sh, ctx)] as const)} classes={MENU}
               id="menubar" className="relative z-6 flex items-center"
               listId="mtops" listClassName="flex"
               triggerClassName="h-20 px-7 border border-transparent rounded-xs bg-transparent text-12 text-black hover:bg-white/50 hover:border-[#A8A9AB] data-[state=open]:bg-[#D5DCE6] data-[state=open]:border-[#8E99AA]" />
      {/* the title, centred on the window, under the menus where they meet */}
      {!native && <div className="absolute inset-x-0 top-0 h-22 grid place-items-center pointer-events-none text-12 text-[#3C3C3C] max-[700px]:hidden">iTunes</div>}
      {!native && (
        <div className="relative ml-auto flex items-center gap-1">
          <button className={cap} id="wmin" title="Minimize" tabIndex={-1} onClick={w.minimize}><Icon name="min" size={12} /></button>
          <button className={cap} id="wmax" title="Maximize" tabIndex={-1} onClick={w.maximize}><Icon name="max" size={12} /></button>
          <button className={cx(cap, 'hover:bg-itunes-close-hot hover:border-[#8F2A22] hover:text-white')} id="wclose" title="Close" tabIndex={-1} onClick={w.close}><Icon name="close" size={12} /></button>
        </div>
      )}
    </div>
  );
}

const VIEW_ICON: Record<ViewMode, IconName> = { list: 'view-list', album: 'view-album', grid: 'view-grid', flow: 'view-flow' };

/** List / Album List / Grid / Cover Flow, one always pressed (dark); greyed for a source with one view. */
function ViewSwitch({ mode, enabled }: { mode: ViewMode; enabled: boolean }) {
  return (
    <div className="flex-none flex h-22 rounded-sm border border-itunes-rim overflow-hidden shadow-[0_1px_0_rgba(255,255,255,.55)] max-[760px]:hidden" role="radiogroup" aria-label="View">
      {VIEW_MODES.map((m, i) => {
        const on = enabled && m === mode;
        return (
          <button key={m} type="button" id={'v' + m} role="radio" aria-checked={on} title={'View as ' + VIEW_NAMES[m]} disabled={!enabled}
                  className={cx('grid place-items-center w-26 h-full p-0 border-0 disabled:opacity-55', i > 0 && 'border-l border-itunes-rim',
                                on ? 'bg-itunes-seg-on text-white' : 'bg-itunes-seg text-[#2E2F31] active:bg-itunes-btn-down')}
                  onClick={() => viewActions.setMode(m)}><Icon name={VIEW_ICON[m]} size={14} /></button>
        );
      })}
    </div>
  );
}

/** The search field: typing searches Spotify (400 ms after the last key, Enter at once), the results
 *  showing as STORE > Search Results; ⓧ or Esc clears. Marked data-search-box for Ctrl+F. */
function Search() {
  const sh = useShell(), q = useApp((s) => s.ui.searchQ), [text, setText] = useState(q);
  const run = useDebounced((v) => { sh.store.getState().commands.search(v); if (v.trim()) viewActions.select('search'); });
  // another way in (a cleared search, a link) shows here
  useEffect(() => { setText(q); }, [q]); // eslint-disable-line react-hooks/set-state-in-effect -- the field follows the store's query
  const clear = () => { setText(''); run.now(''); };
  return (
    <div className="relative flex-none w-152 h-22 max-[860px]:w-120 max-[700px]:w-96">
      <Icon name="search" size={13} className="absolute left-7 top-1/2 -translate-y-1/2 text-[#4F4F4F] pointer-events-none" />
      {/* the magnifier's ▾ (iTunes' search-scope menu; here the one scope: all of Spotify) */}
      <span className="absolute left-19 top-1/2 -translate-y-[35%] text-[7px] leading-none text-[#4F4F4F] pointer-events-none" aria-hidden="true">▼</span>
      <input data-search-box="" type="text" aria-label="Search Spotify" placeholder="Search" value={text} spellCheck={false}
             className="w-full h-full pl-29 pr-22 rounded-full border border-itunes-rim border-t-[#9C9D9F] bg-itunes-search text-12 text-black outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,.2),0_1px_0_rgba(255,255,255,.55)] placeholder:text-itunes-hint focus:shadow-[inset_0_1px_2px_rgba(0,0,0,.2),0_0_0_2px_rgba(82,149,227,.55)]"
             onChange={(e) => { setText(e.currentTarget.value); run(e.currentTarget.value); }}
             onKeyDown={(e) => { if (e.key === 'Enter') run.now(text); else if (e.key === 'Escape' && text) { e.stopPropagation(); clear(); } }} />
      {text && (
        <button type="button" aria-label="Clear the search" title="Clear" onClick={clear}
                className="absolute right-5 top-1/2 -translate-y-1/2 grid place-items-center w-13 h-13 p-0 rounded-full border-0 bg-[#9A9A9A] text-white hover:bg-[#7A7A7A]"><Icon name="close" size={9} /></button>
      )}
    </div>
  );
}

export function Toolbar({ views }: { views: boolean }) {
  const sh = useShell(), mode = useItunesView((s) => s.views[s.source] ?? 'list'), spotify = useApp((s) => s.auth.engine === 'spotify');
  return (
    <div id="toolbar" className="flex-none flex items-center gap-12 h-54 px-10 pb-2 border-b border-itunes-edge bare:hidden max-[700px]:gap-8">
      <TransportCluster />
      <Volume className="w-130 max-[860px]:w-96 max-[700px]:w-70 [&>svg:last-child]:max-[700px]:hidden" />
      <Lcd className="flex-auto max-w-[560px] mx-auto" onGoto={() => showPlaying(sh)} />
      <ViewSwitch mode={mode} enabled={views} />
      {/* only Spotify has a catalogue to search (the local engine's window is the visualizer) */}
      {spotify ? <Search /> : <div className="flex-none w-152 max-[860px]:w-120 max-[700px]:w-96" />}
    </div>
  );
}

// The iTunes 10 skin on a phone in portrait (docs/itunes-skin-phone.md). There was no iTunes for the
// iPhone, so this is iTunes' window folded to a phone's width the way the iPhone's own Music app of 2010
// laid out its pages: the grey toolbar always on top, one row (the transport and the LCD, a tap on which
// is Now Playing; the time and battery above it where the Windows build had its menus and caption
// buttons), one page under it at a time (the source list with its search field, a source, Now Playing,
// Preferences: nav.ts), and the bottom bar always at the foot (Preferences, shuffle, repeat, AirPlay).
// Nothing is shown twice on a screen this small: the view switch is a list's own, the status line a
// list's last row. Turned on its side, the phone shows Cover Flow alone, as that Music app did. The
// layout is drawn at the iPhone 4's 320 points and scaled to the phone (host.ts fit).
import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { Visualizer } from '../../../app/Visualizer';
import { cx, deviceName, isAlbum, isSpotify, TransportButton, useApp, useDevices, useLibraryList, usePlayback, useShell } from '../../../ui';
import { albumsOf, Icon, itunesView, Lcd, playRow, playUri, TransportCluster } from '../shared';
import { haptic, useFit, useHostChrome, useHostGlobal } from './host';
import { nav, phoneNav, topPage, type Page } from './nav';
import { NowPlayingPage } from './NowPlaying';
import { FlowStage, Note, SourcePage, SourcesPage, useSelection, type Selection } from './Pages';
import { PrefsPage } from './Prefs';
import { DeviceSheet, openSheet, SheetHost } from './Sheet';

/** iOS 4's system face (the iPhone's Helvetica) after iTunes' own, which a phone does not have */
const FONT = 'font-["Segoe_UI","Lucida_Grande","Helvetica_Neue",Helvetica,Arial,sans-serif]';
/** what a tap on it is felt on */
const TAPPABLE = 'button:not(:disabled), [role=button], [role=treeitem], [role=tab], [data-i]';

export function PhoneRoot() {
  const f = useFit(), spotify = useApp(isSpotify), sel = useSelection();
  useHostChrome();
  const host = !!window.alchemyLayout;
  const safe = useHostGlobal('__wmpSafeArea', 'wmp-safe-area'), kbd = (useHostGlobal('__wmpKeyboard', 'wmp-keyboard') ?? 0) * f.pt;
  const ins = { top: (safe?.top ?? 0) * f.pt, right: (safe?.right ?? 0) * f.pt, bottom: (safe?.bottom ?? 0) * f.pt, left: (safe?.left ?? 0) * f.pt };
  // "show the current song" (Ctrl+L, Now Playing's Go to Current Song) opens the source's page
  useEffect(() => itunesView.subscribe((s, p) => { if (s.reveal !== p.reveal) nav.source(); }), []);
  const feel = (e: MouseEvent) => { if ((e.target as Element).closest(TAPPABLE)) haptic(); };
  return (
    <div data-ui-root="" className="absolute inset-0 overflow-hidden bg-black select-none touch-manipulation [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] [-webkit-text-size-adjust:100%]"
         onClickCapture={feel}>
      <div id="chrome" data-spotify={spotify || undefined} data-phone=""
           className={cx('absolute left-0 top-0 origin-top-left flex flex-col overflow-hidden bg-white text-12 leading-[1.3] text-black', FONT)}
           style={{ width: f.w, height: f.h, transform: f.s === 1 ? undefined : `scale(${f.s})`, '--sb': (kbd ? 0 : ins.bottom) + 'px' } as CSSProperties}>
        {f.landscape ? <Landscape sel={sel} left={ins.left} right={ins.right} /> : <>
          {/* the time and battery where the hidden status bar was: the iOS app only (a browser keeps its own) */}
          <Toolbar band={host ? Math.max(ins.top, 20 * f.pt) : 0} />
          <main className="relative flex-auto min-h-0 flex flex-col bg-white" id="page">
            {spotify ? <Pages sel={sel} /> : <Visualizer className="block w-full h-full bg-black" id="view" />}
          </main>
          {kbd ? <div className="flex-none" style={{ height: kbd }} /> : <BottomBar pad={ins.bottom} />}
        </>}
        <SheetHost />
      </div>
    </div>
  );
}

/** The page on top, with where its ‹ goes back to. */
function Pages({ sel }: { sel: Selection }) {
  const pages = phoneNav((s) => s.pages), page = topPage(pages), under = pages[pages.length - 2];
  const title = (p: Page | undefined) => (p === 'source' ? sel.content.title || sel.source?.label || 'Music' : p === 'now' ? 'Now Playing' : p === 'prefs' ? 'Preferences' : 'iTunes');
  if (page === 'now') return <NowPlayingPage back={nav.back} backLabel={title(under)} />;
  if (page === 'prefs') return <PrefsPage back={nav.back} backLabel={title(under)} />;
  if (page === 'source') return <SourcePage sel={sel} back={nav.back} backLabel={sel.depth ? sel.source?.label ?? 'Music' : 'iTunes'} />;
  return <SourcesPage sel={sel} />;
}

// ---- the toolbar ------------------------------------------------------------------------------------

/** the transport's buttons at their desktop size (31 / 37 px: 38 / 45 points here), each a fingertip */
const HIT = '[&>button]:relative [&>button]:after:absolute [&>button]:after:-inset-4 [&>button]:after:content-[""]';
/** the LCD's seek groove taken by a finger above and below it too */
const LCD = 'h-48 [&_#seektrack]:h-28! [&_#seektrack]:-my-[8.5px]';

function Toolbar({ band }: { band: number }) {
  return (
    <div id="toolbar" className="flex-none bg-itunes-chrome border-b border-itunes-edge">
      {band > 0 && <Band h={band} />}
      <div className="flex items-center gap-8 h-54 px-8 pb-2" id="titlebar">
        <TransportCluster className={HIT} />
        {/* a tap anywhere on the LCD but its seek groove shows Now Playing (a fingertip covers its lines,
            so the artist line's turn and the time's flip, a click's on a desktop, are not taken here) */}
        <div className="flex-auto min-w-0" onClickCapture={(e) => { if (!(e.target as Element).closest('#seektrack')) { e.stopPropagation(); nav.toggleNow(); } }}>
          <Lcd compact className={LCD} />
        </div>
      </div>
    </div>
  );
}

/** the time now, as the phone writes it (its own 12 / 24 hours), re-read on the minute (the iPod's) */
function useTime(): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 60_000 - (now % 60_000));
    return () => clearTimeout(t);
  }, [now]);
  return new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The toolbar's top, over the notch: the time at the left, the battery at the right (the phone's
 *  report; full without one), in the chrome's dark grey. */
function Band({ h }: { h: number }) {
  const time = useTime(), bat = useHostGlobal('__wmpBattery', 'wmp-battery'), level = bat && bat.level >= 0 ? bat.level / 100 : 1;
  return (
    <div className="flex items-center justify-between px-22 text-12 font-bold text-[#2E2F31] [text-shadow:0_1px_0_rgba(255,255,255,.6)]" style={{ height: h }}>
      <span>{time}</span>
      <svg width="25" height="12" viewBox="0 0 25 12" role="img" aria-label={bat && bat.level >= 0 ? 'Battery ' + bat.level + '%' + (bat.charging ? ', charging' : '') : 'Battery'}>
        <rect x=".5" y=".5" width="21" height="11" rx="2.5" fill="none" stroke="currentColor" />
        <rect x="22.4" y="4" width="2" height="4" rx="1" fill="currentColor" />
        <rect x="2" y="2" width={Math.max(1, 18 * Math.min(1, level))} height="8" rx="1.2" fill="currentColor" />
        {bat?.charging && <path d="M12.4 1.2 8 6.6h2.8L9.6 10.8 14 5.2h-2.8Z" fill="#FFFFFF" stroke="#2E2F31" strokeWidth=".6" />}
      </svg>
    </div>
  );
}

// ---- the bottom bar ---------------------------------------------------------------------------------

const BAR_BTN = 'relative flex-none flex items-center justify-center w-40 h-36 p-0 border-0 bg-transparent text-itunes-bar-glyph [filter:drop-shadow(0_1px_0_rgba(255,255,255,.55))] active:bg-black/10 disabled:opacity-40 data-on:text-itunes-lit';

/** iTunes' bottom bar on a phone, what a list does not hold itself: Preferences in the place of + (a new
 *  playlist, which Spotify playlists do not get here), shuffle, repeat (a small 1 for one song), and at
 *  the right AirPlay (Play On: the Connect devices, lit and naming the one that plays when it is not
 *  this phone, as iTunes named its speakers). */
function BottomBar({ pad }: { pad: number }) {
  const repeat = usePlayback().repeat, elsewhere = useDevices(() => '').elsewhere, page = topPage(phoneNav((s) => s.pages));
  const away = useApp((s) => { const d = s.devices.list.find((x) => x.active && x.id !== s.devices.self); return d ? deviceName(d) : ''; });
  return (
    <div id="bottombar" className="flex-none border-t border-itunes-bar-edge bg-itunes-bar" style={{ paddingBottom: pad }}>
      <div className="flex items-center h-36 px-4">
        <button type="button" className={BAR_BTN} id="bprefs" aria-label="Preferences" data-on={page === 'prefs' || undefined}
                onClick={() => (page === 'prefs' ? nav.back() : nav.push('prefs'))}><Icon name="smart" /></button>
        <TransportButton action="shuffle" id="bshuffle" className={BAR_BTN}><Icon name="shuffle" /></TransportButton>
        <TransportButton action="repeat" id="brepeat" className={BAR_BTN}>
          <Icon name="repeat" />
          {repeat === 'track' && <span className="absolute right-7 top-7 text-[8px] leading-none font-bold">1</span>}
        </TransportButton>
        <button type="button" id="bdevice" aria-label={away ? 'Play On: ' + away : 'Play On'} data-on={elsewhere || undefined} onClick={() => openSheet(<DeviceSheet />)}
                className={cx(BAR_BTN, 'ml-auto w-auto min-w-36 max-w-[55%] px-8 gap-6')}>
          <Icon name="airplay" className="flex-none" />
          {away && <span className="min-w-0 truncate text-11 text-[#2B2B2B] [text-shadow:0_1px_0_rgba(255,255,255,.5)]">{away}</span>}
        </button>
      </div>
    </div>
  );
}

// ---- on its side --------------------------------------------------------------------------------------

/** The phone on its side: Cover Flow alone on the black, the selected list's albums (the saved albums
 *  for anything else), starting at the playing one; a tap on the front cover plays it. */
function Landscape({ sel, left, right }: { sel: Selection; left: number; right: number }) {
  const sh = useShell(), now = useApp((s) => s.playback.track?.uri ?? null), lib = useLibraryList(), c = sel.content;
  const songs = c.kind === 'tracks' && !c.queue && c.tracks.length ? c : null;
  const groups = songs ? albumsOf(songs.tracks) : [];
  const albums = songs ? [] : lib.items.filter((x) => isAlbum(x.uri));
  const covers = songs ? groups.map((g) => ({ key: g.key, img: g.img, name: g.name, sub: g.artist }))
    : albums.map((a) => ({ key: a.uri, img: a.image ?? null, name: a.name, sub: a.artist ?? a.owner ?? '' }));
  const start = Math.max(0, songs ? groups.findIndex((g) => g.tracks.some((t) => t.uri === now)) : albums.findIndex((a) => a.uri === sh.store.getState().playback.context?.uri));
  const play = (i: number) => {
    const t = groups[i]?.tracks[0], a = albums[i];
    if (songs && t) playRow(sh, songs, t);
    else if (a) playUri(sh, a.uri);
  };
  return (
    <div className="flex-auto min-h-0 flex flex-col bg-black" style={{ paddingLeft: left, paddingRight: right }} id="landscape">
      {covers.length ? <FlowStage key={(songs ? c.title : 'albums') + covers.length} className="flex-auto" covers={covers} start={start} onActivate={play} />
        : <Note dark text={lib.loading ? 'Loading…' : 'No albums to show.'} />}
    </div>
  );
}

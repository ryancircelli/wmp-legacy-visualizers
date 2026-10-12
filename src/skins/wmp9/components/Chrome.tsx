// The XP window around the player: title bar, menu bar, the top band with the view pill, and
// the task pane down the left. Markup and classes only; behaviour is src/ui's.
import { cx, Dropdown, MenuBar, playingTrack, TaskList, useAddTo, useApp, useShell, useView, useWindowControls, type AddToClasses, type MenuClasses } from '../../../ui';
import { menuItems, MENUS } from '../../menus';
import s from '../wmp9.module.css';
import emblemSpotify from '../assets/emblem-spotify.svg';
import emblemWmp from '../assets/emblem-wmp.svg';
// the title bar's artwork, shared with the Tauri host's own title bar (tauri/src/titlebar.rs)
import captionIcon from '../assets/caption-icon.svg';
import captionMin from '../assets/caption-min.svg?raw';
import captionMax from '../assets/caption-max.svg?raw';
import captionClose from '../assets/caption-close.svg?raw';

/** XP's popup menus (the menu bar's, the view pill's and the visualization picker's). */
export const MENU: MenuClasses = {
  content: 'z-60 min-w-168 max-h-[72vh] overflow-auto p-2 bg-xp-face text-black border border-xp-edge-dark shadow-menu font-xp text-11 leading-[1.4] outline-none',
  item: 'group/mi flex items-center gap-8 w-full pt-3 pr-6 pb-3 pl-4 text-black text-left whitespace-nowrap cursor-pointer outline-none data-highlighted:bg-xp-select data-highlighted:text-white data-disabled:text-xp-disabled data-disabled:cursor-default',
  check: 'flex-none w-13 text-center text-10',
  label: 'flex-auto',
  accel: 'flex-none pl-14 text-xp-accel text-10 group-data-highlighted/mi:text-xp-select-ink',
  sep: 'h-1 my-3 mx-2 bg-xp-edge border-b border-white',
};

/** the Add to control: a small silver disc (+), lit blue once saved (✓), and its ▾ */
export const ADDTO: AddToClasses = {
  root: 'inline-flex flex-none items-center gap-1',
  /** the heart: dark outline, filled white on the lit (blue) disc once liked */
  button: (on) => cx(s.sbtn, on && s.lit, 'w-15 h-15 flex-none p-0 rounded-full border border-disc-edge leading-[0] text-disc-glyph data-on:text-white hover:[filter:brightness(1.06)]'),
  arrow: 'w-11 h-15 flex-none p-0 bg-transparent bg-none border-0 font-xp text-10 leading-[15px] text-xp-heading hover:text-xp-select',
};

/** The playing track's Add to, for the Play menu (the menu bar's and the view pill's). */
const usePlayingAddTo = () => useAddTo(useApp(playingTrack));

/** A caption button's glyph, its SVG file inline: as an <img> it would land a fraction of a pixel
 *  elsewhere at 125 / 150 / 175 %. */
const Glyph = ({ svg }: { svg: string }) => <span className="block mx-auto w-11 h-11" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;

const WBTN = 'w-21 h-21 flex-none p-0 rounded-sm border leading-[0] shadow-[inset_1px_1px_0_rgba(255,255,255,.55),inset_-1px_-1px_0_rgba(0,0,0,.22)]';

export function TitleBar() {
  const w = useWindowControls();
  return (
    <div className={cx(s.corners, s.titlebar, 'flex-none h-30 flex items-center gap-6 pt-0 pr-3 pb-2 pl-7 rounded-t-win text-white font-xp font-bold text-13 leading-[1] [text-shadow:1px_1px_1px_rgba(0,0,0,.45)] bare:hidden nativetitle:hidden', w.host && 'cursor-default')}
         id="titlebar" onMouseDown={w.onCaptionMouseDown}>
      {/* the app's own orb at title-bar size; the desktop host's own title bar draws the same file */}
      <img className="flex-none" id="wmpicon" width="16" height="16" src={captionIcon} alt="" aria-hidden="true" draggable={false} />
      <span className="flex-auto min-w-0 truncate">Windows Media Player</span>
      <button className={cx(s.wbtn, WBTN, 'border-caption-edge')} id="wmin" title="Minimize" tabIndex={-1} onClick={w.minimize}>
        <Glyph svg={captionMin} />
      </button>
      <button className={cx(s.wbtn, WBTN, 'border-caption-edge')} id="wmax" title="Maximize (full screen)" onClick={w.maximize}>
        <Glyph svg={captionMax} />
      </button>
      <button className={cx(s.wbtn, s.x, WBTN, 'border-close-edge')} id="wclose" title="Close" onClick={w.close}>
        <Glyph svg={captionClose} />
      </button>
    </div>
  );
}

export function WmpMenuBar() {
  const sh = useShell(), addTo = usePlayingAddTo();
  return (
    <MenuBar menus={MENUS.map(([name, label]) => [name, label, () => menuItems(name, sh, addTo)] as const)} classes={MENU}
             id="menubar" className="group/menubar flex-none relative z-6 flex items-center h-19 py-0 px-2 bg-xp-face border-b border-white text-black bare:hidden"
             burger={{ id: 'burger', className: 'hidden bg-transparent bg-none border-0 py-0 px-7 text-black text-13 hover:bg-xp-select hover:text-white data-[state=open]:bg-xp-select data-[state=open]:text-white max-440:block' }}
             listId="mtops"
             listClassName="flex max-440:hidden max-440:group-data-open/menubar:block max-440:group-data-open/menubar:absolute max-440:group-data-open/menubar:left-2 max-440:group-data-open/menubar:top-full max-440:group-data-open/menubar:z-55 max-440:group-data-open/menubar:w-132 max-440:group-data-open/menubar:p-2 max-440:group-data-open/menubar:bg-xp-face max-440:group-data-open/menubar:border max-440:group-data-open/menubar:border-xp-edge-dark max-440:group-data-open/menubar:shadow-menu"
             triggerClassName="bg-transparent bg-none border-0 pt-1 px-7 pb-2 text-black hover:bg-xp-select hover:text-white data-[state=open]:bg-xp-select data-[state=open]:text-white max-440:group-data-open/menubar:block max-440:group-data-open/menubar:w-full max-440:group-data-open/menubar:text-left" />
  );
}

export function TopBar() {
  const sh = useShell(), { label } = useView(), addTo = usePlayingAddTo();
  return (
    <div className={cx(s.topbar, 'flex-none relative h-35 border-t border-luna-sep bare:hidden')} id="topbar">
      {/* The band's bottom rows (its 16..34 px: the blue, the dark line, the light strip) and, over the
          task pane, the swoosh's part of them (the dark fill down to the curve, the wash, the panel
          fading into the strip, the curve's stroke), all in ONE svg. The task pane's own svg draws only
          below the band (#tpsw). Two pieces meeting side by side on a column round a half device pixel
          differently at 125 % / 150 % (a 1 px step, a seam, a darker line down the join); the only
          boundary left is the band's bottom (84 px), a whole device row at 125/150/175/200 %.
          Coordinates are the swoosh's (y 0 = 15 px into the band's background). Under the sweep and
          the knob. */}
      <svg className="absolute left-0 top-15 z-1 pointer-events-none" id="tbedge" width="100%" height="19" aria-hidden="true">
        <defs>
          <linearGradient id="gbdark" gradientUnits="userSpaceOnUse" x1="0" y1="1" x2="0" y2="14">
            <stop offset="0" stopColor="#9AB7F0"/><stop offset={2 / 13} stopColor="#A4C3FF"/>
            <stop offset={4 / 13} stopColor="#92AEE8"/>
            <stop offset={10 / 13} stopColor="#6A7EBF"/><stop offset="1" stopColor="#5666AB"/>
          </linearGradient>
          <linearGradient id="gbstrip" gradientUnits="userSpaceOnUse" x1="0" y1="15" x2="0" y2="19">
            <stop offset="0" stopColor="#DFE9F5"/><stop offset="1" stopColor="#BFD2EA"/>
          </linearGradient>
          <linearGradient id="gbpanel" gradientUnits="userSpaceOnUse" x1="5" y1="0" x2="92" y2="0">
            <stop offset="0" stopColor="#FFFFFF"/><stop offset=".18" stopColor="#FAFCFE"/>
            <stop offset=".52" stopColor="#E2E9F7"/><stop offset=".82" stopColor="#C8D2EC"/>
            <stop offset="1" stopColor="#BFD2EA"/>
          </linearGradient>
          <linearGradient id="gbblue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8CA2DE"/><stop offset="1" stopColor="#7285C6"/>
          </linearGradient>
          <linearGradient id="gbwash" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#C6DBFF" stopOpacity=".75"/>
            <stop offset=".7" stopColor="#C6DBFF" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="gbfade" gradientUnits="userSpaceOnUse" x1="72" y1="0" x2="86" y2="0">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0"/><stop offset="1" stopColor="#FFFFFF"/>
          </linearGradient>
          <linearGradient id="gbfadeout" gradientUnits="userSpaceOnUse" x1="72" y1="0" x2="86" y2="0">
            <stop offset="0" stopColor="#FFFFFF"/><stop offset="1" stopColor="#FFFFFF" stopOpacity="0"/>
          </linearGradient>
          <mask id="mbfade" maskUnits="userSpaceOnUse" x="0" y="0" width="4000" height="32"><rect width="4000" height="32" fill="url(#gbfade)"/></mask>
          <mask id="mbfadeout" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="32"><rect width="100" height="32" fill="url(#gbfadeout)"/></mask>
          <clipPath id="cbpanel"><path d="M5 28 H62 C76 28 76 14.5 90 14.5 H4000 V32 H5 Z"/></clipPath>
        </defs>
        <rect x="0" y="1" width="100%" height="18" fill="url(#gbdark)"/>
        <rect x="0" y="14.5" width="100%" height="4.5" fill="url(#gbstrip)"/>
        <rect x="0" y="14" width="100%" height="1" fill="#2B448B"/>
        {/* the swoosh's part: the task pane's svg's shapes, in its order, except that the dark fill,
            the panel, the strip fading in over it and the dark line each run on across the whole band
            as ONE shape (there they are the band's own rows) instead of ending at the task pane's
            edge. Continuing them with a second shape would overlap two antialiased edges, and two
            partial coverages of one colour add up darker. */}
        <g className="notask:hidden max-520:hidden">
          <rect x="0" y="1" width="4000" height="31" fill="url(#gbdark)"/>
          <rect x="0" y="9" width="92" height="23" fill="url(#gbwash)"/>
          <rect x="0" y="14" width="5" height="18" fill="url(#gbblue)"/>
          <path d="M5 28 H62 C76 28 76 14.5 90 14.5 H4000 V32 H5 Z" fill="url(#gbpanel)"/>
          <rect x="62" y="14" width="4000" height="5" fill="url(#gbstrip)" clipPath="url(#cbpanel)" mask="url(#mbfade)"/>
          <path d="M5 28 H62 C76 28 76 14.5 90 14.5 H4000" fill="none" stroke="#2B448B" strokeWidth="1"/>
          <path d="M5 29.5 H60 C74.5 29.5 75 16 89.5 16 H92" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity=".55" mask="url(#mbfadeout)"/>
        </g>
      </svg>
      {/* the light band sweeping in from the top right; its left edge is a cubic */}
      <div className={cx(s.npband, 'absolute right-0 top-0 bottom-0 w-214 max-w-[54%] pt-6 pr-5 pb-0 pl-0 z-2 max-520:max-w-[66%] max-440:w-auto max-440:left-32 max-440:max-w-none')} id="npband">
        <svg className="absolute -left-54 top-0" id="npsweep" width="54" height="35" viewBox="0 0 54 35" aria-hidden="true">
          <defs>
            <linearGradient id="gnp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FDFEFF"/><stop offset=".34" stopColor="#EAF0F9"/>
              <stop offset=".62" stopColor="#D2DAF0"/><stop offset=".86" stopColor="#C2D2EA"/>
              <stop offset="1" stopColor="#BFD2EA"/>
            </linearGradient>
          </defs>
          <path d="M54 0 H43 C37 4 33 12 24 21 C18 27 10 30 0 30 L0 34 H54 Z" fill="url(#gnp)"/>
          <path d="M43 0 C37 4 33 12 24 21 C18 27 10 30 0 30" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity=".55"/>
        </svg>
        {/* The pill names the current view, as WMP 9's does, and opens the Play menu. */}
        <Dropdown owner="pill" items={() => menuItems('play', sh, addTo)} classes={MENU}>
          <button className={cx(s.npill, 'relative w-full h-21 flex items-center gap-6 py-0 pr-8 pl-4 border border-pill-edge rounded-md text-pill-ink text-11 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_1px_0_rgba(255,255,255,.7)] hover:border-pill-edge-hot data-[state=open]:border-pill-edge-hot')}
                  id="npill" title="Play" data-menu="play" data-menuzone="">
            <svg className="flex-none" width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <rect x="1.5" y=".5" width="12" height="14" rx="1" fill="#F7FAFE" stroke="#44567F"/>
              <rect x="3.5" y="3.5" width="8" height="8" fill="#2E63C8"/>
              <polygon points="6,5.5 9.6,7.5 6,9.5" fill="#FFFFFF"/>
            </svg>
            <span className="flex-auto truncate">{label}</span>
            <svg className="flex-none" width="13" height="9" viewBox="0 0 13 9" aria-hidden="true">
              <path d="M1.6 2 L6.5 7 L11.4 2" fill="none" stroke="#1B3E86" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </Dropdown>
      </div>

      <label className={cx(s.knob, 'absolute left-1 top-16 w-15 h-15 rounded-full cursor-pointer grid place-items-center z-5')}
             htmlFor="tpcollapse" id="tpbtn" title="Show or hide the task pane">
        <svg className="fill-knob-ink" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
          <polygon points="4.5,1 6.9,3.6 2.1,3.6"/><polygon points="4.5,8 6.9,5.4 2.1,5.4"/>
        </svg>
      </label>
    </div>
  );
}

const TASK = "relative flex items-center w-full min-h-40 text-left pt-4 pr-15 pb-5 pl-9 bg-transparent bg-none border-0 border-b border-task-rule text-pill-ink font-xp font-bold text-11 leading-[1.25] hover:bg-task-hover hover:text-task-hot disabled:cursor-default disabled:text-slate data-on:bg-task-on data-on:after:absolute data-on:after:right-6 data-on:after:top-1/2 data-on:after:-mt-4 data-on:after:border-4 data-on:after:border-transparent data-on:after:border-l-5 data-on:after:border-l-task-arrow data-on:after:border-r-0 data-on:after:content-['']";

export function TaskPane() {
  const { spotify } = useView(), sh = useShell();
  return (
    <div className="col-start-1 row-start-1 row-span-3 relative z-4 flex flex-col pt-12 bg-taskpane bare:hidden notask:hidden max-520:hidden" id="taskpane">
      {/* the concave swoosh, below the band: the light panel curving up on the right (its part inside
          the band, and the band's own rows over the task pane, are #tbedge's in the top band). Same
          coordinates as #tbedge (y 19 = the band's bottom, where this svg starts) */}
      <svg className="absolute left-0 top-0 z-2 pointer-events-none" id="tpsw" width="92" height="13" viewBox="0 19 92 13" aria-hidden="true">
        <defs>
          <linearGradient id="gtask" gradientUnits="userSpaceOnUse" x1="5" y1="0" x2="92" y2="0">
            <stop offset="0" stopColor="#FFFFFF"/><stop offset=".18" stopColor="#FAFCFE"/>
            <stop offset=".52" stopColor="#E2E9F7"/><stop offset=".82" stopColor="#C8D2EC"/>
            <stop offset="1" stopColor="#BFD2EA"/>
          </linearGradient>
          <linearGradient id="gtblue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8CA2DE"/><stop offset="1" stopColor="#7285C6"/>
          </linearGradient>
          <linearGradient id="gtfadeout" gradientUnits="userSpaceOnUse" x1="72" y1="0" x2="86" y2="0">
            <stop offset="0" stopColor="#FFFFFF"/><stop offset="1" stopColor="#FFFFFF" stopOpacity="0"/>
          </linearGradient>
          <mask id="mtfadeout" maskUnits="userSpaceOnUse" x="0" y="0" width="92" height="32"><rect width="92" height="32" fill="url(#gtfadeout)"/></mask>
          <linearGradient id="gtwash" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#C6DBFF" stopOpacity=".75"/>
            <stop offset=".7" stopColor="#C6DBFF" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {/* the band's colour (its last stop) carries on down over the task pane to the curve; it stops
            under the panel, so at the right edge only the panel meets the screen */}
        <rect x="0" y="19" width="80" height="13" fill="#5666AB"/>
        <rect x="0" y="9" width="92" height="23" fill="url(#gtwash)"/>
        {/* the blue chrome strip down the left, running up behind the panel */}
        <rect x="0" y="14" width="5" height="18" fill="url(#gtblue)"/>
        <path d="M5 28 H62 C76 28 76 14.5 90 14.5 H92 V32 H5 Z" fill="url(#gtask)"/>
        <path d="M5 28 H62 C76 28 76 14.5 90 14.5 H92" fill="none" stroke="#2B448B" strokeWidth="1"/>
        <path d="M5 29.5 H60 C74.5 29.5 75 16 89.5 16 H92" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity=".55" mask="url(#mtfadeout)"/>
      </svg>

      <TaskList id="tasklist" className={cx(s.tasklist, 'flex-none relative z-2 ml-4 border-l border-task-edge pb-3')} itemClassName={TASK}
        tasks={spotify ? [
          { view: 'now', id: 'tnow', label: 'Now Playing' },
          { view: 'guide', id: 'tguide', label: 'Media Guide' },
          { view: 'library', id: 'tlib', label: 'Media Library' },
          { view: 'search', id: 'tsearch', label: 'Search' },
          { view: 'radio', id: 'tradio', label: 'Radio Tuner' },
        ] : [
          // without Spotify the other tasks are WMP 9's, as decoration
          { view: 'now', id: 'tnow', label: 'Now Playing' },
          { view: 'guide', id: 'tguide', label: 'Media Guide', disabled: true },
          <button key="tcd" className={TASK} id="tcd" disabled>Copy from CD</button>,
          { view: 'library', id: 'tlib', label: 'Media Library', disabled: true },
          { view: 'radio', id: 'tradio', label: 'Radio Tuner', disabled: true },
          <button key="tdev" className={TASK} id="tdev" disabled>Copy to CD or Device</button>,
        ]}>
        <span className="block pt-4 pb-1 text-center leading-[0]" id="taskexp" aria-hidden="true">
          <svg className="inline-block fill-none stroke-task-expand" width="15" height="12" viewBox="0 0 15 12">
            <path d="M3 1.5 L7.5 5.5 L12 1.5 M3 6 L7.5 10 L12 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </TaskList>

      {/* the panel's convex bottom-right sweep down into the blue flag well */}
      <svg className="flex-none z-2" id="tpbot" width="92" height="26" viewBox="0 0 92 26" aria-hidden="true">
        <path d="M4 0 H92 V26 H92 C78 26 78 8 60 8 H4 Z" fill="url(#gtblue)"/>
        <path d="M4 0 H60 C78 0 78 18 92 18 V0 Z" fill="url(#gtask)"/>
        <path d="M4 0 H60 C78 0 78 18 92 18" fill="none" stroke="#9FB0D8" strokeWidth="1"/>
        <rect x="4" y="0" width="1" height="26" fill="#3E5599" opacity=".5"/>
      </svg>

      {/* the tab on the seam between the task pane and the display: as in WMP 9 it hides the task
          pane (the round knob at the top left brings it back) */}
      <button type="button" className="absolute right-0 top-[40%] w-5 h-46 p-0 border-0 rounded-r-sm bg-task-grip shadow-[0_0_0_1px_var(--color-grip-edge)] z-3 cursor-pointer hover:[filter:brightness(1.08)]"
              id="taskgrip" title="Hide the task pane" aria-label="Hide the task pane"
              onClick={() => sh.store.getState().actions.setSettings({ taskPane: false })}></button>

      {/* the flag well: the blue region's own rounded bottom-right, over the Luna band */}
      <svg className="absolute left-0 bottom-0 z-1" id="tpend" width="92" height="46" viewBox="0 0 92 46" aria-hidden="true">
        <defs>
          <linearGradient id="gwell" x1="0" y1="0" x2=".8" y2="1">
            <stop offset="0" stopColor="#8CA2DE"/><stop offset=".5" stopColor="#7387C8"/>
            <stop offset="1" stopColor="#5E72B0"/>
          </linearGradient>
          <linearGradient id="gband" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#58658F"/><stop offset=".45" stopColor="#7A809D"/>
            <stop offset=".8" stopColor="#A9ADC9"/><stop offset="1" stopColor="#BCC2E2"/>
          </linearGradient>
        </defs>
        <rect x="0" y="29" width="92" height="17" fill="url(#gband)"/>
        <path id="tpwell" d="M0 0 H92 V4 C78 4 78 34 56 34 H14 C6 34 0 30 0 22 Z" fill="url(#gwell)"/>
        <path d="M92 4 C78 4 78 34 56 34 H14 C6 34 0 30 0 22" fill="none" stroke="#5B6FAE" strokeWidth="1" opacity=".8"/>
        <path id="tpwellhi" d="M2 2 H90" fill="none" stroke="#B6C6EE" strokeWidth="1" opacity=".7"/>
      </svg>

      {/* the emblem centred in the well's light bulge: between the highlight line (y 2) and the floor
          (y 34) of the 46 px drawing, and between the well's left edge and its curve on that middle
          row (0..77): centre 39, 18 = left 25, bottom 14 for 28 px (the alignment smoke measures it) */}
      <img className="absolute left-25 bottom-14 z-3 w-28 h-28 pointer-events-none" id="taskfoot" alt="" aria-hidden="true"
           src={spotify ? emblemSpotify : emblemWmp} />
    </div>
  );
}

// The iTunes 10 window, Windows build (docs/itunes-skin.md): the grey chrome (menu row with the caption
// buttons, the toolbar), the browser (source list, the selected source in its view, the bottom bar),
// and the visualizer in the browser's place while it shows (View > Show Visualizer, Ctrl+T: the app's
// Now Playing view) or full screen. #chrome and #titlebar keep their ids (the host squares their
// corners by id); the app states are data attributes on #chrome for the theme's variants.
import { useEffect, useState } from 'react';
import { Visualizer } from '../../../app/Visualizer';
import { isBare, isSpotify, Karaoke, useApp, useFullscreen, useScreenShown, useShell, ViewHost } from '../../../ui';
import { useSelection, Browser } from './Browser';
import { CaptionRow, Toolbar, useNativeTitle, useOwnWindow } from './Chrome';
import { Dialogs } from './Dialogs';

/** the sidebar folds away under this width (px) */
const NARROW = 760;

function useNarrow(): boolean {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW);
  useEffect(() => {
    const f = () => setN(window.innerWidth < NARROW);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return n;
}

export function DesktopRoot() {
  const sh = useShell(), narrow = useNarrow(), shown = useScreenShown();
  const st = useApp((x) => ({ bare: isBare(x), spotify: isSpotify(x) })), nativeTitle = useNativeTitle();
  useOwnWindow();
  // iTunes opens on the library, never on the visualizer: the app's Now Playing (WMP 9's usual view,
  // restored from the settings) becomes the library when this skin comes up under Spotify
  useEffect(() => {
    const s = sh.store.getState();
    if (st.spotify && s.ui.view === 'now') s.actions.setView('library');
  }, [st.spotify, sh]);
  // the view switcher works on a list of songs (greyed for covers, the store, the visualizer)
  const tracks = useSelection().content.kind === 'tracks', views = tracks && !shown;
  return (
    <div className="font-itunes text-12 leading-[1.3] text-black" data-ui-root="">
      <div id="chrome" className="absolute inset-0 flex flex-col overflow-hidden bg-itunes-chrome bg-no-repeat bg-[length:100%_76px] bg-[#A3A6A9] data-bare:bg-none data-bare:bg-black data-bare:cursor-none data-bare:[&_*]:cursor-none"
           data-bare={st.bare || undefined} data-spotify={st.spotify || undefined} data-nativetitle={nativeTitle || undefined}>
        <CaptionRow narrow={narrow} views={views} />
        <Toolbar views={views} />
        {(shown || !st.spotify) && <Screen />}
        <ViewHost views={{ library: Browserish, search: Browserish, guide: Browserish, radio: Browserish }} />
      </div>
      <Dialogs />
    </div>
  );
}

/** The browser under the app's Spotify views (all four are the iTunes window: the source list picks). */
function Browserish() {
  return <Browser narrow={useNarrow()} />;
}

/** The visualizer in the window (under the toolbar) or full screen: a double-click is full screen; the
 *  lyrics over it while they are on. */
function Screen() {
  const fs = useFullscreen();
  return (
    <div className="relative flex-auto min-h-0 bg-black" id="screen">
      <Visualizer className="block w-full h-full bg-black" id="view" onDoubleClick={fs.toggle} />
      <Karaoke id="lyr" className="absolute left-[5%] right-[5%] bottom-18 flex flex-col items-center gap-2 text-center pointer-events-none font-itunes [text-shadow:0_1px_3px_rgba(0,0,0,.9),0_0_8px_rgba(0,0,0,.7)]"
               ids={{ cur: 'lyrcur', next: 'lyrnext' }}
               classes={{
                 cur: 'inline-block max-w-full min-h-[1.3em] py-2 px-10 rounded-md bg-black/40 text-white font-semibold text-17 leading-[1.3] bare:text-20 empty:invisible',
                 next: 'inline-block max-w-full min-h-[1.3em] py-1 px-10 rounded-md bg-black/40 text-white/55 text-13 leading-[1.3] empty:invisible',
                 sung: 'text-[#9FD0FF]',
                 now: 'text-transparent [text-shadow:none] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,.9))] bg-[linear-gradient(90deg,#9FD0FF_var(--f,0%),#FFFFFF_var(--f,0%))] bg-clip-text',
               }} />
    </div>
  );
}

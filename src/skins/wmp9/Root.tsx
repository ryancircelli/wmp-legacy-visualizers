// The WMP 9 "Corporate" skin on XP Luna, composed from src/ui's pieces. #chrome and #titlebar
// keep their ids (the host squares their corners by id); every other id is kept too, for the
// smokes and anything that looks an element up by the old name. The app states the skin's
// classes key on (bare / spotify / nopl / notask variants, src/ui/theme.css) are data attributes
// on #chrome.
import { useEffect } from 'react';
import { cx, isBare, isSpotify, useApp, useShell, ViewHost } from '../../ui';
import { TaskPane, TitleBar, TopBar, WmpMenuBar } from './components/Chrome';
import { Modal } from './components/Dialogs';
import { Screen } from './components/Screen';
import { Transport, WmpSeekBar } from './components/Transport';
import { MediaGuide, MediaLibrary, RadioTuner, SearchView } from './components/Views';
import s from './wmp9.module.css';

export function Root() {
  const sh = useShell();
  const st = useApp((x) => ({ bare: isBare(x), spotify: isSpotify(x), nativeTitle: x.auth.nativeTitle === true,
                              taskPane: x.settings.taskPane !== false, playlistPane: x.settings.playlistPane !== false }));
  useBroadcastPrompt();
  return (
    <div className="font-xp text-11 leading-[1.4] text-ink" data-ui-root="">
      {/* Luna: the title bar across the top with rounded top corners, and a 4px blue border of the
          same colour down both sides and along the bottom, where XP squares the corners off. That
          border is #chrome's own background showing past #framebody's margin. A host that draws the
          window's chrome itself (nativetitle: tauri/src/titlebar.rs) draws this border too. */}
      <div className={cx(s.corners, 'absolute inset-0 flex flex-col overflow-hidden rounded-t-win bg-luna-window data-bare:rounded-none data-bare:bg-none data-bare:bg-black data-bare:cursor-none data-bare:[&_*]:cursor-none')}
           id="chrome" data-bare={st.bare || undefined} data-spotify={st.spotify || undefined} data-nativetitle={st.nativeTitle || undefined}
           data-nopl={!st.playlistPane || undefined} data-notask={!st.taskPane || undefined}>
        <TitleBar />
        <div className="flex-auto flex flex-col min-h-0 mt-0 mx-4 mb-4 border border-t-0 border-luna-sep bg-luna-frame bare:m-0 bare:border-0 bare:bg-black nativetitle:m-0 nativetitle:border-0" id="framebody">
          <WmpMenuBar />
          <div className="flex-auto flex flex-col min-h-0 bg-luna-frame" id="body">
            {/* the task pane knob's state: the label in the top bar toggles it */}
            <input className="absolute opacity-0 pointer-events-none" type="checkbox" id="tpcollapse" checked={!st.taskPane}
                   onChange={(e) => sh.store.getState().actions.setSettings({ taskPane: !e.currentTarget.checked })} />
            <TopBar />
            <div className="flex-auto min-h-0 grid gap-0 grid-cols-[92px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_14px_47px] notask:grid-cols-[0_minmax(0,1fr)] max-520:grid-cols-[0_minmax(0,1fr)] bare:block bare:h-full" id="stage">
              <TaskPane />
              <Screen />
              <WmpSeekBar />
              <Transport />
              <ViewHost views={{ library: MediaLibrary, search: SearchView, guide: MediaGuide, radio: RadioTuner }} />
            </div>
          </div>
        </div>
      </div>
      <Modal />
    </div>
  );
}

/** This skin's choice on the phone (ios/README.md): the visualizers want the broadcast, so iOS's
 *  sheet for it comes up 2 s into a logged-in mount unless one already feeds the app. A skin
 *  without visuals asks never. "Logged in" is the last session's hint (adapters/spotify/observers.ts
 *  wasLoggedIn), read here since a skin does not import adapters. */
function useBroadcastPrompt() {
  const store = useShell().store;
  useEffect(() => {
    let was = false;
    try { was = localStorage.getItem('wmp.loggedIn') === '1'; } catch { /* blocked storage */ }
    if (store.getState().auth.engine !== 'spotify' || !was || !window.alchemyBroadcast) return;
    window.alchemyBroadcast('state');
    const t = setTimeout(() => { if (!window.__wmpBroadcast?.running) window.alchemyBroadcast?.('picker'); }, 2000);
    return () => clearTimeout(t);
  }, [store]);
}

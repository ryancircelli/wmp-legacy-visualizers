// The page: picks the skin (settings.skin), gives it the shell (store, presets, full screen), and
// owns what is the page's rather than the skin's — the keyboard, full screen / the chrome-free
// view, the maximized-corner guess in a plain browser, and under Spotify keeping keys from the
// web player underneath.
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { getQueries, type Queries } from '../adapters';
import { PRESETS } from '../engine';
import type { AppStore } from '../model';
import { skinFor } from '../skins/registry';
import {
  runShortcut, ShellContext, useApp, useForgetOnLogout, useIdlePrefetch, useLyricsFor, WMP9_SHORTCUTS, type Shell, type Shortcut,
} from '../ui';
import '../ui/theme.css';
import { TickerContext } from './Visualizer';
import type { Ticker } from './ticker';
import { createQueryClient } from './query';

// the query devtools in dev builds only (the import is dropped from production bundles)
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null;

export function App({ store, ticker, root, client: given }: {
  store: AppStore; ticker: Ticker; root: Document | ShadowRoot;
  /** the fetched-data cache (mount makes one and shows it to diagnostics); else App makes its own */
  client?: QueryClient;
}) {
  const skin = skinFor(useStore(store, (s) => s.settings.skin)), Skin = skin.Root, engine = useStore(store, (s) => s.auth.engine);
  // menus and dialogs portal to the body standalone, into the shadow root under Spotify
  const [queries] = useState(getQueries), [client] = useState(() => given ?? createQueryClient(queries));
  const shell = useMemo<Shell>(() => makeShell(store, ticker, root instanceof Document ? root.body : root, skin.shortcuts, queries, client),
                               [store, ticker, root, skin, queries, client]);
  useEffect(() => wirePage(shell, root), [shell, root]);
  return (
    <QueryClientProvider client={client}>
      <ShellContext.Provider value={shell}>
        <TickerContext.Provider value={ticker}>
          <Skin />
        </TickerContext.Provider>
        {engine === 'spotify' && <SpotifyLyrics />}
        {engine === 'spotify' && <SpotifyAhead />}
      </ShellContext.Provider>
      {Devtools && <Suspense fallback={null}><Devtools initialIsOpen={false} /></Suspense>}
    </QueryClientProvider>
  );
}

/** Spotify mode: the playing track's lyrics from Spotify, on every track change (LRCLIB via the
 *  host stays the fallback). */
function SpotifyLyrics() {
  const { uri, art } = useApp((s) => ({ uri: s.playback.track?.uri ?? null, art: s.playback.track?.art ?? null }));
  useLyricsFor(uri, art);
  return null;
}

/** Spotify mode: fetch ahead while idle after login, and forget the account's results on logout. */
function SpotifyAhead() {
  useIdlePrefetch();
  useForgetOnLogout();
  return null;
}

export function makeShell(store: AppStore, ticker: Ticker, portal: HTMLElement | ShadowRoot = document.body,
                          shortcuts: readonly Shortcut[] = WMP9_SHORTCUTS, queries: Queries = getQueries(), client?: QueryClient): Shell {
  const sh: Shell = {
    store,
    queries,
    client,
    presets: PRESETS,
    portal,
    shortcuts,
    nativeSize: () => ticker.nativeSize(),
    debugText: () => ticker.debugText(),
    toggleFullscreen() {
      const s = store.getState();
      if (s.auth.mode === 'screensaver') return;
      if (document.fullscreenElement) { void document.exitFullscreen(); return; }
      document.documentElement.requestFullscreen().catch((e: Error) => {
        // No Fullscreen API (or refused): still give the chrome-free view.
        const st = store.getState();
        st.actions.setUi({ bare: !st.ui.bare });
        st.actions.setStatus('fullscreen: ' + e.message);
      });
    },
  };
  return sh;
}

const isFull = (store: AppStore) => !!document.fullscreenElement || store.getState().ui.bare;
const target = (e: Event) => (e.composedPath?.()[0] ?? e.target) as Element;

/** The keyboard as the old shell's onKey: Escape unwinds (menus, dialog, full screen), Alt+Enter
 *  and F go full screen, WMP 9's accelerators under Spotify, Ctrl+L lyrics, Ctrl+K karaoke, Space play/pause, D the
 *  debug overlay (advanced settings only). Keys typed into a field, or with a dialog up, stay there. */
export function onKey(sh: Shell, e: KeyboardEvent): void {
  const { store } = sh, s = store.getState(), a = s.actions;
  if (e.key === 'Escape') {
    if (s.ui.menu) a.setUi({ menu: null });
    else if (s.ui.dialog) a.setUi({ dialog: null });
    else if (isFull(store)) sh.toggleFullscreen();
    return;
  }
  if (e.altKey && e.key === 'Enter') { e.preventDefault(); sh.toggleFullscreen(); return; }
  if (s.auth.engine === 'spotify' && runShortcut(sh, e)) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault(); a.setLyricsEnabled(!s.settings.lyrics); return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault(); a.setKaraoke(!s.settings.karaoke); return;
  }
  if (e.ctrlKey || e.metaKey) return;                 // Ctrl+F is Next in WMP 9, never full screen
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(target(e)?.tagName ?? '') || s.ui.dialog) return;
  if (e.code === 'Space') { e.preventDefault(); void s.commands.playPause(); }
  else if ((e.key === 'd' || e.key === 'D') && s.settings.advanced) a.setSettings({ debug: !s.settings.debug });
  else if (e.key === 'f' || e.key === 'F') sh.toggleFullscreen();
}

function wirePage(sh: Shell, root: Document | ShadowRoot): () => void {
  const { store } = sh, offs: (() => void)[] = [];
  const on = <K extends string>(t: EventTarget, type: K, f: (e: Event) => void, opts?: boolean) => {
    t.addEventListener(type, f, opts);
    offs.push(() => t.removeEventListener(type, f, opts));
  };
  on(root, 'keydown', (e) => onKey(sh, e as KeyboardEvent));

  const ss = () => store.getState().auth.mode === 'screensaver';
  on(document, 'fullscreenchange', () => {
    const f = !!document.fullscreenElement;
    store.getState().actions.setUi({ fullscreen: f, bare: f || ss() });
  });

  // Under the desktop host 'maximized' is the host's to set (main.ts, on WM_SIZE); a plain browser
  // guesses from the window against the screen.
  if (!store.getState().auth.hostWindow) {
    on(window, 'resize', () => document.body.classList.toggle('maximized',
      window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight));
  }

  // Spotify: its web player has shortcuts of its own under us (Space = play/pause), so while the
  // overlay shows no key reaches it — keys from inside the shadow root stop at its host (this
  // page already heard them on the root), keys aimed at Spotify's body are ours instead.
  const host = document.getElementById('wmp-root');
  if (store.getState().auth.engine === 'spotify') {
    for (const type of ['keydown', 'keyup', 'keypress']) {
      if (host) on(host, type, (e) => e.stopPropagation());
      on(window, type, (e) => {
        if (store.getState().auth.loggedIn !== true || (host && e.composedPath?.().includes(host))) return;
        if (type === 'keydown') onKey(sh, e as KeyboardEvent);
        e.stopPropagation();
      }, true);
    }
  }
  return () => { for (const off of offs) off(); };
}

// Boot: the store, the engine's adapter (Spotify when the host says so, else the local one), the
// ticker, and React on the mount node — document's #root standalone, or the one inside the open
// shadow root the Spotify host mounts on <div id="wmp-root"> (its css adopted there by the host).
import { createRoot } from 'react-dom/client';
import { createLocalAdapter } from '../adapters/local';
import { createSpotifyAdapter } from '../adapters/spotify';
import { wasLoggedIn } from '../adapters/spotify/observers';
import { persistQueries } from '../ui';
import { detectMode, hostWindow, nativeTitle } from '../adapters/host';
import { idleStatus } from '../adapters/host/media';
import { createAppStore, SCALE_OPTS, type Scale, type VisKind } from '../model';
import { App } from './App';
import { createQueryClient } from './query';
import type { QueryClient } from '@tanstack/react-query';
import { getQueries } from '../adapters';
import { createTicker, type Ticker } from './ticker';

declare global {
  interface Window {
    /** the host's diagnostics and the smokes: the store and the ticker's view of the engine */
    Alchemy?: unknown;
  }
}

export async function mount(): Promise<void> {
  window.alchemyMarks?.push('mount=' + Math.round(performance.now()));
  const store = createAppStore();
  const { actions } = store.getState();
  const spotify = window.alchemyEngine === 'spotify';
  const root = window.alchemyRoot ?? document;
  // Known before the first render (the layout differs); the adapter confirms them when it starts.
  actions.setAuth({ engine: spotify ? 'spotify' : 'local', mode: detectMode(), hostWindow: hostWindow(), nativeTitle: nativeTitle() });
  if (detectMode() === "screensaver") actions.setUi({ bare: true });
  // Spotify's own page (its login) shows until the web player says we are logged in, unless the
  // last session here was: then the skin comes up now (adapters/spotify/observers.ts).
  if (spotify && !wasLoggedIn()) { const h = document.getElementById('wmp-root'); if (h) h.style.display = 'none'; }

  // CI / screenshot hooks: ?vis=alchemy|bars|battery&preset=N&scale=0.25|0.5|0.75|1
  const q = (re: RegExp) => re.exec(location.search);
  const qv = q(/(^|[?&])vis=(alchemy|bars|battery)/), qp = q(/(^|[?&])preset=(\d+)/), qs = q(/(^|[?&])scale=([0-9.]+)/);
  if (qv || qp) actions.setVis((qv?.[2] as VisKind) ?? store.getState().vis.kind, qp ? +qp[2]! : store.getState().vis.preset);
  if (qs && (SCALE_OPTS as readonly unknown[]).includes(+qs[2]!)) actions.setSettings({ scale: +qs[2]! as Scale });
  actions.setStatus(idleStatus(store));

  // Audio last, and not until a frame has been painted: attaching system audio spawns the host's
  // WASAPI helper, which was measured to push the first frame from 180 ms to two seconds.
  const adapter = spotify ? createSpotifyAdapter(store) : createLocalAdapter(store);
  const ticker = createTicker(store, () => adapter.start());

  let el = root.getElementById('root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'root';
    (root instanceof Document ? root.body : root).appendChild(el);
  }
  const client = createQueryClient(getQueries());
  // Spotify: the last session's library, Media Guide, radio and playlists before the first render
  if (spotify) await persistQueries(client);
  createRoot(el).render(<App store={store} ticker={ticker} root={root} client={client} />);
  window.Alchemy = shim(store, ticker, client);
}

/** window.Alchemy: what the host's log line and the smokes read (the old Alchemy.Shell's names). */
function shim(store: ReturnType<typeof createAppStore>, t: Ticker, client: QueryClient) {
  return {
    version: 7,
    store,
    /** the fetched-data cache and its keys (diagnostics, the smokes' seeding) */
    query: { client, keys: getQueries().keys },
    Shell: {
      get settings() { return store.getState().settings; },
      get engine() { return t.engine; },
      get level() { return t.level; },
      get fps() { return t.fps; },
      get hold() { return store.getState().vis.hold; },
      get source() { return store.getState().playback.capture; },
      get paused() { return t.paused; },
      set paused(v: boolean) { t.paused = v; },
      setVis: (vis: VisKind, preset: number) => store.getState().actions.setVis(vis, preset),
    },
  };
}

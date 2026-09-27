// The Spotify engine's page side (CONTRACT v6.1; port of src/95-spotify.js). Active when the host
// set window.alchemyEngine = "spotify": this page is an overlay over Spotify's own web player and
// drives it through the channels the web player itself uses, never its DOM and never the public
// Web API. The host socket (PCM, lyrics, GSMTC as a fallback) comes from the local adapter's startHost.
import { noCommands, type AppStore } from '../../model';
import { detectMode, hostWindow, win } from '../host';
import { hostTransport, startHost, type HostLink } from '../local';
import * as C from './connect';
import { openLink, parseLink } from './links';
import { canLogout, logout } from './logout';
import { observe } from './observers';
import { openArtist } from './artist';
import { bindQueries } from './queries';
import { addTo, setLiked } from './saved';
import { newCache, type Sp } from './sp';

export function newSp(store: AppStore, fallback: Sp['fallback'] = () => {}): Sp {
  return { store, fallback, hasState: false, last: null, scanned: {}, bad: {}, read: {}, scan: null, routed: false, routes: {}, sentVolume: [], fromDevice: false,
           blockedUntil: 0, ctxNames: {}, seeds: {}, loading: {}, cache: newCache() };
}

export function spotifyCommands(sp: Sp, host: HostLink | null) {
  const { store } = sp;
  const md = () => sp.last?.track?.metadata ?? {};
  const openInLibrary = (uri: string, name?: string) => {
    const { actions } = store.getState();
    if (name) sp.cache.names.set(uri, name);
    actions.setUi({ libNode: uri, libSel: null });
    actions.setView('library');
  };
  const openFrom = () => {
    const c = store.getState().playback.context;
    if (c && /^spotify:(playlist|album):/.test(c.uri)) openInLibrary(c.uri);
  };
  const openAlbum = () => {
    const m = md();
    if (/^spotify:album:/.test(m.album_uri || '')) openInLibrary(m.album_uri!, m.album_title);
  };
  const T = host ? hostTransport(store, host) : null;
  return {
    ...noCommands,
    playPause: () => C.transport(sp, 'playpause'),
    play: () => C.transport(sp, 'play'),
    pause: () => C.transport(sp, 'pause'),
    next: () => { const p = store.getState().playback; return p.status !== 'none' && p.canNext ? C.transport(sp, 'next') : Promise.resolve(); },
    prev: () => { const p = store.getState().playback; return p.status !== 'none' && p.canPrev ? C.transport(sp, 'prev') : Promise.resolve(); },
    seek: (ms: number) => {
      const p = store.getState().playback;
      return p.status === 'none' || !p.canSeek ? Promise.resolve() : C.transport(sp, 'seek', ms);
    },
    /** Stop with no player state is the local stop (the capture source). */
    stop: () => { if (sp.hasState) void C.stop(sp); else host?.stopSource(); },
    skip: (sec: number) => (sp.last ? C.skip(sp, sec) : T?.skip(sec)),
    toggleShuffle: () => void C.toggleShuffle(sp),
    setRepeat: (m) => void C.setRepeat(sp, m),
    cycleRepeat: () => void C.cycleRepeat(sp),
    playContext: (ctx, track) => void C.playContext(sp, ctx, track),
    playItem: (it) => void (/^spotify:(track|episode):/.test(it.uri)
      ? C.playContext(sp, it.ctx || it.uri, it.ctx ? it.uri : null) : C.playContext(sp, it.uri, null)),
    /** Play all: from the first track (a bare replay of the playing context would not move). Liked
     *  Songs has no context we can name, so it starts its first track in that track's album. */
    playAll: (uri) => {
      const f = sp.cache.lists.get(uri)?.[0];
      if (/^spotify:(playlist|album|artist):/.test(uri)) void C.playContext(sp, uri, f ? f.uri : null);
      else if (f?.ctx) void C.playContext(sp, f.ctx, f.uri);
    },
    search: (q) => store.getState().actions.setUi({ searchQ: String(q ?? ''), searchOnly: null }),
    openInLibrary,
    openAlbum,
    openArtist: (uri) => openArtist(sp, uri),
    openFrom,
    transfer: (id) => C.transfer(sp, id),
    setLiked: (uri, on) => setLiked(sp, uri, on),
    addTo: (track, target, on) => addTo(sp, track, target, on),
    openLink: (text) => {
      const uri = parseLink(text);
      if (!uri) return false;
      openLink(sp, uri).catch(() => {});
      return true;
    },
    logout,
    win,
  } satisfies typeof noCommands;
}

export function createSpotifyAdapter(store: AppStore): { start(): void; stop(): void } {
  let offs: (() => void)[] = [], host: HostLink | null = null;
  return {
    start() {
      const { actions } = store.getState();
      actions.setAuth({ engine: 'spotify', loggedIn: null, mode: detectMode(), hostWindow: hostWindow(), canLogout: canLogout() });
      // The slider is the player's volume here: 0..100, not the 0..200 capture range.
      if (store.getState().settings.volume > 100) actions.setSettings({ volume: 100 });
      const sp = newSp(store);
      host = startHost(store, { hostMedia: () => !sp.hasState, playerVolume: true });
      const h = host;
      sp.fallback = (cmd, pos) => h.mediaCmd(cmd, pos);
      actions.setCommands(spotifyCommands(sp, h));
      offs = [
        store.subscribe((s) => (s.settings.muted ? 0 : s.settings.volume), (v) => { if (!sp.fromDevice) C.volume(sp, v); }),
        observe(sp),
      ];
      bindQueries(sp);
      actions.setView(store.getState().settings.view);
    },
    stop() {
      for (const off of offs) off();
      offs = [];
      host?.stop();
      host = null;
      store.getState().actions.setCommands(noCommands);
    },
  };
}


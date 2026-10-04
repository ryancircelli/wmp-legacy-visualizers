// The Spotify engine's page side (CONTRACT v6.1, v8; port of src/95-spotify.js). Active when the
// host set window.alchemyEngine = "spotify": this page drives Spotify's own web player through the
// channels the web player itself uses, never its DOM and never the public Web API; from inside its
// page (the Deno host's overlay) or through the host (Tauri), whichever transport.ts finds. The host
// socket (PCM, lyrics, GSMTC as a fallback) comes from the local adapter's startHost.
import { eqPreset, LIKED, noCommands, type AppStore, type Settings } from '../../model';
import { announceHostUpdate, checkForUpdates, detectMode, hostWindow, win } from '../host';
import * as hostPlayer from '../host/player';
import { hostTransport, startHost, type HostLink } from '../local';
import * as C from './connect';
import { openLink, parseLink } from './links';
import { observe } from './observers';
import { openArtist } from './artist';
import { bindQueries } from './queries';
import { reorderQueue } from './queue';
import { addTo, setLiked } from './saved';
import { newCache, type Sp } from './sp';
import { transport } from './transport';

export function newSp(store: AppStore, fallback: Sp['fallback'] = () => {}): Sp {
  return { store, fallback, hasState: false, last: null, scanned: {}, bad: {}, read: {}, scan: null, routed: false, routes: {}, sentVolume: [], fromDevice: false, wantPlay: 0, opts: {},
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
    checkForUpdates,
    playPause: () => C.transport(sp, 'playpause'),
    play: () => C.transport(sp, 'play'),
    pause: () => C.transport(sp, 'pause'),
    next: () => { const p = store.getState().playback; return p.status !== 'none' && p.canNext ? C.transport(sp, 'next') : Promise.resolve(); },
    // no previous track (the context's first): back to the start, as Spotify's own back button does
    prev: () => { const p = store.getState().playback; return p.status === 'none' ? Promise.resolve() : p.canPrev ? C.transport(sp, 'prev') : p.canSeek ? C.transport(sp, 'seek', 0) : Promise.resolve(); },
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
    /** Play all: from the first track (a bare replay of the playing context would not move); with
     *  shuffle on, from a random one of the first page, shuffled. Liked Songs (LIKED) too. */
    playAll: (uri) => {
      const rows = sp.cache.lists.get(uri) ?? [], shuffle = store.getState().playback.shuffle;
      const f = rows[shuffle ? Math.floor(Math.random() * rows.length) : 0];
      if (/^spotify:(playlist|album|artist):/.test(uri) || uri === LIKED) void C.playContext(sp, uri, f ? f.uri : null, shuffle);
    },
    addToQueue: (uri: string) => void C.addToQueue(sp, uri),
    reorderQueue: (order: readonly number[]) => void reorderQueue(sp, order),
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
    logout: () => transport().logout(),
    win,
  } satisfies typeof noCommands;
}

/** The host's own player's sound settings (CONTRACT v10 `crossfade:` `eq:` `quality:` `normalise:` `cache:`),
 *  each a command from the settings. */
const SOUND: ((s: Settings) => string)[] = [
  (s) => 'crossfade:' + s.crossfade,
  (s) => 'eq:' + JSON.stringify(eqPreset(s.eq).gains),
  (s) => 'quality:' + s.quality,
  (s) => 'normalise:' + (s.normalise ? 1 : 0),
  (s) => 'cache:' + (s.audioCache ? 1 : 0),
];
/** Offered while the host has the player (auth.hostPlayer): every sound setting sent at once and each again at
 *  its every change. The host keeps the last values itself too; one it already has changes nothing there. */
export function hostSettings(store: AppStore): () => void {
  const on = hostPlayer.available();
  store.getState().actions.setAuth({ hostPlayer: on });
  if (!on) return () => {};
  const offs = SOUND.map((cmd) => store.subscribe((s) => cmd(s.settings), (c) => hostPlayer.send(c), { fireImmediately: true }));
  return () => offs.forEach((off) => off());
}

export function createSpotifyAdapter(store: AppStore): { start(): void; stop(): void } {
  let offs: (() => void)[] = [], host: HostLink | null = null;
  return {
    start() {
      const { actions } = store.getState();
      actions.setAuth({ engine: 'spotify', loggedIn: null, mode: detectMode(), hostWindow: hostWindow(), canLogout: transport().canLogout() });
      announceHostUpdate(store);
      // The slider is the player's volume here: 0..100, not the 0..200 capture range.
      if (store.getState().settings.volume > 100) actions.setSettings({ volume: 100 });
      const sp = newSp(store);
      host = startHost(store, { hostMedia: () => !sp.hasState, playerVolume: true });
      const h = host;
      sp.fallback = (cmd, pos) => h.mediaCmd(cmd, pos);
      actions.setCommands(spotifyCommands(sp, h));
      // The phone's volume buttons (the iOS app reports them, CONTRACT v9): the slider follows,
      // as a device's own volume does, without sending the level back out.
      const buttons = () => {
        const v = window.__wmpVolume;
        if (typeof v !== 'number' || v < 0 || v > 100 || v === store.getState().settings.volume) return;
        sp.fromDevice = true;
        try { actions.setSettings({ volume: Math.round(v), muted: false }); } finally { sp.fromDevice = false; }
      };
      window.addEventListener('wmp-volume', buttons);
      // The app's first report can land before this listener (the skin asks at mount, the adapter
      // starts after the first paint), and a report while the page was in the background may be
      // lost: read the level now and whenever the page is seen again.
      buttons();
      const seen = () => { if (document.visibilityState === 'visible') buttons(); };
      document.addEventListener('visibilitychange', seen);
      // the phone's heat and power mode, as they change, into the host's log (the owner: "my phone does overheat")
      const thermal = () => window.alchemyLog?.('phone: thermal ' + (window.__wmpThermal ?? '?') + (window.__wmpLowPower ? ', low power' : ''));
      window.addEventListener('wmp-thermal', thermal); window.addEventListener('wmp-lowpower', thermal);
      if (window.__wmpThermal && window.__wmpThermal !== 'nominal') thermal();
      offs = [
        () => { window.removeEventListener('wmp-volume', buttons); document.removeEventListener('visibilitychange', seen);
                window.removeEventListener('wmp-thermal', thermal); window.removeEventListener('wmp-lowpower', thermal); },
        store.subscribe((s) => (s.settings.muted ? 0 : s.settings.volume), (v) => { if (!sp.fromDevice) C.volume(sp, v); }),
        hostSettings(store),
        transport().start(),   // first: the Tauri bridge sets up what observe reads
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


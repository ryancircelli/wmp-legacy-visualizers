// The app / website engine (90-shell.js): system audio from the host's PCM socket, or the
// browser's share picker; the host's GSMTC `media` and LRCLIB `lyrics` frames; mediaCmd, lyricsPref
// and wake back to the host. The Spotify adapter reuses startHost() for the same socket.
import type { AppStore, Commands, TimedLevel } from '../../model';
import { noCommands, positionNow } from '../../model';
import { announceHostUpdate, checkForUpdates, detectMode, rememberSiteVersion, followFullscreen, hostWindow, openSocket, socketUrl, win, type HostSocket, type MediaFrame } from '../host';
import { idleStatus, onLyricsFrame, onMediaFrame, optimistic, pausedPatch, setSession, sourceStatus, MSG_LOCAL } from '../host/media';
import { makeLevel, createAnalyserGraph, createPcmLevel, type AnalyserGraph } from './audio';

const MSG_PICK = 'Choose a tab or your screen and tick "Share audio"';
const MSG_NOAUDIO = 'No audio in that share — share again with "Share audio" ticked';

/** An attached audio source: an AudioNode into the analyser graph, or bytes filled directly. */
interface Source {
  kind: string;
  label: string;
  node?: AudioNode;
  fill?: (level: TimedLevel) => void;
  isPaused?: () => boolean;
  pause?: (on: boolean) => void;
  stop?: () => void;
}

export interface HostLink {
  /** page -> host mediaCmd (SMTC); position in ms */
  mediaCmd(cmd: string, posMs?: number): void;
  /** the capture source, local stop (Stop with no player state) */
  stopSource(): void;
  startCapture(): Promise<void>;
  togglePause(): void;
  hasSource(): boolean;
  stop(): void;
}

/** Everything the host socket and the local sources do, for either engine. `hostMedia` sees each
 *  GSMTC frame first and returns false to drop it (the Spotify player's own state wins). */
export function startHost(store: AppStore, opts: { hostMedia?: () => boolean; playerVolume?: boolean } = {}): HostLink {
  const { actions } = store.getState();
  const level = makeLevel();
  let source: Source | null = null, sock: HostSocket | null = null, graph: AnalyserGraph | null = null;
  const S = () => store.getState().settings;
  const gain = () => (opts.playerVolume ? 1 : S().muted ? 0 : S().volume / 100);
  const send = (o: object) => sock?.send(o);
  const cap = () => store.getState().playback.capture;
  const setCap = (p: Partial<NonNullable<ReturnType<typeof cap>>> | null) =>
    actions.setPlayback({ capture: p && cap() ? { ...cap()!, ...p } : (p as ReturnType<typeof cap>) });

  function audio(): AnalyserGraph {
    if (!graph) { graph = createAnalyserGraph(S().smoothing); graph.setGain(gain()); }
    graph.resume();
    return graph;
  }

  function stopSource(): void {
    const s = source;
    source = null;
    if (!s) return;
    try { s.node?.disconnect(); } catch { /* already */ }
    try { s.stop?.(); } catch { /* already */ }
  }
  function attach(src: Source): void {
    stopSource();
    if (src.node) audio().connect(src.node);
    source = src;
    setCap({ kind: src.kind, label: src.label, paused: false, acc: 0, from: Date.now() });
    actions.setStatus(src.label);
  }
  function localStop(): void {
    stopSource();
    setCap(null);
    actions.setStatus(idleStatus(store));
  }

  // The one way in from a browser: a click on Play. Chromium only offers tab/system audio when
  // video is asked for too, so video:true — and the video track is dropped the moment it arrives.
  async function startCapture(): Promise<void> {
    audio();
    actions.setStatus(MSG_PICK);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
    catch (err) {
      // Cancelled / denied: leave the instructions up, they say what to do next.
      const name = (err as { name?: string } | null)?.name;
      actions.setStatus(name === 'NotAllowedError' ? MSG_PICK : 'Share failed: ' + name);
      return;
    }
    for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }
    const tracks = stream.getAudioTracks();
    if (!tracks.length) { for (const t of stream.getTracks()) t.stop(); actions.setStatus(MSG_NOAUDIO); return; }
    // "Stop sharing" in Chrome's bar ends the track: fall back to silence, never freeze.
    tracks[0]!.addEventListener('ended', () => { if (source?.kind === 'display') localStop(); });
    attach({ kind: 'display', node: audio().source(stream), label: 'Sharing: ' + (tracks[0]!.label || 'shared audio'),
             stop: () => { for (const t of stream.getTracks()) t.stop(); } });
  }

  // The desktop host without its WASAPI helper: loopback audio with no picker (video:false: desktop
  // video capture fails on plenty of Windows machines). Never ask getUserMedia for audio alone that
  // way — it hard-crashes the renderer.
  async function startLoopback(): Promise<void> {
    audio();
    let why = '', stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false }).catch((e: { name?: string }) => {
        why = 'getDisplayMedia ' + e.name + ' -> ';
        const desktop = { mandatory: { chromeMediaSource: 'desktop' } } as unknown as MediaTrackConstraints;
        return navigator.mediaDevices.getUserMedia({ audio: desktop, video: desktop });
      });
    } catch (err) {
      actions.setStatus(idleStatus(store) + ' (loopback: ' + why + (err as { name?: string } | null)?.name + ')');
      return;
    }
    for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }
    if (!stream.getAudioTracks().length) { actions.setStatus(idleStatus(store)); return; }
    attach({ kind: 'loopback', node: audio().source(stream), label: 'System audio (loopback)',
             stop: () => { for (const t of stream.getTracks()) t.stop(); } });
  }

  // The host's WASAPI helper over the socket: {"rate":n}, then interleaved stereo float32.
  function openHostAudio(url: string): void {
    const pcm = createPcmLevel();
    let me: HostSocket | null = null;
    const fill = (l: TimedLevel) => pcm.fill(l, S().smoothing, store.getState().vis.kind);
    me = sock = openSocket(url, {
      // The desktop host only fetches lyrics while this says so (CONTRACT v5).
      onOpen: () => send({ type: 'lyricsPref', enabled: !!S().lyrics }),
      // The host resends {"rate"} whenever its capture restarts (a default-device change): this
      // socket's source is already attached then, and attaching again would stop it, which closes
      // the very socket the frame came on.
      onRate: (rate) => {
        pcm.setRate(rate);
        if (source?.fill !== fill) attach({ kind: 'wsaudio', label: MSG_LOCAL, fill, stop: () => me?.close() });
      },
      onPcm: (f) => pcm.push(f, gain()),
      onMedia: (m: MediaFrame) => { if (!opts.hostMedia || opts.hostMedia()) onMediaFrame(store, m); },
      onLyrics: (l) => onLyricsFrame(store, l),
      onLost: (why, attached) => {
        if (sock === me) {
          sock = null;
          actions.setLyrics({ status: 'none', lines: null, plain: null, track: null, source: null });
          if (store.getState().playback.source === 'host') setSession(store, null);
        }
        // Attached and then dropped: back to the silence animation, never a frozen last frame.
        if (attached) { if (source?.fill === fill) localStop(); }
        else actions.setStatus(idleStatus(store) + ' (system audio: ' + why + ')');
      },
    });
    if (!sock) actions.setStatus(idleStatus(store) + ' (system audio: cannot open ' + url + ')');
  }

  // Hidden CI / screenshot sources: ?src=tone, ?src=url:<href>.
  function startTone(): void {
    const g = audio();
    attach({ kind: 'tone', ...g.tone(), label: 'test tone' });
  }
  function playURL(href: string): void {
    const g = audio(), f = g.file(href);
    attach({ kind: 'file', ...f, label: 'url: ' + href });
    f.play().catch((err: Error) => actions.setStatus('play failed: ' + err.message));
  }

  // The visualizers' input: one TimedLevel, filled in place each call.
  function fillLevel(): TimedLevel {
    const live = !!source && !source.isPaused?.();
    const paused = !!cap()?.paused;
    level.state = !paused && (live || S().animate) ? 2 : 1;
    level.timeStamp = performance.now();
    if (source?.fill) source.fill(level);
    else if (graph) graph.fill(level, store.getState().vis.kind);
    return level;
  }
  actions.setLevel(fillLevel);

  const offs = [
    followFullscreen(store, send),
    store.subscribe((s) => s.settings.lyrics, (on) => send({ type: 'lyricsPref', enabled: !!on })),
    store.subscribe((s) => (s.settings.muted ? 0 : s.settings.volume), () => graph?.setGain(gain())),
    store.subscribe((s) => s.settings.smoothing, (v) => graph?.setSmoothing(v)),
  ];

  actions.setStatus(sourceStatus(store));
  const q = /(^|[?&])src=([^&]*)/.exec(location.search), v = q ? decodeURIComponent(q[2]!) : '';
  const url = socketUrl();
  if (v === 'tone') startTone();
  else if (v.startsWith('url:')) playURL(v.slice(4));
  else if (url) openHostAudio(url);
  else if (window.alchemyElectron?.loopback) void startLoopback();

  return {
    mediaCmd: (cmd, posMs) => send(posMs == null ? { type: 'mediaCmd', cmd } : { type: 'mediaCmd', cmd, position: posMs / 1000 }),
    stopSource: localStop,
    startCapture,
    hasSource: () => !!source,
    togglePause() {
      const c = cap();
      if (!c) return;
      const paused = !c.paused, now = Date.now();
      setCap(paused ? { paused, acc: c.acc + (c.from ? now - c.from : 0), from: 0 } : { paused, from: now });
      source?.pause?.(paused);
      actions.setStatus(paused ? 'Paused' : c.label);
    },
    stop() {
      for (const off of offs) off();
      actions.setLevel(null);
      stopSource();
      sock?.close();
      graph?.close();
    },
  };
}

/** Commands shared by both engines for a media session reached through the host (SMTC). */
export function hostTransport(store: AppStore, host: HostLink): Pick<Commands, 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'skip'> {
  const pb = () => store.getState().playback;
  const seek = (ms: number) => {
    const p = pb();
    if (p.status === 'none' || !p.canSeek) return Promise.resolve();
    return optimistic(store, { position: ms, at: Date.now() }, () => { host.mediaCmd('seek', ms); return Promise.resolve(true); });
  };
  const send = (ok: boolean, cmd: string) => { if (ok) host.mediaCmd(cmd); return Promise.resolve(); };
  // Play / pause show at once; the host's next SMTC frame confirms (or corrects) them.
  const playing = (on: boolean) => {
    if (pb().status === 'none') return Promise.resolve();
    return optimistic(store, pausedPatch(store, !on), () => { host.mediaCmd(on ? 'play' : 'pause'); return Promise.resolve(true); });
  };
  return {
    play: () => playing(true),
    pause: () => playing(false),
    next: () => send(pb().status !== 'none' && pb().canNext, 'next'),
    prev: () => send(pb().status !== 'none' && pb().canPrev, 'prev'),
    seek,
    skip: (sec) => { void seek(Math.max(0, positionNow(store.getState()) + sec * 1000)); },
  };
}

export function createLocalAdapter(store: AppStore): { start(): void; stop(): void } {
  let host: HostLink | null = null;
  return {
    start() {
      const { actions } = store.getState();
      actions.setAuth({ engine: 'local', loggedIn: true, mode: detectMode(), hostWindow: hostWindow(), canLogout: false });
      announceHostUpdate(store);
      if (detectMode() === 'web') rememberSiteVersion();
      const h = (host = startHost(store));
      const pb = () => store.getState().playback;
      actions.setCommands({
        ...noCommands,
        ...hostTransport(store, h),
        checkForUpdates,
        playPause() {
          if (pb().status !== 'none') {
            const on = pb().status !== 'playing';
            return optimistic(store, pausedPatch(store, !on), () => { h.mediaCmd('playpause'); return Promise.resolve(true); });
          }
          else if (!h.hasSource()) void h.startCapture();
          else h.togglePause();
          return Promise.resolve();
        },
        stop: () => h.stopSource(),
        startCapture: () => h.startCapture(),
        win,
      });
    },
    stop() { host?.stop(); host = null; store.getState().actions.setCommands(noCommands); },
  };
}

// What both adapters share with the Deno host: mode detection, the window bindings, the audio
// socket (PCM binary frames + `media` / `lyrics` JSON text frames, CONTRACT v4/v5) and the
// page -> host messages (mediaCmd, lyricsPref, wake).
import './globals';
import type { AppStore, Mode, WinAction } from '../../model';

/** One boot stage into the host's startup log (a no-op in a plain browser). */
export function mark(n: string): void {
  window.alchemyMarks?.push(n + '=' + Math.round(performance.now()));
}

/** Screensaver: the host's /s window, or ?mode=screensaver|ss=1 to test the layout in a browser. */
export function detectMode(): Mode {
  if (window.alchemyElectron?.mode === 'screensaver' || /(^|[?&])(mode=screensaver|ss=1)/.test(location.search)) {
    return 'screensaver';
  }
  return window.alchemyElectron || window.alchemyScreensaver ? 'app' : 'web';
}

export const hostWindow = () => typeof window.alchemyWinDrag === 'function';

export function win(action: WinAction): void {
  const f = { drag: window.alchemyWinDrag, min: window.alchemyWinMin, max: window.alchemyWinMax,
              close: window.alchemyWinClose, size: window.alchemyWinSize }[action];
  if (typeof f === 'function') f();
  else if (action === 'close') window.close();
}

// ----------------------------------------------------------------- the host socket
export interface MediaFrame {
  type: 'media';
  status: 'playing' | 'paused' | 'stopped' | 'none';
  title?: string; artist?: string; album?: string; app?: string;
  /** seconds */
  position?: number; duration?: number;
  art?: string | null;
  canSeek?: boolean; canNext?: boolean; canPrev?: boolean;
}
export interface LyricsFrame {
  type: 'lyrics';
  status: 'synced' | 'plain' | 'none' | 'error';
  source?: string;
  /** seconds */
  lines?: { t: number; text: string; words?: { t: number; text: string }[] }[] | null;
  plain?: string | null;
  track?: { title: string; artist: string; album?: string; duration?: number };
}

export interface SocketHandlers {
  /** the first text frame, {"rate":n}: PCM follows */
  onRate(rate: number): void;
  /** interleaved stereo float32 */
  onPcm(pcm: Float32Array): void;
  onMedia(m: MediaFrame): void;
  onLyrics(l: LyricsFrame): void;
  /** the socket failed or closed; `attached` = a rate frame had arrived */
  onLost(why: string, attached: boolean): void;
  onOpen(): void;
}

export interface HostSocket {
  send(o: object): void;
  close(): void;
}

function parse(t: string): { type?: string; rate?: number } | null {
  try { return JSON.parse(t) as { type?: string; rate?: number } | null; } catch { return null; }
}

/** The one socket to the host; null when it cannot even be constructed. */
export function openSocket(url: string, h: SocketHandlers): HostSocket | null {
  let ws: WebSocket;
  try { ws = new WebSocket(url); } catch { return null; }
  let attached = false, dead = false;
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => h.onOpen();
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data === 'string') {
      const msg = parse(e.data);
      if (msg?.type === 'media') return h.onMedia(msg as MediaFrame);
      if (msg?.type === 'lyrics') return h.onLyrics(msg as LyricsFrame);
      mark('audioSocket');                        // {"rate":48000}, always first
      attached = true;
      return h.onRate(msg ? (msg.rate ?? 0) | 0 : 0);
    }
    if (attached) h.onPcm(new Float32Array(e.data as ArrayBuffer));
  };
  const lost = (why: string) => { if (!dead) { dead = true; h.onLost(why, attached); } };
  ws.onerror = () => lost('socket error');
  ws.onclose = () => lost('socket closed');
  return {
    send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
}

/** The socket URL when this page should use the host's system audio, else null. */
export function socketUrl(): string | null {
  const host = window.alchemyScreensaver;
  if (host?.audio) return host.url || 'ws://' + location.host + '/audio';
  return /(^|[?&])audio=ws/.test(location.search) ? 'ws://' + location.host + '/audio' : null;
}

/** Full screen keeps the display awake (not in the screensaver: Windows owns power there): the
 *  host's SetThreadExecutionState via {"type":"wake"} and the Screen Wake Lock. Also moves the
 *  desktop host's window in and out of full screen. */
export function followFullscreen(store: AppStore, send: (o: object) => void): () => void {
  let lock: WakeLockSentinel | null = null;
  const wake = (on: boolean) => {
    if (store.getState().auth.mode === 'screensaver') return;
    send({ type: 'wake', on });
    const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined;
    if (!wl) return;
    if (on && !lock && document.visibilityState === 'visible') {
      wl.request('screen').then((l) => { lock = l; l.onrelease = () => { lock = null; }; }, () => {});
    } else if (!on && lock) { void lock.release(); lock = null; }
  };
  const full = (s: ReturnType<AppStore['getState']>) => s.ui.fullscreen || s.ui.bare;
  const offWake = store.subscribe(full, wake);
  const offWin = store.subscribe((s) => s.ui.fullscreen, (on) => window.alchemyWinFull?.(on));
  // The engine drops the lock when the page is hidden; take it back when a full-screen view returns.
  const vis = () => { if (full(store.getState())) wake(true); };
  document.addEventListener('visibilitychange', vis);
  return () => { offWake(); offWin(); document.removeEventListener('visibilitychange', vis); };
}

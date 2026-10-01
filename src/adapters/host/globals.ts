// The window globals the hosts set (CONTRACT.md v1–v8; tauri/src/host.js, and the retired Deno host's
// main.ts and spotify.ts).
/** Help > Check for Player Updates, as the host answers it (tauri/src/update.rs) */
export interface HostCheck { ready?: string | null; hostUpdate?: boolean; error?: string | null }

export interface SpotifyObserved {
  /** the bearer: the Deno host's page has it; the Tauri host keeps it and says only hasToken */
  token?: string;
  hasToken?: boolean;
  at?: number;
  clientToken?: string;
  loggedIn?: boolean;
  expiresAt?: number;
  clientId?: string;
  deviceId?: string;
  activeDeviceId?: string;
  connectionId?: string;
  spclient?: string;
  hashes?: Record<string, string>;
  state?: unknown;
  cluster?: unknown;
  devices?: unknown;
}

declare global {
  interface Window {
    alchemyEngine?: string;
    /** the host's log (the Deno host's, the iOS app's): a line, no answer */
    alchemyLog?: (line: string) => void;
    alchemyRoot?: ShadowRoot | Document;
    alchemyElectron?: { loopback?: boolean; mode?: string };
    alchemyScreensaver?: { audio?: boolean; url?: string };
    alchemyMarks?: string[];
    alchemyWinDrag?: () => void;
    alchemyWinMin?: () => void;
    alchemyWinMax?: () => void;
    alchemyWinClose?: () => void;
    alchemyWinSize?: () => void;
    alchemyWinFull?: (on: boolean) => void;
    /** the host draws the window's title bar itself (the Tauri host on Windows): the page hides its own */
    alchemyNativeTitle?: boolean;
    /** set by the ticker; the desktop host calls it when its window stops or starts being seen */
    alchemyOccluded?: (on: boolean) => void;
    alchemySpotifyLogout?: () => void;
    /** the iOS app: the skin's volume (0..100, 0 = muted) as the phone's system volume, since a
     *  page cannot change its own playback volume there */
    alchemySetVolume?: (pct: number) => void;
    /** the iOS app: the web view edge to edge ('edge') or inside the safe area ('safe'); the insets
     *  come as window.__wmpSafeArea with a 'wmp-safe-area' event */
    alchemyLayout?: (mode: 'edge' | 'safe') => void;
    /** the iOS app: its log sheet */
    alchemyShowLog?: () => void;
    /** the iOS app, for a click-wheel skin: a haptic ('selection' for a detent; 'light'|'medium'|
     *  'heavy'|'rigid'|'soft'; 'success'|'warning'|'error'; 'prepare' warms the tick) */
    alchemyHaptic?: (kind?: string) => void;
    /** the iOS app: keep the screen awake */
    alchemyAwake?: (on: boolean) => void;
    /** the iOS app: the status bar */
    alchemyStatusBar?: (hidden: boolean) => void;
    /** the iOS app: the orientations allowed */
    alchemyOrientation?: (mode: 'portrait' | 'landscape' | 'any') => void;
    /** the iOS app: its broadcast (the app's audio): 'picker' opens iOS's start/stop sheet,
     *  'auto'|'manual' whether the app opens it at launch, 'state' asks for __wmpBroadcast now */
    alchemyBroadcast?: (cmd: 'picker' | 'auto' | 'manual' | 'state') => void;
    /** the iOS app: whether a broadcast feeds it, with a 'wmp-broadcast' event on each change */
    __wmpBroadcast?: { running: boolean };
    /** the iOS app: ask for every report below at once ('wmp-host' and the rest follow) */
    alchemyHost?: () => void;
    /** the iOS app: the screen's brightness, set (0..1) or asked for (no argument) */
    alchemyBrightness?: (v?: number) => void;
    /** the iOS app: the share sheet for a text or URL */
    alchemyShare?: (text: string) => void;
    /** the iOS app: the home indicator, for an edge-to-edge skin */
    alchemyHomeIndicator?: (hidden: boolean) => void;
    /** the iOS app: the app's page in Settings */
    alchemyOpenSettings?: () => void;
    /** the iOS app: clear the web view's data and reload (a full sign-out) */
    alchemyReset?: () => void;
    /** the iOS app's reports, each with a window event of the same name: 'wmp-volume',
     *  'wmp-battery', 'wmp-route', 'wmp-brightness', 'wmp-host'; and 'wmp-shake' with no global */
    __wmpVolume?: number;
    __wmpBattery?: { level: number; charging: boolean };
    __wmpRoute?: { name: string; type: string };
    __wmpBrightness?: number;
    __wmpHost?: { build: string; version: string; ios: string; model: string; scale?: number; fps?: number; voiceOver?: boolean; viewport?: string };
    /** the iOS app, the rest of the phone (ios/README.md) */
    alchemyViewport?: (mode: 'mobile' | 'desktop') => void;
    alchemyHapticPattern?: (events: { t: number; i: number; s: number; d?: number }[]) => void;
    alchemySound?: (id?: number) => void;
    alchemyRoutePicker?: () => void;
    alchemyAudioSession?: (mode: 'solo' | 'mix' | 'duck') => void;
    alchemyNotify?: (n: { title: string; body: string; seconds: number; id: string } | `cancel:${string}`) => void;
    alchemyAppearance?: (mode: 'light' | 'dark' | 'auto') => void;
    alchemyClipboard?: (text: string) => void;
    /** the iOS app: the proximity sensor's report on (the screen blanks while it is covered) */
    alchemyProximity?: (on: boolean) => void;
    /** the iOS app: the host's log band (safe-area layout), the backdrop color, keyboard avoidance,
     *  native scrolling of the page */
    alchemyBand?: (hidden: boolean) => void;
    alchemyBackground?: (hex: string) => void;
    alchemyKeyboard?: (avoid: boolean) => void;
    alchemyScroll?: (on: boolean) => void;
    __wmpProximity?: boolean;
    __wmpLowPower?: boolean;
    __wmpThermal?: 'nominal' | 'fair' | 'serious' | 'critical';
    __wmpScene?: 'active' | 'inactive' | 'background';
    __wmpKeyboard?: number;
    /** this page's build (a git sha from CI, or 'dev'), for the iOS observer's update check */
    __wmpPageBuild?: string;
    __wmpSafeArea?: { top: number; right: number; bottom: number; left: number };
    /** a newer exe is out (tauri/src/update.rs): offer the download */
    alchemyHostUpdate?: boolean;
    /** open one of the project's own URLs in the user's browser */
    alchemyOpenUrl?: (url: string) => void;
    /** relaunch the app (a checked page update is cached for the next launch) */
    alchemyRestart?: () => void;
    /** the Tauri host's page-update check (the Deno host answered /update on its worker instead) */
    alchemyCheckUpdate?: () => Promise<HostCheck>;
    __wmpSpotify?: SpotifyObserved;
    /** the Tauri host's IPC (withGlobalTauri): what the Spotify bridge uses of it */
    __TAURI__?: {
      core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
      event: { listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> };
    };
  }
}
export {};

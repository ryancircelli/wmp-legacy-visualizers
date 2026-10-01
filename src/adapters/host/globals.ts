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

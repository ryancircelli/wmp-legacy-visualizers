// The window globals the hosts set (CONTRACT.md v1–v8; deno-webview/main.ts, spotify.ts, tauri/).
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
    /** set by the ticker; the desktop host calls it when its window stops or starts being seen */
    alchemyOccluded?: (on: boolean) => void;
    alchemySpotifyLogout?: () => void;
    /** a newer exe is out (deno-webview/update.ts): offer the download */
    alchemyHostUpdate?: boolean;
    /** open one of the project's own URLs in the user's browser */
    alchemyOpenUrl?: (url: string) => void;
    /** relaunch the app (a checked page update is cached for the next launch) */
    alchemyRestart?: () => void;
    __wmpSpotify?: SpotifyObserved;
    /** the Tauri host's IPC (withGlobalTauri): what the Spotify bridge uses of it */
    __TAURI__?: {
      core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
      event: { listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> };
    };
  }
}
export {};

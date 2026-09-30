// The window globals the hosts set (CONTRACT.md v1–v6.1; deno-webview/main.ts, spotify.ts).
/** Help > Check for Player Updates, as the host answers it (deno-webview/update.ts, tauri/src/update.rs) */
export interface HostCheck { ready?: string | null; hostUpdate?: boolean; error?: string | null }

export interface SpotifyObserved {
  token?: string;
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
    /** the Tauri host's page-update check (the Deno host answers /update on its worker instead) */
    alchemyCheckUpdate?: () => Promise<HostCheck>;
    __wmpSpotify?: SpotifyObserved;
  }
}
export {};

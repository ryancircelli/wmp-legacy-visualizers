// How the Spotify adapter reaches the web player, and all that differs between the two hosts:
//   in-page (the Deno host, CONTRACT.md v6.1): this page is an overlay inside open.spotify.com,
//     whose injected script keeps window.__wmpSpotify and fires the wmp-spotify-* events;
//   bridge (the Tauri host, CONTRACT.md v8, bridge.ts): Spotify's page is a web view of its own
//     that the host watches and runs our requests in; the bridge keeps the same window object and
//     fires the same events from what the host reports.
// Everything else in src/adapters/spotify is shared.
import '../host/globals';
import { bridge } from './bridge';

export interface Reply { status: number; text: string; retryAfter: string | null }

export interface Transport {
  /** the web player has a bearer (the page's own, or the host's) */
  authed(): boolean;
  /** One request to Spotify's API hosts with the web player's credentials (bearer, client-token
   *  and whatever the transport adds). status 0 = no bearer yet; rejects when offline, as fetch. */
  request(url: string, method: string, body: string | undefined, headers: Record<string, string>): Promise<Reply>;
  /** [op, sha] declared by the scripts the web player loaded (in-page: those not in `read` yet). */
  scan(read: Record<string, true>): Promise<[string, string][]>;
  /** Send the web player to one of its routes ('/search'): it loads that route's script chunk. */
  route(path: string): Promise<void>;
  /** One of the web player's cookies (sp_t, which home's variables carry). */
  cookie(name: string): Promise<string>;
  /** Logged in: our player shows; otherwise Spotify's own page (its login). */
  show(on: boolean): void;
  canLogout(): boolean;
  logout(): void;
  /** Start following the host; returns the stop. */
  start(): () => void;
}

/** How the bundles declare an operation: "<name>","query"|"mutation","<sha256>". */
const OP_RE = /"([A-Za-z0-9_]+)"\s*,\s*"(query|mutation)"\s*,\s*"([0-9a-f]{64})"/g;

/** Every script the page has loaded: document.scripts, plus lazy chunks (xpui-routes-search.*.js)
 *  that only show up as resource timing entries. */
function scriptUrls(): string[] {
  const out = new Set<string>();
  const add = (u: string) => { if (u && /\.js(\?|$)/.test(u)) out.add(u); };
  for (const s of Array.from(document.scripts ?? [])) add(s.src);
  for (const e of performance.getEntriesByType?.('resource') ?? []) {
    if ((e as PerformanceResourceTiming).initiatorType === 'script') add(e.name);
  }
  return [...out];
}

let under: CSSStyleSheet | null = null;

export const inPage: Transport = {
  authed: () => !!window.__wmpSpotify?.token,
  async request(url, method, body, headers) {
    const w = window.__wmpSpotify || {};
    if (!w.token) return { status: 0, text: '', retryAfter: null };
    const h: Record<string, string> = { Authorization: 'Bearer ' + w.token, ...headers };
    if (w.clientToken) h['client-token'] = w.clientToken;
    const init: RequestInit = { method, headers: h };
    if (body !== undefined) init.body = body;
    const r = await fetch(url, init);
    return { status: r.status, text: await r.text(), retryAfter: r.headers.get('Retry-After') };
  },
  async scan(read) {
    const found = await Promise.all(scriptUrls().filter((u) => !read[u]).map(async (u) => {
      read[u] = true;
      try {
        return [...(await (await fetch(u)).text()).matchAll(OP_RE)].map((m) => [m[1]!, m[3]!] as [string, string]);
      } catch { return []; /* unreadable: skip */ }
    }));
    return found.flat();
  },
  // the web player's router listens to popstate
  route(path) {
    history.pushState(history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state as unknown }));
    return Promise.resolve();
  },
  // the page's own cookie (an opaque origin throws on document.cookie)
  cookie(n) {
    let c = '';
    try { c = document.cookie || ''; } catch { /* opaque origin */ }
    const m = new RegExp('(?:^|; )' + n + '=([^;]*)').exec(c);
    return Promise.resolve(m ? decodeURIComponent(m[1]!) : '');
  },
  /** The overlay (#wmp-root, outside the shadow root) over Spotify's page, or Spotify's page. */
  show(on) {
    const h = document.getElementById('wmp-root');
    if (h) h.style.display = on ? '' : 'none';
    // Spotify's own page is not rendered while the overlay covers it: its app, sockets and playback
    // run on, only its style, layout and paint stop (display:none; content-visibility and visibility
    // were measured to leave its animations ticking).
    try {
      if (!under) document.adoptedStyleSheets = [...document.adoptedStyleSheets, (under = new CSSStyleSheet())];
      under.replaceSync(on ? 'body > :not(#wmp-root) { display: none !important; }' : '');
    } catch { /* no constructed sheets: it keeps drawing under us */ }
  },
  // File > Log Out: the host's binding lands on the login page (CONTRACT v6)
  canLogout: () => typeof window.alchemySpotifyLogout === 'function',
  logout() { window.alchemySpotifyLogout?.(); },
  start: () => () => {},
};

/** The Tauri host exposes its IPC as window.__TAURI__ (withGlobalTauri); the Deno host and the
 *  website have none. */
export const transport = (): Transport => (window.__TAURI__ ? bridge : inPage);

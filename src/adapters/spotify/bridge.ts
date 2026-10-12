// The Tauri host's transport (CONTRACT.md v8; tauri/src/spotify). Spotify's web player runs in a
// web view of its own that the host watches through the DevTools Protocol. The host reports what
// it saw as events and runs our requests inside the web player with its credentials; the bearer
// never comes to this page. What it reports is kept as window.__wmpSpotify with the same
// wmp-spotify-* events the Deno host's injected script fired, from the same rules (the cluster
// and device parts below are its spotify.ts's), so the adapter above reads one shape.
import '../host/globals';
import type { Device } from '../../model';
import type { SpotifyObserved } from '../host/globals';
import type { Reply, Transport } from './transport';

/** What sp_snapshot answers: everything the host has seen so far. */
interface Snapshot {
  loggedIn: boolean | null; hasToken: boolean; deviceId: string | null; hobs: string | null; spclient: string | null;
  hashes: Record<string, string>; scanned: Record<string, string>; cluster: unknown;
}
interface Ids { deviceId: string | null; hobs: string | null; spclient: string | null }
interface Cluster {
  active_device_id?: string;
  player_state?: unknown;
  devices?: Record<string, { name?: string; device_type?: string; volume?: number; is_offline?: boolean } | null>;
}

let W: SpotifyObserved = {};
let scanned: Record<string, string> = {};
/** our device id's first hex digits, as connect-state's URL has them, until the full id is known */
let hobs: string | null = null;
/** device id -> the last real name a cluster gave it */
let names: Record<string, string> = {};

const T = () => window.__TAURI__!;
const emit = (n: string, d: unknown) => window.dispatchEvent(new CustomEvent(n, { detail: d }));

function auth(a: { loggedIn: boolean | null; hasToken: boolean }): void {
  W.hasToken = a.hasToken;
  const li = typeof a.loggedIn === 'boolean' ? a.loggedIn : undefined;
  if (li !== W.loggedIn) { W.loggedIn = li; emit('wmp-spotify-auth', { loggedIn: li }); }
}

function hash(h: { op: string; sha: string; scanned: boolean }): void {
  if (h.scanned) { scanned[h.op] = h.sha; return; }
  (W.hashes ??= {})[h.op] = h.sha;
  emit('wmp-spotify-hash', { op: h.op, sha: h.sha });
}

function device(d: Ids): void {
  hobs = d.hobs;
  if (d.spclient) W.spclient = d.spclient;
  // a new registration drops an id that does not match it; the cluster resolves the prefix
  W.deviceId = d.deviceId || (hobs && W.deviceId?.startsWith(hobs) ? W.deviceId : undefined);
}

function cluster(c: Cluster | null): void {
  if (!c || typeof c !== 'object') return;
  // Idle (nothing playing anywhere): Spotify omits active_device_id; "" then, never a stale id.
  W.activeDeviceId = c.active_device_id || '';
  if (c.devices) {
    // Names are kept by the full key Spotify uses: the registration answer keys Alexa speakers
    // "<id>_amzn_1", "<id>_amzn_2", while dealer pushes key and name them by the bare "<id>". A bare
    // key whose full keys are known is listed once per full key.
    const devs = c.devices, keys = Object.keys(devs), list: Device[] = [];
    for (const k of keys) { const d = devs[k]; if (d?.name && d.name !== k) names[k] = d.name; }
    for (const k of keys) {
      const d = devs[k] ?? {};
      const full = Object.keys(names).filter((nk) => nk.startsWith(k + '_') && !(nk in devs));
      for (const id of names[k] || !full.length ? [k] : full) {
        list.push({ id, name: names[id] || (d.name && d.name !== k ? d.name : '') || id, type: d.device_type || '',
                    active: id === W.activeDeviceId || k === W.activeDeviceId,
                    volume: typeof d.volume === 'number' ? d.volume : undefined, offline: !!d.is_offline });
      }
    }
    W.devices = list;
    emit('wmp-spotify-devices', list);
  }
  if (!c.player_state) return;
  W.cluster = c;
  if (!W.deviceId && hobs) for (const k of Object.keys(c.devices ?? {})) if (k.startsWith(hobs)) W.deviceId = k;
  W.state = c.player_state;
  emit('wmp-spotify-state', c.player_state);
}

export const bridge: Transport = {
  authed: () => !!W.hasToken,
  request: (url, method, body, headers) => T().core.invoke<Reply>('sp_request', { url, method, body, headers }),
  scan: () => Promise.resolve(Object.entries(scanned)),   // the host reads every script it loads
  route: (path) => T().core.invoke<void>('sp_route', { path }),
  cookie: (name) => T().core.invoke<string>('sp_cookie', { name }),
  show: () => {},            // the host shows Spotify's page itself when it needs the user
  canLogout: () => true,
  logout() { void T().core.invoke('sp_logout'); },
  start() {
    W = window.__wmpSpotify = { hashes: {} };
    scanned = {}; hobs = null; names = {};
    const on = <P>(e: string, f: (p: P) => void) => T().event.listen<P>(e, (ev) => f(ev.payload));
    const offs = [on('sp:auth', auth), on('sp:hash', hash), on('sp:device', device), on('sp:cluster', cluster)];
    void Promise.all(offs).then(() => T().core.invoke<Snapshot>('sp_snapshot')).then((s) => {
      device(s);
      for (const [op, sha] of Object.entries(s.hashes)) hash({ op, sha, scanned: false });
      for (const [op, sha] of Object.entries(s.scanned)) hash({ op, sha, scanned: true });
      cluster(s.cluster as Cluster | null);
      auth(s);
    }).catch(() => { /* no host: nothing will come */ });
    return () => { for (const o of offs) void o.then((off) => off()); };
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// A fake Spotify page for the adapters: fetch routes, a clock, resource timing, history, the
// host's window.__wmpSpotify and its events, and a fake host socket (what the page sends it).
import raw from './fixtures/spotify-fixtures.json?raw';
import { vi } from 'vitest';
import { createAppStore, DEFAULTS, type AppStore, type Settings } from '../../src/model';

export const FX: any = JSON.parse(raw);
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const SCRIPT = 'https://open.spotifycdn.com/cdn/build/web-player/web-player.abc.js';
export const CHUNK = 'https://open.spotifycdn.com/cdn/build/web-player/xpui-routes-search.def.js';
export const T0 = 1790279838059 + 5000;          // 5 s after the sample player_state's timestamp
export const ME = 'd'.repeat(40);

export async function settle(): Promise<void> {
  const immediate = (globalThis as unknown as { setImmediate: (f: () => void) => void }).setImmediate;
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => immediate(() => r()));
}
/** A bundle body declaring operations the way web-player.*.js does. */
export const bundle = (ops: Record<string, string>) =>
  'x=1;' + Object.keys(ops).map((k) => `new r.l("${k}","query","${ops[k]}",null)`).join(';');

export interface Call { url: string; method: string; headers: Record<string, string>; body: any }
type Reply = { status: number; json?: unknown; body?: string; headers?: Record<string, string | number>; delay?: Promise<unknown> } | Error;

export class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  binaryType = '';
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; this.onclose?.(); }
  /** the host sends a JSON text frame */
  host(o: object) { this.onmessage?.({ data: JSON.stringify(o) }); }
}

export function mkEnv(W: Record<string, unknown> = {}, settings: Partial<Settings> = {}) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  const calls: Call[] = [], routes: [RegExp, (url: string, init: any) => Reply][] = [], resources: object[] = [];
  const pushed: string[] = [];
  window.__wmpSpotify = { token: 'TOK', clientToken: 'CT', deviceId: ME, activeDeviceId: FX.activeDeviceId, hashes: {}, ...W };
  window.alchemyEngine = 'spotify';
  window.alchemyScreensaver = { audio: true, url: 'ws://127.0.0.1:1/audio' };
  delete window.alchemySpotifyLogout;
  document.body.innerHTML = '<div id="wmp-root"></div>';
  Object.defineProperty(document, 'scripts', { configurable: true, value: [{ src: SCRIPT }, { src: '' }] });
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => resources as PerformanceEntryList);
  vi.spyOn(history, 'pushState').mockImplementation((_s, _t, u) => { pushed.push(String(u)); });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const i: any = init || { method: 'GET', headers: {} };
    calls.push({ url, method: i.method, headers: i.headers, body: i.body && JSON.parse(String(i.body)) });
    for (const [re, fn] of routes) if (re.test(url)) {
      const r = fn(url, i);
      if (r instanceof Error) return Promise.reject(r);
      const text = typeof r.body === 'string' ? r.body : r.json === undefined ? '' : JSON.stringify(r.json);
      return Promise.resolve({ status: r.status, headers: { get: (k: string) => (r.headers?.[k] == null ? null : String(r.headers[k])) },
                               text: () => (r.delay ?? Promise.resolve()).then(() => text) });
    }
    return Promise.resolve({ status: 404, headers: { get: () => null }, text: () => Promise.resolve('') });
  });
  const store: AppStore = createAppStore({ persist: false, settings: { ...DEFAULTS, ...settings } });
  return {
    store, calls, resources, pushed,
    get S() { return store.getState(); },
    get C() { return store.getState().commands; },
    route(re: RegExp, fn: Reply | ((url: string, init: any) => Reply)) { routes.unshift([re, typeof fn === 'function' ? fn : () => fn]); },
    fire(type: string, detail: unknown) { window.dispatchEvent(new CustomEvent(type, { detail })); },
    host: () => document.getElementById('wmp-root')!,
    pf: () => calls.filter((c) => /pathfinder/.test(c.url)),
    cmds: () => calls.filter((c) => /player\/command/.test(c.url)).map((c) => c.body.command),
    sent: () => FakeSocket.last?.sent ?? [],
  };
}

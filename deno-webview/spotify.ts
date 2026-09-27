// The Spotify engine's document-created script (CONTRACT.md v6): Spotify's own web player runs in
// the WebView2, and this puts our player on top of it.
//
// Everything here runs inside open.spotify.com's document, under its CSP. That CSP (measured
// 2026-09-24) is a header with `script-src` and `frame-ancestors` only, so: our JS is the injected
// script itself (a <script> element or eval would need script-src), styles are a constructed sheet
// (never a style-src question), and the page's own fetches/WebSockets are not restricted.

export const SPOTIFY_HOST = "open.spotify.com";

/** What this window is called in Spotify Connect (the web player would say "Web Player (Microsoft Edge)"). */
export const DEVICE_NAME = "WMP Spotify";

/** dist/spotify-inject.js, emitted by `npm run build`: `html` is the mount node, `css` every style
 * (CSS Modules included), `js` the page as one classic IIFE script (no import/export). */
export type Bundle = { html: string; css: string; js: string };

/**
 * The whole injected script. `common` is the host's own per-document setup (flags, marks, report —
 * main.ts initScript), run only on open.spotify.com, after the guard and before our JS.
 *
 * Order on open.spotify.com:
 *   1. at document creation: fetch/XHR/WebSocket observed (window.__wmpSpotify, events), `common` runs;
 *   2. at DOMContentLoaded (document.body exists): #wmp-root + open shadow root mounted, sheet
 *      adopted, html set, window.alchemyEngine/alchemyRoot set, then `js` runs synchronously.
 * A token can arrive before step 2 (the page's first API calls start early): our JS must read
 * window.__wmpSpotify first and then listen for "wmp-spotify-token".
 */
/**
 * Dev mode (`--dev`, CONTRACT.md "dev-only"): the bundle is fetched from the host's worker at mount
 * time instead of being baked into the script, and a socket from the worker says what changed —
 * `{"type":"devCss","css"}` swaps the adopted sheet's text in place, `{"type":"devReload"}` reloads
 * the document (this script then fetches the new bundle; the login is untouched).
 */
export type Dev = { bundle: string; socket: string; cssSuffix: string };

/** What a rebuilt bundle needs: nothing, a CSS swap in place, or a reload for new markup/script. */
export function devChange(prev: Bundle | null, next: Bundle): "none" | "css" | "reload" {
  if (!prev || prev.js !== next.js || prev.html !== next.html) return "reload";
  return prev.css === next.css ? "none" : "css";
}

export function spotifyScript(b: Bundle, common = "", dev: Dev | null = null): string {
  const J = JSON.stringify;
  return `(function () {
  if (location.hostname !== ${J(SPOTIFY_HOST)} || window.top !== window) return;
  var log = function (m) { try { window.alchemyLog('spotify: ' + m); } catch (e) {} };

  // ---- 1. observers on the web player's own channels (never its DOM). Everything lands in
  // window.__wmpSpotify; each change is also a CustomEvent on window:
  //   wmp-spotify-token {token} · wmp-spotify-auth {loggedIn} · wmp-spotify-hash {op, sha}
  //   wmp-spotify-state = the last connect-state player_state · wmp-spotify-devices = W.devices
  var W = window.__wmpSpotify = { token: null, at: 0, clientToken: null, loggedIn: null, expiresAt: 0,
    clientId: null, deviceId: null, activeDeviceId: '', connectionId: null, hashes: {}, state: null,
    cluster: null, spclient: null, devices: [] };
  // Chromium keeps 250 resource timing entries by default and the web player passes that within
  // seconds of load (measured: exactly 250), so lazy chunks such as xpui-routes-search.*.js would
  // never appear to the page's hash scan.
  try { performance.setResourceTimingBufferSize(100000); } catch (e) {}
  var hobs = null;
  var names = {}; // device id -> the last real name a cluster gave it // our device id's first 35 hex digits, until the full 40 are known
  function emit(n, d) { window.dispatchEvent(new CustomEvent(n, { detail: d })); }
  var API = /^https:\\/\\/(api|api-partner|[a-z0-9-]*spclient[a-z0-9.-]*)\\.spotify\\.com\\//;
  function hdr(h, name) {
    if (!h) return null;
    if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name);
    if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) if (String(h[i][0]).toLowerCase() === name) return h[i][1]; return null; }
    for (var k in h) if (k.toLowerCase() === name) return h[k];
    return null;
  }
  function seenHeader(url, name, v) {
    if (!v || !API.test(String(url))) return;
    if (name === 'authorization') {
      var m = /^Bearer\\s+(\\S+)/i.exec(v);
      if (!m || m[1] === W.token) return; // the page's own calls repeat the same token: once each
      W.token = m[1]; W.at = Date.now();
      emit('wmp-spotify-token', { token: W.token });
    } else if (name === 'client-token' && v !== W.clientToken) {
      W.clientToken = v;
    }
  }
  function seenHash(op, sha) {
    if (!op || !/^[0-9a-f]{64}$/.test(sha || '') || W.hashes[op] === sha) return;
    W.hashes[op] = sha;
    emit('wmp-spotify-hash', { op: op, sha: sha });
  }
  function seenRequest(url, body) {
    url = String(url);
    if (/\\/pathfinder\\/v\\d\\/query/.test(url)) {
      try {
        var q = new URL(url).searchParams, j = q.get('extensions') ? { operationName: q.get('operationName'),
          extensions: JSON.parse(q.get('extensions')) } : JSON.parse(body);
        seenHash(j.operationName, j.extensions.persistedQuery.sha256Hash);
      } catch (e) {}
    }
    // Our device: the full id is in track-playback's registration body; connect-state's URL only
    // carries "hobs_" + its first 35 hex digits (measured), resolved against the cluster below.
    if (/\\/track-playback\\/v1\\/devices$/.test(url) && body) {
      try {
        var full = JSON.parse(body).device.device_id;
        if (/^[0-9a-f]{40}$/.test(full)) W.deviceId = full;
      } catch (e) {}
    }
    var d = /^https:\\/\\/([a-z0-9.-]*spclient[a-z0-9.-]*\\.spotify\\.com)\\/connect-state\\/v1\\/devices\\/hobs_([0-9a-f]+)/.exec(url);
    if (d) {
      W.spclient = d[1];
      // A new registration (every page load makes one) replaces an id that does not match it.
      hobs = d[2];
      if (W.deviceId && W.deviceId.indexOf(hobs) !== 0) W.deviceId = null;
    }
  }
  function seenCluster(c) {
    if (!c || typeof c !== 'object') return;
    // Idle (nothing playing anywhere): Spotify omits active_device_id entirely (measured 2026-09-24,
    // the devices PUT answer after a window was closed mid-play) while still sending the last
    // player_state. "" then, never a stale id: the page shows such a state as paused.
    W.activeDeviceId = c.active_device_id || '';
    // Play on Device: every cluster carries the account's Connect devices (spike 3 for the shape).
    if (c.devices) {
      // Names are kept by the FULL key Spotify uses. The registration answer keys Alexa speakers
      // "<id>_amzn_1", "<id>_amzn_2" (a speaker and its "Everywhere" group share the id), while
      // dealer pushes key them by the bare "<id>" and name them by it (measured). A bare key whose
      // full keys are known is listed once per full key, so the group and the speaker stay two
      // entries with the ids Spotify gave them (the transfer uses these ids).
      var keys = Object.keys(c.devices);
      keys.forEach(function (k) { var d = c.devices[k] || {}; if (d.name && d.name !== k) names[k] = d.name; });
      W.devices = [];
      keys.forEach(function (k) {
        var d = c.devices[k] || {};
        var full = Object.keys(names).filter(function (nk) { return nk.indexOf(k + '_') === 0 && !(nk in c.devices); });
        (names[k] || !full.length ? [k] : full).forEach(function (id) {
          W.devices.push({ id: id, name: names[id] || (d.name && d.name !== k ? d.name : '') || id,
            type: d.device_type || '', active: id === W.activeDeviceId || k === W.activeDeviceId,
            volume: typeof d.volume === 'number' ? d.volume : null, offline: !!d.is_offline });
        });
      });
      emit('wmp-spotify-devices', W.devices);
    }
    if (!c.player_state) return;
    W.cluster = c;
    // W.deviceId is only ever a full 40-hex id: resolved here, before the state event goes out.
    if (!W.deviceId && hobs) {
      Object.keys(c.devices || {}).forEach(function (k) { if (k.indexOf(hobs) === 0) W.deviceId = k; });
    }
    W.state = c.player_state;
    emit('wmp-spotify-state', c.player_state);
  }
  function seenResponse(url, res) {
    url = String(url);
    if (/^https:\\/\\/open\\.spotify\\.com\\/api\\/token/.test(url)) {
      res.clone().json().then(function (j) {
        W.clientId = j.clientId || null;
        W.expiresAt = j.accessTokenExpirationTimestampMs || 0;
        if (j.accessToken && j.accessToken !== W.token) { W.token = j.accessToken; W.at = Date.now(); emit('wmp-spotify-token', { token: W.token }); }
        var li = j.isAnonymous === false;
        if (li !== W.loggedIn) { W.loggedIn = li; emit('wmp-spotify-auth', { loggedIn: li }); }
      }).catch(function () {});
    } else if (/\\/connect-state\\/v1\\/devices\\//.test(url) && res.ok) {
      res.clone().json().then(seenCluster).catch(function () {}); // the PUT answers with the cluster
    }
  }
  var ofetch = window.fetch;
  // Our device's name in Spotify Connect (the phone's picker, the cluster's device list): the
  // page registers itself as "Web Player (<browser>)"; the registration bodies are renamed on
  // their way out. Only a body that parses and has the name where it is expected is touched.
  var DEVICE_NAME = ${J(DEVICE_NAME)};
  function renamed(url, body) {
    if (typeof body !== 'string' || !/\\/(connect-state\\/v1\\/devices\\/hobs_|track-playback\\/v1\\/devices)/.test(String(url))) return body;
    try {
      var j = JSON.parse(body), d = j && j.device, hit = false;
      if (d && d.device_info && typeof d.device_info.name === 'string') { d.device_info.name = DEVICE_NAME; hit = true; }
      if (d && typeof d.name === 'string') { d.name = DEVICE_NAME; hit = true; }
      return hit ? JSON.stringify(j) : body;
    } catch (e) { return body; }
  }
  window.fetch = function (input, init) {
    var url = '';
    try {
      var u0 = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input && input.url || input);
      var b0 = init && init.body, b1 = renamed(u0, b0);
      if (b1 !== b0) init = Object.assign({}, init, { body: b1 });
    } catch (e) {}
    try {
      var req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      url = req ? req.url : String(input && input.url || input);
      var h = init && init.headers;
      ['authorization', 'client-token'].forEach(function (n) { seenHeader(url, n, hdr(h, n) || (req && req.headers.get(n))); });
      seenRequest(url, init && typeof init.body === 'string' ? init.body : null);
    } catch (e) {}
    var args = [].slice.call(arguments);
    if (init !== args[1] && init) args[1] = init; // the renamed registration
    var p = ofetch.apply(this, args);
    p.then(function (r) { try { seenResponse(url, r); } catch (e) {} }, function () {});
    return p;
  };
  var XO = XMLHttpRequest.prototype.open, XH = XMLHttpRequest.prototype.setRequestHeader,
    XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__wmpUrl = url; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { seenHeader(this.__wmpUrl, String(k).toLowerCase(), v); } catch (e) {}
    return XH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try { body = renamed(this.__wmpUrl, body); } catch (e) {}
    try { seenRequest(this.__wmpUrl, typeof body === 'string' ? body : null); } catch (e) {}
    return XS.call(this, body);
  };
  // The dealer socket (wss://*dealer*.spotify.com) pushes hm://connect-state/v1/cluster on every
  // player change. Payloads are JSON or base64 (gzip when headers say so).
  function payload(m) {
    var p = m.payloads && m.payloads[0];
    if (p == null) return Promise.resolve(null);
    if (typeof p === 'object') return Promise.resolve(p);
    var bin = Uint8Array.from(atob(p), function (c) { return c.charCodeAt(0); });
    var gz = m.headers && /gzip/i.test(m.headers['Transfer-Encoding'] || '');
    var s = gz ? new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : Promise.resolve(new TextDecoder().decode(bin));
    return s.then(JSON.parse);
  }
  function dealer(ws) {
    ws.addEventListener('message', function (e) {
      if (typeof e.data !== 'string') return;
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.headers && m.headers['Spotify-Connection-Id']) W.connectionId = m.headers['Spotify-Connection-Id'];
      if (m.type === 'message' && /^hm:\\/\\/connect-state\\/v1\\/cluster/.test(m.uri || '')) {
        payload(m).then(function (j) { seenCluster(j && (j.cluster || j)); }).catch(function () {});
      }
    });
  }
  var OWS = window.WebSocket;
  var WS = function WebSocket(url, protocols) {
    var ws = protocols === undefined ? new OWS(url) : new OWS(url, protocols);
    try { if (/^wss:\\/\\/[^/]*dealer[^/]*\\.spotify\\.com\\//.test(String(url))) dealer(ws); } catch (e) {}
    return ws;
  };
  WS.prototype = OWS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WS[k] = OWS[k]; });
  window.WebSocket = WS;

${common}

  // ---- 2. the overlay, once there is a body to put it in
  var DEV = ${J(dev)};
  function mount(B) {
    if (document.getElementById('wmp-root')) return;
    var host = document.createElement('div');
    host.id = 'wmp-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    var root = host.attachShadow({ mode: 'open' });
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(B ? B.css + DEV.cssSuffix : ${J(b.css)});
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = B ? B.html : ${J(b.html)};
    document.body.appendChild(host);
    window.alchemyEngine = 'spotify';
    window.alchemyRoot = root;
    log('overlay mounted' + (B ? ' (dev bundle)' : ''));
    if (DEV) devSocket(sheet);
    if (B) {
      // Dev only: the bundle arrives as text at run time, which open.spotify.com's CSP allows
      // ('unsafe-eval'); the release build runs it as part of this script (below).
      (0, eval)('(function () {"use strict";\\n' + B.js + '\\n})()');
      return;
    }
    (function () {
      "use strict";
${b.js}
    })();
  }
  function devSocket(sheet) {
    var ws = new WebSocket(DEV.socket);
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.type === 'devCss') { sheet.replaceSync(m.css + DEV.cssSuffix); log('dev: css swapped'); }
      else if (m.type === 'devReload') { log('dev: reload'); location.reload(); }
    };
  }
  function go() {
    if (!DEV) { try { mount(null); } catch (e) { log('mount failed: ' + (e && e.stack || e)); } return; }
    window.fetch(DEV.bundle, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (B) {
      try { mount(B); } catch (e) { log('mount failed: ' + (e && e.stack || e)); }
    }, function (e) { log('dev bundle unavailable (' + e + '), using the built-in one'); mount(null); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();`;
}

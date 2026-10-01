// The iOS app's user script (CONTRACT.md v6.1): Spotify's own web player runs in the WKWebView, and
// this puts our player on top of it. App.swift wraps it as
//   (function (HTML, CSS, RUN) { <this file> })(<bundle.html>, <bundle.css>, function () { <bundle.js> });
// with dist/spotify-inject.js fetched from wmp.ryancircelli.com, and injects it at document start
// in the main frame. It is the retired Deno host's spotify.ts (git history, deno-webview/) with the
// host bindings that Swift cannot provide answered in-page.
//
// Everything here runs inside open.spotify.com's document, under its CSP. That CSP (measured
// 2026-09-24) is a header with `script-src` and `frame-ancestors` only, so: our JS is this script
// itself (a <script> element or eval would need script-src), styles are a constructed sheet (never a
// style-src question), and the page's own fetches/WebSockets are not restricted.
//
// Order on open.spotify.com:
//   1. at document creation: fetch/XHR/WebSocket observed (window.__wmpSpotify, events);
//   2. as soon as document.body exists (DOMContentLoaded waits seconds more for Spotify's own
//      scripts): #wmp-root + open shadow root mounted, sheet adopted, HTML set,
//      window.alchemyEngine/alchemyRoot set, then RUN() runs synchronously.
// A token can arrive before step 2: our JS reads window.__wmpSpotify first and then listens for
// "wmp-spotify-token".
if (location.hostname !== 'open.spotify.com' || window.top !== window) return;
var SPOTIFY_LOGIN = 'https://accounts.spotify.com/login?continue=' + encodeURIComponent('https://open.spotify.com/');
var SPOTIFY_LOGOUT = 'https://accounts.spotify.com/logout?continue=' + encodeURIComponent(SPOTIFY_LOGIN);
// What this app is called in Spotify Connect (the web player would say "Web Player (Safari)").
var DEVICE_NAME = 'WMP Spotify';

// ---- the host bindings (CONTRACT.md v4-v6) this host answers in-page
window.alchemyLog = function (m) { try { webkit.messageHandlers.log.postMessage(String(m)); } catch (e) {} };
var log = function (m) { window.alchemyLog('spotify: ' + m); };
// An app, not the website: no share picker, and no microphone. The audio is the host's "socket"
// (CONTRACT v8's frames), but no socket in the page: WebKit refuses ws:// from Spotify's https page
// (measured, build 6), so the WebSocket wrapper below answers this one URL with a stand-in that
// App.swift feeds by evaluateJavaScript, __wmpAudio.rate(n) and __wmpAudio.pcm(<base64 stereo
// int16 LE>, n) per batch, from what the broadcast upload extension hears (the system's app audio
// mix, Spotify's included; ios/README.md). The stand-in is never closed: a broadcast stopped and
// started again just resumes.
window.alchemyElectron = { loopback: false, mode: 'app' };
var AUDIO_URL = 'ws://127.0.0.1:47831/audio';
window.alchemyScreensaver = { audio: true, url: AUDIO_URL };
var audioSock = null;
window.__wmpAudio = {
  rate: function (n) {
    if (!audioSock || !audioSock.onmessage || audioSock.rated === n) return;
    audioSock.rated = n;
    audioSock.onmessage({ data: JSON.stringify({ rate: n }) });
  },
  pcm: function (b64, n) {
    if (n) window.__wmpAudio.rate(n);
    if (!audioSock || !audioSock.onmessage || !audioSock.rated) return;
    var bin = atob(b64), cnt = bin.length >> 1, f = new Float32Array(cnt);
    for (var i = 0; i < cnt; i++) {
      var v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      f[i] = (v >= 32768 ? v - 65536 : v) / 32768;
    }
    audioSock.onmessage({ data: f.buffer });
  },
  close: function () { var s = audioSock; audioSock = null; if (s && s.onclose) s.onclose({}); },
};
function fakeAudioSocket() {
  var s = { url: AUDIO_URL, readyState: 0, binaryType: 'blob', rated: 0, onopen: null, onmessage: null, onerror: null, onclose: null,
    send: function () {}, close: function () { if (audioSock === s) { audioSock = null; s.readyState = 3; if (s.onclose) s.onclose({}); } },
    addEventListener: function (t, fn) { s['on' + t] = fn; } };
  audioSock = s;
  setTimeout(function () { if (audioSock === s) { s.readyState = 1; if (s.onopen) s.onopen({}); } }, 0);
  return s;
}
window.alchemyMarks = [];
window.alchemySpotifyLogout = function () { log('log out'); location.replace(SPOTIFY_LOGOUT); };
// The skin's volume and mute as the phone's system volume (App.swift SystemVolume): a page cannot
// change its own playback volume on iOS, so Spotify's volume command to this device does nothing.
window.alchemySetVolume = function (pct) { try { webkit.messageHandlers.volume.postMessage(pct); } catch (e) {} };
// Help's links in Safari (App.swift: the "open" message), Help > Restart as a reload of this page,
// and the update check answered in words: the page and this script come from the site at every launch.
window.alchemyOpenUrl = function (url) { try { webkit.messageHandlers.open.postMessage(String(url)); } catch (e) {} };
window.alchemyRestart = function () { log('restart: reloading'); location.reload(); };
window.alchemyCheckUpdate = function () { return Promise.resolve({ error: 'The newest player loads at every launch: close and reopen the app.' }); };
// For a skin made for the phone: the web view edge to edge ('edge') or inside the safe area
// ('safe', the default); the insets in points arrive as window.__wmpSafeArea with a 'wmp-safe-area'
// event on window; alchemyShowLog opens the host's log sheet, which edge to edge has no band for.
window.__wmpSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
window.alchemyLayout = function (mode) { try { webkit.messageHandlers.layout.postMessage(mode === 'edge' ? 'edge' : 'safe'); } catch (e) {} };
window.alchemyShowLog = function () { try { webkit.messageHandlers.showlog.postMessage(''); } catch (e) {} };
// For a click-wheel skin (App.swift): a haptic ('selection' for a detent, 'light'|'medium'|'heavy'|
// 'rigid'|'soft', 'success'|'warning'|'error', 'prepare' to warm the tick), the screen kept awake,
// the status bar, and the orientations allowed ('portrait'|'landscape'|'any').
var post = function (name, body) { try { webkit.messageHandlers[name].postMessage(String(body)); } catch (e) {} };
window.alchemyHaptic = function (kind) { post('haptic', kind || 'selection'); };
window.alchemyAwake = function (on) { post('awake', on ? 'on' : 'off'); };
window.alchemyStatusBar = function (hidden) { post('statusbar', hidden ? 'hidden' : 'shown'); };
window.alchemyOrientation = function (mode) { post('orientation', mode || 'any'); };
// The broadcast (the app's audio, ios/README.md) from the page: 'picker' opens iOS's sheet, which
// starts a broadcast or, while one runs, offers to stop it; 'auto'|'manual' is whether the app opens
// that sheet by itself at launch (kept across launches; a skin without visuals wants 'manual');
// 'state' asks for window.__wmpBroadcast = {running} now, which also arrives, with a
// 'wmp-broadcast' event on window, whenever it changes.
window.__wmpBroadcast = { running: false };
window.alchemyBroadcast = function (cmd) { post('broadcast', cmd || 'state'); };
// What the phone reports, each as a window global with an event of the same name on window when it
// changes: __wmpVolume (0..100, the buttons too) 'wmp-volume'; __wmpBattery {level 0..100 or -1,
// charging} 'wmp-battery'; __wmpRoute {name, type} (AirPods, Speaker) 'wmp-route'; __wmpBrightness
// (0..1) 'wmp-brightness'; __wmpHost {build, version, ios, model} 'wmp-host'; and 'wmp-shake'.
// alchemyHost() asks for all of them at once (a skin does so when it mounts).
window.__wmpVolume = -1; window.__wmpBattery = { level: -1, charging: false }; window.__wmpRoute = { name: '', type: '' };
window.__wmpBrightness = -1; window.__wmpHost = { build: '', version: '', ios: '', model: '' };
window.alchemyHost = function () { post('host', ''); };
window.alchemyBrightness = function (v) { post('brightness', typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 'state'); };
window.alchemyShare = function (text) { post('share', text); };
window.alchemyHomeIndicator = function (hidden) { post('homeindicator', hidden ? 'hidden' : 'shown'); };
window.alchemyOpenSettings = function () { post('open', 'settings'); };
window.alchemyReset = function () { log('reset asked'); post('reset', ''); };
// The rest of the phone, mapped whether a skin uses it or not (ios/README.md has each one):
window.alchemyViewport = function (mode) { post('viewport', mode === 'mobile' ? 'mobile' : 'desktop'); };   // kept; reloads
window.alchemyHapticPattern = function (events) { post('hapticpattern', JSON.stringify({ events: events || [] })); }; // [{t,i,s,d}]
window.alchemySound = function (id) { post('sound', (id | 0) || 1104); };                                       // 1104 = the keyboard tick
window.alchemyRoutePicker = function () { post('routepicker', ''); };                                          // AirPlay
window.alchemyAudioSession = function (mode) { post('audiosession', mode || 'solo'); };                       // solo|mix|duck
window.alchemyNotify = function (n) { post('notify', typeof n === 'string' ? n : JSON.stringify(n || {})); };  // {title,body,seconds,id} or 'cancel:<id>'
window.alchemyAppearance = function (mode) { post('appearance', mode || 'auto'); };                           // light|dark|auto
window.alchemyClipboard = function (text) { post('clipboard', text); };
window.alchemyProximity = function (on) { post('proximity', on ? 'on' : 'off'); };                            // on: the screen blanks when covered
// Reports with an event of the same name: __wmpProximity 'wmp-proximity', __wmpLowPower 'wmp-lowpower',
// __wmpThermal 'wmp-thermal', __wmpScene 'wmp-scene', __wmpKeyboard (pt) 'wmp-keyboard', and 'wmp-memory'.
window.__wmpProximity = false; window.__wmpLowPower = false; window.__wmpThermal = 'nominal'; window.__wmpScene = 'active'; window.__wmpKeyboard = 0;

window.alchemyMarks = [];
window.alchemySpotifyLogout = function () { log('log out'); location.replace(SPOTIFY_LOGOUT); };
// The skin's volume and mute as the phone's system volume (App.swift SystemVolume): a page cannot
// change its own playback volume on iOS, so Spotify's volume command to this device does nothing.
window.alchemySetVolume = function (pct) { try { webkit.messageHandlers.volume.postMessage(pct); } catch (e) {} };
// Help's links in Safari (App.swift: the "open" message), Help > Restart as a reload of this page,
// and the update check answered in words: the page and this script come from the site at every launch.
window.alchemyOpenUrl = function (url) { try { webkit.messageHandlers.open.postMessage(String(url)); } catch (e) {} };
window.alchemyRestart = function () { log('restart: reloading'); location.reload(); };
window.alchemyCheckUpdate = function () { return Promise.resolve({ error: 'The newest player loads at every launch: close and reopen the app.' }); };
// For a skin made for the phone: the web view edge to edge ('edge') or inside the safe area
// ('safe', the default); the insets in points arrive as window.__wmpSafeArea with a 'wmp-safe-area'
// event on window; alchemyShowLog opens the host's log sheet, which edge to edge has no band for.
window.__wmpSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
window.alchemyLayout = function (mode) { try { webkit.messageHandlers.layout.postMessage(mode === 'edge' ? 'edge' : 'safe'); } catch (e) {} };
window.alchemyShowLog = function () { try { webkit.messageHandlers.showlog.postMessage(''); } catch (e) {} };
// For a click-wheel skin (App.swift): a haptic ('selection' for a detent, 'light'|'medium'|'heavy'|
// 'rigid'|'soft', 'success'|'warning'|'error', 'prepare' to warm the tick), the screen kept awake,
// the status bar, and the orientations allowed ('portrait'|'landscape'|'any').
var post = function (name, body) { try { webkit.messageHandlers[name].postMessage(String(body)); } catch (e) {} };
window.alchemyHaptic = function (kind) { post('haptic', kind || 'selection'); };
window.alchemyAwake = function (on) { post('awake', on ? 'on' : 'off'); };
window.alchemyStatusBar = function (hidden) { post('statusbar', hidden ? 'hidden' : 'shown'); };
window.alchemyOrientation = function (mode) { post('orientation', mode || 'any'); };
// The broadcast (the app's audio, ios/README.md) from the page: 'picker' opens iOS's sheet, which
// starts a broadcast or, while one runs, offers to stop it; 'auto'|'manual' is whether the app opens
// that sheet by itself at launch (kept across launches; a skin without visuals wants 'manual');
// 'state' asks for window.__wmpBroadcast = {running} now, which also arrives, with a
// 'wmp-broadcast' event on window, whenever it changes.
window.__wmpBroadcast = { running: false };
window.alchemyBroadcast = function (cmd) { post('broadcast', cmd || 'state'); };
// What the phone reports, each as a window global with an event of the same name on window when it
// changes: __wmpVolume (0..100, the buttons too) 'wmp-volume'; __wmpBattery {level 0..100 or -1,
// charging} 'wmp-battery'; __wmpRoute {name, type} (AirPods, Speaker) 'wmp-route'; __wmpBrightness
// (0..1) 'wmp-brightness'; __wmpHost {build, version, ios, model} 'wmp-host'; and 'wmp-shake'.
// alchemyHost() asks for all of them at once (a skin does so when it mounts).
window.__wmpVolume = -1; window.__wmpBattery = { level: -1, charging: false }; window.__wmpRoute = { name: '', type: '' };
window.__wmpBrightness = -1; window.__wmpHost = { build: '', version: '', ios: '', model: '' };
window.alchemyHost = function () { post('host', ''); };
window.alchemyBrightness = function (v) { post('brightness', typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 'state'); };
window.alchemyShare = function (text) { post('share', text); };
window.alchemyHomeIndicator = function (hidden) { post('homeindicator', hidden ? 'hidden' : 'shown'); };
window.alchemyOpenSettings = function () { post('open', 'settings'); };
window.alchemyReset = function () { log('reset asked'); post('reset', ''); };
// The rest of the phone, mapped whether a skin uses it or not (ios/README.md has each one):
window.alchemyViewport = function (mode) { post('viewport', mode === 'mobile' ? 'mobile' : 'desktop'); };   // kept; reloads
window.alchemyHapticPattern = function (events) { post('hapticpattern', JSON.stringify({ events: events || [] })); }; // [{t,i,s,d}]
window.alchemySound = function (id) { post('sound', (id | 0) || 1104); };                                       // 1104 = the keyboard tick
window.alchemyRoutePicker = function () { post('routepicker', ''); };                                          // AirPlay
window.alchemyAudioSession = function (mode) { post('audiosession', mode || 'solo'); };                       // solo|mix|duck
window.alchemyNotify = function (n) { post('notify', typeof n === 'string' ? n : JSON.stringify(n || {})); };  // {title,body,seconds,id} or 'cancel:<id>'
window.alchemyAppearance = function (mode) { post('appearance', mode || 'auto'); };                           // light|dark|auto
window.alchemyClipboard = function (text) { post('clipboard', text); };
window.alchemyProximity = function (on) { post('proximity', on ? 'on' : 'off'); };                            // on: the screen blanks when covered
// Reports with an event of the same name: __wmpProximity 'wmp-proximity', __wmpLowPower 'wmp-lowpower',
// __wmpThermal 'wmp-thermal', __wmpScene 'wmp-scene', __wmpKeyboard (pt) 'wmp-keyboard', and 'wmp-memory'.
window.__wmpProximity = false; window.__wmpLowPower = false; window.__wmpThermal = 'nominal'; window.__wmpScene = 'active'; window.__wmpKeyboard = 0;

// ---- 1. observers on the web player's own channels (never its DOM). Everything lands in
// window.__wmpSpotify; each change is also a CustomEvent on window:
//   wmp-spotify-token {token} · wmp-spotify-auth {loggedIn} · wmp-spotify-hash {op, sha}
//   wmp-spotify-state = the last connect-state player_state · wmp-spotify-devices = W.devices
var W = window.__wmpSpotify = { token: null, at: 0, clientToken: null, loggedIn: null, expiresAt: 0,
  clientId: null, deviceId: null, activeDeviceId: '', connectionId: null, hashes: {}, state: null,
  cluster: null, spclient: null, devices: [] };
// Browsers keep 250 resource timing entries by default and the web player passes that within
// seconds of load, so lazy chunks such as xpui-routes-search.*.js would never appear to the page's
// hash scan.
try { performance.setResourceTimingBufferSize(100000); } catch (e) {}
var hobs = null; // our device id's first 35 hex digits, until the full 40 are known
var names = {}; // device id -> the last real name a cluster gave it
function emit(n, d) { window.dispatchEvent(new CustomEvent(n, { detail: d })); }
var API = /^https:\/\/(api|api-partner|[a-z0-9-]*spclient[a-z0-9.-]*)\.spotify\.com\//;
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
    var m = /^Bearer\s+(\S+)/i.exec(v);
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
  if (/\/pathfinder\/v\d\/query/.test(url)) {
    try {
      var q = new URL(url).searchParams, j = q.get('extensions') ? { operationName: q.get('operationName'),
        extensions: JSON.parse(q.get('extensions')) } : JSON.parse(body);
      seenHash(j.operationName, j.extensions.persistedQuery.sha256Hash);
    } catch (e) {}
  }
  // Our device: the full id is in track-playback's registration body; connect-state's URL only
  // carries "hobs_" + its first 35 hex digits (measured), resolved against the cluster below.
  if (/\/track-playback\/v1\/devices$/.test(url) && body) {
    try {
      var full = JSON.parse(body).device.device_id;
      if (/^[0-9a-f]{40}$/.test(full)) { W.deviceId = full; log('registered as ' + full.slice(0, 8)); }
    } catch (e) {}
  }
  var d = /^https:\/\/([a-z0-9.-]*spclient[a-z0-9.-]*\.spotify\.com)\/connect-state\/v1\/devices\/hobs_([0-9a-f]+)/.exec(url);
  if (d) {
    W.spclient = d[1];
    // A new registration (every page load makes one) replaces an id that does not match it.
    if (hobs !== d[2]) log('connect-state registration hobs_' + d[2].slice(0, 8) + (W.deviceId && W.deviceId.indexOf(d[2]) !== 0 ? ', dropping device ' + W.deviceId.slice(0, 8) : ''));
    hobs = d[2];
    if (W.deviceId && W.deviceId.indexOf(hobs) !== 0) W.deviceId = null;
  }
}
function seenCluster(c) {
  if (!c || typeof c !== 'object') return;
  // Idle (nothing playing anywhere): Spotify omits active_device_id entirely while still sending
  // the last player_state. "" then, never a stale id: the page shows such a state as paused.
  if ((c.active_device_id || '') !== W.activeDeviceId) log('active device ' + (c.active_device_id || '(none)').slice(0, 8));
  W.activeDeviceId = c.active_device_id || '';
  // Play on Device: every cluster carries the account's Connect devices.
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
// Logged out: Spotify's login page instead of the anonymous web player. At most once a minute,
// so a session that is still anonymous after signing in cannot bounce between the two; without
// sessionStorage there is no guard, so no redirect either.
function toLogin() {
  try {
    var k = 'wmp-login-redirect', ss = window.sessionStorage;
    if (Date.now() - (+ss.getItem(k) || 0) < 60000) return;
    ss.setItem(k, String(Date.now()));
    log('logged out: to the login page');
    location.replace(SPOTIFY_LOGIN);
  } catch (e) {}
}
function seenResponse(url, res) {
  url = String(url);
  if (/^https:\/\/open\.spotify\.com\/api\/token/.test(url)) {
    res.clone().json().then(function (j) {
      W.clientId = j.clientId || null;
      W.expiresAt = j.accessTokenExpirationTimestampMs || 0;
      if (j.accessToken && j.accessToken !== W.token) { W.token = j.accessToken; W.at = Date.now(); emit('wmp-spotify-token', { token: W.token }); }
      var li = j.isAnonymous === false;
      if (li !== W.loggedIn) { W.loggedIn = li; emit('wmp-spotify-auth', { loggedIn: li }); }
      if (j.isAnonymous === true) toLogin();
    }).catch(function () {});
  } else if (/\/connect-state\/v1\/devices\//.test(url) && res.ok) {
    res.clone().json().then(seenCluster).catch(function () {}); // the PUT answers with the cluster
  }
}
var ofetch = window.fetch;
// Our device's name in Spotify Connect (the phone's picker, the cluster's device list): the
// page registers itself as "Web Player (<browser>)"; the registration bodies are renamed on
// their way out. Only a body that parses and has the name where it is expected is touched.
function renamed(url, body) {
  if (typeof body !== 'string' || !/\/(connect-state\/v1\/devices\/hobs_|track-playback\/v1\/devices)/.test(String(url))) return body;
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
var dealerOpen = false;
function dealer(ws) {
  log('dealer socket opened');
  dealerOpen = true;
  ws.addEventListener('close', function (e) { dealerOpen = false; log('dealer socket closed (' + e.code + ')'); });
  ws.addEventListener('error', function () { log('dealer socket error'); });
  ws.addEventListener('message', function (e) {
    if (typeof e.data !== 'string') return;
    var m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.headers && m.headers['Spotify-Connection-Id']) W.connectionId = m.headers['Spotify-Connection-Id'];
    if (m.type === 'message' && /^hm:\/\/connect-state\/v1\/cluster/.test(m.uri || '')) {
      payload(m).then(function (j) { seenCluster(j && (j.cluster || j)); }).catch(function () {});
    }
  });
}
var OWS = window.WebSocket;
var WS = function WebSocket(url, protocols) {
  if (String(url) === AUDIO_URL) return fakeAudioSocket();
  var ws = protocols === undefined ? new OWS(url) : new OWS(url, protocols);
  try { if (/^wss:\/\/[^/]*dealer[^/]*\.spotify\.com\//.test(String(url))) dealer(ws); } catch (e) {}
  return ws;
};
WS.prototype = OWS.prototype;
['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WS[k] = OWS[k]; });
window.WebSocket = WS;

// The page in and out of the background (WebKit suspends it there): what the lines above follow.
// Suspended, the dealer socket dies (1006, measured) and the web player did not open another on
// its own; without it this page is no Connect device: commands answer 404 and no state arrives.
// So, visible again with the dealer closed: an 'online' event 5 s in, the nudge its reconnect
// listens for; still closed 15 s in, the page is reloaded, which registers a new device (the
// overlay remounts; the host's audio goes on).
document.addEventListener('visibilitychange', function () {
  log('page ' + document.visibilityState);
  if (document.visibilityState !== 'visible') return;
  setTimeout(function () { if (!dealerOpen) { log('dealer still closed: online event'); window.dispatchEvent(new Event('online')); } }, 5000);
  setTimeout(function () { if (!dealerOpen) { log('dealer still closed: reloading'); location.reload(); } }, 15000);
});

// ---- 2. the overlay, once there is a body to put it in
function mount() {
  if (document.getElementById('wmp-root')) return;
  var host = document.createElement('div');
  host.id = 'wmp-root';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  var root = host.attachShadow({ mode: 'open' });
  var sheet = new CSSStyleSheet();
  // The page fills the screen: square the skin's chrome, as the desktop hosts do.
  sheet.replaceSync(CSS + '\n#chrome,#titlebar{border-radius:0!important}');
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = HTML;
  document.body.appendChild(host);
  window.alchemyEngine = 'spotify';
  window.alchemyRoot = root;
  log('overlay mounted');
  RUN();
}
function go() { try { mount(); } catch (e) { log('mount failed: ' + (e && e.stack || e)); } }
// As soon as there is a body, not at DOMContentLoaded: that waits for Spotify's deferred scripts,
// seconds on a cold start, and the skin (with what the last session kept) needs none of them.
if (document.body) go();
else if (typeof MutationObserver === 'function') {
  new MutationObserver(function (_, o) {
    if (document.body) { o.disconnect(); go(); }
  }).observe(document, { childList: true, subtree: true });
} else document.addEventListener('DOMContentLoaded', go);

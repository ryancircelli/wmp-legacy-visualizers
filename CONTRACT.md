# Alchemy Web — module contract (v1)

Single-file deliverable: `alchemy.html` (no external deps). During development each module is a
plain ES2020 script in `src/` that attaches to a global `Alchemy` namespace; `build.py`
concatenates them into `alchemy.html` in the order listed in `src/ORDER.txt`.

## Data types
- `TimedLevel`: `{ freq: [Uint8Array(1024), Uint8Array(1024)], wave: [Uint8Array(1024), Uint8Array(1024)], state: 0|1|2, timeStamp: number }`
  (state 2 = playing, same as WMP). Waveform bytes centred on 128. Frequency bytes 0..255.
- `Surface`: `{ w, h, px: Uint32Array(w*h) }` — 0x00RRGGBB little-endian *as the DLL stores it*:
  `px[i] = (r<<16)|(g<<8)|b`, alpha byte 0. (Conversion to canvas RGBA happens only in the shell: opaque, or with
  `options.alpha: 'luma'` an alpha from each pixel's brightest channel and optionally `options.tint`; ARCHITECTURE.md "Engine".)
- `Rand`: MSVC CRT LCG. `Alchemy.rand()` returns 0..32767: `seed = (seed*214013 + 2531011)|0; return (seed>>>16)&0x7fff`.
  `Alchemy.srand(s)`. Every effect uses these, never `Math.random`.

## Engine (implemented by the engine/scheduler agents)
```js
const eng = new Alchemy.Engine({ width, height, options });   // allocates 3 surfaces like the DLL
eng.resize(width, height);                                    // re-allocs, re-runs SetSize on effects
eng.render(timedLevel);                                       // one WMP Render() call; returns Surface (front)
eng.options = { intended: false, fps: 60, backgroundColor: 0x000000 };
eng.debug()  // returns { cycleFrame, slots: [{name, effect, framesLeft, state}], activeWarps, bass, beat, bigBeat }
```
## Effect interface (base class Alchemy.Effect)
```js
class Effect { constructor(); name; category; weight; prob;   // +0x20 selection probability
  setSize(w,h); hardInit(ctx); randomize(); render(ctx); altRender(ctx); state/frame/transitionLen; }
```
`ctx` = the per-frame context: `{ level: TimedLevel, frame, beat, bigBeat, framesSinceBeat, framesSinceBigBeat,
bass, w, h, target: Surface, destRect, bassHistory: Float64Array(30), bassIdx, newAudio, paused, surfaces:[front,back,scratch] }`
Warp kernels: `class WarpKernel extends Effect { map(p /* {x,y} ints, mutated in place */); identityFallback; chainable; instantTransition; }`

## Shell (shell agent)
`Alchemy.Shell` owns the page: canvas, ImageData conversion (0x00RRGGBB -> RGBA), audio sources
(file / mic / getDisplayMedia with audio) feeding a Web Audio AnalyserNode (fftSize 2048 =>
1024 frequency bins, getByteFrequencyData/getByteTimeDomainData fill `TimedLevel` directly; both
channels from a ChannelSplitter, or duplicate mono), fixed-fps ticker (accumulator on rAF), controls
(source, fps, render scale, intended-toggle, background colour, fullscreen, debug overlay).
The shell must run with a stub engine that just fills noise until the real engine lands.

## v2 additions (module ownership)
Base classes live in `src/15-effect.js` (owned by the lead; do not edit — request changes).
- `src/20-shift.js`  — `Alchemy.Shift` (extends Effect, category 3): the warp subsystem: table build 3 scanlines/frame,
  23-step morph ladder, bit mover (gather + 5-tap blur + border rows), child selection/chaining/transitions, reroll-drop rule.
  Constructs its private pool of 10 kernels via `Alchemy.Kernels.makePool()` (see 30-kernels.js). Specs 01, 02.
- `src/30-kernels.js` — `Alchemy.Kernels = { LinearShift, StretchShift, ShiftOScope, CombShear, makePool() }` (extend WarpKernel). Spec 03.
- `src/40-draw.js`   — `Alchemy.Draw = { Pen, ColorFader, SuperStar, WonderWave, AtomBalls }` (extend Effect, category 4). Specs 04, 05.
- `src/50-engine.js` — `Alchemy.Engine` (replaces 10-stub-engine.js): surfaces, per-frame ctx, audio reduction + beat detector,
  effect pool + the 4 live slots + scheduler + envelope, draw order, BassBounce (category 7, intended-mode only), `debug()`. Spec 06 (+05 for BassBounce).
Every module is an IIFE over `window.Alchemy`, ES2020, no imports. Each ships `tests/<module>.test.js` runnable with
`node tests/<module>.test.js` (loads src files with `vm` and a fake `window`), asserting the spec's numeric claims.
`ctx` fields (from 50-engine.js): `{ level, frame, beat, bigBeat, framesSinceBeat, framesSinceBigBeat, bass, w, h,
  A: Surface /*presented, ctx+0x48*/, B: Surface /*scratch, ctx+0x50*/, C: Surface /*unused*/, bgColor, destRect,
  bassHistory: Float64Array(30), bassIdx, resized, paused, options: {intended:boolean} }`.
`Alchemy.rand()/srand()` from 00-rand.js are the only RNG. Integer semantics: use `|0`, `>>`, `Math.trunc` exactly where the spec says the DLL truncates.

## v3 — Battery (WMP built-in engine, wmp.dll)
Specs in spec/battery/ and spec/wmp/FUNCTION-MAP-WMP.md §3. Native surface 384x288, 8-bit palette indices.
- `src/70-battery-warps.js` — `Alchemy.BatteryWarps = { <ClassName>: class, list(): [ctor...] in the DLL's 15-entry RandomizeMovement order }`.
  Each class: `constructor()` (dbl0..dbl7 = 0.0 as the DLL), fields `dbl0..dbl7`, `identityRecovery` (+0x1a0: true = out-of-range keeps the
  destination coordinate, false = fallback to (0,0) per axis), `compatMask` (+0xe0), `setSize(w,h)` (384x288 but keep it parametric),
  `randomize()` (exact rand() idioms/order, Alchemy.rand only), `setParams(dbl[8])`, and `warp(p)` mutating `{x,y}` ints in place
  (destination -> source). No allocation in warp(); hoist constants in setSize()/randomize()/setParams(). Keep the DLL's literal constants
  (3.14, 6.28, 1.57, float-widened pi 3.1415927410125732) — never "fix" them to Math.PI.
- `src/72-battery-draws.js` — `Alchemy.BatteryDraws = { <ClassName>: class, list() }` (contract to be completed when specs 13/14 land):
  `draw(ctx)` plotting palette indices into `ctx.buf` (Uint8Array 384*288), `ctx.level` (TimedLevel), `ctx.audio` (engine-derived values), `ctx.frame`.
- `src/75-battery.js` — `Alchemy.Battery` engine: same API as Alchemy.Engine (+ `setPreset(i)` 0..25, `presetNames`), 384x288 Uint8 ping-pong
  buffers, palette Uint32Array(256) -> presented Surface (0x00RRGGBB), per spec 10.
- Tests: tests/battery-warps.test.js etc., node + vm + fake window, asserting the specs' worked examples (ref-warps-a.py / ref-warps-b.py are the
  generators of those numbers — port them into JS fixtures, do not change them).
- Draw ctx (v3, provisional until spec 10 lands): `{ buf: Uint8Array(w*h) /* current 8-bit target */, w, h, level: TimedLevel, frame,
  pre: boolean /* true in the pre-warp pass */, audio: {} /* engine-derived values; each draw class documents what it reads by name */ }`.
  Draw classes: `constructor()`, `dbl0..dbl7`, `compatMask` (+0xe0: bit0 border/pre-only, bit1 body/pre-or-post), `setSize(w,h)`,
  `randomize()`, `setParams(arr)`, `draw(ctx)`; overwrite-only writes of palette indices; Alchemy.rand only.
- Engine note (spec 10): Battery has NO audio reduction — TimedLevel is passed through unchanged; `ctx.audio` stays an empty object unless a
  draw class documents a need. Presets: 26 (0 Randomization = default; 1..25 saved presets never auto-randomize). Registries: 15 shifts
  (CLinearShift registered twice) and 10 draws, singletons re-parameterised on preset switch.

## v4 — Now Playing metadata (app + screensaver only)
Source: Windows Global System Media Transport Controls (WinRT `Windows.Media.Control`), read by the native helper and relayed by the
Deno host over the SAME local WebSocket the audio uses (`/audio`): PCM stays binary frames; metadata is JSON TEXT frames.
Host → page (on every change, and once per second while playing):
  {"type":"media","status":"playing"|"paused"|"stopped"|"none","title":"","artist":"","album":"","app":"Spotify.exe",
   "position":123.4,"duration":245.0,"art":"data:image/jpeg;base64,..."|null,"canSeek":true,"canNext":true,"canPrev":true}
Page → host (text frame):
  {"type":"mediaCmd","cmd":"playpause"|"play"|"pause"|"next"|"prev"|"seek","position":123.4}
No session → status "none": the page shows the visualizer-only state it has today. The website (browser) never receives these
frames and keeps its current behaviour.

## v5 — Synced lyrics (app + screensaver only)
Host fetches from LRCLIB (https://lrclib.net/api/get?track_name=&artist_name=&album_name=&duration= ; fallback /api/search) when the
media track changes; caches per (title, artist, album, duration) in %LOCALAPPDATA%\WmpLegacyVisualizers\lyrics\; never blocks audio.
Host → page (text frame, once per track, again on cache hit):
  {"type":"lyrics","status":"synced"|"plain"|"none"|"error","source":"lrclib","lines":[{"t":12.34,"text":"...","words":[{"t":12.34,"text":"..."}]?}, ...]|null,
   "plain":"..."|null,"track":{"title":"","artist":"","album":"","duration":0}}
`words` is present only when the LRC carries enhanced word stamps (`<mm:ss.xx>`); otherwise the page spreads the line's words over
its duration by length (karaoke highlight is then an estimate).
Page: renders the current line word by word (sung words lit, the current one filling left to right) and the next line dimmed,
synced to the extrapolated media position; shows plain lyrics scrolling
when unsynced; hides when none. Privacy: sends title/artist/album/duration to lrclib.net; a Player option "Fetch lyrics" (default on)
turns it off, persisted; the page sends {"type":"lyricsPref","enabled":bool} so the host never fetches when off.
Page → host: {"type":"wake","on":bool} when the app enters/leaves full screen; the host calls SetThreadExecutionState so the
display and machine stay awake while visuals fill the screen (the page also takes a Screen Wake Lock). Not sent by the screensaver.

## v6 — Spotify engine (`WmpSpotify.exe`, `--mode=spotify`; branch spotify-engine)
The WMP window becomes a Spotify client: Spotify's web player runs INSIDE our WebView2 host, hidden under our skin, and is
driven through its APIs, never its DOM. Own profile folder `%LOCALAPPDATA%\WmpLegacyVisualizers\spotify\` (keeps the login).
Host:
  - navigates the webview to https://open.spotify.com/ ; keeps the virtual host https://wmp.localhost/ mapped with
    cross-origin access ALLOWED (COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW) so the overlay may fetch from it.
  - injects ONE document-created script (`webview_init`) that does nothing unless location.hostname === "open.spotify.com"
    (never on accounts.spotify.com — the login page is shown as Spotify renders it). On open.spotify.com it:
      1. patches window.fetch and XMLHttpRequest before any page script runs, and captures the `Authorization: Bearer …`
         header of the page's own requests to *.spotify.com API hosts (api.spotify.com, api-partner.spotify.com,
         spclient.*.spotify.com, gew*/gae*-spclient). Each new token: window.__wmpSpotify = { token, at: Date.now() } and
         window.dispatchEvent(new CustomEvent("wmp-spotify-token", { detail: { token } })).
      2. mounts the overlay: `<div id="wmp-root">` (position:fixed; inset:0; z-index:2147483647) with an OPEN shadow root
         holding the page markup; styles via a constructed CSSStyleSheet (adoptedStyleSheets — outside CSP style-src);
         our JS is part of the injected script itself (outside CSP script-src), never a <script> element or eval.
         The bundle the host injects is built by build.py as dist/spotify-inject.js = { html, css, js } of alchemy.html.
      3. sets window.alchemyEngine = "spotify" and window.alchemyRoot = the shadow root before our JS runs; the same
         alchemyWin*/alchemyReady bindings, audio socket, Now Playing (GSMTC) and lyrics flow as in v4/v5.
  - Everything else in the app (window, audio helper, lyrics, releases) is unchanged. `deno task compile:spotify` builds
    dist/WmpSpotify.exe (icon, GUI subsystem, `--mode=spotify` baked).
Page (src/95-spotify.js, active only when window.alchemyEngine === "spotify"):
  - All DOM lookups go through Alchemy.root (document when no shadow root); no bare document.getElementById.
  - Overlay visibility: hidden until GET https://api.spotify.com/v1/me with the captured token returns 200 (logged in);
    401/403 or no token within 3 s → overlay stays hidden so the user sees Spotify's own login; re-check on every token.
  - Playback state: the host's `media` messages (GSMTC) as before; if none within 2 s of a token, poll
    GET /v1/me/player every 1 s and synthesize the SAME `media` message shape internally (onMedia reused; position
    extrapolated between polls). Album art from the item's images.
  - Transport: Web API first — PUT /v1/me/player/play|pause, POST next|previous, PUT seek?position_ms — with the web
    player's device (GET /v1/me/player/devices, the one named like "Web Player"); on 403 (free account) or network
    error fall back to the host mediaCmd (SMTC) path, permanently for that session.
  - Library (the right-hand playlist pane, .lgrp/.litem): groups "Now Playing" (GET /v1/me/player/queue), "Playlists"
    (GET /v1/me/playlists, paged), "Liked Songs" (GET /v1/me/tracks), "Search" (a text box → GET /v1/search
    type=track,album,playlist). Click a playlist/album → PUT play { context_uri }; a track → { uris:[uri] }.
    Free accounts: items listed, play disabled with the status "Playback control needs Spotify Premium".
  - Rate limits: never more than 1 request/s of polling; 429 → honour Retry-After.
Privacy: the token never leaves the page; the host never sees it; nothing is written to disk but Spotify's own profile.

### v6.1 — the page uses the web player's own channels (the public Web API answers 429 to its token)
Measured 2026-09-24: every api.spotify.com/v1 call with the web player's token is 429 from the first request. The host's
injected script therefore observes the page's own traffic and exposes it; the page never calls api.spotify.com.
Host (the Deno host's spotify.ts) maintains window.__wmpSpotify = { token, at, clientToken, loggedIn, expiresAt, clientId,
  deviceId (this web player's 40-hex connect id), activeDeviceId, connectionId, hashes: {operationName: sha256},
  state: <last player_state>, cluster: <last cluster> } and dispatches CustomEvents on window:
  "wmp-spotify-token" {token} (only on change), "wmp-spotify-auth" {loggedIn} (from /api/token isAnonymous; an anonymous token also replaces the page with
  SPOTIFY_LOGIN, the login page, at most once a minute per session),
  "wmp-spotify-hash" {op, sha}, "wmp-spotify-state" (detail = player_state; from dealer cluster messages and from the
  page's own PUT connect-state/v1/devices/hobs_* response at load). Observers start at document creation; the overlay's
  JS runs as soon as document.body exists (before DOMContentLoaded, which waits for Spotify's scripts), so the
  page reads window.__wmpSpotify first, then listens. The skin shows before the login is known when the last
  session in this profile was logged in (localStorage wmp.loggedIn), with the query results TanStack Query's
  persister kept in IndexedDB (src/ui/persist.ts); data is fetched only once the login is confirmed.
Page (src/95-spotify.js):
  - Login gate: loggedIn === true shows the overlay; false/unknown keeps Spotify's own page visible.
  - State: player_state → the same internal `media` message shape (title/artist/album/art from track.metadata,
    position = +position_as_of_timestamp + (is_paused ? 0 : Date.now() - +timestamp), duration, status from is_paused;
    numbers are strings). No polling. Host GSMTC `media` frames are ignored while a Spotify state exists.
  - Transport: POST https://<spclient host the page uses>/connect-state/v1/player/command/from/<deviceId>/to/<activeDeviceId>
    with Authorization: Bearer <token> (client-token header sent when known, not required): {"command":{"endpoint":
    "pause"|"resume"|"skip_next"|"skip_prev"}}, seek {"endpoint":"seek_to","value":<ms>}; play a context
    {"endpoint":"play","context":{"uri":U,"url":"context://"+U},"options":{"skip_to":{"track_uri":T}},"play_origin":
    {"feature_identifier":"playlist","feature_version":"xpui"}} (options optional). Fallback to the host mediaCmd (SMTC)
    path only on network error / non-2xx, per command, not for the session.
  - Library/search: POST https://api-partner.spotify.com/pathfinder/v2/query {operationName, variables,
    extensions:{persistedQuery:{version:1, sha256Hash}}}. Operations: libraryV3 (playlists/albums/artists), fetchLibraryTracks
    (Liked Songs), fetchPlaylist, getAlbum, searchDesktop / searchTracks. Hashes: window.__wmpSpotify.hashes first, then a
    runtime scan of every loaded script for /"(op)"\s*,\s*"(query|mutation)"\s*,\s*"([0-9a-f]{64})"/, then a baked
    fallback table (dated; SPIKE2.md); the search chunk only loads after the hidden app visits /search, so the page may
    trigger it (history.pushState('/search') + popstate) and rescan. 412 "Invalid query hash" → rescan once, then status.
  - Premium: play/transport commands need Premium at Spotify's end; a non-2xx on them is reported in the status bar.

## v7 — page updates (the Deno host's `update.ts`; `tauri/src/update.rs` since v8)
Every build writes dist/update.json {version, built (commit time), needs, host, files: {name: sha256}};
deploy signs it (dist/update.json.sig, Ed25519, tools/sign-update.js with the UPDATE_SIGNING_KEY secret)
and the exes fetch it, with index.html (screensaver) or spotify-inject.js (WmpSpotify), from
wmp.ryancircelli.com. A copy is used when the signature verifies with the key baked into the exe,
the file matches its hash, `built` is newer than the exe's own page, and `needs` <= the exe's
HOST_API. **tauri/host-api.json is the contract version: bump it in the same commit as any
page change that needs something older exes lack** (a new binding, a changed message); older exes
then keep their built-in page. A page may still feature-detect optional bindings (alchemyOpenUrl)
without a bump. `host` hashes the host's own sources (tools/postbuild.js; since the Tauri host's release, `tauri/`
by git blob id, host-api.json among them); another value tells an exe a newer one is out (window.alchemyHostUpdate =
true; the page offers the download).

## v8 — the Tauri host (`tauri/`; the two downloads, release.yml)
One exe for every mode (tauri/src/mode.rs): `/s` the screensaver, `/c`, `/c:<hwnd>` or nothing the player
window, `/p <hwnd>` exits 0, `--mode=spotify` the Spotify player (below). The page is the website's build,
embedded, at `https://wmp.localhost/index.html?mode=screensaver&ss=1` (the saver) or `?mode=config` (the
player and Spotify windows): a custom protocol, `wmp`, which Tauri serves on Windows as
`https://wmp.localhost/`, so the origin, and the `localStorage` it keys, is the Deno host's
(`wmp://localhost/` elsewhere). Data folder `%LOCALAPPDATA%\WmpLegacyVisualizers\tauri\` (WebView2
profile, window-state.json, alchemy.log, update\, lyrics\): a WebView2 profile can be open in one program
at a time, so it is not the Deno host's; the first launch copies that host's settings and login over
once (tauri/src/carry.rs).
Globals (tauri/src/host.js, on every document of every Tauri window, before any page script):
  - `alchemyElectron = { loopback: false, mode: "screensaver"|"config" }`. loopback is false (the Deno host
    said true): with it true, a page without host audio (no socket, or off Windows) would call
    getDisplayMedia, which WebView2 answers with a share picker, not a loopback.
  - `alchemyScreensaver` is MERGED into, never replaced: `Object.assign({audio:false, url:''},
    window.alchemyScreensaver)`. A plugin's init script runs before the window's own, and the audio
    plugin's (tauri/src/audio/mod.rs) has already set `{audio: true, url: "ws://127.0.0.1:<port>/audio?k=<key>"}`
    — only when location.hostname is `wmp.localhost` or `localhost` (the page off Windows), so a page
    the web view is somehow navigated to is never handed the key.
  - `alchemyHostUpdate`, `alchemyMarks`, `alchemyLog`, `alchemyOccluded` (called by the host) and
    `alchemyWinDrag` / `Min` / `Max` / `Close` / `Size` / `Full`, as the Deno host; the window calls go
    through Tauri's window API. `alchemyOpenUrl` goes through the opener plugin, scoped to the project's
    site and repository (tauri/capabilities/default.json); any other URL is refused and logged.
    `alchemyRestart` is the process plugin's restart.
  - NEW, optional: `alchemyCheckUpdate(): Promise<{running, ready, hostUpdate, error}>` — Help > Check for
    Player Updates. `running` is the page version this launch serves, `ready` a newer one now cached for
    the next launch (else null), `hostUpdate` a newer exe is out, `error` why the site could not be
    asked or believed (else null). The page uses it when present and the Deno host's worker `/update`
    otherwise.
  - NEW, optional: `alchemyNativeTitle = true` (Windows; the player and Spotify windows, never the saver):
    the host draws the XP title bar itself (tauri/src/titlebar.rs). The page hides `#titlebar`
    (`auth.nativeTitle` -> `#chrome[data-nativetitle]` -> the `nativetitle:` variant, as `bare:` does); the
    alchemyWin* calls stay (the status-bar grip, full screen). The website and the Deno host never set it.
  - `window.__TAURI__` (withGlobalTauri) exists in every Tauri window, so in our page; it NEVER exists in
    Spotify's page (below). Not provided: `alchemyReady` (host.js reports the first painted frame
    itself), `alchemySpotifyLogout` (the bridge's `sp_logout`), `alchemyQuit`, `alchemyCarried`.
Page updates (v7) are the same contract in Rust (tauri/src/update.rs): same manifest, key and rules;
`needs` is compared with tauri/host-api.json. Only
`index.html` is updated: the Spotify window runs index.html too, there is no spotify-inject.js here.
Cache `tauri\update\`.

### v8 — the audio socket (both hosts)
  - `/audio` answers only with the per-launch key, 128 random bits in hex: `ws://127.0.0.1:<port>/audio?k=<key>`;
    without it, 403. The port is findable by anything local, and the socket is the system's sound, what
    is playing, and transport and wake commands. The Deno host keyed it the same way (its server.ts).
  - `{"rate":n}` is the first text frame, then PCM (binary, interleaved stereo f32, one message per
    capture period: 3840 bytes at 48 kHz). The Tauri host sends the rate ONCE per socket, even when the
    capture restarts after a default-device change and keeps streaming into the same socket; the Deno
    host sent it again after a helper restart. The page attaches a socket's source once
    (src/adapters/local/index.ts `openHostAudio`, since 2026-09-29), so either is safe; before that fix a
    second rate replaced the source, and stopping the old one closed the socket it arrived on.
  - `media`, `lyrics`, `mediaCmd`, `wake` as v4/v5. `lyricsPref` refetches only on a change (the page sends
    "on" as it connects). A stalled page loses messages past 1 MB unsent; it never grows the host.
    Lyrics cache `tauri\lyrics\`, the Deno host's file names.

### v8 — the Spotify bridge (`--mode=spotify`, tauri/src/spotify, src/adapters/spotify/bridge.ts)
Replaces v6's overlay for this host: our page is NOT inside Spotify's. Window "spotify" (title `WMP Spotify`,
class `AlchemyHost`) loads our page, `https://wmp.localhost/index.html?mode=config`, with
`window.alchemyEngine = 'spotify'` set before it. Spotify's web player, unmodified, is a child WebView2 in
the same window that the host creates with wry itself: no Tauri IPC, no init script, no global of ours is
ever in it. Same browser process, its own profile (`WebView2\EBWebView\WV2Profile_spotify`), the autoplay
permission for https://open.spotify.com. It is parked (1x1 px just outside the window, never IsVisible=false)
and covers the window, under the title bar, only while Spotify needs the user: any https page but the web
player (its login, a captcha), or the web player logged out, which is sent to the login page at most once
a minute. The host watches it through the DevTools Protocol (Network domain only; Runtime.enable is never
called) and runs our requests in an isolated world of its page.
The page picks its transport (src/adapters/spotify/transport.ts): the bridge when `window.__TAURI__` exists,
else in-page (v6.1). Everything above the transport is shared: the bridge keeps `window.__wmpSpotify` and
fires the same `wmp-spotify-auth` / `-hash` / `-state` / `-devices` events from what the host reports, by
the rules of the Deno host's spotify.ts. `__wmpSpotify.token` never exists; `hasToken` says whether the host has one.
Host -> page (Tauri events, to the "spotify" window only):
  - `sp:auth {loggedIn: true|false|null, hasToken: bool}` — the first bearer seen; /api/token's
    isAnonymous changing; File > Log Out.
  - `sp:hash {op, sha, scanned: bool}` — scanned false: a persisted-query hash the web player sent
    (pathfinder v1 GET URL or v2 POST body); true: one declared in a script it loaded from
    open.spotifycdn.com (v6.1's pattern), the search chunk's included once it has loaded.
  - `sp:device {deviceId: 40-hex|null, hobs: hex|null, spclient: host|null}` — this web player's Connect id
    (track-playback's registration body), the prefix connect-state's `devices/hobs_<hex>` URL carries and
    that spclient host. A new registration drops an id that does not match its prefix.
  - `sp:cluster <connect-state cluster>` — the devices PUT's answer, and each dealer push of
    `hm://connect-state/v1/cluster` (JSON, or base64 of JSON, gzipped when its headers say so).
Page -> host (`__TAURI__.core.invoke`):
  - `sp_snapshot()` -> `{loggedIn, hasToken, expiresAt, deviceId, hobs, spclient, hashes, scanned, cluster}`:
    all seen so far. The bridge subscribes to the events first, then asks, so nothing falls between.
  - `sp_request({url, method?, body?, headers?})` -> `{status, text, retryAfter}`. Only
    `https://api-partner.spotify.com/...` or a `*spclient*.spotify.com` host (never api.spotify.com: the Web
    API answers this token with 429, v6.1); method GET (default), POST, PUT or DELETE; anything else
    rejects. Of the page's headers only content-type, accept and app-platform are kept; the host adds
    `authorization: Bearer <token>`, and client-token, app-platform and spotify-app-version as the web
    player last sent them. Run as a fetch in the isolated world (Spotify's origin, none of its script),
    30 s timeout. status 0: no bearer yet. Rejects on a network error, as fetch does.
  - `sp_route({path})` — `/[A-Za-z0-9/_:-]*` only: history.pushState + popstate in the web player, which
    loads that route's script chunk (its hashes then arrive as `sp:hash` scanned).
  - `sp_cookie({name: "sp_t"})` -> string — sp_t only (home's variables carry it).
  - `sp_logout()` — drops the bearer, `sp:auth {loggedIn: false, hasToken: false}`, and loads Spotify's
    logout, which lands on its login page.
On this host the page prefetches nothing while idle after login (src/ui/data.ts): its requests go out
when the user asks for something.
Privacy: the bearer is in Spotify's page and the host's memory only: never in our page, a file or the log
(the log names a request's host and path and its pathfinder operation or player command, never its
variables, its answer or the dealer socket's URL, which carries the token).
Measured 2026-09-29, the logged-out web player 60 s in: our player window alone 253 MB private; with
Spotify's view in the app's browser under its own profile 553-560 MB; in a browser of its own 655-667 MB,
and slower to come up (0.7-0.8 s against 0.25-0.55 s). The shared browser it is.

## Dev-only (`tauri dev`; never in a release exe) — hot reload in the desktop windows
`npm run dev:app` (the player) and `npm run dev:spotify` (`--mode=spotify`) run `tauri dev` with
tauri/tauri.dev.conf.json: Vite's dev server (`npm run dev -- --strictPort`, http://localhost:5173/)
and a debug host that loads the page from it, `http://localhost:5173/index.html?<the same query>`,
instead of `https://wmp.localhost/`. Vite's HMR runs in the page as it does on the website. The
globals, the audio socket and the Spotify bridge are the same (the audio plugin hands its URL to
`localhost` too, and Tauri counts `devUrl` as the app's own origin for its IPC). The origin, and so
`localStorage`, is the dev server's. A dev build is its own instance (identifier
`com.ryancircelli.wmp-legacy-visualizers.dev`) with its own data folder, `tauri-dev\`, beside
`tauri\`, and never updates its page. `tauri build` compiles Tauri's `custom-protocol` feature in, so
`tauri::is_dev()` is false there, and its config has no `devUrl`: a release exe always serves its own.
Retired with the Deno host: its `--dev` mode (a watch build of dist/spotify-inject.js, CSS swapped into
the overlay over a `/dev` socket, a reload for anything else).

## Retired: the Deno host
`deno-webview/` (v4–v7's host: `Alchemy.scr` and `WmpSpotify.exe` on Deno + WebView2) and `deno/` (the
static handler it served `dist/` with) were removed on 2026-09-30, after the Tauri host (v8) shipped in
60d9b23. Its design record and measurements are docs/history/deno-webview.md; the sources are in git
history. The `/update` worker fallback has no host now; the page still carries it. The in-page Spotify
transport (v6.1) and dist/spotify-inject.js live on in the iOS app (`ios/`, below).

## v9 — the iOS app (`ios/`, .github/workflows/ios.yml)
One WKWebView on https://open.spotify.com/ with v6.1's overlay: `ios/WmpSpotify/observer.js` is the
Deno host's injected script (its observers unchanged, its host bindings answered in-page), wrapped by
App.swift around dist/spotify-inject.js, which the app fetches from wmp.ryancircelli.com at every
launch and keeps in Caches (offline: the last copy; none: Spotify's page bare). The user script runs at
document start in the main frame only, with a desktop Safari user agent, since Spotify serves the web
player to desktop browsers only. Host bindings the page sees: `alchemyElectron = {loopback:true,
mode:'app'}` and `alchemyScreensaver = {audio:true, url:'ws://127.0.0.1:47831/audio'}` (the v8 audio
socket's frames, but no socket in the page: WebKit refuses ws:// from the https page, so observer.js
answers that one URL with a stand-in that App.swift feeds by evaluateJavaScript, `__wmpAudio.rate(n)`
and `__wmpAudio.pcm(<base64 stereo int16 LE>, n)` per 100 ms batch, from the app's own Spotify Connect
speaker (librespot), whose audio the app plays itself; no microphone; the broadcast upload extension
that fed it until 2026-10-02 is gone, ios/README.md "History"), `alchemyLog` (a WKScriptMessageHandler), `alchemySpotifyLogout` (accounts.spotify.com/logout),
`alchemySetVolume` (the phone's system volume: a page cannot set its own on iOS), `alchemyOpenUrl`
(Safari), `alchemyRestart` (a reload), `alchemyCheckUpdate` (answered in words), `alchemyLayout('edge'|'safe')`
(the web view edge to edge for a skin made for the phone, with the insets in `window.__wmpSafeArea`
and a `wmp-safe-area` event), `alchemyShowLog` (the host's log sheet), and for a click-wheel skin
`alchemyHaptic(kind)`, `alchemyAwake(on)`, `alchemyStatusBar(hidden)`, `alchemyOrientation(mode)`.
The phone's reports, each a window global with an event of the same name: `__wmpVolume` (the buttons too), `__wmpBattery`, `__wmpRoute`,
`__wmpBrightness`, `__wmpHost`, and `wmp-shake`; `alchemyHost()` asks for all at once. `alchemyIcon(name)` sets the app's icon to the bundle's `Icon-<name>` ("green": the default one; ios/icons.py makes them). `__wmpTilt` (a number, -1 tilted left to 1 right: gravity's x, to 0.01) with `wmp-tilt`, ten a second at most while the app is in front and not in Low Power Mode, is the iPod skin's (its metal's lights move with the hand). Also
`alchemyBrightness(v?)`, `alchemyShare(text)`, `alchemyHomeIndicator(hidden)`, `alchemyOpenSettings()`,
`alchemyReset()` (the web view's data cleared, a reload); and the rest of the phone mapped whether
used or not: `alchemyViewport`, `alchemyHapticPattern`, `alchemySound`, `alchemyRoutePicker`,
`alchemyAudioSession`, `alchemyNotify`, `alchemyAppearance`, `alchemyClipboard`, with the reports
`__wmpProximity`, `__wmpLowPower`, `__wmpThermal`, `__wmpScene`, `__wmpKeyboard` and `wmp-memory`,
and the last fixed choices made the page's: `alchemyBand(hidden)`, `alchemyBackground(hex)`,
`alchemyKeyboard(avoid)`, `alchemyScroll(on)` (ios/README.md lists each); and the host's own Spotify
Connect speaker, where it has one: `__wmpSpeaker = {id, name}` (`wmp-speaker`; `id` its device id while
its session is up, else null) and `alchemySpeakerName(name)`. The Spotify adapter sends its commands
to the active device, else to that speaker, else to the page's own player (src/adapters/spotify/connect.ts,
`target`; to the speaker through the host's own player where the host has one, v10), and on the phone the page's own player is hidden from every picker (observer.js). The app fetches
observer.js itself from the site too, as dist/ios-observer.js (tools/postbuild.js), with its bundled
copy as the fallback: a change to the page or to the observer reaches the phone at its next launch. No audio
socket, no lyrics from a host (for a track Spotify has none for, the page asks Spotify again under the uri
`__wmpSpeakerTrack` reports when it is the same song under another id, as librespot's alternative to a track it
cannot play, then LRCLIB itself, `get` only unless it finds nothing and naming itself in an `Lrclib-Client`
header: src/adapters/spotify/lyrics.ts `fetchLyricsFallback`), no window bindings, no page-update
signature (the site is trusted as the bundle's source). Built on GitHub's macOS runners, signed with
Xcode's cloud-managed certificates through an App Store Connect API key, uploaded to TestFlight.

## v10 — the host's player (a host capability; `src/adapters/host/player.ts`, `src/adapters/spotify/player/`)
A host with its own Spotify Connect speaker (v9's `__wmpSpeaker`) may also drive that speaker for the page: the page's
presses reach it without the round trip through Spotify's cloud (page -> connect-state -> the speaker), which lost presses
while the page's socket reconnected and showed stale state after the host was suspended, and the page reads what the
speaker does from its own player events instead of second-hand from Spotify's cluster. Any host may implement it (the
iOS app is the first: its librespot); every binding is optional and feature-detected, so a host without them, the
website, or a page newer than its host keeps v6.1's connect-state path for everything (no host-api bump). The page
reaches these bindings through `src/adapters/host/player.ts` alone (`available`, `speaker`, `state`, `send`, `subscribe`).
Commands, page -> host:
  - `window.alchemyPlayer(cmd: string): void`, present only on a host that has it (`typeof … === 'function'`); fire and
    forget: the answer is the next report. Unknown commands are logged by the host and ignored.
  - `play` resume; not the active device: take the playback first (Spotify's remembered session), then resume.
    `pause`. `toggle` play or pause by what the player is doing. `next`, `prev`. `seek:<ms>`. `shuffle:<0|1>`.
    `repeat:<off|context|track>`. `take` become the active device with Spotify's remembered session, without resuming.
  - `load:<json>` play a context, always starting playback: `{"context":"spotify:playlist:…","track":"spotify:track:…"|null,
    "shuffle":true|false|null,"position":0}` (`shuffle: null` leaves it as it is); not the active device: activate first.
  - `crossfade:<seconds>` an integer, 0 (off, the host's default) to 12, out of range clamped: at a track's natural end
    (not a skip, a load or a seek) the next track fades in over the last that many seconds of this one, equal-power,
    on the host's own speaker only (Spotify sends Connect devices no crossfade of its own). Taken whether or not the
    speaker is active or has a session; the host keeps it no longer than it runs, so the page sends it at its start and
    at each change (`settings.crossfade`, `src/adapters/spotify/index.ts hostSettings`).
  - The sound (2026-10-03, the owner's parity with Spotify and the iPod), taken as `crossfade` is, and sent with it at
    the page's start and at each change (`settings.eq` / `quality` / `normalise` / `audioCache`, the same `hostSettings`):
    `eq:<json>` the equalizer, a JSON array of 10 gains in dB (−12…+12, clamped) for 32, 64, 125, 250, 500, 1k, 2k, 4k,
    8k, 16k Hz (the page sends the chosen preset's, `src/model/eq.ts`); all zeros (or `eq:off`) is a bypass, no
    processing at all; at once, without a click. `quality:<96|160|320>` the stream's bitrate in kbps (librespot's
    Bitrate). `normalise:<0|1>` volume normalisation (librespot's own; the iPod's Sound Check). `cache:<0|1>` the audio
    cache: played files kept on disk under the receiver's cache dir, about 1 GB at most, the oldest pruned; 0 turns it
    off and deletes what is cached. Defaults: eq flat, 160, normalise off, cache on. The host keeps the last values
    itself (a small file in its cache dir) and starts with them, so a command that changes nothing does nothing (no
    restart; one quiet log line at most). A change needs no relaunch: `eq` is immediate; `quality` / `normalise` /
    `cache` at the next track or by restarting the speaker's player or session, whichever is least disruptive and
    correct, playback resuming by itself where it was. No state of them in `__wmpPlayer`: the page's settings are
    the truth for display.
  - `play` / `pause` / `toggle` / `next` / `prev` / `seek:<ms>` keep any meaning the host already gives them elsewhere
    (the iOS app's Control Center); `play` gains the take-first rule.
State, host -> page: `window.__wmpPlayer` with the event `wmp-player` on window at every change, and once more when the
page asks (`alchemyHost()`), from the player's own events:
  `{ v: 1, active, playing, uri ('' when nothing is loaded), title, artist, album, art (as __wmpSpeakerTrack has them),
  duration (ms), position (ms, true at `at`: what is heard, behind what a crossfade has queued), at (epoch ms; the page extrapolates while playing), shuffle,
  repeat: 'off'|'context'|'track' }` — `active`: its speaker is the active Connect device. No context uri, queue or
  restrictions: the page keeps taking those from Spotify's cluster. `__wmpSpeakerTrack` / `wmp-speaker-track` (v9) stay
  as they are for an older page; the page reads them still on a host without `__wmpPlayer`.
Who is in charge (the page, per command, `src/adapters/spotify/player/index.ts`): the host's player, when
`alchemyPlayer` exists and the command's target (connect.ts `target`: the active device, or none other is) is
`__wmpSpeaker.id`. Then transport, stop, shuffle, repeat and plays go to `alchemyPlayer` and nothing to connect-state,
with the same optimistic changes; each command is one line in the host's log, `spotify: <cmd> to the host's player`.
A player ignores every command but a transfer while its speaker is not the active device (librespot's Spirc), so while
`__wmpPlayer.active` is false any command but `play` and `load` is sent after a `take`, once a report says active (5 s
at most, one `take` for all waiting). While its speaker is also active (`__wmpPlayer.active`), the playback slice's
status, position and track (uri, title, artist, album, art, duration) are the host's report, even for a track the
cluster has no state for yet; the context, "Playing from", what can be skipped and the queue stay the cluster's. Shuffle
and repeat are whichever of the two last changed them (receipt time; a value as first seen counts as no change): the
host's are stale once it has taken the playback (its own earlier settings, not the session's) and say nothing of a play
another client started with its own, but are right in the report after a toggle or a `load` sent from here, which counts
as a change whatever its value. Otherwise (another Connect device active, a host without a player, the website) everything is v6.1's. Add to
queue, volume, transfers to other devices and all browsing stay connect-state and pathfinder in every case.

## Retired: the system-audio application
`WmpVisualizers.exe` (`--mode=app`, release `app-latest`) was retired 2026-09-24. v4 (Now Playing) and v5 (lyrics) now
apply to the screensaver (and, through the same host, to WmpSpotify.exe); the website has neither.

# Alchemy Web — module contract (v1)

Single-file deliverable: `alchemy.html` (no external deps). During development each module is a
plain ES2020 script in `src/` that attaches to a global `Alchemy` namespace; `build.py`
concatenates them into `alchemy.html` in the order listed in `src/ORDER.txt`.

## Data types
- `TimedLevel`: `{ freq: [Uint8Array(1024), Uint8Array(1024)], wave: [Uint8Array(1024), Uint8Array(1024)], state: 0|1|2, timeStamp: number }`
  (state 2 = playing, same as WMP). Waveform bytes centred on 128. Frequency bytes 0..255.
- `Surface`: `{ w, h, px: Uint32Array(w*h) }` — 0x00RRGGBB little-endian *as the DLL stores it*:
  `px[i] = (r<<16)|(g<<8)|b`, alpha byte 0. (Conversion to canvas RGBA happens only in the shell.)
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
Host (deno-webview/spotify.ts) maintains window.__wmpSpotify = { token, at, clientToken, loggedIn, expiresAt, clientId,
  deviceId (this web player's 40-hex connect id), activeDeviceId, connectionId, hashes: {operationName: sha256},
  state: <last player_state>, cluster: <last cluster> } and dispatches CustomEvents on window:
  "wmp-spotify-token" {token} (only on change), "wmp-spotify-auth" {loggedIn} (from /api/token isAnonymous),
  "wmp-spotify-hash" {op, sha}, "wmp-spotify-state" (detail = player_state; from dealer cluster messages and from the
  page's own PUT connect-state/v1/devices/hobs_* response at load). Observers start at document creation; the overlay's
  JS runs at DOMContentLoaded, so the page reads window.__wmpSpotify first, then listens.
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
Terms: /api/token is what the web player itself calls; Spotify's response notes that third-party use of it breaks the
Developer Terms. This is a personal tool; the token never leaves the page.

## Dev-only (`--dev`; never in a release exe) — hot reload for the Spotify overlay
`npm run dev:spotify` (deno-webview/dev.mjs) rebuilds dist/spotify-inject.js on every change and starts the host with
`--mode=spotify --dev`. The injected bootstrap (deno-webview/spotify.ts) then fetches the bundle at mount time from the
host's worker, `GET http://127.0.0.1:<port>/dev/inject` (CORS + private-network allowed), and opens a second, dev-only
socket to it, `ws://127.0.0.1:<port>/dev` (deno-webview/dev.ts; the page's own `/audio` socket is untouched):
  Host → bootstrap: {"type":"devCss","css":"<the new css>"}  — CSS-only rebuild: the adopted CSSStyleSheet is replaced in
                    place (replaceSync; the host's #chrome/#titlebar square-corner rule is re-appended). No reload.
                    {"type":"devReload"}                     — js or html changed: location.reload(); the document-created
                    script fetches the new bundle; the Spotify login lives in the profile, so it persists.
The page never sees these; it needs no code for them. Vite HMR cannot run in open.spotify.com (CSP script-src).

## Retired: the system-audio application
`WmpVisualizers.exe` (`--mode=app`, release `app-latest`) was retired 2026-09-24. v4 (Now Playing) and v5 (lyrics) now
apply to the screensaver (and, through the same host, to WmpSpotify.exe); the website has neither.

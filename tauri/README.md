# The desktop host on Tauri 2

The screensaver, its player window and the Spotify player, rebuilt on Tauri 2.12 (WebView2 through
wry and tao, the host in Rust) to replace `deno-webview/`. One executable, about 7 MB, no installer,
nothing beside it. `.github/workflows/release.yml` builds it twice on every push to master and
publishes the two downloads: `Alchemy.scr` (AlchemyScreensaver-win64.zip, with `package/`'s install
scripts and README) and `WmpSpotify.exe` (WmpSpotify-win64.zip), the second with the `wmp-spotify`
feature and the Spotify icon. CONTRACT.md v8 is what the page can rely on here.

| Arguments                     | What opens                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `/s`, `/S`, `-s`              | The screensaver: one topmost, undecorated window over the whole virtual screen, off the taskbar. |
| `/c`, `/c:<hwnd>`, or nothing | The player window, `?mode=config`: where the visualizer, preset, fps and scale are chosen.         |
| `/p <hwnd>`, `/p:<hwnd>`      | Exits 0 before anything starts. The preview pane stays black, as it did.                           |
| `--mode=spotify`              | The Spotify player: our page in a window of its own, Spotify's web player beside it (below).      |

`WmpSpotify.exe` (built with `--features wmp-spotify`) treats a launch that names no mode as
`--mode=spotify`, and says so out loud: it starts itself again with the flag and exits (`main.rs`
`relaunch_as_spotify`), so the flag also reaches a running instance of the other exe through the
single-instance plugin (below), which forwards the raw arguments. A default applied only in its own
process would have opened the player there. Measured on Windows: WmpSpotify.exe opened while Alchemy.scr
runs opens the Spotify window in that process, and Alchemy.scr opened while WmpSpotify.exe runs opens
the player.

The arguments are read before Tauri starts (`mode.rs`, the forms Windows was observed to use), so a
preview request never starts a browser. The first argument that looks like one of them wins, which is
what lets `--restart /s` and `/c:98765` through.

```
npm ci && npm ci --prefix tauri      # once, at the repo root
cd tauri
npm run build:win                    # from WSL or Linux -> target/x86_64-pc-windows-msvc/release/alchemy.exe
npx tauri build --no-bundle          # on Windows, and in CI -> target/release/Alchemy.exe
npx tauri build --no-bundle --features wmp-spotify --config tauri.spotify.conf.json   # WmpSpotify.exe
cargo test                           # the argument parser, page updates, lyrics, Spotify's observers, the title bar
```

Both builds run `npm run build` at the root first (`beforeBuildCommand`) and embed `../dist` in the exe.

## Toolchain

**MSVC, cross-compiled from WSL with cargo-xwin.** `npm run build:win` is
`tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc`: cargo-xwin downloads Microsoft's
CRT and Windows SDK headers and libraries once (19 min 31 s the first time here; cached after that),
compiles C with `clang-cl` and links with `lld-link`, which has to be on `PATH` (apt's `lld`, or a
symlink to rustup's `rust-lld`). The icon resource goes through mingw's `windres`
(`RC_x86_64_pc_windows_msvc`), the one piece of mingw left. A release build is under three minutes.

**windows-gnu was the obvious choice and does not work.** The Deno host's audio helper cross-compiled
for `x86_64-pc-windows-gnu` with nothing but a mingw linker, so that was tried first. But the WebView2
loader comes as a static library only for MSVC (`WebView2LoaderStatic.lib`); on the gnu target it can
only be linked as its DLL, and the exe then needs `WebView2Loader.dll` beside it. That is the file
deno-webview embeds and unpacks into `%LOCALAPPDATA%` on first run, and a Tauri exe that needed it
would have to do the same or ship as two files. On MSVC the loader is inside the exe, and tauri-build
links the VC runtime statically too.

**The Windows-side cargo is too old.** The rustup on the Windows side of this machine is 1.61 (2022);
the crate is edition 2024 with `rust-version = "1.90"`. Building on Windows would mean upgrading that
toolchain first; building from WSL does not, and WSL is where the rest of the project is built.

CI builds on `windows-latest` with MSVC, Tauri's supported toolchain (`.github/workflows/tauri.yml`),
runs `cargo test`, and then **checks the exe's imports**: `llvm-objdump -p` lists every DLL it imports,
and the job fails on `vcruntime*`, `msvcp*`, `ucrtbased` or `WebView2Loader`. That is the failure the
Deno host's first `webview.dll` had: an MSVC `/MD` build that imported the Visual C++ Redistributable
and died without a word on a fresh Windows 11 (deno-webview/README.md, "Implementation notes"). The
check keeps it from coming back through any dependency.

The release profile is Tauri's size profile (`lto`, `opt-level = "s"`, one codegen unit, `strip`,
`panic = "abort"`). The last one has a cost worth knowing: a panic anywhere ends the process. ureq 3.4
panics on any https request unless its `native-tls` feature is on (the provider alone is not enough),
and the first LRCLIB lookup took the whole app down with it. A test now makes an https request that
must fail, not panic. Tauri, wry and webview2-com are pinned to exact versions, because the Spotify
view is built on wry and webview2-com directly and must be the same copies Tauri links.

## The origin and the data folder

The page is served by a custom protocol, `wmp`, registered asynchronously (`main.rs serve`). On
Windows Tauri serves a custom protocol as `https://<name>.localhost/`, and `use_https_scheme(true)`
makes that `https://wmp.localhost/`: **the origin the Deno host's virtual host has always had.** The
user's settings live in `localStorage`, keyed by origin, so the same origin means nothing has to be
carried over from one host to the other. Tauri's own `tauri.localhost` would have been a new origin,
and the Deno host has already been through one origin move, with a carry page and one slow launch
(deno-webview/README.md, "The origin"). `.localhost` is also the name that resolves inside the browser,
with no DNS lookup; the two seconds a `.local` name cost are in the same section.

`serve` answers from `../dist` as embedded at compile time, except `index.html`, which is the newest
verified page update when there is one (below). Every answer is `Cache-Control: no-store`, so a newer
exe or page is never shown an older cached copy; a missing file is a 404.

The data folder is `%LOCALAPPDATA%\WmpLegacyVisualizers\tauri\`: `WebView2\` (the profile, with
Spotify's inside it), `window-state.json`, `alchemy.log`, `update\` and `lyrics\`. Two decisions are in
that path:

- **It is read from the `LOCALAPPDATA` variable, as the Deno host always did,** not through Tauri's
  path resolver, which asks the shell for the known folder and ignores the variable. A test points
  `LOCALAPPDATA` at a scratch folder and nothing lands in the real one.
- **`tauri` is a folder of its own, for good,** because a WebView2 user-data folder can be open in one
  program with one set of browser arguments at a time, and a Deno screensaver or WmpSpotify.exe may
  still run beside this host. It never moves: the Spotify login lives in it.
- **The carry-over is a copy, once** (`carry.rs`), recorded by `carried-settings` and `carried-login`
  in this folder. Settings: the Deno `WebView2` profile's `EBWebView\Default\Local Storage` folder
  (LevelDB, unencrypted, keyed by origin, and the origin is the same) copied into this profile before
  WebView2 starts, past the single-instance check. The Spotify login: every cookie of the Deno
  `spotify` profile, read with `Network.getAllCookies` from a hidden web view on that profile (a
  browser of its own for about a second) and set with `Network.setCookies` into `WV2Profile_spotify`
  before Spotify's page first loads, so neither profile's cookie encryption is involved. A profile in
  use (its `EBWebView\lockfile` held) leaves the item for the next launch. The Deno folders are left
  as they were. Verified on Windows 11 (WebView2 154) with synthetic Deno profiles made by the Deno
  host from source: a `localStorage` value read back by the Tauri page, and GitHub's `logged_in`
  cookie (HttpOnly, Secure, a year's expiry) arriving with its flags and expiry to the microsecond;
  0.4 to 0.9 s on the first Spotify launch.

## Measured

Against the Deno host, on the same Windows 11 machine at 150 %, September 2026:

|                                 | Deno host                  | Tauri host                              |
| ------------------------------- | -------------------------- | --------------------------------------- |
| Executable                      | 77 MB                      | 3.97 MB scaffold; 7.2 MB with everything |
| Host process, private memory    | 43.8-45.7 MB               | 4.4-4.7 MB                              |
| First launch, start to painted  | 23.8 s                     | 9.9 s (see the caveat)                  |
| CPU, same window, same visualizer | 28.6 % of a core (median) | 26.7 % (median)                         |

- **The executable.** The scaffold (the page embedded, the screensaver modes, single instance) was
  3,973,120 bytes. The audio
  module added 584 KB and the native title bar 0.86 MB (resvg); with those, page updates and Spotify
  mode the cross-built exe is 7,218,176 bytes. `deno compile` carries the whole Deno runtime, which is
  most of the 77 MB. One saving did not survive: the lyrics parser is a 20-line scanner rather than the
  `regex` crate, which cost 971 KB when audio was its only user, but the Spotify script scan links
  `regex` now, so the crate is in the exe anyway.
- **Memory.** Five interleaved launches of each, the player window: the host process itself is
  4.4-4.7 MB private against 43.8-45.7 MB, and the WebView2 processes are the same size under both
  (232-265 MB private), since they are the same browser. The whole tree is 238-270 MB against 276-289 MB.
  The Deno side ran from source (`deno run`), not as the compiled exe.
- **First launch.** A fresh data folder each: 23,750 ms from process start to the page's first painted
  frame for the Deno host, 9,876 ms for Tauri. **The caveat:** the Deno host ran from source through
  the `\\wsl.localhost` share, so its first launch also read and compiled its modules across that share,
  while the Tauri exe ran from a local copy under `%TEMP%`. The ratio flatters Tauri; a like-for-like
  number needs the released `Alchemy.exe` from a local disk. Warm launches that evening were not
  distinguishable through the noise (4.7-7.6 s against 5.2-8.1 s, five each, WebView2 dominating both).
- **CPU.** Three interleaved rounds, the player window at 1350x930, five seconds to settle, then every
  process of the app's tree as a percentage of one core: 21.3, 26.7 and 30.3 % for Tauri, 22.7, 30.0 and
  28.6 % for Deno. Parity, which is what it should be: the visualizer is the page's, the page is the
  same, and either host costs a fraction of a percent. An earlier comparison read **44 % against 37 %**,
  and it was not the host. That Tauri build set no `alchemyElectron`, so the page ran in website mode,
  which starts on Alchemy, while the Deno host's app mode starts on Battery. Alchemy costs more to draw.
  With both on the same visualizer the difference went away. An A/B across hosts has to pin the page's
  mode and visualizer; the log's page report (source, visualizer, fps, energy) is there to show them.

## Host parity

Everything the Deno host gives the page, the Tauri host gives it too, by other means:

- **The globals** (`host.js`, CONTRACT.md v8): the same names the Deno init script sets, on Tauri's IPC
  and window API. Three differ. `alchemyElectron.loopback` is false, because with it true a page
  without host audio asks `getDisplayMedia`, which WebView2 answers with a share picker.
  `alchemyScreensaver` is merged into rather than assigned, because a plugin's init script runs before
  the window's own: the audio plugin has already put `audio` and `url` there, and the first version of
  `host.js` replaced them with empty fields. And `alchemyCheckUpdate` is new: the Deno host answered
  Help > Check for Player Updates from its worker's `/update`, because its main thread was inside a
  blocking message pump, while a Tauri command is simply async.
- **The player window.** Frameless (`decorations(false)`), 480x360 minimum, window class `AlchemyHost`
  (the Deno host's, for whatever looks for it), and on screen at its final box before WebView2 starts:
  the builder is `visible(true)` and is given the remembered box, read from the window-state plugin's
  own file before the window exists. The plugin's restore is skipped for the player, because it runs
  after the window and its WebView2 exist, which is a window that visibly moves. DWM gets Windows 11's
  rounded corner, no border (`DWMWA_COLOR_NONE`), and a caption colour: a frameless tao window keeps
  `dpi / 96` rows of frame at the top (measured `#EDF5F9`, two rows at 150 %), the strip the Deno host
  removed by hand in `WM_NCCALCSIZE`, and painted the title bar's own top colour it disappears into it.
  These are set from a watcher thread the moment the window exists, not after the builder returns:
  the main thread is inside the builder until WebView2 is up, and for that half second the two rows
  were Windows' grey, `#B7B7B7`. Sampled on screen every 10 ms, they now fade in from the desktop
  straight to the title bar's blue.
- **Occlusion.** `win.rs occluded()` is `win32.ts occluded()` ported: four times a second and on
  activation, the window is covered if it is minimized, cloaked, on no monitor, behind the lock screen
  (the input desktop cannot be opened), or covered pixel for pixel by visible windows that are neither
  layered nor click-through. The page is told on each change, and again at its first painted frame,
  since a change before that reached no page. WebView2 tracks none of this for a window it is embedded
  in (deno-webview/README.md: 27 % of a core, drawing for nobody).
- **Full screen and wake.** F and Esc call `win_full`: Tauri's own full screen, then the virtual
  screen's box set twice (tao keeps a full-screen window on the monitor a new box mostly covers, so the
  first move changes which monitor it thinks it is on and the second is left alone), topmost, and
  `SetThreadExecutionState` holding the display on. The log line carries the state it replaced
  (`0x80000003` on the way out means the display was being kept on). Closing while full screen leaves
  full screen first, so the box the window-state plugin records is the window's own and not the desktop's.
- **Links.** `alchemyOpenUrl` goes through the opener plugin, whose scope in
  `capabilities/default.json` is the project's website and repository. Anything else is refused by the
  plugin and logged. Any script in the window can call it, so the allowlist is the whole of the check.
- **Signed page updates.** `update.rs` is `update.ts` in Rust (ed25519-dalek, sha2, reqwest on the
  system's TLS): the same manifest, the same public key, the same rules — the signature verifies, the
  file matches its hash, it is newer than the page built in, and it needs no more than this host's API
  version, which is read at compile time from `deno-webview/host-api.json` so the two hosts share one
  number while both exist. It asks while WebView2 starts, and the request for `index.html` waits at
  most half a second more for the answer. The cache is never moved backwards: a replayed older manifest,
  still validly signed, does not replace a newer cached page. The file is written before its manifest,
  so an interrupted write leaves nothing that verifies. Ten `cargo test` cases replace
  `update_test.ts`, including one that the manifest in `dist/` describes `dist/` and fits this host.
  Debug builds never update: their page is the working tree's.
- **The fatal dialog.** A panic (through the panic hook, before the abort) or an error out of Tauri's
  run loop is logged and shown in a message box naming the log, except in the running screensaver,
  which nobody is looking at.
- **The log and the marks.** `%LOCALAPPDATA%\WmpLegacyVisualizers\tauri\alchemy.log`, through
  tauri-plugin-log (stdout too in debug builds). Startup stages are `t+<ms>` lines from process start,
  the format deno-webview/README.md's "Startup" tables were measured with; the page's own marks arrive
  as one line at its first painted frame, and its report line (source, visualizer, fps, size, status,
  energy, saved settings) 3 s and 9 s after load, as the Deno host logs them.
- **Browser arguments.** `browserArgs` in `settings.json` (beside the exe, else in the data folder)
  replaces wry's WebView2 arguments, `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection
  --autoplay-policy=no-user-gesture-required`. Unlike the Deno host's `webview.dll`, WebView2 here does
  receive them, so a switch can be tried, or a DevTools port opened, without a rebuild.
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` does not reach it: the arguments wry passes win.
- **The screensaver.** Undecorated, not resizable, topmost, off the taskbar, black, over every monitor
  (set again in physical pixels after creation, because monitors of different scales make the logical
  box approximate). `host.js` hides the settings panel and the cursor and ends it on a key, a click, or
  more than 10 px of mouse travel after a one-second grace; a page with no canvas after 15 s gives the
  desktop back. Only the saver window's `dismiss` is honoured.

## Audio

The Deno host ran a WASAPI helper process and relayed its stdout to the page over a WebSocket. Here the
helper is **in process**, as a plugin (`audio/`): `capture.rs` is the helper's loopback loop,
`media.rs` its Now Playing thread, `lyrics.rs` the relay's LRCLIB lookups, and the page gets **the same
WebSocket and the same frames**, so it needed no change at all. Each socket runs its own capture and
media threads, which stop when it closes: nothing listens to the speakers while no page is.

**The socket is keyed.** The listener binds `127.0.0.1:0`, and its port is findable by any local page
that tries them all; what it serves is the system's sound, what is playing, and transport and wake
commands. So a request is served only with a per-launch key, 128 random bits in the URL the page is
given (`/audio?k=<key>`), and anything else gets 403. The plugin's init script hands that URL only to
`wmp.localhost`, `localhost` (the page off Windows) and `open.spotify.com` (the Deno host's overlay; no
Tauri web view here is ever there), and a client that connects and never completes the handshake is
dropped after five seconds. The Deno host keys its socket the same way.

**A WebSocket, not a Tauri `ipc::Channel`, by measurement.** A Channel is Tauri's own answer to
streaming from Rust to the page, so it was measured against the socket (2026-09-29, the player window,
a −40 dBFS tone, 100 messages a second of 3.8 KB, four runs of 36 s each, as percentages of one core):

| Transport     | Added over no audio at all                                   | Latency, median |
| ------------- | ------------------------------------------------------------ | --------------: |
| WebSocket     | ~3 (host ~1, WebView2 browser and network ~2)                |     0.4-0.5 ms |
| `ipc::Channel` | ~50 (host ~10, browser ~20, network ~4, renderer +17)        |     0.7-1.6 ms |

Each Channel message is an `eval` into the page plus an IPC fetch back through the main thread to
collect the payload; at a hundred a second that is a busy browser process and a busy main thread. A
socket message never touches the main thread or the page's IPC.

**Device changes restart the capture.** A loopback stream stays on the device it was opened on, so a
new default device (headphones plugged in, a switch in the volume flyout) would leave it capturing an
endpoint nothing plays to. The Deno helper only noticed when the endpoint was invalidated; this one also
registers for default-device notifications and restarts on them. A run that got as far as streaming
restarts at once; a capture that cannot start backs off, 0.25 s doubling to 5 s, the Deno host's
schedule, so a missing device is a gap of silence and not a busy loop. The restarted capture keeps
streaming into the same socket and does **not** send `{"rate"}` again: the page used to take a second
rate as a new source replacing itself, whose stop closed the very socket it arrived on, and the audio
died while the status still said "System audio (local)". The page now attaches once per socket as well.

The rest follows the Deno relay: `AUTOCONVERTPCM` so the engine hands over stereo f32 at the device's
own rate (the rate Chromium gives the page, so nothing resamples); every waiting packet sent as one
message per wake-up; a stalled page loses messages past 1 MB unsent rather than growing the host's
memory (the Deno relay's 512 KB, plus room for a frame carrying cover art); `wake` held per socket and
released when it closes. `lyricsPref` refetches only on a change, because the page says "on" as it
connects and that used to look the current track up a second time while the first lookup was out.

## Spotify

The Deno host ran our page as an overlay inside open.spotify.com (CONTRACT.md v6): an injected script,
a shadow root, our code sharing a page and a CSP with Spotify's. This host turns that inside out.

**Two web views in one window.** The window "spotify" loads our own page, the same `index.html` the
player runs, at our own origin, told `alchemyEngine = 'spotify'` before it starts. Spotify's web player,
unmodified, is a child WebView2 in the same window that the host creates with wry itself
(`WebViewBuilder::build_as_child`), outside Tauri, so **no Tauri IPC and no init script is ever in
Spotify's page**. That matters because Tauri's IPC in a page is callable by every script in it: in
Spotify's page, that would be Spotify's scripts and whatever they load. A read-only probe of Spotify's
own world found `__TAURI__`, `__TAURI_INTERNALS__`, `ipc`, `alchemyScreensaver`, `alchemyEngine` and
`__wmpSpotify` all undefined there. Our page talks to it only through the host (CONTRACT.md v8, the
bridge), and `src/adapters/spotify/transport.ts` is all the page code that differs between the hosts.

**One browser, two profiles.** Spotify's view is created in Tauri's WebView2 environment, so it shares
the app's browser process, under a profile of its own (`WV2Profile_spotify`), so its cookies and storage
are not our page's. The other way, a browser of its own, was built and measured on the logged-out web
player 60 s in: our player window alone is 253 MB private; with Spotify's view in the app's browser,
553-560 MB; in a browser of its own, 655-667 MB, and slower to come up (0.7-0.8 s against 0.25-0.55 s).
The shared browser it is, and the switch that measured the other is gone.

**Parked, not hidden.** Spotify's page is shown only while it needs the user: any https page but the
web player (its login, a captcha), or the web player logged out, which is sent to the login page at
most once a minute so a session still anonymous after signing in cannot bounce. The rest of the time it
must still play. The first version hid it with the controller's `IsVisible = false`, and then the
document is `hidden`: Chromium held its first media `play()` until it was shown (still pending after
5 s, with or without the autoplay permission) and throttled its timers (13 ticks of a 1 s timer in
20 s). So it is **parked**: 1x1 px just outside the window's client area, never invisible. Parked, the
page is `visible`, a `play()` starts at once, a 1 s timer ticks 20 times in 20 s, and it stays so with
the window minimized. It is created without focus, and focus goes back to our page when it is parked
again. Autoplay itself is a per-origin permission on its profile
(`COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY` for https://open.spotify.com). Measured with fresh profiles:
wry's `--autoplay-policy` argument alone lets `play()` start, the permission alone does too (and an
`AudioContext` runs), and with neither both are refused (`NotAllowedError`, `suspended`). The permission
stays so that autoplay does not hinge on the browser arguments, which `settings.json` can replace.

**Watched over the DevTools Protocol, and only its Network domain.** The Deno host patched `fetch` and
`XMLHttpRequest` inside Spotify's page to see its traffic. Here the host calls
`CallDevToolsProtocolMethod` and subscribes to the protocol's events on Spotify's view, and
`Network.enable` is the only domain it turns on (a 32 MB body buffer, 16 MB a resource; the largest
script measured 4.3 MB). From that it reads the bearer, client-token and app headers of the web
player's API requests; the persisted-query hashes they send; the hashes its scripts declare (83 and up,
logged out; the search chunk's 17 once `/search` has loaded); its Connect device id; `/api/token`'s
`isAnonymous`; and the connect-state clusters, from the devices PUT's answer and the dealer socket's
frames. `seen.rs` holds those rules as plain functions of what the protocol reported, the Deno host's
injected observers moved out of the page, so they are tested without a web view. **`Runtime.enable` is
never called**: nothing is added to Spotify's page and nothing of Spotify's is changed.

**Our requests run in an isolated world.** `sp_request` does not fetch from the host. It creates an
isolated world in Spotify's main frame (`Page.createIsolatedWorld`) and runs the fetch there
(`Runtime.evaluate` with that context): Spotify's origin and cookies, so the API answers as it answers
the web player, but none of Spotify's JavaScript, so nothing of theirs sees or patches ours. The host
adds the bearer and the headers the web player sends; the page may add only content-type, accept and
app-platform; only Spotify's API hosts and four methods are allowed. Proven logged out with a GET the
web player makes itself (`spclient.wg.spotify.com/library-import/v1/eligible`, with its bearer and
observed client-token, app-platform and spotify-app-version): 200. An exception reports its first line
only, never the expression, which holds the bearer.

**The token never reaches our page.** It lives in Spotify's page and in host memory. Our page learns
`hasToken`, and `window.__wmpSpotify` has no `token`. It is never logged: request lines name the host,
the path and the pathfinder operation or player command, never the variables (a search's words) or the
answer, and the dealer socket, whose URL carries the token, is logged only as "opened". No log line of
any test run holds a token.

Verified logged out on Windows 11 (WebView2 154) with a throwaway profile, the release page in a debug
host: the login page covers our player; our store has `loggedIn=false`, `hasToken=true` and no token
anywhere; File > Log Out lands on accounts.spotify.com/login. Through the bridge with the anonymous
token, searchDesktop, home (its `sp_t` through `sp_cookie`), queryArtistOverview,
queryArtistDiscographyAll, getAlbum, fetchPlaylist and areEntitiesInLibrary answer 200 with data and the
search view renders them; libraryV3 and fetchLibraryTracks answer "User is not authorized", as they
should; `sp_route('/search')` loads the search chunk; a play sends nothing, since an anonymous web
player registers no Connect device. In Spotify Connect the player shows as **"Web Player (Microsoft
Edge)"**: WebView2 is Edge's engine and says so.

Debug builds only: `ALCHEMY_SPOTIFY_PROBE=<url>` keeps the view parked on the web player even logged
out, makes that GET as `sp_request` does, and reports visibility, autoplay and timer ticks;
`ALCHEMY_SPOTIFY_PROBE_PAGE=<js>` runs a script in our page 20 s in, to drive it through the bridge.

## The native title bar

**The problem was a blue window, not a slow one.** The player was on screen at about 50 ms, at its
final box, and then showed a flat Luna-blue rectangle until the page painted: about 460 ms of WebView2
starting and 150-200 ms of page. Spotify's desktop app, warm on the same machine, puts its window up at
about 0.9 s and its UI at about 2.7 s, so this was already faster at both. What read as broken was
the first two thirds of a second: an empty blue window looks like a failure, and a window with its
title bar and a neutral fill looks like an app filling in. WebView2's start cannot be made shorter from
here (deno-webview/README.md measured all of it), so the fix is the first frame: the title bar drawn
natively, from the window's first `WM_PAINT`, with the web view below it.

**In the client area, answered for in `WM_NCHITTEST`.** tao keeps `WS_CAPTION` on a frameless window and
gives the whole window to the client in `WM_NCCALCSIZE`. DWM composes the non-client area itself, so
nothing an application paints there is shown, and `DWMNCRP_DISABLED` brings back Windows 95's sizing
frame (measured by the Deno host). A caption in the client area is Microsoft's own custom-frame recipe,
and the hit test gives back what `WS_CAPTION` gave: `HTCAPTION` drags with Aero Snap and double-click
maximizes; `HTMINBUTTON`, `HTMAXBUTTON` and `HTCLOSE` get hover and pressed looks and act when released
on the button pressed; `HTMAXBUTTON` is what opens Windows 11's **Snap Layouts** on hover; the top edge,
a frame's height of it, falls through to tao's `HTTOP` and resizes unless maximized; and a right-click
opens the **system menu**, by hand, because `DefWindowProc` does that only for a real caption (Alt+Space
it still does itself). In full screen tao drops the frame styles and the strip goes with them.

**The window's own procedure, subclassed as it is created.** No child window: the top-level window has
to answer the hit test anyway, and painting its own client area needs no z-order. The builder does not
return until WebView2 is up, and it pumps messages meanwhile, so the subclass goes on through a
thread-local CBT hook around the builder, the way MFC subclasses its windows, and the first `WM_PAINT`
is already the title bar. Every web view's container (wry's `WRY_WEBVIEW` child) is subclassed too and
clamped below the strip in `WM_WINDOWPOSCHANGING`, so no web view covers it even between wry's resize
and ours, and its WebView2 controller is fitted to what is left; Spotify's parked view is left where it
is. A live resize repaints the strip inside the resize (`RDW_UPDATENOW`), not a frame after it.

**Drawn as Chromium draws the page's.** The gradients are parsed at compile time from the skin's own
stylesheet (`wmp9.module.css`, `theme.css`); the orb and the three caption glyphs are the page's own SVG
files (`src/skins/wmp9/assets/caption-*.svg`, one copy of the artwork for both), rasterised by resvg;
the title is Tahoma Bold through DirectWrite glyph-run analysis, set up the way Skia uses it inside
Chromium: ClearType, coverage sRGB-encoded (closer to Edge than any power law from 1.2 to 3.5, and than
the system's own 1.8), glyph origins a quarter pixel apart, and Tahoma's gasp table honoured. The layout
is Chrome.tsx's, rounded to device pixels the way Chromium rounds it (`LayoutUnit::Round`, borders snapped
down), each rule checked against Edge from 100 to 200 %. A test pins the geometry to Chrome.tsx: change
the page's title bar and `cargo test` fails until the strip follows. The look is built on another
thread while the window is being made, so the first paint only draws.

**The fill under it is `#ECE9D8`.** The window's background and WebView2's default background, until the
page paints, are the menu bar's face, the first row of the skin under the title bar: 93 % of the first
29 rows under the strip on the painted page are that colour, where the old Luna blue was none. The
first frame is the player with its contents not yet in, rather than a blue rectangle.

Measured on Windows 11 at 150 %, warm launches filmed every 20-60 ms: the window at 46-61 ms with the
strip in its first frame, at the remembered box and at a new one; the fill until the page at
0.67-0.8 s; **no all-blue frame**. Against the page's title bar rendered by Edge at 100, 125, 150, 175
and 200 %, the strip's mean difference is 0.29-0.38 per channel, and 0.06-0.15 % of pixels differ by
more than 24, all at glyph and icon edges. On screen against the previous build's HTML title bar the
mean is 4.9, and all of it is the (−9, 0, +5) shift WebView2's colour management gives the page and
GDI does not. Driven by synthetic input: drag, double-click, both snaps, Snap Layouts, the three buttons,
both system menus, the top edge, a live resize (12 frames mid-drag), F and Esc; the page keeps the
keyboard focus throughout. The exe grows by 0.86 MB, resvg.

**The page half went to master first.** The page change (the artwork moved into shared SVG files, and
`#titlebar` hidden when `alchemyNativeTitle` is set) reached master, and so the website, before the host
change was merged into `tauri`. An exe from this branch serves the newest signed page from the website
whenever it is newer than its own (above), and the website is built from master. Had an exe with the
flag met a newer website page without the change, it would have shown the page's title bar under the
native one: two title bars. The page change is inert without the flag, so it could go first safely.
In the page the orb became an `<img>`, but the glyphs stay inline SVG (imported `?raw`): as `<img>`s
they landed a fraction of a pixel elsewhere at 125, 150 and 175 %. The page's title bar is
pixel-identical to before at all five scales.

## Single instance, and test builds

tauri-plugin-single-instance is the first plugin, as it must be: a second launch hands its arguments to
the running process and exits, and the running process opens that mode's window or brings it forward
(`main.rs open`). The screensaver starting while the player is open therefore opens the saver window in
the same process, and so does `--mode=spotify`.

The plugin names its mutex and its message window after tauri.conf.json's `identifier`
(`<identifier>-sim`, `<identifier>-siw`), not after the exe. **Every build with the same identifier is
one instance.** A test build launched while another copy runs does nothing in its own process: its
arguments go to the other copy, and its "second launch" line lands in the other copy's log. A test build
that has to run beside another copy needs an identifier of its own, given at build time
(`--config '{"identifier":"<identifier>.test"}'`), and a `LOCALAPPDATA` of its own, since the data folder
does not depend on the identifier. Nothing on the branch does this automatically; it is the convention
for test runs.

## macOS

Not built or run there. What the code does off Windows, and what a port would need:

- The page is served at `wmp://localhost/`, a different origin from Windows', and the data goes in
  Tauri's own app folders (there is no `LOCALAPPDATA`).
- No system audio: the audio plugin is empty and the page animates on silence. WASAPI loopback has no
  direct macOS counterpart; ScreenCaptureKit's audio capture is the candidate.
- No Spotify mode: every bridge command answers "Windows only for now". WKWebView has no DevTools
  Protocol, so the observer would have to be something else.
- No native title bar: `alchemyNativeTitle` is false off Windows and the page draws its own. The
  equivalent is an `NSView` of the strip's height pinned to the top of the content view (Core Graphics
  and Core Text, the SVGs through resvg into a `CGImage`) with the WKWebView below it and dragging by
  `-[NSWindow performWindowDragWithEvent:]`, or Tauri's `TitleBarStyle::Overlay` with the traffic
  lights kept and the strip drawn under them. Snap Layouts, the system menu and `WM_NCHITTEST` have no
  Mac counterpart.
- `/s`, `/c` and `/p` are Windows' screensaver protocol. A macOS screensaver is a `.saver` bundle the
  system loads, which this exe is not.

# WMP Legacy Visualizers

Windows Media Player's three built-in visualizers — **Alchemy**, **Bars and Waves**, and
**Battery** — reverse-engineered from Ghidra decompiles and ported instruction-for-instruction
into one dependency-free HTML file, wrapped in a hand-rolled WMP 9 / XP "Corporate" player skin.
Alchemy comes from `mpvis.DLL`; Bars and Waves and Battery are built into `wmp.dll` itself.

Fidelity was not eyeballed. Each visualizer was hosted in-process with the real COM objects
behind an IAT-hooked, pinned clock and compared frame by frame against the port. All three are
byte-identical to the real objects for 30,000 consecutive frames: Alchemy on three seeds, Bars and
Waves on all four presets, Battery on all 26. See [Fidelity](#fidelity) below.

## Quick links

Three formats, one port.

| Format | Get it | What it is |
|---|---|---|
| **Website** | https://wmp.ryancircelli.com | Open it, hit play, share a tab with audio. Nothing to install. |
| **Screensaver** | [`screensaver-latest`](https://github.com/ryancircelli/wmp-legacy-visualizers/releases/download/screensaver-latest/AlchemyScreensaver-win64.zip) | `Alchemy.scr`, the same thing full-screen when the machine goes idle. |
| **Spotify** | [`spotify-latest`](https://github.com/ryancircelli/wmp-legacy-visualizers/releases/download/spotify-latest/WmpSpotify-win64.zip) | `WmpSpotify.exe`, the player window as a Spotify client: Spotify's web player runs inside it under the WMP skin, logged in once in its own profile. |
| **iPhone / iPad** | TestFlight (private) | The same Spotify client as an iOS app: Spotify's web player in a WKWebView under the skin. [`ios/README.md`](ios/README.md). |
| **iPod nano skin** | View > Skin | The player as a nano 5G: a click wheel, every page of its menus, the body in nine colours or any hue, brushed aluminium; made for the phone. [`docs/ipod-skin.md`](docs/ipod-skin.md). |

Both Windows downloads are rebuilt on every push, need only the WebView2 runtime (which ships with
Windows 11 and current Windows 10), and are self-contained single files — nothing has to stay next to
them.

**Updates arrive by themselves.** Fixes to the player (the skin, the Spotify features, the
visualizers) reach an installed app at its next launch, with no new download. The app fetches the
page from wmp.ryancircelli.com and uses it only when its signature checks out, and only when it was
built for that version of the app; offline, it keeps the last good copy. A change to the app itself
still needs the new download, and the app says so: a dialog once a day, and Help > Download the
New Version. Help > Check for Player Updates checks right away, and offers to restart with the new
player when there is one.

- **Retired:** the system-audio application `WmpVisualizers.exe` (release `app-latest`) was retired on
  2026-09-24 and is no longer built; the screensaver's settings window (`Alchemy.scr /c`) is the same
  player window.
- **Screensaver:** unzip, then either right-click `Alchemy.scr` → **Install**, or run
  `powershell -ExecutionPolicy Bypass -File .\install.ps1` (no admin rights needed; `-Timeout 300`
  for a 5-minute idle). `uninstall.ps1` restores whatever screensaver was set before.
- **SmartScreen note:** the executables are unsigned, so the first run shows "Windows protected
  your PC" — click *More info* → *Run anyway*. There's no code-signing certificate behind this, so
  that warning isn't going away.

## Audio

In the browser, audio is a screen/tab share: press Play, pick a tab or your screen, and tick
**Share audio**. The video track is discarded the instant the stream arrives.

The application and the screensaver capture the system mix instead, with nothing to click: the
desktop host reads the speakers' PCM through WASAPI loopback, in its own process, and hands it to the
page over a local WebSocket, and the page turns it into the same frequency and waveform bytes an
`AnalyserNode` produces. WebView2 itself offers no way to answer a capture request with a loopback
stream. [`tauri/README.md`](tauri/README.md) has the details, and
[`docs/history/deno-webview.md`](docs/history/deno-webview.md) the measurements from the first host
that forced this design.

## Spotify

`WmpSpotify.exe` is the same WMP 9 window, but it is also the Spotify client. Spotify's own web
player runs inside it, hidden under the skin:

- **Log in once.** The first launch shows Spotify's login page as it is. When you are signed in,
  the WMP skin comes up over it and stays up. The login lives in the app's own profile
  (`%LOCALAPPDATA%\WmpLegacyVisualizers\tauri\WebView2\`), so it survives restarts and new
  downloads; the first launch after the earlier (Deno) version carries its login and settings over.
  Opening WmpSpotify again while it runs brings its window forward. Close it before opening a new
  download, which otherwise only brings the running one forward.
- **Now Playing** shows the track, the artist, the album art and the position, and synced lyrics
  when LRCLIB has them, as in the application. It follows whatever your account is playing, on
  any device. The visualizers follow the music.
- **The right-hand pane is your library**: what is playing and up next, your playlists and albums,
  your Liked Songs, and a search box. Click a playlist or album to open it, double-click it to
  play it whole, and click a song to play from there.
- **Media Library** (the task pane button, View > Media Library, or Ctrl+3) swaps the visualizer for
  WMP 9's library view: a tree of your playlists, saved albums, Liked Songs and search results on
  the left, and the selected one's tracks on the right (Title, Artist, Album, Length). Double-click
  a track to play from there, or press Play all. The playing track is highlighted. The visualizer
  pauses while it is hidden. Now Playing (or Ctrl+1) brings it back, and the window reopens in
  whichever view you left it in. Full screen always shows the visualizer.
- **Media Guide** (Ctrl+2) is your Spotify home: its sections as rows of covers. Click one to play
  it; the ▤ corner (or a right-click) opens a playlist or album in the Media Library.
- **Search** (Ctrl+4, or Ctrl+E to jump to the search box) finds songs, albums, artists and
  playlists.
- **Radio Tuner** (Ctrl+5) lists radio stations for the song and the artist that are playing, for
  the artists you went back to lately, and Spotify's recommended stations. Click ▶ to tune in.
- **Play on Device** (the small disc beside the transport) lists your Spotify Connect devices.
  It lights up while another device is playing, and a click on a device moves playback there.
- **The heart** beside the song likes or unlikes it (Ctrl+D), and its menu adds the song to any
  of your playlists.
- **Everything else is live too.** Click the album art or album name to open the album, the artist
  to see their albums, and the "Playing from" line under the song to open what is playing. Click the
  clock to switch between elapsed and remaining time. File > Open Spotify Link… plays a pasted
  link, and File > Log Out of Spotify signs you out. View has Task Pane and Playlist Pane toggles.
  The Play menu has Shuffle, Repeat (Off, Playlist, Track), Rewind, Fast Forward and volume.
  Help > Keyboard Shortcuts lists the keys.
- **Play, pause, next, previous and seeking** are sent the way Spotify's own player sends them.
  If Spotify refuses a command, the status bar says why, and the button falls back to Windows'
  media controls, as in the application.

| Keys | Does |
|---|---|
| Ctrl+1 … Ctrl+5 | Now Playing, Media Guide, Media Library, Search, Radio Tuner |
| Ctrl+P, Space | Play / Pause |
| Ctrl+S | Stop |
| Ctrl+B / Ctrl+F | Previous / next track |
| Ctrl+Shift+B / Ctrl+Shift+F | Rewind / fast forward 10 seconds |
| Ctrl+H | Shuffle |
| Ctrl+T | Repeat: Off, Playlist, Track |
| Ctrl+Shift+T | Media Library: Details / Tiles |
| Ctrl+E | Search Spotify |
| Ctrl+D | Like / Unlike the playing track |
| Ctrl+L | Lyrics on / off (also the lyrics button beside the clock, in every version) |
| Ctrl+K | Karaoke word highlight on / off |
| F7 / F8 / F9 | Mute / volume down / volume up |
| F, Alt+Enter / Esc | Full screen / leave it |

Your Spotify sign-in never leaves the window. Nothing is sent anywhere except Spotify itself (and
LRCLIB for lyrics, if that option is on).

## Build and test

The page is TypeScript + React, built by Vite (Node 24 / npm). The desktop formats are one Tauri 2
host (`tauri/`, see [`tauri/README.md`](tauri/README.md)), built twice. It replaced a Deno + WebView2
host, retired; [`docs/history/deno-webview.md`](docs/history/deno-webview.md) is that host's design
record.

```sh
npm ci                      # once, and after package-lock.json changes
npm run dev                 # Vite dev server with hot reload
npm run typecheck && npm run lint && npm test   # tsc, eslint, vitest
npm run build               # -> dist/ (below) and alchemy.html at the root
npm run build:wasm          # after editing assembly/*.ts (AssemblyScript): regenerates the
                            # src/engine/**/*-wasm.ts modules, which npm test checks are current
```

`npm run build` writes everything the four formats are made from:

| File | Used by |
|---|---|
| `dist/index.html` | The whole page as one self-contained file: the website, and embedded in every exe |
| `alchemy.html` (root) | A copy of it; open it directly, no server needed (Chromium/Chrome target) |
| `dist/spotify-inject.js` | JSON `{html, css, js}` that the retired Deno host's `WmpSpotify.exe` injected into open.spotify.com; no current host reads it |
| `dist/version.json`, `_headers`, `_redirects` (tools/postbuild.js) | Build stamp; Cloudflare caching/security headers and the `/alchemy` route |

```sh
npm ci --prefix tauri                          # once
cd tauri && npx tauri build --no-bundle        # on Windows -> target/release/Alchemy.exe (Alchemy.scr)
cd tauri && npx tauri build --no-bundle --features wmp-spotify --config tauri.spotify.conf.json
                                               #   -> the same, as WmpSpotify.exe
cd tauri && npm run build:win                  # from WSL or Linux (cargo-xwin; tauri/README.md)
cd tauri && cargo test
npx vite preview                               # serve dist/ on http://localhost:4173/
```

Hot reload while developing:
- `npm run dev` — the website on Vite's dev server with HMR: Tailwind classes, `theme.css` and the
  CSS Modules update in place, components fast-refresh with their state kept (a module that also
  exports non-components makes Vite reload the page instead).
- `npm run dev:app` / `npm run dev:spotify` — the same, in the desktop player / Spotify window:
  `tauri dev` (from WSL: cross-built, run on Windows) with the page from that dev server instead of
  the embedded build. Its own instance and data folder, so it runs beside the installed apps.
  Details in [`tauri/README.md`](tauri/README.md), "Hot reload".

Each build runs `npm run build` first (so `npm ci` must have been run once). CI does the same on
every push to master: `deploy.yml` (website) and `release.yml` (both downloads, on Windows), each
running typecheck, lint and the unit tests before building; a change to the host reaches the website
only after `release.yml` has published the exes that go with it. The Playwright smokes
(`NODE_PATH=$(npm root -g) node tests/shell-smoke.js`, `tests/spotify-smoke.js`, `tests/gl.smoke.js`)
run locally only.

## Fidelity

Every visualizer is byte-identical to the real Microsoft object for 30,000 consecutive frames
(8 min 20 s at 60 fps), on every seed and preset measured:

| Visualizer | Runs | Frames compared | Result |
|---|---|---|---|
| Alchemy (`mpvis.DLL`, 640x480) | 3 seeds | 90,000 | identical |
| Bars and Waves (`wmp.dll`, 354x345) | all 4 presets | 120,000 | identical |
| Battery (`wmp.dll`, 384x288) | all 26 presets, plus 4 of them on a second seed | 900,000 | identical |

Measured on 2026-09-24 and re-run on the TypeScript engine on 2026-09-25 with the same result.
[`docs/EXACTNESS.md`](docs/EXACTNESS.md) has the per-preset table, the input, and the fixes it took.

- **How.** `tools/hostP.ps1` hosts the real DLL in-process and hooks its `_time64`, `srand` and
  `rand` imports, so the clock is pinned and the random stream is known. Both sides get the same
  30,000 frames of a synthetic track (silence, quiet pads, beats, chords, sweeps, noise bursts).
  Every frame's FNV-1a hash of the whole surface and its `rand()` count must match.
- **Coverage.** Alchemy's effects are chosen at random, so `tools/coverage.js` records every effect,
  warp kernel and parameter branch a run exercises. Shorter runs over many more seeds reached every
  reachable combination but one rare cell. They matched too, once the runtime clones below closed a
  single one-pixel difference.
- **The C runtime is cloned.** `sin`, `cos` and `atan2` are operation-for-operation copies of
  `ucrtbase`'s own, because `Math.*` rounds differently often enough to change pixels. They match
  the DLL on CPUs with FMA3, which is every x64 CPU since about 2013.
- **Guarded since.** Any faster engine code must match the verified engine frame for frame:
  `npm run test:golden` renders 45 runs across all three visualizers, seeds, presets and sizes and
  compares each frame's hash with the recorded output of the engine as verified; `npm test` runs a
  short slice of it. Every run goes three times: on WebAssembly (the SIMD passes, Bars and
  Waves' drawing and the `sin`/`cos`/`atan2` clones), on the JavaScript that stays as the fallback,
  and switching between the two mid-run. The
  2026-09-28 speedups (Alchemy about 20%, Battery 16 to 37%, the heavier Bars and Waves presets
  about 18% per frame) passed it byte for byte.
- **What is not compared.** Battery's final stretch to the window is GDI's, not the DLL's, so its
  runs compare the 8-bit image and the whole palette state instead. Bars and Waves ships the colours
  WMP's skin shows. The runs restore the DLL's own preset colours.

## How it was made

1. **Decompile.** Ghidra against `mpvis.DLL` (Alchemy) and `wmp.dll` (Bars and Waves, Battery):
   listings, function maps, and the tables (palettes, presets, parameters) each engine reads.
2. **Spec.** Every decompiled subsystem got a written spec before any code: the resampler and
   shift container, the warp kernels, the draw effects, the scheduler and audio pipeline, and a
   verification log that records every exactness result and every residual as it was found.
3. **Port.** Each spec became a module under `src/engine/` (TypeScript, wrapped 1:1), keeping
   the DLL's own integer truncation, fixed-point shifts, and literal constants rather than
   "fixing" them to cleaner math.
4. **Verify.** `tools/hostP.ps1` drives the real object and the port from the same input at the
   same pinned time. Any mismatch was chased back through the disassembly rather than patched away
   statistically.

The decompiles and specs are not published. Comments that cite paths under `re/` or `spec/` point
into that private reverse-engineering archive.

## Repo layout

| Path | Contents |
|---|---|
| `src/engine/` | The port itself: Alchemy, Bars and Waves, Battery, and the audio front end |
| `src/` | The page around it: the WMP 9 skin, the player model, and the Spotify and capture adapters |
| `tools/` | The verification harness: PowerShell hosts for the real DLLs, reference renderers, A/B scripts |
| `tests/` | Vitest unit tests, fixtures, and the Playwright smokes |
| `docs/` | `EXACTNESS.md`, the frame-by-frame comparison record; `history/`, the retired Deno host's design record |
| `tauri/` | The two Windows desktop formats: one Rust exe for the screensaver, the player and Spotify, built twice (`tauri/package/` is the rest of the zips) |

## A note on the source material

Alchemy, Bars and Waves and Battery are Microsoft's. This repository contains only independently
written code that reproduces their behaviour. It includes no original DLL, no decompiled source and
no extracted binary resource, and neither does any release.

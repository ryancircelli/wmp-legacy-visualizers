# The desktop hosts (Deno + WebView2)

> **Retired.** This is the design record of the Deno + WebView2 host that `tauri/` replaced,
> kept for its measurements: `tauri/README.md` and the Tauri host's comments cite them. The host
> was removed on 2026-09-30; its sources (`deno-webview/`, and the static handler in `deno/`) are
> in git history, last at commit `60d9b23`. The file names below (`main.ts`, `win32.ts`,
> `server.ts`, `spotify.ts`, `assets/`, …) are that host's. Its icon art moved to `tauri/icons/`.

Two of the project's three formats (the third is the website), both compiled from `main.ts`: the
page running in the OS's own browser engine, one file each, 77 MB, no installer and no runtime to
ship — Windows 11 already has WebView2.

| Output               | What it is                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| **`WmpSpotify.exe`** | The player as a Spotify client (`--mode=spotify`, CONTRACT.md v6): open.spotify.com under the WMP skin, own profile. |
| **`Alchemy.scr`**    | The screensaver (system audio + Now Playing captions). The player window in `/c`, plus the `/s` full-screen mode Windows runs. |

The system-audio application `WmpVisualizers.exe` (`--mode=app`, release `app-latest`) was retired
on 2026-09-24; the screensaver's `/c` window is the same player window.

```
deno task compile      # -> dist/Alchemy.exe        (cross-compiles from Linux or macOS)
deno task compile:spotify  # -> dist/WmpSpotify.exe
deno task page         # just the page: npm run build at the repo root -> ../dist (npm ci once first)
deno task audio        # just the WASAPI helper -> native/alchemy-audio.exe (needs cargo + mingw)
deno task test
```

One module, two binaries: `deno compile` bakes `--mode=spotify` into WmpSpotify's argument vector,
and baked arguments come before the ones a process is started with, so nothing on the command line
can turn it into a screensaver or the screensaver into it. Everything else
— the server worker, the audio helper, the window shaping, the page — is the same code.

For the screensaver, rename `Alchemy.exe` to `Alchemy.scr`, then right-click > **Install**, or run
`powershell -ExecutionPolicy Bypass -File .\install.ps1` (no admin rights; `-Timeout 300` for a 5
minute idle). `uninstall.ps1` restores whatever screensaver was set before. The application needs no
installing at all: run it.

Both are unsigned, so the first run shows SmartScreen's "Windows protected your PC" — _More info_ >
_Run anyway_. Short of a code-signing certificate there is nothing to do about that.

## Hot reload (dev)

- **Website:** `npm run dev` (Vite) — HMR for Tailwind classes, `theme.css` and the CSS Modules, and
  React Fast Refresh for components (component state kept). A module that exports anything besides
  components (App.tsx's `makeShell`, Chrome.tsx's `MENU`, …) cannot be fast-refreshed and makes Vite
  reload the page instead.
- **WmpSpotify:** `npm run dev:spotify` (from WSL or Windows) runs `vite build --watch -c
  vite.inject.config.ts`, re-wraps `dist/spotify-inject.js` after each build, and starts the host with
  `--mode=spotify --dev` (the Windows deno through powershell.exe on the `\\wsl$` path when run from
  WSL; `deno task dev:spotify` directly on Windows). In dev mode the injected bootstrap fetches the
  bundle from the host's worker (`http://127.0.0.1:<port>/dev/inject`) instead of carrying it, and a
  worker socket (`ws://127.0.0.1:<port>/dev`, dev.ts) reports each rebuild: **CSS-only → the adopted
  stylesheet is replaced in place** (`{"type":"devCss","css"}`, no reload, state kept); **script or
  markup → the page reloads** (`{"type":"devReload"}`; the login is in the profile, so it persists).
  True HMR is not possible there: open.spotify.com's CSP (`script-src`) blocks module loads from
  localhost, so Vite's client never runs in that page. The file is polled every 300 ms, not
  `Deno.watchFs`'d: a watch on a `\\wsl$` path never fires for writes made from the Linux side.
  Close the window to stop; the script then stops the watch build.

## What it does

| Mode                                      | Behaviour                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WmpSpotify.exe`                          | The player window over open.spotify.com (the overlay is told `mode: "app"`): frameless XP chrome, resizable, its size and position remembered between runs.               |
| `.scr` with `/S` or `/s`                  | Frameless, always-on-top window covering the whole virtual screen. Settings panel and cursor hidden. Any key, click, or >10 px of mouse travel (after a 1 s grace) exits. |
| `.scr` with `/c`, `/c:<hwnd>`, or nothing | The same player window, `?mode=config`: where the visualizer, preset, fps and scale are chosen.                                                                           |
| `.scr` with `/p <hwnd>`                   | Exits 0 immediately. The little preview pane stays black.                                                                                                                 |

The page is embedded in the executable, unpacked to
`%LOCALAPPDATA%\WmpLegacyVisualizers\page\<build>\index.html` and served to WebView2 from the
**virtual host** `https://wmp.localhost/` (see below), with `?mode=screensaver` / `?mode=config`
on the URL plus `v=<build>` — WebView2's cache lives in the pinned user-data folder and
a virtual host's files carry no cache headers, so without a per-build query a freshly installed
`.scr` could show the previous page. A loopback server still runs on an OS-assigned port, but only
for `/audio`.

## The player window

`/c` and the application are the same window, and it has **no native caption**. The page already
draws a Windows XP one (`#titlebar`), and two title bars stacked is one too many, so the window is
`WS_POPUP | WS_THICKFRAME` — no caption, still resizable, still on the taskbar — and the page's
title bar is the real one: `main.ts` binds `alchemyWinDrag` / `alchemyWinMin` / `alchemyWinMax` /
`alchemyWinClose` into it, and `win32.ts caption()` does the Win32 half. Dragging is the standard
`ReleaseCapture` + `WM_NCLBUTTONDOWN`/`HTCAPTION` handoff, so Aero snap and monitor edges behave
normally. A double-click on the bar maximizes; because Windows' modal move loop swallows the second
half of a double-click, the page pairs the two `mousedown`s itself rather than listening for
`dblclick`, which would never arrive. In a plain browser none of those bindings exist and the bar
stays decorative, exactly as before. The skin's status-bar grip works the same way through
`alchemyWinSize`, aimed at `HTBOTTOMRIGHT` instead of `HTCAPTION`: the window's `WS_THICKFRAME`
sizing border is outside the client area, where nothing the page draws can be clicked, so without
that the grip would be a picture of a resize handle rather than one. `WM_GETMINMAXINFO` sets a
480x360 DIP floor — what `WEBVIEW_HINT_MIN` used to ask the library for, answered by our own window
proc now that the class is ours.

Clearing `WS_CAPTION` is not the whole job. `WS_THICKFRAME` reserves a sizing border of its own, and
Windows 11 treats the four edges differently: the left, right and bottom margins are invisible —
DWM's `DWMWA_EXTENDED_FRAME_BOUNDS` puts them outside the frame it paints — while the top one is
painted in the light-theme frame colour. Measured on a 144 DPI display: `GetClientRect` ten pixels
below `GetWindowRect`, DWM's frame flush with the window top, `#EEF5F9` across those ten rows of a
`PrintWindow` capture. That was a pale strip above the page's XP title bar, and `SWP_FRAMECHANGED`
does not touch it — the rows are not stale, they are reserved. `WM_NCCALCSIZE` takes them back the
only way there is: let Windows compute the frame as usual, then put `rgrc[0].top` back where it came
in (`win32.ts ncTop()`, in the window proc `createHost()` registers). It used to need a subclass —
`SetWindowLongPtr(GWLP_WNDPROC)` over the C library's own window — and now the class is ours and the
proc is the window's own. Not while maximized — a maximized window deliberately overhangs the work
area by the border thickness, and that inset is what keeps the page off the taskbar, which is also
why a maximized window never showed the strip. The callback is called on the message-pump thread,
from inside the `webview_run()` the main thread is already blocked in, which is the one place Deno
can run an FFI callback synchronously; it forwards everything else to the original `WNDPROC` and
costs nothing measurable (the page still reports its configured 30 fps).

The cost is the top sizing border, now inside the client area and behind the WebView2 child, so
Windows never hit-tests it: **the top edge no longer resizes.** The other three edges do, the
status-bar grip still drives `HTBOTTOMRIGHT`, and the top ten rows are the page's title bar, which
drags and maximizes — which is what a title bar should do.

That still left the part DWM draws. It is composited outside the window's own surface, so
`PrintWindow` cannot see it and only a screen capture can: Windows 11's rounded corners, which clip
the page's own top corners away, and a 1 px border along the top edge. `win32.ts noDwmChrome()`
turns the border off — `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` — and asks for the corner it does
want: `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND`. Both are re-applied from the `WM_NCCALCSIZE`
hook on `WM_WINDOWPOSCHANGED`, `WM_DPICHANGED` and `WM_SHOWWINDOW`, because DWM recomputes the frame
at each of those. (`DWMWA_BORDER_COLOR` is set-only: `DwmGetWindowAttribute` answers it with
`E_INVALIDARG` — `0x80070057` — which is not a failure to apply it. The corner preference does read
back, and reads `2` at every one of those points on the finished window.)

`DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED` is the obvious third call and is deliberately **not**
made. Measured: it stops DWM compositing the non-client area, Windows falls back to painting the
sizing border the classic way, and 10 px of Windows 95 bevel — `#FFFFFF`, `#E3E3E3`, `#B4B4B4`,
`#696969` — appears down the left, right and bottom. It trades an invisible margin for a visible
grey frame, which is the opposite of the point.

`DWMWA_COLOR_NONE` does not stop DWM drawing the border — it makes it transparent, which looks the
same and is worth knowing when the next person measures it. Forcing the attribute to `0x000000FF`
from outside the process paints it bright red, and a screen capture then shows exactly where it is:
two pixels along the window's top rows, which `WM_NCCALCSIZE` has given to the client, and two
pixels at `client left - 2` down the sides, inside the sizing margin. With `DWMWA_COLOR_NONE` those
same pixels read the page's own gradient at the top and the desktop at the sides, to the value — so
there is nothing painted, only a border rendered with nothing in it. A light ring still visible
around the skin after this is the page's own: `body { padding: 7px }` with `#chrome { inset: 7px }`,
which Options > Player > Show player frame turns off.

The page draws an XP Luna window: a title bar with 8 px rounded top corners, square at the bottom,
and nothing at all in the pixels outside the curve. Nothing the page can do makes those pixels show
the desktop — the WebView2 child composites over its host window, not over what is behind it — so
**the window's corner is DWM's and the page's chrome is square inside it**. `main.ts` injects
`#chrome,#titlebar{border-radius:0}` into the page in this host only (`initScript`), which is the
same rule `template.html` already applies to a maximized window, and DWM rounds the window itself.
Its corner is anti-aliased against whatever is behind the window and costs nothing to keep in step
with a move, a resize or a DPI change.

Two earlier answers to the same problem are worth recording, because both were built and measured
here and both are worse:

- **A window region** (`SetWindowRgn` with a `CreateRoundRectRgn` over the client columns). It works
  — the cut pixels really do show the desktop — but a region cuts whole pixels, so the edge is a
  hard staircase next to the page's anti-aliased curve, and the two curves have to agree to the
  pixel. Where they did not, the crescent between them was painted by nobody and came out white;
  that is the artefact the user photographed, `#FFFFFF` filling the corner outside a blue curve.
- **Per-pixel transparency**, the Electron way: `put_DefaultBackgroundColor` with `A = 0` and
  `DwmExtendFrameIntoClientArea(hwnd, {-1,-1,-1,-1})`, the "sheet of glass". The transparency call
  succeeds (`S_OK`, and the log says `transparent=true`), and the result is **white corners**: since
  Windows 8 an extended frame is not translucent glass but the frame material, which in the light
  theme is near-white. Measured against a black backdrop: 240 pixels of `255,255,255` in the
  top-left corner box, at launch and after every move, resize, minimise/restore and ten seconds of
  idle. The same capture of the DWM-corner build finds none — the corner runs `000000` → `030b18` →
  `184079` → `2c7bf3`, the desktop shading into the page's own blue.

`Webview.background()` (webview_ffi.ts) goes with it: the C library exposes no such setting, but it
hands out its `ICoreWebView2Controller`, and three vtable calls by hand — `QueryInterface` for
`ICoreWebView2Controller2`, `put_DefaultBackgroundColor`, `Release` — set WebView2's own background
instead of leaving it white. With the page square nothing outside it is visible for long, but it is
still what a pixel is before the page has painted, and it is **opaque `#1463EB`**, the title bar's
own blue, so a first paint or a resize shows the skin's colour rather than a white flash. Note the
packing: `COREWEBVIEW2_COLOR` is declared `{A,R,G,B}` and goes in a register, so little-endian puts
alpha in the **low** byte (`a | r << 8 | g << 16 | b << 24`); the other way round the runtime sees a
partial alpha, refuses the call with `E_INVALIDARG`, and keeps its default opaque white.

The left, right and bottom sizing margins are left alone, and DWM composites them away to nothing:
`WM_NCHITTEST` on the finished window answers `HTLEFT`, `HTRIGHT`, `HTBOTTOM`, `HTBOTTOMLEFT` and
`HTBOTTOMRIGHT` on those edges and `HTCLIENT` on the top row, so three edges and both bottom corners
still resize natively while the top row is the page's title bar.

Nothing to reclaim on the screensaver window: it is created `WS_POPUP` with no `WS_THICKFRAME`, so
it has no non-client area in the first place, and `ncTop` is then a no-op on it.

**The window appears once, already finished, with the page in it.** The C library creates its own
`WS_OVERLAPPEDWINDOW` at `CW_USEDEFAULT` and _shows_ it before it starts embedding WebView2, and
that embed takes seconds — recorded here by sampling this process's visible top-level windows every
50 ms: a plain white 982x776 window sat at 228,228 from 0.5 s after launch until 4.4 s, and only
then became the player, restyled and moved to its remembered box somewhere else. One HWND
throughout, but two windows as far as anyone watching is concerned, which is what "two windows open
before consolidating to one" was.

So the library no longer makes the window. `win32.ts createHost()` registers a class and calls
`CreateWindowExW` itself — final style (`WS_POPUP | WS_THICKFRAME | WS_CLIPCHILDREN` for the player,
plain `WS_POPUP` topmost for the saver), the page's own colour as the class brush, the exe's icon,
and **no `WS_VISIBLE`** — and that HWND goes to `webview_create(debug, window)`, whose whole purpose
is to embed into a window the caller already has. Three facts about the vendored DLL (webview
0.12.0) were read off its disassembly rather than taken on trust, because all three decide whether
this works at all:

- The constructor stores `window == nullptr` in an `owns_window` byte, and both the
  `CreateWindowExW` for its own window and the `ShowWindow(SW_SHOW)`/`UpdateWindow`/`SetFocus` that
  follow it sit behind `if (owns_window)`. Given a window it creates no top-level window and **shows
  nothing**.
- The window argument is not the `HWND *` the header's cast implies: it calls `IsWindow(window)` and
  only dereferences the argument when that says no. An HWND passed straight through is taken as is.
- `CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)` is inside that same `if (owns_window)` — a
  host with its own window is assumed to be a Win32 application that has already entered an
  apartment. Deno has not, and without it `webview_create` returns null and nothing comes up at all.
  `createHost` enters the apartment before it creates the window.

What the library's own window proc did for it, ours now does: `WM_SIZE` resizes the `webview_widget`
child it puts inside the host window (which is what resizes the WebView2 controller — the bounds are
that child's client rect), `WM_ACTIVATE` calls `ICoreWebView2Controller::MoveFocus`, without which
the top-level window keeps the keyboard focus and the screensaver cannot be dismissed with a key,
`WM_GETMINMAXINFO` is the minimum size, and `WM_CLOSE`/`WM_DESTROY` end the process. Plus the two it
never did: `WM_NCCALCSIZE` and the DWM re-apply.

**The window is then shown exactly once, as soon as it has been placed** — `showHost()`, a third of
a second after `Process.Start`, maximized if that is how it was left, and several seconds before
there is a page to put in it. See [Startup](#startup) for why the page no longer decides.

`createOffscreen()`, which this replaces, is worth recording as the wrong answer: a `WH_CBT` hook
installed for the length of the constructor, rewriting `x`/`y` in the `CREATESTRUCT` of the
library's window to `-32000,-32000`. It worked — the recording showed one window at `-32000,-32000`
until 1.9 s and at its final box from then on — but it hid a white window instead of not creating
one, and the user was right to reject it: the window was still created, shown and focused before it
had anything to show, `IsWindowVisible` was true the whole time, and everything downstream had to
know that "visible" did not mean "on screen".

Alchemy.exe carries `assets/icon.ico` — the XP-era Media Player orb, drawn for this repo in
`assets/icon.svg` and rendered to the `.ico` by `assets/make_icon.py` — and WmpSpotify.exe carries
`assets/icon-spotify.ico` (16–256 px, rendered from `assets/icon-spotify.svg` in Chromium by
`NODE_PATH=$(npm root -g) node assets/svg_to_ico.cjs assets/icon-spotify.svg assets/icon-spotify.ico`),
each baked in by `deno compile --icon`. The shell uses that resource for the taskbar button;
`win32.ts appIcon()` sets the window's own icon (`WM_SETICON`, what Alt+Tab and the thumbnail ask
for) from the `.ico` **file**, `LoadImageW(LR_LOADFROMFILE)`: both icons are unpacked next to the
DLLs, and dev mode loads them straight from `assets/`, because there the exe is deno.exe and its icon
is the Deno dinosaur. Only a missing file falls back to `ExtractIconExW` on the exe's own path.
The Spotify window also gets its own AppUserModelID, `RyanCircelli.WmpSpotify` (process and window,
with relaunch icon and name), so in dev it is its own taskbar button rather than a Deno one. Verified
in dev on a throwaway `LOCALAPPDATA`: taskbar button and Alt+Tab show icon-spotify, beside an
older-build dev window showing the dinosaur.

Where the window was left is remembered in `%LOCALAPPDATA%\WmpLegacyVisualizers\window.json` —
`GetWindowPlacement`, so a maximized window restores maximized and remembers the box underneath it,
and a box that no longer lands on any monitor is discarded rather than restored somewhere
unreachable. It is written by the **server worker**, not the main thread: `webview_run()` owns the
main thread for the whole life of the window and runs no timer until the window is already gone, and
a 2 s poll from the worker catches every way of closing it, not just the page's own close button.

### The origin, and which instance keeps the settings

Everything the user chooses lives in the page's `localStorage`, which Chromium keys by **origin**,
inside a profile keyed by **user-data folder**. Both used to be decided by a port number, and on the
machine this shipped to that cost the user every setting on every launch.

The origin used to be `http://127.0.0.1:47821/`, with a fallback to an OS-assigned port when 47821
was taken. On this machine **47821 cannot be bound by anything** — WSL's mirrored networking holds
it, with nothing in `netstat` to show for it — so every launch fell back, every launch was a
different origin, and the log read `fallback port: this instance has its own page settings` every
time, with `saved=(none)` behind it. Thirty-odd `WebView2-<port>` profile folders accumulated next
to it.

The page now comes from a **virtual host**: `Webview.virtualHost()` (webview_ffi.ts) calls
`ICoreWebView2_3::SetVirtualHostNameToFolderMapping("wmp.localhost", <page folder>, ALLOW)` and the
page is navigated to `https://wmp.localhost/index.html`. That name is resolved inside WebView2 — no socket,
no port, no listener — so it is the same origin on every launch on every machine, and it is
`https://`, so it is a secure context and the Web Audio and capture APIs the loopback origin was
chosen for are all still there. A virtual host maps a _folder_, so the page embedded in the exe is
unpacked to `%LOCALAPPDATA%\WmpLegacyVisualizers\page\<build>\index.html` first, the same way the
two DLLs and the audio helper already are.

**The name is `.localhost` and may not be `.local`, which cost two seconds a launch.** The first
version of this was `wmp.local`, and every navigation to it sat for **2.02 s** before the document
started: 2025, 2025, 2024, 2025, 2033, 2022 ms from `navigate` to the document's first script over
six launches. A number that flat is a timeout, not work — and `.local` is the mDNS TLD. WebView2
resolves the host name _before_ the virtual-host mapping intercepts the request, so the page was
waiting out a multicast lookup for a name that exists only inside the browser. A single-label name
goes the same way through LLMNR/NetBIOS: `wmp` measured 2030 ms. Measured against the same 330 KB
page, same profile, same launch harness:

| Origin of the page                   | `navigate` -> document's first script |
| ------------------------------------ | ------------------------------------: |
| `https://wmp.local/` (mDNS TLD)      |                **2022-2033 ms** (n=6) |
| `https://wmp/` (single label, LLMNR) |                **2027-2038 ms** (n=3) |
| `https://wmp.localhost/`             |                    **22-32 ms** (n=3) |
| `https://wmp.invalid/`               |                        30-41 ms (n=3) |
| `https://wmp.internal/`              |                        35-43 ms (n=3) |
| `file:///...\index.html`             |                        24-42 ms (n=6) |

`.localhost` is reserved to the loopback by RFC 6761 and Chromium resolves it internally with no DNS
at all, which is why it measures the same as `file://`. `wmp.invalid` and `wmp.internal` measure the
same _here_, but they do reach the resolver — a slow DNS server, or one that answers everything,
could put the stall back — so the name that cannot be resolved off this machine is the one to have.

Renaming the origin means moving the settings, because that is what an origin keys. A launch that
finds no `origin.txt` naming the current host, on a machine whose profile folder already exists,
navigates **once** to `https://wmp.local/carry.html` — a 40-byte file, both host names mapped to the
same folder — and the init script there reads `alchemy.settings` out of `localStorage` and
`location.replace`s to the real page with the value on the URL, where the same init script seeds it
before any page script can read it. The hop is the document's own, not a host round trip, so nothing
is half-moved if the window is closed in the middle of it; the host only writes `origin.txt` when
the page reports the carry, so a launch that fails to finish it tries again rather than losing
anything. That one launch pays the 2 s (it is the old origin, by definition) and no later one does.
Measured on the upgrade: `carrying settings over from wmp.local`, then
`settings carried from wmp.local: 167
chars`, page painted at 4686 ms — and the next launch painted
at 664 ms with `saved={"fps":30,...}`, the settings the previous build had.


Getting to `ICoreWebView2_3` is two QueryInterfaces from what the C library hands out: the
controller's `get_CoreWebView2` is vtable slot 25 (the last method `ICoreWebView2Controller`
declares), and `SetVirtualHostNameToFolderMapping` is slot 71 on the core object — `ICoreWebView2`'s
own 58 methods, then `ICoreWebView2_2`'s 7, then the fourth of `ICoreWebView2_3`'s 5. On a runtime
without `ICoreWebView2_3` the call returns false and the page comes from the loopback server as
before; the log line says which.

The loopback server is now **only** the audio WebSocket, and binds port 0 — any free port. The page
is told the whole `ws://127.0.0.1:<port>/audio` URL in the injected script, so nothing has to guess
it. Chromium does not treat that as mixed content from an `https://` page: a loopback host is
potentially trustworthy. Measured on the virtual-host build: `status="System audio (local)"` and the
`{"rate":48000}` message arriving over a port that is different on every launch.

`WEBVIEW2_USER_DATA_FOLDER` is pinned to `%LOCALAPPDATA%\WmpLegacyVisualizers\WebView2` so the
profile survives renaming or moving the `.scr`, and so the application and the screensaver share one
set of settings. A Chromium user-data folder is not safe for two processes to have open at once, so
exactly one instance can have it — and _which_ one is now asked of the operating system rather than
of a port. `win32.ts claim()` opens `%LOCALAPPDATA%\WmpLegacyVisualizers\profile.lock` with
`CreateFileW`, share mode **0** and `FILE_FLAG_DELETE_ON_CLOSE`, and holds the handle for the life
of the process: while it is open no other process can open that path at all, and when this one exits
— cleanly, killed or crashed — the kernel closes the handle and takes the file with it. There is no
stale lock to recognise, which is exactly what `Deno.open({ createNew: true })` could not promise.
The holder gets `WebView2`; anyone else gets `WebView2-<pid>` and its own settings, which is the
price of a second window never being refused.

Measured: two instances started back to back log `profile: ...\WebView2` and
`profile: ...\WebView2-22500`, both load `https://wmp.localhost/index.html?mode=config`, and killing the
first leaves no `profile.lock` behind. End to end: a run that changes View > Refresh Rate to 30 fps
logs `fps=30 saved={"fps":30,...}`, and the _next_ process logs `fps=29 saved={"fps":30,...}` — each
on its own random server port.

### settings.json

Optional, read from next to the executable first, then `%LOCALAPPDATA%\WmpLegacyVisualizers\`:

```json
{ "pageUrl": "https://wmp.ryancircelli.com/" }
```

With `pageUrl` set, the host loads the published site instead of its embedded copy, so visualizer
changes arrive without reinstalling. If the probe does not answer inside 4 s it falls back to the
embedded page, so being offline shows the saver rather than an error page. Unset (the default) it
never touches the network.

`browserArgs` replaces the Chromium command line passed through
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. **It has no observable effect** — see "System audio" below
for the measurement — and is kept only because the variable costs nothing and a future `webview.dll`
may start forwarding it.

The log is `%LOCALAPPDATA%\WmpLegacyVisualizers\alchemy-scr.log`. Set `ALCHEMY_CONSOLE=1` to also
get it on stdout.

## Startup

The user's verdict on the build before this one was "booting takes way too long — Electron just boots
right into the view", and the recording agreed with him: **nothing at all on screen for 4 to 18
seconds**, then the finished player all at once. The window was deliberately kept hidden until the
page reported its first painted frame, which meant it was downstream of `webview_create` — which
starts a Chromium browser — and of 330 KB of page load after that.

Both of those are still slow, and neither is ours to make fast. What changed is that the window is no
longer behind them. `createHost` registers the class with the skin's own colour as its brush,
`frameless()`/`fullscreen()` place it while it is still hidden, and `showHost()` shows it — once, at
its final box, before WebView2 has been started at all. Everything else moved behind it: the unpack,
`settings.json`, the audio server worker, the `pageUrl` probe. The page paints into a window the user
has already had for five seconds, the way a native application fills in its own window.

Nothing before the window but one `CreateFileW` (the profile lock, which cannot be deferred — a
WebView2 that has been told the wrong user-data folder cannot be told again) and `CoInitializeEx`.

Measured with `mark()` in main.ts (`t+<ms>` lines in the log, milliseconds since the Deno runtime
started) plus the page's own marks, 5 warm and 2 cold launches of `WmpVisualizers.exe` each, started
from hidden PowerShell with `UseShellExecute=false`. Warm columns are medians of 5; the two cold
launches are given individually, because they came out 14.1 s and 4.5 s in the "before" build and a
median of two numbers that far apart describes neither.

| Stage                                        | before, warm | after, warm |   before, cold |   after, cold |
| -------------------------------------------- | -----------: | ----------: | -------------: | ------------: |
| image load + Deno runtime up                 |          133 |         178 |      364 / 129 |      85 / 146 |
| profile claimed (`claim`)                    |          311 |         201 |     1612 / 285 |      97 / 161 |
| `CoInitializeEx`                             |          591 |         223 |     1843 / 523 |     108 / 179 |
| host window created                          |          617 |         312 |     2562 / 568 |     223 / 264 |
| placed at its final box                      |          621 |         321 |     2584 / 577 |     225 / 266 |
| **window on screen**                         |    **8041**¹ |     **366** | **14111/4644**¹ | **274 / 314** |
| native + page unpack                         |          218 |         369 |     1184 / 230 |     275 / 315 |
| audio server bound                           |          548 |        2533 |     1770 / 492 |   2483 / 2252 |
| `webview_create` returned (env + controller) |         4296 |        2458 |   11389 / 2008 |   2423 / 2212 |
| virtual host mapped                          |         4303 |        2535 |   11401 / 2075 |   2485 / 2259 |
| navigate issued                              |         4354 |        2925 |   11725 / 2209 |   2962 / 2630 |
| page: first line of script (`Shell.start`)   |         6467 |        5062 |   14004 / 4389 |   5087 / 4789 |
| page: engine constructed                     |         6475 |        5109 |   14078 / 4398 |   5111 / 4847 |
| page: `DOMContentLoaded`                     |         6487 |        5119 |   14094 / 4411 |   5148 / 4868 |
| page: `load`                                 |         6500 |        5125 |   14103 / 4418 |   5176 / 4881 |
| page: first rendered frame                   |         8027 |        5637 |        — / 4644 |   5332 / 5088 |
| **page painted (`alchemyReady`)**            |     **8041** |    **5645** | **14111/4644** | **5350/5132** |
| audio socket open, helper spawned            |         9210 |        5442 |              — |             — |
| window visible, measured from outside²       |         8348 |         725 |    17608 / 5198 |     750 / 782 |

¹ the same number as "page painted", because that is exactly what used to show the window.
² `IsWindowVisible` polled every 15 ms from a separate process, which carries 200-300 ms of
PowerShell's own overhead — it is the loose upper bound on the row above, and it agrees with it.

So: **window on screen 8.0 s → 0.37 s warm**, and on the two cold launches 14.1 s and 4.6 s → 0.27 s
and 0.31 s. The whole of it — page painted, visualizer running — 8.0 s → 5.6 s warm. The spread over every
launch of each build: **4.2-18.5 s before, 0.61-0.89 s after**.

`webview_create` and the page rows come out lower in the "after" column too, but only the page rows
are the change (the deferred unpack and audio, and the deferred script). `webview_create` is Chromium
and swings between 1.5 s and 14 s with what else the machine is doing; the two suites are not a
controlled comparison of it, and it is not what was fixed. What was fixed is that it is no longer in
front of the window: in the "before" column the window is downstream of it *by construction*, which is
why the improvement in the row that matters does not depend on the machine at all.

Where the remaining time goes, and why none of it is in front of the window:

- **`webview_create`, 0.47-0.55 s.** The single largest cost of a launch and entirely inside the
  WebView2 runtime: it creates the environment, starts a browser process and creates the controller.
  The 2.3-14 s this row used to claim was the machine, not the call — remeasured, five warm launches
  on the same box now read 473, 488, 491, 500 and 543 ms, and a minimal Deno script with nothing in
  it but this DLL, this profile and a `data:` URL reads 490-650 ms for the same call (see
  [The 2 s that was in the hostname](#the-2-s-that-was-in-the-hostname)). Measured from outside, the
  browser process appears 100 ms into the call, the GPU process at 270 ms and the first renderer at
  430 ms, so the whole of it is Chromium coming up. Nothing keeps a browser alive between launches —
  ours is the only client of this user-data folder, so every launch starts one — and there is no API
  that would change that. The C API exposes no split between environment and controller creation, so
  it is timed whole.
- **`navigate` to the first line of page script, ~50 ms.** Renderer startup and compiling 330 KB of
  JavaScript, with the renderer already warmed by `webview_create`. This row used to read **2.1 s**
  and the explanation above it — "WebView2 cold-start, not the page" — was wrong: 2.02 s of it was
  the mDNS lookup of the old `wmp.local` virtual host, and renaming the host to `wmp.localhost` is
  the whole of the fix. The page's own share is the 8 ms from `Shell.start` to `Shell.start done`
  and the ~90 ms to the first rendered frame.
- **Image load + Deno runtime, ~40 ms warm.** An 81 MB `deno compile` binary being mapped and
  bootstrapped, before a line of this module runs. It is the floor on "window on screen" and the
  only way under it is to stop using `deno compile`.

What was actually wrong, beyond the window itself:

- **The unpack ran on every launch and byte-compared the DLLs.** `unpackNative` read each embedded
  DLL and the audio helper out of the exe and compared them to the copy on disk with
  `cur.every((b, i) => b === bytes[i])` — half a megabyte through a per-element JavaScript closure,
  every launch, in front of the window. 0.4-1.6 s of a cold start. Now a stamp file
  (`unpacked.txt`) naming the build is read first, and three `statSync` calls confirm the files are
  really there; the unpack runs on a first run or an upgrade and never again. It also sweeps the page
  directories older builds left behind, which is what the comment claimed and nothing did.
- **The port the audio worker bound was awaited in front of the window.** 0.2-1.4 s of nothing. The
  worker is started after the window now, and its port is awaited *after* `webview_create` — it binds
  on its own thread while that call blocks this one, so the answer is always already there. Its
  deadline is armed at the await and not at the `new Worker`, because a timer armed before
  `webview_create` spends the whole of it expiring and then races the answer: measured on a launch
  where the worker had its port at 337 ms and `webview_create` took 6.3 s, the old 5 s timer won and
  the page was told there was no audio server when there had been one for six seconds.
- **`settings.json` was read before the window** to build
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, which only has to exist before `webview_create`.
- **A `pageUrl` that does not answer cost 4 s,** awaited on its own line between `webview_create` and
  `navigate`. The probe is started before `webview_create` and awaited after it, so it is 4 s of
  WebView2's own startup instead of 4 s added to it.
- **The log cost 20-30 ms a line.** `Deno.writeTextFileSync(..., { append: true })` opens, writes and
  closes; in `%LOCALAPPDATA%` with Defender watching, six lines before the window were most of what
  happened before the window. One handle is opened and held instead.
- **The page's 330 KB was a classic inline `<script>`,** which blocks the parser where it stands: the
  browser had the whole skin in the DOM and would not paint a pixel of it until the script had been
  compiled and run. It is `<script type="module">` now — deferred by definition — so the chrome
  paints first and `Shell.start` runs after it. Safe because every `src/` module is an IIFE that
  talks through `window.Alchemy`; there is not one top-level declaration in any of them.
- **Attaching audio blocked the first frame.** `Shell.start` opened the system-audio WebSocket
  synchronously, which spawns the WASAPI helper, and a process spawn plus WASAPI device
  initialisation pushed the first rendered frame from 190 ms after the ticker starts to two seconds.
  The attach now waits for the first painted frame (`onFirstFrame` in src/90-shell.js).
- **The profile lock was not the problem**, which is worth recording because it was the first
  suspicion. Every single-instance launch in the log claims `...\WebView2` and shares one warm
  Chromium profile; the `WebView2-<pid>` folders only ever belong to a genuinely concurrent second
  instance. `claim()` is doing exactly what it says.

Two things follow from the window existing before the page does, and both are handled:

- Its close button is live from 380 ms, which is before there is a WebView2 to terminate. `quit()`
  saves the window box and calls `Deno.exit(0)` when there is no webview yet — otherwise the window
  would take the click and do nothing for the next several seconds. Observed: a launch closed at
  12.6 s, while `webview_create` was still running, exits 0 and writes `window.json`.
- `WM_ACTIVATE` fires when the window is shown, which is before there is anything to hand the focus
  to, so the `MoveFocus` that message exists for is done again by hand once the controller is up.
  Without it the top-level window keeps the focus and the page never sees a key. For the same reason
  the host window answers `WM_KEYDOWN` and the three mouse-button messages itself in screensaver
  mode: the page's own dismiss handlers do not exist for the first few seconds, and a screensaver
  that ignores the user is the one thing a screensaver must not be.

`alchemyReady` is kept, and is now only a log line: the page still calls it two frames after `load`,
and it is what the "page painted" row above is measured from.

### The 2 s that was in the hostname

The pass above left two numbers behind that were written off as "the WebView2 runtime, not ours":
`webview_create` at 2.5 s and another 2.1 s from `navigate` to the page's first line of script. The
user's comparison was Electron painting a page in 0.5-1 s on the same class of machine, and he was
right that 4.5 s inside WebView2 for a warm, shared profile is not normal. Both numbers were
measured properly this time, from the outside in, and one of them was ours.

The baseline first: a minimal Deno script with nothing in it but this `webview.dll`, this
`CoInitializeEx`, our own hidden `createHost` window, and a navigation — no worker, no audio, no
unpack, no page. All launches hidden, `ProcessStartInfo` with `UseShellExecute=false`, five or six
runs each, medians:

| # | Experiment                                                | `webview_create` | `navigate` -> first page script |
| - | --------------------------------------------------------- | ---------------: | ------------------------------: |
| 1 | minimal script, fresh profile in `%TEMP%`, `data:` page   |     949 ms (n=6) |                           39 ms |
| 2 | minimal script, the app's pinned `%LOCALAPPDATA%` profile | **540 ms** (n=6) |                           30 ms |
| 3 | as 2, plus `--autoplay-policy=no-user-gesture-required`   |     529 ms (n=5) |                           29 ms |
| 4 | as 2, plus `--disable-gpu`                                |     536 ms (n=5) |                           26 ms |
| 5 | as 2, the real 330 KB page over `https://wmp.local/`      |     532 ms (n=6) |                     **2078 ms** |
| 6 | as 5, over `https://wmp.localhost/`                       |     460 ms (n=3) |                       **73 ms** |
| 7 | as 5, over `file:///`                                     |     565 ms (n=6) |                           92 ms |
| 8 | as 5, over `http://127.0.0.1:<port>/`, no cache headers   |     576 ms (n=4) |                          104 ms |
| 9 | as 8, with `Cache-Control: max-age=31536000, immutable`   |     516 ms (n=4) |                           82 ms |

What that says, line by line:

- **`webview_create` is ~0.5 s on this machine, not 2.5 s.** Every warm launch of the finished
  application now reads 473-543 ms for it, and the minimal script reads the same, so the 2458 ms in
  the table above was what else the box was doing that evening — the row's own caveat ("swings
  between 1.5 s and 14 s") was the true part of it. Rows 3 and 4 are flat because
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` never reaches the browser: `Get-CimInstance Win32_Process`
  on the running `msedgewebview2.exe` shows
  `--embedded-browser-webview=1 --webview-exe-name=deno.exe
  --webview-exe-version=2.6.4 --noerrdialogs --embedded-browser-webview-dpi-awareness=2
  --mojo-named-platform-channel-pipe=...`
  and nothing else — no `--autoplay-policy`, no `--disable-gpu`, not even with both set. That is the
  same finding as "System audio" below, arrived at from the other end, and it is why neither switch
  could have mattered. `--disable-gpu` was an experiment only and is not shipped; there is nothing
  to ship, since it never arrives.
- **Every launch is a cold browser start, and that is not fixable.** Counted before and after each
  launch: six `msedgewebview2.exe` processes belong to the Windows shell's own WebView2 client
  (`...\MicrosoftWindows.Client.CBS_...\EBWebView`), ours bring it to twelve, and ours are gone
  0.1-0.6 s after the process exits. A WebView2 browser process lives only as long as a client holds
  it, so nothing is warm across launches: from the outside, the browser process appears ~100 ms into
  `webview_create`, the GPU process at ~270 ms and the first renderer at ~430 ms, which is the whole
  of the call. A relaunch that starts while the previous browser is still shutting down costs
  nothing measurable — fourteen back-to-back launches, 402-564 ms each. (One 19.9 s `webview_create`
  was seen, once, on the second-ever launch against a brand-new profile, and never again in thirty
  launches; unexplained and not reproducible.)
- **Defender is not the cost, and its settings were left alone.** Real-time protection is on, with
  no exclusion covering either folder, and the pinned profile in `%LOCALAPPDATA%` is _faster_ than a
  freshly created one in `%TEMP%` (row 2 against row 1) — which is the warm-profile effect, not the
  path. **The runtime channel is not it either:** registry `pv` for the Evergreen Runtime is
  153.0.4234.48, `edgeupdate` and `edgeupdatem` are both Stopped, and the leftover 153.0.4234.32
  folder next to it is a previous version awaiting cleanup, not an update in progress.
- **Row 5 against rows 6-9 is the whole of the 2.1 s**, and it is the virtual host's _name_: see
  [The origin](#the-origin-and-which-instance-keeps-the-settings) for the mDNS lookup and the table
  of host names. `.local` -> `.localhost` is the fix, and it is worth 2.0 s of every launch.
- **The page is not re-fetched or recompiled needlessly, and the http server would not be faster.**
  Rows 6, 8 and 9 answer the code-cache question by measurement: WebView2's V8 code cache needs a
  cacheable `http(s)` response and a virtual host serves no cache headers, but the virtual host is
  _still_ the fastest of the three (73 ms against 104 ms uncached and 82 ms cached over loopback),
  because what the code cache would save is smaller than the loopback socket and HTTP round trip it
  would cost. Of the 73 ms, ~30 ms is the document and ~45 ms is parsing and compiling 330 KB of
  JavaScript. The page stays on the virtual host, `v=<build>` stays on the URL, and nothing needs
  cache headers.
- **The mapping is already in front of the navigation.** `SetVirtualHostNameToFolderMapping` is
  called as soon as `webview_create` returns and ~30 ms before `navigate`, and that navigation is
  the only one the process makes: `virtual host ... true` at t+504 ms, `navigate issued` at t+533 ms
  in the log of a warm launch.
- **An explicit `ICoreWebView2EnvironmentOptions` is not reachable.** The C library creates the
  environment itself inside `webview_create`, the C API has no hook before that, and the one
  documented way in from outside — the arguments environment variable — is the one this DLL drops.
  Anything needing real environment options (the autoplay policy, a language, a fixed-version
  runtime) needs `CreateCoreWebView2EnvironmentWithOptions` called by hand, which means replacing
  the library rather than configuring it.

The timeline, five warm launches of `WmpVisualizers.exe` each, same box, same evening, medians —
"before" is the build in the table above, "after" is this one:

| Stage                                      | before, warm | after, warm |
| ------------------------------------------ | -----------: | ----------: |
| image load + Deno runtime up               |            3 |           3 |
| host window created                        |           25 |          24 |
| **window on screen**                       |       **47** |      **43** |
| `webview_create` returned                  |          564 |         491 |
| virtual host mapped                        |          578 |         513 |
| navigate issued                            |          631 |         546 |
| page: first line of script (`Shell.start`) |         2676 |         595 |
| page: `DOMContentLoaded`                   |         2689 |         604 |
| page: `load`                               |         2694 |         609 |
| **page painted (`alchemyReady`)**          |     **2813** |     **692** |

So: **painted 2.81 s -> 0.69 s warm**, all of it out of the `navigate` -> first script gap, which
went 2189 ms -> 159 ms. The window itself was already 47 ms and is untouched. The spread over all
five launches: 2674-3154 ms before, 658-795 ms after. A cold launch was not re-measured — this box
has not been rebooted since the fix and the runtime's own files cannot be evicted on purpose — but
the 2.02 s was a name resolution on every navigation, warm or cold, so it comes off a cold launch
too; the rest of a cold launch is the same Chromium start the table above measured.

One launch pays more than before, once: the upgrade itself, which navigates to the old origin to
pick the settings up (4686 ms, measured). See
[The origin](#the-origin-and-which-instance-keeps-the-settings).

## System audio

The screensaver visualizes whatever the speakers are playing, with no picker, no permission prompt
and no click. WebView2 cannot do that itself, so two things sit outside the browser:

```
alchemy-audio.exe            WASAPI loopback on the default render endpoint
   | stdout: u32 sample rate, then interleaved stereo f32
audio.ts (in the server worker)
   | ws://127.0.0.1:<free port>/audio  -- {"rate":48000}, then whole frames
src/90-shell.js Shell.useLocalAudio
   | a 2048-sample ring -> Blackman FFT -> the same bytes an AnalyserNode makes
the visualizers
```

The status line reads **System audio (local)** when it is running, and the helper only exists while
a page is connected: it is spawned when the socket opens, killed when it closes, and it exits by
itself if the host dies, because its stdin pipe closes with it. A helper that fails (a device change
invalidates the endpoint) exits non-zero and is restarted with backoff — 0.25 s doubling to 5 s —
while the page animates on silence in the meantime.

### Why the page analyses the PCM itself

The obvious design is an `AudioWorklet` feeding the existing `AnalyserNode` pair. It cannot work
here, and the reason is worth writing down: **WebView2 drops `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
on the floor** with the `webview.dll` this uses. Measured, not assumed —
`Get-CimInstance Win32_Process` on the running `msedgewebview2.exe` shows the `--user-data-dir` this
sets (that env var _is_ honoured) and no trace of anything from the arguments variable, neither
`--autoplay-policy` nor a `--force-device-scale-factor` added purely as a probe.

So Chromium keeps its default autoplay policy, and a screensaver has no user gesture to offer:
`AudioContext.state` is `suspended` forever, `resume()` returns a promise that never settles, and a
suspended context runs no graph at all — every `AnalyserNode` in it reads digital silence no matter
what is fed to it. A silent-sink context (`sinkId: {type: 'none'}`) is gated the same way.

`OfflineAudioContext` is not gated, and one rendering a 2048-sample buffer through a real
`AnalyserNode` gives exactly the right bytes — but it costs ~4.3 ms per frame and cannot be reused,
so it would burn a quarter of a 60 fps budget on allocation. The analysis is ~35 lines of JS
instead: a Blackman window over the most recent 2048 samples, `|X[k]| / fftSize`, `20log10`, mapped
across the calibrated −93/−15.1 dB window, with `smoothingTimeConstant` applied to the magnitudes.
That is the `AnalyserNode`'s own definition, the one `tools/gen_frames.py` already mirrors.

It is checked three ways at once in `tests/shell-smoke.js` step 17: a 1 kHz-ish tone at −20 dBFS
(bin-centred, so scalloping cannot blur the answer) through this path, the same tone through a real
`AnalyserNode` on the share path, and the value `tools/gen_frames.py` computes for it. All three
read **194 at bin 43**.

### Limitations

- **Exclusive-mode apps.** A player that opens the endpoint in WASAPI exclusive mode (some ASIO-ish
  and bit-perfect setups) bypasses the mix the loopback tap reads, and the visualizer sees silence.
- **No default render endpoint** — headless boxes, or every device disabled — means the helper exits
  non-zero at startup and keeps being retried; the page animates on silence.
- **Device changes** are handled by dying and being restarted, which is a gap of a second or so of
  animation on silence, not a seamless switch.
- **Windows' mono-audio accessibility setting** (`HKCU\Software\Microsoft\Multimedia\Audio`,
  `AccessibilityMonoMixState`) makes both captured channels identical, so the left and right halves
  of a visualizer move together. That is the machine's mix, not this code: it was on here, which is
  why the first captures came back with `L == R` to the bit.
- The helper captures the **default** endpoint only. Per-application or per-device capture would be
  `AudioClient::new_application_loopback_client`, which the `wasapi` crate also exposes.

### Now Playing and lyrics

The same helper and the same socket also carry what is playing (CONTRACT.md v4) and its lyrics (v5),
as text frames; the binary PCM path is untouched. Only the app and the screensaver/config window
run the helper, so the website never sees any of this.

```
alchemy-audio.exe  media thread: GlobalSystemMediaTransportControlsSessionManager (WinRT)
   | stderr: one {"type":"media",...} JSON line per change, and once a second while playing
   | stdin:  {"cmd":"playpause"|"play"|"pause"|"next"|"prev"|"seek","position":s} lines
audio.ts           caches the art (the helper sends it only when it changes) and fills it into
                   every frame; turns page {"type":"mediaCmd"} frames into stdin lines;
                   on each new track asks lyrics.ts
lyrics.ts          LRCLIB /api/get, falling back to /api/search (closest length); 5 s timeout;
                   cached as JSON in %LOCALAPPDATA%\WmpLegacyVisualizers\lyrics\<sha1>.json
```

The helper polls the current session every 500 ms and is woken early by `CurrentSessionChanged`,
`MediaPropertiesChanged`, `PlaybackInfoChanged` and `TimelinePropertiesChanged`. Position is the
timeline's `Position - StartTime`, run forward from `LastUpdatedTime` while playing (most apps only
publish it on a state change or a seek), but never from before a resume it saw: for a moment after
a resume the timeline still carries the pause's stamp. Art is `GetThumbnailAsync`'s stream read
whole and base64'd by `CryptographicBuffer`, dropped above 200 KB; it is re-read only when the
track or the properties change. Any failure in the media thread is logged and costs nothing but the
metadata: the PCM keeps flowing. The page's `{"type":"lyricsPref","enabled":false}` stops every
LRCLIB request and answers with a `"none"` lyrics frame.

Limitations:

- **Apps that do not republish the timeline after a seek** leave the position running on from the
  old one until their next state change. Windows' own `MediaPlayer` is one (measured: seeking it to
  100 s moved playback but not the published timeline). Spotify and Chromium are reported to publish
  on seek; not measured here.
- **Apps that publish no timeline at all** report `duration: 0` and a position that stays 0, and
  their lyrics come from the search fallback, first synced hit.
- **Spotify** (reported, not measured here) publishes the title first and the art a moment later (a second
  `MediaPropertiesChanged`), so the first frame of a track can have `art: null` or the previous
  cover for up to a second; browsers publish the page's `navigator.mediaSession` artwork, which is
  often larger than 200 KB and then arrives as `null`.
- The "current" session is Windows' choice (the most recently active one), the same one the
  volume flyout shows; there is no picker.
- A track whose duration arrives after its title is looked up twice (the first is usually a
  search); stale answers are discarded, errors are not cached.

### Building the helper

`audio/` is a ~350-line Rust crate on the `wasapi` crate plus the `windows` crate it already pulls
in (0.62, features `Foundation`, `Media_Control`, `Storage_Streams`, `Security_Cryptography`). It cross-compiles from WSL with no sudo
and no MSVC:

```sh
rustup target add x86_64-pc-windows-gnu        # rustup itself installs into ~/.rustup
sudo apt install gcc-mingw-w64-x86-64          # or, with no sudo, apt-get download + dpkg-deb -x
deno task audio
```

`cargo-xwin` (option (b) in the brief) was not needed: neither `clang` nor `lld` is on this box, and
the mingw route wanted only a linker — and `x86_64-w64-mingw32-dlltool`, which the `windows` crate's
`raw-dylib` imports need on `PATH` (the apt package brings it; a `dpkg-deb -x` of it needs
`<dir>/usr/bin` on `PATH`). The linker's "corrupt .drectve at end of def file" warning from that
step is binutils being fussy and is harmless. `x86_64-pc-windows-msvc` in a `windows-latest` runner was not
needed either — the release workflow cross-compiles the helper on the same ubuntu runner that
cross-compiles the screensaver, so there is still one job and no Windows runner.

The result is **351 KB** (270 KB before Now Playing), imports nothing but system DLLs —
`kernel32`/`ole32`/`oleaut32`/`combase`/`msvcrt`/`ntdll` and two `api-ms-win-core` sets, no mingw
runtime DLLs beside it — and starts in well under 200 ms. It is **GUI-subsystem on purpose**
(`#![windows_subsystem = "windows"]`): a console-subsystem child of the GUI-subsystem screensaver
gets a console allocated for it and flashes a black window at every launch. `main_test.ts` asserts
that subsystem byte, the same way it asserts the screensaver's own.

## Trade-offs against the Electron wrapper it replaced

|                | Electron                                        | this                                      |
| -------------- | ----------------------------------------------- | ----------------------------------------- |
| Download       | 325 MB folder, DLLs must stay beside the `.scr` | 77 MB, one file                           |
| Browser engine | ships its own Chromium                          | the OS's WebView2 (already on Windows 11) |
| System audio   | works, `audio: 'loopback'`                      | works, WASAPI loopback helper + WebSocket |
| Multi-monitor  | one kiosk window per display                    | one window spanning the virtual screen    |
| Runtime memory | ~200 MB                                         | ~60 MB plus the shared WebView2 processes |
| Build          | `electron-packager`, Node toolchain             | `deno compile`, cross-compiles from Linux |

The multi-monitor difference is a consequence of the design: `webview_run()` is a blocking Win32
message pump, so a second window means a second process, a second WebView2 user-data folder and no
shared `localStorage`. One window covering `SM_CXVIRTUALSCREEN` x `SM_CYVIRTUALSCREEN` covers every
monitor from one process instead, with the visualizer stretched across the desktop rather than
repeated per screen.

## One Spotify window, one login

The Spotify login lives in the WebView2 profile `%LOCALAPPDATA%\WmpLegacyVisualizers\spotify`, and
one profile can be open in one process only (`spotify.lock`, `claim()`). A second instance used to
get a throwaway `spotify-<pid>` profile, which is logged out, and the log showed that happening on
every launch of a new download while the old one, or the dev window, was open. Now a second
WmpSpotify finds the other instance's window (class `AlchemyHost`, title `WMP Spotify`) and the
program its process runs (`planSecond` in `main.ts`):

- **The same program** brings that window to the front and exits.
- **Another copy of WmpSpotify**, such as a new download, sends the old one `WM_CLOSE`, waits for
  its lock and then for WebView2's `EBWebView\lockfile` (the browser outlives its host by about
  0.3 s, measured), and opens the same profile, login included.
- **Anything else** holding the profile still gets a throwaway one, and the log says which program.

The dev window (`--dev`) has a profile of its own, `spotify-dev`, so it never holds the app's login.

## Page updates

The page an exe runs can be newer than the exe (`update.ts`, CONTRACT.md v7). Each deploy publishes
`update.json` and its Ed25519 signature beside `index.html` and `spotify-inject.js`; CI signs with
the `UPDATE_SIGNING_KEY` secret, and the public half is a constant in `update.ts`. At launch a
worker thread (`update_worker.ts`) asks for the manifest while WebView2 starts. The main thread
cannot: it spends that time in one blocking call and the rest of its life in the message pump, and a
fetch started there never finished. The host waits at most half a second more once WebView2 is up.
A copy is used only when the signature verifies, the file matches the manifest's sha256, it is newer
than the page built in, and it needs no more than this exe's `HOST_API`. The good copy is cached in
`%LOCALAPPDATA%\WmpLegacyVisualizers\update` and verified again from disk at every launch, so a
late answer serves the next launch and an offline one keeps the last. The screensaver serves the
cached `index.html` through the same `wmp.localhost` virtual host, so its settings stay. Dev mode
never updates.

**Help > Check for Player Updates** asks the same question on demand. By then the main thread is
inside the message pump, so the page asks the server worker instead: `/update` on its loopback port,
with the same CORS answers as the dev bundle. The worker runs `update.ts`'s `check`, caches a newer
page, and answers `{running, ready, hostUpdate, error}`. Restart Now calls `alchemyRestart`: the host
spawns itself again with `--restart` and quits, and the new instance waits up to 10 s for the old
one's profile lock instead of treating it as a second window. The spawn has to be detached: Deno ends
its children when it exits otherwise (measured), and the relaunch died with the old window.

The latest verified manifest is cached as well. When its `host` differs from this exe's own (a hash
of the host's sources), a newer exe is out: the page is told (`window.alchemyHostUpdate`), shows a
dialog at most once a day, and adds Help > Download the New Version. `alchemyOpenUrl` opens that
download in the user's browser and nothing else: any script in the window can call a binding, so
the host allows only the project's own GitHub and website addresses.

## Implementation notes

`jsr:@webview/webview` is **not** used, though `native/WebView2Loader.dll` is its 0.9.0 release
artifact and `webview_ffi.ts` declares the same symbols. Its loader downloads both DLLs from GitHub
on first run and copies `WebView2Loader.dll` into the process's _current working directory_ — which
for a screensaver launched by Windows is `C:\Windows\System32`, and is not writable. Here the DLLs
are embedded by `deno compile --include native` and unpacked once into `%LOCALAPPDATA%`.

`native/webview.dll` is the same C library its release ships, webview **0.12.0** (what
`webview_version` and the disassembly above are about), but built by `native/build-webview.sh`:
MinGW-w64 with the C++ runtime linked in. The release DLL is an MSVC `/MD` build that imports
`MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll` from the Visual C++ Redistributable,
which a freshly installed Windows 11 does not have: there the window flashed blue and the process
died loading the DLL, without a word. The rebuilt DLL imports only what Windows ships (a test in
`main_test.ts` keeps it that way), and anything that still escapes startup is now logged and shown
in a message box, except by the running screensaver.

What the host injects into the page, before any page script: `window.alchemyElectron`
(`{loopback, mode}`, the name the page has always looked for) and `window.alchemyScreensaver`
(`{audio, url}`) — `audio` is true only when the helper was unpacked, and the page opens `url` for
system audio in preference to asking for a display-media loopback. `?audio=ws` does the same thing
in a plain browser against any server that serves `/audio`. See `../NOTES-ui.md`.

A window nobody can see does not draw. WebView2 tracks no occlusion for a window it is embedded in:
measured 2026-09-29, the player under an opaque window drew at 60 fps, 27 % of a core. `win32.ts
occluded()` asks four times a second, and whenever the window is activated, whether it is minimized,
cloaked (another virtual desktop), on no monitor, behind the lock screen, or covered pixel for pixel
by visible, non-layered windows above it. Layered and click-through windows never count: the
full-screen GeForce and Game Bar overlays are both. The host tells the page on each change
(`window.alchemyOccluded`), and every frame loop in it (the visualizer's, `useRaf`) stops until the
window is seen again. Covered: 0.2 % of a core. Half covered or under an overlay: unchanged.

`gui_subsystem.ts` flips two bytes in the compiled PE header, `Subsystem` 3 (console) -> 2 (GUI).
`deno compile` has no flag for it and a console-subsystem screensaver opens a console window next to
itself.

## Verified on Windows 11 (build 26200, WebView2 runtime 153.0.4234.48)

The application, September 2026 (`WmpVisualizers.exe`, 77.0 MB), all through hidden PowerShell:

- One visible top-level window, titled `WMP Legacy Visualizers`, style `0x940F0000` (caption bit
  clear, `WS_THICKFRAME` set), 1100x720 DIPs = 1650x1080 physical on this 150% display, page URL
  `?mode=app`.
- No native strip above the page. `GetClientRect` is flush with `GetWindowRect` at the top
  (`ncTop=0`, client 1630x1070 inside a 1650x1080 window) and rows 0-3 of a `PrintWindow` capture,
  at x=100, 300 and 600, are the page's own blue — `#1463EB #2A7AF2 #408FF8 #3A8EFA` against the
  skin of the day it was fixed, `#84C4FA #83C4F9 #83C3F8 #82C2F7` after the next skin pass moved the
  outer frame. Before `noTopFrame()` the same capture read `ncTop=10`, client 1630x1060, and ten
  rows of `#EEF5F9` above them. It holds through the whole lifecycle: as launched, resized to
  1350x930 at 210,135, maximized (`ncTop=10` again, client 2400x1600 at screen 0,0, so the border is
  off-screen and row 0 is still the page), and restored.
- Nothing Windows draws is left around it either. On a screen capture — `CopyFromScreen`, because
  DWM's decorations are outside the window's own surface and `PrintWindow` renders the window
  without them — all four corners of the client rect are the page's own frame colour (`#85C6FC`,
  `#85C6FC`, `#84C5FB`, `#84C4FA`) and the centre of the top edge is `#84C4FA`. Before
  `noDwmChrome()` those corners read `#1D1D1D` — the desktop, because Windows 11's rounded corner
  had clipped the page away — and the top edge `#404040`, the 1 px border. The sizing margins and
  everything outside the window rect read as whatever is behind the window (`#17181D`-`#23242A` over
  a dark terminal, the same 4 px further out), so nothing is painted in them. Unchanged after a
  resize, a maximize and a restore, and identical for `/c`. `WM_NCHITTEST` still answers `HTLEFT`,
  `HTRIGHT`, `HTBOTTOM`, `HTBOTTOMLEFT` and `HTBOTTOMRIGHT` on the edges, `HTCLIENT` on the top row.
- The rounded corner, September 2026, on the 150% display, against a black full-screen backdrop so
  "shows the desktop" is measurable (`CopyFromScreen` — a corner is DWM's business, not the
  window's). The top-left corner reads `000000` `030b18` `184079` `2c7bf3` down the diagonal: the
  backdrop, two anti-aliased steps, the page's own blue. A 26x26 box at each of the four corners and
  an 8-row band along the top and bottom edges contain **no pixel with R, G and B all above 200** —
  at launch, after a `SetWindowPos` move, after a resize, after minimize/restore, after maximize and
  restore, and after ten seconds of idle. The same scan of the transparent-background build reads
  240 pixels of `255,255,255` in that corner box in every one of those states.
  `DWMWA_WINDOW_CORNER_
  PREFERENCE` reads back `2` at every point, `DWMWA_BORDER_COLOR` answers
  `E_INVALIDARG` because it is set-only, hit-testing and the resize edges are unchanged, and
  `body.maximized` still squares `#chrome` (`zoomed 1` on the maximized capture).
- The launch, recorded by sampling this process's visible top-level windows every 15 ms: **nothing
  until 0.61-0.89 s, then exactly one**, `AlchemyHost`, style `0x960F0000`, at `140,90 900x620` — the
  box it was left at — and at the same box at every sample after. At the moment of first visibility a
  `PrintWindow` capture is `20,99,235` at the top rows and in the middle of the window, `ncTop=0`: the
  class brush, the skin's own Luna blue, the window finished and empty, several seconds before there
  is a page in it. Before the window was shown early, the same recording found nothing at all for
  4.2-18.5 s and then the finished player; before `createHost` owned the window, it found the
  library's own default-styled white 982x776 window at 228,228 from 0.5 s to 4.4 s, and the
  `createOffscreen()` build in between showed that window at `-32000,-32000` for the same seconds.
  `embedded in our window: true` in the log is `webview_get_window` answering with the HWND it was
  handed, which is how the build knows the library did not make one of its own.
- What is on screen at every moment of a launch, and never white: the class brush from 0.37 s
  (`CreateSolidBrush(0x00EB6314)`, forced to paint by `UpdateWindow` because nothing pumps messages
  between showing the window and `webview_create`), then `put_DefaultBackgroundColor` — set while the
  WebView2 child is still 0x0, before `resizeWebview` stretches it over the client area — then the
  page's own title bar. All three are the same colour on purpose, which is why a `PrintWindow` sample
  at 0.37 s, at 3 s and after the page has painted all read the same blue. `page painted 2390 ms after
  navigate` in the log is now only a log line: see [Startup](#startup) for the whole timeline.
- Everything the library's window proc used to do, done by ours: resized to 900x620 and the page
  redraws to the new client rect (`880x610`, corners sampled `#8090B3`, so the WebView2 child
  followed the window); asked for 200x150 and clamped to `720x540`, which is the 480x360 DIP floor
  on this 150% display; maximized to `-10,-10 2420x1620` with `ncTop=10` and `zoomed=1`, page
  filling 2400x1600; restored to `140,90 900x620`; `WM_CLOSE` exits 0 and `window.json` has
  `{"x":140,"y":90,"w":900,"h":620,"max":false}`. Keyboard focus reaches the page — `/S` ends on
  `exit: key Escape` with code 0, which it only can because `WM_ACTIVATE` calls `MoveFocus` into the
  WebView2.
- `/S`: `AlchemyHost "Alchemy screensaver" 0,0 2400x1600`, style `0x94000000`, ex
  `WS_EX_TOPMOST | WS_EX_TOOLWINDOW`, the Battery visualizer full-screen (`v-saver.png`). `/p 12345`
  exits 0 with no window at all. `/c` opens the same remembered `900x620` box on `?mode=config` with
  the same blue top rows, and exits 0.
- Two at once: both get a window, the second logs `profile: ...\WebView2-39568` and its own
  `server on 127.0.0.1:53744`, and both close with code 0 leaving no `app`, `saver` or
  `alchemy-audio` process behind. System audio while a tone played: `energy=9747`, `ws=207@48000`.
- The origin and the profile: `page https://wmp.localhost/index.html?mode=app&v=<build>` and
  `virtual host wmp.localhost -> ...\page\<build>: true`, `profile: ...\WebView2`, and a _different_
  `server on 127.0.0.1:<port>` on each launch. Changing View > Refresh Rate to 30 fps through the
  page's own menu logs `fps=30 saved={"fps":30,...}`; the next process logs
  `fps=29 saved={"fps":30,...}`. Two instances at once: the second logs
  `profile: ...\WebView2-22500` and loads the same page; `profile.lock` is gone once both are
  killed. `/p 12345` still exits 0 with no window, `/s` still covers 2400x1600 at 0,0 and still ends
  on `exit: key Escape` with code 0.
- The icon: `[System.Drawing.Icon]::ExtractAssociatedIcon` on the built exe returns the orb, the
  taskbar button shows it, and `WM_GETICON` answers non-zero for `ICON_BIG` and `ICON_SMALL` (it
  answered 0 before `appIcon()`, with the button already orbed from the file's resource).
- `main_test.ts` asserts the first appearance and the top rows: one visible window, of our class,
  the first time anything of this process is on screen, already at the box it still has three
  seconds later, with the page painted in it. Run `deno test -A` on Windows, or from WSL, where it
  stages the exe under `%TEMP%` because Windows will not execute from `\\wsl.localhost`. It asserts
  the rows are blue the page painted rather than one exact gradient — a native frame is eleven
  points of blue away from neutral, every blue the skin has put there is over a hundred — so a skin
  pass does not break it. The probe must call `SetThreadDpiAwarenessContext` first — PowerShell 5.1
  is DPI-unaware, and without it `GetWindowRect` and the capture come back divided by the scale
  factor (1650x1080 reads as 1100x720, the default 982x776 window as 655x517) with the
  frame/title-bar boundary smeared across three rows.
- Full chrome: the page treats `app` the way it treats `config`, not the way it treats
  `screensaver`.
- `System audio (local)` with `energy=2848` and `ws=1790@48000` while a tone played through the
  default endpoint (`System.Media.SoundPlayer`, in process, no player window).
- Resized to 900x620 at 140,90; `window.json` recorded it; `WM_CLOSE` ended the process with exit
  code 0; the next launch came up 900x620 at 140,90 — logged as `app window 1350x930 at 210,135`,
  the same rectangle in physical pixels.
- Nothing left behind: no `WmpVisualizers`, no `alchemy-audio`, and `msedgewebview2` back to the
  count it had before the run.
- `Alchemy.scr` unaffected: `/p 12345` exits 0 with no window, `/c` opens the same remembered
  1350x930 box on `?mode=config`, `/S` covers the virtual screen at 2400x1600 with
  `WS_EX_TOPMOST | WS_EX_TOOLWINDOW`, and all three exit cleanly. (Test the arguments with
  `CreateProcess`, not `ShellExecute`: the `.scr` default shell verb is `"%1" /S` and swallows
  whatever else is passed.)

The screensaver, as verified when it was built:

- `/S` as launched by the shell's own `.scr` verb: frameless 2400x1600 window on the virtual screen,
  no taskbar, no cursor, no console window, 60 fps.
- Space bar exits: `exit: key`, `run() returned`, process gone.
- `/p 12345` exits 0 with no window; `/c:98765` and `/c` open the config window.
- Settings persistence across executables: a build that wrote `{"vis":"bars","preset":2,"fps":30}`
  in `/c` was followed by `Alchemy.scr /s`, which came up `vis=bars:2 fps=30` — stable origin plus
  pinned user-data folder both hold.
- 62 MB working set for the host process.

System audio, same machine, September 2026 (helper 270 KB, screensaver 80.7 MB):

- `/c` and `/S` with an 11 s tone playing through the default endpoint (`System.Media.SoundPlayer`,
  in-process, no player window): status `System audio (local)`, `ws=1771@48000` messages relayed,
  `energy=7300` and `energy=6162` respectively — the same log line reads `energy=0` when nothing is
  playing, which is how "attached but silent" is told apart from "not attached".
- The helper alone, driven from a shell: `rate 48000`, 283680 frames in 5.91 s of wall clock
  (realtime, no drift), RMS −9.3 dBFS against a tone whose RMS is −9.3 dBFS.
- `Get-Process alchemy-audio` shows **zero windows** for its PID, and the process is gone within two
  seconds of the `.scr` exiting. A full `/s` run has exactly one visible top-level window, the saver
  itself.
- `/c` window: style `0x940F0000` —
  `WS_POPUP | WS_VISIBLE | WS_THICKFRAME | WS_MINIMIZEBOX |
  WS_MAXIMIZEBOX | WS_SYSMENU`, caption
  bit clear — 1100x720 at 96 DPI equivalent (the size is scaled by `GetDpiForWindow`, without which
  it came up two thirds of its size on this 150% display). A `PrintWindow` capture shows one XP
  title bar and no native one; a double-click posted to the page's title bar maximized the host
  window. Re-verified after `noTopFrame()`: the same `ncTop=0` and the same four blue rows as the
  application, through launch, resize, maximize and restore — `/c` and the application are one
  window and one code path.

## Spotify mode (`WmpSpotify.exe`) — measured 2026-09-24

`--mode=spotify` navigates to https://open.spotify.com/ in its own profile
(`%LOCALAPPDATA%\WmpLegacyVisualizers\spotify`) and injects `spotify.ts`'s script: token capture at
document creation, then, as soon as `document.body` exists, `#wmp-root` (open shadow root, adopted sheet,
html) and the bundle's JS. It used to wait for DOMContentLoaded, which waits for Spotify's deferred
scripts: measured 2026-09-28 from source on Windows, navigate -> overlay mounted went from 4.1 s to
0.24-0.38 s, while Spotify's own token still came at 4.3-5.5 s. Measured on the user's machine (WebView2 153):

- open.spotify.com's CSP is `script-src` (with `'unsafe-eval'`) + `frame-ancestors` only; Trusted Types
  are not enforced. No violation from the overlay; `wmp.localhost` and the `ws://127.0.0.1` audio socket
  both reachable from the page. accounts.spotify.com gets no overlay (hostname guard).
- Bearer captured logged out and in, but **every `api.spotify.com/v1` call answers 429** (`API rate limit
  exceeded`, Retry-After 6–55 s) — from the first request of a fresh launch, for 9 minutes straight. The
  web player itself only uses `api-partner` (pathfinder GraphQL) and `*spclient*`, which answer 200.
- Widevine and PlayReady `requestMediaKeySystemAccess` resolve; playback works in the WebView2.
- The helper's GSMTC sees the session as `msedgewebview2.exe` with title/artist/art, lyrics resolve, SMTC
  play/pause controls it, and WASAPI loopback carries the audio.

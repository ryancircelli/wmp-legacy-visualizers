#!/usr/bin/env -S deno run -A --unstable-ffi
// The WMP Legacy Visualizers host: Deno + the Windows WebView2 control, via the `webview` C library.
//
// One module, two executables (deno.json: `compile` and `compile:spotify`), told apart by an
// argument baked in at compile time:
//
//   Alchemy.scr           — the screensaver. Windows hands it /s = run, /c or /c:<hwnd> =
//                           configure, /p <hwnd> = preview thumbnail, nothing = configure.
//   WmpSpotify.exe        — the Spotify player (CONTRACT.md v6), compiled with `--mode=spotify`.
//                           Baked arguments come first, so nothing Windows could pass turns it into
//                           a saver.
// (The system-audio application, WmpVisualizers.exe / `--mode=app`, was retired 2026-09-24.)
import { AUDIO_PATH } from "./audio.ts";
import { Webview } from "./webview_ffi.ts";
import { type Bundle, type Dev, spotifyScript } from "./spotify.ts";
import { DEV_BUNDLE_PATH, DEV_SOCKET_PATH } from "./dev.ts";
import {
  caption,
  claim,
  coInit,
  createHost,
  frameless,
  fullBox,
  fullscreen,
  fullToggle,
  type Geom,
  placement,
  resizeWebview,
  showHost,
} from "./win32.ts";

/**
 * The page's origin, which is a name WebView2 resolves inside the browser and not a socket
 * (`Webview.virtualHost`). Everything the user chooses lives in `localStorage`, which is keyed by
 * origin, so this is the one string that may not change without carrying the settings over
 * (`carry.html` below): it is what makes settings survive a relaunch, and what lets the config
 * window and the running screensaver see the same ones.
 *
 * It is `.localhost` for one measured reason. The name it used to be — `wmp.local` — put **2.02 s**
 * in front of every single navigation, and the flatness of that number is what gives it away: 2025,
 * 2025, 2024, 2025, 2033, 2022 ms from `navigate` to the document's first script over six launches,
 * where the same 330 KB page off `file://` starts in 28 ms. `.local` is the mDNS TLD, and a
 * single-label name (`wmp`, measured at 2030 ms) goes the same way through LLMNR/NetBIOS: WebView2
 * resolves the host *before* the virtual-host mapping intercepts the request, so the page waited out
 * a multicast lookup that could never answer. `.localhost` is reserved to the loopback by RFC 6761
 * and Chromium resolves it internally with no DNS at all: 22-43 ms to the same document.
 * (`wmp.invalid` and `wmp.internal` measure the same, but they reach the resolver, so a slow or
 * hijacking DNS server could put the stall back; `.localhost` cannot.)
 */
const VHOST = "wmp.localhost";

/** Where the settings were kept before `VHOST` was `.localhost`, and where a machine that has run
 * an earlier build still has them: `localStorage` is keyed by origin, so they have to be carried
 * over once (`carry.html`). */
const VHOST_OLD = "wmp.local";

/** The page's own settings key (src/90-shell.js), which is the whole of what is carried over. */
const LS_KEY = "alchemy.settings";

/**
 * File > Log out in Spotify mode: one navigation that ends the session and lands on the login page.
 * accounts.spotify.com/logout expires sp_dc and sp_key on .spotify.com and 303s to `continue`
 * (measured 2026-09-24). The web player's own link (www.spotify.com/logout/) logs out too but lands
 * on the anonymous web player, not the login page; no cookie manager is needed either way.
 */
export const SPOTIFY_LOGOUT = "https://accounts.spotify.com/logout?continue=" +
  encodeURIComponent(
    "https://accounts.spotify.com/login?continue=" +
      encodeURIComponent("https://open.spotify.com/"),
  );

const APPDIR = `${Deno.env.get("LOCALAPPDATA")}\\WmpLegacyVisualizers`;

// The WASAPI loopback capture helper (audio/src/main.rs), embedded next to the two WebView2 DLLs
// and unpacked with them. It is what gives the page system audio, which WebView2 itself cannot.
const AUDIO_EXE = "alchemy-audio.exe";

/** The window icons: WmpSpotify.exe has its own, the screensaver and its /c window the orb. */
export const ICONS = { spotify: "icon-spotify.ico", default: "icon.ico" } as const;

/** Unpacked next to the DLLs, [name, folder in the exe]. The icons are here because the window
 * loads its icon from a file (win32.ts appIcon): in dev mode the exe is deno.exe, whose own icon is
 * the Deno dinosaur. */
export const UNPACK: [string, "native" | "assets"][] = [
  ["WebView2Loader.dll", "native"],
  ["webview.dll", "native"],
  [AUDIO_EXE, "native"],
  [ICONS.default, "assets"],
  [ICONS.spotify, "assets"],
];

/** A file: URL as a Windows path, including a \\wsl$ share's (a URL with a host). */
export function winPath(u: URL): string {
  const p = decodeURIComponent(u.pathname).replaceAll("/", "\\");
  return u.host ? `\\\\${u.host}${p}` : p.replace(/^\\/, "");
}

/** Which .ico the window loads: in dev straight from assets/ (nothing is unpacked for a page that
 * is not ours to serve), otherwise the unpacked copy; a missing file falls back to the exe's icon. */
export function iconPath(mode: string, dev: boolean, nativeDir: string, base: string): string {
  const name = mode === "spotify" ? ICONS.spotify : ICONS.default;
  return dev ? winPath(new URL(`./assets/${name}`, base)) : `${nativeDir}\\${name}`;
}

/** WmpSpotify's own taskbar identity (win32.ts createHost sets it on the process and the window):
 * in dev mode the process is deno.exe, which would otherwise group it with every other Deno. */
export function appIdOf(mode: string): string | undefined {
  return mode === "spotify" ? "RyanCircelli.WmpSpotify" : undefined;
}

/** The build this exe was compiled from, used to cache-bust the page URL. */
const version: string = await Deno.readTextFile(new URL("../dist/version.json", import.meta.url))
  .then((t) => JSON.parse(t).version as string)
  .catch(() => "dev");

/** Opened on the first line and held: `undefined` means not yet, `null` means it could not be.
 * `Deno.writeTextFileSync(..., { append: true })` opens, writes and closes every time, and in
 * %LOCALAPPDATA% on a machine with Defender watching it that was 20-30 ms a line — half of
 * everything that happens before the window appears, spent on the log describing it. `writeSync` on
 * a held handle is one syscall and is not buffered, so a `Deno.exit` loses nothing. */
let logFile: Deno.FsFile | null | undefined;
const enc = new TextEncoder();
function log(msg: string) {
  try {
    if (logFile === undefined) {
      Deno.mkdirSync(APPDIR, { recursive: true });
      logFile = Deno.openSync(`${APPDIR}\\alchemy-scr.log`, { create: true, append: true });
    }
    logFile?.writeSync(enc.encode(`${new Date().toISOString()} [${Deno.pid}] ${msg}\n`));
  } catch {
    logFile = null; // nothing to be done about a log that cannot be written
  }
  // No console in a GUI-subsystem exe: stdout is an invalid handle and writing to it throws.
  try {
    if (Deno.env.get("ALCHEMY_CONSOLE")) console.log(msg);
  } catch { /* no console attached */ }
}

/**
 * A startup stage, stamped with how long the process has been alive.
 *
 * `performance.now()`'s origin is the runtime's own start, a millisecond or two after the process's:
 * the difference between one of these and the wall clock of the launch is the image load plus the
 * Deno runtime's boot, which is the one part of startup nothing inside the process can see. Every
 * number in the before/after table in README.md "Startup" came off these lines, and one write to an
 * already-open handle is cheap enough to leave them in.
 */
const mark = (s: string) => log(`t+${performance.now() | 0}ms ${s}`);

/** Where the player window was last left. Shared by the app and the screensaver's /c window —
 * both are the same window, and neither is improved by coming up somewhere else every time. */
const GEOM_FILE = `${APPDIR}\\window.json`;
const MIN_W = 480, MIN_H = 360; // below this the WMP chrome has nowhere left to go

function loadGeom(): Geom | null {
  try {
    const g = JSON.parse(Deno.readTextFileSync(GEOM_FILE));
    return typeof g?.w === "number" ? g as Geom : null;
  } catch {
    return null; // first run, or a file someone edited into nonsense
  }
}

/** settings.json beside the exe wins over the one in %LOCALAPPDATA%. */
function settings(): Record<string, string | boolean> {
  const exeDir = Deno.execPath().replace(/[\\/][^\\/]*$/, "");
  for (const p of [`${exeDir}\\settings.json`, `${APPDIR}\\settings.json`]) {
    try {
      return JSON.parse(Deno.readTextFileSync(p));
    } catch { /* absent or malformed: try the next one */ }
  }
  return {};
}

/** Where the two DLLs and the audio helper land, and where the page is served from. Both are
 * immutable per build — the page directory is even named after the build — which is what lets a
 * relaunch of the same build skip the unpack entirely (`unpacked()`). */
const NATIVE_DIR = `${APPDIR}\\native`;
const PAGE_DIR = `${APPDIR}\\page\\${version.slice(0, 12)}`;

/** One line naming the build whose files are in place, written once both unpacks have finished. */
const STAMP = `${APPDIR}\\unpacked.txt`;

/** One line naming the origin the user's settings are under. Absent, or naming an older one, is
 * what makes a launch carry them over from `VHOST_OLD` before it shows the page. */
const ORIGIN_FILE = `${APPDIR}\\origin.txt`;

/**
 * Whether this build's files are already on disk, so there is nothing to unpack.
 *
 * The unpack used to run on every launch and, for the DLLs, byte-compare every byte of the copy on
 * disk against the copy embedded in the exe: half a megabyte through a per-element JavaScript
 * closure, in front of the window, to conclude that the same build is still the same build.
 * Measured 0.4–1.6 s of a cold start.
 *
 * The stamp is not on its own the evidence — the files are. A user who deletes the native directory
 * by hand has to get it back, so the three files are stat'd as well: three stats against half a
 * megabyte of comparison, and no way for a stale stamp to serve files that are not there.
 */
function unpacked(): boolean {
  try {
    if (Deno.readTextFileSync(STAMP).trim() !== version) return false;
    for (const p of ["WebView2Loader.dll", "webview.dll"]) Deno.statSync(`${NATIVE_DIR}\\${p}`);
    Deno.statSync(`${PAGE_DIR}\\index.html`);
    return true;
  } catch {
    return false; // no stamp, another build's stamp, or a file somebody removed
  }
}

/**
 * The two DLLs are embedded in the exe (`deno compile --include native/`), but Deno.dlopen
 * needs a real path, so they are unpacked once into %LOCALAPPDATA%. webview.dll imports
 * WebView2Loader.dll by name, and Windows resolves that against PATH — not against the
 * directory of the DLL doing the importing — so PATH gets the directory prepended.
 */
async function unpackNative(): Promise<boolean> {
  const dir = NATIVE_DIR;
  await Deno.mkdir(dir, { recursive: true });
  const copied: string[] = [];
  let complete = true;
  for (const [name, from] of UNPACK) {
    // A missing file is the audio helper (a build without a Rust toolchain has none) or an icon
    // (the window then keeps the exe's own); the two DLLs failing here would fail again, loudly,
    // at dlopen.
    const bytes = await Deno.readFile(new URL(`./${from}/${name}`, import.meta.url)).catch(() =>
      null
    );
    if (!bytes) continue;
    const dst = `${dir}\\${name}`;
    // Byte comparison, not size: two builds of the audio helper differing only in a linker flag
    // came out exactly the same length, and a size check left the stale one in place.
    const cur = await Deno.readFile(dst).catch(() => null);
    if (!cur || cur.byteLength !== bytes.byteLength || !cur.every((b, i) => b === bytes[i])) {
      // A second instance may hold this DLL open; its copy is the same build anyway.
      copied.push(name);
      // A helper still running from another instance keeps its file locked: the copy fails, and
      // the stamp must not say this build is in place, or the old helper serves it for ever.
      await Deno.writeFile(dst, bytes).catch((e) => {
        complete = false;
        log(`unpack ${name}: ${e.message}`);
      });
    }
  }
  Deno.env.set("PATH", `${dir};${Deno.env.get("PATH") ?? ""}`);
  mark(
    `native unpack: copied ${copied.length ? copied.join(",") : "nothing"}${
      complete ? "" : " (incomplete)"
    }`,
  );
  return complete;
}

/**
 * The page on disk, where `Webview.virtualHost` can serve it from.
 *
 * A virtual host maps a *folder*, so the copy of the page embedded in the exe has to become a real
 * file — the same unpack `unpackNative` does for the two DLLs, one directory further down. It is
 * keyed by build so an upgrade cannot serve the old page out of the new exe, and the directories
 * earlier builds left behind are swept once this one's is in place.
 */
async function unpackPage(): Promise<string> {
  const dir = PAGE_DIR;
  await Deno.mkdir(dir, { recursive: true });
  const bytes = await Deno.readFile(new URL("../dist/index.html", import.meta.url));
  const dst = `${dir}\\index.html`;
  // Length, not bytes: the directory is named after the build, so same name means same page.
  const cur = await Deno.stat(dst).catch(() => null);
  const copied = cur?.size !== bytes.byteLength;
  if (copied) await Deno.writeFile(dst, bytes);
  // Every upgrade left its predecessor's 330 KB behind for ever; this is the sweep the comment above
  // has always promised. Only reached when the stamp did not match, so at most once per build — and
  // a directory a second instance still has open is left where it is rather than failing the launch.
  for (const e of [...Deno.readDirSync(`${APPDIR}\\page`)]) {
    if (!e.isDirectory || e.name === version.slice(0, 12)) continue;
    try {
      Deno.removeSync(`${APPDIR}\\page\\${e.name}`, { recursive: true });
    } catch { /* in use by another instance: it can go next time */ }
  }
  mark(`page unpack: ${copied ? "wrote index.html" : "already there"}`);
  return dir;
}

/**
 * Which WebView2 profile this instance gets, and so which instance keeps the user's settings.
 *
 * One Chromium user-data folder cannot be opened by two processes at once, so exactly one instance
 * can have the shared profile — and *which* one has to be decided by something that is true of the
 * process, not of the page. It used to be decided by which instance got port 47821, which on a
 * machine where 47821 cannot be bound by anything meant "nobody, ever": every launch took a
 * fallback port, a throwaway `WebView2-<port>` profile and a fresh origin, and the user lost every
 * setting every time. `claim()` asks the operating system the same question instead — an exclusive
 * open that no other process can repeat, and that the kernel releases when this one exits however
 * it exits, so there is no stale lock to recognise and nothing to clean up.
 *
 * ponytail: a throwaway profile per concurrent second instance, keyed on its PID and never swept.
 * That is now only ever a genuinely simultaneous second window, not every launch; sweep
 * `%LOCALAPPDATA%\\WmpLegacyVisualizers\\WebView2-*` on startup if they ever add up again.
 */
function profileDir(spotify: boolean): string {
  // WmpSpotify.exe keeps Spotify's login in a profile of its own, never mixed with the visualizers'.
  if (spotify) {
    return claim(`${APPDIR}\\spotify.lock`)
      ? `${APPDIR}\\spotify`
      : `${APPDIR}\\spotify-${Deno.pid}`;
  }
  return claim(`${APPDIR}\\profile.lock`)
    ? `${APPDIR}\\WebView2`
    : `${APPDIR}\\WebView2-${Deno.pid}`;
}

/**
 * The `pageUrl` override, when there is one and it answers inside 4 s; null otherwise, and then the
 * caller navigates to the copy it unpacked.
 *
 * Started before `webview_create` and awaited after it, so the probe runs inside the seconds WebView2
 * takes to come up instead of after them. It used to be awaited on its own line between the two, and
 * a `pageUrl` pointing at a host that had gone away added its whole 4 s timeout to every launch.
 */
async function remotePage(): Promise<string | null> {
  const url = settings().pageUrl;
  if (typeof url !== "string" || !url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    log(`probe ${url} -> ${res.status}`);
    await res.body?.cancel();
    if (res.ok) return url;
  } catch (e) {
    log(`probe ${url} failed: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}

/**
 * Injected before any page script, on every navigation.
 *
 * `window.alchemyElectron` keeps the name the page already looks for (src/90-shell.js): it is
 * what makes the shell auto-attach loopback audio instead of waiting for a click, and what
 * makes a first run default to Battery. Screensaver mode additionally hides the settings
 * panel and the cursor, and ends the saver on real input — including from WebView2's own
 * error page, so a screensaver that failed to load is still dismissable.
 */
/**
 * Which mode Windows is asking for. Observed forms on Windows 11: `/S` (what the shell's own
 * .scr verb passes — note the upper case), `/s`, `/p 12345`, `/p:12345`, `/c`, `/c:98765`, and
 * nothing at all when the file is double-clicked, which means configure.
 *
 * `--mode=spotify` is not one of them: it is baked into WmpSpotify.exe by `deno compile` and wins
 * over everything, because a baked argument precedes the ones the process is started with.
 */
/**
 * Dev mode, never baked into an exe: `--dev` with `--mode=spotify` (`deno task dev:spotify`, or
 * `npm run dev:spotify`, which also runs the watch build). The host still shows open.spotify.com but
 * takes the overlay from dist/spotify-inject.js at mount time and hot-swaps it (dev.ts).
 */
export function devOf(args: string[]): boolean {
  return args.includes("--dev");
}

export function modeOf(args: string[]): "s" | "c" | "p" | "spotify" {
  if (args.includes("--mode=spotify")) return "spotify"; // WmpSpotify.exe (CONTRACT.md v6)
  const flag = args.find((a) => /^[/-][spc]/i.test(a)) ?? "/c";
  return flag[1].toLowerCase() as "s" | "c" | "p";
}

function initScript(
  mode: "screensaver" | "config" | "app",
  audio: boolean,
  port: number,
  page: string,
  spotify: Bundle | null = null,
  dev: Dev | null = null,
): string {
  // The per-document setup every mode shares: flags the page reads, startup marks, the report.
  // In spotify mode it runs only on open.spotify.com (spotify.ts guards it), never on the login.
  const common = `
  window.alchemyElectron = { loopback: true, mode: ${JSON.stringify(mode)} };
  // The page prefers this over getDisplayMedia when audio is true: ws://.../audio carries the
  // helper's PCM (deno-webview/audio.ts, src/90-shell.js Shell.useLocalAudio).
  window.alchemyScreensaver = { audio: ${audio}, url: "ws://127.0.0.1:${port}${AUDIO_PATH}" };
  // Where the page's own share of startup goes. Milliseconds since this document started loading
  // (performance.now()'s origin in a page is navigationStart), collected here and sent over in one
  // line at the first painted frame — src/90-shell.js pushes its own boot stages into the same
  // array. This is the only view anything outside the browser gets of the 2.5 seconds the page used
  // to take, and it is what the before/after table's page rows came off.
  var M = window.alchemyMarks = [];
  function at(n) { M.push(n + '=' + Math.round(performance.now())); }
  addEventListener('DOMContentLoaded', function () { at('DOMContentLoaded'); });
  // alchemyReady is no longer what puts the window on screen — the host shows it at once, with the
  // skin's colour as its class brush (win32.ts createHost), the way a native application does. It is
  // kept for this: the log line that says when the page actually had a frame to show. Two frames
  // after load, so the number is a painted frame and not a scheduled one — the first
  // requestAnimationFrame runs before the paint that follows it, the second after.
  addEventListener('load', function () {
    at('load');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        at('firstPaint');
        try { window.alchemyReady(); } catch (e) {}
        try { window.alchemyLog('page marks: ' + M.join(' ')); } catch (e) {}
      });
    });
  });

  function report() {
    var S = window.Alchemy && window.Alchemy.Shell, saved = '(none)';
    try { saved = localStorage.getItem('alchemy.settings') || '(none)'; } catch (e) {}
    window.alchemyLog(
      'page: source=' + (S && S.source ? S.source.label : 'none') +
      ' vis=' + (S && S.settings ? S.settings.vis + ':' + S.settings.preset : '?') +
      ' fps=' + (S ? S.fps : '?') + ' size=' + innerWidth + 'x' + innerHeight +
      ' status="' + (((window.alchemyRoot || document).getElementById('status') || {}).textContent || '') + '"' +
      // 0 with a source attached means "attached but silent" — the difference between
      // loopback being broken and nothing playing.
      ' energy=' + (S && S.level ? S.level.freq[0].reduce(function (a, b) { return a + b; }, 0) : '?') +
      // Which kind of silence: a suspended context, a socket that sends nothing, or real quiet.
      ' ctx=' + (S && S.analysers ? S.analysers[0].context.state : '?') +
      ' ws=' + (S ? (S.wsFrames || 0) + '@' + (S.wsRate || 0) : '?') +
      ' saved=' + saved);
  }
  addEventListener('load', function () { setTimeout(report, 3000); setTimeout(report, 9000); });
`;
  if (spotify) {
    // The page squares its chrome in this host (see the same rule below); inside a shadow root a
    // document <style> cannot reach it, so the rule rides in the adopted sheet instead.
    const suffix = "\n#chrome,#titlebar{border-radius:0!important}";
    return spotifyScript(
      { ...spotify, css: spotify.css + suffix },
      common,
      dev && { ...dev, cssSuffix: suffix },
    );
  }
  return `
(function () {
  // ---- the one-time hop off the old origin (see VHOST) -------------------------------------
  // Only ever reached on a launch that navigated to https://wmp.local/carry.html first, and the
  // hop is the document's own \`location.replace\`, not something the host does to it: the page
  // carries the settings across in its URL, so there is no host round trip to lose and no state
  // half-moved if this window is closed in the middle of it. Nothing else on this document runs.
  if (location.hostname === ${JSON.stringify(VHOST_OLD)}) {
    var old = '';
    try { old = localStorage.getItem(${JSON.stringify(LS_KEY)}) || ''; } catch (e) {}
    location.replace(${JSON.stringify(page)} + '&carry=' + encodeURIComponent(old));
    return;
  }
  var carried = /[?&]carry=([^&]*)/.exec(location.search);
  if (carried) {
    var v = '';
    // Seeded before any page script reads it, which is what an init script is for — and never over
    // settings this origin already has, so a second carry cannot undo a change made since.
    try {
      v = decodeURIComponent(carried[1]);
      if (v && !localStorage.getItem(${JSON.stringify(LS_KEY)})) {
        localStorage.setItem(${JSON.stringify(LS_KEY)}, v);
      }
    } catch (e) {}
    try { window.alchemyCarried(v.length); } catch (e) {}
    try { history.replaceState({}, '', location.href.replace(/[?&]carry=[^&]*/, '')); } catch (e) {}
  }

${common}
  var ss = ${mode === "screensaver"};
  // The native window's corners are DWM's, not the page's (deno-webview/win32.ts noDwmChrome).
  // Two rounded corners of slightly different radius leave the pixels between them painted by
  // nobody, which is the white crescent the user photographed — so in this host the page draws
  // its chrome square and lets the window's own rounded corner be the one that shows. The same
  // rule template.html already applies to a maximized window, for the same reason.
  if (!ss) addEventListener('DOMContentLoaded', function () {
    var q = document.createElement('style');
    q.textContent = '#chrome,#titlebar{border-radius:0!important}';
    document.documentElement.appendChild(q);
  });

  if (!ss) return;
  addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style');
    s.textContent = '#panel{display:none!important} *{cursor:none!important}';
    document.documentElement.appendChild(s);
  });

  var t0 = Date.now(), x = null, y = null, done = false;
  function bail(why) { if (!done) { done = true; window.alchemyQuit(why); } }
  addEventListener('keydown', function (e) { bail('key ' + e.key); }, true);
  addEventListener('mousedown', function () { bail('mousedown'); }, true);
  addEventListener('mousemove', function (e) {
    if (x === null) { x = e.screenX; y = e.screenY; return; }
    // 1 s grace then >10 px, so the cursor nudge from launching does not end it immediately.
    if (Date.now() - t0 > 1000 && (Math.abs(e.screenX - x) > 10 || Math.abs(e.screenY - y) > 10)) bail('mousemove');
  }, true);
  // A screensaver nobody can dismiss is worse than no screensaver: if the page never came up,
  // there is no visualizer and no input handler worth keeping, so give up and let the desktop back.
  // window.Alchemy was the old concatenated page; the React page is up once its canvas is.
  setTimeout(function () {
    if (!window.Alchemy && !document.querySelector('canvas')) bail('page did not load');
  }, 15000);
})();`;
}

if (import.meta.main) {
  mark("runtime up");
  const mode = modeOf(Deno.args);
  const dev = devOf(Deno.args) && mode === "spotify";
  // What the page is told: the Spotify window gets the same full chrome the config window has (the
  // page only singles out "screensaver"), under the name "app" the page's host adapter knows.
  const pageMode = mode === "s" ? "screensaver" : mode === "c" ? "config" : "app";
  log(`argv ${JSON.stringify(Deno.args)} -> ${mode}`);
  if (mode === "p") Deno.exit(0); // preview pane: draw nothing, exit cleanly

  // Pinned so /c and /s share one profile whatever the exe is called or wherever it sits, and so
  // the application and the screensaver come up with the same settings. Set before this instance's
  // first (and only) webview_create — the same rule WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS follows
  // further down. Which folder is decided by an exclusive file claim and no longer by which port the
  // server got: see profileDir(). This one stays in front of the window because it is a single
  // CreateFileW and because a WebView2 that has already been told the wrong folder cannot be told
  // again.
  const profile = profileDir(mode === "spotify");
  Deno.env.set("WEBVIEW2_USER_DATA_FOLDER", profile);
  mark(`profile: ${profile}`);

  /**
   * Whether this launch has to carry the user's settings over from `VHOST_OLD`, asked here because
   * both halves of the question stop being answerable later: `webview_create` is what creates the
   * profile folder, so "has this machine run an earlier build" has to be asked in front of it.
   *
   * Only the instance that holds the shared profile asks it. A concurrent second instance gets a
   * throwaway `WebView2-<pid>` that never had any settings to carry, and must not write the stamp
   * that would tell the real one there was nothing to do.
   */
  const shared = profile.endsWith("\\WebView2");
  const stamped = (() => {
    try {
      return Deno.readTextFileSync(ORIGIN_FILE).trim() === VHOST;
    } catch {
      return false;
    }
  })();
  const carry = shared && !stamped && (() => {
    try {
      // `EBWebView` and not `Default`: the folder handed to WebView2 is the *user data* folder and
      // the browser puts its own profile root inside it. Measured, after the first attempt looked
      // for `Default`, found nothing, concluded first run and dropped the settings on the floor.
      Deno.statSync(`${profile}\\EBWebView`);
      return true; // an earlier build has run here, so there are settings under the old origin
    } catch {
      return false; // first run on this machine: nothing to carry, and the stamp is written below
    }
  })();

  // ------------------------------------------------------------------- the window, first
  //
  // Nothing happens before this but one file claim. Unpacking the DLLs and the page, reading
  // settings.json, starting the worker and waiting for the port it bound all used to come first and
  // cost 0.5–1.6 s of an empty desktop, and the window itself was then kept hidden until the
  // page had painted — another 2 to 14 s, because `webview_create` starts a Chromium browser. The
  // user's verdict on that was "booting takes way too long; Electron just boots right into the
  // view", and he was right: Electron's window is up in a couple of hundred milliseconds with its
  // background colour in it and fills in afterwards. So does this one now, at a third of a second
  // measured from Process.Start. The class brush is the skin's own colour (win32.ts createHost), so
  // the window the user gets is the right size, in the right place, in the right colour — never
  // white, and never a window that assembles itself while he watches.
  coInit();
  mark("CoInitialize done");

  /** The WebView2, once there is one: null for the two-to-fourteen seconds the window is already on
   * screen without it, so everything that talks to the page has to cope with there being no page. */
  let webview: Webview | null = null;
  let hwnd: Deno.PointerValue = null;
  /** Whether the window came up maximized, remembered because the page cannot be told until it
   * exists: `WM_SIZE` fires while the window is being shown, which is now long before that. */
  let zoomed = false;

  /** Remember where the window was left. Called before terminate() and again after the pump
   * returns: the first catches the page's close button, the second Alt+F4 and everything else —
   * and once the window is gone GetWindowPlacement fails, so a dead HWND writes nothing. */
  function saveGeom() {
    if (mode === "s") return;
    const g = fullBox() ?? placement(hwnd); // never the F-key desktop box
    if (!g) return;
    try {
      Deno.writeTextFileSync(GEOM_FILE, JSON.stringify(g));
    } catch (e) {
      log(`geom save: ${e instanceof Error ? e.message : e}`);
    }
  }

  let done = false;
  /** A function declaration and not a `const`, because the window's close button is live from the
   * moment the window is shown — which is now before `webview_create` has returned — and an arrow
   * assigned further down would still be in its temporal dead zone when the user pressed it. */
  function quit(why: string) {
    if (done) return;
    done = true;
    mark(`exit: ${why}`);
    saveGeom();
    // Closed while WebView2 was still coming up: there is no message pump to terminate and no page
    // to shut down, so leave. Without this the window would take the click and do nothing.
    if (webview) webview.terminate();
    else Deno.exit(0);
  }

  /** XP squares the window's own corners on maximize, and the page has to square `#chrome`'s CSS
   * radius to match: nothing else tells it. Pushed when it can be and remembered either way — the
   * `alchemyReady` binding pushes it again once there is a document to put a class on. */
  const tellMaximized = (max: boolean) => {
    zoomed = max;
    webview?.eval(`document.body.classList.toggle('maximized', ${max});`);
  };

  hwnd = createHost({
    // No native caption in either window, so this is what the taskbar and Alt+Tab show.
    title: mode === "spotify" ? "WMP Spotify" : "Alchemy screensaver",
    icon: iconPath(mode, devOf(Deno.args) && mode === "spotify", NATIVE_DIR, import.meta.url),
    appId: appIdOf(mode),
    saver: mode === "s",
    min: [MIN_W, MIN_H], // what WEBVIEW_HINT_MIN used to ask the library for
    onClose: () => quit("window closed"),
    onActivate: () => void webview?.focus(),
    onMaximize: mode === "s" ? undefined : tellMaximized,
  });
  mark("host window created");
  // Placed before it is shown, so the size, the position and the frame without a top border are all
  // settled the first time anyone sees it: it appears finished, it does not assemble itself.
  if (mode === "s") {
    const r = fullscreen(hwnd);
    mark(`screensaver placed: ${r.w}x${r.h} at ${r.x},${r.y}`);
  } else {
    const r = frameless(hwnd, 1100, 720, loadGeom());
    mark(`${mode} window placed ${r.w}x${r.h} at ${r.x},${r.y}; dwm ${r.dwm}`);
  }
  showHost();
  mark("window shown");

  // ------------------------------------------------- and everything else, behind it
  if (dev) {
    // Dev: the page is open.spotify.com, so only the DLLs and the audio helper are needed, and no
    // stamp is written, so the next release launch unpacks its own page. A file: URL, not a path:
    // from a \\wsl$ share the module URL has a host, which a hand conversion gets wrong, and
    // Deno's fs calls take the URL as it is.
    await unpackNative();
    Deno.env.set("ALCHEMY_DEV_INJECT", new URL("../dist/spotify-inject.js", import.meta.url).href);
    mark("dev mode: overlay hot swap");
  } else if (unpacked()) {
    // All `unpackNative` did with its remaining second was set this.
    Deno.env.set("PATH", `${NATIVE_DIR};${Deno.env.get("PATH") ?? ""}`);
    mark(`unpack: ${version.slice(0, 12)} already in place`);
  } else {
    const [complete] = await Promise.all([unpackNative(), unpackPage()]);
    if (complete) {
      Deno.writeTextFileSync(STAMP, version);
      mark(`unpack: ${version.slice(0, 12)} written`);
    } else {mark(
        `unpack: ${version.slice(0, 12)} not stamped (a file was locked; next launch retries)`,
      );}
  }
  const audioExe = await Deno.stat(`${NATIVE_DIR}\\${AUDIO_EXE}`)
    .then(() => `${NATIVE_DIR}\\${AUDIO_EXE}`, () => "");
  if (audioExe) Deno.env.set("ALCHEMY_AUDIO_EXE", audioExe); // read by server.ts in the worker
  log(`audio helper: ${audioExe || "none in this build"}`);

  // Set before the first webview_create, because that is when the loader reads it — which is why it
  // is here and not in front of the window: the constructor below is the only reader there is, and
  // reading settings.json to work out what to put in it is two file opens the window was waiting on.
  //
  // Except that this one the loader never reads. Measured: WEBVIEW2_USER_DATA_FOLDER (set above) is
  // honoured, this variable is not, and the browser process comes up with neither --autoplay-policy
  // nor a --force-device-scale-factor put here purely as a probe (README.md, "System audio"). The
  // page therefore cannot have a running AudioContext in the screensaver and analyses the
  // system-audio PCM itself. Kept anyway: it costs nothing and a later webview.dll may forward it.
  //
  // This is the whole list on purpose. The Chromium screen-capture switches
  // (--auto-select-screen-capture-source, --system-audio-capture-default_checked,
  // --use-fake-ui-for-media-stream and friends) were measured to do nothing here: WebView2
  // shows its own picker, not //chrome's, and those switches only patch //chrome's. See the
  // "System audio" section of README.md. --use-fake-ui-for-media-stream in particular would
  // auto-grant camera and microphone to the page for no benefit at all, so it stays out.
  const cfg = settings();
  const browserArgs = typeof cfg.browserArgs === "string"
    ? cfg.browserArgs
    : "--autoplay-policy=no-user-gesture-required";
  Deno.env.set("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browserArgs);
  log(`browser args: ${browserArgs}`);

  const worker = new Worker(import.meta.resolve("./server.ts"), { type: "module" });
  // The port it bound, or a reason it bound none. Any free port will do: the page is not served over
  // it — only /audio is (audio.ts), which the page is told the full URL of. Deliberately not awaited
  // here: the worker binds its port on its own thread while `webview_create` blocks this one, so by
  // the time the await below runs the answer has been sitting there for seconds. It used to be
  // awaited on this line, in front of the window, for 0.2–1.4 s.
  const served = new Promise<string>((ok) => {
    worker.onmessage = (e) => ok(String(e.data));
  });
  // Started here for the same reason, and awaited after the same call: a `pageUrl` pointing at a
  // host that has gone away is 4 s, and it may as well be 4 s of WebView2's own startup.
  const remote = remotePage();

  const w = new Webview(`${NATIVE_DIR}\\webview.dll`, false, hwnd);
  webview = w;
  mark("webview_create returned (environment + controller)");
  // Proof that it embedded rather than made a window of its own: webview_get_window answers with
  // the HWND it was handed. If it ever stops doing that, everything below styles the wrong window.
  const embedded = Deno.UnsafePointer.value(w.hwnd) === Deno.UnsafePointer.value(hwnd);
  log(`embedded in our window: ${embedded}`);
  if (!embedded) throw new Error("webview_create made its own window");
  // Before the widget is given any pixels, not after. `webview_create` adds its child window at
  // 0x0 and the controller's own default background is white; `resizeWebview` below stretches that
  // child over the whole client area, and the window has been on screen since 250 ms, so the
  // several hundred milliseconds between the two would be white — on screen — in the one place this
  // whole design refuses to be white. Setting the colour while the child is still 0x0 means
  // there is no frame in which it can be seen. Luna blue in the player, black behind the
  // screensaver's canvas: the same two colours the class brush has been painting all along.
  log(`background: ${mode === "s" ? w.background(0, 0, 0) : w.background(20, 99, 235)}`);
  resizeWebview(hwnd); // the child widget it just added starts at 0x0
  // The window took the foreground seconds ago, when it was shown, and `WM_ACTIVATE` came and went
  // while there was still nothing to hand the focus to — so the one thing that message exists to do
  // has to be done again here, by hand. Without it the top-level window keeps the focus it was given
  // at a third of a second and the page never sees a key: no typing in the player, and a screensaver
  // that cannot be dismissed from the keyboard.
  w.focus();

  // Where the page comes from, and the whole reason the user's settings survive a relaunch: a
  // virtual host is a name WebView2 resolves inside the browser, with no socket and no port behind
  // it, so the origin localStorage is keyed by is the same on every launch on every machine. The
  // loopback server is the fallback for a runtime with no ICoreWebView2_3, and serves /audio
  // either way. `v=` stays: the WebView2 cache lives in the pinned profile, and a virtual host's
  // files come with no cache headers to say otherwise.
  // Both of these were started before `webview_create` and are answered by the time it returns.
  //
  // The deadline is armed here and not where the worker was created, which matters now that the two
  // overlap: a timer set before `webview_create` spends the whole of that call expiring, and then
  // races the answer instead of bounding the wait for it. Measured on a launch where the worker had
  // its port at 337 ms and `webview_create` took 6.3 s: the 5 s timer won and the page was told
  // there was no audio server, when there had been one for six seconds. One second from here is
  // plenty — the answer is almost always already sitting in the queue.
  const port = Number(
    await Promise.race([
      served,
      new Promise<string>((ok) => setTimeout(() => ok("timeout"), 1000)),
    ]),
  ) || 0;
  mark(port ? `server on 127.0.0.1:${port}` : "no server of our own: no system audio");

  const vhost = w.virtualHost(VHOST, PAGE_DIR);
  const remoteUrl = await remote;
  const base = remoteUrl ??
    (vhost ? `https://${VHOST}/index.html` : `http://127.0.0.1:${port}/`);
  const url = new URL(base);
  url.searchParams.set("mode", pageMode);
  url.searchParams.set("v", version.slice(0, 12));
  if (mode === "s") url.searchParams.set("ss", "1");
  mark(`virtual host ${VHOST} -> ${PAGE_DIR}: ${vhost}; page ${url}`);

  w.bind("alchemyQuit", (a) => quit(String(a[0] ?? "page")));
  w.bind("alchemyLog", (a) => log(String(a[0] ?? "")));
  // The page's first painted frame reaches this. It no longer decides when the window appears —
  // the window has been up since before WebView2 was started — so all it does is say when the skin
  // actually landed in it, and hand the page the one piece of window state that arrived too early
  // to tell it about. Bound with the rest of them and before navigate(): a binding registered after
  // navigate() is a binding the document being loaded never sees.
  const navigated = Date.now();
  w.bind("alchemyReady", () => {
    mark(`page painted ${Date.now() - navigated} ms after navigate`);
    tellMaximized(zoomed);
  });
  w.bind("alchemyCarried", (a) => {
    log(`settings carried from ${VHOST_OLD}: ${a[0]} chars`);
    try {
      Deno.writeTextFileSync(ORIGIN_FILE, VHOST); // done; no launch pays the old origin again
    } catch (e) {
      log(`origin stamp: ${e instanceof Error ? e.message : e}`);
    }
  });
  // Spotify mode: the overlay bundle `npm run build` emits (CONTRACT.md v6), embedded
  // with ../dist like the page itself.
  const bundle: Bundle | null = mode !== "spotify" ? null : JSON.parse(
    await Deno.readTextFile(new URL("../dist/spotify-inject.js", import.meta.url)),
  );
  const devInject: Dev | null = dev && port
    ? {
      bundle: `http://127.0.0.1:${port}${DEV_BUNDLE_PATH}`,
      socket: `ws://127.0.0.1:${port}${DEV_SOCKET_PATH}`,
      cssSuffix: "",
    }
    : null;
  w.init(initScript(pageMode, !!audioExe, port, url.toString(), bundle, devInject));

  if (mode !== "s") {
    // The page's XP title bar is the window's only title bar, and the skin's status-bar grip its
    // only visible resize handle; these are what they drive.
    w.bind("alchemyWinDrag", () => caption(hwnd, "drag"));
    w.bind("alchemyWinMin", () => caption(hwnd, "min"));
    w.bind("alchemyWinMax", () => caption(hwnd, "maxtoggle"));
    w.bind("alchemyWinSize", () => caption(hwnd, "sizese"));
    w.bind("alchemyWinClose", () => quit("close button"));
    // File > Log out (Spotify mode only; the page hides the item when this is absent).
    if (mode === "spotify") {
      w.bind("alchemySpotifyLogout", () => {
        log("spotify: log out");
        w.navigate(SPOTIFY_LOGOUT);
      });
    }
    // F / Esc in the page: the window itself covers the desktop, not just the page inside it.
    w.bind("alchemyWinFull", (args) => {
      const on = args[0] === true;
      fullToggle(hwnd, on);
      worker.postMessage({ full: on });
    });
    // The worker watches the window box from there on (server.ts): this thread is about to block.
    worker.postMessage({ geom: GEOM_FILE, hwnd: String(Deno.UnsafePointer.value(hwnd)) });
  }
  // The page, or — once, on a machine upgrading from a build whose origin was `wmp.local` — a
  // 40-byte document on that old origin whose only job is to hand the settings to this one. The
  // hop is in the init script above; both host names are mapped to the same folder, so the old
  // origin is a name and not a second copy of anything.
  if (mode === "spotify") {
    // Spotify's own web player; wmp.localhost stays mapped (above) so the overlay can fetch from it.
    w.navigate("https://open.spotify.com/");
  } else if (carry && vhost && !remoteUrl) {
    w.virtualHost(VHOST_OLD, PAGE_DIR);
    try {
      Deno.writeTextFileSync(`${PAGE_DIR}\\carry.html`, "<!doctype html><title>carry</title>");
      w.navigate(`https://${VHOST_OLD}/carry.html`);
      mark(`carrying settings over from ${VHOST_OLD}`);
    } catch (e) {
      log(`carry: ${e instanceof Error ? e.message : e}`);
      w.navigate(url.toString());
    }
  } else {
    w.navigate(url.toString());
    // Nothing to carry (a first run, or the loopback fallback origin): stamp it so no later launch
    // goes looking. Written after the navigate so it is never in front of the page.
    if (shared && vhost && !remoteUrl && !stamped) {
      try {
        Deno.writeTextFileSync(ORIGIN_FILE, VHOST);
      } catch { /* a stamp that cannot be written costs one wasted check next launch */ }
    }
  }
  mark("navigate issued");

  w.run(); // blocks on the message pump until quit() or the window is closed
  saveGeom();
  log("run() returned");
  Deno.exit(0); // immediate: a screensaver must never linger
}

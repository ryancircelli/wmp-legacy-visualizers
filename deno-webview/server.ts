/// <reference lib="deno.worker" />
// Worker: the system-audio WebSocket, on whatever loopback port the OS hands out.
//
// It has to be a worker. webview_run() blocks the main thread on the Win32 message pump for
// the whole life of the window, so a Deno.serve() on that thread would never run its handler
// and the very first navigation would hang.
//
// /audio is what it is for (audio.ts): the relay lives here rather than on the main thread for the
// same reason the server does — the message pump.
//
// The page itself is served to WebView2 from a virtual host now (main.ts), not from here. The
// static handler stays anyway — it is the one the web build already uses (../deno/main.ts), and
// it is what a runtime too old for ICoreWebView2_3 falls back to.
import { handler } from "../deno/main.ts";
import { AUDIO_PATH, serveAudio } from "./audio.ts";
import { placement } from "./win32.ts";
import { serveDev } from "./dev.ts";

// Set by main.ts once the helper has been unpacked; empty when there is none, and then /audio is
// a plain 404 and the page animates on silence.
const audioExe = Deno.env.get("ALCHEMY_AUDIO_EXE") ?? "";
// Dev mode only: the spotify-inject.js to serve and watch (dev.ts); unset in a release build.
const devInject = Deno.env.get("ALCHEMY_DEV_INJECT") ?? "";

/**
 * Straight to the log file, not through `postMessage`.
 *
 * The main thread stops running JavaScript the moment it enters `webview_run()` — the Win32 message
 * pump — so a `postMessage` sent after that is a message nobody ever delivers, and every line this
 * worker had to say about the audio helper (when the socket opened, when the helper was spawned, why
 * it exited) was silently dropped: exactly the half of startup that matters for audio. The wall
 * clock in the line is what lines these up against main.ts's own marks.
 */
const APPDATA = Deno.env.get("LOCALAPPDATA");
function log(msg: string) {
  // No %LOCALAPPDATA% means this is not Windows, which means it is the test suite importing this
  // module — and an interpolated `undefined` there writes a directory called `undefined\...` into
  // whatever the working directory happens to be. Measured, in the repo.
  if (!APPDATA) return;
  try {
    Deno.writeTextFileSync(
      `${APPDATA}\\WmpLegacyVisualizers\\alchemy-scr.log`,
      `${new Date().toISOString()} [${Deno.pid}] worker: ${msg}\n`,
      { append: true },
    );
  } catch { /* nothing to be done about a log that cannot be written */ }
}

/** Reports the port it got, which is the whole message the main thread waits for. Port 0 is an
 * OS-assigned free one, and any free one will do: the page no longer comes from here (it is served
 * to WebView2 from a virtual host, main.ts), so nothing but /audio is keyed to this number — and
 * the page is told the whole URL of that. A fixed port used to decide the page's origin and with it
 * the user's settings, and on a machine where the fixed port could not be bound at all that cost
 * him every setting on every launch. */
function serve() {
  Deno.serve({
    port: 0,
    hostname: "127.0.0.1",
    onListen: ({ port }) => {
      log(`serving 127.0.0.1:${port}`);
      self.postMessage(String(port));
    },
    onError: (e) => new Response(String(e), { status: 500 }),
  }, (req) => {
    const dev = devInject ? serveDev(req, devInject, log) : null;
    if (dev) return dev;
    if (audioExe && new URL(req.url).pathname === AUDIO_PATH) {
      return serveAudio(
        req,
        audioExe,
        log,
        APPDATA ? `${APPDATA}\\WmpLegacyVisualizers\\lyrics` : null,
      );
    }
    return handler(req);
  });
}

try {
  serve();
} catch (e) {
  self.postMessage("err: " + (e instanceof Error ? e.message : String(e)));
}

/**
 * Remember where the player window is left. This lives here, off the main thread, because the main
 * thread is inside webview_run() — the Win32 message pump — for the whole life of the window and
 * runs no timer until it returns, by which time the window is gone. A poll also covers every way
 * of closing it (Alt+F4, the taskbar, a WM_CLOSE from somewhere else), where saving on the way out
 * only catches the page's own close button.
 *
 * ponytail: a 2 s poll, not a message hook — the webview C API exposes no WndProc to hook, and
 * nothing here is worth a subclassing dance.
 */
let full = false; // the F-key desktop-covering box is not one to remember
self.onmessage = (e) => {
  if ("full" in e.data) {
    full = !!e.data.full;
    return;
  }
  const { geom, hwnd } = e.data as { geom: string; hwnd: string };
  const h = Deno.UnsafePointer.create(BigInt(hwnd));
  let last = "";
  setInterval(() => {
    if (full) return;
    const g = placement(h); // null once the window is destroyed: then nothing is overwritten
    const s = g ? JSON.stringify(g) : "";
    if (!s || s === last) return;
    last = s;
    try {
      Deno.writeTextFileSync(geom, s);
    } catch { /* a log line is not worth a failed write of a window box */ }
  }, 2000);
};

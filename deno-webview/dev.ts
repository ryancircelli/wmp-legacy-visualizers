// Dev mode only (`--dev`): hot reload for the Spotify overlay, served by the worker (server.ts).
//
// open.spotify.com's CSP blocks module loads from localhost, so Vite's HMR client cannot run in
// that page. Instead `npm run dev:spotify` rebuilds dist/spotify-inject.js on every change, and the
// worker watches that file: a CSS-only change goes to the overlay as {"type":"devCss","css"} (the
// injected bootstrap swaps its adopted sheet in place), anything else as {"type":"devReload"}.
//
// Polled, not Deno.watchFs: the repo lives in WSL and the host runs on Windows, and a watch on a
// \\wsl$ path never fires for a write made from the Linux side (measured 2026-09-24).
import { type Bundle, devChange } from "./spotify.ts";

export const DEV_BUNDLE_PATH = "/dev/inject";
export const DEV_SOCKET_PATH = "/dev";
const POLL_MS = 300; // also the debounce: a file must hold still for one poll before it is read

// Cross-origin from https://open.spotify.com to http://127.0.0.1: CORS, and Chromium's
// private-network preflight answered yes.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-private-network": "true",
  "access-control-allow-headers": "*",
  "cache-control": "no-store",
};

function read(path: string | URL): Bundle | null {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch {
    return null; // mid-write or absent: the next poll tries again
  }
}

/** The dev routes, or null for any other request. */
export function serveDev(req: Request, file: string, log: (m: string) => void): Response | null {
  // main.ts passes a file: URL (see ALCHEMY_DEV_INJECT); a plain path works too (tests).
  const path: string | URL = file.startsWith("file:") ? new URL(file) : file;
  const url = new URL(req.url);
  if (url.pathname === DEV_BUNDLE_PATH) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return new Response(Deno.readTextFileSync(path), {
        headers: { ...CORS, "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(String(e), { status: 404, headers: CORS });
    }
  }
  if (url.pathname !== DEV_SOCKET_PATH) return null;
  const { socket, response } = Deno.upgradeWebSocket(req);
  let last = read(path), stamp = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  socket.onopen = () => {
    log(`dev: watching ${path}`);
    timer = setInterval(() => {
      let s = "";
      try {
        const st = Deno.statSync(path);
        s = `${st.mtime?.getTime()}:${st.size}`;
      } catch { /* being rewritten */ }
      if (!s || s === stamp) return;
      const first = stamp === "";
      stamp = s;
      if (first) return;
      setTimeout(() => { // debounce: read once the writer has finished
        const next = read(path);
        if (!next) return;
        const what = devChange(last, next);
        last = next;
        if (what === "none" || socket.readyState !== WebSocket.OPEN) return;
        log(`dev: bundle changed -> ${what}`);
        socket.send(
          JSON.stringify(
            what === "css" ? { type: "devCss", css: next.css } : { type: "devReload" },
          ),
        );
      }, POLL_MS);
    }, POLL_MS);
  };
  socket.onclose = () => clearInterval(timer);
  return response;
}

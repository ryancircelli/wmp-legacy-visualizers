/// <reference lib="deno.worker" />
// The page-update check (update.ts) on a thread of its own. The main thread spends WebView2's
// startup inside one blocking call and the rest of its life inside another (the message pump), and
// a fetch started there only moves in the gaps between them: measured, it never finished. Here it
// runs whole during WebView2's startup, and its answer is waiting when the main thread next looks;
// a late one still lands in the cache for the next launch.
import { type Options, refresh } from "./update.ts";

// Straight to the log file, as server.ts does: the main thread reads no messages once it pumps.
const APPDATA = Deno.env.get("LOCALAPPDATA");
function log(msg: string) {
  if (!APPDATA) return;
  try {
    Deno.writeTextFileSync(
      `${APPDATA}\\WmpLegacyVisualizers\\alchemy-scr.log`,
      `${new Date().toISOString()} [${Deno.pid}] ${msg}\n`,
      { append: true },
    );
  } catch { /* nothing to be done about a log that cannot be written */ }
}

self.onmessage = async (e: MessageEvent<Pick<Options, "dir" | "name" | "own">>) => {
  const r = await refresh({ ...e.data, log });
  log(
    `update: checked; ${r.page ? `page ${r.page.manifest.version.slice(0, 7)}` : "no newer page"}` +
      `${r.hostUpdate ? ", a newer exe is out" : ""}`,
  );
  self.postMessage(r);
  self.close();
};

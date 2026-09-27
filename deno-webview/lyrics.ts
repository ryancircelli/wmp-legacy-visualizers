// Synced lyrics for the track the media session reports (CONTRACT.md, "v5 — Synced lyrics"), from
// LRCLIB, cached on disk per track. Only ever called off the PCM path: audio.ts fires it and moves on.

export type Track = { title: string; artist: string; album: string; duration: number };
export type Lyrics = {
  type: "lyrics";
  status: "synced" | "plain" | "none" | "error";
  source: "lrclib";
  lines: Line[] | null;
  plain: string | null;
  track: Track;
};
type Hit = { duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null };

const API = "https://lrclib.net/api";
const UA = "WmpLegacyVisualizers/1.0 (github.com/ryancircelli/wmp-legacy-visualizers)";

type Line = { t: number; text: string; words?: { t: number; text: string }[] };

/** `[mm:ss.xx]text`, with any number of stamps per line; tag lines like `[ar:...]` never match.
 *  Enhanced LRC word stamps (`<mm:ss.xx>word`) become `words` so the page can highlight karaoke-style. */
export function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  const secs = (m: string, s: string) => Math.round((+m * 60 + +s) * 100) / 100;
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const rest = line.slice(stamps.at(-1)!.index! + stamps.at(-1)![0].length);
    const tags = [...rest.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)];
    const text = rest.replace(/<\d+:\d+(?:\.\d+)?>/g, "").replace(/\s+/g, " ").trim();
    const words = tags.map((w, i) => ({
      t: secs(w[1], w[2]),
      text: rest.slice(w.index! + w[0].length, tags[i + 1]?.index).trim(),
    })).filter((w) => w.text);
    for (const s of stamps) out.push(words.length ? { t: secs(s[1], s[2]), text, words } : { t: secs(s[1], s[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The search result nearest in length; with no length to go on, the first one that is synced. */
export function closest(hits: Hit[], duration: number): Hit | undefined {
  if (!duration) return hits.find((h) => h.syncedLyrics) ?? hits[0];
  return hits.toSorted((a, b) =>
    Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration)
  )[0];
}

export function toFrame(hit: Hit | undefined, track: Track): Lyrics {
  const lines = hit?.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
  const plain = hit?.plainLyrics || null;
  const status = lines.length ? "synced" : plain ? "plain" : "none";
  return {
    type: "lyrics",
    status,
    source: "lrclib",
    lines: lines.length ? lines : null,
    plain,
    track,
  };
}

async function get(path: string, q: Record<string, string>): Promise<Response> {
  return await fetch(`${API}/${path}?${new URLSearchParams(q)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(5000),
  });
}

/** Exact match first (LRCLIB wants all four fields, duration within ~2 s), then a search. */
async function lookup(t: Track): Promise<Hit | undefined> {
  if (t.duration > 0) {
    const r = await get("get", {
      track_name: t.title,
      artist_name: t.artist,
      album_name: t.album,
      duration: String(Math.round(t.duration)),
    });
    if (r.ok) return await r.json();
    await r.body?.cancel();
    if (r.status !== 404) throw new Error(`lrclib get ${r.status}`);
  }
  const r = await get("search", { track_name: t.title, artist_name: t.artist });
  if (!r.ok) throw new Error(`lrclib search ${r.status}`);
  return closest(await r.json(), t.duration);
}

async function cacheName(t: Track): Promise<string> {
  const key = [t.title, t.artist, t.album, Math.round(t.duration)].join("\u0000");
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("") + ".json";
}

/** Cached lyrics for `t`, else LRCLIB's (cached unless the fetch failed). Never throws. */
export async function lyricsFor(t: Track, cacheDir: string | null): Promise<Lyrics> {
  const file = cacheDir && `${cacheDir}/${await cacheName(t)}`;
  if (file) {
    try {
      return JSON.parse(await Deno.readTextFile(file));
    } catch { /* not cached yet */ }
  }
  try {
    const frame = toFrame(await lookup(t), t);
    if (file) {
      await Deno.mkdir(cacheDir!, { recursive: true }).catch(() => {});
      await Deno.writeTextFile(file, JSON.stringify(frame)).catch(() => {});
    }
    return frame;
  } catch {
    // ponytail: errors are not cached, so a track retries on its next play; no backoff beyond that.
    return {
      type: "lyrics",
      status: "error",
      source: "lrclib",
      lines: null,
      plain: null,
      track: t,
    };
  }
}

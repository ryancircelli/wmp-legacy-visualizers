// System audio for the page, over a WebSocket on the page's own origin.
//
// WebView2 will not answer getDisplayMedia with a loopback stream (README.md, "System audio"), so
// the capture happens outside the browser: audio/src/main.rs opens the default render endpoint in
// WASAPI loopback mode and writes the sample rate then interleaved stereo f32 to stdout, and this
// relays those bytes to the page, which feeds them into the same analyser chain the share path
// uses (src/90-shell.js, Shell.useLocalAudio).
//
// The helper runs only while a socket is open, so nothing captures audio when nothing is
// listening, and it dies with the socket.
//
// The same socket carries Now Playing (CONTRACT.md v4) and lyrics (v5) as text frames: the helper
// writes media JSON lines on stderr and takes transport commands as JSON lines on stdin
// (audio/src/media.rs), and lyrics.ts looks each new track up on LRCLIB. None of it touches the
// binary PCM path.
import { lyricsFor, type Track } from "./lyrics.ts";
import { keepAwake } from "./win32.ts";

export const AUDIO_PATH = "/audio";

/** How much unsent PCM to tolerate before dropping frames: a page that stalls must not grow the
 * host's memory, and stale audio is worthless to a visualizer anyway. ~0.5 s at 48 kHz stereo. */
const MAX_BUFFERED = 1 << 19;

/**
 * stdout arrives in whatever chunks the pipe feels like; the page is handed whole stereo frames
 * (two f32 = 8 bytes), so it can read a message as a Float32Array with no leftovers to track.
 */
export function frameAligner(): (chunk: Uint8Array) => Uint8Array {
  let tail = new Uint8Array(0);
  return (chunk) => {
    if (tail.byteLength) {
      const joined = new Uint8Array(tail.byteLength + chunk.byteLength);
      joined.set(tail);
      joined.set(chunk, tail.byteLength);
      chunk = joined;
    }
    const keep = chunk.byteLength & ~7;
    tail = chunk.slice(keep);
    return chunk.subarray(0, keep);
  };
}

type Sink = { send(data: string | Uint8Array): void; readonly bufferedAmount: number };

/**
 * Reads one helper's stdout to its end: the u32 sample rate becomes a `{"rate":n}` text message,
 * everything after it becomes binary messages of whole frames. Returns when the helper stops.
 */
export async function relay(sink: Sink, stdout: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stdout.getReader();
  let buf = new Uint8Array(0);
  // The rate is four bytes at the very start, which a pipe is free to split.
  while (buf.byteLength < 4) {
    const { value, done } = await reader.read();
    if (done) throw new Error("helper stopped before sending the sample rate");
    const joined = new Uint8Array(buf.byteLength + value.byteLength);
    joined.set(buf);
    joined.set(value, buf.byteLength);
    buf = joined;
  }
  const rate = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true);
  sink.send(JSON.stringify({ rate }));

  const align = frameAligner();
  for (let chunk: Uint8Array | undefined = buf.subarray(4); chunk;) {
    const frames = align(chunk);
    if (frames.byteLength && sink.bufferedAmount < MAX_BUFFERED) sink.send(frames);
    const r = await reader.read();
    if (r.done) return;
    chunk = r.value;
  }
}

/** Lines of a byte stream, the last one even without its newline. */
export async function* lines(s: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let buf = "";
  for await (const chunk of s.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) yield buf.slice(0, i);
  }
  if (buf) yield buf;
}

const CMDS = new Set(["playpause", "play", "pause", "next", "prev", "seek"]);
type Media = Track & { type: "media"; status: string; app: string; art?: string | null };

/**
 * Upgrades the request and keeps a helper feeding it for as long as it is open. The helper is
 * restarted with backoff if it dies — a default-device change makes it exit non-zero — and killed
 * when the socket closes.
 */
export function serveAudio(
  req: Request,
  exe: string,
  log: (m: string) => void,
  lyricsDir: string | null = null,
): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);
  let child: Deno.ChildProcess | null = null;
  let stdin: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let closed = false;
  const send = (m: unknown) =>
    socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(m));

  // Now Playing. The helper sends the art only when it changes; every frame to the page carries it.
  let art: string | null = null;
  let track: Track | null = null;
  let trackKey = "", seen = "";
  let lyricsOn = true;
  const lyrics = () => {
    const key = trackKey, t = track;
    if (!t || !lyricsOn) {
      const empty = { title: "", artist: "", album: "", duration: 0 };
      return send({
        type: "lyrics",
        status: "none",
        source: "lrclib",
        lines: null,
        plain: null,
        track: t ?? empty,
      });
    }
    lyricsFor(t, lyricsDir).then((f) => {
      if (key !== trackKey) return; // the track moved on while LRCLIB answered
      log(`lyrics: ${f.status}${f.lines ? ` (${f.lines.length} lines)` : ""} for "${t.title}"`);
      send(f);
    });
  };
  const onMedia = (m: Media) => {
    if ("art" in m) art = m.art ?? null;
    else m.art = art;
    send(m);
    const s = `${m.status} ${m.app} "${m.title}" / ${m.artist} art=${art ? art.length : "none"}`;
    if (s !== seen) log(`media: ${(seen = s)}`);
    track = m.status === "none" || !m.title
      ? null
      : { title: m.title, artist: m.artist, album: m.album, duration: m.duration };
    const key = JSON.stringify(track);
    if (key !== trackKey) {
      trackKey = key;
      lyrics();
    }
  };
  socket.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m?.type === "mediaCmd" && CMDS.has(m.cmd)) {
      // Re-serialized, not forwarded: the helper's parser only knows this exact flat shape.
      const line = JSON.stringify({ cmd: m.cmd, position: Number(m.position) || 0 });
      log(`media: command ${line}`);
      stdin?.write(new TextEncoder().encode(line + "\n")).catch(() => {});
    } else if (m?.type === "lyricsPref") {
      lyricsOn = m.enabled !== false;
      lyrics();
    } else if (m?.type === "wake") {
      log(`wake: ${m.on === true}`);
      keepAwake(m.on === true);
    }
  };

  const stop = () => {
    if (closed) return;
    closed = true;
    try {
      child?.kill();
    } catch { /* already gone */ }
  };
  socket.onclose = stop;
  socket.onerror = stop;

  socket.onopen = async () => {
    log(`audio: socket open, spawning ${exe}`);
    for (let fails = 0; !closed;) {
      try {
        child = new Deno.Command(exe, { stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
        stdin = child.stdin.getWriter();
        // stderr is media JSON lines, plus one plain line on the way out: the WASAPI error, which
        // goes in the log next to the exit code.
        const why = (async (err: string[]) => {
          for await (const l of lines(child.stderr)) {
            if (!l.startsWith("{")) err.push(l);
            else {
              try {
                onMedia(JSON.parse(l));
              } catch { /* a torn line from a dying helper */ }
            }
          }
          return err.join(" ");
        })([]).catch(() => "");
        await relay(socket, child.stdout);
        const st = await child.status;
        log(`audio: helper exited ${st.code}: ${(await why).trim() || "(no message)"}`);
        fails = st.code === 0 ? fails : fails + 1;
      } catch (e) {
        log(`audio: helper failed: ${e instanceof Error ? e.message : e}`);
        fails++;
      }
      if (closed) break;
      // 0.25 s, 0.5 s, 1 s ... 5 s. A device that is gone for good must not become a spawn loop.
      await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** Math.min(fails, 5))));
    }
    stop();
  };

  return response;
}

//! System audio, Now Playing and lyrics for the page, in process: what the Deno host did with a
//! helper process (deno-webview/audio/) and a relay (deno-webview/audio.ts, lyrics.ts).
//!
//! The page gets the same WebSocket it always had, so it needs no change at all: this plugin's init
//! script sets `window.alchemyScreensaver = {audio: true, url: "ws://127.0.0.1:<port>/audio?k=<key>"}`
//! and the socket carries the same frames (CONTRACT.md v4, v5):
//!
//! ```text
//! host -> page  {"rate":48000} once, then binary interleaved stereo f32, one message per capture
//!               period (10 ms), whole frames; {"type":"media",..} and {"type":"lyrics",..} text frames
//! page -> host  {"type":"mediaCmd"|"lyricsPref"|"wake",..}
//! ```
//!
//! A socket is served only with the per-launch key, which only this app's page is given: the port is
//! findable by anything local, and the socket is the system's sound, what is playing, and transport
//! and wake commands. Each socket runs its own capture and media threads, which stop when it closes,
//! so nothing listens to the speakers while no page is.
//!
//! A socket and not a Tauri `ipc::Channel`, by measurement (2026-09-29, player window, a −40 dBFS
//! tone, 100 messages/s, four 36 s runs each, CPU as % of one core): the socket added about 3 points
//! over no audio at all (host ~1, WebView2 browser and network ~2), the Channel about 50 (host ~10,
//! browser ~20, network ~4, renderer +17), and its latency was worse (median 0.7-1.6 ms against
//! 0.4-0.5 ms). A 3.8 KB Channel message is an `eval` plus an IPC fetch back through the main
//! thread; a socket message never touches the main thread or the page's IPC.
//!
//! Windows only for now: WASAPI loopback (`capture.rs`) and the Global System Media Transport
//! Controls (`media.rs`). Elsewhere the plugin is empty and the page animates on silence.

#[cfg(windows)]
mod capture;
mod lyrics;
#[cfg(windows)]
mod media;

use lyrics::Track;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

/// What the capture, media and lyrics threads hand the socket's thread.
pub enum Out {
    /// Interleaved stereo f32, whole frames.
    Pcm(Vec<u8>),
    /// The capture's sample rate, before its first samples.
    Rate(u32),
    /// A `media` frame and the track it names, for the lyrics lookup.
    Media(String, Option<Track>),
    /// A `lyrics` frame, for the track key it was looked up for.
    Lyrics(String, String),
}

/// Unsent bytes a stalled page may cost before messages are dropped: stale audio is worthless to a
/// visualizer, and the host's memory must not grow. The Deno host's MAX_BUFFERED, plus room for a
/// frame carrying cover art (up to ~270 KB).
const MAX_BUFFERED: usize = (1 << 19) + (1 << 19);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let b = Builder::new("audio");
    if !cfg!(windows) {
        return b.build();
    }
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(e) => {
            return b
                .setup(move |_, _| {
                    log::error!("audio: cannot listen: {e}");
                    Ok(())
                })
                .build();
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let key = key();
    // Only on the page's own origins: a page this webview is somehow navigated to must not be handed
    // the key. Spotify's own page is in a web view of its own, which gets no plugin's script.
    let script = format!(
        "if (/^(wmp\\.localhost|localhost)$/.test(location.hostname))
  window.alchemyScreensaver = Object.assign(window.alchemyScreensaver || {{}},
    {{ audio: true, url: 'ws://127.0.0.1:{port}/audio?k={key}' }});"
    );
    b.js_init_script(script)
        .setup(move |app, _| {
            let dir = crate::data_root()
                .or_else(|| app.path().app_local_data_dir().ok())
                .map(|d| d.join("lyrics"));
            log::info!("audio: serving 127.0.0.1:{port}");
            std::thread::spawn(move || {
                for s in listener.incoming().flatten() {
                    let (key, dir) = (key.clone(), dir.clone());
                    std::thread::spawn(move || serve(s, &key, dir));
                }
            });
            Ok(())
        })
        .build()
}

/// 128 random bits as hex.
fn key() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("no OS randomness");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn keyed(req: &Request, key: &str) -> bool {
    req.uri().path() == "/audio"
        && req
            .uri()
            .query()
            .is_some_and(|q| q.split('&').any(|kv| kv.strip_prefix("k=") == Some(key)))
}

fn serve(s: TcpStream, key: &str, dir: Option<PathBuf>) {
    // A client that connects and says nothing must not hold a thread forever.
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = s.set_nodelay(true);
    let check = |req: &Request, res: Response| -> Result<Response, ErrorResponse> {
        if keyed(req, key) {
            Ok(res)
        } else {
            let mut e = ErrorResponse::new(None);
            *e.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
            Err(e)
        }
    };
    let cfg = WebSocketConfig::default().max_write_buffer_size(MAX_BUFFERED);
    let ws = match tungstenite::accept_hdr_with_config(s, check, Some(cfg)) {
        Ok(ws) => ws,
        Err(e) => return log::warn!("audio: refused a socket: {e}"),
    };
    if ws.get_ref().set_nonblocking(true).is_err() {
        return;
    }
    log::info!("audio: socket open");
    Conn::new(dir).run(ws);
}

/// One page's socket: the thread that owns it, and the state the Deno relay kept per socket.
struct Conn {
    out: Sender<Out>,
    rx: Receiver<Out>,
    alive: Arc<AtomicBool>,
    dir: Option<PathBuf>,
    #[cfg(windows)]
    cmds: Sender<media::Msg>,
    lyrics_on: bool,
    track: Option<Track>,
    track_key: String,
    wake: bool,
    frames: u64,
    rate: u32,
}

impl Conn {
    fn new(dir: Option<PathBuf>) -> Self {
        let (out, rx) = channel();
        let alive = Arc::new(AtomicBool::new(true));
        #[cfg(windows)]
        capture::spawn(out.clone(), alive.clone());
        #[cfg(windows)]
        let cmds = media::spawn(out.clone(), alive.clone());
        Conn {
            out,
            rx,
            alive,
            dir,
            #[cfg(windows)]
            cmds,
            lyrics_on: true,
            track: None,
            track_key: "null".into(),
            wake: false,
            frames: 0,
            rate: 0,
        }
    }

    fn run(mut self, mut ws: WebSocket<TcpStream>) {
        let opened = Instant::now();
        let mut reported = false;
        let why = 'run: loop {
            // Woken by every capture period while audio plays; otherwise every 25 ms, to read the page.
            let mut next = self.rx.recv_timeout(Duration::from_millis(25)).ok();
            while let Some(m) = next {
                if let Some(msg) = self.outgoing(m) {
                    match ws.write(msg) {
                        Ok(()) | Err(tungstenite::Error::WriteBufferFull(_)) => {} // a stalled page: dropped
                        Err(tungstenite::Error::Io(e))
                            if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(e) => break 'run e.to_string(),
                    }
                }
                next = self.rx.try_recv().ok();
            }
            match ws.flush() {
                Ok(()) => {}
                Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => break e.to_string(),
            }
            loop {
                match ws.read() {
                    Ok(Message::Text(t)) => self.incoming(&t),
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(e))
                        if e.kind() == std::io::ErrorKind::WouldBlock =>
                    {
                        break;
                    }
                    Err(e) => break 'run e.to_string(),
                }
            }
            if !reported && opened.elapsed() >= Duration::from_secs(10) {
                reported = true; // the Deno host's page report, at about the same moment
                log::info!("audio: ws={}@{} after 10 s", self.frames, self.rate);
            }
        };
        self.alive.store(false, Ordering::Relaxed);
        if self.wake {
            set_wake(false);
        }
        log::info!(
            "audio: socket closed ({why}), ws={}@{}",
            self.frames,
            self.rate
        );
    }

    /// A producer's message: what to send the page, if anything.
    fn outgoing(&mut self, m: Out) -> Option<Message> {
        match m {
            Out::Pcm(b) => {
                self.frames += 1;
                return Some(Message::binary(b));
            }
            Out::Rate(r) => {
                // Once per socket. A capture restarted after a device change keeps streaming into
                // the same socket, and the page takes a second {"rate"} as a new source replacing
                // itself, which closes the socket (src/adapters/local/index.ts, openHostAudio). The
                // page ignores the rate's value, so a new device's rate needs no frame either.
                let first = self.rate == 0;
                self.rate = r;
                if !first {
                    log::info!("audio: capture restarted at {r} Hz");
                    return None;
                }
                return Some(Message::text(format!(r#"{{"rate":{r}}}"#)));
            }
            Out::Media(frame, track) => {
                let key = serde_json::to_string(&track).unwrap_or_default();
                self.track = track;
                if key != self.track_key {
                    self.track_key = key;
                    self.lyrics();
                }
                return Some(Message::text(frame));
            }
            Out::Lyrics(key, frame) => {
                // The track moved on while LRCLIB answered.
                (key == self.track_key).then(|| Message::text(frame))
            }
        }
    }

    /// Look the current track up, or say there are none: a task on Tauri's runtime, off the
    /// socket's thread, since LRCLIB can take its whole 5 s timeout.
    fn lyrics(&self) {
        let (key, out) = (self.track_key.clone(), self.out.clone());
        match (&self.track, self.lyrics_on) {
            (Some(t), true) => {
                let (t, dir) = (t.clone(), self.dir.clone());
                tauri::async_runtime::spawn(async move {
                    let (status, frame) = lyrics::lyrics_for(&t, dir.as_deref()).await;
                    log::info!("lyrics: {status} for {:?}", t.title);
                    let _ = out.send(Out::Lyrics(key, frame));
                });
            }
            _ => {
                let _ = out.send(Out::Lyrics(key, lyrics::none(self.track.as_ref())));
            }
        }
    }

    /// A text frame from the page.
    fn incoming(&mut self, t: &str) {
        let Ok(m) = serde_json::from_str::<serde_json::Value>(t) else {
            return;
        };
        match m["type"].as_str() {
            #[cfg(windows)]
            Some("mediaCmd") => {
                let cmd = m["cmd"].as_str().unwrap_or("");
                if ["playpause", "play", "pause", "next", "prev", "seek"].contains(&cmd) {
                    let pos = m["position"].as_f64().unwrap_or(0.0);
                    let _ = self.cmds.send(media::Msg::Cmd(cmd.to_string(), pos));
                }
            }
            Some("lyricsPref") => {
                // Only a change: the page says "on" as it connects, while the first lookup is out.
                let on = m["enabled"] != false;
                if on != self.lyrics_on {
                    self.lyrics_on = on;
                    self.lyrics();
                }
            }
            Some("wake") => {
                self.wake = m["on"] == true;
                log::info!("wake: {}", self.wake);
                set_wake(self.wake);
            }
            _ => {}
        }
    }
}

/// Keep the display and the machine awake while the page is full screen (CONTRACT.md v5, "wake").
/// Per thread, and this is the socket's thread: it is undone when the socket closes.
fn set_wake(on: bool) {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{
            ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
        };
        let f = if on {
            ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        unsafe { SetThreadExecutionState(f) };
    }
    #[cfg(not(windows))]
    let _ = on;
}

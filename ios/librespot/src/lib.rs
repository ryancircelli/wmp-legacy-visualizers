//! The app's Spotify Connect receiver (ios/README.md, "Librespot"): librespot's discovery, session,
//! Connect state and player, wired as librespot's own binary wires them (src/main.rs at v0.8.0), with
//! a sink that hands the app interleaved stereo f32 at 44100 Hz. The C ABI is wmp_librespot.h.

use std::{
    ffi::{CStr, CString, c_char, c_void},
    future::Future,
    pin::Pin,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use librespot_connect::{ConnectConfig, Spirc};
use librespot_core::{
    authentication::Credentials,
    cache::Cache,
    config::{DeviceType, SessionConfig},
    session::Session,
};
use librespot_discovery::Discovery;
use librespot_metadata::audio::{AudioItem, UniqueFields};
use librespot_playback::{
    audio_backend::{Sink, SinkResult},
    config::PlayerConfig,
    convert::Converter,
    decoder::AudioPacket,
    mixer::{self, MixerConfig},
    player::{Player, PlayerEvent},
};
use sha1::{Digest, Sha1};
use tokio::sync::{mpsc, oneshot};

pub type PcmCb = extern "C" fn(*mut c_void, *const f32, usize);
pub type LogCb = extern "C" fn(*mut c_void, *const c_char);
pub type StateCb = extern "C" fn(*mut c_void, *const c_char);
pub type NpCb = extern "C" fn(*mut c_void, *const c_char);

#[derive(Clone, Copy)]
struct Host {
    pcm: PcmCb,
    log: LogCb,
    state: StateCb,
    np: NpCb,
    ctx: usize, // the app's pointer, handed back untouched
}

// ponytail: one receiver per process, its callbacks global; the app starts one at launch.
static HOST: Mutex<Option<Host>> = Mutex::new(None);
static STOP: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static TOKENS: Mutex<Option<mpsc::UnboundedSender<(String, String, String)>>> = Mutex::new(None);
static COMMANDS: Mutex<Option<mpsc::UnboundedSender<String>>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// Copied out, so no lock is held while the app's callback runs (pcm blocks on purpose).
fn host() -> Option<Host> {
    *lock(&HOST)
}

// The session's state to the app: the device id while one is up, NULL when none is.
fn state(id: Option<&str>) {
    if let Some(h) = host() {
        match id.and_then(|i| CString::new(i).ok()) {
            Some(c) => (h.state)(h.ctx as *mut c_void, c.as_ptr()),
            None => (h.state)(h.ctx as *mut c_void, std::ptr::null()),
        }
    }
}

fn say(line: &str) {
    if let (Some(h), Ok(c)) = (host(), CString::new(line)) {
        (h.log)(h.ctx as *mut c_void, c.as_ptr());
    }
}

// The track the now-playing messages carry, kept from the last TrackChanged so each message is whole.
#[derive(Default)]
struct Track {
    title: String,
    artist: String,
    album: String,
    art: String,
    duration: u32,
    uri: String,
}

impl Track {
    fn new(a: &AudioItem) -> Self {
        let (artist, album) = match &a.unique_fields {
            UniqueFields::Track { artists, album, .. } => {
                (artists.iter().map(|x| x.name.as_str()).collect::<Vec<_>>().join(", "), album.clone())
            }
            UniqueFields::Local { artists, album, .. } => {
                (artists.clone().unwrap_or_default(), album.clone().unwrap_or_default())
            }
            UniqueFields::Episode { show_name, .. } => (show_name.clone(), String::new()),
        };
        Track {
            title: a.name.clone(),
            artist,
            album,
            art: a.covers.iter().max_by_key(|c| c.width).map(|c| c.url.clone()).unwrap_or_default(),
            duration: a.duration_ms,
            uri: a.uri.clone(),
        }
    }
}

// A JSON string literal: quotes, backslashes and control characters escaped.
fn quote(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if c < ' ' => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

// What plays, to the app (wmp_librespot.h): one whole JSON object each time.
fn now_playing(t: &Track, playing: bool, position: u32) {
    let json = format!(
        r#"{{"playing":{playing},"position":{position},"title":{},"artist":{},"album":{},"art":{},"duration":{},"uri":{}}}"#,
        quote(&t.title),
        quote(&t.artist),
        quote(&t.album),
        quote(&t.art),
        t.duration,
        quote(&t.uri)
    );
    if let (Some(h), Ok(c)) = (host(), CString::new(json)) {
        (h.np)(h.ctx as *mut c_void, c.as_ptr());
    }
}

// librespot's own log (info and up) into the app's log: its errors are the only word on why a
// connect failed.
struct Forward;

impl log::Log for Forward {
    fn enabled(&self, m: &log::Metadata) -> bool {
        m.level() <= log::Level::Info && m.target().starts_with("librespot")
    }

    fn log(&self, r: &log::Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        match r.level() {
            log::Level::Info => say(&format!("librespot: {}", r.args())),
            level => say(&format!("librespot: {level}: {}", r.args())),
        }
    }

    fn flush(&self) {}
}

// The app's sink: librespot decodes at 44100 Hz stereo, f64 interleaved.
struct HostSink;

impl Sink for HostSink {
    fn stop(&mut self) -> SinkResult<()> {
        if let Some(h) = host() {
            (h.pcm)(h.ctx as *mut c_void, std::ptr::null(), 0);
        }
        Ok(())
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        if let (AudioPacket::Samples(samples), Some(h)) = (packet, host()) {
            let f = converter.f64_to_f32(&samples);
            (h.pcm)(h.ctx as *mut c_void, f.as_ptr(), f.len() / 2);
        }
        Ok(())
    }
}

/// # Safety
/// `name`, `id` (may be NULL) and `cache_dir` are NUL-terminated UTF-8; the callbacks and `ctx`
/// outlive the receiver.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wmp_ls_start(
    name: *const c_char,
    id: *const c_char,
    cache_dir: *const c_char,
    pcm: PcmCb,
    log: LogCb,
    state: StateCb,
    np: NpCb,
    ctx: *mut c_void,
) -> i32 {
    if name.is_null() || cache_dir.is_null() {
        return -1;
    }
    let (name, dir) = unsafe {
        (
            CStr::from_ptr(name).to_string_lossy().into_owned(),
            CStr::from_ptr(cache_dir).to_string_lossy().into_owned(),
        )
    };
    let id = if id.is_null() { String::new() } else { unsafe { CStr::from_ptr(id) }.to_string_lossy().into_owned() };
    let id = if id.is_empty() { name.clone() } else { id };
    let mut stop = lock(&STOP);
    if stop.is_some() {
        return -1;
    }
    *lock(&HOST) = Some(Host {
        pcm,
        log,
        state,
        np,
        ctx: ctx as usize,
    });
    if log::set_logger(&Forward).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    let (tx, rx) = oneshot::channel();
    let (token_tx, tokens) = mpsc::unbounded_channel();
    *lock(&TOKENS) = Some(token_tx);
    let (command_tx, commands) = mpsc::unbounded_channel();
    *lock(&COMMANDS) = Some(command_tx);
    let spawned = std::thread::Builder::new()
        .name("librespot".into())
        .spawn(move || {
            match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
                Ok(rt) => rt.block_on(run(name, id, dir, rx, tokens, commands)),
                Err(e) => say(&format!("librespot: no runtime: {e}")),
            }
        });
    if spawned.is_err() {
        return -1;
    }
    *stop = Some(tx);
    0
}

/// # Safety
/// `token` is NUL-terminated UTF-8.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wmp_ls_token(token: *const c_char, client_id: *const c_char, client_token: *const c_char) {
    if token.is_null() {
        return;
    }
    let s = |p: *const c_char| {
        if p.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
        }
    };
    if let Some(tx) = lock(&TOKENS).as_ref() {
        let _ = tx.send((s(token), s(client_id), s(client_token)));
    }
}

/// # Safety
/// `cmd` is NUL-terminated UTF-8.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wmp_ls_command(cmd: *const c_char) {
    if cmd.is_null() {
        return;
    }
    let cmd = unsafe { CStr::from_ptr(cmd) }.to_string_lossy().into_owned();
    if let Some(tx) = lock(&COMMANDS).as_ref() {
        let _ = tx.send(cmd);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn wmp_ls_stop() {
    if let Some(tx) = lock(&STOP).take() {
        let _ = tx.send(());
    }
}

type SpircTask = Pin<Box<dyn Future<Output = ()> + Send>>;

// What the next connect logs in with, and where it came from (for the log).
type Login = (Credentials, &'static str);

async fn run(
    name: String,
    id: String,
    dir: String,
    mut stop: oneshot::Receiver<()>,
    mut tokens: mpsc::UnboundedReceiver<(String, String, String)>,
    mut commands: mpsc::UnboundedReceiver<String>,
) {
    const WINDOW: Duration = Duration::from_secs(600);
    const RECONNECTS: usize = 5; // per WINDOW, as librespot's binary allows
    const TOKEN_LIFE: Duration = Duration::from_secs(50 * 60); // the web player's last an hour

    // Stable across launches, as librespot's binary derives it from the name: the credentials blob a
    // phone hands over is encrypted for this id, and the Spotify app keeps one entry per id. From the
    // app's install id and not the name, so two devices with one name stay two devices and a rename
    // keeps the device.
    let device_id: String = Sha1::digest(id.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    // login5 (the token behind spclient, which Spirc needs) honours stored credentials only with the
    // client id they were made for: the web player's for a web token, which the page sends with each
    // token and which outlives the launch here, next to the cached credentials it goes with.
    let client_id_file = format!("{dir}/client_id");
    let mut session_config = SessionConfig {
        device_id: device_id.clone(),
        ..SessionConfig::default()
    };
    if let Ok(c) = std::fs::read_to_string(&client_id_file) {
        if !c.trim().is_empty() {
            session_config.client_id = c.trim().to_owned();
        }
    }
    // Credentials and volume only: no audio cache.
    let cache = Cache::new(Some(&dir), Some(&dir), None, None)
        .map_err(|e| say(&format!("librespot: no cache: {e}")))
        .ok();
    // A session up saves its reusable credentials in the cache, whatever it logged in with.
    let cached = |cache: &Option<Cache>| -> Option<Login> {
        cache.as_ref().and_then(Cache::credentials).map(|c| (c, "cached"))
    };
    let mut next: Option<Login> = cached(&cache); // the next connect's, ahead of the fallbacks
    if next.is_some() {
        say("librespot: cached credentials");
    }
    let mut token: Option<(String, Instant)> = None; // the web player's latest
    let mut client_token: Option<String> = None; // the web player's, with it
    // The web player's tokens into the session, in place of login5's and clienttoken's (core.patch):
    // login5 refused the credentials a web login gives (INVALID_CREDENTIALS with Keymaster's client
    // id, BAD_REQUEST with the web player's: builds 22 and 23), and the web player's own pair is what
    // spclient and the dealer take from the web player anyway. Before each connect, and on each token.
    let inject = |session: &Session, token: &Option<(String, Instant)>, ct: &Option<String>| {
        if let Some((t, at)) = token {
            let left = TOKEN_LIFE.saturating_sub(at.elapsed());
            if !left.is_zero() {
                session.login5().set_auth_token(t.clone(), left);
            }
        }
        if let Some(c) = ct {
            session.spclient().set_client_token(c.clone(), Duration::from_secs(24 * 3600));
        }
    };

    let mut discovery = match Discovery::builder(device_id.clone(), session_config.client_id.clone())
        .name(name.clone())
        .device_type(DeviceType::Speaker)
        .launch()
    {
        Ok(d) => {
            say("librespot: discovery up");
            Some(d)
        }
        Err(e) => {
            say(&format!("librespot: discovery failed: {e}"));
            None
        }
    };

    let mixer = match mixer::find(None).map(|open| open(MixerConfig::default())) {
        Some(Ok(m)) => m,
        _ => {
            say("librespot: no mixer");
            return;
        }
    };
    let mut session = Session::new(session_config.clone(), cache.clone());
    let player = Player::new(
        PlayerConfig::default(),
        session.clone(),
        mixer.get_soft_volume(),
        || Box::new(HostSink),
    );
    let mut events = player.get_player_event_channel();
    // Full volume: the phone's own volume is the one to turn.
    let config = ConnectConfig {
        name,
        device_type: DeviceType::Speaker,
        initial_volume: u16::MAX,
        ..ConnectConfig::default()
    };

    let mut spirc: Option<Spirc> = None;
    let mut task: Option<SpircTask> = None;
    // The first connect waits for the page's token (at mount, within seconds), which every connect
    // needs (inject); the cached credentials, when there are some, are then the first to log in with.
    let mut connecting = false;
    let mut retry = false; // the next connect follows a failure: it waits 5 s first
    let mut reconnects: Vec<Instant> = vec![];
    let mut track = Track::default(); // the now-playing messages' track and state
    let mut playing = false;

    loop {
        tokio::select! {
            _ = &mut stop => break,
            c = async {
                match discovery.as_mut() {
                    Some(d) => d.next().await,
                    None => None,
                }
            }, if discovery.is_some() => match c {
                Some(c) => {
                    say("librespot: credentials from discovery");
                    next = Some((c, "discovery"));
                    reconnects.clear();
                    retry = false;
                    if let Some(s) = spirc.take() {
                        let _ = s.shutdown();
                    }
                    if let Some(t) = task.take() {
                        tokio::spawn(t); // its shutdown finishes on its own
                    }
                    if !session.is_invalid() {
                        session.shutdown();
                    }
                    connecting = true;
                }
                None => {
                    say("librespot: discovery stopped");
                    discovery = None;
                }
            },
            _ = async {}, if connecting => {
                connecting = false;
                if retry {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
                if session.is_invalid() {
                    session = Session::new(session_config.clone(), cache.clone());
                    player.set_session(session.clone());
                }
                inject(&session, &token, &client_token);
                // A pick or a token that has just come, else the web player's token while fresh,
                // else what the cache holds.
                let fresh = token.as_ref().filter(|(_, at)| at.elapsed() < TOKEN_LIFE)
                    .map(|(t, _)| (Credentials::with_access_token(t.as_str()), "token"));
                let Some((c, via)) = next.take().or(fresh).or_else(|| cached(&cache)) else { continue };
                match Spirc::new(config.clone(), session.clone(), c, player.clone(), mixer.clone()).await {
                    Ok((s, t)) => {
                        say(&format!("librespot: session up ({via})"));
                        state(Some(&device_id));
                        spirc = Some(s);
                        task = Some(Box::pin(t));
                    }
                    Err(e) => {
                        say(&format!("librespot: connect failed ({via}): {e}"));
                        session.shutdown(); // a fresh session for the next try
                        if via == "token" {
                            // The same token would fail the same way: the next one tries again.
                            token = None;
                            connecting = false;
                        } else {
                            connecting = again(&mut reconnects, WINDOW, RECONNECTS);
                        }
                        retry = true;
                    }
                }
            },
            _ = async {
                if let Some(t) = task.as_mut() {
                    t.await;
                }
            }, if task.is_some() && !connecting => {
                task = None;
                spirc = None;
                say("librespot: session ended");
                state(None);
                if !session.is_invalid() {
                    session.shutdown();
                }
                connecting = again(&mut reconnects, WINDOW, RECONNECTS);
                retry = true;
            },
            Some((t, c, ct)) = tokens.recv() => {
                if !c.is_empty() && c != session_config.client_id {
                    session_config.client_id = c;
                    let _ = std::fs::write(&client_id_file, &session_config.client_id);
                    if !session.is_invalid() {
                        session.set_client_id(&session_config.client_id);
                    }
                }
                token = Some((t, Instant::now())); // kept for the next reconnect either way
                if !ct.is_empty() {
                    client_token = Some(ct);
                }
                if !session.is_invalid() {
                    inject(&session, &token, &client_token);
                }
                let idle = task.is_none() && !connecting;
                if idle {
                    if next.is_none() {
                        say("librespot: logging in with the token");
                        next = token.as_ref().map(|(t, _)| (Credentials::with_access_token(t.as_str()), "token"));
                    } else {
                        say("librespot: logging in with the cached credentials");
                    }
                    connecting = true;
                    retry = false;
                }
            },
            // Control Center's buttons (wmp_ls_command), to the live session.
            Some(c) = commands.recv() => {
                let Some(s) = spirc.as_ref() else {
                    say(&format!("librespot: {c}: no session"));
                    continue;
                };
                let done = match c.as_str() {
                    "play" => s.play(),
                    "pause" => s.pause(),
                    "toggle" => s.play_pause(),
                    "next" => s.next(),
                    "prev" => s.prev(),
                    _ => match c.strip_prefix("seek:").and_then(|ms| ms.parse().ok()) {
                        Some(ms) => s.set_position_ms(ms),
                        None => {
                            say(&format!("librespot: unknown command {c}"));
                            continue;
                        }
                    },
                };
                if let Err(e) = done {
                    say(&format!("librespot: {c} failed: {e}"));
                }
            },
            Some(e) = events.recv() => match e {
                PlayerEvent::TrackChanged { audio_item } => {
                    track = Track::new(&audio_item);
                    say(&format!("librespot: now playing: {} \u{2014} {}", track.title, track.artist));
                    now_playing(&track, playing, 0);
                }
                PlayerEvent::Playing { position_ms, .. } => {
                    say("librespot: playing");
                    playing = true;
                    now_playing(&track, playing, position_ms);
                }
                PlayerEvent::Paused { position_ms, .. } => {
                    say("librespot: paused");
                    playing = false;
                    now_playing(&track, playing, position_ms);
                }
                PlayerEvent::Seeked { position_ms, .. } => now_playing(&track, playing, position_ms),
                // Not a pause: the next track's Playing follows at once, and Control Center flickered to
                // paused at every track change. A session that ends here says Paused or Stopped itself.
                PlayerEvent::EndOfTrack { .. } => now_playing(&track, playing, track.duration),
                PlayerEvent::Stopped { .. } => {
                    say("librespot: stopped");
                    playing = false;
                    track = Track::default();
                    now_playing(&track, playing, 0);
                }
                PlayerEvent::Unavailable { track_id, .. } => say(&format!("librespot: unavailable: {track_id:?}")),
                _ => {}
            },
        }
    }

    say("librespot: shutting down");
    if let Some(s) = spirc {
        let _ = s.shutdown();
    }
    if let Some(t) = task {
        t.await;
    }
    if let Some(d) = discovery {
        d.shutdown().await;
    }
}

// Another connect, unless there were `max` in the last `window`: then it waits for the phone to pick
// the device again (fresh credentials) or for the next launch.
fn again(times: &mut Vec<Instant>, window: Duration, max: usize) -> bool {
    times.retain(|t| t.elapsed() < window);
    if times.len() >= max {
        say("librespot: too many reconnects, waiting to be picked again");
        return false;
    }
    times.push(Instant::now());
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn quote_escapes() {
        assert_eq!(super::quote("a\"b\\c\n\u{1}é—"), r#""a\"b\\c\u000a\u0001é—""#);
    }
}

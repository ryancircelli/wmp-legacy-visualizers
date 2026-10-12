//! Now Playing: the current Windows media session (Global System Media Transport Controls), as
//! `media` frames for the page, and the page's transport commands. CONTRACT.md, "v4 — Now Playing".
//! The helper's media thread (the Deno host's audio/src/media.rs), moved in process.
//!
//! One frame per change, and once a second while playing so the page's clock never drifts far:
//!   {"type":"media","status":"playing","title":..,"artist":..,"album":..,"app":..,"duration":s,
//!    "canSeek":b,"canNext":b,"canPrev":b,"position":s,"art":"data:..."|null}
//! The art is re-read only when the track or its properties change, and every frame carries the last
//! one, as the Deno relay filled it in.

use super::Out;
use super::lyrics::Track;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Storage::Streams::{Buffer, InputStreamOptions};

pub enum Msg {
    /// A session event fired; `true` when it was MediaPropertiesChanged (re-read the art).
    Wake(bool),
    /// From the page: the command and, for "seek", a position in seconds.
    Cmd(String, f64),
}

/// Bigger thumbnails are dropped rather than shipped: a data URL this size is already ~270 KB.
const MAX_ART: u64 = 200_000;

/// The media thread for one socket; its commands go to the returned sender. Failing (no WinRT media
/// stack, say on an N edition) costs the metadata only, never the audio.
pub fn spawn(out: Sender<Out>, alive: Arc<AtomicBool>) -> Sender<Msg> {
    let (tx, rx) = channel();
    let wake = tx.clone();
    std::thread::spawn(move || {
        let _ = wasapi::initialize_mta().ok();
        if let Err(e) = run(wake, rx, &out, &alive) {
            log::warn!("media: {e}");
        }
    });
    tx
}

fn wake<S: windows::core::RuntimeType + 'static, R: windows::core::RuntimeType + 'static>(
    tx: &Sender<Msg>,
    props: bool,
) -> TypedEventHandler<S, R> {
    let tx = tx.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = tx.send(Msg::Wake(props));
        Ok(())
    })
}

fn json(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

/// 100 ns ticks since 1601, the clock WinRT's DateTime counts in.
fn now_ticks() -> i64 {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    (d.as_nanos() / 100) as i64 + 116_444_736_000_000_000
}

fn art(p: &Props) -> windows::core::Result<Option<String>> {
    let Ok(r) = p.Thumbnail() else {
        return Ok(None);
    }; // null thumbnail comes back as an error
    let s = r.OpenReadAsync()?.join()?;
    let n = s.Size()?;
    if n == 0 || n > MAX_ART {
        return Ok(None);
    }
    let b = s
        .ReadAsync(
            &Buffer::Create(n as u32)?,
            n as u32,
            InputStreamOptions::None,
        )?
        .join()?;
    let mime = s.ContentType()?.to_string();
    let mime = if mime.starts_with("image/") {
        mime
    } else {
        "image/png".into() // <img> sniffs anyway
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        CryptographicBuffer::EncodeToBase64String(&b)?
    )))
}

fn command(s: &Session, cmd: &str, pos: f64) -> windows::core::Result<bool> {
    match cmd {
        "playpause" => s.TryTogglePlayPauseAsync()?.join(),
        "play" => s.TryPlayAsync()?.join(),
        "pause" => s.TryPauseAsync()?.join(),
        "next" => s.TrySkipNextAsync()?.join(),
        "prev" => s.TrySkipPreviousAsync()?.join(),
        "seek" => {
            // Positions are in the session's own timeline, which need not start at zero.
            let start = s.GetTimelineProperties()?.StartTime()?.Duration;
            s.TryChangePlaybackPositionAsync(start + (pos.max(0.0) * 1e7) as i64)?
                .join()
        }
        _ => Ok(false),
    }
}

struct Sub {
    s: Session,
    tokens: [i64; 3],
}
impl Drop for Sub {
    fn drop(&mut self) {
        let _ = self.s.RemoveMediaPropertiesChanged(self.tokens[0]);
        let _ = self.s.RemovePlaybackInfoChanged(self.tokens[1]);
        let _ = self.s.RemoveTimelinePropertiesChanged(self.tokens[2]);
    }
}

/// The frame minus position and art (the part that counts as a "change"), whether it is playing,
/// the position, its timeline stamp, the duration, the track, and the properties the art is in.
fn read(s: &Session) -> windows::core::Result<(String, bool, f64, i64, f64, Track, Props)> {
    let info = s.GetPlaybackInfo()?;
    let st = info.PlaybackStatus()?;
    let playing = st == Status::Playing;
    let status = match st {
        Status::Playing => "playing",
        Status::Paused => "paused",
        _ => "stopped",
    };
    let c = info.Controls()?;
    let p = s.TryGetMediaPropertiesAsync()?.join()?;
    let tl = s.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let dur = ((tl.EndTime()?.Duration - start) as f64 / 1e7).max(0.0);
    let pos = (tl.Position()?.Duration - start) as f64 / 1e7;
    let upd = tl.LastUpdatedTime()?.UniversalTime;
    let track = Track {
        title: p.Title()?.to_string(),
        artist: p.Artist()?.to_string(),
        album: p.AlbumTitle()?.to_string(),
        duration: (dur * 100.0).round() / 100.0,
    };
    let key = format!(
        r#"{{"type":"media","status":"{status}","title":{},"artist":{},"album":{},"app":{},"duration":{dur:.2},"canSeek":{},"canNext":{},"canPrev":{}"#,
        json(&track.title),
        json(&track.artist),
        json(&track.album),
        json(&s.SourceAppUserModelId()?.to_string()),
        c.IsPlaybackPositionEnabled()?,
        c.IsNextEnabled()?,
        c.IsPreviousEnabled()?,
    );
    Ok((key, playing, pos, upd, dur, track, p))
}

const NONE: &str = r#"{"type":"media","status":"none","title":"","artist":"","album":"","app":"","duration":0.00,"canSeek":false,"canNext":false,"canPrev":false"#;

fn run(
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    out: &Sender<Out>,
    alive: &AtomicBool,
) -> windows::core::Result<()> {
    let mgr = Manager::RequestAsync()?.join()?;
    let changed = mgr.CurrentSessionChanged(&wake(&tx, true))?;
    let mut sub: Option<Sub> = None;
    let (mut last_key, mut last_art_key) = (String::new(), String::new());
    let mut art: Option<String> = None;
    let mut last_emit = Instant::now();
    let mut props_dirty = true;
    let mut force = true;
    let (mut was_playing, mut resumed) = (None, 0i64);
    let mut seen = String::new();
    while alive.load(Ordering::Relaxed) {
        let s = mgr.GetCurrentSession().ok();
        if sub.as_ref().map(|x| &x.s) != s.as_ref() {
            // A session that vanishes mid-subscribe is not fatal: `sub` stays None and the next
            // poll tries again.
            sub = s.as_ref().and_then(|s| {
                Some(Sub {
                    tokens: [
                        s.MediaPropertiesChanged(&wake(&tx, true)).ok()?,
                        s.PlaybackInfoChanged(&wake(&tx, false)).ok()?,
                        s.TimelinePropertiesChanged(&wake(&tx, false)).ok()?,
                    ],
                    s: s.clone(),
                })
            });
            props_dirty = true;
            was_playing = None;
        }
        let (key, playing, pos, track) = match s.as_ref().map(read) {
            Some(Ok((key, playing, mut pos, upd, dur, track, p))) => {
                // Many apps (browsers, Spotify) publish Position only on a state change or a seek,
                // stamped with LastUpdatedTime: run the clock forward from there while playing. Not
                // from before a resume we saw, though: the timeline still carries the pause's
                // stamp for a moment after the status flips back to playing.
                if playing && was_playing == Some(false) {
                    resumed = now_ticks();
                }
                was_playing = Some(playing);
                if playing && upd > 0 {
                    pos += ((now_ticks() - upd.max(resumed)) as f64 / 1e7).max(0.0);
                }
                pos = if dur > 0.0 {
                    pos.clamp(0.0, dur)
                } else {
                    pos.max(0.0)
                };
                // The art is re-read only when the track or the properties changed: it is a
                // cross-process stream read, and Spotify publishes it a moment after the title.
                let art_key = key.split(r#","duration""#).next().unwrap_or("").to_string();
                if props_dirty || art_key != last_art_key {
                    last_art_key = art_key;
                    let a = self::art(&p).unwrap_or(None);
                    force |= a != art;
                    art = a;
                }
                let track = (!track.title.is_empty()).then_some(track);
                (key, playing, pos, track)
            }
            // No session, or one that vanished mid-read (the next poll settles it).
            _ => {
                was_playing = None;
                last_art_key.clear();
                force |= art.take().is_some();
                (NONE.to_string(), false, 0.0, None)
            }
        };
        props_dirty = false;
        if force || key != last_key || (playing && last_emit.elapsed() >= Duration::from_secs(1)) {
            let a = art.as_deref().map_or("null".into(), json);
            let frame = format!(r#"{key},"position":{pos:.2},"art":{a}}}"#);
            let now = summary(&key, art.as_ref().map(|a| a.len()));
            if now != seen {
                log::info!("media: {now}");
                seen = now;
            }
            if out.send(Out::Media(frame, track)).is_err() {
                break;
            }
            last_key = key;
            last_emit = Instant::now();
            force = false;
        }
        // Sleep until the next poll, or less when an event or a command arrives.
        let mut first = match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(m) => Some(m),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        while let Some(m) = first.take().or_else(|| rx.try_recv().ok()) {
            match m {
                Msg::Wake(p) => {
                    props_dirty |= p;
                    force = true;
                }
                Msg::Cmd(c, pos) => {
                    let ok = s.as_ref().map(|s| command(s, &c, pos));
                    log::info!("media: command {c} {pos} -> {ok:?}");
                    force = true;
                }
            }
        }
    }
    let _ = mgr.RemoveCurrentSessionChanged(changed);
    Ok(())
}

/// `playing Spotify.exe "Title" / Artist art=12345` for the log, the Deno relay's line.
fn summary(key: &str, art: Option<usize>) -> String {
    let v: serde_json::Value = serde_json::from_str(&format!("{key}}}")).unwrap_or_default();
    let f = |k: &str| v[k].as_str().unwrap_or("").to_string();
    format!(
        "{} {} {:?} / {} art={}",
        f("status"),
        f("app"),
        f("title"),
        f("artist"),
        art.map_or("none".into(), |n| n.to_string())
    )
}

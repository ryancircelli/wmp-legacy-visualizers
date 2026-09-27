// Now Playing: the current Windows media session (Global System Media Transport Controls), as JSON
// lines on stderr, with transport commands taken from stdin. CONTRACT.md, "v4 — Now Playing".
//
// One line per change, and once a second while playing so the page's clock never drifts far:
//   {"type":"media","status":"playing","title":..,"artist":..,"album":..,"app":..,"position":s,
//    "duration":s,"canSeek":b,"canNext":b,"canPrev":b[,"art":"data:..."|null]}
// "art" is present only when it changed (it can be ~270 KB of base64); the host remembers the last
// one and fills it into every frame it hands the page (audio.ts).
//
// Anything else on stderr (no leading '{') is an error line for the host's log.
use std::io::Write;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
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
    /// From stdin: the command and, for "seek", a position in seconds.
    Cmd(String, f64),
}

/// Bigger thumbnails are dropped rather than shipped: a data URL this size is already ~270 KB.
const MAX_ART: u64 = 200_000;

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

pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// The value of `key` in a flat JSON object the host wrote itself (audio.ts sends exactly
/// {"cmd":"..","position":n}), so no general parser is needed.
pub fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let i = line.find(&format!("\"{key}\""))? + key.len() + 2;
    let v = line[i..].trim_start().strip_prefix(':')?.trim_start();
    Some(v.split([',', '}']).next()?.trim().trim_matches('"'))
}

/// 100 ns ticks since 1601, the clock WinRT's DateTime counts in.
fn now_ticks() -> i64 {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    (d.as_nanos() / 100) as i64 + 116_444_736_000_000_000
}

fn art(p: &Props) -> windows::core::Result<Option<String>> {
    let Ok(r) = p.Thumbnail() else { return Ok(None) }; // null thumbnail comes back as an error
    let s = r.OpenReadAsync()?.join()?;
    let n = s.Size()?;
    if n == 0 || n > MAX_ART {
        return Ok(None);
    }
    let b = s.ReadAsync(&Buffer::Create(n as u32)?, n as u32, InputStreamOptions::None)?.join()?;
    let mime = s.ContentType()?.to_string();
    let mime = if mime.starts_with("image/") { mime } else { "image/png".into() }; // <img> sniffs anyway
    Ok(Some(format!("data:{mime};base64,{}", CryptographicBuffer::EncodeToBase64String(&b)?)))
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
            s.TryChangePlaybackPositionAsync(start + (pos.max(0.0) * 1e7) as i64)?.join()
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

/// The frame minus position and art, plus the position: the part that counts as a "change", and
/// the extrapolated position that is sent along with it.
fn read(s: &Session) -> windows::core::Result<(String, bool, f64, i64, f64, Props)> {
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
    let key = format!(
        r#"{{"type":"media","status":"{status}","title":{},"artist":{},"album":{},"app":{},"duration":{dur:.2},"canSeek":{},"canNext":{},"canPrev":{}"#,
        esc(&p.Title()?.to_string()),
        esc(&p.Artist()?.to_string()),
        esc(&p.AlbumTitle()?.to_string()),
        esc(&s.SourceAppUserModelId()?.to_string()),
        c.IsPlaybackPositionEnabled()?,
        c.IsNextEnabled()?,
        c.IsPreviousEnabled()?,
    );
    Ok((key, playing, pos, upd, dur, p))
}

pub fn run(tx: Sender<Msg>, rx: Receiver<Msg>) -> windows::core::Result<()> {
    let mgr = Manager::RequestAsync()?.join()?;
    mgr.CurrentSessionChanged(&wake(&tx, true))?;
    let mut sub: Option<Sub> = None;
    let (mut last_key, mut last_art_key) = (String::new(), String::new());
    let mut last_art: Option<Option<String>> = None; // None = never sent
    let mut last_emit = Instant::now();
    let mut props_dirty = true;
    let mut force = true;
    let (mut was_playing, mut resumed) = (None, 0i64);
    let err = std::io::stderr();
    loop {
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
        let (key, playing, pos, art) = match s.as_ref().map(read) {
            Some(Ok((key, playing, mut pos, upd, dur, p))) => {
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
                pos = if dur > 0.0 { pos.clamp(0.0, dur) } else { pos.max(0.0) };
                // The art is re-read only when the track or the properties changed: it is a
                // cross-process stream read, and Spotify publishes it a moment after the title.
                let art_key = key.split(r#","duration""#).next().unwrap_or("").to_string();
                let art = if props_dirty || art_key != last_art_key {
                    last_art_key = art_key;
                    Some(self::art(&p).unwrap_or(None))
                } else {
                    None
                };
                (key, playing, pos, art)
            }
            // No session, or one that vanished mid-read (the next poll settles it).
            _ => {
                was_playing = None;
                (
                r#"{"type":"media","status":"none","title":"","artist":"","album":"","app":"","duration":0.00,"canSeek":false,"canNext":false,"canPrev":false"#.into(),
                false,
                0.0,
                Some(None),
                )
            }
        };
        props_dirty = false;
        let art = art.filter(|a| last_art.as_ref() != Some(a));
        if force || key != last_key || art.is_some() || (playing && last_emit.elapsed() >= Duration::from_secs(1)) {
            let mut line = format!(r#"{key},"position":{pos:.2}"#);
            if let Some(a) = &art {
                line += &format!(r#","art":{}"#, a.as_deref().map_or("null".into(), esc));
                last_art = Some(art.clone().unwrap());
            }
            line += "}\n";
            let mut e = err.lock();
            let _ = e.write_all(line.as_bytes()).and_then(|_| e.flush());
            last_key = key;
            last_emit = Instant::now();
            force = false;
        }
        // Sleep until the next poll, or less when an event or a command arrives.
        let mut first = match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(m) => Some(m),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
        while let Some(m) = first.take().or_else(|| rx.try_recv().ok()) {
            match m {
                Msg::Wake(p) => {
                    props_dirty |= p;
                    force = true;
                }
                Msg::Cmd(c, pos) => {
                    if let Some(s) = &s {
                        let _ = command(s, &c, pos);
                    }
                    force = true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_bits() {
        assert_eq!(esc("a\"b\\c\n"), r#""a\"b\\c\u000a""#);
        let l = r#"{"cmd":"seek","position":12.5}"#;
        assert_eq!(field(l, "cmd"), Some("seek"));
        assert_eq!(field(l, "position"), Some("12.5"));
        assert_eq!(field(r#"{"cmd":"next"}"#, "position"), None);
    }
}

//! Crossfade on the app's own speaker (wmp_ls_command "crossfade:<s>"). librespot is only gapless: at a
//! track's natural end its player goes straight on to the next with no word to the sink. So with a
//! crossfade set, the sink keeps up to that many seconds queued ahead of what is heard (a FIFO that a
//! pump thread of its own hands the host, which blocks as ever and keeps it real time), and at a
//! natural end mixes the next track's start into the old track's tail still queued. Off (0, the
//! default) the sink hands the host each packet itself, as it always has: no queue, no thread.
//!
//! What happened between two packets is read off the player's own events, from a channel of the sink's
//! own, drained on the player thread at each write and stop: the player sends them on that thread before
//! the samples that follow, so their order against the samples is exact (no timing). An EndOfTrack with
//! nothing written after it, then a TrackChanged, is a natural end (the decoder ran off the track and
//! the player went on); a TrackChanged without one (a skip, a load, a transfer), a Seeked or a Stopped
//! makes what is queued stale: it is dropped, so the new audio is heard at once.
//!
//! What the app is told switches to the next track at the fade's midpoint, not as the next track's
//! first samples come in under the old one's (the owner, 2026-10-03: "at 8 second fade it should be 4
//! of song before and 4 of song after / and ui should switch at the original point of the song end
//! (halfway through fade)"). The sink records where that is in the stream (`Switch`); lib.rs holds
//! the new track's reports until the pump has handed it over (`Verdict`), so a pause holds them too.

use std::{
    collections::VecDeque,
    f32::consts::FRAC_PI_2,
    sync::{
        Arc, Condvar, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU32, Ordering::Relaxed},
    },
    thread::JoinHandle,
    time::Duration,
};

use librespot_playback::player::{PlayerEvent, PlayerEventChannel};
use tokio::sync::Notify;

/// Samples a second: 44100 Hz, interleaved stereo.
const SPS: usize = 44100 * 2;
/// A tail shorter than this is not faded: the next track follows it (gapless).
const MIN_FADE: usize = SPS / 4;
/// What the pump hands the host at a time (2048 frames, 46 ms).
const CHUNK: usize = 2048 * 2;
/// The longest the decoder waits in one write: a shortened (or switched off) crossfade drains its
/// surplus a tenth of a second at a time, so the player's commands are not held up meanwhile.
const WAIT: Duration = Duration::from_millis(100);

/// The crossfade in seconds (0 off), the page's to set (wmp_ls_command); for the process, so a
/// restarted receiver (a rename) keeps it. Read at each write.
pub static SECS: AtomicU32 = AtomicU32::new(0);

/// "crossfade:<s>"'s seconds: an integer, out of range clamped to 0..=12.
pub fn parse(s: &str) -> Option<u32> {
    s.trim().parse::<i64>().ok().map(|n| n.clamp(0, 12) as u32)
}

/// The equal-power gains at frame `i` of an `n`-frame fade, (the old track's, the new one's): their
/// squares sum to 1, so the loudness holds through it.
fn gains(i: usize, n: usize) -> (f32, f32) {
    let t = i as f32 / n as f32 * FRAC_PI_2;
    (t.cos(), t.sin())
}

/// The queue ahead of what is heard, as pure bookkeeping (the tests' subject).
#[derive(Default)]
pub struct Fifo {
    buf: VecDeque<f32>,
    head: u64, // samples handed over so far: buf[0] is the stream's sample `head`
    fade: Option<Fade>,
}

#[derive(Clone, Copy)]
struct Fade {
    start: u64, // the window [start, start + len): the old track's tail at the boundary
    len: usize,
    at: u64, // where the new track's next sample goes
}

impl Fifo {
    /// How far the decoder is ahead of what is heard, in samples: to where its next sample goes.
    pub fn lead(&self) -> usize {
        self.fade.map_or(self.buf.len(), |f| (f.at.max(self.head) - self.head) as usize)
    }

    /// Everything queued dropped (a seek, a skip, a stop): what comes next is heard at once.
    pub fn flush(&mut self) {
        self.head += self.buf.len() as u64;
        self.buf.clear();
        self.fade = None;
    }

    /// A natural track end: the old track's tail still queued is the window, faded out here; the new
    /// track's first samples are mixed into it from its head (`push`). Returns the window in samples, 0
    /// when it is too short to fade (the new track is appended).
    pub fn boundary(&mut self) -> usize {
        let len = self.buf.len();
        self.fade = None;
        if len < MIN_FADE {
            return 0;
        }
        let frames = len / 2;
        for i in 0..frames {
            let g = gains(i, frames).0;
            self.buf[2 * i] *= g;
            self.buf[2 * i + 1] *= g;
        }
        self.fade = Some(Fade { start: self.head, len, at: self.head });
        len
    }

    /// The decoder's samples: mixed into the window while there is one, then appended.
    pub fn push(&mut self, mut s: &[f32]) {
        if let Some(f) = self.fade.as_mut() {
            let end = f.start + f.len as u64;
            // slots already handed over (a decoder slower than real time) are gone: it comes in later
            f.at = f.at.max(self.head);
            let n = (end.saturating_sub(f.at) as usize).min(s.len());
            let (base, off, frames) = ((f.at - self.head) as usize, (f.at - f.start) as usize, f.len / 2);
            for (k, x) in s[..n].iter().enumerate() {
                self.buf[base + k] += x * gains((off + k) / 2, frames).1;
            }
            f.at += n as u64;
            s = &s[n..];
            if f.at >= end {
                self.fade = None;
            }
        }
        self.buf.extend(s);
    }

    /// Up to `max` samples off the head, for the host.
    pub fn pop(&mut self, max: usize) -> Vec<f32> {
        let n = max.min(self.buf.len());
        self.head += n as u64;
        self.buf.drain(..n).collect()
    }
}

/// What the player's events since the last write say to do with the queue before the next samples.
#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum Next {
    #[default]
    Append,
    Mix,
    Flush,
}

/// The player's events read in order (see the module's note).
#[derive(Default)]
pub struct Marks {
    ended: bool, // EndOfTrack, nothing written since: the decoder ran off the track's end
    asked: bool, // a load asked for since (PlayRequestIdChanged)
    next: Next,
    tracks: u64, // TrackChanged events so far: lib.rs counts the same ones
}

impl Marks {
    pub fn see(&mut self, e: &PlayerEvent) {
        match e {
            PlayerEvent::EndOfTrack { .. } => (self.ended, self.asked) = (true, false),
            PlayerEvent::PlayRequestIdChanged { .. } => self.asked = true,
            PlayerEvent::TrackChanged { .. } => {
                self.next = if self.ended && self.next != Next::Flush { Next::Mix } else { Next::Flush };
                self.ended = false;
                self.tracks += 1;
            }
            PlayerEvent::Seeked { .. } | PlayerEvent::Stopped { .. } => (self.next, self.ended) = (Next::Flush, false),
            _ => {}
        }
    }

    fn take(&mut self) -> Next {
        std::mem::take(&mut self.next)
    }

    /// At a stop: the decoder ran off the end and nothing was asked for since (Spirc stopping at the
    /// end of the context): what is queued, the last seconds of the last track, plays out.
    fn ran_out(&self) -> bool {
        self.ended && !self.asked
    }
}

/// Where the app's reports switch to the track a crossfade brings in: the fade's window in the stream
/// (the old track's tail it was mixed into) and the track change's number (Marks::tracks).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Switch {
    track: u64,
    start: u64,
    len: usize,
}

impl Switch {
    /// The midpoint, on a frame.
    fn at(&self) -> u64 {
        self.start + (self.len / 4 * 2) as u64
    }
}

/// What lib.rs does with its `k`th track change, held while a crossfade may be bringing it in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    /// The sink has not acted on it yet (within milliseconds at a natural end).
    Wait,
    /// The fade's first half: the old track still shown, this much of it left to hear.
    Hold { old_left_ms: u32, new_ms: u32 },
    /// Shown now, at the new track's heard position (0 when it was not crossfaded).
    Now { new_ms: u32 },
}

impl Verdict {
    /// The new track's heard position, to show it at if it is let go early.
    pub fn new_ms(self) -> u32 {
        match self {
            Verdict::Wait => 0,
            Verdict::Hold { new_ms, .. } | Verdict::Now { new_ms } => new_ms,
        }
    }
}

/// The verdict, given the track changes the sink has acted on, its last switch and the queue's head.
fn verdict(applied: u64, switch: Option<Switch>, head: u64, k: u64) -> Verdict {
    if applied < k {
        return Verdict::Wait;
    }
    match switch.filter(|s| s.track == k) {
        Some(s) => {
            let new_ms = ms(head.saturating_sub(s.start) as usize);
            match head < s.at() {
                true => Verdict::Hold { old_left_ms: ms((s.start + s.len as u64).saturating_sub(head) as usize), new_ms },
                false => Verdict::Now { new_ms },
            }
        }
        None => Verdict::Now { new_ms: 0 },
    }
}

/// The pump's side of the queue, shared with the sink (librespot's player thread) and lib.rs (the
/// positions it reports).
#[derive(Default)]
pub struct Pump {
    state: Mutex<State>,
    cv: Condvar,
    events: Mutex<Option<PlayerEventChannel>>, // the sink's own channel, until the sink takes it
    /// lib.rs's wake-up for a held track change: the sink has acted on one, or a fade's midpoint was
    /// handed over.
    pub wake: Notify,
}

#[derive(Default)]
struct State {
    fifo: Fifo,
    run: Run,
    owed: bool, // samples handed over since the last stop: the host is owed one
    quit: bool,
    held: usize,            // the lead when the sink last stopped
    applied: u64,           // the track changes the sink has acted on (Marks::tracks)
    switch: Option<Switch>, // the last crossfade's
}

#[derive(Default, Clone, Copy, PartialEq)]
enum Run {
    #[default]
    Play,
    Hold,    // the sink stopped (a pause, a stop): nothing more handed over, the host told once
    PlayOut, // the sink stopped at the end of the context: what is queued, then the host told
}

fn ms(samples: usize) -> u32 {
    (samples as u64 * 1000 / SPS as u64) as u32
}

impl Pump {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The sink's channel of the player's events (Player::get_player_event_channel).
    pub fn listen(&self, rx: PlayerEventChannel) {
        *self.events.lock().unwrap_or_else(PoisonError::into_inner) = Some(rx);
    }

    /// How far the decoder is ahead of what is heard now, in ms.
    pub fn lead_ms(&self) -> u32 {
        ms(self.lock().fifo.lead())
    }

    /// The lead when the sink last stopped (a pause), in ms: a Paused's, and the Playing's that resumes.
    pub fn held_ms(&self) -> u32 {
        ms(self.lock().held)
    }

    /// What to do with lib.rs's `k`th track change (it counts them as Marks does).
    pub fn verdict(&self, k: u64) -> Verdict {
        let g = self.lock();
        verdict(g.applied, g.switch, g.fifo.head, k)
    }
}

/// The host's pcm callback: samples, or None for "the sink stopped".
pub type Hand = fn(Option<&[f32]>);
pub type Say = fn(&str);

// The pump thread: hands the host the queue's head a chunk at a time, no lock held while it blocks.
fn pump(p: Arc<Pump>, hand: Hand) {
    let mut g = p.lock();
    loop {
        let stopped = g.run != Run::Play && g.owed && (g.quit || g.run == Run::Hold || g.fifo.buf.is_empty());
        let chunk = if stopped {
            None
        } else if g.quit {
            break;
        } else if g.run != Run::Hold && !g.fifo.buf.is_empty() {
            let before = g.fifo.head;
            let c = g.fifo.pop(CHUNK);
            if g.switch.is_some_and(|s| before < s.at() && g.fifo.head >= s.at()) {
                p.wake.notify_one(); // the fade's midpoint: the held track is shown
            }
            Some(c)
        } else {
            g = p.cv.wait(g).unwrap_or_else(PoisonError::into_inner);
            continue;
        };
        drop(g);
        hand(chunk.as_deref());
        g = p.lock();
        g.owed = chunk.is_some();
        p.cv.notify_all();
    }
}

// What the events said, done to the queue at once (a stale queue is never heard), and where the reports
// switch for a crossfade (`track`: the change's number); a crossfade's line for the log, said once the
// lock is let go.
fn apply(next: Next, st: &mut State, track: u64) -> Option<String> {
    match next {
        Next::Append => None,
        Next::Flush => {
            st.fifo.flush();
            st.switch = None;
            None
        }
        Next::Mix => {
            let start = st.fifo.head;
            Some(match st.fifo.boundary() {
                0 => {
                    st.switch = None;
                    "librespot: crossfade: too little queued, gapless".into()
                }
                len => {
                    st.switch = Some(Switch { track, start, len });
                    format!("librespot: crossfade over {:.1} s", len as f32 / SPS as f32)
                }
            })
        }
    }
}

/// The sink's side, on librespot's player thread: HostSink's write and stop come here.
pub struct Feed {
    pump: Arc<Pump>,
    events: Option<PlayerEventChannel>,
    marks: Marks,
    thread: Option<JoinHandle<()>>, // the pump, while there is a queue
    hand: Hand,
    say: Say,
    told: u64, // the track changes lib.rs was last told the sink has acted on
}

impl Feed {
    pub fn new(pump: Arc<Pump>, hand: Hand, say: Say) -> Self {
        Feed { pump, events: None, marks: Marks::default(), thread: None, hand, say, told: 0 }
    }

    // The track changes acted on, to lib.rs (State::applied, then its wake-up): only when there are new
    // ones, so off the lock costs nothing per packet. With `g`, under the lock already held.
    fn tell(&mut self, g: Option<&mut State>) {
        if self.marks.tracks == self.told {
            return;
        }
        self.told = self.marks.tracks;
        match g {
            Some(g) => g.applied = self.told,
            None => self.pump.lock().applied = self.told,
        }
        self.pump.wake.notify_one();
    }

    fn drain(&mut self) {
        if self.events.is_none() {
            self.events = self.pump.events.lock().unwrap_or_else(PoisonError::into_inner).take();
        }
        while let Some(e) = self.events.as_mut().and_then(|rx| rx.try_recv().ok()) {
            self.marks.see(&e);
        }
    }

    pub fn write(&mut self, s: &[f32]) {
        self.drain();
        let secs = SECS.load(Relaxed) as usize;
        if self.thread.is_none() {
            self.marks.take(); // no queue to act on
            self.marks.ended = false;
            self.tell(None);
            if secs == 0 {
                (self.hand)(Some(s));
                return;
            }
            // the host may be playing what was handed it directly: a stop now is owed it
            self.pump.lock().owed = true;
            let (p, hand) = (self.pump.clone(), self.hand);
            match std::thread::Builder::new().name("crossfade".into()).spawn(move || pump(p, hand)) {
                Ok(t) => self.thread = Some(t),
                Err(e) => {
                    (self.say)(&format!("librespot: crossfade: no thread: {e}"));
                    (self.hand)(Some(s));
                    return;
                }
            }
        }
        let max = secs * SPS;
        let pump = self.pump.clone();
        let mut g = pump.lock();
        let line = apply(self.marks.take(), &mut g, self.marks.tracks);
        self.tell(Some(&mut g));
        self.marks.ended = false;
        g.fifo.push(s);
        g.run = Run::Play;
        pump.cv.notify_all();
        let (g, _) = pump
            .cv
            .wait_timeout_while(g, WAIT, |st| st.fifo.lead() > max)
            .unwrap_or_else(PoisonError::into_inner);
        let done = secs == 0 && g.fifo.buf.is_empty();
        drop(g);
        if let Some(l) = line {
            (self.say)(&l);
        }
        // Switched off and played out: the pump goes, and the next packet is handed over directly.
        if done {
            self.end_pump();
        }
    }

    pub fn stop(&mut self) {
        self.drain();
        if self.thread.is_none() {
            self.tell(None);
            (self.hand)(None);
            return;
        }
        let pump = self.pump.clone();
        let mut g = pump.lock();
        let line = apply(self.marks.take(), &mut g, self.marks.tracks);
        self.tell(Some(&mut g));
        g.run = if self.marks.ran_out() { Run::PlayOut } else { Run::Hold };
        g.held = g.fifo.lead();
        pump.cv.notify_all();
        drop(g);
        if let Some(l) = line {
            (self.say)(&l);
        }
    }

    fn end_pump(&mut self) {
        let Some(t) = self.thread.take() else { return };
        self.pump.lock().quit = true;
        self.pump.cv.notify_all();
        let _ = t.join();
        let mut g = self.pump.lock();
        g.fifo.flush();
        (g.quit, g.run, g.held) = (false, Run::Play, 0);
    }
}

// The player gone (the receiver shutting down): the pump goes with it.
impl Drop for Feed {
    fn drop(&mut self) {
        self.end_pump();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: usize = SPS; // a second of samples

    fn filled(x: f32, n: usize) -> Fifo {
        let mut f = Fifo::default();
        f.push(&vec![x; n]);
        f
    }

    #[test]
    fn a_boundary_mixes_the_new_track_into_the_queued_tail() {
        let mut f = filled(1.0, 2 * S); // L = 2 s of the old track queued
        let total = 2 * S + 5 * S;
        assert_eq!(f.boundary(), 2 * S);
        assert_eq!(f.lead(), 0); // the new track's first sample lands at the head
        f.push(&vec![-1.0; 5 * S]); // 5 s of the new track
        let out = f.pop(usize::MAX);
        assert_eq!(out.len(), total - 2 * S); // shortened by L
        assert!((out[0] - 1.0).abs() < 1e-3, "{}", out[0]); // the old track's at the start
        assert!((out[2 * S - 1] + 1.0).abs() < 1e-3, "{}", out[2 * S - 1]); // the new one's at its end
        assert!(out[2 * S..].iter().all(|&x| x == -1.0)); // then the new track as it is
    }

    #[test]
    fn the_fade_is_equal_power() {
        let n = 1000;
        for i in 0..n {
            let (o, x) = gains(i, n);
            assert!((o * o + x * x - 1.0).abs() < 1e-5);
        }
        assert!((gains(n / 2, n).0 - 0.5f32.sqrt()).abs() < 1e-3); // mid-fade each at .707, not a linear .5
        // two unit signals in phase never dip below unit amplitude (a linear fade's sum is 1 throughout;
        // an equal-power one bulges to √2 mid-fade, never under 1)
        let mut f = filled(1.0, S);
        f.boundary();
        f.push(&vec![1.0; S]);
        let out = f.pop(usize::MAX);
        assert!(out.iter().all(|&x| (0.999..=1.4143).contains(&x)));
        assert!(out[S / 2] > 1.4); // mid-fade: each at .707
    }

    #[test]
    fn a_short_tail_is_appended() {
        let mut f = filled(1.0, MIN_FADE - 2);
        assert_eq!(f.boundary(), 0);
        f.push(&[-1.0; 4]);
        let out = f.pop(usize::MAX);
        assert_eq!(out.len(), MIN_FADE + 2);
        assert!(out[..MIN_FADE - 2].iter().all(|&x| x == 1.0) && out[MIN_FADE - 2..].iter().all(|&x| x == -1.0));
    }

    #[test]
    fn a_flush_empties_it_and_the_lead_is_what_is_queued() {
        let mut f = filled(0.5, S);
        assert_eq!(ms(f.lead()), 1000);
        f.pop(S / 4);
        assert_eq!(ms(f.lead()), 750);
        f.flush();
        assert_eq!((f.lead(), f.pop(usize::MAX).len()), (0, 0));
        // mid-fade the lead is the new track's, not the whole queue's
        let mut f = filled(1.0, 2 * S);
        f.boundary();
        f.push(&vec![0.0; S / 2]);
        assert_eq!((ms(f.lead()), f.buf.len()), (500, 2 * S));
        f.pop(S); // the window's slots heard faster than the decoder filled them: it comes in at the head
        assert_eq!(f.lead(), 0);
        f.push(&vec![0.0; S]);
        assert_eq!(f.lead(), S);
    }

    #[test]
    fn heard_position_is_the_event_s_less_the_lead() {
        let mut f = filled(0.0, 3 * S);
        f.pop(S);
        assert_eq!(60_000u32.saturating_sub(ms(f.lead())), 58_000);
        assert_eq!(500u32.saturating_sub(ms(f.lead())), 0); // not below 0
    }

    #[test]
    fn only_a_natural_end_mixes() {
        use librespot_core::SpotifyUri;
        let t = || SpotifyUri::from_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC").unwrap();
        let end = || PlayerEvent::EndOfTrack { play_request_id: 1, track_id: t() };
        let asked = || PlayerEvent::PlayRequestIdChanged { play_request_id: 2 };
        let seeked = || PlayerEvent::Seeked { play_request_id: 1, track_id: t(), position_ms: 0 };
        let changed = || PlayerEvent::TrackChanged { audio_item: Box::new(item()) };
        let run = |es: Vec<PlayerEvent>| {
            let mut m = Marks::default();
            es.iter().for_each(|e| m.see(e));
            (m.take(), m.ran_out())
        };
        assert_eq!(run(vec![end(), asked(), changed()]), (Next::Mix, false)); // gone on to the next
        assert_eq!(run(vec![asked(), changed()]), (Next::Flush, false)); // a skip, a load, the first track
        assert_eq!(run(vec![seeked()]), (Next::Flush, false));
        assert_eq!(run(vec![end(), asked(), changed(), seeked()]), (Next::Flush, false));
        assert_eq!(run(vec![end()]), (Next::Append, true)); // the context's end: what is queued plays out
        assert_eq!(run(vec![end(), asked()]), (Next::Append, false)); // a stop while the next loads: held
    }

    fn item() -> librespot_metadata::audio::AudioItem {
        use librespot_metadata::audio::{AudioItem, UniqueFields};
        AudioItem {
            track_id: librespot_core::SpotifyUri::from_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC").unwrap(),
            uri: String::new(),
            files: Default::default(),
            name: String::new(),
            covers: vec![],
            language: vec![],
            duration_ms: 0,
            is_explicit: false,
            availability: Ok(()),
            alternatives: None,
            unique_fields: UniqueFields::Local { artists: None, album: None, album_artists: None, number: None, disc_number: None, path: Default::default() },
        }
    }

    static SERIAL: Mutex<()> = Mutex::new(()); // the tests that set SECS

    #[test]
    fn off_never_queues() {
        // N == 0 and no pump: write hands each packet straight over, stop says so at once
        let _one = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        static GOT: Mutex<Vec<usize>> = Mutex::new(vec![]);
        fn hand(s: Option<&[f32]>) {
            GOT.lock().unwrap().push(s.map_or(0, <[f32]>::len));
        }
        SECS.store(0, Relaxed);
        let p = Arc::new(Pump::default());
        let mut feed = Feed::new(p.clone(), hand, |_| {});
        feed.write(&[0.0; 8]);
        feed.stop();
        assert!(feed.thread.is_none());
        assert_eq!((GOT.lock().unwrap().clone(), p.lead_ms()), (vec![8, 0], 0));
    }

    #[test]
    fn the_pump_holds_at_a_pause_drops_at_a_seek_and_goes_when_switched_off() {
        use std::sync::atomic::AtomicBool;
        let _one = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        static OUT: Mutex<Vec<Option<Vec<f32>>>> = Mutex::new(vec![]);
        static OPEN: AtomicBool = AtomicBool::new(true); // closed: the host's callback blocks
        fn hand(s: Option<&[f32]>) {
            while !OPEN.load(Relaxed) {
                std::thread::sleep(Duration::from_millis(1));
            }
            OUT.lock().unwrap().push(s.map(<[f32]>::to_vec));
        }
        let heard = || OUT.lock().unwrap().iter().flatten().flatten().copied().collect::<Vec<f32>>();
        let stops = || OUT.lock().unwrap().iter().filter(|x| x.is_none()).count();
        let until = |f: &dyn Fn() -> bool| {
            for _ in 0..1000 {
                if f() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            panic!("timed out");
        };
        let packets = |r: std::ops::Range<u32>| r.flat_map(|k| vec![k as f32; CHUNK]).collect::<Vec<f32>>();
        SECS.store(1, Relaxed);
        let p = Arc::new(Pump::default());
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        p.listen(rx);
        let mut feed = Feed::new(p.clone(), hand, |_| {});
        (0..4).for_each(|k| feed.write(&vec![k as f32; CHUNK]));
        until(&|| heard().len() == 4 * CHUNK);
        // a pause: what was handed over stays handed, the rest held; the host told once, after it
        OPEN.store(false, Relaxed);
        (4..8).for_each(|k| feed.write(&vec![k as f32; CHUNK]));
        feed.stop();
        assert!([3, 4].map(|n| ms(n * CHUNK)).contains(&p.held_ms()), "{}", p.held_ms());
        OPEN.store(true, Relaxed);
        until(&|| stops() == 1);
        std::thread::sleep(Duration::from_millis(20));
        assert!(heard().len() <= 5 * CHUNK); // nothing more while held
        // resumed where it was heard: nothing lost, nothing twice, one stop
        feed.write(&vec![8.0; CHUNK]);
        until(&|| heard().len() == 9 * CHUNK);
        assert_eq!((heard(), stops()), (packets(0..9), 1));
        // a seek: what is queued is dropped, the new audio follows what was already in the host's hands
        OPEN.store(false, Relaxed);
        (9..12).for_each(|k| feed.write(&vec![k as f32; CHUNK]));
        let t = librespot_core::SpotifyUri::from_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC").unwrap();
        tx.send(PlayerEvent::Seeked { play_request_id: 1, track_id: t, position_ms: 0 }).unwrap();
        feed.write(&vec![50.0; CHUNK]);
        assert_eq!(p.lead_ms(), ms(CHUNK));
        OPEN.store(true, Relaxed);
        until(&|| heard().last() == Some(&50.0));
        let after: Vec<f32> = heard()[9 * CHUNK..].iter().copied().filter(|&x| x != 50.0).collect();
        assert!(after.is_empty() || after == vec![9.0; CHUNK], "{after:?}"); // at most the chunk in flight
        // switched off: what is queued plays out, the pump goes, the next packet goes straight over
        SECS.store(0, Relaxed);
        feed.write(&vec![60.0; CHUNK]);
        assert!(feed.thread.is_none());
        feed.write(&vec![70.0; CHUNK]);
        assert_eq!(heard()[heard().len() - 2 * CHUNK..], packets(60..61).into_iter().chain(packets(70..71)).collect::<Vec<_>>()[..]);
        assert_eq!((p.lead_ms(), stops()), (0, 1));
    }

    #[test]
    fn the_display_switches_at_the_fade_s_midpoint_and_a_pause_holds_it() {
        let mut st = State::default();
        st.fifo.push(&vec![1.0; 9 * S]);
        st.fifo.pop(S); // 8 s of the old track queued, the head a second in
        apply(Next::Mix, &mut st, 3); // the third track change, crossfaded over 8 s
        let v = |st: &State, k| verdict(st.applied, st.switch, st.fifo.head, k);
        assert_eq!(v(&st, 3), Verdict::Wait); // not told yet that the sink acted on it
        st.applied = 3;
        assert_eq!(v(&st, 3), Verdict::Hold { old_left_ms: 8000, new_ms: 0 });
        st.fifo.push(&vec![0.0; 8 * S]); // the new track, mixed in
        st.fifo.pop(2 * S); // 2 s heard; then a pause: nothing handed over, nothing moves
        assert_eq!(v(&st, 3), Verdict::Hold { old_left_ms: 6000, new_ms: 2000 });
        assert_eq!(v(&st, 3), Verdict::Hold { old_left_ms: 6000, new_ms: 2000 });
        st.fifo.pop(2 * S - 2); // resumed, a frame short of the midpoint
        assert!(matches!(v(&st, 3), Verdict::Hold { .. }));
        st.fifo.pop(2);
        assert_eq!(v(&st, 3), Verdict::Now { new_ms: 4000 }); // 4 s of song before, 4 s after
        assert_eq!(v(&st, 2), Verdict::Now { new_ms: 0 }); // any other change: shown at once
        assert_eq!(Verdict::Hold { old_left_ms: 1, new_ms: 7 }.new_ms(), 7); // let go early: where it is
    }

    #[test]
    fn a_flush_or_a_gapless_end_holds_nothing() {
        let mut st = State { applied: 2, ..Default::default() };
        st.fifo.push(&vec![1.0; 4 * S]);
        apply(Next::Mix, &mut st, 1);
        assert!(matches!(verdict(1, st.switch, st.fifo.head, 1), Verdict::Hold { .. }));
        apply(Next::Flush, &mut st, 1); // a seek, a skip, a load, a stop
        assert_eq!(verdict(1, st.switch, st.fifo.head, 1), Verdict::Now { new_ms: 0 });
        st.fifo.push(&vec![1.0; MIN_FADE - 2]);
        apply(Next::Mix, &mut st, 2); // too little queued: gapless
        assert_eq!(verdict(2, st.switch, st.fifo.head, 2), Verdict::Now { new_ms: 0 });
    }

    #[test]
    fn the_pump_wakes_lib_rs_at_the_midpoint() {
        use std::sync::atomic::AtomicBool;
        let _one = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        static OPEN: AtomicBool = AtomicBool::new(false);
        fn hand(_: Option<&[f32]>) {
            while !OPEN.load(Relaxed) {
                std::thread::sleep(Duration::from_millis(1));
            }
            std::thread::sleep(Duration::from_millis(1)); // a host faster than real time, not instant
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        let woken = |p: &Pump, ms: u64| rt.block_on(async { tokio::time::timeout(Duration::from_millis(ms), p.wake.notified()).await.is_ok() });
        SECS.store(1, Relaxed);
        let p = Arc::new(Pump::default());
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        p.listen(rx);
        let mut feed = Feed::new(p.clone(), hand, |_| {});
        (0..20).for_each(|_| feed.write(&[1.0; CHUNK])); // 0.93 s of the old track; the pump holds one chunk
        let t = || librespot_core::SpotifyUri::from_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC").unwrap();
        tx.send(PlayerEvent::EndOfTrack { play_request_id: 1, track_id: t() }).unwrap();
        tx.send(PlayerEvent::PlayRequestIdChanged { play_request_id: 2 }).unwrap();
        tx.send(PlayerEvent::TrackChanged { audio_item: Box::new(item()) }).unwrap();
        feed.write(&[0.0; CHUNK]); // the new track's first: the boundary
        assert!(matches!(p.verdict(1), Verdict::Hold { new_ms: 0, .. }), "{:?}", p.verdict(1));
        assert!(woken(&p, 50)); // told the sink acted on it
        (0..20).for_each(|_| feed.write(&[0.0; CHUNK]));
        OPEN.store(true, Relaxed);
        assert!(woken(&p, 2000)); // the midpoint handed over
        let Verdict::Now { new_ms } = p.verdict(1) else { panic!("{:?}", p.verdict(1)) };
        let half = ms(19 * CHUNK) / 2; // the window: what was queued behind the chunk in the host's hands
        assert!((half..half + 2 * ms(CHUNK)).contains(&new_ms), "{new_ms} vs {half}");
    }
}

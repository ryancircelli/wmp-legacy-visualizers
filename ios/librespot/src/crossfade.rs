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
    said: Option<String>, // a finished fade's levels, for the log (`report`)
}

#[derive(Clone, Copy)]
struct Fade {
    start: u64, // the window [start, start + len): the old track's tail at the boundary
    len: usize,
    at: u64, // where the new track's next sample goes
    // How loud each side of it was, for the log: the old tail's sum of squares before it was faded, the
    // new head's as it is mixed in (the owner, 2026-10-03: "not sure it blended" — a quiet ending over a
    // quiet opening is a fade that cannot be heard, and the log should say which it was).
    old: f64,
    new: f64,
    mixed: usize,
}

/// A sum of squares over n samples as dB below full scale (-99 for silence).
fn db(sum: f64, n: usize) -> f64 {
    if n == 0 || sum <= 0.0 { -99.0 } else { (10.0 * (sum / n as f64).log10()).max(-99.0) }
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
        let old = self.buf.iter().map(|x| (*x as f64) * (*x as f64)).sum();
        for i in 0..frames {
            let g = gains(i, frames).0;
            self.buf[2 * i] *= g;
            self.buf[2 * i + 1] *= g;
        }
        self.fade = Some(Fade { start: self.head, len, at: self.head, old, new: 0.0, mixed: 0 });
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
                f.new += (*x as f64) * (*x as f64);
            }
            f.mixed += n;
            f.at += n as u64;
            s = &s[n..];
            if f.at >= end {
                self.said = Some(format!(
                    "librespot: crossfade mixed {:.1} s of the new song ({:.0} dB) over {:.1} s of the old ({:.0} dB)",
                    f.mixed as f32 / SPS as f32, db(f.new, f.mixed), f.len as f32 / SPS as f32, db(f.old, f.len)
                ));
                self.fade = None;
            }
        }
        self.buf.extend(s);
    }

    /// A fade just finished: its line for the log, once.
    pub fn report(&mut self) -> Option<String> {
        self.said.take()
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
}

impl Marks {
    pub fn see(&mut self, e: &PlayerEvent) {
        match e {
            PlayerEvent::EndOfTrack { .. } => (self.ended, self.asked) = (true, false),
            PlayerEvent::PlayRequestIdChanged { .. } => self.asked = true,
            PlayerEvent::TrackChanged { .. } => {
                self.next = if self.ended && self.next != Next::Flush { Next::Mix } else { Next::Flush };
                self.ended = false;
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

/// The pump's side of the queue, shared with the sink (librespot's player thread) and lib.rs (the
/// positions it reports).
#[derive(Default)]
pub struct Pump {
    state: Mutex<State>,
    cv: Condvar,
    events: Mutex<Option<PlayerEventChannel>>, // the sink's own channel, until the sink takes it
}

#[derive(Default)]
struct State {
    fifo: Fifo,
    run: Run,
    owed: bool, // samples handed over since the last stop: the host is owed one
    quit: bool,
    held: usize, // the lead when the sink last stopped
    pumping: bool, // the pump thread runs: it hands everything over, a cut included
    cut: bool,     // a cut owed the host (`Pump::cut`), handed over by the pump after any chunk in its hands
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

    /// A skip under way (lib.rs, at the player's Loading): what is queued is the old track's, dropped now,
    /// and the host told to drop what it holds (an empty hand), not at the new track's first samples: a
    /// slow fetch played on up to the crossfade's seconds of the old song (the owner, 2026-10-04: "should
    /// we also stop current playback on a skip"). Through the pump while it runs, so it follows any chunk
    /// already in its hands.
    pub fn cut(&self, hand: Hand) {
        let mut g = self.lock();
        g.fifo.flush();
        if g.pumping {
            g.cut = true;
            self.cv.notify_all();
        } else {
            drop(g);
            hand(Some(&[]));
        }
    }

    /// The lead when the sink last stopped (a pause), in ms: a Paused's, and the Playing's that resumes.
    pub fn held_ms(&self) -> u32 {
        ms(self.lock().held)
    }
}

/// The host's pcm callback: samples, or None for "the sink stopped".
pub type Hand = fn(Option<&[f32]>);
pub type Say = fn(&str);

// The pump thread: hands the host the queue's head a chunk at a time, no lock held while it blocks.
fn pump(p: Arc<Pump>, hand: Hand) {
    let mut g = p.lock();
    loop {
        if std::mem::take(&mut g.cut) {
            drop(g);
            hand(Some(&[]));
            g = p.lock();
            continue;
        }
        let stopped = g.run != Run::Play && g.owed && (g.quit || g.run == Run::Hold || g.fifo.buf.is_empty());
        let chunk = if stopped {
            None
        } else if g.quit {
            break;
        } else if g.run != Run::Hold && !g.fifo.buf.is_empty() {
            Some(g.fifo.pop(CHUNK))
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

// What the events said, done to the queue at once (a stale queue is never heard); a crossfade's line
// for the log, said once the lock is let go.
fn apply(next: Next, fifo: &mut Fifo) -> Option<String> {
    match next {
        Next::Append => None,
        Next::Flush => {
            fifo.flush();
            None
        }
        Next::Mix => Some(match fifo.boundary() {
            0 => "librespot: crossfade: too little queued, gapless".into(),
            n => format!("librespot: crossfade over {:.1} s", n as f32 / SPS as f32),
        }),
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
}

impl Feed {
    pub fn new(pump: Arc<Pump>, hand: Hand, say: Say) -> Self {
        Feed { pump, events: None, marks: Marks::default(), thread: None, hand, say }
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
            if secs == 0 {
                (self.hand)(Some(s));
                return;
            }
            // the host may be playing what was handed it directly: a stop now is owed it
            self.pump.lock().owed = true;
            let (p, hand) = (self.pump.clone(), self.hand);
            match std::thread::Builder::new().name("crossfade".into()).spawn(move || pump(p, hand)) {
                Ok(t) => {
                self.thread = Some(t);
                self.pump.lock().pumping = true;
            }
                Err(e) => {
                    (self.say)(&format!("librespot: crossfade: no thread: {e}"));
                    (self.hand)(Some(s));
                    return;
                }
            }
        }
        let max = secs * SPS;
        let mut g = self.pump.lock();
        let line = apply(self.marks.take(), &mut g.fifo);
        self.marks.ended = false;
        g.fifo.push(s);
        let mixed = g.fifo.report();
        g.run = Run::Play;
        self.pump.cv.notify_all();
        let (g, _) = self
            .pump
            .cv
            .wait_timeout_while(g, WAIT, |st| st.fifo.lead() > max)
            .unwrap_or_else(PoisonError::into_inner);
        let done = secs == 0 && g.fifo.buf.is_empty();
        drop(g);
        if let Some(l) = line {
            (self.say)(&l);
        }
        if let Some(l) = mixed {
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
            (self.hand)(None);
            return;
        }
        let mut g = self.pump.lock();
        let line = apply(self.marks.take(), &mut g.fifo);
        g.run = if self.marks.ran_out() { Run::PlayOut } else { Run::Hold };
        g.held = g.fifo.lead();
        self.pump.cv.notify_all();
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
        (g.quit, g.run, g.held, g.pumping, g.cut) = (false, Run::Play, 0, false, false);
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
        // 9 in the host's hands before the seek (else the pump, woken late, takes 50 instead: a 1 in 60 race)
        until(&|| p.lead_ms() == ms(2 * CHUNK));
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
    fn a_cut_drops_the_queue_and_tells_the_host_after_the_chunk_in_flight() {
        use std::sync::atomic::AtomicBool;
        let _one = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        static OUT: Mutex<Vec<Option<Vec<f32>>>> = Mutex::new(vec![]);
        static OPEN: AtomicBool = AtomicBool::new(true);
        fn hand(s: Option<&[f32]>) {
            while !OPEN.load(Relaxed) {
                std::thread::sleep(Duration::from_millis(1));
            }
            OUT.lock().unwrap().push(s.map(<[f32]>::to_vec));
        }
        let cuts = || OUT.lock().unwrap().iter().filter(|x| x.as_ref().is_some_and(Vec::is_empty)).count();
        SECS.store(1, Relaxed);
        let p = Arc::new(Pump::default());
        let mut feed = Feed::new(p.clone(), hand, |_| {});
        OPEN.store(false, Relaxed);
        (0..4).for_each(|k| feed.write(&vec![k as f32; CHUNK]));
        p.cut(hand);
        assert_eq!(p.lead_ms(), 0);
        OPEN.store(true, Relaxed);
        for _ in 0..1000 {
            if cuts() == 1 { break }
            std::thread::sleep(Duration::from_millis(2));
        }
        // the chunk in the host's hands at most, then the cut, and nothing more of the old track
        let out = OUT.lock().unwrap().clone();
        assert!(out.len() <= 2 && out.last() == Some(&Some(vec![])), "{}", out.len());
        // no pump (crossfade off): handed over at once
        SECS.store(0, Relaxed);
        feed.write(&[9.0; CHUNK]);
        assert!(feed.thread.is_none());
        p.cut(hand);
        assert_eq!(cuts(), 2);
    }
}

//! The equalizer (wmp_ls_command "eq:<json>", sound.rs): ten peaking bands an octave apart, 32 Hz to
//! 16 kHz (RBJ's cookbook biquads, Q 1.41), on the samples as they go to the host. It sits in the one
//! place both of the sink's paths pass, lib.rs's `hand`, so after crossfade.rs's queue: a change is heard
//! at once, not up to twelve seconds later behind what is queued (the filters are linear, so a crossfade
//! mixed before them sounds the same). Flat, it does nothing at all: the packet goes through untouched.
//! A change moves the coefficients over RAMP frames with the filters' state kept (direct form I, whose
//! state is only past samples, so a coefficient change cannot jolt it): no click.
//!
//! A boost is applied as it is, at full level, as Spotify's own client applies its equalizer, and a peak
//! limiter after the bands (`Limiter`) keeps what overshoots under full scale. The owner's ruling
//! (2026-10-04), after the harness measured the first version's preamp, which turned the whole song down
//! by the boost's peak: Bass Booster made the music 6.5 dB quieter instead of the bass louder.

use std::{
    f64::consts::TAU,
    sync::{Mutex, PoisonError},
};

/// The bands' centres, Hz.
pub const BANDS: [f64; 10] = [32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
const RATE: f64 = 44100.0;
const Q: f64 = 1.41; // an octave wide
/// The frames a change takes (23 ms).
const RAMP: u32 = 1024;
/// The frames it runs on once flat again (186 ms), the lowest band's ring-down, before it goes.
const TAIL: u32 = 8192;
/// Ten bands of b0 b1 b2 a1 a2 (over a0).
const N: usize = 50;

/// The coefficients for `gains` (dB per band).
fn coefs(gains: &[f32; 10]) -> [f64; N] {
    let mut c = [0.0; N];
    for (b, (&f, &g)) in BANDS.iter().zip(gains).enumerate() {
        let a = 10f64.powf(g as f64 / 40.0);
        let w = TAU * f / RATE;
        let alpha = w.sin() / (2.0 * Q);
        let a0 = 1.0 + alpha / a;
        let k = -2.0 * w.cos() / a0; // b1 and a1 alike: a flat band's b and a are the same bits
        c[5 * b..5 * b + 5].copy_from_slice(&[(1.0 + alpha * a) / a0, k, (1.0 - alpha * a) / a0, k, (1.0 - alpha / a) / a0]);
    }
    c
}

/// The level no sample leaves above: -0.5 dBFS, a little room for the peaks between samples that a
/// DAC's reconstruction brings.
pub const CEILING: f64 = 0.944;
/// The frames the limiter looks ahead (4 ms): its attack, over which its gain comes down smoothly to
/// meet a peak, and so its delay. Nothing is lost or repeated by it: frames held back go out with the
/// next packet, or at a stop or when the equalizer goes flat (`flush`).
const LOOK: usize = 176;
/// The frames (50 ms) its gain holds after a peak before it recovers, so a bass note's next cycle, under
/// 50 ms away, meets the same gain and is not modulated by it. At least LOOK (see `push`).
const HOLD: u32 = 2205;
/// Its recovery toward unity, a time constant of 100 ms, per frame.
const RELEASE: f64 = 1.0 / (0.100 * RATE);

/// A look-ahead peak limiter, one gain for both channels (so the image holds), transparent below
/// CEILING (its gain exactly 1). Each frame's needed gain (CEILING over the frame's louder channel, or 1)
/// becomes a target that drops at once, holds HOLD frames and then recovers; the gain applied is the
/// average over the LOOK frames before of the target's least over the LOOK frames ahead, which is never
/// above any needed gain in its window (so no sample can pass CEILING) and moves smoothly, over LOOK
/// frames, never in a step.
struct Limiter {
    x: [[f64; 2]; LOOK], // the frames held back, by arrival mod LOOK
    t: [f64; LOOK],      // each one's target
    m: [f64; LOOK],      // the averaging window: the least target over LOOK frames ahead of each
    sum: f64,            // m's sum
    at: usize,           // the next arrival's slot
    held: usize,         // real frames held back (LOOK - 1 once filled)
    target: f64,
    hold: u32,
}

impl Limiter {
    const fn new() -> Self {
        Limiter { x: [[0.0; 2]; LOOK], t: [1.0; LOOK], m: [1.0; LOOK], sum: LOOK as f64, at: 0, held: 0, target: 1.0, hold: 0 }
    }

    /// One frame in; the frame LOOK - 1 before it out, with its gain applied.
    fn step(&mut self, f: [f64; 2]) -> [f64; 2] {
        let peak = f[0].abs().max(f[1].abs());
        let need = if peak > CEILING { CEILING / peak } else { 1.0 };
        self.target = if need < self.target {
            self.hold = HOLD;
            need
        } else if self.hold > 0 {
            self.hold -= 1;
            self.target
        } else {
            let t = self.target + (1.0 - self.target) * RELEASE;
            if t > 0.999_999 { 1.0 } else { t }.min(need)
        };
        // After a drop the target cannot rise for HOLD ≥ LOOK frames, so over any LOOK frames it rises
        // and then falls, and its least is at one end of them.
        let (k, o) = (self.at, (self.at + 1) % LOOK); // this arrival's slot; the one LOOK - 1 before it
        (self.x[k], self.t[k]) = (f, self.target);
        let least = self.t[o].min(self.target);
        self.sum += least - self.m[k];
        self.m[k] = least;
        self.at = o;
        let g = self.sum / LOOK as f64;
        [self.x[o][0] * g, self.x[o][1] * g]
    }

    /// One frame in; out, once LOOK - 1 are held back, the oldest of them.
    fn push(&mut self, f: [f64; 2]) -> Option<[f64; 2]> {
        let y = self.step(f);
        if self.held < LOOK - 1 {
            self.held += 1;
            return None;
        }
        Some(y)
    }

    /// The frames held back, out (into `out`), limited against silence after them.
    fn flush(&mut self, out: &mut Vec<f32>) {
        let held = std::mem::take(&mut self.held);
        for j in 0..LOOK - 1 {
            let y = self.step([0.0; 2]);
            if j >= LOOK - 1 - held {
                out.extend(y.map(sample));
            }
        }
    }
}

/// To the host: f32, never past full scale (CEILING already keeps it under; this only makes sure).
fn sample(v: f64) -> f32 {
    (v as f32).clamp(-1.0, 1.0)
}

pub struct Eq {
    gains: [f32; 10], // where it is going
    on: bool,         // not flat, or still on its way to flat: processing
    cur: [f64; N],    // the coefficients in use
    step: [f64; N],   // per frame, while ramping
    tgt: [f64; N],
    left: u32,          // frames of the ramp to go
    tail: u32,          // frames flat to go before it goes
    st: [[f64; 4]; 20], // per band and channel: x1 x2 y1 y2
    lim: Limiter,
    buf: Vec<f32>, // `through`'s output, kept so a packet allocates nothing
}

impl Eq {
    pub const fn new() -> Self {
        Eq { gains: [0.0; 10], on: false, cur: [0.0; N], step: [0.0; N], tgt: [0.0; N], left: 0, tail: 0, st: [[0.0; 4]; 20], lim: Limiter::new(), buf: Vec::new() }
    }

    /// New gains (dB per band), reached over RAMP frames from where it is; the same ones do nothing.
    pub fn set(&mut self, gains: &[f32; 10]) {
        if *gains == self.gains {
            return;
        }
        self.gains = *gains;
        if !self.on {
            // from flat: a flat band passes its input exactly, with x and y alike in its state
            (self.on, self.cur, self.st) = (true, coefs(&[0.0; 10]), [[0.0; 4]; 20]);
        }
        self.tgt = coefs(gains);
        for ((s, t), c) in self.step.iter_mut().zip(&self.tgt).zip(&self.cur) {
            *s = (t - c) / RAMP as f64;
        }
        (self.left, self.tail) = (RAMP, TAIL);
    }

    /// Flat, the ramp done and the bands rung down: it can go.
    fn done(&self) -> bool {
        self.gains == [0.0; 10] && self.left == 0 && self.tail == 0
    }

    /// Interleaved stereo through the bands and the limiter, into `out`: as many frames as came in, less
    /// what the limiter now holds back.
    fn process(&mut self, s: &[f32], out: &mut Vec<f32>) {
        let flat = self.gains == [0.0; 10];
        for frame in s.chunks_exact(2) {
            if self.left > 0 {
                self.left -= 1;
                if self.left == 0 {
                    self.cur = self.tgt;
                } else {
                    self.cur.iter_mut().zip(&self.step).for_each(|(c, d)| *c += d);
                }
            } else if flat && self.tail > 0 {
                self.tail -= 1;
            }
            let mut y = [0.0; 2];
            for (ch, y) in y.iter_mut().enumerate() {
                let mut v = frame[ch] as f64;
                for (c, st) in self.cur.chunks_exact(5).zip(self.st[ch..].iter_mut().step_by(2)) {
                    // grouped so a flat band's (b·x - a·y) is exactly 0 and it passes v exactly
                    let w = c[0] * v + (c[1] * st[0] - c[3] * st[2]) + (c[2] * st[1] - c[4] * st[3]);
                    *st = [v, st[0], w, st[2]];
                    v = w;
                }
                *y = v;
            }
            if let Some(z) = self.lim.push(y) {
                out.extend(z.map(sample));
            }
        }
    }
}

/// The process's equalizer, the sink's (lib.rs `hand`).
pub static EQ: Mutex<Eq> = Mutex::new(Eq::new());

fn lock(eq: &Mutex<Eq>) -> std::sync::MutexGuard<'_, Eq> {
    eq.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The process's equalizer to `gains` (dB per band, already clamped: sound.rs).
pub fn set(gains: &[f32; 10]) {
    lock(&EQ).set(gains);
}

/// `s` through the equalizer to `out`: while flat the very slice (no copy, nothing done), else what the
/// bands and the limiter make of it (the limiter's look-ahead behind; once flat again, what it held, then
/// the slice). `out` is called at most twice, never with nothing, and no lock is held while it runs (the
/// host's callback, which blocks).
pub fn through(eq: &Mutex<Eq>, s: &[f32], mut out: impl FnMut(&[f32])) {
    let mut g = lock(eq);
    if !g.on {
        drop(g);
        return out(s);
    }
    let mut buf = std::mem::take(&mut g.buf);
    buf.clear();
    let going = g.done();
    if going {
        g.lim.flush(&mut buf);
        g.on = false;
    } else {
        g.process(s, &mut buf);
    }
    drop(g);
    if !buf.is_empty() {
        out(&buf);
    }
    if going {
        out(s);
    }
    lock(eq).buf = buf;
}

/// The sink stopping (a pause, a seek's stop, the end): what the limiter holds back, to `out` first.
pub fn stop(eq: &Mutex<Eq>, mut out: impl FnMut(&[f32])) {
    let mut g = lock(eq);
    if !g.on || g.lim.held == 0 {
        return;
    }
    let mut buf = std::mem::take(&mut g.buf);
    buf.clear();
    g.lim.flush(&mut buf);
    drop(g);
    out(&buf);
    lock(eq).buf = buf;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `n` frames of a stereo sine at `f` Hz, amplitude `a`, from frame `from`.
    fn sine(f: f64, a: f32, from: usize, n: usize) -> Vec<f32> {
        (from..from + n).flat_map(|i| [(a as f64 * (TAU * f * i as f64 / RATE).sin()) as f32; 2]).collect()
    }

    fn run(eq: &Mutex<Eq>, s: &[f32]) -> Vec<f32> {
        let mut o = vec![];
        through(eq, s, |x| o.extend_from_slice(x));
        o
    }

    fn rms_db(s: &[f32]) -> f64 {
        10.0 * (s.iter().map(|&x| (x as f64).powi(2)).sum::<f64>() / s.len() as f64).log10()
    }

    fn with(band: usize, db: f32) -> [f32; 10] {
        let mut g = [0.0; 10];
        g[band] = db;
        g
    }

    #[test]
    fn flat_is_the_very_slice_and_nothing_is_lost_on_the_way_back() {
        let eq = Mutex::new(Eq::new());
        let s = sine(1000.0, 0.5, 0, 512);
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
        lock(&eq).set(&[0.0; 10]);
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
        // on, back to flat, rung down: the very slice again, and every frame out exactly once
        lock(&eq).set(&[3.0; 10]);
        lock(&eq).set(&[0.0; 10]);
        let (mut fed, mut got) = (0, 0);
        for k in 0..((RAMP + TAIL) as usize / 512 + 2) {
            let p = sine(1000.0, 0.5, k * 512, 512);
            fed += p.len();
            got += run(&eq, &p).len();
        }
        assert_eq!(fed, got);
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
    }

    #[test]
    fn a_band_lifts_its_own_centre_by_its_gain_and_leaves_a_far_one() {
        // well under the ceiling: the boost as it is, no preamp, the limiter idle
        let gain = |f: f64| {
            let eq = Mutex::new(Eq::new());
            lock(&eq).set(&with(5, 6.0)); // 1 kHz
            let n = 44100;
            let out = run(&eq, &sine(f, 0.1, 0, n));
            // the second half (past the ramp and the filters' settling); the limiter's delay is 4 ms
            rms_db(&out[n..]) - rms_db(&sine(f, 0.1, n / 2, n / 2))
        };
        let (centre, far) = (gain(1000.0), gain(64.0));
        assert!((centre - 6.0).abs() < 0.2, "centre {centre}");
        assert!(far.abs() < 0.2, "far {far}");
    }

    #[test]
    fn a_boost_at_full_scale_is_limited_under_it() {
        let eq = Mutex::new(Eq::new());
        lock(&eq).set(&with(5, 6.0));
        let mut out = vec![];
        for k in 0..43 {
            through(&eq, &sine(1000.0, 1.0, k * 1024, 1024), |x| out.extend_from_slice(x));
        }
        stop(&eq, |x| out.extend_from_slice(x));
        assert_eq!(out.len(), 43 * 1024 * 2); // every frame, the held ones at the stop
        let peak = out.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak as f64 <= CEILING + 1e-6, "peak {peak}");
        // limited, not crushed: once settled it reaches the ceiling, steadily
        let settled = out[out.len() / 2..].iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(settled as f64 > CEILING * 0.99, "settled {settled}");
    }

    #[test]
    fn the_limiter_is_one_gain_for_both_channels_and_unity_below() {
        let mut l = Limiter::new();
        let mut out = vec![];
        let frames: Vec<[f64; 2]> = (0..20_000)
            .map(|i| {
                let v = (TAU * 60.0 * i as f64 / RATE).sin() * if (5000..9000).contains(&i) { 1.8 } else { 0.5 };
                [v, -0.25 * v]
            })
            .collect();
        for &f in &frames {
            if let Some(y) = l.push(f) {
                out.push(y);
            }
        }
        let mut tail = vec![];
        l.flush(&mut tail); // the held frames, as f32 for the host: counted and bounded, not compared
        assert_eq!(out.len() + tail.len() / 2, frames.len());
        assert!(tail.iter().all(|y| y.abs() as f64 <= CEILING + 1e-6));
        let (mut limited, mut last) = (0, 1.0);
        for (x, y) in frames.iter().zip(&out) {
            assert!(y[0].abs() <= CEILING + 1e-12 && y[1].abs() <= CEILING + 1e-12);
            if x[0].abs() > 1e-3 {
                let g = y[0] / x[0];
                assert!((g - y[1] / x[1]).abs() < 1e-12, "{x:?} {y:?}"); // the same gain on both
                assert!((g - last).abs() <= 1.0 / LOOK as f64 + 1e-9, "a step in the gain: {last} to {g}");
                (limited, last) = (limited + (g < 1.0) as usize, g);
            }
        }
        assert!(limited > 4000); // the loud stretch was limited
        // before the loud stretch (more than LOOK ahead of it), unity exactly
        assert!(frames[..5000 - LOOK].iter().zip(&out).all(|(x, y)| x == y));
    }

    #[test]
    fn a_change_mid_stream_does_not_click() {
        // A 100 Hz sine, a change to +12 dB at 125 Hz and back to flat mid-stream. A click is a jump: the
        // steps between samples (a sine's largest a·2·sin(π f/fs)) and their change (a·w²) leap. Switched
        // without the ramp they do; ramped, the step stays within a quarter of the louder steady sine's
        // and its change within ten times (where the level begins and ends moving).
        let eq = Mutex::new(Eq::new());
        let (f, a) = (100.0, 0.1f32);
        let mut out = run(&eq, &sine(f, a, 0, 4096));
        lock(&eq).set(&with(2, 12.0));
        out.extend(run(&eq, &sine(f, a, 4096, 44100)));
        lock(&eq).set(&[0.0; 10]);
        out.extend(run(&eq, &sine(f, a, 4096 + 44100, 44100)));
        let left: Vec<f32> = out.iter().step_by(2).copied().collect();
        // the boosted sine's own level, read off its steady stretch
        let loud = left[30_000..40_000].iter().fold(0.0f32, |m, x| m.max(x.abs())) as f64;
        assert!(loud > 2.0 * a as f64 && loud < CEILING, "{loud}"); // boosted, under the limiter
        let w = TAU * f / RATE;
        let (step, bend) = (loud * 2.0 * (w / 2.0).sin(), loud * w * w);
        let worst = |n: usize, d: fn(&[f32]) -> f32| left.windows(n).map(|x| d(x).abs() as f64).fold(0.0, f64::max);
        let (worst_step, worst_bend) = (worst(2, |x| x[1] - x[0]), worst(3, |x| x[2] - 2.0 * x[1] + x[0]));
        assert!(worst_step < step * 1.25, "step {worst_step}, steady {step}");
        assert!(worst_bend < bend * 10.0, "bend {worst_bend}, steady {bend}");
    }
}

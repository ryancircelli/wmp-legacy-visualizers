//! The equalizer (wmp_ls_command "eq:<json>", sound.rs): ten peaking bands an octave apart, 32 Hz to
//! 16 kHz (RBJ's cookbook biquads, Q 1.41), on the samples as they go to the host. It sits in the one
//! place both of the sink's paths pass, lib.rs's `hand`, so after crossfade.rs's queue: a change is heard
//! at once, not up to twelve seconds later behind what is queued (the filters are linear, so a crossfade
//! mixed before them sounds the same). Flat, it does nothing at all: the packet goes through untouched.
//! A change moves the coefficients over RAMP frames with the filters' state kept (direct form I, whose
//! state is only past samples, so a coefficient change cannot jolt it): no click. Clipping is guarded by
//! a preamp: the peak of the bands' combined response, taken off ahead of them, so a boost lifts nothing
//! above where it was (cuts alone leave the level as it is).

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
/// Ten bands of b0 b1 b2 a1 a2 (over a0), then the preamp.
const N: usize = 51;

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
    c[50] = if gains.iter().any(|&g| g > 0.0) { 1.0 / peak(&c).max(1.0) } else { 1.0 };
    c
}

/// The bands' combined response at its loudest, as a gain: 20 Hz to 20 kHz, 1/24 octave apart.
fn peak(c: &[f64; N]) -> f64 {
    let mag = |c: &[f64], w: f64| {
        let (c1, s1, c2, s2) = (w.cos(), w.sin(), (2.0 * w).cos(), (2.0 * w).sin());
        let num = (c[0] + c[1] * c1 + c[2] * c2).powi(2) + (c[1] * s1 + c[2] * s2).powi(2);
        let den = (1.0 + c[3] * c1 + c[4] * c2).powi(2) + (c[3] * s1 + c[4] * s2).powi(2);
        (num / den).sqrt()
    };
    (0..240)
        .map(|i| TAU * 20.0 * 2f64.powf(i as f64 / 24.0) / RATE)
        .map(|w| c[..50].chunks(5).map(|b| mag(b, w)).product::<f64>())
        .fold(0.0, f64::max)
}

pub struct Eq {
    gains: [f32; 10], // where it is going
    on: bool,         // not flat, or still on its way to flat: processing
    cur: [f64; N],    // the coefficients in use
    step: [f64; N],   // per frame, while ramping
    tgt: [f64; N],
    left: u32,           // frames of the ramp to go
    tail: u32,           // frames flat to go before it goes
    st: [[f64; 4]; 20],  // per band and channel: x1 x2 y1 y2
    buf: Vec<f32>,       // `through`'s copy, kept so a packet allocates nothing
}

impl Eq {
    pub const fn new() -> Self {
        Eq { gains: [0.0; 10], on: false, cur: [0.0; N], step: [0.0; N], tgt: [0.0; N], left: 0, tail: 0, st: [[0.0; 4]; 20], buf: Vec::new() }
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

    /// Interleaved stereo, in place.
    fn process(&mut self, s: &mut [f32]) {
        let flat = self.gains == [0.0; 10];
        for frame in s.chunks_exact_mut(2) {
            if self.left > 0 {
                self.left -= 1;
                if self.left == 0 {
                    self.cur = self.tgt;
                } else {
                    self.cur.iter_mut().zip(&self.step).for_each(|(c, d)| *c += d);
                }
            } else if flat {
                if self.tail == 0 {
                    self.on = false; // rung down: the rest goes through as it is
                    return;
                }
                self.tail -= 1;
            }
            for (ch, x) in frame.iter_mut().enumerate() {
                let mut v = *x as f64 * self.cur[50];
                for (c, st) in self.cur[..50].chunks_exact(5).zip(self.st[ch..].iter_mut().step_by(2)) {
                    // grouped so a flat band's (b·x - a·y) is exactly 0 and it passes v exactly
                    let y = c[0] * v + (c[1] * st[0] - c[3] * st[2]) + (c[2] * st[1] - c[4] * st[3]);
                    *st = [v, st[0], y, st[2]];
                    v = y;
                }
                *x = v as f32;
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

/// `s` through the equalizer to `out`: while flat the very slice (no copy, nothing done), else a copy
/// put through it. No lock is held while `out` runs (the host's callback, which blocks).
pub fn through(eq: &Mutex<Eq>, s: &[f32], out: impl FnOnce(&[f32])) {
    let mut g = lock(eq);
    if !g.on {
        drop(g);
        return out(s);
    }
    let mut buf = std::mem::take(&mut g.buf);
    buf.clear();
    buf.extend_from_slice(s);
    g.process(&mut buf);
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

    #[test]
    fn flat_is_the_very_slice() {
        let eq = Mutex::new(Eq::new());
        let s = sine(1000.0, 0.5, 0, 512);
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
        lock(&eq).set(&[0.0; 10]);
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
        // on and back to flat: once rung down, the very slice again
        lock(&eq).set(&[3.0; 10]);
        lock(&eq).set(&[0.0; 10]);
        for k in 0..((RAMP + TAIL) as usize / 512 + 1) {
            run(&eq, &sine(1000.0, 0.5, k * 512, 512));
        }
        through(&eq, &s, |o| assert!(std::ptr::eq(o, &s[..])));
    }

    #[test]
    fn a_band_lifts_its_own_centre_and_leaves_a_far_one() {
        let gain = |f: f64| {
            let eq = Mutex::new(Eq::new());
            let mut g = [0.0; 10];
            g[5] = 6.0; // 1 kHz
            lock(&eq).set(&g);
            let n = 44100;
            let out = run(&eq, &sine(f, 0.25, 0, n));
            // the second half second (n samples in): past the ramp and the filters' settling
            rms_db(&out[n..]) - rms_db(&sine(f, 0.25, n / 2, n / 2))
        };
        let pre = 20.0 * coefs(&[0.0, 0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 0.0])[50].log10();
        assert!((pre + 6.0).abs() < 0.3, "preamp {pre}");
        let (centre, far) = (gain(1000.0), gain(64.0));
        assert!((centre - (6.0 + pre)).abs() < 0.2, "centre {centre} pre {pre}");
        assert!((far - pre).abs() < 0.2, "far {far} pre {pre}");
        assert!((centre - far - 6.0).abs() < 0.2, "{centre} {far}");
    }

    #[test]
    fn a_change_mid_stream_does_not_click() {
        // A 100 Hz sine, a change to +12 dB at 125 Hz and back to flat mid-stream. A click is a jump: the
        // steps between samples (a sine's largest a·2·sin(π f/fs)) and their change (a·w²) leap. Switched
        // without the ramp they do, ~50 and ~3600 times over; ramped, the step stays within a quarter
        // (the band's ring-down swells it a little, ~1 dB for some ms, on the way back) and its change
        // within ten times (the ramp's start and end, where the level begins to move).
        let eq = Mutex::new(Eq::new());
        let (f, a) = (100.0, 0.5f32);
        let mut g = [0.0; 10];
        g[2] = 12.0;
        let mut out = run(&eq, &sine(f, a, 0, 4096));
        lock(&eq).set(&g);
        out.extend(run(&eq, &sine(f, a, 4096, 44100)));
        lock(&eq).set(&[0.0; 10]);
        out.extend(run(&eq, &sine(f, a, 4096 + 44100, 44100)));
        // the preamp keeps the boosted band at or under where it was: the flat sine's are the bounds
        let w = TAU * f / RATE;
        let (step, bend) = (a as f64 * 2.0 * (w / 2.0).sin(), a as f64 * w * w);
        let left: Vec<f32> = out.iter().step_by(2).copied().collect();
        let worst = |n: usize, d: fn(&[f32]) -> f32| left.windows(n).map(|x| d(x).abs() as f64).fold(0.0, f64::max);
        let (worst_step, worst_bend) = (worst(2, |x| x[1] - x[0]), worst(3, |x| x[2] - 2.0 * x[1] + x[0]));
        assert!(worst_step < step * 1.25, "step {worst_step}, steady {step}");
        assert!(worst_bend < bend * 10.0, "bend {worst_bend}, steady {bend}");
    }

    #[test]
    fn a_boost_cannot_lift_past_full_scale() {
        // every band +12: the preamp takes the whole response's peak off, so it never passes 0 dB
        let c = coefs(&[12.0; 10]);
        let mut d = c;
        d[50] = 1.0;
        assert!((peak(&d) * c[50] - 1.0).abs() < 1e-9);
        assert!(20.0 * peak(&d).log10() > 12.0); // the overlap lifts more than one band's 12
        // cuts alone keep the level
        assert_eq!(coefs(&[-6.0; 10])[50], 1.0);
    }
}

//! WASAPI loopback on the default render endpoint: what the speakers are playing, as raw PCM, with no
//! picker and no permission prompt — the one thing WebView2 cannot give the page itself
//! (docs/history/deno-webview.md, "System audio"). The Deno host's audio helper's `run()`,
//! moved in process: each wake-up's packets go to the socket as one message, so a 10 ms period is
//! never split across two (the helper's stdout had to dodge a LineWriter for that).

use super::Out;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::time::Duration;
use wasapi::{
    DeviceEnumerator, DeviceEventCallbacks, Direction, Role, SampleType, StreamMode, WaveFormat,
    initialize_mta,
};

/// Captures until the socket goes away, restarting after any failure with backoff — 0.25 s doubling
/// to 5 s, the Deno host's — so a device change or a missing endpoint is a gap of silence, not the
/// end of the audio, and a device that is gone for good is not a busy loop.
pub fn spawn(out: Sender<Out>, alive: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let _ = initialize_mta().ok();
        let mut fails = 0u32;
        while alive.load(Ordering::Relaxed) {
            let mut streamed = false;
            match run(&out, &alive, &mut streamed) {
                Ok(()) => return,
                Err(e) => log::warn!("audio: capture: {e}"),
            }
            // A run that got as far as streaming (a device change) retries at once; failing to
            // start at all backs off.
            fails = if streamed { 1 } else { fails + 1 };
            std::thread::sleep(Duration::from_millis((250 << (fails - 1).min(5)).min(5000)));
        }
    });
}

/// One capture, until the socket closes (Ok) or WASAPI fails or the default device changes (Err).
fn run(
    out: &Sender<Out>,
    alive: &AtomicBool,
    streamed: &mut bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let devices = DeviceEnumerator::new()?;
    let device = devices.get_default_device(&Direction::Render)?;
    // A loopback stream stays on the device it was opened on, so a new default (headphones plugged
    // in, a switch in the volume flyout) would otherwise leave this capturing an endpoint nothing
    // plays to any more. The endpoint being invalidated (unplugged) is an error from the read below.
    let changed = Arc::new(AtomicBool::new(false));
    let mut cb = DeviceEventCallbacks::new();
    let flag = changed.clone();
    cb.set_default_device_callback(move |dir, role, _| {
        if dir == Direction::Render && matches!(role, Role::Console) {
            flag.store(true, Ordering::Relaxed);
        }
    });
    let _registration = devices.register_notification_callback(cb)?;

    let mut client = device.get_iaudioclient()?;
    let rate = client.get_mixformat()?.get_samplespersec();
    // A render device initialized for Capture is loopback (AUDCLNT_STREAMFLAGS_LOOPBACK).
    // autoconvert adds AUTOCONVERTPCM, so the audio engine hands us plain stereo f32 whatever the
    // endpoint's own mix format is, and the rate stays the device's own, which is also the rate
    // Chromium gives the page, so in the normal case nothing resamples anywhere.
    let fmt = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None);
    let (_default_period, min_period) = client.get_device_period()?;
    client.initialize_client(
        &fmt,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: min_period,
        },
    )?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    log::info!(
        "audio: capturing {:?} at {rate} Hz",
        device.get_friendlyname().unwrap_or_default()
    );
    if out.send(Out::Rate(rate)).is_err() {
        return Ok(());
    }

    let mut q: VecDeque<u8> = VecDeque::with_capacity(4 * 2 * rate as usize); // 1 s of slack
    client.start_stream()?;
    *streamed = true;
    loop {
        // A timeout is not an error: an idle render endpoint delivers no loopback packets at all
        // while nothing is playing. The read below is what notices a device actually going away,
        // so it runs either way; with no data the page underruns into silence, which is exactly
        // what should be on screen when nothing is playing.
        let _ = event.wait_for_event(500);
        if !alive.load(Ordering::Relaxed) {
            return Ok(());
        }
        if changed.load(Ordering::Relaxed) {
            return Err("the default device changed".into());
        }
        // Every packet waiting, not just one: a late wake-up must not leave audio queued behind it.
        loop {
            let from = q.len();
            let info = capture.read_from_device_to_deque(&mut q)?;
            if q.len() == from {
                break;
            }
            if info.flags.silent {
                q.range_mut(from..).for_each(|b| *b = 0); // "ignore the actual data values"
            }
        }
        if !q.is_empty() && out.send(Out::Pcm(q.drain(..).collect())).is_err() {
            return Ok(());
        }
    }
}

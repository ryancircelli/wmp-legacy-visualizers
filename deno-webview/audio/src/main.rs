// No console. A console-subsystem child of the GUI-subsystem screensaver gets a console window
// allocated for it, which flashes on screen every time the saver starts. The subsystem has nothing
// to do with stdio: the pipe Deno hands us works exactly the same either way.
#![windows_subsystem = "windows"]

// WASAPI loopback capture -> stdout. What the speakers are playing, as raw PCM, with no picker
// and no permission prompt: the one thing WebView2 cannot give the page itself (README.md,
// "System audio").
//
// Protocol, little-endian, nothing else on stdout:
//   u32   sample rate, once, before any audio
//   f32[] interleaved stereo frames, forever
//
// The Deno host (deno-webview/audio.ts) spawns this, reads the rate, and relays the frames to the
// page over a WebSocket. Alongside, on stderr and stdin, it carries the Now Playing metadata and
// transport commands as JSON lines (media.rs); the PCM on stdout is untouched by that. Exit codes: 0 when stdin closes (the host went away), 1 on any WASAPI
// error — a device change, an endpoint being invalidated — which the host answers by restarting
// this process with backoff.
use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::os::windows::io::AsHandle;
mod media;

use wasapi::{
    initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    initialize_mta().ok()?;
    let device = DeviceEnumerator::new()?.get_default_device(&Direction::Render)?;
    let mut client = device.get_iaudioclient()?;
    let rate = client.get_mixformat()?.get_samplespersec();

    // A render device initialized for Capture is loopback (AUDCLNT_STREAMFLAGS_LOOPBACK).
    // autoconvert adds AUTOCONVERTPCM, so the audio engine hands us plain stereo f32 whatever the
    // endpoint's own mix format is — 5.1, 24-bit packed, anything — and all the channel and sample
    // type juggling stays out of this file. The sample rate is left at the device's own, because
    // that is also the rate Chromium gives the page's AudioContext, so in the normal case nothing
    // resamples anywhere.
    let fmt = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None);
    let (_default_period, min_period) = client.get_device_period()?;
    client.initialize_client(
        &fmt,
        &Direction::Capture,
        &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_period },
    )?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;

    // A File on the stdout handle, not std::io::stdout(): Stdout is a LineWriter, and PCM is full of
    // 0x0A bytes, so every period went out as two writes split at its last one (3712 + 128 bytes of a
    // 3840-byte period with rustc 1.98). The host relays each pipe read as its own WebSocket message,
    // and a read already pending when the first write lands returns with that write alone: two
    // messages a period for the host, the browser and the page to handle. A File has no buffer.
    let mut out = std::fs::File::from(std::io::stdout().as_handle().try_clone_to_owned()?);
    out.write_all(&rate.to_le_bytes())?;

    let mut q: VecDeque<u8> = VecDeque::with_capacity(4 * 2 * rate as usize); // 1 s of slack
    client.start_stream()?;
    loop {
        // A timeout is not an error: an idle render endpoint delivers no loopback packets at all
        // while nothing is playing. The read below is what notices a device actually going away,
        // so it runs either way; with no data it is a no-op and the page's worklet underruns into
        // silence, which is exactly what should be on screen when nothing is playing.
        let _ = event.wait_for_event(500);
        capture.read_from_device_to_deque(&mut q)?;
        if !q.is_empty() {
            out.write_all(q.make_contiguous())?;
            q.clear();
        }
    }
}

fn main() {
    // stdin is the host's heartbeat: EOF means Deno closed the pipe or died and took it with it.
    // Without this a crashed host leaves a headless capture process running forever. Each line on
    // it is a transport command, {"cmd":"seek","position":12.5}, for the media thread.
    let (tx, rx) = std::sync::mpsc::channel();
    let cmds = tx.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if let Some(cmd) = media::field(&line, "cmd") {
                let pos = media::field(&line, "position").and_then(|p| p.parse().ok()).unwrap_or(0.0);
                let _ = cmds.send(media::Msg::Cmd(cmd.to_string(), pos));
            }
        }
        std::process::exit(0);
    });
    // Metadata failing (no WinRT media stack, say on an N edition) must never cost the audio.
    std::thread::spawn(move || {
        let _ = wasapi::initialize_mta().ok();
        if let Err(e) = media::run(tx, rx) {
            eprintln!("alchemy-audio: media: {e}");
        }
    });
    if let Err(e) = run() {
        eprintln!("alchemy-audio: {e}");
        std::process::exit(1);
    }
}

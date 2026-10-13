//! loopback-rec: records what the default render endpoint is playing (WASAPI loopback) to a 32-bit
//! float WAV at the endpoint's own rate and channel count, and prints one JSON line. See README.md.
//!
//!   loopback-rec --out <path.wav> --seconds <n> [--silent | --silent=zero] [--tone <hz> <dbfs> <s>]
//!                [--pid <pid> | --process <name.exe>]

use std::collections::VecDeque;
use std::f64::consts::TAU;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::time::{Duration, Instant};
use wasapi::{
    AudioClient, Device, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
    initialize_mta,
};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::core::BOOL;

type Res<T> = Result<T, Box<dyn std::error::Error>>;

static STOP: AtomicBool = AtomicBool::new(false);
static RESTORED: AtomicBool = AtomicBool::new(true);
static PLAYING: AtomicBool = AtomicBool::new(false);

/// Ctrl-C, Ctrl-Break, console close: ask main to stop, and hold the process until it has put the
/// endpoint back (a close event ends the process as soon as this returns).
unsafe extern "system" fn on_ctrl(_: u32) -> BOOL {
    STOP.store(true, Relaxed);
    let t = Instant::now();
    while !RESTORED.load(Relaxed) && t.elapsed() < Duration::from_secs(4) {
        std::thread::sleep(Duration::from_millis(10));
    }
    true.into()
}

fn state(vol: &IAudioEndpointVolume) -> Res<(f32, bool)> {
    unsafe { Ok((vol.GetMasterVolumeLevelScalar()?, vol.GetMute()?.as_bool())) }
}

/// Muted for the middle step, so no order of these three is ever briefly audible.
fn set(vol: &IAudioEndpointVolume, level: f32, muted: bool) -> Res<()> {
    unsafe {
        vol.SetMute(true, std::ptr::null())?;
        vol.SetMasterVolumeLevelScalar(level, std::ptr::null())?;
        vol.SetMute(muted, std::ptr::null())?;
    }
    Ok(())
}

/// Where the state before a silenced run is kept until it is restored, so a run killed outright
/// (TerminateProcess, which nothing in process can catch) is undone by the next run.
fn recovery_file() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| "loopback-rec".into()).with_extension("restore")
}

/// The endpoint made inaudible for the guard's lifetime; dropping it (end of run, `?`, unwind)
/// restores the saved volume and mute exactly.
struct Silence {
    vol: IAudioEndpointVolume,
    level: f32,
    muted: bool,
}

impl Silence {
    fn new(vol: &IAudioEndpointVolume, zero: bool) -> Res<Self> {
        let (level, muted) = state(vol)?;
        std::fs::write(recovery_file(), format!("{level} {}", muted as u8))?;
        RESTORED.store(false, Relaxed);
        let s = Silence { vol: vol.clone(), level, muted };
        unsafe {
            vol.SetMute(true, std::ptr::null())?;
            if zero {
                // master volume 0 with mute off: the experiment's second variant
                vol.SetMasterVolumeLevelScalar(0.0, std::ptr::null())?;
                vol.SetMute(false, std::ptr::null())?;
            }
        }
        Ok(s)
    }
}

impl Drop for Silence {
    fn drop(&mut self) {
        // the tone ends before the endpoint is audible again, whichever path got here
        STOP.store(true, Relaxed);
        let t = Instant::now();
        while PLAYING.load(Relaxed) && t.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(5));
        }
        match set(&self.vol, self.level, self.muted) {
            Ok(()) => drop(std::fs::remove_file(recovery_file())),
            Err(e) => eprintln!("loopback-rec: RESTORE FAILED ({e}); the next run retries it"),
        }
        RESTORED.store(true, Relaxed);
    }
}

fn qpc_hns() -> u64 {
    let (mut c, mut f) = (0i64, 0i64);
    unsafe {
        let _ = QueryPerformanceCounter(&mut c);
        let _ = QueryPerformanceFrequency(&mut f);
    }
    (c as i128 * 10_000_000 / f.max(1) as i128) as u64
}

/// A shared-mode event-driven client on `device`, in f32 at the device's own rate and channels;
/// with `pid`, process loopback of that process tree instead (Windows 10 2004+), in the same format.
fn open(
    device: &Device,
    dir: Direction,
    buffer_hns: i64,
    pid: Option<u32>,
) -> Res<(AudioClient, u32, usize)> {
    let mut client = device.get_iaudioclient()?;
    let mix = client.get_mixformat()?;
    let (rate, ch) = (mix.get_samplespersec(), mix.get_nchannels() as usize);
    if let Some(pid) = pid {
        client = AudioClient::new_application_loopback_client(pid, true)?;
    }
    let fmt = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, ch, None);
    // A render endpoint opened for Capture is loopback (AUDCLNT_STREAMFLAGS_LOOPBACK).
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: buffer_hns };
    client.initialize_client(&fmt, &dir, &mode)?;
    Ok((client, rate, ch))
}

/// A sine on every channel of the default render endpoint, in process (the owner's rule: never a
/// media player). `main` only lets this run while the endpoint is silenced.
fn tone(hz: f64, dbfs: f64, secs: f64) -> Res<()> {
    initialize_mta().ok()?;
    let device = DeviceEnumerator::new()?.get_default_device(&Direction::Render)?;
    let (client, rate, ch) = open(&device, Direction::Render, 1_000_000, None)?;
    let event = client.set_get_eventhandle()?;
    let render = client.get_audiorenderclient()?;
    let (amp, total) = (10f64.powf(dbfs / 20.0), (secs * rate as f64) as usize);
    let (mut n, mut buf, mut started) = (0usize, Vec::new(), false);
    while n < total && !STOP.load(Relaxed) {
        let k = (client.get_available_space_in_frames()? as usize).min(total - n);
        if k > 0 {
            buf.clear();
            for i in n..n + k {
                let s = (amp * (TAU * hz * i as f64 / rate as f64).sin()) as f32;
                (0..ch).for_each(|_| buf.extend_from_slice(&s.to_le_bytes()));
            }
            render.write_to_device(k, &buf, None)?;
            n += k;
        }
        if !started {
            client.start_stream()?;
            started = true;
        }
        let _ = event.wait_for_event(200);
    }
    while !STOP.load(Relaxed) && client.get_current_padding()? > 0 {
        std::thread::sleep(Duration::from_millis(5));
    }
    client.stop_stream()?;
    Ok(())
}

/// The strongest `hz` component over 50 ms blocks of channel 0, as a sine's peak amplitude:
/// the played tone's level even if something else is playing too.
fn tone_level(pcm: &[f32], ch: usize, rate: u32, hz: f64) -> f64 {
    let n = (rate / 20) as usize;
    let w = TAU * hz / rate as f64;
    let x: Vec<f64> = pcm.iter().step_by(ch).map(|&s| s as f64).collect();
    x.chunks_exact(n)
        .map(|b| {
            let (re, im) = b.iter().enumerate().fold((0.0, 0.0), |(re, im), (i, &s)| {
                (re + s * (w * i as f64).cos(), im + s * (w * i as f64).sin())
            });
            2.0 * (re * re + im * im).sqrt() / n as f64
        })
        .fold(0.0, f64::max)
}

/// The root of the tree of processes named `name` (one whose parent is not also so named), as
/// process loopback must target the parent to include the children.
fn find_process(name: &str) -> Res<u32> {
    let mut all = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            all.push((e.th32ProcessID, e.th32ParentProcessID, String::from_utf16_lossy(&e.szExeFile[..len])));
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    let named: Vec<_> = all.iter().filter(|p| p.2.eq_ignore_ascii_case(name)).collect();
    let root = named.iter().find(|p| !named.iter().any(|q| q.0 == p.1));
    Ok(root.ok_or(format!("no process named {name}"))?.0)
}

fn db(x: f64) -> String {
    if x > 0.0 { format!("{:.2}", 20.0 * x.log10()) } else { "null".into() }
}

/// WAVE_FORMAT_IEEE_FLOAT, 32-bit: exactly what the capture client delivers.
// ponytail: plain 16-byte fmt chunk, no channel mask; write WAVEFORMATEXTENSIBLE if a >2-channel
// endpoint's speaker layout ever matters.
fn wav(path: &str, rate: u32, ch: usize, pcm: &[f32]) -> std::io::Result<()> {
    let (ch, data) = (ch as u16, (pcm.len() * 4) as u32);
    let mut w = Vec::with_capacity(44 + data as usize);
    w.extend(b"RIFF");
    w.extend((36 + data).to_le_bytes());
    w.extend(b"WAVEfmt ");
    w.extend(16u32.to_le_bytes());
    w.extend(3u16.to_le_bytes());
    w.extend(ch.to_le_bytes());
    w.extend(rate.to_le_bytes());
    w.extend((rate * ch as u32 * 4).to_le_bytes());
    w.extend((ch * 4).to_le_bytes());
    w.extend(32u16.to_le_bytes());
    w.extend(b"data");
    w.extend(data.to_le_bytes());
    pcm.iter().for_each(|s| w.extend(s.to_le_bytes()));
    std::fs::write(path, w)
}

const USAGE: &str = "usage: loopback-rec --out <path.wav> --seconds <n> [--silent | --silent=zero] \
[--tone <hz> <dbfs> <seconds>] [--pid <pid> | --process <name.exe>]";

fn main() {
    if let Err(e) = run() {
        eprintln!("loopback-rec: {e}");
        std::process::exit(1);
    }
}

fn run() -> Res<()> {
    let (mut out, mut seconds, mut silent, mut tone_args, mut pid) = (None, None, None, None, None);
    let mut a = std::env::args().skip(1);
    let num = |a: &mut std::iter::Skip<std::env::Args>| -> Res<f64> {
        Ok(a.next().ok_or(USAGE)?.parse::<f64>()?)
    };
    while let Some(k) = a.next() {
        match k.as_str() {
            "--out" => out = Some(a.next().ok_or(USAGE)?),
            "--seconds" => seconds = Some(num(&mut a)?),
            "--silent" => silent = Some(false),
            "--silent=zero" => silent = Some(true),
            "--tone" => tone_args = Some((num(&mut a)?, num(&mut a)?, num(&mut a)?)),
            "--pid" => pid = Some(a.next().ok_or(USAGE)?.parse::<u32>()?),
            "--process" => pid = Some(find_process(&a.next().ok_or(USAGE)?)?),
            _ => return Err(USAGE.into()),
        }
    }
    let (out, seconds) = (out.ok_or(USAGE)?, seconds.ok_or(USAGE)?);
    if tone_args.is_some() && silent.is_none() {
        return Err("--tone plays through the speakers; it only runs with --silent".into());
    }

    unsafe { SetConsoleCtrlHandler(Some(on_ctrl), true)? };
    initialize_mta().ok()?;
    let imm = unsafe {
        CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)?
            .GetDefaultAudioEndpoint(eRender, eConsole)?
    };
    let vol: IAudioEndpointVolume = unsafe { imm.Activate(CLSCTX_ALL, None)? };
    if let Ok(s) = std::fs::read_to_string(recovery_file()) {
        let mut it = s.split_whitespace();
        if let (Some(Ok(level)), Some(m)) = (it.next().map(str::parse::<f32>), it.next()) {
            set(&vol, level, m == "1")?;
            eprintln!("loopback-rec: restored volume {level} mute {m} left by an interrupted run");
        }
        std::fs::remove_file(recovery_file())?;
    }
    let (vol_before, mute_before) = state(&vol)?;
    let (mut min_db, mut max_db, mut step_db) = (0f32, 0f32, 0f32);
    unsafe { vol.GetVolumeRange(&mut min_db, &mut max_db, &mut step_db)? };
    let hw = unsafe { vol.QueryHardwareSupport()? };
    let device = Device::from_immdevice(imm)?;
    let name = device.get_friendlyname()?;

    let guard = silent.map(|zero| Silence::new(&vol, zero)).transpose()?;
    let (client, rate, ch) = open(&device, Direction::Capture, 2_000_000, pid)?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    let t0 = qpc_hns();
    client.start_stream()?;
    let player = tone_args.map(|(hz, dbfs, s)| {
        PLAYING.store(true, Relaxed);
        std::thread::spawn(move || {
            let r = tone(hz, dbfs, s).map_err(|e| e.to_string());
            PLAYING.store(false, Relaxed);
            r
        })
    });
    let start = Instant::now();
    let (mut pcm, mut q) = (Vec::<f32>::new(), VecDeque::new());
    let slack = (rate as usize / 50) * ch; // 20 ms: packet timestamps jitter less than this
    while start.elapsed().as_secs_f64() < seconds && !STOP.load(Relaxed) {
        let _ = event.wait_for_event(100);
        loop {
            q.clear();
            let info = capture.read_from_device_to_deque(&mut q)?;
            if q.is_empty() {
                break;
            }
            // An idle endpoint sends no packets at all; place each packet at its own time so that
            // gap is silence in the file, not collapsed.
            let at = (info.timestamp.saturating_sub(t0) as f64 * rate as f64 / 1e7) as usize * ch;
            if at > pcm.len() + slack {
                pcm.resize(at, 0.0);
            }
            let silent_pkt = info.flags.silent; // "ignore the actual data values"
            pcm.extend(q.make_contiguous().chunks_exact(4).map(|b| {
                if silent_pkt { 0.0 } else { f32::from_le_bytes([b[0], b[1], b[2], b[3]]) }
            }));
        }
    }
    let _ = client.stop_stream();
    STOP.store(true, Relaxed);
    if let Some(Ok(Err(e))) = player.map(|p| p.join()) {
        eprintln!("loopback-rec: tone: {e}");
    }
    drop(guard);
    let (vol_after, mute_after) = state(&vol)?;

    let secs = start.elapsed().as_secs_f64().min(seconds);
    pcm.resize((secs * rate as f64) as usize * ch, 0.0);
    wav(&out, rate, ch, &pcm)?;
    let peak = pcm.iter().fold(0f32, |m, s| m.max(s.abs())) as f64;
    let rms = (pcm.iter().map(|&s| s as f64 * s as f64).sum::<f64>() / pcm.len().max(1) as f64).sqrt();
    let tone_db = tone_args.map_or("null".into(), |(hz, _, _)| db(tone_level(&pcm, ch, rate, hz)));
    let mode = match silent {
        None => "null",
        Some(false) => "\"mute\"",
        Some(true) => "\"zero\"",
    };
    println!(
        "{{\"frames\":{},\"rate\":{rate},\"channels\":{ch},\"peak_dbfs\":{},\"rms_dbfs\":{},\"tone_dbfs\":{tone_db},\
\"device\":{name:?},\"volume_before\":{vol_before},\"mute_before\":{mute_before},\"silent\":{mode},\
\"volume_after\":{vol_after},\"mute_after\":{mute_after},\"volume_range_db\":[{min_db},{max_db},{step_db}],\
\"hw_support\":{hw},\"pid\":{},\"out\":{out:?}}}",
        pcm.len() / ch,
        db(peak),
        db(rms),
        pid.map_or("null".into(), |p| p.to_string()),
    );
    Ok(())
}

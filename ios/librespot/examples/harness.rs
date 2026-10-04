//! The speaker on a desktop (ios/README.md, "Testing on a desktop"): the crate's own code behind the same
//! C ABI the app calls, with a host that writes the PCM to a WAV, prints every callback as a line, and
//! takes commands from stdin or a script. `cargo run --example harness -- --help`.
//!
//! The library is compiled in as a module rather than linked: an rlib crate type beside the staticlib
//! would turn off LTO for the iPhone's build (Cargo does no LTO for a lib with an rlib among its types).

#[path = "../src/lib.rs"]
mod ls;

use std::{
    ffi::{CStr, CString, c_char, c_void},
    fs::File,
    io::{BufRead, Seek, SeekFrom, Write},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering::Relaxed},
    },
    time::{Duration, Instant},
};

const RATE: u64 = 44100;
/// What the app lets be queued ahead of what is heard before its callback blocks (App.swift `take`, in
/// front): half a second.
const AHEAD: u64 = RATE / 2;

const USAGE: &str = "harness [--cache DIR] [--out FILE.wav] [--fast] [--script FILE]
        [--token-file FILE.json | --token T --client-id ID --client-token CT]
  --cache       the speaker's cache dir (credentials, client_id, sound.json); default target/harness-cache
  --out         the WAV written (16-bit stereo 44.1 kHz, as the app converts it); default target/harness.wav
  --fast        no pacing: decoded as fast as it comes (crossfade then never has a queue to fade)
  --script      command lines run before stdin's
  --token-file  {\"accessToken\": ..., \"clientId\": ..., \"clientToken\": ...} (the web player's)
Commands, one a line (stdin after the script; end of input quits): anything wmp_ls_command takes
(play, pause, next, seek:<ms>, crossfade:<s>, eq:[...], load:{...}, take, ...), and
  wait <seconds>   mark <text>   token <file.json>   quit
Output: one line per event, `<seconds> <frame> <kind> <text>`; frame is the WAV's frame count then.";

static T0: LazyLock<Instant> = LazyLock::new(Instant::now);
static FRAMES: AtomicU64 = AtomicU64::new(0); // frames written to the WAV
static UP: AtomicBool = AtomicBool::new(false); // a session is up (the state callback)

struct Out {
    wav: Option<File>, // None once finalised
    fast: bool,
    clock: Option<(Instant, u64)>, // real time: since when the "player node" plays, and frames it was given
}

static OUT: Mutex<Out> = Mutex::new(Out { wav: None, fast: false, clock: None });

fn out() -> std::sync::MutexGuard<'static, Out> {
    OUT.lock().unwrap_or_else(|e| e.into_inner())
}

fn line(kind: &str, text: &str) {
    println!("{:9.3} {:10} {kind} {text}", T0.elapsed().as_secs_f64(), FRAMES.load(Relaxed));
}

fn text<'a>(p: *const c_char) -> std::borrow::Cow<'a, str> {
    if p.is_null() { "".into() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy() }
}

/// A 16-bit stereo 44.1 kHz header for `frames` frames (sizes saturate past 4 GB, about 6.7 hours).
fn header(frames: u64) -> Vec<u8> {
    let data = (frames * 4).min(u32::MAX as u64 - 36) as u32;
    let mut h = Vec::with_capacity(44);
    h.extend(b"RIFF");
    h.extend((36 + data).to_le_bytes());
    h.extend(b"WAVEfmt ");
    h.extend(16u32.to_le_bytes());
    h.extend(1u16.to_le_bytes()); // PCM
    h.extend(2u16.to_le_bytes());
    h.extend((RATE as u32).to_le_bytes());
    h.extend((RATE as u32 * 4).to_le_bytes());
    h.extend(4u16.to_le_bytes());
    h.extend(16u16.to_le_bytes());
    h.extend(b"data");
    h.extend(data.to_le_bytes());
    h
}

/// A new WAV, its header first: `pcm` appends after it.
fn wav_file(path: &str) -> std::io::Result<File> {
    let mut f = File::create(path)?;
    f.write_all(&header(0))?;
    Ok(f)
}

extern "C" fn pcm(_: *mut c_void, samples: *const f32, frames: usize) {
    if samples.is_null() || frames == 0 {
        // the app stops its player node: what was queued is dropped, and the clock starts again (a skip's
        // cut, samples not NULL, keeps the engine running in the app: here the same, but said apart)
        out().clock = None;
        line("pcm", if samples.is_null() { "sink stopped" } else { "cut (a skip)" });
        return;
    }
    let s = unsafe { std::slice::from_raw_parts(samples, frames * 2) };
    // Real time: blocks while more than AHEAD is queued, as the app's callback does, so librespot (and
    // the crossfade's queue) see the same back-pressure as on the phone.
    let due = {
        let mut o = out();
        let (now, fast, started) = (Instant::now(), o.fast, o.clock.is_none());
        let (t0, given) = o.clock.get_or_insert((now, 0));
        let played = (now - *t0).as_secs_f64() * RATE as f64;
        if !fast && !started && played > *given as f64 + 1.0 {
            // the app's player node ran out before this packet came: a gap on the phone, none in the WAV
            line("harness", &format!("ran dry: the phone would have played {:.0} ms of silence here", (played - *given as f64) * 1000.0 / RATE as f64));
            (*t0, *given) = (now, 0);
        }
        let due = *t0 + Duration::from_secs_f64(given.saturating_sub(AHEAD) as f64 / RATE as f64);
        *given += frames as u64;
        if started {
            line("pcm", "started");
        }
        (!fast).then_some(due)
    };
    if let Some(d) = due {
        std::thread::sleep(d.saturating_duration_since(Instant::now()));
    }
    // As the app hands the page its int16 (App.swift `take`): clamped, times 32767, truncated.
    let bytes: Vec<u8> = s.iter().flat_map(|&f| ((f.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let mut o = out();
    if let Some(w) = o.wav.as_mut() {
        let n = FRAMES.load(Relaxed) + frames as u64;
        // the header kept current, so a killed run leaves a WAV that opens
        let ok = w.write_all(&bytes).and_then(|_| w.seek(SeekFrom::Start(0))).and_then(|_| w.write_all(&header(n))).and_then(|_| w.seek(SeekFrom::End(0)));
        match ok {
            Ok(_) => FRAMES.store(n, Relaxed),
            Err(e) => {
                line("harness", &format!("WAV write failed, no more audio kept: {e}"));
                o.wav = None;
            }
        }
    }
}

extern "C" fn log(_: *mut c_void, l: *const c_char) {
    line("log", &text(l));
}

extern "C" fn state(_: *mut c_void, id: *const c_char) {
    UP.store(!id.is_null(), Relaxed);
    line("state", if id.is_null() { "none".into() } else { text(id) }.as_ref());
}

extern "C" fn np(_: *mut c_void, json: *const c_char) {
    line("np", &text(json));
}

extern "C" fn player(_: *mut c_void, json: *const c_char) {
    line("player", &text(json));
}

// ponytail: zeroconf stubbed out. dns-sd links Avahi's libdns_sd off Apple, which a desktop seldom has
// (pkgconfig/ answers its build script with nothing to link), and WSL2's NAT keeps mDNS off the LAN anyway:
// discovery fails at once and logs so. To test zeroconf, install avahi-compat-libdns_sd and drop these.
#[unsafe(no_mangle)]
extern "C" fn DNSServiceRegister() -> i32 {
    -65563 // kDNSServiceErr_ServiceNotRunning; the caller's arguments ignored (the caller cleans up in C's ABI)
}

#[unsafe(no_mangle)]
extern "C" fn DNSServiceRefDeallocate() {}

/// The web player's three from a JSON file; never printed.
fn token_file(path: &str) -> Result<[String; 3], String> {
    let v: serde_json::Value = std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| format!("{path}: not readable JSON"))?;
    let get = |k: &str| v[k].as_str().map(str::to_owned).ok_or_else(|| format!("{path}: no string \"{k}\""));
    Ok([get("accessToken")?, get("clientId")?, get("clientToken")?])
}

fn give(t: &[String; 3], via: &str) {
    if t[1].is_empty() || t[2].is_empty() {
        line("harness", "warning: no client id or client token: spclient will ask Spotify for its own, which refuses a web login (lib.rs)");
    }
    let c = t.clone().map(|s| CString::new(s).unwrap_or_default());
    line("harness", &format!("token handed in ({via})"));
    unsafe { ls::wmp_ls_token(c[0].as_ptr(), c[1].as_ptr(), c[2].as_ptr()) };
}

fn main() {
    LazyLock::force(&T0);
    let (mut cache, mut wav, mut fast, mut script) = ("target/harness-cache".to_owned(), "target/harness.wav".to_owned(), false, None);
    let (mut token, mut client_id, mut client_token, mut file) = (None, String::new(), String::new(), None);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut val = || args.next().unwrap_or_else(|| fail(&format!("{a} wants a value")));
        match a.as_str() {
            "--cache" => cache = val(),
            "--out" => wav = val(),
            "--fast" => fast = true,
            "--script" => script = Some(val()),
            "--token" => token = Some(val()),
            "--client-id" => client_id = val(),
            "--client-token" => client_token = val(),
            "--token-file" => file = Some(val()),
            "-h" | "--help" => {
                println!("{USAGE}");
                return;
            }
            _ => fail(&format!("unknown argument {a}")),
        }
    }
    let creds = match (file, token) {
        (Some(f), _) => Some((token_file(&f).unwrap_or_else(|e| fail(&e)), "--token-file")),
        (None, Some(t)) => Some(([t, client_id, client_token], "--token")),
        (None, None) => None,
    };
    let script: Vec<String> = match script {
        Some(p) => std::fs::read_to_string(&p).unwrap_or_else(|e| fail(&format!("{p}: {e}"))).lines().map(str::to_owned).collect(),
        None => vec![],
    };
    std::fs::create_dir_all(&cache).unwrap_or_else(|e| fail(&format!("{cache}: {e}")));
    let f = wav_file(&wav).unwrap_or_else(|e| fail(&format!("{wav}: {e}")));
    {
        let mut o = out();
        (o.wav, o.fast) = (Some(f), fast);
    }
    line("harness", &format!("cache {cache}, writing {wav}, {}", if fast { "fast (not paced)" } else { "real time" }));

    let (name, dir) = (CString::new("WMP Spotify (harness)").unwrap(), CString::new(cache.clone()).unwrap_or_else(|_| fail("bad --cache")));
    let started = unsafe { ls::wmp_ls_start(name.as_ptr(), std::ptr::null(), dir.as_ptr(), pcm, log, state, np, player, std::ptr::null_mut()) };
    if started != 0 {
        fail("wmp_ls_start refused");
    }
    let cached = std::path::Path::new(&cache).join("credentials.json").exists();
    match &creds {
        Some((t, via)) => give(t, via),
        // lib.rs: every connect waits for the web player's token (spclient takes it in place of login5's)
        None if cached => line("harness", "cached credentials, but the speaker connects only once a token comes: idling (give one with `token <file>`)"),
        None => line("harness", "no credentials (no credentials.json in the cache, no --token or --token-file): idling"),
    }

    let stdin = std::io::stdin().lock().lines().map_while(Result::ok);
    for l in script.into_iter().chain(stdin) {
        let l = l.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let (word, rest) = l.split_once(' ').map_or((l, ""), |(w, r)| (w, r.trim()));
        match word {
            "quit" => break,
            "mark" => line("mark", rest),
            "wait" => match rest.parse::<f64>() {
                Ok(s) if s >= 0.0 && s.is_finite() => {
                    line("cmd", l);
                    std::thread::sleep(Duration::from_secs_f64(s));
                }
                _ => line("harness", &format!("bad wait: {l}")),
            },
            "token" => match token_file(rest) {
                Ok(t) => give(&t, rest),
                Err(e) => line("harness", &e),
            },
            _ => {
                line("cmd", l);
                match CString::new(l) {
                    Ok(c) => unsafe { ls::wmp_ls_command(c.as_ptr()) },
                    Err(_) => line("harness", "a command with a NUL in it: dropped"),
                }
            }
        }
    }

    // the commands just sent are taken on librespot's own thread: half a second for them, and their log
    // lines, before the stop (which it may take first)
    std::thread::sleep(Duration::from_millis(500));
    ls::wmp_ls_stop();
    let up = UP.load(Relaxed);
    let kept = out().wav.take().is_some(); // the header is already current: nothing more to write
    let n = FRAMES.load(Relaxed);
    line("harness", &format!("quit: {n} frames ({:.1} s) in {wav}{}", n as f64 / RATE as f64, if kept { "" } else { " (writing had failed)" }));
    if up {
        std::thread::sleep(Duration::from_secs(2)); // Spirc's goodbye to Spotify, so the device leaves cleanly
    }
    std::process::exit(0);
}

fn fail(msg: &str) -> ! {
    eprintln!("harness: {msg}\n{USAGE}");
    std::process::exit(2);
}

#[cfg(test)]
mod tests {
    use super::*;

    // `cargo test --example harness` (the library's own tests run in it too)
    #[test]
    fn pcm_paces_like_the_app_and_keeps_the_wav_whole() {
        let path = std::env::temp_dir().join(format!("wmp-harness-{}.wav", std::process::id()));
        let path = path.to_str().unwrap();
        out().wav = Some(wav_file(path).unwrap());
        let packet = vec![0.5f32; 2048 * 2];
        let feed = |secs: f64| {
            let t = Instant::now();
            for _ in 0..(secs * RATE as f64 / 2048.0) as usize {
                pcm(std::ptr::null_mut(), packet.as_ptr(), 2048);
            }
            t.elapsed().as_secs_f64()
        };
        // real time: 2 s take 1.45 s, the first half second going ahead at once (into the app's player node)
        let e = feed(2.0);
        assert!((1.4..1.6).contains(&e), "{e}");
        // a stop drops what was queued: the next half second goes at once again
        pcm(std::ptr::null_mut(), std::ptr::null(), 0);
        assert!(feed(0.4) < 0.1);
        out().fast = true;
        assert!(feed(5.0) < 1.0);
        // the header current, the samples as the app converts them (0.5 × 32767, truncated)
        let n = FRAMES.load(Relaxed);
        let b = std::fs::read(&path).unwrap();
        assert_eq!((b.len() as u64, &b[..44]), (44 + n * 4, &header(n)[..]));
        assert_eq!(i16::from_le_bytes([b[44], b[45]]), 16383);
        std::fs::remove_file(path).unwrap();
    }
}

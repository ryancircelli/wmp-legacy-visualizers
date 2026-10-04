# loopback-rec

Records what the default render endpoint is playing (WASAPI loopback), or what one process tree is
playing (process loopback), to a WAV, so the Spotify desktop app's output can be measured on the
Windows box. One JSON line on stdout per run.

## Build (from WSL)

```sh
PATH=$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.local/mingw/usr/bin:$PATH \
  cargo build --offline --target x86_64-pc-windows-gnu --release
cp target/x86_64-pc-windows-gnu/release/loopback-rec.exe run.ps1 /mnt/c/Users/ryanr/AppData/Local/Temp/wmp-looprec/
```

`~/.local/mingw/usr/bin` supplies `x86_64-w64-mingw32-dlltool`, which the `windows` crate's raw-dylib
imports need. Crates are `wasapi` 0.24 and `windows` 0.62.2, the ones `tauri/` already uses.

## Run (from WSL)

The interop shell cannot see U:, so the exe runs from the C: copy, launched hidden by `run.ps1`
(UseShellExecute=false, CreateNoWindow; on timeout it kills only that PID's tree, then runs the tool
for zero seconds so a silenced run's saved state is restored):

```sh
D='C:\Users\ryanr\AppData\Local\Temp\wmp-looprec'
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$D\\run.ps1" \
  -ToolArgs "--out $D\\spotify.wav --seconds 10 --process Spotify.exe" -TimeoutSec 30
```

## Options

| option | |
|---|---|
| `--out <path.wav> --seconds <n>` | required. 32-bit float WAV (format tag 3) at the endpoint's mix rate and channel count (48 kHz stereo here). Gaps where nothing played are written as silence, so the file is `n` seconds long. |
| `--silent` | for the run only: save the endpoint's master volume and mute, mute it, restore both exactly afterwards |
| `--silent=zero` | as `--silent`, but master volume 0 with mute off (the experiment's second variant) |
| `--tone <hz> <dbfs> <s>` | plays a sine (peak `dbfs`) on the default endpoint from inside the tool, shared mode. Refused without `--silent`. |
| `--pid <pid>` / `--process <name.exe>` | process loopback (Windows 10 2004+) of that process and its children instead of the whole endpoint; `--process` picks the root of the tree of that name |

JSON: `frames, rate, channels, peak_dbfs, rms_dbfs, tone_dbfs` (the `--tone` frequency's strongest
50 ms block, as a sine peak), `device, volume_before, mute_before, silent, volume_after, mute_after`
(read back after the restore), `volume_range_db, hw_support` (1 = hardware volume, 2 = hardware mute),
`pid, out`. dBFS is `null` for digital silence.

Restore paths: normal end, any error (Drop guard), Ctrl-C/Ctrl-Break/console close (the handler
holds the process until the restore is done), and a hard kill (`<exe>.restore` holds the saved state
and the next run applies it first).

## Experiment result (2026-10-04, Surface Omnisonic Speakers (2- Surface High Definition Audio))

The endpoint was already muted by the owner (volume 0.19). It has hardware volume and mute
(`hw_support` 3, range -65.25..0 dB). Each run: `--tone <hz> <dbfs> 2`, record 3 s.

| tone played | endpoint loopback, muted | endpoint loopback, volume 0 | process loopback, muted |
|---|---|---|---|
| 1 kHz -20 dBFS | -9.66 | -9.66 | -9.71 (volume 0: -9.71) |
| 1 kHz -40 | -15.66 | | -15.73 |
| 1 kHz -6 | -0.12 | | |
| 100 Hz -20 | -7.49 | | -8.88 |
| 5 kHz -20 | -0.86 | | -3.80 |

- Loopback is taken **before** the endpoint mute and master volume: muted and volume 0 read the
  same, and full-level capture works while the PC is silent. `--silent` (mute) is enough, and the
  volume slider is never moved.
- It is **not** the app's untouched signal. The Surface's audio processing runs per stream before
  both tap points: a level-dependent AGC with makeup gain (+24 dB at -40 in, +6 dB at -6 in, the gain
  still rising after 2 s) and frequency-dependent gain. Process loopback has the same processing, so
  it isolates Spotify from other apps but does not bypass the processing. A level measured here is what
  the visualizer's own loopback (`tauri/src/audio/capture.rs`) receives, not what Spotify sends.
- Idle capture (nothing playing) is a valid all-zero WAV: 144000 frames for 3 s.

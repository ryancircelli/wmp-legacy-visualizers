> Written against the JavaScript engine the TypeScript one replaced: `src/60-bars.js`, `src/75-battery.js`
> and the like are now modules under `src/`. Paths under `spec/` and `re/` are in the private
> reverse-engineering archive and are not published.

# Exactness: port vs. the real objects

## Current record (2026-10-08): every family, every version, on music

The bar since 2026-10-07: every preset byte-identical to Microsoft's own object for **30,000 consecutive frames**,
on input made from sound: six real recordings (rock, electronic, classical, vocals, quiet piano, wide stereo;
public-domain and Creative Commons, analysed into TimedLevel frames), an 8.5-minute synthetic composition
(silence, pads, beats, chords, clicks, sweeps, noise bursts), digital silence, and streams with paused and stopped
blocks; at least two pinned clocks. Each object runs in-process in a host whose HKEY_CURRENT_USER is redirected to
a throwaway key, so no setting of the machine's is read or written. The output follows the sound on both sides
(silence and music differ on the same frames in the DLL and the port).

| Family (DLL) | What was run | Frames | Result |
|---|---|---|---|
| Alchemy (WMP 12 mpvis.dll) | 40 runs: all eight streams and the paused stream, four clock pins | 1,200,000 | identical (after one fix, below) |
| Alchemy WMP 9 / 10 / 11 (their own mpvis.dlls) | 12 runs: each version on synthetic and rock, two pins | 360,000 | identical |
| Bars and Waves (WMP 12 wmp.dll) | 108 runs: 4 presets, eight streams, sizes 517x389 to 1920x1080, two pins, a live clock | 3,132,000 | identical |
| Battery (WMP 12 wmp.dll) | 884 runs: 26 presets, eight streams, two pins, mono and stereo, a late preset switch | 26,520,000 | identical |
| Bars and Waves (WMP 7.0-10; WMP 11) | 52 runs: 8 older-version presets against every build that draws them, synthetic and rock; 4 runs: WMP 11 draws WMP 12's frames | 1,680,000 | identical |
| Battery (WMP 8, 8 SP1, 9, 10, 11) | 260 runs: 72 older-version presets against every build in their group, synthetic and rock, two pins | 7,800,000 | identical (WMP 8: see below) |
| Ambience (WMP 10 wmp.dll; 7.0-9 for its variants) | 148 runs: 14 presets + 10 older-version presets, music and synthetic, three resolutions | 2,420,400 | identical |
| Plenoptic (WMP 10; 7.1 and 8 SP1 for its variants) | 47 runs: all 16 presets against their own builds | 1,410,000 | identical |
| Spikes (WMP 7.0-10) | 72 runs (26 of 30,000 frames), every version, eleven window sizes | over 780,000 | identical |
| Particle (WMP 7.0-10) | 28 runs, every version, five window sizes | 840,000 | identical |
| Musical Colors (WMP 7.1, 8 SP1 wmpvis.dll) | all 21 presets on rock and synthetic (30,000) and four more recordings (4,000) | over 1,000,000 | engine identical on the DLL's own images (see below) |
| Blazing Colors, Color Cubes, Pulsing Colors, Trilogy I-III (Microsoft's downloadable packs, wmpvis.dll's engine) | all 21 presets: rock and synthetic 30,000 each, Trilogy's 30 fps clock, silence and play-state changes, 320x240 and 1280x1024 | over 1,300,000 | engine identical on the DLLs' own images |
| WMP's spectrum analyzer (WMP 9, 10, 11, 12 x64 and x86) | 63 runs per build: every byte of every snapshot, synthetic set and six recordings | 751,914 snapshots per build | identical |
| WMP's spectrum analyzer (WMP 7.0, 7.1 wmpui.dll; 8, 8 SP1 wmpcore.dll) | 63 runs per build, the same set, both spectrum layouts (Musical Colors gets the fixed-step one) | 751,914 snapshots per build | identical |

**The one bug the stricter bar found.** Alchemy's AtomBalls friction and drive were 0.80000000298 where the DLL
stores (double)(float)0.8 = 0x3fe99999a0000000. A ball's x drifts ~1e-6 and only moves a pixel when it lands on a
.5 rounding boundary: the synthetic composition never did, so the 2026-09 runs stayed exact; the rock recording
did at frame 2211 and a paused stream at 17639. Fixed in fc624e7, then all 40 runs identical.

**Older versions.** Where an older WMP draws differently on the same input, it is a preset of its own, proven
against that build ("Particle (WMP 7-8)", "Vox (WMP 7)", "Random (WMP 9)"). Alchemy's WMP 9, 10 and 11 are presets of their own ("Random
(WMP 9)" draws its DLL's fixed 384x288 surface). Bars and Waves' WMP 7 to 10 keep
two sums at the x87's 53 bits and index the scope without a clamp, and show Bars and Scope in each player's Now
Playing colours (WMP 7 and 8 set none, so the DLL's own); WMP 11 draws WMP 12's frames. Battery's WMP 8, 9, 10 and
11 differ in their matrix summation orders, their x87 or msvcrt trig, and WMP 8's palette fade (no guard for a
0-frame fade): 72 presets, one per base preset and group of builds that draw the same frames, named for the
group ("brightsphere (WMP 9-10)").

Two limits, both measured. **WMP 8 reads memory it never set**: Battery's dot-plane grid is not initialised in WMP 8
(WMP 9 does), so on the presets that use it WMP 8's own output changes from run to run with whatever the heap held;
the port matches WMP 8 run on a zeroed heap, where both WMP 8 builds repeat exactly. **The FPU is not correctly
rounded**: a Battery stroke's first point lands exactly on an integer pixel, decided by FPATAN and FSIN/FCOS, which
the processor rounds its own way; the port models them and corrects the 134 starting offsets (47 for WMP 11, through
msvcrt) where the model and an i7-11370H disagree, measured over every integer offset in a 640x480 window. On
another processor the DLL itself may round those differently.

**No Microsoft data in this repo.** Every table and palette an engine needs (Bars and Waves' fast-log tables,
ucrtbase's atan and 2/π tables, Battery's stored palettes, Ambience's colour sets) is generated by our own code,
tested against hashes of the original bytes (all 17 of Battery's stored palettes, each a gradient or a chain of
fades between gradients). The FPU corrections above are our own measurements of the processor, not data from a DLL. Musical Colors' artwork (42 images, many hand-drawn and dithered) can
only be approximated: the public build draws our own recreation (most images within 2 levels on 99% of their
values; Star Power's background palette is our own design), and its engine is proven exact privately on the DLL's
images.

**Pacing and input.** The app calls Render on WMP's own schedule (at most ~30 a second, the same timer formula in
WMP 7-12) and feeds each call the snapshot WMP's analyzer would have made, with WMP's timestamps: the analyzer of
the WMP the preset draws (four arithmetics: WMP 7.0-8 SP1, 9-10, 11, 12), in the layout it asks for (Musical
Colors, alone, the fixed-step one).

## Bubbles (2026-10-15): the Psychedelia Viz Pack, Direct3D 9

Bubbles.dll (the Psychedelia Viz Pack, 2007, Tim Cowley and Stephen Coy, for WMP 11) draws with Direct3D 9 and an HLSL
effect D3DX 9 compiles when the device is made. The ground truth renders it on Microsoft's software reference device
(Windows' own `d3dref9.dll`, the Graphics Tools' 10.0.19041.685, which d3d9.dll binds `D3DDEVTYPE_REF` to), so the
pixels are deterministic and the GPU never takes part; the port draws through `src/d3d9/`, our reproduction of that
device. D3DX runs on its portable x87 path (`DisableD3DXPSGP`, set in the host's registry sandbox), and the DLL's
math runs at the 24-bit x87 precision Direct3D 9 leaves the thread in. Bubbles reads no clock; its randomness is the
C runtime's `rand()`, seeded by `time()` when its device is made, so the two pins are two seeds. The textures are the
DLL's own for these runs (the public build draws our own artwork). Every run is 320x240 unless marked.

| Preset | Streams | Seeds | Frames | Result |
|---|---|---|---|---|
| Random | the composition, rock (both seeds each); electronic at 240x320 | 2 | 150,000 | identical |
| Centered | the composition, rock (both seeds each); electronic at 240x320 | 2 | 150,000 | identical |
| Gravity | the composition, rock (both seeds each); electronic at 240x320 | 2 | 150,000 | identical |
| Pop | the composition, rock (both seeds each); electronic at 240x320 | 2 | 150,000 | identical |
| Pop, then Centered at 3,000, then Random at 5,000 | rock | 1 | 8,000 | identical |
| Gravity, then Pop at 2,500, then Gravity at 6,000 | the composition | 1 | 8,000 | identical |

The sound drives it on both sides: Gravity sizes each bubble by its own frequency band, Centered pulses the cover
bubble with the level, Pop pops a bubble on each detected beat. Ten of the twenty long runs were captured twice:
the first captures ran six at a time sharing one registry sandbox, and a run that recreated the sandbox while
another's D3DX read `DisableD3DXPSGP` sent that one down D3DX's CPU-specific math (and a sleeping display lost some
runs' devices); captured again, each in a sandbox of its own, all ten are identical.

The cover bubble shows the song's art here; the DLL loads the album's Folder.jpg through Windows' imaging codecs,
which a browser's decoder cannot reproduce, so the art's own pixels are outside the comparison.

## Ribbons (2026-10-31): the Psychedelia Viz Pack, Direct3D 9

RibbonsVis.dll runs on the same ground truth as Bubbles (Windows' reference device, D3DX 9 on its x87 path, the DLL's
math at 24-bit x87 precision). It reads no clock; `rand()` is seeded by `time()`, pinned by the host. The runs use
the DLL's own texture and noise permutation (the public build draws our own texture and its own shuffle of the
noise table). The reference device does not clear a new render target: Ribbons' feedback target starts with what the
heap held, which shows in the first frame's corners and lingers through the fade. The host zero-fills each new
render-target texture before the DLL draws (outside the recording), as the port's targets start; with that, every run
below is identical.

| Preset | Streams | Frames | Result |
|---|---|---|---|
| Random | rock, a long stream | 60,000 | identical |
| Mystify | rock, a long stream; electronic at 239x317 | 90,000 | identical |
| Ribbons | rock, a long stream | 60,000 | identical |
| Dense | rock, a long stream | 60,000 | identical |
| Embossed | rock, a long stream; electronic at 239x317 | 90,000 | identical |
| More Embossed | rock, a long stream | 60,000 | identical |

Rock and electronic run with the clock pinned at 100,000 ms (seed 1058270499), the long stream at 50,000,000 ms
(seed 1058320399); 320x240 unless marked. D3DX's vector normalize reads a 512-entry reciprocal square root table with no
Newton step; the table is the secant of 1/sqrt through each segment's ends rounded to float, the same in d3dx9_28, 29
and 31.

## Goom (2026-10-13): What a GOOM! 2k4's plug-in for WMP 9

Goom is not Microsoft's: iOS Software's LGPL visualizer, whose installer (archived by the Wayback Machine from the
authors' own site, 2004) carries `wmp9_goom.dll`. It was ported from that binary alone, by decompile and A/B, like
the Microsoft families; no source of Goom's was read. The DLL renders goom at the preset's size whatever the window
(its four presets are the resolutions), from the first 512 waveform bytes of each channel and the play state; its
only randomness is its own C runtime's `rand()` and a table it fills after one `srand()` given the heap address of
its first pixel buffer, which the harness replaces with a pin. No clock is read (the fps counter, off by default
here, is the one exception). The harness runs the DLL's own per-frame steps at each preset's size and hashes goom's
output buffer; at 320x240 that is the same image IWMPEffects::Render draws. The output follows the sound on both
sides: the composition opens with silence, and the DLL's frames on it are the silent stream's for the first 198
frames and differ from there on, as the port's do.

| Preset | Stream | Pin | Frames | Result |
|---|---|---|---|---|
| 0 (320x240) | the 8.5-minute composition | 1 | 30,000 | identical |
| 0 | the paused and stopped stream: both idle credits roll, in the DLL's own font | 2 | 30,000 | identical |
| 0 | rock | 3 | 30,000 | identical |
| 0 | rock with a song title (MediaInfo at frame 5), in the DLL's own font | 7 | 400 | identical |
| 0 | silence | 1 | 3,000 | identical |
| 1 (480x360) | the composition | 1 | 30,000 | identical |
| 1 | electronic | 4 | 30,000 | identical |
| 2 (600x480, titled "640x480") | the composition | 1 | 30,000 | identical |
| 2 | classical | 5 | 30,000 | identical |
| 3 (800x600) | the composition | 1 | 30,000 | identical |
| 3 | vocals | 6 | 30,000 | identical |
| 0, then 3 from frame 3,000 | rock | 9 | 8,000 | identical |
| 2, then 1 from frame 2,500 | electronic | 10 | 8,000 | identical |

Every effect of the engine ran in these streams: all ten zoom modes (plus noise, the wave and hypercos warps and
the plane effects), all eight effect states, the IFS fractal, the points, the 3D tentacles, the particle bursts,
the scope lines in all three shapes, and (on the paused stream) both idle credits that roll up when playback
stops, drawn in the DLL's own font from the DLL file itself; a song title (MediaInfo) was checked the same way.

**Text needs the user's DLL.** The font is an image inside the DLL and the credits are its text, so neither is in
this repository: `Alchemy.Goom` draws text only when given a copy of `wmp9_goom.dll` (`options.dll`); without one
the engine runs the same but draws no text.

**One CPU path.** On AMD processors (which report "extended MMX") the DLL takes a different zoom routine that also
blanks the source's corner pixels and interpolates with an unsigned multiply, so the original drew slightly
differently there. It ends in a 3DNow! instruction and cannot run on the Intel machine the harness uses; the port is
the MMX path every Intel processor (and the harness) runs.

## History: the first runs (2026-09)

**Totals (30 000-frame `frames_long30k.bin`, 2026-09-24, build 9a944f4+):** Alchemy 3 seeds, 90 000/90 000 frames identical; Bars and Waves 4 presets, 120 000/120 000 identical; Battery 26 presets at 1700000000 + 4 at 1234567890, 900 000/900 000 frames fully identical (index surface, `rand()` count and every palette block). All three visualizers are byte-exact against the real objects for 30 000 frames.

**Re-run on the TypeScript engine (branch react-ts, `dist/engine.js` built by Vite/esbuild, minified; 2026-09-25):** the
identical 37 runs — Alchemy 3 seeds × 30 000 frames EXACT, Bars and Waves 4 presets × 30 000 identical, Battery 26
presets at 1700000000 + presets 0/4/9/20 at 1234567890 × 30 000 identical. The port wrapped the numerics 1:1; the
A/B drivers load `dist/engine.js`.

The harness (the hosts that load the real DLLs, the A/B drivers, the test streams) lives in the private
reverse-engineering archive since 2026-10-07; this repo keeps the results. "The host" below is the real
object hosted in-process with its clock and `rand()` hooked; "the twin" is the port rendering the same input.

Every Alchemy and Bars row compares the **per-frame FNV-1a hash of the whole RGB surface and the per-frame `rand()`
count** (Battery: see below), every frame, between the real object (the host, IAT-hooked `_time64` / `_o_srand` /
`_o_rand`, so the run is deterministic) and the port on the same frames. "identical N/N" means
every frame's hash and draw count matched.

| visualizer / preset | size | seeds (pinned `_time64`) | frames compared | result |
|---|---|---|---|---|
| Alchemy (mpvis.DLL) | 640x480 | 1700000000 | 30 000 (`frames_long30k.bin`) | **identical 30000/30000** |
| Alchemy | 640x480 | 1234567890 | 30 000 | **identical 30000/30000** |
| Alchemy | 640x480 | 1555000777 | 30 000 | **identical 30000/30000** |
| Bars and Waves 0 `Bars` | 354x345 | n/a (no srand; CRT seed 1) | 30 000 (`frames_long30k.bin`) | **identical 30000/30000** |
| Bars and Waves 1 `Ocean Mist` | 354x345 | n/a | 30 000 | **identical 30000/30000** |
| Bars and Waves 2 `Fire Storm` | 354x345 | n/a | 30 000 | **identical 30000/30000** |
| Bars and Waves 3 `Scope` | 354x345 | n/a | 30 000 | **identical 30000/30000** |
| Bars and Waves 0-3 (extra) | 640x480 | n/a | 3 000 each | identical 3000/3000 each |
| Bars and Waves 2, 3 (extra: W > 1024 scope branch) | 1100x200 | n/a | 3 000 each | identical 3000/3000 each |
| Battery 0 `Randomization` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 1 `brightsphere` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 2 `dance of the freaky circles` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 3 `cominatcha` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 4 `cottonstar` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 5 `dandelionaid` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 6 `drinkdeep` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 7 `eletriarnation` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 8 `event horizon` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 9 `hizodge` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 10 `gemstonematrix` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 11 `sepiaswirl` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 12 `illuminator` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 13 `i see the truth` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 14 `kaleidovision` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 15 `chemicalnova` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 16 `lotus` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 17 `green is not your enemy` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 18 `relatively calm` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 19 `sleepyspray` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 20 `smoke or water?` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 21 `spider's last moment...` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 22 `strawberryaid` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 23 `the world` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** (after 9a944f4; 792 palette-only frames before it) |
| Battery 24 `my tornado is resting` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 25 `back to the groove` | 384x288 | 1700000000 | 30 000 | **identical 30000/30000** |
| Battery 0 `Randomization` | 384x288 | 1234567890 | 30 000 | **identical 30000/30000** |
| Battery 4 `cottonstar` | 384x288 | 1234567890 | 30 000 | **identical 30000/30000** |
| Battery 9 `hizodge` | 384x288 | 1234567890 | 30 000 | **identical 30000/30000** |
| Battery 20 `smoke or water?` | 384x288 | 1234567890 | 30 000 | **identical 30000/30000** |

Measured 2026-09-24. Alchemy was run twice on the port side: once against the tree as it stood when
the runs started, and again against the tree after the parallel `ucrtbase` sin/cos clones landed in
`src/00-rand.js` / `20`-`50` (same saved real-object hashes). Both identical.

## Battery: what is compared, and the one divergence (fixed)

Battery rows compare, every frame, the FNV-1a of the 384x288 8-bit FRONT surface (`ihash`), the
`rand()` count, and the whole palette control block including FNV hashes of the FROM / LIVE / TO
palettes (the host's and the twin's palette logs). They do not compare the 640x480 DIB hash: that
image is GDI's `STRETCH_DELETESCANS` row/column pick plus the DLL's one-frame palette display lag
(spec `battery/10` §2.3, §5), host blit behaviour, and is fully determined by FRONT + LIVE.
Calling `MediaInfo(2, …)` as WMP does and not calling it give the same result.

**The divergence (fixed in 9a944f4):** before the fix the 14 presets without their own palette
(1 2 3 4 6 8 11 12 13 14 16 17 19 23) all diverged on the same auto-cycled palette: at pinned
1700000000 the `newPalette` call at frame 20027 (20105 for the presets whose countdown runs 78
frames later) draws r1=2240, r2=32337, r3=20049, i.e. 11 ascending keys, and two keys have equal
luminance 457: (94,226,137) and (100,177,180). The port sorted keys with a neighbour-swap bubble
sort; the DLL (`0x180412960`-`9a8`) is an exchange sort against the pass anchor — pass i compares
every later key j against key i and swaps them, strict compare either direction. Equal sums end
up in a different order, so TO entries 126-199 differed (74 entries) and LIVE faded toward the
wrong colours until the next palette at +792 frames. Index surface and `rand()` stream never
differed. `src/75-battery.js` `newPalette` now uses the exchange sort; `tests/battery.test.js`
pins the tie order with a scripted `rand()`; all 26 presets were re-run at 30 000 frames on the
fixed build and are identical.

## The input: `frames_long30k.bin`

Made by the harness's composition script (md5 of the .bin
`fa40e9c96a670c3c5e416c3061852eff`; ~3.5 min on 8 cores). A deterministic 502 s stereo composition
(`random.seed(7)`) that cycles digital silence (2-6 s) → quiet pad (about -40 dB) → kick+hat beat →
sustained three-note chord → sparse clicks over near-silence → 40 Hz-8 kHz log sweep → noise bursts
→ fast beat → fade-out, 6-22 s per section, a new key/tempo/pan every section. Analysed exactly as
`gen_frames.py wav` as it was then (Blackman FFT → AnalyserNode bytes; it now uses WMP's own analyzer, as the
app does), 60 fps, so 30 000 frames = 8 min 20 s,
several full Alchemy scheduler cycles including quiet → loud transitions and full silence.

## Reproduce

The private harness (`tools/ab.py` in the reverse-engineering archive) runs any row: the host and the twin
on the same frames, preset, pinned clock and size, every frame's hash compared, one verdict line per run.
The host calls `MediaInfo(2, 44100, "")` before the first Render, as WMP does (without it the bare object
stays mono: 50 `rand()` per frame instead of 100). The Bars and Waves twin renders the host's all-zero
probe frame first and restores the DLL's own preset-0 colour literals (the port ships the WMP-skin colours
by design).

## What it took for Bars and Waves (all fixed in `src/60-bars.js`)

The first byte-for-byte run failed on every frame. Causes, each from the wmp.dll listing:

1. **The louder channel wins, not the quieter** — `0x18041d482 cmp edi,r15d` / `0x18041d48b cmovle`.
2. **The peak-cap test**: `DrawPeakCap` gets `DrawLevelBar`'s return unchanged
   (`0x18041d515`/`0x18041d526`) and uses `max(drawn,1)` as a *skip* test
   (`0x18041dca8..0x18041dcbc`, `0x18041dd36`, `0x18041dd65`); a cap equal to the level overwrites
   the bar's top row. The port pushed the cap to `drawn+1` instead (same look, different pixels,
   and a stray cap row on silent frames). Trail mode: invalidation before the terminator test.
3. **Fast-log tables**: `T_lin`, `T_mant`, `T_exp` need the DLL's exact bytes, which the port generates:
   T_lin is 10^(8v/255) as a float printed to 7 digits (ties up) and read back, T_mant/T_exp the
   analyzer's fast 31.875*log10 tables (`tests/recreated-tables.test.ts`). `ReduceSpectrum` is all
   float32 (`0x18041d007..0x18041d039`); the port summed in double.
4. **Band edges use 1102.5, not 1100** (the double at `0x18088c548`) — bands end at 22 050 Hz.
5. **`lastTimeStamp` starts at 0** (`0x18041cb76`), so a first Render at timeStamp 0 is a skip frame.
6. **Rects normalise their corners** (`0x18044b160`): the last of the 1024-line bars has x2 < x and
   still paints column W-1.
7. **The scope's line is not the symmetric Bresenham** (`0x18044a7a0`): left-to-right, err = -major,
   minor step when `2*minor + err >= 1`, and a line with an off-surface endpoint is rejected whole.

The `rand()` stream needed nothing: Bars never calls `srand` (host log `srand(seed)=-1`), draws only
the ±10 px jitter, and the port already consumed it in the same order.

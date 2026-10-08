> Written against the JavaScript engine the TypeScript one replaced: `src/60-bars.js`, `src/75-battery.js`
> and the like are now modules under `src/engine/`. Paths under `spec/` and `re/` are in the private
> reverse-engineering archive and are not published.

# Exactness: port vs. the real objects

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
   analyzer's fast 31.875*log10 tables (`tests/engine/recreated-tables.test.ts`). `ReduceSpectrum` is all
   float32 (`0x18041d007..0x18041d039`); the port summed in double.
4. **Band edges use 1102.5, not 1100** (the double at `0x18088c548`) — bands end at 22 050 Hz.
5. **`lastTimeStamp` starts at 0** (`0x18041cb76`), so a first Render at timeStamp 0 is a skip frame.
6. **Rects normalise their corners** (`0x18044b160`): the last of the 1024-line bars has x2 < x and
   still paints column W-1.
7. **The scope's line is not the symmetric Bresenham** (`0x18044a7a0`): left-to-right, err = -major,
   minor step when `2*minor + err >= 1`, and a line with an off-surface endpoint is rejected whole.

The `rand()` stream needed nothing: Bars never calls `srand` (host log `srand(seed)=-1`), draws only
the ±10 px jitter, and the port already consumed it in the same order.

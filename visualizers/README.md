# wmp-legacy-visualizers

Every visualizer Windows Media Player shipped, from WMP 7 to today's: **Alchemy**, **Ambience**,
**Bars and Waves**, **Battery**, **Musical Colors**, **Particle**, **Plenoptic**, **Spikes**, **3D Alchemy**,
**Picture Viz**, **Yule Log** and the rest of the families, reverse-engineered from Ghidra decompiles and
ported instruction for instruction to TypeScript (with a few WebAssembly kernels). One plug-in that was not
Microsoft's is here too, ported the same way from its binary alone: **Goom**, iOS Software's What a GOOM! 2k4 for
Windows Media Player 9 (LGPL). Where an older version drew
differently, it is a preset of its own ("Vox (WMP 7)", "Particle (WMP 7-8)"). The sound reaches them through
WMP's own spectrum analyzer, ported byte for byte, at WMP's own pace.

The engine has no runtime dependencies and knows nothing about any player: it takes a canvas and a
`TimedLevel` (WMP's own frequency and waveform bytes) and draws. It is the package the
[player](../app/README.md) in this repository is built on, and it is usable on its own: copy this folder, or
install it as a workspace of any npm project.

Fidelity was not eyeballed. Each visualizer was hosted in-process with Microsoft's own DLLs behind an
IAT-hooked, pinned clock and compared frame by frame against the port: every one is byte-identical to the real
object for 30,000 consecutive frames. See [Fidelity](#fidelity) below.

## Using it

The package's `exports` point at the TypeScript sources, so a bundler that compiles TypeScript (Vite, esbuild,
webpack with a TS loader, or `tsx`/Vitest on Node) takes it as it is. For a plain `<script>`, `npm run build` writes
`dist/engine.js` (a classic IIFE that sets `window.Alchemy`, the low-level namespace the exactness harness drives).

```ts
import { createEngine, makeLevel, PRESETS } from 'wmp-legacy-visualizers';
import { CATALOG } from 'wmp-legacy-visualizers/catalog';          // PRESETS by family and WMP version, for a menu
import { createPcmSource } from 'wmp-legacy-visualizers/audio/pcm'; // PCM -> TimedLevel through WMP's analyzer

// PRESETS is WMP's own flat list: { vis, preset, group, name, key }. Pick one and bind it to a canvas.
const p = PRESETS.find((e) => e.name === 'Bars')!;
const canvas = document.querySelector('canvas')!;
const eng = createEngine(p.vis, canvas, { preset: p.preset, scale: 'auto' });

// A TimedLevel is one Render() call's audio: freq and wave, 1024 bytes per channel, a state (2 = playing)
// and a timestamp. makeLevel() is digital silence; the producers below fill it from real sound.
const level = makeLevel();
const pcm = createPcmSource(48000);          // interleaved stereo float32 in, e.g. from an AudioWorklet or a socket
pcm.setBuild('wmp12');                       // whose arithmetic: the WMP the preset on screen comes from

function frame() {
  pcm.fill(level);                           // freq, wave and timeStamp of the newest 1/30 s snapshot
  level.state = 2;
  eng.render(level);                         // one WMP Render() call
  eng.present();                             // paint it, stretched to the canvas
  requestAnimationFrame(frame);
}
frame();
// elsewhere, as sound arrives: pcm.push(float32Interleaved)
```

- **`createEngine(kind, canvas, { preset, scale, options })`** returns a `VisEngine`: `render(level)`,
  `present()`, `resize()`, `setPreset(n)`, `setScale()`, live `options` (`intended`, `fps`, `backgroundColor`,
  `alpha: 'luma'` plus `tint` to draw over whatever is under the canvas). It presents with WebGL2 when there
  is one and a 2D canvas otherwise. `scale: 'original'` is each DLL's own surface size.
- **`PRESETS` / `CATALOG`** list every preset in WMP's order, and regrouped by family and the WMP versions
  that drew each one.
- **Feeding it.** A `TimedLevel` can come from anywhere. The package ships three producers, all running
  WMP's analyzer (`audio/wmp.ts`, bit-exact against WMP 7 to 12's, selected by `setBuild`): `audio/pcm`
  (interleaved float32 PCM, hop-aligned the way WMP's host feeds it), `audio/analyser` (a Web Audio graph:
  connect any source to its `input` node), and `WmpAnalyzer` in `audio/wmp` for 16-bit samples when you want
  the snapshots yourself. Your own spectrum works too, if you do not need WMP's exact bytes.

## Develop

```sh
npm install        # from the repository root or from this folder
npm run typecheck  # tsc -b
npm test           # vitest: unit tests and a short slice of the golden guard
npm run test:golden   # the golden guard in full (GOLDEN=full): 45 runs against the recorded, verified output
npm run build      # dist/engine.js
npm run build:wasm # after editing assembly/*.ts (AssemblyScript): regenerates the src/**/*-wasm.ts modules,
                   # which npm test checks are current
```

| Path | Contents |
|---|---|
| `src/` | The port itself: one module per DLL subsystem, `index.ts` the public surface, `audio/` the front end |
| `assembly/`, `tools/build-wasm.mjs` | The AssemblyScript kernels and the script that compiles them into committed base64 modules |
| `tests/` | Vitest unit tests, `golden/` (hash-per-frame guard) and its fixtures |
| `docs/EXACTNESS.md` | The frame-by-frame comparison record: per-preset table, input, and the fixes it took |

## Fidelity

Every visualizer is byte-identical to the real Microsoft object for 30,000 consecutive frames
(8 min 20 s at 60 fps), on every seed and preset measured:

| Visualizer | Runs | Frames compared | Result |
|---|---|---|---|
| Alchemy (WMP 12 `mpvis.dll`, 640x480) | 40: six music recordings, two synthetic, silence, a paused stream; four clock pins | 1,200,000 | identical |
| Alchemy, WMP 9 / 10 / 11 presets (their own `mpvis.dll`s) | 12: each version on synthetic and rock, two pins | 360,000 | identical |
| Bars and Waves (WMP 12 `wmp.dll`) | 108: all 4 presets, eight streams, four window sizes, two pins | 3,132,000 | identical |
| Battery (WMP 12 `wmp.dll`, 384x288) | 884: all 26 presets, eight streams (six music recordings), two pins, mono and stereo, and a late preset switch | 26,520,000 | identical |
| Bars and Waves, WMP 7 to 11 (their own `wmpui.dll`s and `wmp.dll`s) | 56: the 8 older-version presets against every build that draws them (WMP 7, 7.1, 8, 8 SP1, 9, 10) on synthetic and rock, and WMP 11's four base presets (it draws WMP 12's frames) | 1,680,000 | identical |
| Battery, WMP 8 to 11 (their own DLLs) | 260: the 72 older-version presets against every build in their group (WMP 8, 8 SP1, 9, 10, 11) on synthetic and rock, two pins | 7,800,000 | identical |
| Ambience (WMP 10 `wmp.dll`, 256x192) | 148: all 14 presets and the 10 older-version ones, music and synthetic, three resolutions | 2,420,400 | identical |
| Plenoptic (WMP 10 `wmp.dll`, 256x192) | 47 of 30,000 frames: all 16 presets (7, plus 9 WMP 7 / 8 ones) against their own builds on music, synthetic and paused streams | 1,410,000 | identical |
| Spikes (WMP 7-10) | 72 (26 of 30,000 frames): both presets, every version, eleven window sizes | over 780,000 | identical |
| Particle (WMP 7-10) | 28: all 4 presets, every version, five window sizes | 840,000 | identical |
| Musical Colors (WMP 7-8 `wmpvis.dll`) | all 21 presets on music and synthetic streams; its engine on the DLL's own images (the shipped build draws our own recreation of its artwork, within 2 levels for 99% of most images' values) | over 1,000,000 | identical engine |
| Blazing Colors, Color Cubes, Pulsing Colors (Microsoft's 2000 downloads), Trilogy I, II, III (Windows Media Bonus Pack for XP) | all 21 presets on rock and synthetic streams (30,000 each), plus silence, play-state changes, two more sizes and Trilogy's own clock; the engine on the DLLs' own images (the shipped build draws our recreation of their artwork: 82 of 99 images byte-identical, Color Cubes' Sheer Delight palette our own design) | over 1,300,000 | identical engine |
| Goom (iOS Software's `wmp9_goom.dll` for WMP 9, all 4 presets: goom's resolutions 320x240 to 800x600) | 11 of up to 30,000 frames: every preset on the synthetic composition and on a recording (rock, electronic, classical, vocals), the paused stream with its idle credits, silence, a song title, two preset switches; seven pins (its random table's seed) | over 320,000 | identical |
| WMP's spectrum analyzer (WMP 9-12) | 63 per build: every byte of every snapshot, six recordings and a synthetic set | 751,914 snapshots per build | identical |
| WMP's spectrum analyzer (WMP 7.0, 7.1, 8, 8 SP1) | 63 per build, the same set: every byte of every snapshot, both spectrum layouts | 751,914 snapshots per build | identical |

Measured on 2026-09-24 and re-run on the TypeScript engine on 2026-09-25 with the same result.
[`docs/EXACTNESS.md`](docs/EXACTNESS.md) has the per-preset table, the input, and the fixes it took.

- **How.** A private harness hosts the real DLL in-process and hooks its `_time64`, `srand` and
  `rand` imports, so the clock is pinned and the random stream is known. Both sides get the same
  30,000 frames of a synthetic track (silence, quiet pads, beats, chords, sweeps, noise bursts).
  Every frame's FNV-1a hash of the whole surface and its `rand()` count must match.
- **Coverage.** Alchemy's effects are chosen at random, so the harness records every effect,
  warp kernel and parameter branch a run exercises. Shorter runs over many more seeds reached every
  reachable combination but one rare cell. They matched too, once the runtime clones below closed a
  single one-pixel difference.
- **The C runtime is cloned.** `sin`, `cos` and `atan2` are operation-for-operation copies of
  `ucrtbase`'s own, because `Math.*` rounds differently often enough to change pixels. They match
  the DLL on CPUs with FMA3, which is every x64 CPU since about 2013.
- **Guarded since.** Any faster engine code must match the verified engine frame for frame:
  `npm run test:golden` renders 45 runs across all three visualizers, seeds, presets and sizes and
  compares each frame's hash with the recorded output of the engine as verified; `npm test` runs a
  short slice of it. Every run goes three times: on WebAssembly (the SIMD passes, Bars and
  Waves' drawing and the `sin`/`cos`/`atan2` clones), on the JavaScript that stays as the fallback,
  and switching between the two mid-run. The
  2026-09-28 speedups (Alchemy about 20%, Battery 16 to 37%, the heavier Bars and Waves presets
  about 18% per frame) passed it byte for byte.
- **What is not compared.** Battery's final stretch to the window is GDI's, not the DLL's, so its
  runs compare the 8-bit image and the whole palette state instead. Bars and Waves ships the colours
  WMP's skin shows. The runs restore the DLL's own preset colours.

## How it was made

1. **Decompile.** Ghidra against `mpvis.DLL` (Alchemy) and `wmp.dll` (Bars and Waves, Battery):
   listings, function maps, and the tables (palettes, presets, parameters) each engine reads.
2. **Spec.** Every decompiled subsystem got a written spec before any code: the resampler and
   shift container, the warp kernels, the draw effects, the scheduler and audio pipeline, and a
   verification log that records every exactness result and every residual as it was found.
3. **Port.** Each spec became a module under `src/` (TypeScript, wrapped 1:1), keeping
   the DLL's own integer truncation, fixed-point shifts, and literal constants rather than
   "fixing" them to cleaner math.
4. **Verify.** The private harness drives the real object and the port from the same input at the
   same pinned time. Any mismatch was chased back through the disassembly rather than patched away
   statistically.

The decompiles, specs and the verification harness (the hosts that load Microsoft's DLLs, the A/B
runners, the test streams) are not published: this repo holds only our own port and tests of its own
output. Comments that cite paths under `re/` or `spec/` point into that private archive.

## Still to port

Microsoft also published visualizations outside the player, in the Plus! packs, the Windows Media Bonus Packs,
the Fun Packs and its online gallery. These are the ones not yet in the player:

| Visualization | Where it shipped | Presets | Status |
|---|---|---|---|
| Kid Drawing, Shacojin | WMP 7 Bonus Pack (2000) | 2, 4 | not planned |
| Winter (Ice Storm), Energy Bliss, Softie the Snowman II, Rhythm and Waves | Winter Fun Packs, Microsoft's gallery | 1 each | not planned (Direct3D; would be matched against Microsoft's software renderer) |
| Grind, T3, Looney Tunes | Microsoft's gallery | 1 each | not planned (Direct3D; would need our own artwork in place of the film stills) |

Done since this list began: 3D Alchemy, Picture Viz, Picture Viz II, Picture Viz 3D, Yule Log, Blazing Colors, Color Cubes, Pulsing
Colors, Trilogy I-III, Eclectic Colors, StarTime, SnowTime, Dungeon Siege (our own artwork), Plus! 3-D (our own
artwork) and Goom (the WMP 9 plug-in, LGPL).

Not found yet: "Thanks" and "Chinese New Year 2005" from Microsoft's gallery.

**Missing one?** If you know of a visualization Microsoft shipped for Windows Media Player that is neither
ported above nor on this list, please [open an issue](https://github.com/ryancircelli/wmp-legacy-visualizers/issues/new)
with its name and where it came from (a pack, a download page, a CD). Please don't attach or link any files:
the name and source are all that's needed.

## Goom's licence

Goom (`src/goom/`) reproduces "What a GOOM! 2k4", the Windows Media Player 9 plug-in by iOS Software, which its
authors released under the GNU LGPL. That directory is therefore under the LGPL, version 2.1 (`src/goom/LICENSE`);
nothing else in this package is. Like every port here it was written from the plug-in's binary, not from goom's
source code.

## A note on the source material

Windows Media Player's visualizers are Microsoft's. This repository contains only independently
written code that reproduces their behaviour. It includes no original DLL, no decompiled source and
no extracted binary resource, and neither does any release. No table or image is copied from a DLL either: every table,
palette and colour set an engine needs is generated by our own code (checked against hashes of the
originals in the private harness), and Musical Colors draws our own recreation of its artwork.

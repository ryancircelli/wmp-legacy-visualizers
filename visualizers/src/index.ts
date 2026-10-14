// Public surface of the visualizer engines (ARCHITECTURE.md "Engine"). Everything outside src
// imports from here (or from ./audio/*). The engines themselves are the wrapped DLL ports; this file
// only adds what the old shell (src/90-shell.js) did around them: engine choice, the native-size and
// scale rules, the 0x00RRGGBB -> RGBA blit, and presenting onto a canvas.
import { A, type Surface, type TimedLevel } from './ns';
import { glPresenter, type Sampling } from './gl';
import './rand';
import './effect';
import './kernels';
import './shift';
import './draw';
import './alchemy';
import './bars';
import './battery/index';
import './spikes/index';
import './particle/index';
import './plenoptic/index';
import './ambience/index';
import './musical/index';
import './musical/plus';
import './musical/bonus';
import './alchemy3d/index';
import './pictureviz/index';
import './pictureviz/pv2/index';
import './pictureviz/pv3/index';
import type { Picture } from './pictureviz/picture';
import './yule/index';
import './averett/index';
import './goom/index';
import './googly/index';
import './corona/index';
import './pixeltrip/index';
import './plus3d/index';
import './animator/index';
import './blackfly/ripple';
import './blackfly/clarify';
import './betterbars/index';
import { RefDevice } from './d3d8/ref';

export { A };
export type { Surface, TimedLevel, Picture };
export { pictureFromRGBA, loadPicture } from './pictureviz/picture';

export type VisKind = 'alchemy' | 'bars' | 'battery' | 'spikes' | 'particle' | 'plenoptic' | 'ambience' | 'musical'
  | 'blazing' | 'colorcubes' | 'pulsing' | 'trilogy1' | 'trilogy2' | 'trilogy3' | 'dungeon' | 'snowtime' | 'startime' | 'eclectic' | 'alchemy3d' | 'pictureviz' | 'pictureviz2' | 'pictureviz3' | 'yule'
  | 'goom' | 'plus3d' | 'wm9s' | 'googly' | 'corona' | 'ripple' | 'betterbars' | 'clarify' | 'pixeltrip' | 'animator';
/** 'original' = each DLL's own surface size; 'auto' = the view, capped near 720p worth of pixels; n = view * n. */
export type Scale = 'original' | 'auto' | number;

/** Read every frame; mutate `engine.options.*` to change them live (as the shell did). */
export interface EngineOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
  /** the output step only (the visualizers never read them): 'opaque' (the default) presents the
   *  surface as it is; 'luma' gives each pixel an alpha from its brightness (blitLuma), so black is
   *  clear and whatever is under the canvas shows through */
  alpha?: OutputAlpha;
  /** 'luma' only: each pixel painted this colour (0..255 each), the surface used as a mask */
  tint?: Tint | null;
  /** Spikes' line colour (0xRRGGBB): the player's, as WMP 10's Now Playing set it (SPIKES_COLOR), unless
   *  given; null keeps the presets' own (WMP 7-8, and the exactness runs against the bare DLL) */
  foregroundColor?: number | null;
}
/** WMP 10's default theme colour for the playing item, which its Now Playing gives Spikes (WMP 10 is the
 *  newest that ships Spikes; WMP 9's was #89E116) */
export const SPIKES_COLOR = 0xa4eb0c;
export type OutputAlpha = 'opaque' | 'luma';
export type Tint = readonly [number, number, number];

export interface CreateEngineOptions {
  preset?: number;
  scale?: Scale;
  options?: Partial<EngineOptions>;
}

export interface PresetEntry {
  vis: VisKind;
  preset: number;
  group: 'Alchemy' | 'Bars and Waves' | 'Battery' | 'Spikes' | 'Particle' | 'Plenoptic' | 'Ambience' | 'Musical Colors'
    | 'Blazing Colors' | 'Color Cubes' | 'Pulsing Colors' | 'Trilogy I' | 'Trilogy II' | 'Trilogy III' | 'Dungeon Siege' | 'SnowTime' | 'StarTime' | 'Eclectic Colors' | '3D Alchemy' | 'Picture Viz' | 'Picture Viz II' | 'Picture Viz 3D' | 'Yule Log'
    | 'Goom' | 'Plus! 3-D Visualizations' | 'Windows Media 9 Series' | 'Googly Moogly!' | 'Phthalo\'s Corona' | 'Ripple' | 'Better Bars' | 'Clarify' | 'PixelTrip' | 'Animator';
  name: string;
  /** the family's registry key, HKLM\SOFTWARE\Microsoft\MediaPlayer\Objects\Effects\<key> (its place in the list) */
  key: string;
}

/** The visualizer's own methods (Alchemy.Engine / Alchemy.Bars / Alchemy.Battery), as the shell used them. */
interface RawEngine {
  options: EngineOptions;
  preset?: number;
  render(level: TimedLevel): Surface | null;
  resize(w: number, h: number): void;
  setPreset?(n: number): void;
  setPictures?(p: Picture[]): void;
  seed(n: number): unknown;
  debug(): Record<string, unknown>;
}

export interface VisEngine {
  readonly kind: VisKind;
  /** Current preset (always 0 for Alchemy) and its menu name. */
  readonly preset: number;
  readonly presetName: string;
  readonly options: EngineOptions;
  /** The engine surface size (what `render` returns), after the scale rule. */
  readonly width: number;
  readonly height: number;
  /** One WMP Render() call. Does not paint; call present() after the last render of a frame. */
  render(level: TimedLevel): Surface | null;
  /** Paint the last rendered surface onto the canvas, stretched to the canvas size. */
  present(): void;
  /** Re-fit to the view: sets the canvas backing size (default: its client size) and re-sizes the engine if needed. */
  resize(viewWidth?: number, viewHeight?: number): void;
  setScale(scale: Scale): void;
  /** Same visualizer, other preset (keeps its state, like the shell's setVis with an unchanged vis). */
  setPreset(n: number): void;
  /** The pictures Picture Viz shows in place of its photo folder (the playing song's cover art, its Canvas still);
   *  the other families ignore them. */
  setPictures(p: Picture[]): void;
  seed(n: number): void;
  debug(): Record<string, unknown>;
}

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** The families, each with its registry key. WMP (every version) lists them, in its menu and in its
 *  next/previous walk, in RegEnumKeyEx order: the keys sorted case-insensitively, unsorted by the player
 *  (re/player/PLAYER.md §3). So Particle, key "Dotplane", comes after Battery. A new family can go
 *  anywhere in this table: PRESETS places it by its key. */
const FAMILIES: readonly { key: string; vis: VisKind; group: PresetEntry['group']; names: readonly string[] }[] = [
  { key: 'Alchemy', vis: 'alchemy', group: 'Alchemy', names: A.Engine.PRESET_NAMES },   // mpvis.dll's script (WMP 9-12); WMP 9-11 as presets
  { key: 'Bars', vis: 'bars', group: 'Bars and Waves', names: A.Bars.PRESET_NAMES },
  { key: 'Battery', vis: 'battery', group: 'Battery', names: A.Battery.PRESET_NAMES },
  { key: 'Spikes', vis: 'spikes', group: 'Spikes', names: A.Spikes.PRESET_NAMES },
  { key: 'Dotplane', vis: 'particle', group: 'Particle', names: A.Particle.PRESET_NAMES },
  { key: 'Plenoptic', vis: 'plenoptic', group: 'Plenoptic', names: A.Plenoptic.PRESET_NAMES },
  { key: 'Ambience', vis: 'ambience', group: 'Ambience', names: A.Ambience.PRESET_NAMES },
  // WMP 7 and 8's wmpvis.dll, key "WMPVis": after Spikes in their walk
  { key: 'WMPVis', vis: 'musical', group: 'Musical Colors', names: A.MusicalColors.PRESET_NAMES },
  // Microsoft's downloadable packs for WMP 7 and 8, on Musical Colors' engine (musical/plus.ts)
  { key: 'BlazingColors', vis: 'blazing', group: 'Blazing Colors', names: A.BlazingColors.PRESET_NAMES },
  { key: 'ColorCubes', vis: 'colorcubes', group: 'Color Cubes', names: A.ColorCubes.PRESET_NAMES },
  { key: 'PulsingColors', vis: 'pulsing', group: 'Pulsing Colors', names: A.PulsingColors.PRESET_NAMES },
  { key: 'TrilogyI', vis: 'trilogy1', group: 'Trilogy I', names: A.TrilogyI.PRESET_NAMES },
  { key: 'TrilogyII', vis: 'trilogy2', group: 'Trilogy II', names: A.TrilogyII.PRESET_NAMES },
  { key: 'TrilogyIII', vis: 'trilogy3', group: 'Trilogy III', names: A.TrilogyIII.PRESET_NAMES },
  { key: 'DungeonSiege', vis: 'dungeon', group: 'Dungeon Siege', names: A.DungeonSiege.PRESET_NAMES },
  { key: 'SoftietheSnowman', vis: 'snowtime', group: 'SnowTime', names: A.SnowTime.PRESET_NAMES },
  { key: 'StarTime', vis: 'startime', group: 'StarTime', names: A.StarTime.PRESET_NAMES },
  { key: 'EclecticColors', vis: 'eclectic', group: 'Eclectic Colors', names: A.EclecticColors.PRESET_NAMES },
  // GooglyMoogly.dll (n matlock / dfInteractive, 2005, for WMP 9 and 10), key "GooglyMoogly"
  { key: 'GooglyMoogly', vis: 'googly', group: 'Googly Moogly!', names: A.GooglyMoogly.PRESET_NAMES },
  // Corona.dll (Richard Asbury's Phthalo's Corona, 2003-04, for WMP 9 and 10), key "Corona"
  { key: 'Corona', vis: 'corona', group: 'Phthalo\'s Corona', names: A.Corona.PRESET_NAMES },
  // Animator2.dll (Glass3D's free Animator 2.2, 2003-04), key "AA7": first after "3D-Alchemy"
  { key: 'AA7', vis: 'animator', group: 'Animator', names: A.Animator.PRESET_NAMES },
  // the Creativity Fun Pack's mpvis3d.dll (2003) registers its own Effects key, "3D-Alchemy" (named "3D Alchemy"):
  // WMP 9 lists it as a visualization of its own, first ("3" sorts before "A"). Its sixth preset, Draco's room,
  // is one WMP never offered (GetPresetCount says 5)
  { key: '3D-Alchemy', vis: 'alchemy3d', group: '3D Alchemy', names: A.Alchemy3D.PRESET_NAMES },
  // the Windows Media Bonus Pack for Windows XP's PictureViz.dll
  { key: 'PictureViz', vis: 'pictureviz', group: 'Picture Viz', names: A.PictureViz.PRESET_NAMES },
  // PictureViz_II.dll: the gallery's 1.0.0.5 (unsigned) as presets 0-30, the Winter Fun Pack 2002's 1.0.0.1 as 31-61
  { key: 'PictureViz_II', vis: 'pictureviz2', group: 'Picture Viz II', names: A.PictureViz2.PRESET_NAMES },
  // Picture_Viz_III.dll (the Creativity Fun Pack 2003): its REGISTRY resource's Effects key is "Picture_Viz_III",
  // which sorts after "PictureViz_II" ("V" before "_")
  { key: 'Picture_Viz_III', vis: 'pictureviz3', group: 'Picture Viz 3D', names: A.PictureViz3.PRESET_NAMES },
  // PixelTripWMP.dll (Brian Spangler / Visolu, 2002), key "PixelTrip"
  { key: 'PixelTrip', vis: 'pixeltrip', group: 'PixelTrip', names: A.PixelTrip.PRESET_NAMES },
  // Microsoft's downloadable Direct3D 8 visualizations (Bonus Pack, Winter Fun Packs), their own Effects keys
  { key: 'YuleLog', vis: 'yule', group: 'Yule Log', names: A.YuleLog.PRESET_NAMES },
  // What a GOOM! 2k4's WMP 9 plug-in (wmp9_goom.dll, iOS Software, LGPL): key "Wmp9_goom", before WMPVis
  { key: 'Wmp9_goom', vis: 'goom', group: 'Goom', names: A.Goom.PRESET_NAMES },
  // Microsoft Plus! for Windows XP's plusvis.dll, key "PlusVis" (named "Plus! 3-D Visualizations")
  { key: 'PlusVis', vis: 'plus3d', group: 'Plus! 3-D Visualizations', names: A.PlusVis.PRESET_NAMES },
  // Blackfly Studios' Ripple.dll (2003, for WMP 9), key "Ripple"
  { key: 'Ripple', vis: 'ripple', group: 'Ripple', names: A.Ripple.PRESET_NAMES },
  // Blackfly Studios' Clarify.dll (2003, for WMP 9), key "Clarify"
  { key: 'Clarify', vis: 'clarify', group: 'Clarify', names: A.Clarify.PRESET_NAMES },
  // the gallery's MediaPlayer_9.dll (Averett & Associates for Microsoft, unsigned), key "MediaPlayer_9", named
  // "Windows Media 9 Series" (its string 101); one preset, Rhythm and Waves
  { key: 'MediaPlayer_9', vis: 'wm9s', group: 'Windows Media 9 Series', names: A.AverettMp9.PRESET_NAMES },
  // Better Bars (BetterBars2.dll, Rob Styles 2004, open source): its Effects key is the WMP SDK sample's "Visualizationone"
  { key: 'Visualizationone', vis: 'betterbars', group: 'Better Bars', names: A.BetterBars.PRESET_NAMES },
];

/** Every preset of every family, in WMP's order: the flat list its next/previous walks, wrapping. */
export const PRESETS: readonly PresetEntry[] = [...FAMILIES]
  .sort((a, b) => (a.key.toUpperCase() < b.key.toUpperCase() ? -1 : 1))
  .flatMap((f) => f.names.map((name, preset): PresetEntry => ({ vis: f.vis, preset, group: f.group, name, key: f.key })));

export function presetMax(kind: VisKind): number {
  return PRESETS.filter((p) => p.vis === kind).length - 1;
}

/** Digital silence (wave bytes at 128, not -1 full scale), state 0, as the shell's makeLevel(). */
export function makeLevel(): TimedLevel {
  const l: TimedLevel = {
    freq: [new Uint8Array(1024), new Uint8Array(1024)],
    wave: [new Uint8Array(1024), new Uint8Array(1024)],
    state: 0,
    timeStamp: 0,
  };
  l.wave[0].fill(128);
  l.wave[1].fill(128);
  return l;
}

// 'original' = each DLL's native surface: Alchemy's hard-coded 640x480 GDI surface, StretchBlt'd
// (HALFTONE) to the window (spec 07); Bars and Waves has no internal surface at all — it draws
// straight into a DIB the size of the window client area (spec/wmp §2.6), capped at 1920x1080;
// Battery renders 384x288 8-bit and StretchBlt's it with STRETCH_DELETESCANS — nearest neighbour,
// whole RECT, no aspect correction (spec 10 §2.3), which is why smoothing is off for it. Spikes and
// Particle (WMP 7-10) draw into a DIB of the window's own size and copy it 1:1, as Bars and Waves does (no
// cap of their own; the same 1080p one here); Musical Colors (WMP 7-8) scales its 350x320
// canvas itself (up to 3x) into the window's DC, black around it. 3D Alchemy draws through Direct3D into a back
// buffer of the window's size, presented 1:1. Picture Viz's canvas is the window
// (its own 352x320 only for a transition's first frame). Googly Moogly! draws into a memory DC the window's size and
// BitBlts it 1:1. Phthalo's Corona draws 8-bit at the window's width and 4/5 of its height, SetDIBitsToDevice'd 1:1, its
// lowest quarter mirrored beneath (the last height % 5 rows stay black). PixelTrip draws into a buffer the window's
// size, DrawDibDraw'n 1:1. Animator draws 8-bit at the window's size (its DIB two rows taller, BitBlt'd from its
// top-left corner, so the picture sits 2 rows down).
/** Families that draw at a size of their own whatever the window (Plenoptic and Ambience: their
 *  Plenoptic_Resolution / Assault_Resolution, 256x192 by default, StretchDIBits'd to the window): every
 *  scale renders them there, the canvas stretches. */
const FIXED_SIZE: ReadonlySet<VisKind> = new Set(['plenoptic', 'ambience', 'goom']);
/** Goom's presets: 320x240, 480x360, 600x480 (the DLL's "640x480" sets 600), 800x600; its Render stretched the
 *  buffer to the window with StretchDIBits in the DC's default (non-HALFTONE) mode: nearest */
const GOOM_SIZES: readonly [number, number][] = [[320, 240], [480, 360], [600, 480], [800, 600]];
/** The Direct3D 8 families (Yule Log, Plus! 3-D Visualizations, Windows Media 9 Series): their DLLs render at the window's size through the GPU; the port renders
 *  through the reference-rasterizer port (d3d8/ref.ts), in software, so it draws at most D3D_PIXELS and the canvas
 *  stretches it, whatever the scale. ponytail: a fixed pixel budget; raise it as ref.ts gets faster. */
const D3D: ReadonlySet<VisKind> = new Set(['yule', 'plus3d', 'wm9s']);
const D3D_PIXELS = 320 * 240;
/** ...and Alchemy's WMP 9-11 presets: those mpvis.dlls draw into a fixed surface (384x288 for WMP 9, 640x480
 *  for 10 and 11) StretchBlt'd COLORONCOLOR to the window; WMP 12's (preset 0) follows the scale. */
export function fixedSize(kind: VisKind, preset = 0): boolean {
  return FIXED_SIZE.has(kind) || D3D.has(kind) || (kind === 'alchemy' && preset > 0);
}
/** How the surface is stretched to the view: smooth for WMP 12's HALFTONE blits (Alchemy's Random, Bars and
 *  Waves), nearest for every COLORONCOLOR / DELETESCANS / 1:1 one. */
export function samplingOf(kind: VisKind, preset = 0): Sampling {
  return (kind === 'alchemy' && preset === 0) || kind === 'bars' || D3D.has(kind) ? 'smooth' : 'nearest';
}

export function nativeSize(kind: VisKind, viewW: number, viewH: number, preset = 0): [number, number] {
  if (kind === 'plenoptic' || kind === 'ambience') return [256, 192];
  if (kind === 'goom') return GOOM_SIZES[preset] ?? GOOM_SIZES[0];   // goom's resolution is the preset
  if (D3D.has(kind)) {                                                // the view's shape within the pixel budget
    const k = Math.min(1, Math.sqrt(D3D_PIXELS / (viewW * viewH)));
    return [Math.max(16, Math.round(viewW * k)), Math.max(16, Math.round(viewH * k))];
  }
  if (kind === 'alchemy' && preset === 1) return [384, 288];          // Random (WMP 9)
  if (kind === 'bars' || kind === 'spikes' || kind === 'particle' || kind === 'musical' || PLUS[kind] || kind === 'alchemy3d' || kind === 'pictureviz' || kind === 'pictureviz2' || kind === 'pictureviz3') return [Math.min(1920, viewW), Math.min(1080, viewH)];
  // Ripple: a 32-bit DIB section of the window's size, BitBlt'd 1:1
  if (kind === 'ripple' || kind === 'betterbars' || kind === 'clarify') return [Math.min(1920, viewW), Math.min(1080, viewH)];
  if (kind === 'googly' || kind === 'corona' || kind === 'animator') return [Math.max(32, Math.min(1920, viewW)), Math.max(32, Math.min(1080, viewH))];   // the window's own, 32x32 at least
  if (kind === 'pixeltrip') {   // the window's shape within 640x480 worth of pixels (its per-pixel field runs ~18 ms there in JS)
    // ponytail: a fixed pixel budget, as the Direct3D families; the window's own size once the field is faster
    const k = Math.min(1, Math.sqrt(640 * 480 / (viewW * viewH)));
    return [Math.max(16, Math.round(viewW * k)), Math.max(16, Math.round(viewH * k))];
  }
  return kind === 'battery' ? [384, 288] : [640, 480];
}

/** 'auto' = full size up to ~720p worth of pixels (engine measured 8 ms/frame there, 20 ms at 1080p). */
export function effectiveScale(scale: Exclude<Scale, 'original'>, viewW: number, viewH: number): number {
  return scale === 'auto' ? Math.min(1, Math.sqrt((1280 * 720) / (viewW * viewH))) : scale;
}

// 0x00RRGGBB (as the DLL stores it) -> canvas RGBA, via a Uint32 view.
const LITTLE_ENDIAN = (function () {
  const b = new ArrayBuffer(4);
  new Uint32Array(b)[0] = 1;
  return new Uint8Array(b)[0] === 1;
})();

/** 'luma''s alpha: a pixel's brightest channel times this, so a lit pixel (one channel at 204 or
 *  more: Bars and Waves' green at 235, a white peak) is opaque and black is clear. gl.ts's shader has the same. */
export const LUMA_GAIN = 1.25;

/** The 'luma' output (RGBA bytes, unpremultiplied as ImageData is): alpha the brightest channel times
 *  LUMA_GAIN, colour the tint, or else the pixel's own at that alpha's strength (c / a: what the
 *  WebGL path's premultiplied (c, a) composites to). */
export function blitLuma(px: Uint32Array, out: Uint8ClampedArray, tint?: Tint | null): void {
  for (let i = 0, j = 0; i < px.length; i++, j += 4) {
    const p = px[i], r = (p >>> 16) & 0xff, g = (p >>> 8) & 0xff, b = p & 0xff;
    const a = Math.min(255, Math.round(Math.max(r, g, b) * LUMA_GAIN));
    if (tint) { out[j] = tint[0]; out[j + 1] = tint[1]; out[j + 2] = tint[2]; }
    else if (a) { out[j] = (r * 255) / a; out[j + 1] = (g * 255) / a; out[j + 2] = (b * 255) / a; }
    else out[j] = out[j + 1] = out[j + 2] = 0;
    out[j + 3] = a;
  }
}

export function blit(px: Uint32Array, out32: Uint32Array): void {
  let i, p;
  const n = px.length;
  if (LITTLE_ENDIAN) {
    // bytes in memory are R,G,B,A -> u32 = A<<24 | B<<16 | G<<8 | R
    for (i = 0; i < n; i++) {
      p = px[i];
      out32[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
    }
  } else {
    for (i = 0; i < n; i++) out32[i] = (px[i] << 8) | 0xff;
  }
}

type RawCtor = new (cfg: { width: number; height: number; options: EngineOptions; preset?: number }) => RawEngine;
/** the packs on Musical Colors' engine: drawn, sized and fed as it is */
const PLUS: Partial<Record<VisKind, RawCtor>> = {
  blazing: A.BlazingColors, colorcubes: A.ColorCubes, pulsing: A.PulsingColors,
  trilogy1: A.TrilogyI, trilogy2: A.TrilogyII, trilogy3: A.TrilogyIII,
  dungeon: A.DungeonSiege,
  snowtime: A.SnowTime,
  startime: A.StarTime,
  eclectic: A.EclecticColors,
} as unknown as Partial<Record<VisKind, RawCtor>>;

function makeRaw(kind: VisKind, preset: number, options: EngineOptions): RawEngine {
  if (kind === 'bars') return new (A.Bars as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'battery') return new (A.Battery as unknown as RawCtor)({ width: 384, height: 288, options, preset });
  if (kind === 'spikes') {
    if (options.foregroundColor === undefined) options.foregroundColor = SPIKES_COLOR;
    return new (A.Spikes as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  }
  if (kind === 'particle') return new (A.Particle as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'plenoptic') return new (A.Plenoptic as unknown as RawCtor)({ width: 256, height: 192, options, preset });
  if (kind === 'ambience') return new (A.Ambience as unknown as RawCtor)({ width: 256, height: 192, options, preset });
  if (kind === 'musical') return new (A.MusicalColors as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  const P = PLUS[kind];
  if (P) return new P({ width: 16, height: 16, options, preset });
  if (kind === 'alchemy3d') return new (A.Alchemy3D as unknown as RawCtor)({ width: 640, height: 480, options, preset });
  if (kind === 'pictureviz') return new (A.PictureViz as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'pictureviz2') return new (A.PictureViz2 as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'pictureviz3') return new (A.PictureViz3 as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'yule') {
    // its options are the Preset1 registry values (defaults: the DLL's); the shell's options are set on it after
    return new A.YuleLog({ width: 320, height: 240, preset }) as unknown as RawEngine;
  }
  // the DLL seeded its random table with a heap address: a different one each time it was loaded
  if (kind === 'goom') return new A.Goom({ preset, options, seed: (Math.random() * 0x100000000) >>> 0 }) as unknown as RawEngine;
  if (kind === 'plus3d') return new A.PlusVis({ width: 320, height: 240, preset }) as unknown as RawEngine;
  // Ripple: RandSeed 0, as the DLL loads
  if (kind === 'betterbars') return new (A.BetterBars as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'ripple') return new A.Ripple({ width: 16, height: 16, options, preset }) as unknown as RawEngine;
  if (kind === 'clarify') return new A.Clarify({ width: 16, height: 16, options, preset }) as unknown as RawEngine;
  if (kind === 'wm9s') return new A.AverettMp9({ width: 320, height: 240, preset }) as unknown as RawEngine;
  if (kind === 'googly') return new (A.GooglyMoogly as unknown as RawCtor)({ width: 640, height: 480, options, preset });
  if (kind === 'corona') return new (A.Corona as unknown as RawCtor)({ width: 640, height: 480, options, preset });
  if (kind === 'pixeltrip') return new (A.PixelTrip as unknown as RawCtor)({ width: 640, height: 480, options, preset });
  if (kind === 'animator') return new (A.Animator as unknown as RawCtor)({ width: 640, height: 480, options, preset });
  return new (A.Engine as unknown as RawCtor)({ width: 16, height: 16, options, preset });
}

// the reference rasterizer's WebAssembly kernel compiles in the background; until then it draws in JS (same pixels)
if (typeof WebAssembly !== 'undefined') void RefDevice.prepare().catch(() => undefined);

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeBuffer(): { canvas: CanvasLike; ctx: Ctx2D | null } {
  const canvas: CanvasLike =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d') };
}

/**
 * A visualizer bound to a canvas. The canvas shows the engine surface stretched to its backing size;
 * `resize()` sets that backing size from the view (clientWidth/clientHeight by default).
 */
export function createEngine(kind: VisKind, canvas: CanvasLike, opts: CreateEngineOptions = {}): VisEngine {
  const options: EngineOptions = { intended: false, fps: 60, backgroundColor: 0x000000, alpha: 'opaque', tint: null, ...opts.options };
  const max = presetMax(kind);
  const clampPreset = (n: number) => Math.min(max, Math.max(0, n | 0));
  const raw = makeRaw(kind, clampPreset(opts.preset ?? 0), options);
  // a port that keeps no options of its own (Particle reads none) still gets the shell's: the skins set
  // alpha, tint and the rest on engine.options live (the iPod's Now Playing overlay crashed on Particle
  // without this, 2026-10-07)
  if (!raw.options) raw.options = options;
  let scale: Scale = opts.scale ?? 'original';
  // WebGL2 when there is one (engine/gl.ts): no conversion loop, no hidden canvas, the GPU scales.
  // Otherwise the 2D path: convert, putImageData into a hidden canvas, drawImage it stretched.
  const gl = glPresenter(canvas, LITTLE_ENDIAN);
  // Battery's StretchBlt is STRETCH_DELETESCANS, Plenoptic's and Ambience's StretchDIBits COLORONCOLOR;
  // Spikes' spokes and Particle's dots are 1 pixel, copied 1:1: all nearest (samplingOf). Per preset:
  // Alchemy's WMP 9-11 presets are COLORONCOLOR where WMP 12's is HALFTONE.
  let preset = clampPreset(opts.preset ?? 0), sampling: Sampling = samplingOf(kind, preset);
  const view = gl ? null : canvas.getContext('2d');
  const buf = gl ? { canvas: null, ctx: null } : makeBuffer();
  let img: ImageData | null = null, img32: Uint32Array | null = null;
  let bw = 0, bh = 0, last: Surface | null = null;

  const eng: VisEngine = {
    kind,
    get preset() {
      return raw.preset ?? 0;
    },
    get presetName() {
      const p = raw.preset ?? 0;
      return PRESETS.find((e) => e.vis === kind && e.preset === p)?.name ?? '';
    },
    options: raw.options,
    get width() {
      return bw;
    },
    get height() {
      return bh;
    },
    render(level) {
      return (last = raw.render(level));
    },
    present() {
      const s = last;
      if (!s || s.w !== bw || s.h !== bh) return;
      const luma = raw.options.alpha === 'luma', tint = luma ? raw.options.tint ?? null : null;
      if (gl) {
        gl.output(luma, tint);
        // Battery's palette lookup on the GPU while nothing has read (and so built) px
        if (s.idx && s.pal) gl.drawIndexed(s.idx, s.pal, bw, bh);
        else gl.draw(s.px, bw, bh, sampling);
        return;
      }
      if (!img || !img32 || !buf.ctx || !buf.canvas || !view) return;
      if (luma) {
        // the last frame would show through the clear pixels: the canvas is cleared first
        blitLuma(s.px, img.data, tint);
        buf.ctx.putImageData(img, 0, 0);
        view.clearRect(0, 0, canvas.width, canvas.height);
        view.drawImage(buf.canvas, 0, 0, canvas.width, canvas.height);
        return;
      }
      blit(s.px, img32);
      buf.ctx.putImageData(img, 0, 0);
      view.drawImage(buf.canvas, 0, 0, canvas.width, canvas.height);
    },
    resize(viewWidth, viewHeight) {
      const el = canvas as Partial<HTMLCanvasElement>;
      const vw = Math.max(16, viewWidth ?? (el.clientWidth || canvas.width));
      const vh = Math.max(16, viewHeight ?? (el.clientHeight || canvas.height));
      canvas.width = vw;
      canvas.height = vh;
      if (view) {
        // Battery's blit is STRETCH_DELETESCANS (nearest neighbour); Alchemy's is HALFTONE.
        view.imageSmoothingEnabled = sampling === 'smooth';
        view.imageSmoothingQuality = 'high';
      }
      const orig = scale === 'original' || fixedSize(kind, preset) ? nativeSize(kind, vw, vh, preset) : null;
      const s = scale === 'original' ? 1 : effectiveScale(scale, vw, vh);
      const w = orig ? orig[0] : Math.max(16, Math.round(vw * s));
      const h = orig ? orig[1] : Math.max(16, Math.round(vh * s));
      if (w === bw && h === bh) return;
      bw = w;
      bh = h;
      if (buf.canvas) {
        buf.canvas.width = w;
        buf.canvas.height = h;
      }
      img = buf.ctx ? buf.ctx.createImageData(w, h) : null;
      img32 = img ? new Uint32Array(img.data.buffer) : null;
      raw.resize(w, h);
    },
    setScale(s) {
      scale = s;
      eng.resize(canvas.width, canvas.height);
    },
    setPreset(n) {
      preset = clampPreset(n);
      if (raw.setPreset) raw.setPreset(preset);
      // a preset may bring its own surface size and stretch (Alchemy's WMP 9-11)
      sampling = samplingOf(kind, preset);
      eng.resize(canvas.width, canvas.height);
    },
    setPictures(p) {
      raw.setPictures?.(p);
    },
    seed(n) {
      raw.seed(n);
    },
    debug() {
      return { ...raw.debug(), present: gl ? 'webgl2' : view ? '2d' : 'none', sampling: gl ? sampling : view?.imageSmoothingEnabled ? 'smooth' : 'nearest' };
    },
  };
  eng.resize();
  return eng;
}

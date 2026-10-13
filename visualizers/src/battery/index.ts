// Alchemy.Battery — Windows Media Player's built-in "Battery" engine (wmp.dll, CBattery 0x18040b4b0).
// Spec: spec/battery/10-battery-engine.md. Same engine API as Alchemy.Engine plus setPreset(i)/preset/presetNames.
// 384x288 8-bit ping-pong buffers, four-stage chain (pre draws -> warp -> post draws -> blur) with two
// buffer swaps, a 256-entry palette cross-faded in three tables, and 26 presets (0 = Randomization).
// NO audio reduction: TimedLevel is handed to every draw class unchanged.
// Wrapped verbatim from src/75-battery.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';
import './warps';
import './draws';
import './draws-a';
import { newArena, blurWasm, paletteWasm } from './kernel';
import type { BatteryShift } from './warps';
import type { BatteryDrawEffect, BatteryDrawCtx, BatteryDrawCtor } from './draws';

// ---------------------------------------------------------------- engine-side types
// warps.ts/draws.ts define the registry contract (BatteryShift/BatteryDrawEffect/BatteryDrawCtx);
// their engine-side expandos are optional there (a freshly-constructed instance has none yet), so
// here — where makeShift/makeDraw guarantee they're always populated before anything else touches
// them — EngineShift/EngineDraw narrow those fields to required via intersection.
type EngineShift = BatteryShift & {
  className: string;
  map: Int32Array | null;
  animMap: Int32Array[] | null;
  animIdx: number;
  animHold: number;
  mapComplete: boolean;
  building: boolean;
  buildRow: number;
  mw: number;
  mh: number;
  cx: number;
  cy: number;
  prev: EngineShift | null;
};

type EngineDraw = BatteryDrawEffect & { className: string };

interface WarpPoint { x: number; y: number; }

// Battery's own view of the draw ctx: dctx starts with buf/level null (nothing rendered yet) and
// is populated every frame before any draw() call, at which point it satisfies BatteryDrawCtx.
interface DrawCtx {
  buf: Uint8Array | null;
  w: number;
  h: number;
  level: TimedLevel | null;
  frame: number;
  pre: boolean;
  audio: Record<string, unknown>;
  sw?: number;
  sh?: number;
}

// [key, muiTitleId, displayName, currentShift, dbl[8], pre[[name,dbl[8]]], post[...], paletteLocked, palette]
type PresetData = [
  string, number, string, string, number[],
  [string, number[]][], [string, number[]][],
  number, string | null
];

export interface BatteryOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
}

export interface BatteryConfig {
  width?: number;
  height?: number;
  resolution?: number;
  options?: Partial<BatteryOptions>;
  preset?: number;
}

var F32 = Math.fround;
var INV19 = 0.05263157894736842;        // .rdata literal — exactly 1/19, never computed
var RES_TABLE: number[][] = [[256, 192], [384, 288], [512, 384]];   // DAT_1808ec9f0, ctor index 1

// ---------------------------------------------------------------- registries (§7.1)
// Insertion order is load-bearing: RandomizeMovement/RandomizeEffects are rand() % count over these.
// CLinearShift really is constructed twice (two distinct singletons) => probability 2/15.
var SHIFT_NAMES = ['CLinearShift', 'CLinearShift', 'CThingusShift', 'CZoomShift', 'CRingSpinShift',
  'CStretchShift', 'CTileShift', 'CTrigShift', 'CSinShimmerShift', 'CEdgeFalloffShift',
  'CStarburstShift', 'CSwirlShift', 'CTrigStretchShift', 'CTwirlocity', 'CShiitake'];
var DRAW_NAMES = ['CEdgeTrace', 'CEdgeGradiant', 'CCosEdgeGradiant', 'CWaveEdge', 'CSpectrumEdge',
  'CCircleWaveform', 'CDotPlane', 'CJDar', 'CGalaxy', 'CJiggyScribble'];
// +0xe0 compat masks (§7.4): 1 = border/pre-only, 2 = overlay/pre-or-post.
var SHIFT_MASK: Record<string, number> = { CTileShift: 1 };
var DRAW_MASK: Record<string, number> = { CEdgeTrace: 1, CEdgeGradiant: 1, CCosEdgeGradiant: 1, CWaveEdge: 1, CSpectrumEdge: 1,
  CCircleWaveform: 2, CDotPlane: 2, CJDar: 2, CGalaxy: 2, CJiggyScribble: 2 };
// +0x1a0 = 0 in these five ctors: an out-of-range axis samples 0 instead of the destination coord.
var NO_IDENTITY: Record<string, number> = { CEdgeFalloffShift: 1, CRingSpinShift: 1, CStretchShift: 1, CTrigStretchShift: 1, CZoomShift: 1 };

// ---------------------------------------------------------------- blur tables (§3.2)
// decay[j] = min(max(1, j-1), 255); lut[s] = pin(decay[s/5]) == max(1, s/5 - 1) for s in [0,1280).
// Built once: CPreset::Activate rebuilds the identical decay variant, and the plain-average variant
// that exists between construction and the first Activate is never rendered.
var BLUR_LUT = (function () {
  var decay = new Uint8Array(256), j: number, s: number, v: number;
  for (j = 0; j < 256; j++) { v = j - 1; if (v < 1) v = 1; decay[j] = v < 255 ? v : 255; }
  var lut = new Uint8Array(0x500);
  for (s = 0; s < 0x500; s++) {
    v = decay[(s / 5) | 0] & 0xFF;
    lut[s] = v === 0 ? 1 : (v === 0xFF ? 0xFE : v);
  }
  return lut;
})();

// ---------------------------------------------------------------- shipped presets (§9)
// [key, muiTitleId, displayName, currentShift, dbl[8], pre[[name,dbl[8]]], post[...], paletteLocked,
//  palette] — palette is the key colours its gradient was built from (keyPalette), or 256 RGB triples
//  as hex where it is not one gradient (the flags byte is 0 in all 17 shipped blobs).
// Index order == the hive's case-insensitive key sort, which is what RegEnumKeyExW returns.
var PRESETS: PresetData[] = [
['BrightSphere',5700,'brightsphere','CRingSpinShift',[-0.037548448704905,0.762913906574249,0,0,0,0,0,0],[['CDotPlane',[37,0,0,384.000015258789,0,0,0,0]]],[],0,null],
['circledance',5721,'dance of the freaky circles','CTileShift',[0.0337656788527966,0,0,0,0,0,0,0],[['CEdgeTrace',[55,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,2,0.643847492279012,0,0,0,0,0]]],1,'121403 EFDDAF EDFAE9 > 06111A 3C1C87 8C22A3 BC8DF0 EBF1F1 / 152/153'],
['cominatya',5701,'cominatcha','CStretchShift',[0.0435239728506501,0.154408398550004,0,0,0,0,0,0],[['CJiggyScribble',[80,227,456,11,0,0,0,0]]],[],1,'1F041B E4F7E8'],
['cottonstar',5705,'cottonstar','CStarburstShift',[0.0282921845583943,0.14029969163239,32,0,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]],['CDotPlane',[31,3,0,384.000015258789,0,0,0,0]]],[],0,null],
['dandelionaid',5702,'dandelionaid','CStarburstShift',[-0.0373287154336082,0.229520554002374,26,0,0,0,0,0],[['CJiggyScribble',[30,75,479,16,0,0,0,0]]],[['CJDar',[82,3,1,16,0.7027070033364,0,100,0]]],1,'0B150C 420438 27A288 6ABB91 F2F6F8'],
['DrowningFlower',5703,'drinkdeep','CShiitake',[7.52317880000919,0.00704214565301892,0.0218924530784406,2,0,0,0,0],[['CSpectrumEdge',[7,16,7,0,0,0,0,0]]],[['CJiggyScribble',[39,134,428,11,0,0,0,0]]],1,'090009 0262FA AFE0C3 E6EAEB EFFAE1'],
['EletriArnation',5704,'eletriarnation','CStarburstShift',[-0.0270867035103843,0.0415936765260994,22,1,0,0,0,0],[['CJiggyScribble',[101,222,666,19,0,0,0,0]]],[['CJDar',[9,0,0,8,1.10129399597645,1,100,0]]],1,'141F01 E5F1E7'],
['eventhorizon',5708,'event horizon','CShiitake',[7.69203772087771,0.130502610039042,0.000558488731732879,1,0,0,0,0],[['CSpectrumEdge',[159,59,0,0,0,0,0,0]]],[['CDotPlane',[24,2,0,384,0,0,0,0]]],0,null],
['Geeks Kick ASCII',5723,'hizodge','CShiitake',[0.943723866716027,0.0601674404976449,0.00662862035078735,3,0,0,0,0],[['CCosEdgeGradiant',[0.0097891174793886,0,0,0,0,0,0,0]]],[['CJDar',[76,3,0,8,1.40663168299943,0,100,0]]],1,'E7E3E9 278268 031915'],
['gemstone matrix',5706,'gemstonematrix','CTileShift',[0.100997955165803,0,0,0,0,0,0,0],[['CJDar',[68,3,0,32,0.727060773875564,0,100,0]]],[],1,'110600 2DEB44 36F054 1BE9E8 F3F0F8'],
['GrooveSwirl',5707,'sepiaswirl','CShiitake',[3.65889461524785,0.00247361957587322,0.017259743275266,1,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.59098332811329,0,0,0,0,0]]],1,'E3EBFB C76C2E 1C081C'],
['illuminator',5709,'illuminator','CRingSpinShift',[0.0281029697969998,0.38616901114583,0,0,0,0,0,0],[['CEdgeTrace',[41,0,0,0,0,0,0,0]]],[['CCircleWaveform',[2,2,0.292255938366291,0,0,0,0,0]]],0,null],
['ISeeTheTruth',5710,'i see the truth','CShiitake',[0.943723866716027,0.0601674404976449,0.00662862035078735,3,0,0,0,0],[['CJiggyScribble',[70,200,1205,18,0,0,0,0]]],[],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['kaleidoscope',5711,'kaleidovision','CRingSpinShift',[-0.0497924748777222,0.209820856153965,0,0,0,0,0,0],[['CDotPlane',[33,5,0,384.000015258789,0,0,0,0]]],[['CCircleWaveform',[1,2,0.453448607971712,0,0,0,0,0]]],0,null],
['khemicalnova',5724,'chemicalnova','CStarburstShift',[-0.0390469075411097,0.169341105222702,2,0,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.437554567619842,0,0,0,0,0]],['CJDar',[84,0.761241512943963,0.616034439222392,14,0,0,100,0]]],1,'1A1D00 2707A5 488428 D87A15 EF0C9D 6C9BC3 5E90E1 D2E14E D4D487 FAE2E9'],
['Lotus',5713,'lotus','CStarburstShift',[0.0104510636694888,0.0136875514872372,30,0,0,0,0,0],[['CEdgeTrace',[55,0,0,0,0,0,0,0]]],[['CDotPlane',[30,6,0,384.000015258789,0,0,0,0]]],1,'11140B E2F8FD > 030211 AB2C97 E6E0ED / 178/179'],
['Nerds Are Cool',5712,'green is not your enemy','CShiitake',[5.93462934624404,0.106945695965418,0.0258461260362882,2,0,0,0,0],[['CWaveEdge',[1,0,0,0,0,0,0,0]]],[['CJiggyScribble',[37,166,736,19,0,0,0,0]]],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['relativelycalm',5714,'relatively calm','CTwirlocity',[11,0.0227790163780411,8,0,0,0,0,0],[['CSpectrumEdge',[4,14,6,0,0,0,0,0]],['CJDar',[92,1,0,4,1.07506333782809,0,0,0]]],[['CDotPlane',[45,0,0,384,0,0,0,0]]],1,'000007 0F0000 3BACAA E5A5FB E4FAE5 > 050E05 1496B6 0FC39B E7F7F3 / 248/249 > 0B111E B66FCB F8F4ED / 97/207'],
['sleepyspray',5715,'sleepyspray','CLinearShift',[-1,-3,0,0,0,0,0,0],[],[['CDotPlane',[45,0,0,384.000015258789,0,0,0,0]]],0,null],
['Smoke or Water',5716,'smoke or water?','CSwirlShift',[-0.0440031135492491,5,-5,0,0,0,0,0],[['CJDar',[88,3,1,32,0.727060773875564,0,100,0]]],[],1,'0D001E EBEEE1'],
['SpidersLastMoment',5718,'spider\'s last moment...','CShiitake',[5.93462934624404,0.106945695965418,0.0258461260362882,2,0,0,0,0],[],[['CJDar',[88,3,0,32,0.727060773875564,1,100,0]]],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['strawberryaid',5719,'strawberryaid','CStretchShift',[-0.0370937228953403,0.142158268990143,0,0,0,0,0,0],[['CCosEdgeGradiant',[0.0806421126438045,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.584977285713585,0,0,0,0,0]],['CJDar',[94,1,0,8,1.19339885832127,0,0,0]]],1,'6A7968 A13A5D A8B5A4 869597 > 071008 A40119 F6DDE0 E6F7F5 / 88/89'],
['the world',5720,'the world','CShiitake',[-0.348063600573748,0.130804621736227,0.0215704828190601,1,0,0,0,0],[['CSpectrumEdge',[214,106,0,0,0,0,0,0]],['CCircleWaveform',[0,2,0.522280057354732,0,0,0,0,0]],['CDotPlane',[46,1,0,384,0,0,0,0]]],[],1,'5D5894 838242 555A41 635980 BC7738 6A4646 769E81 4036BB 588267 636166 > 1A1510 F7E8EC / 65/66'],
['tornado',5722,'my tornado is resting','CSwirlShift',[0.0251609854424147,0,-10,0,0,0,0,0],[['CCircleWaveform',[3,1,0.489063709912248,0,0,0,0,0]]],[],0,null],
['what is an egab',5717,'back to the groove','CSwirlShift',[-0.0480376605583379,3,-4,0,0,0,0,0],[],[['CJDar',[75,3,0,9,1.40663168299943,0,100,0]],['CDotPlane',[38,0,0,384.000015258789,0,0,0,0]]],0,null],
];

var BASE_NAMES = ['Randomization'].concat(PRESETS.map(function (p) { return p[2]; }));
// The older builds as presets of their own: WMP 8 (XP; SP1 has the same code), 9 and 10 (x87 builds of one source)
// and 11 (VC8). Per base preset, the builds whose DLLs draw the same frames (FRONT, rand() count and palettes over
// 30,000 frames on two streams) share one variant, e.g. '9-10', run on its first build's arithmetic. `build`
// reaches every class singleton (setBuild), which branches where its x86 code differs.
var GROUPS = ['8|9|10|11', '8|9-10|11', '8|9|10|11', '8|9-11', '8|9-10|11', '8-10|11', '8|9-11', '8-10|11', '8|9-10|11',
  '8-10|11', '8-10|11', '8|9|10|11', '8|9|10|11', '8|9-11', '8|9|10|11', '8-9|10|11', '8|9-10|11', '8|9-11', '8-10|11',
  '8|9-10|11', '8-10|11', '8-10|11', '8-9|10|11', '8|9|10|11', '8-9|10|11', '8-10|11'];
var VARIANTS: number[][] = [];                                   // [base preset, build], by first build then preset
var PRESET_NAMES = BASE_NAMES.slice();
[8, 9, 10, 11].forEach(function (b) {
  GROUPS.forEach(function (g, i) {
    g.split('|').forEach(function (v) {
      if (parseInt(v, 10) === b) { VARIANTS.push([i, b]); PRESET_NAMES.push(BASE_NAMES[i] + ' (WMP ' + v + ')'); }
    });
  });
});

// The stored palettes are ones Battery made itself: the saver (0x1804159a0) writes LIVE, as the authoring
// build left it. 'P' with the palette locked runs NewPalette and copies TO straight into LIVE: a gradient
// through NewPalette's key colours ('RRGGBB RRGGBB ...'). Locked ('p') while an auto-cycle fade ran or
// after it finished, LIVE is that fade's frame c of len, FROM + (TO - FROM) * c/len, two such gradients
// ('FROM keys > TO keys / c/len'; at the last frame, c = len - 1, LIVE never quite reaches TO). A fade that
// starts from where an earlier one ended chains on ('A > B / c1/len1 > C / c/len'). All in that
// build's x87 arithmetic: t rounded to float, (b - a) * t exact, truncated (lerpInto rounds the product
// to float; here that differs).
function lerp87(a: number, b: number, t: number): number { return a + Math.trunc((b - a) * t); }
function keyPalette(spec: string): Uint8Array {
  var k = spec.split(' ').map(function (h) { return parseInt(h, 16); }), n = k.length, w = (256 / (n - 1)) | 0;
  var b = new Uint8Array(1024), start = 0, end = 0, i: number, c: number, t: number;
  for (var j = 0; j < n - 1; j++, start = end) {
    end = j === n - 2 ? 255 : start + w;
    for (i = start; i <= end; i++) {
      t = F32((i - start) / (end - start + 1));
      for (c = 0; c < 3; c++) b[i * 4 + c] = lerp87((k[j] >> (16 - 8 * c)) & 255, (k[j + 1] >> (16 - 8 * c)) & 255, t);
    }
  }
  return b;
}
function presetPalette(p: string): Uint8Array {
  var f = p.split(/ [>/] /), a = keyPalette(f[0]);
  for (var j = 1; j < f.length; j += 2) {                       // each '> TO keys / c/len' fades what came before
    var at = f[j + 1].split('/'), b = keyPalette(f[j]), t = F32(+at[0] / +at[1]);
    for (var i = 0; i < 1024; i++) a[i] = lerp87(a[i], b[i], t);
  }
  return a;
}

// ---------------------------------------------------------------- primitives
// Line = 0x180414050: integer Bresenham straight into the byte buffer, NO clipping at all.
function line(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: number): void {
  var pitch = w, p = pitch * y0 + x0, n = w * h;
  var dy = y1 - y0, sy = dy >= 0 ? pitch : -pitch, ay = dy >= 0 ? dy : -dy;
  var dx = x1 - x0, ax = dx >= 0 ? dx : -dx, sx = dx >= 0 ? 1 : -1, err = 0, i: number;
  if (ay < ax) {
    for (i = 0; i <= ax; i++) { if (p >= 0 && p < n) buf[p] = c; err += ay; p += sx; if (err > ax) { err -= ax; p += sy; } }
  } else {
    for (i = 0; i <= ay; i++) { if (p >= 0 && p < n) buf[p] = c; err += ax; p += sy; if (err > ay) { err -= ay; p += sx; } }
  }
}
// Blur = 0x180412250, four passes. Rows 1..h-2 use LINEAR neighbours (so x=0 reads the previous
// row's last pixel); only rows 0 and h-1 wrap, and row 0's x+1 at x=w-1 is the linear next byte.
function blur(src: Uint8Array, dst: Uint8Array, w: number, h: number): void {
  var lut = BLUR_LUT, p: number, x: number, base = (h - 1) * w, end = base;
  if (blurWasm(src, dst, w, h)) { /* rows 1..h-2 done in WebAssembly (kernel.ts) */ }
  else if (LE && (w & 3) === 0 && end > w && src.byteOffset % 4 === 0 && dst.byteOffset % 4 === 0) blurRows4(src, dst, w, end);
  else for (p = w; p < end; p++) dst[p] = lut[src[p - w] + src[p - 1] + src[p] + src[p + 1] + src[p + w]];
  dst[0] = lut[src[1] + src[w] + src[base] + src[w - 1] + src[0]];
  for (x = 1; x < w; x++) dst[x] = lut[src[x] + src[x + w] + src[x - 1] + src[x + 1] + src[x + base]];
  for (x = 0; x < w - 1; x++)
    dst[base + x] = lut[src[base - w + x] + src[base + x] + src[x] + src[base + x + 1] + src[base + x - 1]];
  p = h * w - 1;
  dst[p] = lut[src[p] + src[p - 1] + src[base] + src[w - 1] + src[p - w]];
}
// blur()'s rows 1..h-2, four pixels per 32-bit word (w % 4 == 0, little-endian): the even and odd
// bytes are summed in two 16-bit lanes each (5 * 255 fits), then looked up in the same LUT. The
// linear left/right neighbours come from the adjacent words, exactly as the byte loop reads them.
var LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
var M_EVEN = 0x00FF00FF;
function blurRows4(src: Uint8Array, dst: Uint8Array, w: number, end: number): void {
  var lut = BLUR_LUT;
  var s = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2);
  var d = new Uint32Array(dst.buffer, dst.byteOffset, dst.length >> 2);
  var w4 = w >> 2, e4 = end >> 2, prev = s[w4 - 1], cur = s[w4];
  for (var j = w4; j < e4; j++) {
    var next = s[j + 1], up = s[j - w4], dn = s[j + w4];
    var L = (cur << 8) | (prev >>> 24), R = (cur >>> 8) | (next << 24);
    var se = (up & M_EVEN) + (L & M_EVEN) + (cur & M_EVEN) + (R & M_EVEN) + (dn & M_EVEN);
    var so = ((up >>> 8) & M_EVEN) + ((L >>> 8) & M_EVEN) + ((cur >>> 8) & M_EVEN) + ((R >>> 8) & M_EVEN) + ((dn >>> 8) & M_EVEN);
    d[j] = lut[se & 0xFFFF] | (lut[so & 0xFFFF] << 8) | (lut[se >>> 16] << 16) | (lut[so >>> 16] << 24);
    prev = cur; cur = next;
  }
}

// ---------------------------------------------------------------- the warp-map framework (§4)
// The 15 shift classes own warp()/randomize()/setParams(); everything below is engine-side state
// held ON the shift singleton (it survives preset switches, exactly as the DLL's do).
function recalc(s: EngineShift): void { s.buildRow = 0; s.mapComplete = false; }   // 0x180412160

function freeAnimMaps(s: EngineShift): void { s.animMap = null; s.animIdx = 18; }  // 0x180410df8

function allocMaps(s: EngineShift, w: number, h: number, animate: boolean | number): void {   // 0x180413480
  if (s.mw === w && s.mh === h && s.map) return;                // idempotent
  if (s.map) { s.map = null; freeAnimMaps(s); s.prev = null; }
  s.mw = s.mh = s.cx = s.cy = 0;
  if (!(w > 0 || h > 0)) return;                                // OR, not AND — (0,0,0) is the free path
  s.map = new Int32Array(w * h);
  if (!animate) s.animIdx = 18;
  else {
    s.animIdx = 0;
    s.animMap = [];
    for (var k = 0; k < 18; k++) s.animMap.push(new Int32Array(w * h));
  }
  s.mw = w; s.mh = h; s.cx = w >> 1; s.cy = h >> 1;
  if (s.setSize) s.setSize(w, h);
  recalc(s);
}

function storeMapPixel(s: EngineShift, x: number, y: number, sx: number, sy: number): void {   // 0x1804132f8
  var off = s.mw * y + x;
  var map = s.map!;
  map[off] = s.mw * sy + sx;
  if (!s.building && s.prev && s.prev.map && s.animIdx < 18 && s.animMap) {
    var prev = s.prev.map[off];
    var py = (prev / s.mw) | 0, px = prev % s.mw;               // unsigned division in the DLL
    for (var k = 1; k <= 18; k++) {                             // truncation toward zero, both casts
      s.animMap[k - 1][off] = Math.trunc(k * INV19 * (sx - px)) + px
                            + (Math.trunc(k * INV19 * (sy - py)) + py) * s.mw;
    }
  }
}

var WP: WarpPoint = { x: 0, y: 0 };                             // no allocation in the inner loop
function buildRows(s: EngineShift): void {                      // 0x180413630 — 3 scanlines per call
  if (s.mapComplete || !s.map) return;
  if (s.prev && (!s.prev.map || s.mw !== s.prev.mw || s.mh !== s.prev.mh)) { s.prev = null; freeAnimMaps(s); }
  var wrap = s.identityRecovery !== false;
  for (var pass = 0; pass < 3; pass++) {
    var y = s.buildRow;
    for (var x = 0; x < s.mw; x++) {
      WP.x = x; WP.y = y;
      s.warp(WP);
      var sx = WP.x | 0, sy = WP.y | 0;
      if (sx < 0 || sx >= s.mw) { sx = x; if (!wrap) sx = 0; }    // clampX is 0 for every class
      if (sy < 0 || sy >= s.mh) { if (!wrap) sy = 0; else sy = y; }
      storeMapPixel(s, x, y, sx, sy);
    }
    s.buildRow = ++y;
    if (y >= s.mh) { s.mapComplete = true; return; }
  }
}

function ensureMap(s: EngineShift, w: number, h: number): void {   // 0x180410e60
  if (w !== s.mw || h !== s.mh) allocMaps(s, w, h, false);      // reallocate with the morph OFF
  if (s.map && !s.mapComplete) {
    s.animIdx = 18; freeAnimMaps(s);                            // give up on the morph, finish NOW
    s.building = true;
    while (!s.mapComplete) buildRows(s);
    s.building = false;
  }
  if (s.prev) allocMaps(s.prev, 0, 0, 0);                       // release prev's map
}

function selectMap(s: EngineShift): Int32Array | null {         // 0x18041192c
  var idx = s.animIdx;
  if (idx >= 18 || !s.animMap) return s.map;
  var hold = s.animHold;                                        // read, THEN decrement
  s.animHold = hold - 1;
  if (hold < 1) {
    idx = ++s.animIdx;
    s.animHold = A.rand() % 15 + 1;
    if (idx > 17) { freeAnimMaps(s); return s.map; }
  }
  return s.animMap[idx];
}

// ---------------------------------------------------------------- class instantiation
function makeShift(name: string): EngineShift {
  var NS = A.BatteryWarps, Ctor = NS && (NS as unknown as Record<string, (new () => BatteryShift) | undefined>)[name];
  if (!Ctor && NS && NS.list) { var L = NS.list(); Ctor = L && L[SHIFT_NAMES.indexOf(name)]; }
  var s = (Ctor ? new Ctor() : { warp: function () {}, randomize: function () {}, setParams: function () {},
                               setSize: function () {}, placeholder: true }) as EngineShift;
  s.className = name;
  if ((s as { compatMask?: number }).compatMask === undefined) s.compatMask = SHIFT_MASK[name] || 0;
  if ((s as { identityRecovery?: boolean }).identityRecovery === undefined) s.identityRecovery = !NO_IDENTITY[name];
  // engine-side map state (base ctor 0x18040f308): animIdx 18 = "no morph", animHold 15
  s.map = null; s.animMap = null; s.animIdx = 18; s.animHold = 15;
  s.mapComplete = false; s.building = false; s.buildRow = 0;
  s.mw = 0; s.mh = 0; s.cx = 0; s.cy = 0; s.prev = null;
  return s;
}

function makeDraw(name: string): EngineDraw {
  var NS = A.BatteryDraws, Ctor = ((NS as unknown as Record<string, BatteryDrawCtor | null | undefined>)[name]);
  if (!Ctor && NS && NS.list) { var L = NS.list(); Ctor = L && L[DRAW_NAMES.indexOf(name)]; }
  var e = (Ctor ? new Ctor() : { draw: function () {}, randomize: function () {}, setParams: function () {},
                               setSize: function () {}, placeholder: true }) as EngineDraw;
  e.className = name;
  if ((e as { compatMask?: number }).compatMask === undefined) e.compatMask = DRAW_MASK[name] || 0;
  return e;
}

function setParams(e: EngineShift | EngineDraw, dbl: number[]): void {      // 0x180413230 + Recalc
  if (e.setParams) e.setParams(dbl);
  else for (var i = 0; i < 8; i++) (e as unknown as Record<string, unknown>)['dbl' + i] = dbl[i];
  if ((e as { map?: unknown }).map !== undefined) recalc(e as EngineShift);   // shifts invalidate their map
}
function reset(e: EngineShift | EngineDraw): void { e.randomize(); if ((e as { map?: unknown }).map !== undefined) recalc(e as EngineShift); }   // Reset = 0x1804133f0

// ---------------------------------------------------------------- CPreset (§7.3)
class Preset {
  declare eng: Battery;
  declare data: PresetData | null;
  declare shift: EngineShift | null;
  declare movementCurrent: EngineShift | null;
  declare movementNext: EngineShift | null;
  declare pre: EngineDraw[];
  declare post: EngineDraw[];
  declare w: number;
  declare h: number;
  declare autoEffects: boolean;
  declare autoMovement: boolean;
  declare effectsTimer: number;
  declare movementTimer: number;
  declare paused: boolean;
  declare naming: boolean;
  declare build: number;

  constructor(eng: Battery, data: PresetData | null, build?: number) {
    this.eng = eng;
    this.build = build || 12;
    this.data = data || null;                 // null == the synthesised Randomization preset
    this.shift = null;                        // CWarper+0x08
    this.movementCurrent = null; this.movementNext = null;
    this.pre = []; this.post = [];
    this.w = 0; this.h = 0;
    this.autoEffects = !data; this.autoMovement = !data;   // 1,1 for Randomization; 0,0 for saved
    this.effectsTimer = 0; this.movementTimer = 0;
    this.paused = false; this.naming = false;
  }

  setSize(w: number, h: number): void { this.w = w; this.h = h; this.naming = false; this.paused = false; }

  activate(): void {                       // 0x180414540 / 0x180414570
    this.w = this.h = 0;                                          // literal: nothing calls SetSize again
    this.effectsTimer = this.movementTimer = 0;                   // => both randomizers fire next frame
    if (this.data) this.loadPreset();
  }

  deactivate(): void {                     // 0x180414780 — gated on bAutoMovement
    if (!this.autoMovement) return;                               // no-op for every saved preset
    this.shift = null; this.movementCurrent = null; this.movementNext = null;
  }

  // LoadFromRegistry (0x1804149c0) against the embedded table instead of HKCU.
  loadPreset(): void {
    var eng = this.eng, d = this.data!, i: number, e: EngineDraw;
    this.pre.length = 0; this.post.length = 0;
    for (i = 0; i < d[5].length; i++) { e = eng.drawByName[d[5][i][0]]; if (e) { setParams(e, d[5][i][1]); this.pre.push(e); } }
    for (i = 0; i < d[6].length; i++) { e = eng.drawByName[d[6][i][0]]; if (e) { setParams(e, d[6][i][1]); this.post.push(e); } }
    var s = eng.shiftByName[d[3]];
    if (s) { setParams(s, d[4]); this.movementCurrent = s; this.shift = s; }
    else this.scheduleMovement();
    eng.palettePaused = d[7] !== 0;
    if (eng.palettePaused) { eng.TO.set(d[8] ? presetPalette(d[8]) : eng.LIVE); eng.paletteChangeRequested = true; }
  }

  // ---- the two down-counters (§8.2) ----
  scheduleMovement(): void {               // 0x180414ea0
    var m = (this.h / 3) | 0;
    this.movementTimer = A.rand() % 390 + (m > 60 ? m : 60);
    this.randomizeMovement();
  }
  scheduleEffects(): void {                // 0x180414e40
    this.effectsTimer = A.rand() % 310 + 90;
    this.randomizeEffects();
  }

  randomizeMovement(): void {              // 0x180415f40
    var eng = this.eng, reg = eng.shifts, n = reg.length;
    if (this.movementCurrent) allocMaps(this.movementCurrent, 0, 0, 0);   // free the outgoing map
    var B = this.movementNext;
    this.movementNext = null;
    this.movementCurrent = B;
    this.shift = B;
    if (n <= 0) return;
    var C: EngineShift;
    do { C = reg[A.rand() % n]; this.movementNext = C; } while (C === this.movementCurrent && n > 1);
    if (C) { allocMaps(C, eng.w, eng.h, eng.transitions); reset(C); }
    if (this.movementCurrent === null) this.randomizeMovement();   // cold start: recurse once
    else if (this.movementNext) this.movementNext.prev = this.movementCurrent;   // arm the 18-step morph
  }

  randomizeEffects(): void {               // 0x180415d60
    var reg = this.eng.draws, n = reg.length, e: EngineDraw;
    this.pre.length = 0; this.post.length = 0;
    var k = A.rand() % 2;                                         // 0 or 1 border effects, always PRE
    while (k > 0) {
      e = reg[A.rand() % n];
      if (e.compatMask & 1) { reset(e); this.pre.push(e); k--; }  // rejection sampling burns rand()
    }
    var m = (((A.rand() % 4 + 1) / 4) | 0) + 1;                   // 1, or 2 with probability 1/4
    while (m > 0) {
      e = reg[A.rand() % n];
      if (e.compatMask & 2) {
        reset(e);
        var toPre = (A.rand() & 1) !== 0;                         // +0xe4 is dead: always the coin flip
        (toPre ? this.pre : this.post).push(e);
        m--;
      }
    }
  }

  // ---- CPreset::Render, 0x1804155a0 ----
  render(L: TimedLevel): void {
    if (!this.paused && !this.naming) { this.movementTimer--; this.effectsTimer--; }
    if (this.autoMovement && this.movementTimer <= 0) this.scheduleMovement();
    if (this.autoEffects && this.effectsTimer <= 0) this.scheduleEffects();
    if (this.movementNext) buildRows(this.movementNext);          // 3 rows/frame, incl. the morph maps
    this.renderChain(L);
  }

  // ---- RenderChain, 0x1804145c0 — the pipeline, two swaps ----
  renderChain(L: TimedLevel): void {
    var eng = this.eng, i: number, e: EngineDraw;
    var mask = this.movementCurrent ? this.movementCurrent.compatMask : 0;
    var ctx = eng.dctx;
    ctx.level = L; ctx.frame = eng.frame;

    ctx.pre = true; ctx.buf = eng.front;
    for (i = 0; i < this.pre.length; i++) {
      e = this.pre[i];
      if ((mask & e.compatMask) === 0) e.draw(ctx as unknown as BatteryDrawCtx);   // CTileShift suppresses border draws
    }

    eng.applyWarp(this.shift);                                    // swap #1

    ctx.pre = false; ctx.buf = eng.front;
    for (i = 0; i < this.post.length; i++) this.post[i].draw(ctx as unknown as BatteryDrawCtx);  // no mask on the post pass

    eng.swap();                                                   // swap #2
    blur(eng.back, eng.front, eng.w, eng.h);
  }
}

// ---------------------------------------------------------------- the frame render() returns
// front shown through LIVE32, which the DLL expands into its 32-bit DIB every frame (§1). Here px is
// expanded when something reads it (the 2D presenter, a hash, a test): the WebGL2 presenter looks
// the colours up itself from idx and pal (engine/gl.ts), so on that path the pass never runs. front
// and LIVE32 change only in render() and resize(), so a late expansion is still the last frame.
class Frame implements Surface {
  declare eng: Battery;
  declare w: number;
  declare h: number;
  declare out: Uint32Array;
  declare stale: boolean;                // out is not this frame yet: the next read of px expands it

  constructor(eng: Battery, w: number, h: number, out: Uint32Array) {
    this.eng = eng; this.w = w; this.h = h; this.out = out; this.stale = false;
  }

  get px(): Uint32Array {
    if (this.stale) {
      this.stale = false;
      var px = this.out, pal = this.eng.LIVE32, src = this.eng.front, n = this.w * this.h;
      if (!paletteWasm(src, pal, px, n)) for (var i = 0; i < n; i++) px[i] = pal[src[i]];
    }
    return this.out;
  }

  // null once px has been read: whoever read it may have written it, and it is the frame from then on
  get idx(): Uint8Array | null { return this.stale ? this.eng.front : null; }
  get pal(): Uint32Array { return this.eng.LIVE32; }
}

// ---------------------------------------------------------------- CBattery
interface BatteryDebugInfo {
  engine: string; preset: number; presetName: string; build: number;
  size: string; frame: number; swaps: number;
  movement: string | null; movementNext: string | null;
  movementTimer: number; effectsTimer: number;
  auto: string;
  pre: string | null; post: string | null;
  morph: string | null;
  mapRows: string | null;
  palette: string;
  placeholders: string[];
}

class Battery {
  declare options: BatteryOptions;
  declare shifts: EngineShift[];
  declare draws: EngineDraw[];
  declare shiftByName: Record<string, EngineShift>;
  declare drawByName: Record<string, EngineDraw>;
  declare FROM: Uint8Array;
  declare LIVE: Uint8Array;
  declare TO: Uint8Array;
  declare LIVE32: Uint32Array;
  declare palettePaused: boolean;
  declare paletteAutoCycle: boolean;
  declare paletteChangeCountdown: number;
  declare paletteChangeRequested: boolean;
  declare paletteFading: boolean;
  declare paletteDirty: boolean;
  declare paletteFadeLen: number;
  declare paletteFadeCtr: number;
  declare transitions: boolean;
  declare idleDecay: number;
  declare presetChanged: boolean;
  declare frame: number;
  declare swaps: number;
  declare presets: Preset[];
  declare preset: number;
  declare dctx: DrawCtx;
  declare w: number;
  declare h: number;
  declare front: Uint8Array;
  declare back: Uint8Array;
  declare surface: Frame;
  declare last: Surface;
  declare allocPending: boolean;
  declare presetNames: string[];
  /** the arithmetic of this WMP build: 12 (the x64 DLL the base presets port), or 8, 9, 10, 11 */
  declare build: number;

  static PRESET_NAMES: string[] = PRESET_NAMES;
  static RESOLUTIONS: number[][] = RES_TABLE;
  static internals: {
    BLUR_LUT: Uint8Array; blur: typeof blur; line: typeof line;
    allocMaps: typeof allocMaps; buildRows: typeof buildRows; selectMap: typeof selectMap; ensureMap: typeof ensureMap;
    storeMapPixel: typeof storeMapPixel; recalc: typeof recalc; presetPalette: typeof presetPalette;
    PRESETS: PresetData[]; SHIFT_NAMES: string[]; DRAW_NAMES: string[]; INV19: number;
  };

  constructor(cfg?: BatteryConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);

    // the two singleton registries; a missing class becomes a no-op with the right compat mask
    var i: number;
    this.shifts = SHIFT_NAMES.map(makeShift);
    this.draws = DRAW_NAMES.map(makeDraw);
    this.shiftByName = {}; this.drawByName = {};
    for (i = 0; i < this.shifts.length; i++) this.shiftByName[SHIFT_NAMES[i]] = this.shifts[i];
    for (i = 0; i < this.draws.length; i++) this.drawByName[DRAW_NAMES[i]] = this.draws[i];
    for (i = 0; i < this.shifts.length; i++) this.shifts[i].build = 12;
    for (i = 0; i < this.draws.length; i++) this.draws[i].build = 12;

    // three palettes, PALETTEENTRY{R,G,B,flags} bytes, + the expanded 0x00RRGGBB view
    this.FROM = new Uint8Array(1024);
    this.LIVE = new Uint8Array(1024);
    this.TO = new Uint8Array(1024);
    for (i = 0; i < 256; i++) this.LIVE[i * 4 + 2] = i;          // the ctor's blue ramp (0x18040b4b0)
    this.LIVE32 = new Uint32Array(256);
    this.LIVE32[255] = 0x0000FF;                                 // never uploaded; keeps CreatePalette's value
    this.rebuildLive32();

    this.palettePaused = false;          // obj+0xd0 == PaletteLocked
    this.paletteAutoCycle = true;        // obj+0xd1
    this.paletteChangeCountdown = 0;     // obj+0xd4 — so a new palette fires on frame 1
    this.paletteChangeRequested = false;
    this.paletteFading = false;
    this.paletteDirty = false;
    this.paletteFadeLen = 0;
    this.paletteFadeCtr = 0;

    this.transitions = true;             // obj+0x62: the memory gate passes on anything modern
    this.idleDecay = 0;                  // obj+0xfec
    this.presetChanged = false;          // obj+0xfe8
    this.frame = 0;
    this.swaps = 0;

    var self = this;
    this.presets = [];
    this.presets.push(new Preset(this, null));
    PRESETS.forEach(function (d: PresetData) { self.presets.push(new Preset(self, d)); });
    VARIANTS.forEach(function (v) { self.presets.push(new Preset(self, v[0] ? PRESETS[v[0] - 1] : null, v[1])); });
    this.preset = 0;
    this.build = 12;

    // the draw context (CONTRACT v3): TimedLevel passes through unchanged, audio stays empty
    // (the draw classes carry their own Line/LineClamped/Stroke primitives — see 72-battery-draws.js)
    this.dctx = { buf: null, w: 0, h: 0, level: null, frame: 0, pre: true, audio: {} };

    // CreateInstance order (0x18040ba20): operator new(0xff0) -> CBattery::CBattery 0x18040b4b0
    // (which builds BOTH registries at 0x18040f470, so every effect ctor's rand() runs on the CRT's
    // *default* seed) -> only THEN srand(time(NULL)) at 0x18040bd40 -> presets[0]->Activate().
    // Seeding before the registries would randomise CJDar's base colour, its anchor and every other
    // ctor roll per run; the real object's are fixed. Order is load-bearing, do not hoist.
    A.srand((Date.now() / 1000) | 0);          // 0x18040bd38 time(NULL) -> 0x18040bd40 srand
    // AllocAll (=> SetSize on every preset) is only reached on the first Render in the DLL, after
    // this Activate zeroed the preset's w/h — which is why Randomization's first movement period
    // really does see h = 288. resize() below stands in for it and must stay after the activate.
    this.presets[0].activate();                                  // Battery boots into Randomization
    var res = RES_TABLE[cfg.resolution === undefined ? 1 : cfg.resolution] || RES_TABLE[1];
    this.resize(cfg.width || res[0], cfg.height || res[1]);
    if (cfg.preset) this.setPreset(cfg.preset | 0);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  // AllocAll, 0x18040b8a4. Render never reallocates; only a resolution change (here: the host asking
  // for a different buffer size) gets this far, and it clears both buffers and re-SetSizes the presets.
  resize(w: number, h: number): void {
    this.w = Math.max(2, w | 0);
    this.h = Math.max(2, h | 0);
    // In the WebAssembly kernel's memory when there is one (kernel.ts), zeroed either way.
    if (this.surface) void this.surface.px;                     // the old frame keeps its last image
    var ar = newArena(this.w * this.h);
    this.front = ar ? ar.front : new Uint8Array(this.w * this.h);
    this.back = ar ? ar.back : new Uint8Array(this.w * this.h);
    this.surface = new Frame(this, this.w, this.h, ar ? ar.px : new Uint32Array(this.w * this.h));
    this.dctx.w = this.w; this.dctx.h = this.h;
    for (var i = 0; i < this.presets.length; i++) this.presets[i].setSize(this.w, this.h);
    for (i = 0; i < this.draws.length; i++) this.draws[i].setSize(this.w, this.h);
    this.last = this.surface;
    // AllocAll itself runs on the first Render after an allocation (Render gates it on
    // front->bits == NULL, 0x18040e298), i.e. AFTER SetCurrentPreset has run LoadFromRegistry.
    // Its SetSize sweep is what unlocks the palette — see the flag's use in render().
    this.allocPending = true;
  }

  swap(): void {
    var t = this.front; this.front = this.back; this.back = t;
    this.swaps++;
  }

  // CWarper::Apply, 0x180412460
  applyWarp(s: EngineShift | null): void {
    if (!s) return;
    ensureMap(s, this.w, this.h);
    if (!s.map) return;
    this.swap();
    var m = selectMap(s)!, dst = this.front, src = this.back, n = this.w * this.h;
    for (var i = 0; i < n; i++) dst[i] = src[m[i]];
  }

  // ---------------------------------------------------------------- palette (§5)
  rebuildLive32(): void {
    var L = this.LIVE, p = this.LIVE32;
    for (var i = 0; i < 255; i++) p[i] = (L[i * 4] << 16) | (L[i * 4 + 1] << 8) | L[i * 4 + 2];
  }

  gradient(start: number, end: number, key: Uint8Array, j: number): void {   // 0x180413138
    if (start > end) return;
    var span = F32(end - start + 1), TO = this.TO;
    for (var i = start; i <= end; i++) lerpInto(TO, i * 4, key, j * 3, key, (j + 1) * 3, F32(F32(i - start) / span), this.build !== 12);
  }

  buildPalette(fadeFrames: number, nKeys: number, key: Uint8Array): void {   // 0x180413838
    if (nKeys <= 1) return;
    var start = 0;
    for (var j = 0; j < nKeys - 1; j++) {
      var end = start + ((256 / (nKeys - 1)) | 0);
      if (j === nKeys - 2) end = 255;                            // last span forced to land on 255
      this.gradient(start, end, key, j);
      start = end;                                               // spans overlap by one entry
    }
    this.FROM.set(this.LIVE);
    this.paletteFadeLen = this.paletteFadeCtr = fadeFrames;
    this.paletteFading = true;
  }

  newPalette(): void {                   // 0x180412790
    var r1 = A.rand(), r2 = A.rand(), r3 = A.rand();
    var nKeys = r3 % ((r1 % 10 !== 0) ? 4 : 10) + 2;             // 2..5, or 2..11 one time in ten
    var key = new Uint8Array(11 * 3), lum = new Int32Array(11), i: number, g: number, b: number, r: number;
    // rand() order is g, b, r; the x86 builds evaluate RGB()'s operands right to left: b, g, r (WMP 9 0x07797906)
    var x86 = this.build !== 12;
    if (x86) { b = A.rand() % 32; g = A.rand() % 32; r = A.rand() % 32; }
    else { g = A.rand() % 32; b = A.rand() % 32; r = A.rand() % 32; }
    key[0] = r; key[1] = g; key[2] = b;                          // key 0 is guaranteed dark
    if (x86) { b = A.rand() % 32; g = A.rand() % 32; r = A.rand() % 32; }
    else { g = A.rand() % 32; b = A.rand() % 32; r = A.rand() % 32; }
    key[3] = ~r & 0xFF; key[4] = ~g & 0xFF; key[5] = ~b & 0xFF;  // key 1 is guaranteed bright
    for (i = 2; i < nKeys; i++) {
      if (x86) { b = A.rand() % 256; g = A.rand() % 256; r = A.rand() % 256; }
      else { g = A.rand() % 256; b = A.rand() % 256; r = A.rand() % 256; }
      key[i * 3] = r; key[i * 3 + 1] = g; key[i * 3 + 2] = b;
    }
    for (i = 0; i < nKeys; i++) lum[i] = key[i * 3] + key[i * 3 + 1] + key[i * 3 + 2];
    var desc = (r2 % 10 === 0), j: number, t: number;
    // Exchange sort, not bubble: every later key is compared against the pass's anchor key i and
    // swapped into it (strict compare, so equal sums keep the DLL's tie order; asm 0x180412960-9a8).
    for (i = 0; i < nKeys - 1; i++) {
      for (j = i + 1; j < nKeys; j++) {
        if (desc ? lum[i] < lum[j] : lum[j] < lum[i]) {
          t = lum[i]; lum[i] = lum[j]; lum[j] = t;
          for (var c = 0; c < 3; c++) { t = key[i * 3 + c]; key[i * 3 + c] = key[j * 3 + c]; key[j * 3 + c] = t; }
        }
      }
    }
    this.buildPalette(A.rand() % 250, nKeys, key);
  }

  updatePalette(): boolean {                // 0x180412510
    if (this.paletteChangeRequested) {
      this.paletteChangeRequested = false;
      this.paletteDirty = true;
      this.FROM.set(this.LIVE);
      this.paletteFading = true;
      this.paletteFadeLen = this.paletteFadeCtr = 25;             // a requested change always fades in 25
    }
    if (!this.palettePaused || this.paletteDirty) {
      if (this.paletteFading) {
        // WMP 8 (591cd47a) has no fadeLen > 0 guard: a 0-frame fade divides 0/0, and LerpColour's ftol of the NaN
        // (0x80000000) adds 0 to each byte, so LIVE stays FROM until the next fade. JS's NaN | 0 is that 0.
        var t = this.paletteFadeLen > 0 || this.build === 8
          ? F32(F32(this.paletteFadeLen - this.paletteFadeCtr) / F32(this.paletteFadeLen)) : 1.0;
        var x86 = this.build !== 12;
        for (var i = 0; i < 256; i++) lerpInto(this.LIVE, i * 4, this.FROM, i * 4, this.TO, i * 4, t, x86);
        if (--this.paletteFadeCtr < 1) {
          this.paletteFading = this.paletteDirty = false;
          if (this.paletteAutoCycle) this.paletteChangeCountdown = A.rand() % 600;
        }
        return true;                                             // t never reaches 1: LIVE never equals TO
      }
      if (this.paletteAutoCycle && --this.paletteChangeCountdown < 1) this.newPalette();
    }
    return false;
  }

  // ---------------------------------------------------------------- presets (IWMPEffects +0x48)
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= this.presets.length) return false;         // E_INVALIDARG
    if (n === this.preset) return true;                          // a same-index call is a complete no-op
    this.presets[this.preset].deactivate();
    this.preset = n;
    this.presetChanged = true;                                   // next render() reports S_FALSE once
    this.setBuild(this.presets[n].build);                         // before Activate: SetParams/Recalc use it
    this.presets[n].activate();                                  // note: the framebuffers are NOT cleared
    return true;
  }

  /** Switch every class singleton to build b's arithmetic (a variant preset's; no-op if unchanged). */
  setBuild(b: number): void {
    if (b === this.build) return;
    this.build = b;
    var all = (this.shifts as { build?: number; setBuild?(b: number): void }[]).concat(this.draws);
    for (var i = 0; i < all.length; i++) { all[i].build = b; if (all[i].setBuild) all[i].setBuild!(b); }
  }

  // ---------------------------------------------------------------- one Render (§1)
  render(L: TimedLevel): Surface | null {
    if (!L) return this.last;
    // AllocAll (0x18040b8a4), reached from Render BEFORE the state switch while front->bits is NULL.
    // Its SetSize sweep covers preset 0 (Randomization), whose SetSize is the RAW 0x1804160b0 —
    // the saved-preset override 0x180416100, which saves and restores engine+0xc8 around the call,
    // is NOT in Randomization's vtable (0x1807a7f70 +0x28 == 0x1804160b0). 0x1804160b0 calls
    // vt[0x88] = 0x180414710, which ends with `*(char*)(preset[2] + 200) = (char)preset[0xd1]`,
    // i.e. engine->bPalettePaused = that preset's own saved copy (0). So the first Render UNLOCKS
    // the palette of whatever locked preset was selected before it, and UpdatePalette's auto-cycle
    // then replaces the stored palette rand()%600 frames after the 25-frame registry fade ends.
    // Verified on the real object with the clock pinned and _o_rand hooked: preset 13 at seed
    // 1700000000 draws countdown 262 at frame 23 and calls NewPalette at frame 285; preset 20 draws
    // 151 and fires at 174 — the port now matches both frame for frame. A preset selected AFTER the
    // first Render keeps bPalettePaused = 1 and never drifts (confirmed against the real object by the private harness).
    // The sweep also gives the active preset its size: a preset Activated after the constructor (setPreset before
    // the first render, as the host does) has w = h = 0 until here, and Randomization's movement period reads h.
    if (this.allocPending) {
      this.allocPending = false;
      for (var pi = 0; pi < this.presets.length; pi++) this.presets[pi].setSize(this.w, this.h);
      this.palettePaused = false;
    }
    switch (L.state) {
      case 0:                                                    // STOPPED
        if (this.idleDecay < 1) {
          this.surface.stale = false;                            // px itself is the frame here
          this.surface.px.fill(this.LIVE32[1]);                   // FillRect(LIVE[1]) and no blit
          return (this.last = this.surface);
        }
        this.swap();                                             // the stopped branch swaps ONCE
        blur(this.back, this.front, this.w, this.h);
        this.idleDecay--;
        var w = this.w, h = this.h, f = this.front;
        line(f, w, h, 0, 0, w - 1, 0, 1); line(f, w, h, 0, h - 1, w - 1, h - 1, 1);
        line(f, w, h, 0, 0, 0, h - 1, 1); line(f, w, h, w - 1, 0, w - 1, h - 1, 1);
        break;
      case 1: return this.last;                                  // PAUSED: the last frame is re-blitted
      case 2:                                                    // PLAYING
        this.idleDecay = 300;
        this.frame++;
        if (this.updatePalette()) this.rebuildLive32();
        this.presets[this.preset].render(L);
        break;
      default: return this.last;
    }
    this.presetChanged = false;               // the DLL returns S_FALSE once here; a port may ignore it
    this.surface.stale = true;                // the palette pass runs when px is read (Frame)
    return (this.last = this.surface);
  }

  debug(): BatteryDebugInfo {
    var p = this.presets[this.preset];
    var names = function (a: EngineDraw[]): string | null { return a.map(function (e) { return e.className; }).join('+') || null; };
    var cur = p.movementCurrent, nxt = p.movementNext;
    return {
      engine: 'Battery', preset: this.preset, presetName: PRESET_NAMES[this.preset], build: this.build,
      size: this.w + 'x' + this.h, frame: this.frame, swaps: this.swaps,
      movement: cur ? cur.className : null, movementNext: nxt ? nxt.className : null,
      movementTimer: p.movementTimer, effectsTimer: p.effectsTimer,
      auto: (p.autoMovement ? 'M' : '-') + (p.autoEffects ? 'E' : '-'),
      pre: names(p.pre), post: names(p.post),
      morph: cur ? (cur.animIdx >= 18 ? 'off' : cur.animIdx + '/18 hold ' + cur.animHold) : null,
      mapRows: nxt ? nxt.buildRow + '/' + nxt.mh : null,
      palette: (this.palettePaused ? 'locked' : 'cycling') +
        (this.paletteFading ? ' fade ' + (this.paletteFadeLen - this.paletteFadeCtr) + '/' + this.paletteFadeLen
                            : ' next in ' + this.paletteChangeCountdown),
      placeholders: (this.shifts as (EngineShift | EngineDraw)[]).concat(this.draws).filter(function (e) { return e.placeholder; })
        .map(function (e) { return e.className; }).filter(function (v, i, a) { return a.indexOf(v) === i; })
    };
  }
}

// LerpColour, 0x180411c58 — per channel, truncating, float32 t. peFlags is not touched. x86 (every build 8-11,
// WMP 9 0x07798052): the product (b-a)*t stays in an x87 register at 53 bits and is truncated from there.
function lerpInto(out: Uint8Array, o: number, a: Uint8Array, ao: number, b: Uint8Array, bo: number, t: number, x86?: boolean): void {
  if (x86) { for (var k = 0; k < 3; k++) out[o + k] = a[ao + k] + (((b[bo + k] - a[ao + k]) * t) | 0); return; }
  for (var c = 0; c < 3; c++) out[o + c] = a[ao + c] + (F32(F32(b[bo + c] - a[ao + c]) * t) | 0);
}

Battery.prototype.presetNames = PRESET_NAMES;

// exported for tests
Battery.internals = { BLUR_LUT: BLUR_LUT, blur: blur, line: line,
  allocMaps: allocMaps, buildRows: buildRows, selectMap: selectMap, ensureMap: ensureMap,
  storeMapPixel: storeMapPixel, recalc: recalc, presetPalette: presetPalette,
  PRESETS: PRESETS, SHIFT_NAMES: SHIFT_NAMES, DRAW_NAMES: DRAW_NAMES, INV19: INV19 };

A.Battery = Battery;
export { Battery };

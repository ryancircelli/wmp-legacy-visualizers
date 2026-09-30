// Alchemy.Bars — Windows Media Player's "Bars and Waves" (wmp.dll, class at 0x18041ca48).
// Spec: spec/wmp/FUNCTION-MAP-WMP.md §2. Same engine API as Alchemy.Engine plus setPreset(i)/preset.
// No internal surface in the DLL: it renders straight into a DIB the size of the window rect,
// so the shell's "original" size for this engine is the window itself.
// Wrapped verbatim from src/60-bars.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A, type Surface, type TimedLevel } from './ns';
import './rand';
import './effect'; // A.makeSurface
import { newArena, arenaOf } from './bars-kernel';

var F32 = Math.fround;
var HZ_PER_BIN = 21.513671875;          // float32 at 0x18088c624 — hardcoded, never from the real Fs

// The three .rdata tables, byte-exact from wmp.dll (regenerate with tools/bars_tables.py).
// None is a clean formula: T_lin is 10^(8v/255) rounded to ~7 decimal digits, and
// T_mant/T_exp are a hand-tuned round(32*log10(x)) off the float bits (§2.8).
var T_LIN_HEX = '00000000af96893f43e5933f7ff99e3f2ae2aa3f42afb73fd271c53f433cd43f5722e43f5439f53f08cc034086ab0d405e481840bcb02340dcf32f4025223d40344d4b40f9875a40c9e66a40917f7c40e3b487405fdf9140cdcc9c40cc8ba8400a2cb5406cbec2401355d1407b03e140a0def14082fe014171bb0b411e3316418c732141b78b2d41d68b3a4149854841bb8a574140b06741630b7941afd9854190e08f41bba79a41953da6419fb1b2417b14c0410978ce418eefdd41ab8fee414e37004223d20942292514422d3e1f42032c2b429efe374221c74542f6975442ed84644249a37542f9048442bde88d422b8a984274f7a342e33fb042de73bd4212a5cb4266e6da424a4ceb42a5ecfc4283ef0743631e12438a101d439cd42843517a35438f12434383af5143b664614324477243ae368243cff78b43057496434bb9a143b5d6ad4374dcba43f1dbc843dce7d7435714e843fa76f94383130644ba1e10448eea1a446c852644d6fe32447a67404441d14e44714f5e44bdf66e44b06e8044b20d8a4427659444fa829f44fc75ab441d4eb844931cc644cff3d444a6e7e444680df644043e04450c260e4514cc18454e3e2445088c3045bac53d450afd4b45fa445b45f4b16b45f0597d45422a8845875d924568549d458f1da945bac8b545d966c3451f0ad24519c6e145d1aff245f06e02464a340c4605b5164629ff2146d7212e46332d3b46b8324946294558469a786846c3e27946714d8646005d90467b2d9b465ccda6462e4cb3469abac0469f2acf4680afde46fb5def4633a6004754490a474aa51447e6c71f470dc02b47c09d38472e724647d44f55478f4a6547bb777647267784477a638e47180e99474585a44752d8b047b817be472655cc47b3a3db47cd17ec4766c7fd471a650848c69c124866981d48a06629484617364846bb4348e0645248a6276248ad1873484aa78248dd708c4823f696482a45a2480d6dae48107ebb48a689c94896a2d8480ddde848bd4efa487a8706495e9b104988701b4970152749a5993349e00d414920844f49b60f5f496ac56f49c8dd804918858a4980e59449f00ca049400aac4988edb849f0c7c64900acd549a0ade54938e2f64964b0044a00a10e4a3c50194a5ccc244abc24314adc693e4a74ad4c4a9c025c4acc7d6c4a0c357e4a06a0884a1edc924a7cdc9d4ad4afa94af465b64ada0fc44ac6bfd24a5c89e24ab681f34abfdf024b8cad0c4b5d37174b4a8b224b70b82e4b10cf3b4bbee0494b3000594bac41694be0ba7a4b99c1864bdbd9904bb0b39b4ba05da74b3ce7b34b4b61c14bcaddcf4b1970df4b052df04b7615014cf0c00a4cd825154c1752204c9a542c4c6a3d394ccf1d474c5008564cde10664ce64c774cb8e9844c9ede8e4c7892994c9013a54c4571b14c20bcbe4c';
var T_MANT_STEPS = [76, 235, 406, 590, 787, 1000, 1228, 1473, 1737, 2020];
var T_EXP0 = -1218, T_EXP_STEPS = '110101101011010110101011010110101101011010110101101011010110101011010110101101011010110101101011010110101011010110101101011010010101101011010110101101010110101101011010110101101011010110101101010110101101011010110101101011010110101101010110101101011010110';
var T_lin = new Float32Array(256), T_mant = new Int32Array(2048), T_exp = new Int32Array(256);
(function () {
  var dv = new DataView(new ArrayBuffer(4)), i, k;
  for (i = 0; i < 256; i++) {
    for (k = 0; k < 4; k++) dv.setUint8(k, parseInt(T_LIN_HEX.substr(i * 8 + k * 2, 2), 16));
    T_lin[i] = dv.getFloat32(0, true);
  }
  for (i = 1, k = 0; i < 2048; i++) T_mant[i] = T_mant[i - 1] + (i === T_MANT_STEPS[k] ? (k++, 1) : 0);
  T_exp[0] = T_EXP0;
  for (i = 1; i < 256; i++) T_exp[i] = T_exp[i - 1] + 9 + (+T_EXP_STEPS[i - 1]);
})();
// fastLog32 (0x18041d070..0x18041d091): T_mant[(bits >> 12) & 0x7FF] + T_exp[(bits >> 23) & 0xFF].
var _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function fastLog32(x: number): number { _f[0] = x; var b = _u[0]; return T_mant[(b >>> 12) & 0x7FF] + T_exp[(b >>> 23) & 0xFF]; }

var PRESET_NAMES: string[] = ['Bars', 'Ocean Mist', 'Fire Storm', 'Scope'];
// §2.7. Only the fields each preset actually writes: "not set" keeps the current value,
// which is stateful across preset switches exactly as SetCurrentPreset is.
interface BarsPresetFields {
  levelColor?: number; peakColor?: number; displayMode?: number; levelWidth?: number;
  levelFallbackSpeed?: number; peakHangTime?: number; fadeMode?: number; fadeRate?: number;
  horizontalSpacing?: number; showPeaks?: boolean;
}
var PRESETS: BarsPresetFields[] = [
  // DLL literals are 0x00B020 / 0x2020FF; WMP's default skin overrides both (levelColor/peakColor are
  // VT_BSTR wmpskin: refs). Values below are what the user's WMP Legacy actually shows (captured 2026-09-22).
  { levelColor: 0xA4EB0C, peakColor: 0xDFEAF7, displayMode: 1, levelWidth: 5, levelFallbackSpeed: 4.0,
    peakHangTime: 4, fadeMode: 0, horizontalSpacing: 1, showPeaks: true },
  { levelColor: 0x0000FF, peakColor: 0xFFFFFF, displayMode: 2, levelWidth: 0, levelFallbackSpeed: 4.0,
    fadeMode: 4, fadeRate: 20, horizontalSpacing: 0, showPeaks: true },
  { levelColor: 0xFFA500, peakColor: 0xFF0000, displayMode: 2, levelWidth: 0, levelFallbackSpeed: 4.0,
    fadeMode: 1, fadeRate: 15, horizontalSpacing: 0, showPeaks: true },
  { levelColor: 0xA0FFA0, displayMode: 3, fadeMode: 0, horizontalSpacing: 0, showPeaks: true }
];

// ---------------------------------------------------------------- DIB primitives
// The DIB is bottom-up in memory but every primitive takes y from the top, so these write
// a top-down Surface directly. Rects are INCLUSIVE on both ends (x2 is pre-decremented by
// the caller, y2 = H relies on the primitive clipping) and clipped, never wrapped.
// Both corners are normalised first (0x18044b160 swaps x and y into min/max; the hline 0x18044acc0
// swaps x), so DrawBars' last 1024-line bar, whose x2 is clipped to W-1 below its x, still lands on
// column W-1.
function fillRect(S: Surface, x1: number, y1: number, x2: number, y2: number, c: number): void {
  var t;
  if (x1 > x2) { t = x1; x1 = x2; x2 = t; }
  if (y1 > y2) { t = y1; y1 = y2; y2 = t; }
  if (x1 < 0) x1 = 0;
  if (y1 < 0) y1 = 0;
  if (x2 > S.w - 1) x2 = S.w - 1;
  if (y2 > S.h - 1) y2 = S.h - 1;
  var W = S.w, px = S.px, n = x2 - x1, o = y1 * W + x1, e = y2 * W + x1;
  if (n === 0) { for (; o <= e; o += W) px[o] = c; return; }   // a one-pixel column (Ocean Mist, Fire Storm)
  for (; o <= e; o += W)
    for (var i = o, ie = o + n; i <= ie; i++) px[i] = c;
}
// FUN_18044a7a0: NOT the symmetric Bresenham. Endpoints are ordered left to right, a line with
// any endpoint off the surface is rejected whole (no clipping), horizontal/vertical runs are
// filled, and the diagonal walks start at the left end with err = -major and step the minor
// axis when 2*minor + err >= 1 (the `< 1` tests in the 32 bpp loops, 0x18044a7a0 + 1295 B).
function line(S: Surface, x0: number, y0: number, x1: number, y1: number, c: number): void {
  var xL = x0, yL = y0, xR = x1, yR = y1;
  if (x0 > x1) { xL = x1; yL = y1; xR = x0; yR = y0; }
  if (xL < 0 || xR >= S.w) return;
  if (yR < yL ? (yR < 0 || yL >= S.h) : (yL < 0 || yR >= S.h)) return;
  var W = S.w, px = S.px, dx = xR - xL, dy = Math.abs(yR - yL), sy = yR < yL ? -1 : 1;
  var x = xL, y = yL, e, t, k;
  px[y * W + x] = c;
  if (dy === 0) { while (x < xR) px[y * W + (++x)] = c; return; }
  if (dx === 0) { while (y !== yR) { y += sy; px[y * W + x] = c; } return; }
  if (dx < dy) {
    for (e = -dy, k = 0; k < dy; k++) {
      t = 2 * dx + e;
      if (t < 1) e = t; else { x++; e = t - 2 * dy; }
      y += sy; px[y * W + x] = c;
    }
  } else {
    for (e = -dx, k = 0; k < dx; k++) {
      t = 2 * dy + e;
      if (t < 1) e = t; else { y += sy; e = t - 2 * dx; }
      x++; px[y * W + x] = c;
    }
  }
}
// StepToward (0x18041d880): per 8-bit channel, move toward target by fadeRate without overshoot.
function stepToward(c: number, target: number, rate: number): number {
  var o = 0;
  for (var sh = 16; sh >= 0; sh -= 8) {
    var v = (c >> sh) & 0xFF, t = (target >> sh) & 0xFF;
    v = v < t ? Math.min(t, v + rate) : Math.max(t, v - rate);
    o |= v << sh;
  }
  return o >>> 0;
}

// ---------------------------------------------------------------- the effect
export interface EngineOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
}

export interface BarsConfig {
  width?: number;
  height?: number;
  options?: Partial<EngineOptions>;
  preset?: number;
}

class Bars {
  static PRESET_NAMES = PRESET_NAMES;

  declare options: EngineOptions;
  // IBarsEffect properties, ctor defaults (§2.4)
  declare displayMode: number;
  declare showPeaks: boolean;
  declare peakHangTime: number;
  declare peakFallbackAcceleration: number;
  declare peakFallbackSpeed: number;
  declare levelFallbackAcceleration: number;
  declare levelFallbackSpeed: number;
  declare levelColor: number;
  declare peakColor: number;
  declare horizontalSpacing: number;
  declare levelWidth: number;
  declare levelScale: number;
  declare fadeRate: number;
  declare fadeMode: number;
  declare channels: number;
  declare bgColor: number;

  declare levelValue: Int32Array;
  declare levelSpeed: Float32Array;
  declare peakValue: Int32Array;
  declare peakSpeed: Float32Array;
  declare peakHang: Int32Array;
  declare history: Int32Array;
  declare bandEdge: Float32Array;
  declare buf0: Uint8Array;
  declare buf1: Uint8Array;
  declare levelTrail: Int32Array;
  declare peakTrail: Int32Array;
  declare lv: Int32Array;
  declare pk: Int32Array;

  declare lastTimeStamp: number;
  declare skipUpdate: boolean;
  declare colourDirty: boolean;
  declare trailHead: number;
  declare trailRows: number;
  declare trailActive: number;
  declare lastBarCount: number;
  declare bandN: number;
  declare frame: number;
  declare bars: number;
  declare barW: number;
  declare xoff: number;
  declare preset: number;
  declare terminator: number;
  declare surface: Surface;
  declare w: number;
  declare h: number;

  constructor(cfg?: BarsConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);

    // IBarsEffect properties, ctor defaults (§2.4)
    this.displayMode = 1; this.showPeaks = true; this.peakHangTime = 0;
    this.peakFallbackAcceleration = 0.2; this.peakFallbackSpeed = 1.0;
    this.levelFallbackAcceleration = 0.0; this.levelFallbackSpeed = 5.0;
    this.levelColor = 0x00FFFF; this.peakColor = 0xFF0000;
    this.horizontalSpacing = 1; this.levelWidth = 0; this.levelScale = 1.0;
    this.fadeRate = 20; this.fadeMode = 0;
    this.channels = 2;                                   // MediaInfo->lChannelCount
    this.bgColor = this.options.backgroundColor | 0;

    this.levelValue = new Int32Array(2048); this.levelSpeed = new Float32Array(2048);
    this.peakValue = new Int32Array(2048); this.peakSpeed = new Float32Array(2048);
    this.peakHang = new Int32Array(2048);
    this.history = new Int32Array(2048 * 16);            // history[row][slot], -1 = empty
    this.bandEdge = new Float32Array(1025);
    this.buf0 = new Uint8Array(1024); this.buf1 = new Uint8Array(1024);
    this.levelTrail = new Int32Array(16); this.peakTrail = new Int32Array(16);
    this.lv = new Int32Array(1024); this.pk = new Int32Array(1024);   // DrawBars' per-bar level/peak

    // lastTimeStamp starts at 0 (0x18041cb76), so a first Render with timeStamp 0 is a skip frame.
    this.lastTimeStamp = 0; this.skipUpdate = false; this.colourDirty = false;
    this.trailHead = 0; this.trailRows = 0; this.trailActive = 0;
    this.lastBarCount = 0; this.bandN = 0;
    this.frame = 0; this.bars = 0; this.barW = 0; this.xoff = 0;
    this.preset = 0;

    this.setPreset((cfg.preset as number) | 0);
    this.resize(cfg.width || 640, cfg.height || 480);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  // ---- SetCurrentPreset, 0x18041e290 ----
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n > 3) return false;                    // E_INVALIDARG
    var p = PRESETS[n];
    this.preset = n;
    this.bgColor = 0x000000;          // every preset forces black; the shell's picker wins back
    for (var k in p) (this as unknown as Record<string, unknown>)[k] = (p as unknown as Record<string, unknown>)[k];
    this.levelValue.fill(0); this.levelSpeed.fill(0);
    this.peakValue.fill(0); this.peakSpeed.fill(0); this.peakHang.fill(0);
    this.resetHistory();
    this.rebuildTrailPalette();
    return true;
  }

  resetHistory(): void {            // 0x18041ddac
    this.history.fill(-1); this.trailRows = 0; this.trailActive = 0;
  }

  rebuildTrailPalette(): void {     // 0x18041da50
    var lc = this.levelColor >>> 0, pc = this.peakColor >>> 0, bg = this.bgColor >>> 0;
    for (var k = 0; k < 16; k++) {
      this.levelTrail[k] = lc; this.peakTrail[k] = pc;
      lc = stepToward(lc, bg, this.fadeRate); pc = stepToward(pc, bg, this.fadeRate);
    }
    this.terminator = bg;
  }

  resize(w: number, h: number): void {              // == Render's "DIB does not match" path
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    var ar = newArena(this.w * this.h);              // the kernel's buffers, or null: plain arrays
    if (ar) {
      this.surface = { w: this.w, h: this.h, px: ar.px.fill(this.bgColor) };
      this.history = ar.history; this.levelTrail = ar.levelTrail; this.peakTrail = ar.peakTrail;
      this.lv = ar.lv; this.pk = ar.pk;
    } else this.surface = A.makeSurface(this.w, this.h, this.bgColor);
    this.resetHistory();
    this.rebuildTrailPalette();
  }

  // ---- BuildBandEdges, 0x18041ce64: bandEdge[i] = 20 * 1102.5^(i/n) Hz ----
  // The double at 0x18088c548 (loaded at 0x18041ce6e) is 1102.5 = 22050/20, not 1100.
  buildBandEdges(n: number): void {
    var r = F32(Math.exp(Math.log(1102.5) / n)), e = 20.0;
    for (var i = 0; i <= n && i < this.bandEdge.length; i++) { this.bandEdge[i] = e; e = F32(e * r); }
    this.bandN = n;
  }

  // ---- ReduceSpectrum, 0x18041cf98 ----
  reduceSpectrum(freq: Uint8Array, out: Uint8Array, nBars: number): void {
    // All float32 (0x18041d007 subss, 0x18041d00f divss, 0x18041d023 minss, 0x18041d02e mulss,
    // 0x18041d039 addss).
    var frac = 1.0, bin = 0, cur = T_lin[freq[0]], edge = this.bandEdge;
    for (var i = 0; i < nBars; i++) {
      if (bin > 1023) return;                            // remaining bars stay as the caller left them
      var acc = 0.0, need = F32(F32(edge[i + 1] - edge[i]) / HZ_PER_BIN);
      while (need > 0.0) {
        var take = frac < need ? frac : need;
        frac = F32(frac - take); need = F32(need - take);
        acc = F32(acc + F32(take * cur));                // area-weighted LINEAR power
        if (frac <= 0.0) {
          bin++;
          if (bin > 1023) break;
          frac = 1.0; cur = T_lin[freq[bin]]!;
        }
      }
      var v = fastLog32(acc);
      out[i] = v >= 256 ? 255 : (v < 0 ? 0 : v);
    }
  }

  // ---- LevelFall 0x18041cdec / PeakUpdate 0x18041ced8 ----
  levelFall(newValue: number, i: number): number {
    var cur = this.levelValue[i];
    if (this.skipUpdate) return cur;
    if (newValue > cur) {
      this.levelValue[i] = newValue; this.levelSpeed[i] = this.levelFallbackSpeed;
      return newValue;
    }
    var s = this.levelSpeed[i];
    this.levelValue[i] = cur - (s | 0);                  // truncating cast
    this.levelSpeed[i] = F32(s + this.levelFallbackAcceleration);
    return cur < 0 ? 0 : cur;                            // the PRE-decrement value
  }

  peakUpdate(level: number, i: number): number {
    var cur = this.peakValue[i];
    if (this.skipUpdate) return cur;
    if (cur < level) {
      this.peakValue[i] = level;
      if (level >= 1) { this.peakSpeed[i] = this.peakFallbackSpeed; this.peakHang[i] = 0; }
      else this.peakSpeed[i] = 0;
      return level;
    }
    if (this.peakHang[i] > this.peakHangTime) {
      var s = this.peakSpeed[i];
      this.peakValue[i] = cur - (s | 0);
      this.peakSpeed[i] = F32(s + this.peakFallbackAcceleration);
      return cur < 0 ? 0 : cur;
    }
    this.peakHang[i]++;
    return cur;
  }

  // ---- FadeStep 0x18041d74c + AdvanceTrail 0x18041d9c8 ----
  fadeStep(): void {
    var S = this.surface;
    if (this.colourDirty) {
      this.resetHistory(); this.rebuildTrailPalette(); S.px.fill(this.bgColor);
      this.colourDirty = false;
      return;
    }
    if (this.h > 1 && this.fadeRate !== 0xFF && this.fadeMode !== 0) {
      if (this.fadeMode >= 5) return;                    // no_fade: not even a clear
      var shift = this.fadeMode === 4 ? 0 : 1;
      if (shift) {
        var n = this.trailRows * 16, H = this.h, ar = arenaOf(this.history);
        if (ar) ar.k.sink(this.history.byteOffset, n, H);
        else for (var k = 0; k < n; k++) {
          var v = this.history[k];
          if (v >= 0 && v < H) this.history[k] = v - shift;
        }
      }
      this.trailActive = 1;
      this.trailHead = (this.trailHead - 1) & 0xF;       // the ring walks BACKWARD
      S.px.fill(this.bgColor);
    } else {
      S.px.fill(this.bgColor);                           // no trail: clear every frame
    }
  }

  // ---- DrawLevelBar 0x18041db5c (row = 2i) ----
  drawLevelBar(row: number, x: number, x2: number, level: number): number {
    var S = this.surface, H = this.h;
    var h = level > 0 ? level : 0;
    var top = h < H - 1 ? h : H - 2;
    if (!this.trailActive) {
      if (top >= 0) fillRect(S, x, H - top, x2, H, this.levelTrail[0]);
      return top;
    }
    var base = row * 16;
    this.history[base + this.trailHead] = top;
    var drawnTo = 0, pos = this.trailHead;
    for (var k = 0; k < 16; k++) {
      if (this.levelTrail[k] === this.terminator) break;
      var v = this.history[base + pos];
      if (v >= drawnTo) {
        fillRect(S, x, H - v, x2, H - drawnTo, this.levelTrail[k]);
        drawnTo = v + 1;
      }
      pos = (pos + 1) & 0xF;
      if (pos === this.trailHead) break;
    }
    return drawnTo - 1;
  }

  // ---- DrawPeakCap 0x18041dc84 (row = 2i+1): `drawn` is DrawLevelBar's return, passed unchanged
  // (0x18041d515/0x18041d526 store it as arg 6). It is a SKIP test, not a floor: floor = max(drawn, 1)
  // (0x18041dca8..0x18041dcbc), v = peak < H ? peak : -1 (0x18041dcbf..0x18041dcc7), and a cap is drawn
  // at row H - v only if v >= floor (0x18041dd36 / 0x18041dd65). A cap equal to the level therefore
  // overwrites the bar's top row. Trail mode walks the ring backward from peakTrail[15]; the
  // off-surface invalidation (0x18041dd1b) runs before the terminator test (0x18041dd2e).
  drawPeakCap(row: number, x: number, x2: number, peak: number, drawn: number): void {
    var S = this.surface, H = this.h;
    var floor = drawn > 0 ? drawn : 1;
    var v = peak < H ? peak : -1;
    if (!this.trailActive) {
      if (v >= floor) fillRect(S, x, H - v, x2, H - v, this.peakTrail[0]);
      return;
    }
    var base = row * 16;
    this.history[base + this.trailHead] = v;
    for (var k = 15; k >= 0; k--) {
      var pos = (this.trailHead + k) & 0xF;
      var hv = this.history[base + pos];
      if (hv >= H) { this.history[base + pos] = -1; hv = -1; }
      if (this.peakTrail[k] !== this.terminator && hv >= floor)
        fillRect(S, x, H - hv, x2, H - hv, this.peakTrail[k]);
    }
  }

  // ---- DrawBars 0x18041d294 ----
  drawBars(L: TimedLevel, nBars: number): void {
    var W = this.w, H = this.h, spacing = this.horizontalSpacing;
    var barW = this.levelWidth;
    if (barW === 0) {
      barW = ((W - (nBars - 1) * spacing) / nBars) | 0;
      if (barW < 1) barW = 1;
    }
    var n = ((W / (barW + spacing)) | 0) + 1;
    if (n > nBars) n = nBars;
    var xoff = Math.max(0, W - (barW + spacing) * n) / 2 | 0;
    // The DLL guards on the NOMINAL count, so a resize leaves the table built for the old
    // visible count. options.intended rebuilds when the visible count moves instead.
    if (this.lastBarCount !== nBars || (this.options.intended && this.bandN !== n)) {
      this.buildBandEdges(n); this.lastBarCount = nBars;
    }
    var nUse = n < 1024 ? n : 1024;
    this.bars = nUse; this.barW = barW; this.xoff = xoff;

    this.reduceSpectrum(L.freq[0], this.buf0, nUse);
    if (this.channels > 1) this.reduceSpectrum(L.freq[1], this.buf1, nUse);
    this.trailRows = nUse * 2;

    var playing = L.state === 2, scale = this.levelScale, lv = this.lv, pk = this.pk, peaks = this.showPeaks;
    for (var i = 0; i < nUse; i++) {
      var h0 = F32(F32(F32(this.buf0[i] * H) / 255.0) * scale) | 0;
      if (h0 > 0 && playing) h0 += ((A.rand() * 20 / 32767) | 0) - 10;      // +/-10 px
      var h = h0;
      if (this.channels > 1) {
        var h1 = F32(F32(F32(this.buf1[i] * H) / 255.0) * scale) | 0;
        if (h1 > 0 && playing) h1 += ((A.rand() * 20 / 32767) | 0) - 10;
        h = h0 > h1 ? h0 : h1;          // the LOUDER channel wins: 0x18041d482 cmp / 0x18041d48b cmovle
      }
      lv[i] = this.levelFall(h, i);
      if (peaks) pk[i] = this.peakUpdate(lv[i], i);
    }
    // The DLL draws each bar right after its update; drawing them all after is the same: the updates
    // touch only level*/peak*, the draws only the surface and the history rows.
    var ar = arenaOf(this.surface.px);
    if (ar) {
      ar.k.draw(ar.px.byteOffset, W, H, ar.history.byteOffset, ar.levelTrail.byteOffset, ar.peakTrail.byteOffset,
        ar.lv.byteOffset, ar.pk.byteOffset, nUse, barW, spacing, xoff, this.trailActive, this.trailHead, this.terminator, peaks ? 1 : 0);
      return;
    }
    for (i = 0; i < nUse; i++) {
      var x = (barW + spacing) * i + xoff;
      var x2 = x + barW; if (x2 - 1 >= W - 1) x2 = W; x2--;
      var drawn = this.drawLevelBar(2 * i, x, x2, lv[i]);
      if (peaks) this.drawPeakCap(2 * i + 1, x, x2, pk[i], drawn);
    }
  }

  // ---- DrawScope 0x18041d580 (displayMode 3) ----
  drawScope(L: TimedLevel): void {
    var S = this.surface, W = this.w, H = this.h, wave = L.wave[0];
    var m = W < H ? W : H;
    var yc = (H >> 1) - (m >> 2);                       // sample 128 lands on H/2
    var amp = F32((m >> 1) * 0.00390625);
    var yPrev = (F32(wave[0] * amp) | 0) + yc, c = this.levelTrail[0], x, y;
    if (W <= 1024) {
      var acc = 0.0;
      for (x = 1; x < W; x++) {
        acc = F32(acc + F32(F32(1024.0 / W) * 0.0009765625));
        var idx = F32(acc * 1024.0) | 0;
        if (idx > 1023) idx = 1023;
        y = (F32(wave[idx] * amp) | 0) + yc;
        line(S, x - 1, yPrev, x, y, c);
        yPrev = y;
      }
    } else {
      var xPrev = 0;
      for (var i = 1; i < 1024; i++) {
        x = F32(F32(i * 0.0009765625) * W) | 0;
        y = (F32(wave[i] * amp) | 0) + yc;
        line(S, xPrev, yPrev, x, y, c);
        xPrev = x; yPrev = y;
      }
    }
  }

  // ---- DrawDots 0x18041d1b4 (displayMode 4, unreachable from any preset) ----
  drawDots(L: TimedLevel): void {
    var S = this.surface, H = this.h, wave = L.wave[0];
    var n = this.w < 1024 ? this.w : 1024, c = this.levelTrail[0];
    for (var i = 1; i < n; i++) {
      var y = (H / 2 | 0) - (F32(F32((wave[i] - 0x80) * -0.0078125) * (H - 1)) | 0);
      if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
      S.px[y * S.w + i] = c;
    }
  }

  // ---- Render 0x18041df10 ----
  render(L: TimedLevel | null): Surface | null {
    var S = this.surface;
    if (!L) return S;
    var bg = this.options.backgroundColor | 0;
    if (bg !== this.bgColor) { this.bgColor = bg; this.colourDirty = true; }
    if (L.state === 0) { S.px.fill(this.bgColor); return S; }   // STOPPED: fill and bail

    this.skipUpdate = L.state === 1 || L.timeStamp === this.lastTimeStamp;
    this.frame++;
    if (!this.skipUpdate) {
      this.fadeStep();
      if (this.displayMode === 3) this.drawScope(L);
      else if (this.displayMode === 4) this.drawDots(L);
      else this.drawBars(L, this.displayMode === 0 ? 20 : this.displayMode === 1 ? 50 : 1024);
      this.lastTimeStamp = L.timeStamp;
    }
    return S;
  }

  debug() {
    return {
      engine: 'Bars and Waves', preset: this.preset, presetName: PRESET_NAMES[this.preset],
      displayMode: this.displayMode, size: this.w + 'x' + this.h,
      bars: this.bars, barWidth: this.barW, spacing: this.horizontalSpacing, xoff: this.xoff,
      levelColor: '#' + ('000000' + this.levelColor.toString(16)).slice(-6),
      peakColor: '#' + ('000000' + this.peakColor.toString(16)).slice(-6),
      fadeMode: this.fadeMode, fadeRate: this.fadeRate,
      trail: this.trailActive ? 'on head ' + this.trailHead : 'off',
      levelFallbackSpeed: this.levelFallbackSpeed, peakHangTime: this.peakHangTime,
      frame: this.frame, skipUpdate: this.skipUpdate,
      level0: this.levelValue[0], peak0: this.peakValue[0]
    };
  }
}

A.Bars = Bars;
export { Bars };

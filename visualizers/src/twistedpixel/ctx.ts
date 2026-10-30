// A TwistedPixel preset context (the 0x23c-byte object 0x1000ee90 builds; two exist, the current preset and the
// next one during a transition): its script, its 112 variable records, and its frame code: the per-frame part
// (0x1000f780: engine inputs, ProcessPerFrame, the blend toward the next preset, the mesh fade, the wave colour)
// and the per-vertex warp (0x1000f330: ProcessPerPixel and the MilkDrop warp equation for each mesh vertex).
// Every float operation is one x87 instruction at 24-bit precision (./fpu.ts); FSIN/FCOS/FPATAN enter at 64 bits.
import { sincos87 } from '../plenoptic/x87';
import { atan2_87 } from '../battery/x87';
import { add24, div24, f32x, ftol, mul24, mulx24, sqrt24, sub24 } from './fpu';
import { V, VARS } from './vars';
import { compileScript, type HostMember, type Script, ScriptError, type ScriptHost, tpTrue } from './script';
import { ctxWaveColor } from './waves';
import { ciPow, HOST_FNS, type HostEnv } from './hostfns';
import type { Engine, PresetCtx } from './engine';

const f = Math.fround;
const SC = new Float64Array(4), AT = new Float64Array(2);
const DEF = Float32Array.from(VARS, (d) => d.def);
/** variables reset each frame (and before each vertex): record flags & 3 */
const RESET = VARS.map((_, i) => i).filter((i) => (VARS[i].kind & 3) !== 0);

/** what a context's script reaches besides its own records */
export interface TpGlobals {
  /** the script host's methods (dispids 141-195) */
  env: HostEnv;
  /** AddWaveformElement (dispid 187): ord, x, y, r, g, b, a */
  addWaveformElement(args: number[]): void;
  /** tp_WaveformRight/Left, tp_SpectrumRight/Left (188-191): 576 signed bytes each */
  arrays(): [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  /** a script error (OnScriptError); the engine decides what it shows */
  onScriptError?(ctx: PresetContext, e: ScriptError): void;
}

/** the dispatch object's members in dispid order: every variable's names (two extra aliases, tp_treble and
 *  tp_treble_att, follow tp_fTreble and tp_fTrebAtt), tp_Script, then the methods */
const PROPS: [string, number][] = [];
VARS.forEach((d, i) => {
  PROPS.push([d.name, i]);
  if (d.alias) PROPS.push([d.alias, i]);
  if (d.name === 'tp_treb') PROPS.push(['tp_treble', i]);
  if (d.name === 'tp_treb_att') PROPS.push(['tp_treble_att', i]);
});
const ARRAYS = ['tp_WaveformRight', 'tp_WaveformLeft', 'tp_SpectrumRight', 'tp_SpectrumLeft'];
const FNS = [...HOST_FNS];
const AWE = FNS.findIndex((h) => h.dispid > 187);
const MEMBERS: HostMember[] = [
  ...PROPS.map(([name]): HostMember => ({ name, kind: 'prop', vt: 4 })),
  { name: 'tp_Script', kind: 'put', vt: 8 },
  ...FNS.slice(0, AWE).map((h): HostMember => ({ name: h.name, kind: h.kind, vt: h.vt, params: h.params })),
  { name: 'AddWaveformElement', kind: 'method', vt: 2, params: [2, 4, 4, 4, 4, 4, 4] },
  ...ARRAYS.map((name): HostMember => ({ name, kind: 'method', vt: 12, params: [] })),
  ...FNS.slice(AWE).map((h): HostMember => ({ name: h.name, kind: h.kind, vt: h.vt, params: h.params })),
];
const NP = PROPS.length, FN0 = NP + 1;
const PROP_VAR = Int32Array.from(PROPS, ([, i]) => i);

export class PresetContext implements PresetCtx {
  /** each record's value (+0x10), the value after PresetInitialize (+0x14), the per-frame value (+0x1c) */
  readonly vars = new Float32Array(DEF);
  private readonly init = new Float32Array(DEF);
  private readonly frameV = new Float32Array(DEF);
  /** ctx+0x22c */
  active = false;
  /** ctx+0x1e4: tp_NextPreset */
  nextPreset = '';
  /** ctx+0x228: a post effect (solarize, brighten, darken, invert) was on after PresetInitialize */
  postFx = false;
  /** ctx+0x230: the time of this context's last frame as the current one */
  time = 0;
  /** ctx+0x224 */
  waveColor = 0xff0000ff;
  private script: Script | null = null;
  /** the host's dispids (+0xc..+0x24): 0 before a script is loaded, -1 for a function the script lacks */
  private ids = { init: 0, perFrame: 0, perPixel: 0, terminate: 0, waveform: 0, shape: 0 };
  /** host+0x28 */
  private initialized = false;
  /** ctx+0x20c, +0x210 (1/size), +0x208, +0x204 (half size / size) */
  private readonly invW: number; private readonly invH: number;
  private readonly halfX: number; private readonly halfY: number;
  private readonly host: ScriptHost;

  /** 0x1000ee90 */
  constructor(private readonly eng: Engine, private readonly g: TpGlobals) {
    const w = eng.texW, h = eng.texH;
    this.invW = f(1 / w); this.invH = f(1 / h);
    this.halfY = mul24(h >> 1, this.invH); this.halfX = mul24(w >> 1, this.invW);
    const v = this.vars;
    this.host = {
      members: MEMBERS,
      get: (i) => v[PROP_VAR[i]],
      set: (i, x) => { v[PROP_VAR[i]] = x; },
      call: (i, args) => {
        if (i === NP) return undefined;                        // tp_Script: accepted, unused
        const k = i - FN0;
        if (k < AWE) return FNS[k].call(g.env, args);
        if (k === AWE) { g.addWaveformElement(args as number[]); return 0; }
        if (k <= AWE + 4) return Array.from(g.arrays()[k - AWE - 1]);
        return FNS[k - 5].call(g.env, args);
      },
    };
  }

  /** 0x1000f140: compile the preset (0x10026b50: VBScript for a ".vbs" path, else JScript; 0x10026880),
   *  PresetInitialize with the record setup around it (0x100266a0), then note whether a post effect is on */
  load(name: string, source: string | null): boolean {
    if (this.initialized) this.terminate();
    let ok = true;
    this.script = null;
    if (source !== null) {
      try {
        this.script = compileScript(source, name.includes('.vbs') ? 'vbscript' : 'jscript', this.host);
      } catch (e) {
        if (!(e instanceof ScriptError)) throw e;
        ok = false;
        this.g.onScriptError?.(this, e);
      }
    } else ok = false;
    const s = this.script, id = (n: string): number => (s ? (s.has(n) ? 1 : -1) : 0);
    this.ids = { init: id('PresetInitialize'), perFrame: id('ProcessPerFrame'), perPixel: id('ProcessPerPixel'),
      terminate: id('PresetTerminate'), waveform: id('ProcessWaveform'), shape: id('ProcessCustomShape') };
    if (s && this.ids.init !== -1) {
      this.vars.set(DEF); this.init.set(DEF); this.frameV.set(DEF);
      this.call('PresetInitialize');
      for (const i of RESET) { this.init[i] = this.vars[i]; this.frameV[i] = DEF[i]; }
      const e = this.eng, c = e.cur.vars;     // DAT_10067264
      if (c[V.fDesiredFPS] === 0) c[V.fDesiredFPS] = e.desiredFps;
      if (c[V.meshx] === 0) c[V.meshx] = e.iniMeshW;
      if (c[V.meshy] === 0) c[V.meshy] = e.iniMeshH;
      this.initialized = true;
    }
    const v = this.vars;
    this.postFx = v[V.bSolarize] !== 0 || v[V.bBrighten] !== 0 || v[V.bDarken] !== 0 || v[V.bInvert] !== 0;
    return ok;
  }

  /** PresetTerminate (0x10026640) */
  terminate(): void {
    if (this.ids.terminate !== -1 && this.script) this.call('PresetTerminate');
    this.initialized = false;
  }

  private call(entry: string): boolean {
    try {
      return tpTrue(this.script!.call(entry));
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      this.g.onScriptError?.(this, e);
      return false;
    }
  }

  /** 0x1000f0f0 / 0x1000f110: one ProcessWaveform / ProcessCustomShape call; true asks for another */
  processWaveform(): boolean { return !!this.script && this.ids.waveform !== -1 && this.call('ProcessWaveform'); }
  processCustomShape(): boolean { return !!this.script && this.ids.shape !== -1 && this.call('ProcessCustomShape'); }

  /** 0x10026780: the start of a frame puts the per-frame variables back to their PresetInitialize values */
  resetFrame(): void {
    if (this.script && this.ids.perFrame !== 0) for (const i of RESET) this.vars[i] = this.init[i];
  }

  /** 0x1000f300 (the engine has set time and 0x1000f780's first stores; `next` is given while fading) */
  perFrame(next: PresetCtx | null, eng: Engine): void {
    this.frameCode(next as PresetContext | null);
    this.warp();
  }

  /** 0x1000f780 after its first four stores */
  private frameCode(next: PresetContext | null): void {
    const eng = this.eng, v = this.vars;
    if (this.script && this.ids.perFrame !== -1) this.call('ProcessPerFrame');
    if (this.active && next) {
      next.frameCode(null);
      const n = next.vars, w78 = eng.w1, w7c = eng.w2;
      const blend = (i: number): void => {
        const a = v[i], b = n[i];
        v[i] = w7c < 0.5 ? add24(mul24(sub24(b, a), w7c), a) : sub24(b, mul24(sub24(b, a), w78));
      };
      const clamp = (i: number): void => { const x = v[i]; v[i] = 0 <= x ? (x <= 1 ? x : 1) : 0; };
      for (let i = 1; i <= 9; i++) blend(i);
      for (const i of [5, 6, 7, 8, 9, 4]) clamp(i);
      blend(13); blend(14);
      v[12] = n[12]; v[16] = n[16];
      for (const i of [51, 53, 55, 56, 29, 30, 31, 32, 33, 35, 36, 37]) blend(i);
      for (let i = 19; i <= 28; i++) blend(i);
      for (const i of [45, 46, 47, 48, 49, 50, 44, 39, 40, 41, 42, 43]) blend(i);
    }
    if (this.script && this.ids.perFrame !== 0) for (const i of RESET) this.frameV[i] = v[i];
    if (v[V.fDecay] < 1 && eng.mesh.count) eng.mesh.fade(v[V.fDecay]);
    this.waveColor = ctxWaveColor(v);
  }

  /** 0x1000f330: for every mesh vertex, the per-pixel script and the warp; only the active context moves the mesh */
  private warp(): void {
    const v = this.vars, m = this.eng.mesh, fv = m.fv;
    const resetPP = this.script !== null && this.ids.perPixel !== 0;
    const callPP = this.script !== null && this.ids.perPixel !== -1;
    for (let k = 0, o = 0; k < m.count; k++, o += 7) {
      let x = mul24(add24(fv[o], 0.5), this.invW), y = mul24(add24(fv[o + 1], 0.5), this.invH);
      x = sub24(x, this.halfX); y = sub24(y, this.halfY);
      atan2_87(-y, x, AT);
      v[V.ang] = f32x(AT[0], AT[1]);
      v[V.rad] = mul24(sqrt24(add24(mul24(y, y), mul24(x, x))), f(1.5707963705062866));
      v[V.x] = add24(this.halfX, x); v[V.y] = add24(y, this.halfY);
      if (resetPP) for (const i of RESET) v[i] = this.frameV[i];
      if (callPP) this.call('ProcessPerPixel');

      const t = this.time, warp = v[V.warp], ws = v[V.fWarpScale];
      const warpOn = warp > f(0.001) && ws > 0;
      let w44 = 0, f64 = 0, f68 = 0, f40 = 0, f48 = 0, t1 = 0, t2 = 0, st1 = 0, st2 = 0;
      if (warpOn) {
        w44 = mul24(warp, f(0.009));
        const a = div24(20, ws);
        sincos87(mul24(t, 1.25), SC);
        f64 = add24(div24(mulx24(SC[0], SC[1], 2.5), ws), a);
        sincos87(mul24(t, 1.75), SC);
        f68 = add24(a, div24(mulx24(SC[0], SC[1], 5), ws));
        const K = f(0.15707963705062866);
        f40 = mul24(f68, K); f48 = mul24(f64, K);
        t1 = mul24(mul24(mul24(t, f(1.233)), v[V.fWarpAnimSpeed]), f(0.8));
        t2 = mul24(t1, f(0.7));
        sincos87(t1, SC); st1 = f32x(SC[0], SC[1]);
        sincos87(t2, SC); st2 = f32x(SC[0], SC[1]);
      }
      // zoom, raised to zoomexp^(2 rad - 1) when the exponent is not 1
      const zoom = v[V.zoom];
      let zoom2 = zoom;
      if (v[V.zoomexp] !== 1) zoom2 = ciPow(zoom, ciPow(v[V.zoomexp], sub24(add24(v[V.rad], v[V.rad]), 1)));
      const cx = v[V.cx], cy = v[V.cy];
      const U = sub24(v[V.x], cx), Vv = sub24(v[V.y], cy);
      sincos87(v[V.rot], SC);
      const S = SC[0] + SC[1], C = SC[2] + SC[3];
      const P1 = safeDiv(sub24(mul24(C, U), mul24(S, Vv)), v[V.sx]);
      const P2 = safeDiv(add24(mul24(C, Vv), mul24(S, U)), v[V.sy]);
      const Q2 = add24(P2, cy);
      const iz = safeDiv(1, zoom2);
      let U2 = sub24(add24(mul24(sub24(add24(P1, cx), 0.5), iz), 0.5), v[V.dx]);
      let V2 = sub24(add24(mul24(sub24(Q2, 0.5), iz), 0.5), v[V.dy]);
      if (warpOn) {
        sincos87(add24(mul24(f40, U2), add24(st2, t1)), SC);
        const Ah = SC[0], Al = SC[1];
        sincos87(add24(mul24(f48, U2), add24(st1, t2)), SC);
        const Bh = SC[0], Bl = SC[1], Bf = f32x(Bh, Bl);
        const W1 = mul24(mul24(add24(mulx24(Bh, Bl, f(0.15)), f(0.85)), f68), U2);
        const W2 = mul24(mul24(add24(mulx24(Ah, Al, f(0.15)), f(0.85)), f64), V2);
        sincos87(add24(W2, W1), SC);
        U2 = sub24(U2, mulx24(SC[2], SC[3], mulx24(Ah, Al, w44)));
        sincos87(sub24(W1, W2), SC);
        V2 = sub24(V2, mulx24(SC[0], SC[1], mul24(Bf, w44)));
      }
      if (this.active) { fv[o + 5] = U2; fv[o + 6] = V2; }
    }
  }
}

/** 0x1000ee60: a / b at 24-bit precision, 0 when b is 0 */
function safeDiv(a: number, b: number): number { return b === 0 ? 0 : div24(a, b); }

export { ftol };

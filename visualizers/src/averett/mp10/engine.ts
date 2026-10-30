// Energy Bliss (MediaPlayer_10.dll, Windows Media Player 10's visualization, Averett & Associates' Plugin framework):
// the engine. One object (0x3c6f0 bytes, Heap address 0) as the DLL keeps it; methods are named by the VA of the DLL
// function they reproduce (image base 0x10000000), fields by their int index (byte offset / 4), as the DLL indexes
// them. What reaches the device each frame: a 4x4 CWater mesh (the DirectX 8 SDK's Water sample at another size)
// drawn into a 128x128 caustics target, then over the back buffer with the sky picture as its texture, the bottom
// band of the sky picture (where the equalizer panel is drawn in) copied over it by the CPU, and up to eight clouds,
// the same mesh again with the cloud pictures, fading in and drifting when the music has been loud.
import { Heap, fr, ftol, fsinF, fcosF, fsincos } from '../heap';
import { matMul, translation, quatYawPitchRoll, matRotQuat, perspectiveFovRH, vec3Normalize, textureFromPixels } from '../d3dx';
import { type Device, type Texture, type Surface, type Buffer, type StateBlock, Fmt, Pool, Usage, Lock, Prim, ClearFlag, Ts, Rs, Tss } from '../../d3d8/api';
import { Crt, DxTimer, fontInit, fontRestore, WaterEffect, RenderToSurface } from '../framework';
import type { EqPanelDraw } from './eqpanel-api';

export const OBJ_SIZE = 0x3c6f0;

/** A picture: w x h BGRA bytes, rows top-down */
export interface Mp10Picture { w: number; h: number; px: Uint8Array }

/** The pictures the scene is made of. In the DLL they come out of GDI+ (the JPEG resources DATATABLE_Bkg,
 *  DATATABLE_Cloud_1/2 drawn and scaled); the public build supplies its own, the private A/B the DLL's pixels. */
export interface Mp10Art {
  /** 0x10010040 for a w x h window: `sky` is sprite 6 (w x h, alpha 0xff) as the DLL leaves it, `band` the panel's
   *  backdrop (sprite 2: bw x bh = 600 x 122, the strip of the sky behind the equalizer scaled), `bandHd` the same at
   *  1200 x 244 */
  background(w: number, h: number): { sky: Uint8Array; band: Uint8Array; bandHd: Uint8Array };
  /** 0x10012f30: cloud k (1 or 2) as GDI+ draws it, at its own size, or at half its height (`half`) */
  cloud(k: number, half: boolean): Mp10Picture;
}

export interface Mp10Options {
  art: Mp10Art;
  /** the equalizer panel (mp10/eqpanel.ts) */
  panel: EqPanelDraw;
  /** timeGetTime() in ms; QueryPerformanceCounter is this in us */
  clock: () => number;
  /** time(NULL) at the first Render: the CRT's srand seed */
  seed: number;
  createDevice: (w: number, h: number) => Device;
}

// the object as the constructor (0x10009a20) leaves it: byte offset, dword (non-pointer, non-zero; the clock's
// readings are filled in from the clock)
const INIT: [number, number][] = [
  [0x24, 70], [0x28, 100], [0x88, 1], [0x90, 640], [0x94, 480], [0xa4, 0x41a00000], [0x748c, 1], [0x75e0, 1],
  [0x75e4, 0x3dcccccd], [0x7650, 1400], [0x7654, 2400], [0x765c, 64], [0x7694, 0x3fc89375], [0x76d0, 0x3e4ccccd],
  [0x77bc, 0x3e800000], [0x77c4, 4], [0x77c8, 255], [0x7e1c, 3000], [0x7e20, 3000], [0x7e24, 5000], [0x7e48, 3],
  [0x7e5c, 4], [0x7e78, 1], [0x7e80, 1], [0x7eec, 4], [0x7ef0, 10], [0x7fd4, 20], [0x7fd8, 20], [0x7fdc, 60],
  [0x7fe0, 1], [0x7ff4, 1], [0x9064, 50], [0x9068, 1], [0x926c, 0x3f800000], [0x9274, 0x41200000], [0x94dc, 1],
  [0x94e0, 16], [0x339fc, 1], [0x33a18, 0x3f000000], [0x33a1c, 0xbf800000], [0x33a20, 0x3f800000],
  [0x33a28, 0x3f000000], [0x33a34, 0x3f800000], [0x33a74, 1], [0x33a78, 0x3f800000], [0x33a7c, 0x3f800000],
  [0x3620c, 0xe9f4ff], [0x36210, 0xffffff], [0x36260, 1], [0x362e8, 0x54411744], [0x362ec, 0x400921fb], [0x36314, 1],
  [0x3c460, 1200], [0x3c464, 244], [0x3c468, 1], [0x3c47c, 600], [0x3c480, 122], [0x3c48c, -1], [0x3c4ac, 2],
  [0x3c4cc, 0x40240000],
];
const INIT_CLOCK = [0x7e14, 0x7e18, 0x7e38, 0x7f18, 0x3c494];
const INIT_IDENT = [0x33ac8, 0x33c08, 0x33c48];

// matrices (int index): A view, B identity view, C, D water world, E world, G; the projections
const MA = 0xcea2, MB = 0xceb2, MC = 0xcec2, MD = 0xced2, ME = 0xcee2, MG = 0xcef2, PSCENE = 0xcf02, PCAUS = 0xcf12;
const TIME = 0x2507;   // F: app time (0x941c), 0x2508 elapsed
const CUR = 0x1d14;    // the current sprite
/** sprite record s, field k (int): 40 records of 0x7c ints from 0x924 */
const SP = (s: number, k: number): number => 0x924 + s * 0x7c + k;
/** transform record s, field at byte b (float index) */
const TR = (s: number, b: number): number => (s * 0xe0 + b) >> 2;

const SC = new Float64Array(4);
/** round(x87 FSIN(x) * c) to a double: FSIN's 64-bit result times a float at 53-bit precision */
function sinMul(x: number, c: number): number {
  fsincos(x, SC);
  const hi = SC[0], lo = SC[1], p = hi * c;
  const S = 134217729, t1 = S * hi, hh = t1 - (t1 - hi), hl = hi - hh, t2 = S * c, ch = t2 - (t2 - c), cl = c - ch;
  const e = ((hh * ch - p) + hh * cl + hl * ch) + hl * cl;
  return p + (e + lo * c);
}
/** FSIN(x) rounded to a double (the value FSIN leaves on a 53-bit stack before the next operation) */
function sinD(x: number): number { fsincos(x, SC); return SC[0] + SC[1]; }

/** ID3DXEffect as MediaPlayer_10's D3DX build drives it: the pass sets the vertex shader itself, End restores the
 *  shader Begin found and clears both texture stages before the saved block */
class Effect10 extends WaterEffect {
  constructor(d: Device, private readonly vs: () => number) { super(d); }
  private before = 0;
  override begin(): void { this.before = this.vs(); super.begin(); }
  override technique(): void { this.before = this.vs(); super.technique(); }
  override pass0(): void { this.d.setVertexShader(0x152); super.pass0(); }
  override end(): void {
    const d = this.d;
    d.setVertexShader(this.before); d.setTexture(0, null); d.setTexture(1, null);
    super.end();
  }
}

export class Mp10Engine {
  readonly heap = new Heap(OBJ_SIZE, 24 << 20);
  readonly I = this.heap.I; readonly U = this.heap.U; readonly F = this.heap.F; readonly B = this.heap.B;
  readonly crt = new Crt();
  dev: Device | null = null;
  frame = 0;
  private objs: unknown[] = [null];
  private refract = new Float32Array(512 * 3);   // 0x10073858: 256 copies of entry 0, then the 256 entries
  private refractU = new Uint32Array(this.refract.buffer);
  private diffuse = new Uint32Array(8);          // 0x10073838
  private tm = new DxTimer(() => this.tgt() * 1000, true);
  private blocks: StateBlock[] = [];
  private fonts: Texture[] = [];
  private eff: Effect10 | null = null;
  private rts: RenderToSurface | null = null;
  private vs = 0;
  private w = 0; private h = 0;

  constructor(readonly opt: Mp10Options) {
    const { I, U } = this;
    for (const [o, v] of INIT) U[o >> 2] = v >>> 0;
    const t = this.tgt();
    for (const o of INIT_CLOCK) I[o >> 2] = t;
    for (const o of INIT_IDENT) for (let k = 0; k < 16; k++) this.F[(o >> 2) + k] = k % 5 === 0 ? 1 : 0;
    // pointers only tested for null: the two CD3DFont objects; the window (the host's)
    I[0x33a04 >> 2] = this.handle({}); I[0x33a08 >> 2] = this.handle({});
    I[0xf1b7] = 1;
  }

  // ---- helpers ----
  private handle(o: unknown): number { this.objs.push(o); return this.objs.length - 1; }
  private obj<T>(i: number): T { return this.objs[this.I[i]] as T; }
  private tgt(): number { return this.opt.clock() >>> 0; }
  private get d(): Device { return this.dev!; }
  private mat(i: number): Float32Array { return this.F.subarray(i, i + 16); }
  private ident(i: number): void { const F = this.F; for (let k = 0; k < 16; k++) F[i + k] = k % 5 === 0 ? 1 : 0; }
  private setVs(v: number): void { this.vs = v; this.d.setVertexShader(v); }
  private tex(i: number): Texture | null { return this.I[i] ? this.objs[this.I[i]] as Texture : null; }
  private release(i: number): void { this.I[i] = 0; }

  /** one IWMPEffects2::RenderWindowed: levels as WMP's TimedLevel (freq 2x1024, wave 2x1024, state) */
  render(levels: Uint8Array, w: number, h: number): void {
    this.r1000a690(levels, w, h);
    this.frame++;
  }

  // ======== 0x1000a690 IWMPEffects::Render ========
  private r1000a690(lv: Uint8Array, w: number, h: number): void {
    const I = this.I;
    I[0x36208 >> 2] = 32;                        // GetDeviceCaps(hdc, BITSPIXEL)
    I[0x3625c >> 2] = 0;
    if (I[0x3624c >> 2] === 0) {
      this.i10011b80();
      I[0x3624c >> 2] = 1;
      I[0x3630c >> 2] = 0x15e; I[0x36310 >> 2] = 0x140; I[0x3628c >> 2] = 0x15e; I[0x36290 >> 2] = 0x140;
      this.crt.srand(this.opt.seed);              // srand(time(NULL))
      this.i10011d70(); this.i10011dd0(); this.t10011ef0();
      this.d10001010(w, h);
      I[0x3c4c8 >> 2] = 0; I[0x3c4cc >> 2] = 0x40240000;   // the Version value read from the registry: 10.0
    }
    I[0x36318 >> 2] = 0; I[0x3631c >> 2] = 0;
    if (I[0x3628c >> 2] !== w || I[0x36290 >> 2] !== h) {
      I[0x36290 >> 2] = h; I[0x3628c >> 2] = w;
      if (I[0x24be] !== 0) {
        I[0x24ae] = w; I[0x24af] = h; I[0x24b0] = 22;
        this.r10001150();
      }
    }
    I[0x36358 >> 2] = I[0x2cd8 >> 2]; I[0x36354 >> 2] = I[0x2cdc >> 2];
    I[0x363f8 >> 2] = Math.imul(I[0x2cdc >> 2], I[0x36358 >> 2]);
    this.d10001010(w, h);
    this.a1000aa20(lv);
  }

  // ======== first-Render setup ========
  /** 0x10011b80: clear the sprite and transform records, the spectrum, the frame counters */
  private i10011b80(): void {
    const I = this.I;
    I[0x36208 >> 2] = 32;
    I[0x1d15] = 0x28;
    for (let s = 0; s < 0x28; s++) {
      for (let k = 0; k < 0x7c; k++) I[SP(s, k)] = 0;
      for (let k = 0; k < 0x38; k++) I[0x2c + s * 0x38 + k] = 0;
    }
    I[0x1d14] = 0x28; I[0x3627c >> 2] = 0x38;
    for (let k = 0; k < 0x208; k++) { I[(0x33e18 >> 2) + k] = 0; I[(0x34638 >> 2) + k] = 0; }
    I[0x36274 >> 2] = 0x208;
    for (const o of [0x361dc, 0x7f9c, 0x7604, 0x7450, 0x75fc, 0x36228, 0x3622c, 0x36234, 0x36254, 0x7620, 0x36280,
      0x760c, 0x7608, 0x7628, 0x762c, 0x7644, 0x761c, 0x7600, 0x36324, 0x36330, 0x36334, 0x36394, 0x363ec, 0x98, 0xa0]) I[o >> 2] = 0;
    I[0x36224 >> 2] = 0xff; I[0x75e0 >> 2] = 1; I[0x7658 >> 2] = 2;
    I[0x3628c >> 2] = 0x15e; I[0x36290 >> 2] = 0x140;
    I[0x9c >> 2] = this.tgt();
    I[0xa4 >> 2] = 0x41a00000;
  }
  /** 0x10011d70: every sprite record unused */
  private i10011d70(): void {
    const I = this.I;
    for (I[CUR] = 0; (I[CUR] >>> 0) < (I[0x1d15] >>> 0); I[CUR]++) I[SP(I[CUR], 0)] = -1;
  }
  /** 0x10011dd0: free every sprite, clear the records again and the level history (and, past its end, the cos table
   *  and the sin table's first 160 entries: 0x10011ef0's tables are built before this runs the second time) */
  private i10011dd0(): void {
    const I = this.I;
    this.s10012330();
    for (I[CUR] = 0; (I[CUR] >>> 0) < (I[0x1d15] >>> 0); I[CUR]++) {
      for (let k = 0; k < 0x7c; k++) I[SP(I[CUR], k)] = 0;
      for (let k = 0; k < 0x38; k++) I[0x2c + I[CUR] * 0x38 + k] = 0;
    }
    I[0xd89d] = 0x7c; I[0xd89f] = 0x38;
    I[0x1d7f] = 0;
    for (let k = 0; k < 0x208; k++) { I[0xd396 + k] = 0; I[0xd59e + k] = 0; }
    for (let k = 0; k < 10; k++) I[0xcf22 + k] = 0;
    I[0xd901] = 10;
  }
  /** 0x10012330: free every sprite */
  private s10012330(): void {
    const I = this.I;
    for (I[CUR] = 0; (I[CUR] >>> 0) < (I[0x1d15] >>> 0); I[CUR]++) this.s10012380();
  }
  /** 0x10012380: free the current sprite's buffers */
  private s10012380(): void {
    const I = this.I, s = I[CUR];
    if (I[SP(s, 1)] === -1 && I[SP(s, 0xa)] !== 0) { this.heap.release(I[SP(s, 0xa)] - 0xc); I[SP(s, 1)] = 0; I[SP(s, 0xa)] = 0; }
    I[SP(s, 0x2e)] = 0;
    for (const k of [0x30, 0x7b, 0x2f, 0x68]) if (I[SP(s, k)]) { this.heap.release(I[SP(s, k)]); I[SP(s, k)] = 0; }
  }
  /** 0x10011ef0: sin and cos tables by degree (FSIN/FCOS of i * 0.01745328f) */
  private t10011ef0(): void {
    const F = this.F, k = fr(0.017453279346227646);
    F[0x35c18 >> 2] = 0;
    for (let i = 1; i < 360; i++) F[(0x35c18 >> 2) + i] = fsinF(i * k);
    F[0x35678 >> 2] = 1;
    for (let i = 1; i < 360; i++) F[(0x35678 >> 2) + i] = fcosF(i * k);
  }

  // ======== D3D: the device (CD3DApplication) ========
  /** 0x10001010: create the device the first time */
  private d10001010(w: number, h: number): void {
    const I = this.I;
    if (I[0x24be] !== 0) return;
    I[0x24be] = this.handle({});                 // Direct3DCreate8
    I[0x24bb] = I[0xf1b7];
    this.w = w; this.h = h;
    this.tm.cmd(1);
    this.w100076d0(64, 20);                      // 0x100022c0 OneTimeSceneInit
    // 0x100022e0 Initialize3DEnvironment: CreateDevice (REF, windowed, the client size, X8R8G8B8, D16)
    I[0x24ae] = w; I[0x24af] = h; I[0x24b0] = 22; I[0x24b1] = 1; I[0x24b3] = 1; I[0x24b4] = I[0xf1b7]; I[0x24b5] = 1;
    I[0x24b6] = 1; I[0x24b7] = 80; I[0x24b8] = 1; I[0x24c0] = 2;
    this.dev = this.opt.createDevice(w, h);
    I[0x24bf] = this.handle(this.dev);
    I[0x2542] = 4096;                            // caps MaxTextureWidth
    I[0xce78] = 1; I[0xce7a] = 1;                // windowed
    I[0x24f5] = 22; I[0x24f6] = 1; I[0x24f7] = 1; I[0x24f9] = w * h * 4; I[0x24fb] = w; I[0x24fc] = h;
    this.d.getBackBuffer();
    this.i100035b0();
    this.r100028f0();
    I[0xce7b] = 1;
    this.w10007a60();
    if (I[0xd895] === 0) this.c10001500();
    I[0xce7c] = 1;
  }
  /** 0x100035b0 InitDeviceObjects: the fonts' textures, the water's device */
  private i100035b0(): void {
    this.I[0xce9c] = 1; this.I[0xce9d] = 1;
    this.fonts.push(fontInit(this.d), fontInit(this.d));
  }
  /** 0x100028f0 RestoreDeviceObjects */
  private r100028f0(): void {
    const I = this.I, d = this.d;
    for (const t of this.fonts) fontRestore(d, t, this.blocks);
    const L = new ArrayBuffer(104), lv = new DataView(L), lf = new Float32Array(L);
    lv.setUint32(0, 3, true);
    lf[1] = this.F[0xce8a]; lf[2] = this.F[0xce8b]; lf[3] = this.F[0xce8c]; lf[4] = this.F[0xce8d];
    lf[5] = 1; lf[6] = 1; lf[7] = 1;
    lf[16] = this.F[0xce86]; lf[17] = this.F[0xce87]; lf[18] = this.F[0xce88];
    d.setLight(0, L);
    d.lightEnable(0, false);
    const M = new ArrayBuffer(68), mf = new Float32Array(M);
    mf[3] = 0.5; mf[7] = 0.1; mf[8] = 0.5; mf[9] = 0.5; mf[10] = 0.5; mf[16] = 20;
    d.setMaterial(M);
    this.setVs(2);
    d.setTransform(Ts.VIEW, this.mat(MA));
    d.setTransform(Ts.WORLD, this.mat(MC));
    for (const [s, v] of [[Rs.LIGHTING, 0], [Rs.SPECULARENABLE, 0], [Rs.ZFUNC, 4], [Rs.CULLMODE, 2], [Rs.SHADEMODE, 2], [Rs.FILLMODE, 3]] as [Rs, number][]) d.setRenderState(s, v);
    for (const st of [0, 1]) {
      for (const [s, v] of [[1, 1], [2, 2], [3, 1], [4, 1], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1], [11, 0]] as [Tss, number][]) d.setTextureStageState(st, s, v);
    }
    const ct = d.createTexture(128, 128, 1, Usage.RENDERTARGET, Fmt.X8R8G8B8, Pool.DEFAULT);
    I[0xce9a] = this.handle(ct);
    I[0xce9b] = this.handle(ct.getSurfaceLevel(0));
    this.rts = new RenderToSurface(d, 128);
    I[0xce85] = this.handle(this.rts);
    this.eff = new Effect10(d, () => this.vs);
    I[0xce83] = this.handle(this.eff);
    this.eff.param(0, this.tex(0xce92)); this.eff.param(1, ct);
    this.eff.technique();                        // 0x10001890: SetTechnique + Validate
    this.w10007840();
  }
  /** 0x10002dc0 InvalidateDeviceObjects */
  private i10002dc0(): void {
    const d = this.d;
    for (const b of this.blocks) d.deleteStateBlock(b);
    this.blocks.length = 0;
    this.eff?.release();
    for (const i of [0x24a5, 0x24a6, 0x24a7, 0xce85, 0xce83, 0xce9b, 0xce9a]) this.release(i);
  }
  /** 0x10001150 Reset: invalidate, IDirect3DDevice8::Reset, the back buffer's description, restore */
  private r10001150(): void {
    this.i10002dc0();
    (this.d as Device & { reset?(w: number, h: number): void }).reset?.(this.I[0x24ae], this.I[0x24af]);
    this.d.getBackBuffer();
    this.I[0x24fb] = this.I[0x24ae]; this.I[0x24fc] = this.I[0x24af];
    this.r100028f0();
  }
  /** 0x10001500: the camera fields, then 0x100016b0 / 0x100017b0 */
  private c10001500(): void {
    const I = this.I;
    for (let k = 0x1d9b; k <= 0x1da0; k++) I[k] = 0;
    for (let k = 0x1da7; k <= 0x1db8; k++) I[k] = 0;
    I[0x1db4] = 0x3e4ccccd;
    this.c100016b0(); this.c100017b0();
  }
  /** the camera distance for a texture size t (0x100016b0 / 0x100017b0) */
  private camZ(t: number, cur: number): number {
    const v = (0x11c - this.I[0x36290 >> 2]) * fr(-0.10700000077486038);
    let r = cur;
    if (t === 0x100) r = fr((v + fr(30.65999984741211)) * -2);
    if (t === 0x200) r = fr(-(v + fr(30.65999984741211)));
    if (t === 0x400) r = fr(-(v * 0.5 + fr(15.475000381469727)));
    if (t === 0x800) r = fr(-(v * 0.25 + fr(7.737500190734863)));
    if (t > 0x800) r = fr(-(v * 0.125 + fr(3.8687500953674316)));
    return r;
  }
  /** 0x100016b0: the clouds' distance (cloud texture size), and 0x768c */
  private c100016b0(): void {
    const F = this.F;
    F[0x7674 >> 2] = this.camZ(this.I[0x94fc >> 2], 0);
    F[0x8038 >> 2] = F[0x7674 >> 2];
    F[0x768c >> 2] = (100 - this.I[0x9064 >> 2]) * fr(0.009999999776482582) * F[0x7674 >> 2];
  }
  /** 0x100017b0: the sky's distance (sky texture size) */
  private c100017b0(): void {
    const F = this.F;
    F[0x7668 >> 2] = this.camZ(this.I[0x9504 >> 2], 0);
    F[0x803c >> 2] = F[0x7668 >> 2];
  }

  // ======== CWater (DirectX 8 SDK Water sample) at 0x9264, 4x4 ========
  /** 0x100076d0 CWater::Initialize(size, depth): sizes and the refraction table (water's index 1.333) */
  private w100076d0(size: number, depth: number): void {
    const I = this.I, F = this.F;
    F[0x9264 >> 2] = size; F[0x9268 >> 2] = depth; I[0x9284 >> 2] = 16; I[0x9280 >> 2] = 32; F[0x926c >> 2] = 1 / size;
    if (I[0x928c >> 2] === 0) {
      I[0x928c >> 2] = 1;
      const R = this.refract, U = this.refractU, k = 0.7501875758171082;
      for (let i = 0; i < 256; i++) {
        const t = i * 0.00390625;
        const s = Math.sqrt((1 + t) * (1 - t));            // sin(acos t)
        const sf = fr(s), s2 = s * k, s2f = fr(s2);
        const c = Math.sqrt(1 - s2 * s2);                  // cos(asin s2)
        R[(256 + i) * 3] = (sf / s2f) * c - fr(t);
        R[(256 + i) * 3 + 1] = -(s2f / sf);
        const a = 0xff - i;
        U[(256 + i) * 3 + 2] = ((Math.imul(Math.imul(a, a), a) & 0xffff0000) << 8) >>> 0;
      }
      for (let i = 0; i < 256; i++) for (let j = 0; j < 3; j++) U[i * 3 + j] = U[256 * 3 + j];
    }
    if (!I[0x9288 >> 2]) I[0x9288 >> 2] = this.heap.malloc(0x80);
  }
  /** 0x10007a60: heights and velocities to 0 */
  private w10007a60(): void { const p = this.I[0x9288 >> 2]; if (p) this.B.fill(0, p, p + 0x80); }
  /** 0x10007840 CWater::RestoreDeviceObjects: the strip's indices, the two vertex buffers */
  private w10007840(): void {
    const d = this.d, I = this.I;
    const ib = d.createIndexBuffer(0x40, 0, Fmt.INDEX16, Pool.DEFAULT);
    const L = ib.lock(0, 0x40, 0), idx = new Uint16Array(L.buffer, L.byteOffset, 32);
    let o = 0, x = 0, y = 0;
    for (let m = 4; m !== 0; m -= 2) {
      for (let k = 0; k < m; k++) { idx[o++] = x + y * 4; idx[o++] = x + (y + 1) * 4; x++; }
      x--; y++;
      for (let k = 1; k < m; k++) { const v = y * 4 + x; idx[o++] = v; idx[o++] = v - 1; y++; }
      y--; x--;
      for (let k = 1; k < m; k++) { idx[o++] = x + y * 4; idx[o++] = x + (y - 1) * 4; x--; }
      x++; y--;
      for (let k = 2; k < m; k++) { const v = y * 4 + x; idx[o++] = v; idx[o++] = v + 1; y--; }
      y++; x++;
    }
    for (let k = 0; k < 32; k++) if (idx[k] >= 16) idx[k] = 0;
    ib.unlock();
    I[0x9294 >> 2] = this.handle(ib);
    I[0x9298 >> 2] = this.handle(d.createVertexBuffer(16 * 0x24, Usage.DYNAMIC, 0x152, Pool.DEFAULT));
    I[0x929c >> 2] = this.handle(d.createVertexBuffer(16 * 16, Usage.DYNAMIC | Usage.WRITEONLY, 0x42, Pool.DEFAULT));
  }
  /** 0x10007a80 CWater::Update(vecPos = 0, vecLight = (0, 1, 0), bCalcCaustics) */
  private w10007a80(caustics: boolean): void {
    const F = this.F, S = this.I[0x9288 >> 2] >> 2;
    const h = (i: number): number => F[S + i * 2];
    F[0x9270 >> 2] = 0;
    let c = S;
    for (let yN = 0xc, y = 0, yP = 4; ; ) {
      for (let xN = 3, x = 0, xP = 1; ; ) {
        const want = (((h(x + yP) + h(xP + y)) + h(xN + y)) + h(x + yN)) * fr(0.1666666716337204)
          + (((h(xP + yP) + h(xN + yP)) + h(xP + yN)) + h(xN + yN)) * fr(0.0833333358168602);
        F[0x362cc >> 2] = 20;
        if (F[c + 1] > 20 || F[c + 1] < -20) F[c + 1] = F[c + 1] * fr(0.8999999761581421);
        if (F[c + 1] > F[0x362cc >> 2] || !(-F[0x362cc >> 2] <= F[c + 1])) F[c + 1] = F[c + 1] * fr(0.8999999761581421);
        F[c + 1] = (want - F[c]) * F[0x77bc >> 2] + F[c + 1];
        F[0x9270 >> 2] = (F[c + 1] + F[c]) + F[0x9270 >> 2];
        c += 2;
        xN = x; x = xP; xP = (xP + 1) & 3;
        if (x === 0) break;
      }
      yN = y; y = yP; yP = (yP + 4) & 0xc;
      if (y === 0) break;
    }
    F[0x9270 >> 2] = F[0x9270 >> 2] / this.I[0x9284 >> 2];
    const avg = F[0x9270 >> 2];
    const vb = this.obj<Buffer>(0x9298 >> 2);
    const V = vb.lock(0, this.I[0x9284 >> 2] * 0x24, 0);
    const vf = new Float32Array(V.buffer, V.byteOffset, V.byteLength >> 2), vu = new Uint32Array(vf.buffer, vf.byteOffset, vf.length);
    const size = F[0x9264 >> 2], inc = fr(size * fr(0.3333333432674408)), depth = F[0x9274 >> 2], scale = F[0x926c >> 2];
    let fZ = fr(size * -0.5);
    const N = new Float32Array(3), R = this.refract;
    const dif = (ftol(F[0x4e8 >> 2]) << 24) >>> 0;
    let o = 0, cell = S;
    for (let yN = 0xc, y = 0, yP = 4; ; ) {
      let fXd = size * -0.5, fX = fr(fXd);
      for (let xN = 3, x = 0, xP = 1; ; ) {
        const hp = (F[cell + 1] + F[cell]) - avg;
        F[cell] = hp;
        const d1 = fr(h(xN + yN) - h(xP + yP));
        const e = fr((h(x + yN) - h(x + yP)) + d1);
        const d3 = h(xP + yN) - h(xN + yP);
        const nx1 = fr(d1 - d3), nz = fr(e + d3);
        const nx = fr((h(xN + y) - h(xP + y)) + nx1);
        vec3Normalize(N, 0, nx, 1, nz);
        // the eye vector: vecPos (0, 0, 0) normalized is 0, so the refraction index is always entry 0
        const r0 = R[256 * 3], rn = R[256 * 3 + 1];
        vf[o] = fXd; vf[o + 1] = hp; vf[o + 2] = fZ;
        vf[o + 3] = N[0]; vf[o + 4] = N[1]; vf[o + 5] = N[2];
        vu[o + 6] = dif;
        const t60 = fr(r0 * N[0]);
        const t6c = fr(t60 + 0);
        const rz = (r0 * N[2] + 0) * rn;
        const t78 = fr(t6c * rn);
        vf[o + 7] = ((t78 * depth + fX) * scale) + 0.5;
        vf[o + 8] = ((rz * depth + fZ) * scale) + 0.5;
        fXd = fX + inc; fX = fr(fXd);
        o += 9; cell += 2;
        xN = x; x = xP; xP = (xP + 1) & 3;
        if (x === 0) break;
      }
      fZ = fr(fZ + inc);
      yN = y; y = yP; yP = (yP + 4) & 0xc;
      if (y === 0) break;
    }
    if (caustics) {
      const cb = this.obj<Buffer>(0x929c >> 2);
      const C = cb.lock(0, this.I[0x9284 >> 2] << 4, 0);
      const cf = new Float32Array(C.buffer, C.byteOffset, C.byteLength >> 2), cu = new Uint32Array(cf.buffer, cf.byteOffset, cf.length);
      for (let k = 1; k <= 8; k++) this.diffuse[k - 1] = Math.imul(((this.I[0x765c >> 2] >>> 0) / k) >>> 0, 0x10101) >>> 0;
      let vo = 0, co = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const ii = ftol(vf[vo + 4] * -255);
          const ri = (256 - ii) * 3;
          const r0 = R[ri], rn = R[ri + 1];
          const t78 = fr(r0 * vf[vo + 3]);
          const t6c = fr(t78 + 0);                   // + vecLight.x
          const rz = (r0 * vf[vo + 5] + 0) * rn;     // + vecLight.z
          const t60 = fr(t6c * rn);
          cf[co + 1] = 0;
          cf[co] = t60 * depth + vf[vo];
          cf[co + 2] = rz * depth + vf[vo + 2];
          if (x !== 0 && y !== 0) {
            let area = (cf[co - 14] - cf[co + 2]) * (cf[co - 20] - cf[co]) - (cf[co - 18] - cf[co + 2]) * (cf[co - 16] - cf[co]);
            if (area < 0) area = -area;
            const kk = ftol(area * area * 4);
            cu[co + 3] = (kk >>> 0) < 8 ? this.diffuse[kk] : 0;
          }
          co += 4; vo += 9;
        }
        cu[co - 16 + 3] = cu[co - 1];
      }
      for (let k = 0; k < 4; k++) cu[k * 4 + 3] = cu[48 + k * 4 + 3];
      cb.unlock();
    }
    vb.unlock();
  }
  /** 0x10008180: the cloud's (or sky's) alpha into the diffuse of vertices 0..14 */
  private w10008180(): void {
    const I = this.I, vb = this.obj<Buffer>(0x9298 >> 2);
    const V = vb.lock(0, I[0x9284 >> 2] * 0x24, 0), vu = new Uint32Array(V.buffer, V.byteOffset, V.byteLength >> 2);
    const a = (I[0x3c488 >> 2] << 24) >>> 0;
    for (let k = 0; k < 15; k++) vu[k * 9 + 6] = a;
    I[0x36274 >> 2] = 16;
    vb.unlock();
  }
  /** 0x10008100 CWater::DrawSurface */
  private w10008100(): void {
    const d = this.d, I = this.I;
    d.setStreamSource(0, this.obj<Buffer>(0x9298 >> 2), 0x24);
    d.setIndices(this.obj<Buffer>(0x9294 >> 2), 0);
    d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, I[0x9284 >> 2], 0, I[0x9280 >> 2] - 2);
  }

  // ======== 0x1000aa20: the audio step, then the scene and the frame ========
  private a1000aa20(lv: Uint8Array): void {
    const I = this.I, F = this.F;
    for (let i = 0; i < 0x100; i++) {
      for (const b of [0, 0x400]) {
        let m = lv[b + i * 4]; if (m < lv[b + i * 4 + 1]) m = lv[b + i * 4 + 1]; if (m < lv[b + i * 4 + 2]) m = lv[b + i * 4 + 2]; if (m < lv[b + i * 4 + 3]) m = lv[b + i * 4 + 3];
        lv[b + i] = m;
      }
    }
    I[0x1fd9]++;
    for (let i = 0; i < 10; i++) { const v = lv[i + 0x32]; if (I[0x1fda + i] !== v) { I[0x1fda + i] = v; I[0x1fd9] = 0; } }
    I[0xd89d] = 10;
    if (I[0x1fd9] > 6) {
      I[0x1fd9] = 7;
      for (let i = 0; i < 0xff; i++) { lv[1 + i] = 0; lv[0x401 + i] = 0; }
      I[0xd89d] = 0xff;
    }
    let sum = 0, n = 0;
    I[0xd085] = 0; I[0xd889] = 0xff;
    for (let i = 1; i < 0xff; i++) {
      if (I[0xf131] === 1) { I[0xcf86 + i] = 0; I[0xd18e + i] = 0; } else { I[0xcf86 + i] = lv[i]; I[0xd18e + i] = lv[0x400 + i]; }
      if (lv[i] !== 0) { sum += lv[i]; n++; }
    }
    I[0xd901] = 0xff; I[0xd89d] = n;
    I[0x1fe5] = n === 0 ? 0 : (sum / n) | 0;
    I[0x1fe8] = n;
    if (I[0x1fe5] > 0xff) I[0x1fe5] = 0xff;
    let k = I[0x1fe6] + 1; if (k > 0x42) k = 0; I[0x1fe6] = k;
    I[0xcf22 + k] = I[0x1fe5];
    let s = 0; for (let j = 0; j < 0x43; j++) s += I[0xcf22 + j];
    I[0xd901] = 0x43;
    I[0x1fe7] = (s / 0x44) | 0;
    const now = this.tgt();
    const dt = (now - I[0x27]) >>> 0;
    if (dt > 1000) {
      I[0x28] = Math.floor((Math.imul(I[0x26], 1000) >>> 0) / dt);
      I[0x27] = this.tgt();
      I[0x26] = 0;
      if ((I[0x28] >>> 0) > 2) F[0x29] = (F[0x29] * 10 + I[0x28]) * fr(0.09090909361839294);
    }
    I[0x26]++;
    if (F[0x29] <= 10) I[0xf131] = 1;
    this.s100127d0();
    this.f10003630();
  }

  // ======== the scene (0x100127d0 / 0x10012810) ========
  private s100127d0(): void {
    if (this.I[0xd895] === 0) { this.i10011dd0(); this.I[0x1fa4] = 1; }
    this.s10012810();
  }
  private s10012810(): void {
    const I = this.I, F = this.F;
    I[0xd90e] = (I[0xd90e] + 1) & 0xf;          // every 16th: UserRating of the current media (none without media)
    if (I[0xd8c5] !== 1) return;
    this.b10018340();
    this.s10012ea0();
    if (I[0xd897] === 1) return;
    if (I[0xd895] === 0) {
      I[0xd895] = 1;
      this.resetBars();
      I[0x1d7f] = 0x37; I[0xf114] = 8;
      for (const [s, t] of [[0x14, 0xce93], [0x15, 0xce94], [0x16, 0xce95], [0x17, 0xce96]]) {
        I[CUR] = s;
        this.c10012f30();
        this.c10014ed0();
        this.release(t);
        I[t] = I[0xce92]; I[0xce92] = 0;
      }
      return;
    }
    const n = I[0xf115] + 1; I[0xf115] = n;
    if ((I[0xf11b] === 1 || I[0x1fe7] > 0) && (n & 1) === 0) {
      let draw = true;
      if (I[0x1fe7] < 1) {
        I[0xd89f] = 0;
        for (; I[0xd89f] < 0x28; I[0xd89f]++) if (F[0x246f + I[0xd89f]] < 83) { draw = false; break; }
        if (draw) { I[0xf11b] = 0; this.resetBars(); }
      } else I[0xf11b] = 1;
      // draw = false: the jump past the panel's frame-rate choice (0x10012b8c) still draws it
      void draw;
      if (F[0x29] <= 15 || I[0xd8a3] < 0x321 || I[0xd8a4] < 0x259) I[0xf11a] = 0;
      else if (F[0x29] > 17 && I[0xf11a] === 0) I[0xf11a] = 1;
      if (I[0xf12e] === 0 && I[0xf131] < 2) this.panel(I[0xf11a] !== 0);
      for (I[0xd89f] = 0; I[0xd89f] < 0x28; I[0xd89f]++) if (F[0x246f + I[0xd89f]] < 83) I[0xf125] = this.tgt();
    }
    I[0xf114] = 8;
    for (I[0xd89e] = 0; I[0xd89e] < I[0xf114]; I[0xd89e]++) { I[CUR] = I[0xd89e] + 0x14; this.c10014f10(); }
    I[CUR] = 0xe;
    // 0x10015340: the album-art sprite's fades; idle without media (I[0xf123] stays -1)
  }
  /** the bars' levels to 0 and their peaks to 83 */
  private resetBars(): void {
    const I = this.I;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 0x28; a++) { I[0x241f + b * 0x28 + a] = 0; I[0x246f + a] = 0x42a60000; }
    I[0xd89d] = 2; I[0xd89f] = 0x28;
  }
  /** 0x10012ea0: a new window size */
  private s10012ea0(): void {
    const I = this.I;
    if (I[0xd8c4] !== I[0xd8a4] || I[0xd8c3] !== I[0xd8a3]) {
      I[0xd898] = 1; I[0xd8c3] = I[0xd8a3]; I[0xd8c4] = I[0xd8a4];
      this.c100016b0();
    }
  }

  // ======== the 2D layers (GDI+ in the DLL, pictures here) ========
  /** 0x10018340: the background for a new window size: sprite 6 (and its two copies), the sky texture, the panel */
  private b10018340(): void {
    const I = this.I, F = this.F;
    if (I[0xd8c4] === I[0xd8a4] && I[0xd8c3] === I[0xd8a3] && I[0x1fa4] === 0) return;
    if (I[0xf123] === 2) I[0xf123] = 0;
    I[0xf131] = 0; I[0x1fa4] = 0; F[0x29] = 20; I[0x1fa0] = 1;
    I[CUR] = 6;
    this.s10012380();
    this.b10010040();
    const s = I[CUR];
    I[0x2016] = I[SP(s, 0x22)]; I[0x2017] = I[SP(s, 0x23)];
    I[0xd87a] = I[SP(s, 0xa)];
    if (I[SP(s, 1)] === -1 && I[0x2016] > 0 && I[0x2017] > 0 && I[0xd87a] !== 0) {
      if (I[SP(s, 0x2f)] === 0) {
        const n = I[0x2016] * I[0x2017] * 4;
        const a = this.heap.malloc(n), b = this.heap.malloc(n);
        I[0xd8a2] = 0; I[SP(s, 0x2f)] = a; I[SP(s, 0x68)] = b;
        const src = I[SP(s, 0xa)];
        this.B.copyWithin(a, src, src + n); this.B.copyWithin(b, src, src + n);
        I[0xd870] = a + n; I[0xd871] = b + n; I[0xd87a] = src + n; I[0xd89d] = n >> 2;
      }
      I[CUR] = 6;
      this.t10011720();
      this.c100017b0();
      this.panel(I[0xf11a] !== 0);
    }
  }
  /** 0x10010040: sprite 6 (the sky, the window's size), sprite 2 (the panel's backdrop) and its hd buffer */
  private b10010040(): void {
    const I = this.I, w = I[0xd8a3], h = I[0xd8a4];
    if (I[0x1f82] === 0) I[0x1f82] = 1;
    I[0xd8b8] = 0; I[0xd8b9] = 0;
    const art = this.opt.art.background(w, h);
    I[0xd8fe] = w * h;
    const p = this.heap.malloc(w * h * 4 + 0xc);
    I[p >> 2] = w; I[(p + 4) >> 2] = h; I[(p + 8) >> 2] = 0;
    const px = p + 0xc;
    I[0xd8e3] = px; I[0xd873] = px + w * h * 4;
    I[0xf116] = w;
    I[0xf117] = this.bandRows(I[0xf120], I[0xf11f]);
    this.B.set(art.sky.subarray(0, w * h * 4), px);
    I[0xd8d6] = w; I[0xd8d5] = h;
    let s = I[CUR];
    I[SP(s, 1)] = -1; I[SP(s, 0x22)] = w; I[SP(s, 0x23)] = h; I[SP(s, 0xc)] = w; I[SP(s, 0xd)] = h; I[SP(s, 0xa)] = px;
    if (I[SP(s, 4)] === 0) I[SP(s, 4)] = 2;
    I[0xd8a2] = 0;
    I[0x1d17] = I[CUR]; I[CUR] = 2; s = 2;
    // sprite 2: the band of the sky behind the panel, scaled to f11f x f120 (and the hd buffer f118 x f119)
    const bw = I[0xf11f], bh = I[0xf120], n = bw * bh;
    I[0xd8fe] = n;
    const q = this.heap.malloc(n * 4 + 0xc);
    I[q >> 2] = bw; I[(q + 4) >> 2] = bh; I[(q + 8) >> 2] = 0;
    I[0xd8e3] = q + 0xc; I[0xd873] = q + 0xc + n * 4;
    this.B.set(art.band.subarray(0, n * 4), q + 0xc);
    I[SP(s, 1)] = -1; I[SP(s, 0x22)] = bw; I[SP(s, 0x23)] = bh; I[SP(s, 0xc)] = bw; I[SP(s, 0xd)] = bh; I[SP(s, 0xa)] = q + 0xc;
    const hn = I[0xf118] * I[0xf119];
    const r = this.heap.malloc(hn * 4);
    this.B.set(art.bandHd.subarray(0, hn * 4), r);
    I[SP(s, 0x2f)] = r;
    I[0xd8d6] = I[0xf118]; I[0xd8d5] = I[0xf119];
    I[CUR] = I[0x1d17];
  }
  /** f117: the panel's rows, ftol(sh / sw * window width) capped at half the window's height */
  private bandRows(sh: number, sw: number): number {
    const I = this.I;
    let r = ftol(sh / sw * I[0x3628c >> 2]);
    if (I[0x36290 >> 2] * 0.5 < r) r = ftol(I[0x36290 >> 2] * 0.5);
    return r;
  }
  /** 0x10015bd0 / 0x10016dc0 around the GDI+ part (mp10/eqpanel.ts): the guards, the size, the copy of the result
   *  into sprite 6's bottom rows */
  private panel(hd: boolean): void {
    const I = this.I;
    const s2 = SP(2, 0);
    if (I[s2 + 0x22] !== I[0xf11f] || I[s2 + 0x23] !== I[0xf120] || I[SP(6, 0x68)] === 0 || I[s2 + 0xa] === 0) return;
    if (hd && I[s2 + 0x2f] === 0) return;
    const w = I[0x3628c >> 2];
    I[0xf116] = w;
    I[0xf117] = hd ? this.bandRows(I[0xf119], I[0xf118]) : this.bandRows(I[0xf120], I[0xf11f]);
    const sh = I[SP(6, 0x23)], sw = I[SP(6, 0x22)];
    if (sh < I[0xf117] && sw !== w) return;
    I[0xd8d5] = sh; I[0xd8d6] = sw; I[0xd8fe] = sh * sw;
    if (I[SP(6, 1)] !== -1 || sh * sw === 0 || I[0xf117] > sh) return;
    const src = hd ? I[s2 + 0x2f] : I[s2 + 0xa];
    const n = hd ? I[0xf118] * I[0xf119] : I[0xf11f] * I[0xf120];
    const out = this.opt.panel({ heap: this.heap, src: this.B.subarray(src, src + n * 4), hd });
    const px = I[SP(6, 0xa)];
    I[0xd872] = px;
    const rows = sh - I[0xf117];
    if (rows > 0 && sw - I[0xf116] >= 0) {
      I[0x1fa5] = sw; I[0x1fa6] = sh;
      const m = I[0xf116] * I[0xf117], dst = px + rows * sw * 4;
      this.B.set(out.subarray(0, m * 4), dst);
      I[0xd89f] = m; I[0xd870] = dst + m * 4;
    }
  }

  /** 0x10012f30: cloud sprite (Cloud_1 for even pairs, Cloud_2 for odd; the second of each pair at half height),
   *  stored bottom-up, its alpha from the red channel */
  private c10012f30(): void {
    const I = this.I, F = this.F, s = I[CUR];
    this.s10012380();
    I[0xd8b8] = 0; I[0xd8b9] = 0;
    const pic = this.opt.art.cloud((s & 2) === 0 ? 1 : 2, (s & 1) !== 0);
    const w = pic.w, h = pic.h;
    I[0x7e94 >> 2] = w; I[0x7e98 >> 2] = h;
    I[SP(s, 0x22)] = w; I[SP(s, 0x23)] = h;
    I[0xd8d6] = w; I[0xd8d5] = h; I[0xd8fe] = w * h;
    const p = this.heap.malloc(w * h * 4 + 0xc);
    I[p >> 2] = w; I[(p + 4) >> 2] = h; I[(p + 8) >> 2] = 0;
    const px = p + 0xc;
    I[0xd8e3] = px; I[0xd873] = px + w * h * 4;
    const A = cloudAlpha(), U = this.U;
    for (let y = 0; y < h; y++) {
      const dst = (px + (h - 1 - y) * w * 4) >> 2;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const src = (pic.px[i] | (pic.px[i + 1] << 8) | (pic.px[i + 2] << 16) | (pic.px[i + 3] << 24)) >>> 0;
        const r = pic.px[i + 2];
        U[dst + x] = ((A.a1[r]) ^ ((A.a2[r] ^ src) & 0xffffff)) >>> 0;
      }
    }
    if (w * h) U[0x362cc >> 2] = A.f[pic.px[(w * h - 1) * 4 + 2]];
    I[SP(s, 1)] = -1; I[SP(s, 0xa)] = px; I[SP(s, 8)] = 1; I[SP(s, 5)] = 10; I[SP(s, 6)] = -100000;
    F[TR(s, 0xb0)] = 0; F[TR(s, 0xb4)] = 0; F[TR(s, 0xb8)] = 10; F[TR(s, 0xbc)] = -100000; F[TR(s, 0xc0)] = 0;
  }
  /** 0x10014ed0: the current sprite's texture, then 0x100016b0 */
  private c10014ed0(): void {
    if (this.I[SP(this.I[CUR], 0x22)] === 0) return;
    this.c100112d0();
    this.c100016b0();
  }
  /** the texture size for a w x h sprite: 256, doubled until it exceeds the larger side */
  private texSize(w: number, h: number): number {
    const m = h < w ? w : h;
    let t = 0x100;
    if (m > 0xff) do t *= 2; while (t === m || t < m);
    return t;
  }
  /** a sprite in a T x T TGA (DATATABLE_tga's header: 32 bits, bottom-up) through D3DXCreateTextureFromFileInMemory */
  private tgaTexture(tga: Uint32Array, T: number): Texture {
    const top = new Uint8Array(T * T * 4), tb = new Uint8Array(tga.buffer, tga.byteOffset, tga.byteLength);
    for (let y = 0; y < T; y++) top.set(tb.subarray((T - 1 - y) * T * 4, (T - y) * T * 4), y * T * 4);
    return textureFromPixels(this.d, top, T, T, Fmt.A8R8G8B8);
  }
  /** 0x100112d0: a cloud's texture -> I[0xce92] */
  private c100112d0(): void {
    const I = this.I, s = I[CUR];
    I[0xd8b8] = 0; I[0xd8b9] = 0;
    const w = I[SP(s, 0x22)], h = I[SP(s, 0x23)];
    if (I[0x24be] === 0 || w < 1 || I[0x24bf] === 0 || h < 1) return;
    I[0xd8b8] = w; I[0xd8b9] = h; I[0xd8ea] = h < w ? w : h;
    const T = this.texSize(w, h);
    I[0x253e] = T; I[0x253f] = T;
    if (I[0x2542] < T) return;
    this.release(0xce92);
    const tga = new Uint32Array(T * T);
    let oy = ((T - h) / 2) | 0; oy -= oy & 1;
    const ox = ((T - w) / 2) | 0;
    I[0xd8ec] = oy; I[0xd8eb] = ox;
    const src = I[SP(s, 0xa)] >> 2;
    for (let j = 0; j < h; j++) tga.set(this.U.subarray(src + j * w, src + (j + 1) * w), (oy + j + 1) * T + ox);
    I[0xd89d] = w; I[0xd89f] = h;
    I[0xd880] = T; I[0xd881] = T;
    I[0xce92] = this.handle(this.tgaTexture(tga, T));
    this.eff?.param(0, this.tex(0xce92));
  }
  /** 0x10011720: the sky's texture -> I[0xce90]: sprite 6 turned half a turn, read from one pixel past its end */
  private t10011720(): void {
    const I = this.I, s = I[CUR];
    I[0xd8b8] = 0; I[0xd8b9] = 0;
    const w = I[SP(s, 0x22)], h = I[SP(s, 0x23)];
    if (I[0x24be] === 0 || w < 1 || I[0x24bf] === 0 || h < 1) return;
    I[0xd8b8] = w; I[0xd8b9] = h; I[0xd8ea] = h < w ? w : h;
    const T = this.texSize(w, h);
    I[0x2540] = T; I[0x2541] = T;
    if (I[0x2542] < T) return;
    this.release(0xce90);
    const tga = new Uint32Array(T * T);
    let ox = ((T - w) / 2) | 0; ox -= ox & 1;
    let oy = ((T - h) / 2) | 0; oy -= oy & 1;
    I[0xd8ec] = oy; I[0xd8eb] = ox;
    const src = I[SP(s, 0xa)] >> 2;
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) tga[(oy + j + 1) * T + ox + w - k] = this.U[src + w * h - (j * w + k)];
    I[0xd89d] = w; I[0xd89f] = h;
    I[0xd880] = T; I[0xd881] = T;
    I[0xce90] = this.handle(this.tgaTexture(tga, T));
    this.eff?.param(0, this.tex(0xce90));
  }

  /** 0x10014f10: cloud s's motion. Even s: now and then (rand() & 7 == 0, 5 s apart at least) a pair starts: it rises
   *  and fades out over 34 s; odd s: its partner's alpha follows a slow sine */
  private c10014f10(): void {
    const I = this.I, F = this.F, s = I[CUR], tm = F[TIME];
    if ((s & 1) === 0) {
      const t = this.tgt();
      const go = ((t - I[0xf112]) >>> 0) > 5000;
      const r = this.crt.rand();
      if (go && (r & 7) === 0 && I[SP(s, 4)] === 0) {
        I[SP(s, 4)] = 1;
        I[(0x73b0 >> 2) + s] = this.tgt();
        I[0xf112] = this.tgt();
        F[TR(s, 0xb8)] = s === 0x18 || s === 0x14 ? sinMul(tm * fr(1.3300000429153442), 15) : sinMul(tm * fr(3.3299999237060547), 20);
        F[TR(s, 0xbc)] = 0; F[TR(s, 0xc0)] = 20;
        I[SP(s + 1, 4)] = 1;
        I[(0x73b4 >> 2) + s] = this.tgt();
        F[TR(s + 1, 0xb8)] = sinMul(tm * 0.5, 7);
        F[TR(s + 1, 0xc0)] = (sinD(tm * fr(2.700000047683716)) + 1) * -5;
      }
      F[TR(s + 1, 0xbc)] = -0.5 - (sinD(tm * fr(0.30000001192092896)) + 1) * 1.5;
      const q = ((this.tgt() - I[(0x73b0 >> 2) + s]) >>> 0) * fr(2.499999936844688e-05);
      F[0x3c44c >> 2] = q;
      if (q < fr(0.8500000238418579)) {
        F[TR(s, 0x178)] = q * 0.5 + fr(2.6500000953674316);
        const fq = F[0x3c44c >> 2];
        F[TR(s + 1, 0x178)] = fq * 0.5 + fr(2.6500000953674316);
        F[TR(s, 0xc0)] = fq * 50 + 20;
        F[TR(s, 0xbc)] = fq * 15;
        I[SP(s, 0x17)] = 0xff - ftol(fq * 2000);
      } else I[SP(s, 4)] = 0;
    } else {
      I[SP(s, 0x17)] = ftol(sinMul(tm * fr(0.20000000298023224), 260));
      if (I[SP(s, 0x17)] < I[SP(s - 1, 0x17)]) I[SP(s, 0x17)] = I[SP(s - 1, 0x17)];
      if (I[SP(s, 0x17)] >= 0xff) {
        F[TR(s, 0xb8)] = sinMul(tm * 0.5, 7);
        F[TR(s, 0xc0)] = (sinD(tm * fr(2.700000047683716)) + 1) * -5;
      }
    }
    if (I[SP(s, 0x17)] <= 0) I[SP(s, 0x17)] = 0;
    if (I[SP(s, 0x17)] > 0xff) I[SP(s, 0x17)] = 0xff;
  }

  // ======== 0x10003630: the frame ========
  private f10003630(): void {
    const I = this.I, F = this.F;
    if (I[0x24be] === 0 || I[0x24bf] === 0) return;       // 0x100011c0: TestCooperativeLevel
    const app = this.tm.cmd(5), el = this.tm.cmd(6);
    if (el === 0) return;
    F[0x2508] = el; F[TIME] = app;
    const d = this.d;
    d.setTextureStageState(0, Tss.COLOROP, 1); d.setTextureStageState(0, Tss.ALPHAOP, 1);
    d.setTextureStageState(1, Tss.COLOROP, 1); d.setTextureStageState(1, Tss.ALPHAOP, 1);
    d.setRenderState(Rs.SHADEMODE, 2);
    this.m10003780();
    d.setTransform(Ts.VIEW, this.mat(MB));
    this.c10005410();
    d.setTransform(Ts.VIEW, this.mat(MA));
    this.s10005690();
    d.present();
  }
  /** rot(o) * m: D3DXMatrixRotationQuaternion(D3DXQuaternionRotationYawPitchRoll(F[o], F[o+1], F[o+2])) * m */
  private rot(m: number, yaw: number, pitch: number, roll: number): void {
    const q = new Float32Array(4), M = new Float32Array(16);
    quatYawPitchRoll(q, yaw, pitch, roll);
    matRotQuat(M, q);
    matMul(this.mat(m), M, this.mat(m));
  }
  private rotF(m: number, o: number): void { const F = this.F; this.rot(m, F[o], F[o + 1], F[o + 2]); }
  private trans(m: number, o: number): void { const F = this.F; translation(this.mat(m), F[o], F[o + 1], F[o + 2]); }
  /** the scale the 2D positions use: 0.0622 per unit of distance, by texture size */
  private scale36238(q: number, t: number): void {
    const F = this.F;
    F[0x362cc >> 2] = q;
    F[0x36238 >> 2] = q * fr(0.062199998646974564);
    if (t === 0x100) F[0x36238 >> 2] = q * fr(0.062199998646974564) * 4;
    if (t === 0x200) F[0x36238 >> 2] = F[0x36238 >> 2] + F[0x36238 >> 2];
    if (t === 0x800) F[0x36238 >> 2] = F[0x36238 >> 2] * 0.5;
    if (t > 0x800) F[0x36238 >> 2] = F[0x36238 >> 2] * 0.25;
  }
  /** 0x10003780: the frame's matrices */
  private m10003780(): void {
    const I = this.I, F = this.F;
    for (const m of [MA, MB, MC, MD, ME, MG]) this.ident(m);
    F[0x76a4 >> 2] = -54; F[0x76ac >> 2] = fr(1.5670000314712524);
    this.trans(MA, 0x766c >> 2); this.trans(MC, 0x7684 >> 2); this.trans(MD, 0x769c >> 2); this.trans(ME, 0x76b4 >> 2); this.trans(MG, 0x76cc >> 2);
    this.rotF(MA, 0x7678 >> 2); this.rotF(MC, 0x7690 >> 2); this.rotF(MD, 0x76a8 >> 2); this.rotF(ME, 0x76c0 >> 2); this.rotF(MG, 0x76d8 >> 2);
    matMul(this.mat(ME), this.mat(ME), this.mat(MC));
    matMul(this.mat(MG), this.mat(MG), this.mat(MC));
    const sum = F[0x8038 >> 2] + F[0x768c >> 2], ratio = F[0x8038 >> 2] / sum;
    I[0x2c80 >> 2] = ftol(I[0x2cd8 >> 2] * ratio);
    I[0x2c84 >> 2] = ftol(I[0x2cdc >> 2] * ratio);
    this.scale36238(sum / F[0x8038 >> 2], I[0x94fc >> 2]);
    I[0x2c64 >> 2] = ftol(Math.trunc((I[0x3628c >> 2] - I[0x2c80 >> 2]) / 2) + F[0x7684 >> 2] / F[0x36238 >> 2]);
    I[0x2c68 >> 2] = ftol(Math.trunc((I[0x36290 >> 2] - I[0x2c84 >> 2]) / 2) - F[0x7688 >> 2] / F[0x36238 >> 2]);
  }
  /** 0x100044d0: the sky's matrices (and sprite 6's 2D position) */
  private m100044d0(): void {
    const F = this.F;
    for (const m of [MA, MB, MC, MD, ME]) this.ident(m);
    F[0x76a4 >> 2] = -54; F[0x76ac >> 2] = fr(1.5670000314712524);
    this.trans(MA, 0x7660 >> 2);
    translation(this.mat(MC), 0, 0, 1);
    this.trans(MD, 0x769c >> 2); this.trans(ME, 0x76b4 >> 2);
    this.rotF(MA, 0x7678 >> 2);
    this.rot(MC, 0, fr(1.5670000314712524), 0);
    this.rotF(MD, 0x76a8 >> 2); this.rotF(ME, 0x76c0 >> 2);
    matMul(this.mat(ME), this.mat(ME), this.mat(MC));
    this.pos2d(0x803c, 0x9504);
  }
  /** the current sprite's 2D size and position at its distance (the tails of 0x100044d0 / 0x10004ab0 / 0x10004ed0) */
  private pos2d(base: number, tsize: number): void {
    const I = this.I, F = this.F, s = I[CUR], z = F[TR(s, 0xc0)];
    const q = F[base >> 2] / (z + F[base >> 2]);
    F[0x362cc >> 2] = q;
    I[SP(s, 0xc)] = ftol(I[SP(s, 0x22)] * q);
    I[SP(s, 0xd)] = ftol(I[SP(s, 0x23)] * F[0x362cc >> 2]);
    F[0x36238 >> 2] = fr(0.062199998646974564);
    this.scale36238((z + F[base >> 2]) / F[base >> 2], I[tsize >> 2]);
    I[SP(s, 5)] = ftol(Math.trunc((I[0x3628c >> 2] - I[SP(s, 0xc)]) / 2) + F[TR(s, 0xb8)] / F[0x36238 >> 2]);
    I[SP(s, 6)] = ftol(Math.trunc((I[0x36290 >> 2] - I[SP(s, 0xd)]) / 2) - F[TR(s, 0xbc)] / F[0x36238 >> 2]);
  }
  /** 0x10004ab0 (clouds 0x14, 0x16, ...) and 0x10004ed0 (0x15, 0x17, ...): a cloud's matrices */
  private m10004ab0(odd: boolean): void {
    const I = this.I, F = this.F, s = I[CUR];
    for (const m of [MA, MB, MC, MD, ME]) this.ident(m);
    F[0x76a4 >> 2] = -54; F[0x76ac >> 2] = fr(1.5670000314712524);
    translation(this.mat(MA), F[0x766c >> 2], F[0x7670 >> 2], -61);
    if (!odd) {
      translation(this.mat(MC), F[TR(s, 0xb8)], F[TR(s, 0xbc)], F[TR(s, 0xc0)]);
      this.trans(MD, 0x769c >> 2); this.trans(ME, 0x76b4 >> 2);
    } else {
      // the second of a pair turns about its partner's position
      translation(this.mat(MC), (s & 1) ? F[TR(s, 0xb8) - 0x38] : F[TR(s, 0xb8)], F[TR(s, 0xbc) - 0x38], F[TR(s, 0xc0) - 0x38]);
      this.trans(MD, 0x769c >> 2);
      translation(this.mat(ME), F[TR(s, 0xb8)], F[TR(s, 0xbc)], F[TR(s, 0xc0)]);
    }
    this.rotF(MA, 0x7678 >> 2);
    this.rot(MC, 0, F[TR(s, 0x178)], 0);
    this.rotF(MD, 0x76a8 >> 2); this.rotF(ME, 0x76c0 >> 2);
    matMul(this.mat(ME), this.mat(ME), this.mat(MC));
  }

  /** 0x10005410: CWater::Update when the size changed, and the caustics into the 128x128 target */
  private c10005410(): void {
    const I = this.I, F = this.F, d = this.d;
    if (!(I[0x1fb9] === 0 && I[0xce9c] === 1 && I[0xce9d] === 1)) return;
    const used = true;                           // ID3DXEffect::IsParameterUsed("tCAU")
    if (I[0xd900] !== 0 || I[0xd898] === 1) { I[0xd898] = 0; this.w10007a80(used); }
    F[TIME] = F[0xcea0] + F[TIME];
    this.rts!.begin(this.obj<Surface>(0xce9b));
    perspectiveFovRH(this.mat(PCAUS), fr(1.0471975803375244), fr(I[0x94f8 >> 2] / I[0x94fc >> 2]), fr(0.10000000149011612), 2000);
    d.setTransform(Ts.PROJECTION, this.mat(PCAUS)); d.setTransform(Ts.WORLD, this.mat(MD));
    d.setTransform(Ts.PROJECTION, this.mat(PCAUS)); d.setTransform(Ts.WORLD, this.mat(MD));
    d.clear(null, ClearFlag.TARGET, 0xff000000, 0, 0);
    d.setRenderState(Rs.ZENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 1);
    // 0x10008070 CWater::DrawCaustics
    this.setVs(0x42);
    d.setStreamSource(0, this.obj<Buffer>(0x929c >> 2), 0x10);
    d.setIndices(this.obj<Buffer>(0x9294 >> 2), 0);
    d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, I[0x9284 >> 2], 0, I[0x9280 >> 2] - 2);
    d.setRenderState(Rs.CULLMODE, 2); d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.ZENABLE, 1);
    this.rts!.end();
  }
  /** 0x10005690: the scene */
  private s10005690(): void {
    const I = this.I, F = this.F, d = this.d;
    d.beginScene();
    const aspect = fr((I[0x24fb] >>> 0) / I[0x24fc]);
    F[0xcea1] = aspect;
    perspectiveFovRH(this.mat(PSCENE), fr(1.0471975803375244), aspect, fr(0.10000000149011612), 2000);
    d.setTransform(Ts.PROJECTION, this.mat(PSCENE));
    d.setTransform(Ts.WORLD, this.mat(ME));
    d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 1);
    d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
    const w = I[0x3628c >> 2], h = I[0x36290 >> 2];
    if ((h === 0x7d && w === 0xa6) || (h === 0x79 && w === 0xa2) || I[0xf131] === 2) I[0xf12e] = 1;
    if (I[0xf1b7] !== 0 && I[0xce90] !== 0) {
      d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
      this.s10005b10();
      this.b100180d0();
    } else {
      // 0x10006450 (the whole sprite into the back buffer) is reached only without a sky texture or a window
      throw new Error('mp10: no sky texture');
    }
    d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
    // the registry's version (10.0) >= 10: the clouds
    this.c10005920();
    d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
    // 0x100059f0: the album art (none without media); 0x100070c0: nothing for version 10
    d.endScene();
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  }
  /** one pass of the water mesh with texture `tex` and the current sprite's alpha */
  private drawMesh(tex: number, alpha: number): void {
    const eff = this.eff!;
    this.I[0x3c488 >> 2] = alpha;
    this.w10008180();
    eff.param(0, this.tex(tex));
    eff.begin(); eff.pass0(); this.w10008100(); eff.end();
  }
  /** 0x10005b10: the sky */
  private s10005b10(): void {
    const I = this.I, d = this.d;
    I[CUR] = 6;
    this.m100044d0();
    d.setTransform(Ts.VIEW, this.mat(MA));
    d.setTransform(Ts.WORLD, this.mat(ME));
    this.drawMesh(0xce90, 0);
  }
  /** 0x10005920 + 0x10005c10 .. 0x10006240: the eight clouds, a Z clear before each */
  private c10005920(): void {
    const I = this.I, d = this.d;
    if (I[0xce9c] === 0) return;
    d.setTransform(Ts.WORLD, this.mat(ME));
    const T = [0xce93, 0xce95, 0xce95, 0xce93, 0xce94, 0xce95, 0xce96, 0xce93];
    for (let k = 0; k < 8; k++) {
      d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
      const s = 0x14 + k;
      I[CUR] = s;
      if (I[SP(s, 4)] !== 0 && I[T[k]] !== 0) {
        this.m10004ab0((k & 1) !== 0);
        d.setTransform(Ts.VIEW, this.mat(MA));
        d.setTransform(Ts.WORLD, this.mat(ME));
        this.drawMesh(T[k], I[SP(s, 0x17)]);
      }
    }
  }
  /** 0x100180d0: the panel's rows of sprite 6 into the back buffer (for 10 s after the bars last moved) */
  private b100180d0(): void {
    const I = this.I;
    if (I[0xf12e] === 1) return;
    if (((this.tgt() - I[0xf125]) >>> 0) >= 0x2711) { if (I[0xf131] > 0) I[0xf12e] = 1; return; }
    const s = I[CUR];
    I[0xd8d6] = I[SP(s, 0x22)]; I[0xd8d5] = I[SP(s, 0x23)];
    const n = I[0xd8d6] * I[0xd8d5];
    I[0xd8fe] = n;
    if (I[SP(s, 1)] !== -1 || n === 0) return;
    const bb = this.d.getBackBuffer();
    const L = bb.lockRect(null, Lock.NOSYSLOCK);
    const pitch = L.pitch >>> 2, u = new Uint32Array(L.data.buffer, L.data.byteOffset, L.data.byteLength >> 2);
    I[0x2017] = I[0x24fc]; I[0xce7e] = pitch; I[0x2016] = I[0x24fb];
    if (I[0xd8d5] !== I[0x24fc] || I[0xd8d6] !== I[0x24fb]) { bb.unlockRect(); return; }
    const w = I[0xd8d6], h = I[0xd8d5], rows = I[0xf117], src = (I[SP(s, 0xa)] >> 2) + (h - rows) * w;
    for (let y = 0; y < rows; y++) u.set(this.U.subarray(src + y * w, src + (y + 1) * w), (h - rows + y) * pitch);
    I[0xd89f] = rows; I[0xd89d] = w;
    bb.unlockRect();
  }
}

/** 0x10012f30's alpha by red channel r: brightness b = (r << 16) * 5.983839e-8 (x 1.08 from 0.55 up, at most 1),
 *  a = 1 - b^4; the pixel becomes (0xff000000 - a1) ^ ((a2 ^ pixel) & 0xffffff) with a1 = ftol(a * 0xff000000),
 *  a2 = ftol(a * -0xff000000); f = the float the last pixel leaves at 0x362cc */
let ALPHA: { a1: Uint32Array; a2: Uint32Array; f: Uint32Array } | null = null;
export function cloudAlpha(): { a1: Uint32Array; a2: Uint32Array; f: Uint32Array } {
  if (ALPHA) return ALPHA;
  const a1 = new Uint32Array(256), a2 = new Uint32Array(256), f = new Uint32Array(256), F1 = new Float32Array(1);
  for (let r = 0; r < 256; r++) {
    let st = (r << 16) * fr(5.983839201917363e-8);
    let b = fr(st);
    if (st >= fr(0.550000011920929)) { st = st * fr(1.0800000429153442); b = fr(st); if (st >= 1) b = 1; }
    const a = 1 - ((b * b) * b) * b;
    F1[0] = a; f[r] = new Uint32Array(F1.buffer)[0];
    a1[r] = (0xff000000 - ftol(a * 4278190080)) >>> 0;
    a2[r] = ftol(a * -4278190080) >>> 0;
  }
  return (ALPHA = { a1, a2, f });
}

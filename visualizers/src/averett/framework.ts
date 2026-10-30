// The pieces of the Averett "Plugin framework" (and the DirectX 8 SDK code it links) that the DLLs share as is:
// the CRT's rand, DXUtil_Timer, CD3DFont's state blocks, the D3DX effect of DATATABLE_sha ("Water effect", technique
// T0 / pass P0) and ID3DXRenderToSurface. Rhythm and Waves (mp9.ts) and Energy Bliss (mp10/engine.ts) both use them.
import { type Device, type Texture, type Surface, type StateBlock, Fmt, Pool, Usage, Ts, Rs } from '../d3d8/api';
import { FONT_RS, FONT_TSS } from '../d3d8/d3dfont';

/** The DLL's CRT rand: holdrand on the render thread */
export class Crt {
  h = 1;
  srand(s: number): void { this.h = s >>> 0; }
  rand(): number { this.h = (Math.imul(this.h, 214013) + 2531011) >>> 0; return (this.h >>> 16) & 0x7fff; }
}

/** DXUtil_Timer over QueryPerformanceCounter at 1 MHz: 1 TIMER_START, 5 TIMER_GETAPPTIME, 6 TIMER_GETELAPSEDTIME */
export class DxTimer {
  private stop = 0; private last = 0; private base = 0;
  /** stopped: the timer's initial state (stopped, the SDK's: the first START makes app time 0) */
  constructor(private readonly qpc: () => number, private stopped = false) {}
  cmd(c: number): number {
    const now = this.stopped && c !== 1 && c !== 4 ? this.stop : this.qpc();
    if (c === 1) { if (this.stopped) this.base += now - this.stop; this.stop = 0; this.stopped = false; this.last = now; return 0; }
    if (c === 5) return (now - this.base) / 1e6;
    if (c === 6) { const e = (now - this.last) / 1e6; this.last = now; return e; }
    return 0;
  }
}


/** CD3DFont::InitDeviceObjects: the glyph texture (A4R4G4B4; its glyphs never reach a draw) */
export function fontInit(d: Device): Texture {
  const t = d.createTexture(256, 256, 1, 0, Fmt.A4R4G4B4, Pool.MANAGED);
  t.lockRect(0, null, 0); t.unlockRect(0);
  return t;
}
/** CD3DFont::RestoreDeviceObjects: the vertex buffer and the two state blocks */
export function fontRestore(d: Device, t: Texture, blocks: StateBlock[]): void {
  d.createVertexBuffer(0x20d0, Usage.WRITEONLY | Usage.DYNAMIC, 0, Pool.DEFAULT);
  for (let k = 0; k < 2; k++) {
    d.beginStateBlock();
    d.setTexture(0, t);
    for (const [s, v] of FONT_RS) d.setRenderState(s, v);
    for (const [st, s, v] of FONT_TSS) d.setTextureStageState(st, s, v);
    blocks.push(d.endStateBlock());
  }
}

// effect T0 / P0 of DATATABLE_sha, the states its pass sets, in the order D3DX records them
const P0_RS: [number, number][] = [[Rs.LIGHTING, 1], [Rs.SPECULARENABLE, 1]];
const P0_TSS0: [number, number][] = [[24, 2], [1, 2], [2, 2], [3, 1], [4, 10], [5, 2], [6, 0], [17, 2], [16, 2], [18, 1]];
const P0_TSS1: [number, number][] = [[24, 2], [1, 7], [2, 2], [3, 1], [4, 3], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1]];
const P0_TSS2: [number, number][] = [[1, 1], [4, 1]];
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** ID3DXEffect over DATATABLE_sha with its two texture parameters (T0: stage 0, T1: stage 1) */
export class WaterEffect {
  protected tex: (Texture | null)[] = [null, null];
  protected saved = 0; protected pass = 0;
  constructor(protected readonly d: Device) {}
  /** SetTexture(parameter k) */
  param(k: number, t: Texture | null): void { this.tex[k] = t; }
  /** SetTechnique: D3DX records the pass into a state block and a second block for what it changes, captures the
   *  latter, validates, and restores */
  technique(): void {
    const d = this.d;
    d.beginStateBlock();
    d.setVertexShader(0x152);
    for (const [s, v] of P0_RS) d.setRenderState(s, v);
    d.setTexture(0, this.tex[0]); d.setTransform(Ts.TEXTURE0, IDENT);
    for (const [s, v] of P0_TSS0) d.setTextureStageState(0, s, v);
    d.setTexture(1, this.tex[1]); d.setTransform(Ts.TEXTURE0 + 1, IDENT);
    for (const [s, v] of P0_TSS1) d.setTextureStageState(1, s, v);
    for (const [s, v] of P0_TSS2) d.setTextureStageState(2, s, v);
    this.saved = d.endStateBlock();
    d.captureStateBlock(this.saved);
    d.beginStateBlock();
    d.setVertexShader(0x152);
    for (const [s, v] of P0_RS) d.setRenderState(s, v);
    for (const [s, v] of P0_TSS0) d.setTextureStageState(0, s, v);
    for (const [s, v] of P0_TSS1) d.setTextureStageState(1, s, v);
    for (const [s, v] of P0_TSS2) d.setTextureStageState(2, s, v);
    this.pass = d.endStateBlock();
    this.pass0();
    this.end();
  }
  begin(): void { this.d.captureStateBlock(this.saved); }
  pass0(): void {
    const d = this.d;
    d.applyStateBlock(this.pass);
    d.setTexture(0, this.tex[0]); d.setTransform(Ts.TEXTURE0, IDENT);
    d.setTexture(1, this.tex[1]); d.setTransform(Ts.TEXTURE0 + 1, IDENT);
  }
  end(): void { this.d.applyStateBlock(this.saved); }
  /** Release: its two state blocks */
  release(): void { this.d.deleteStateBlock(this.pass); this.d.deleteStateBlock(this.saved); }
}

/** ID3DXRenderToSurface for a size x size target without depth */
export class RenderToSurface {
  private block = 0; private old: Surface | null = null; private oldDs: Surface | null = null;
  constructor(private readonly d: Device, private readonly size: number) {}
  begin(target: Surface): void {
    const d = this.d;
    const vp = new ArrayBuffer(24), vv = new DataView(vp);
    vv.setUint32(8, this.size, true); vv.setUint32(12, this.size, true); vv.setFloat32(16, 0, true); vv.setFloat32(20, 1, true);
    if (!this.block) { d.beginStateBlock(); d.setViewport(vp); this.block = d.endStateBlock(); }
    d.captureStateBlock(this.block);
    this.old = d.getRenderTarget(); this.oldDs = d.getDepthStencilSurface();
    d.setRenderTarget(target, null);
    d.setViewport(vp);
    d.beginScene();
  }
  end(): void {
    const d = this.d;
    d.endScene();
    d.setRenderTarget(this.old, this.oldDs);
    d.applyStateBlock(this.block);
  }
}

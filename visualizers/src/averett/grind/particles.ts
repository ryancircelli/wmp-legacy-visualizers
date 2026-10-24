// Grind's Direct3D side where it differs from Picture Viz 3D (../../pictureviz/pv3/frame.ts): the particle system
// (the PointSprites sample's CParticleSystem, grown so that every particle carries its own gravity, fade rate and
// trail: Grind's scene step emits them from the clock hands and the spectrum through f10004320), the caustics
// (drawn only while a liquid transition runs, the water is opaque, or on request) and the water (only over a floor
// texture), and the camera reset (which leaves the particles' vectors to the scene). Offsets are Grind's (core.ts).
//
// A particle (0x7c bytes, operator new): +0 spark, +4 position, +0x10 velocity, +0x1c initial position, +0x28
// initial velocity, +0x34 birth time (-1: the next update's), +0x38 colour, +0x48 fade colour, +0x58 fade,
// +0x5c gravity, +0x60 trail length, +0x64 trail decay, +0x68 fade rate, +0x6c / +0x70 most / fewest trail points,
// +0x74 kind (0 dies at the floor and bursts into sparks, 1 dies faded, others live on), +0x78 next.
import { A } from '../../ns';
import '../../rand';
import { type Core, VT } from '../../pictureviz/pv3/core';
import { ftol } from '../../pictureviz/pv2/mem';
import { fr, fr64, perspectiveFovRH, textureFromPixels } from '../../pictureviz/pv3/d3dx';
import { f10007480, f10007a80, setTex, setVS } from '../../pictureviz/pv3/frame';
import { sincos87, mulExt } from '../../plenoptic/x87';
import {
  type Texture, type Surface, type Buffer, type StateBlock, Fmt, Pool, Usage, Lock, Prim, ClearFlag, Ts, Rs, Tss,
} from '../../d3d8/api';
import { gdef, gvt, gi, si, gf, sf } from './core';
import { o } from './layout';

// ------------------------------------------------------------------------------------------------ state
interface St {
  /** CParticleSystem's clock (static float 0x1009dc38) */
  ptime: number;
  /** ID3DXRenderToSurface: its viewport block, the render target / depth it replaced */
  rtsBlock: StateBlock; rtsOld: Surface | null; rtsOldDs: Surface | null;
}
const STATE = new WeakMap<Core, St>();
function st(c: Core): St {
  let s = STATE.get(c);
  if (!s) { s = { ptime: 0, rtsBlock: 0, rtsOld: null, rtsOldDs: null }; STATE.set(c, s); }
  return s;
}
/** the 4x4 matrix at Grind offset g */
const mat = (c: Core, g: number): Float32Array => c.m.F.subarray(o(g) >> 2, (o(g) >> 2) + 16);
/** FCOMP against 0 then TEST AH,0x40: equal, or unordered */
const eq0 = (v: number): boolean => !(v < 0 || v > 0);

const SA = new Float64Array(4), SB = new Float64Array(4);
const RAND = 3.0518509447574615e-05;     // 1/32767 as a float
const TWO_PI = 6.2831854820251465, QUARTER_PI = 0.7853981852531433;
/** two 64-bit x87 values multiplied at 53-bit precision. ponytail: the low halves' cross terms are summed in double
 *  and their product dropped: off by an ulp only next to a rounding tie */
const mul2 = (ah: number, al: number, bh: number, bl: number): number => A.fma(ah, bh, ah * bl + al * bh);

// ------------------------------------------------------------------------------------------------ the particles
/** a particle from the free list (0x2e4a8) or new */
function newParticle(c: Core): number {
  const f = gi(c, 0x2e4a8);
  if (f) { si(c, 0x2e4a8, c.m.I[(f + 0x78) >> 2]); return f; }
  return c.m.malloc(0x7c);
}

/** the emitter loop of 0x10003c00 (at 0x10003f97) and 0x10004320: up to `n` particles while fewer than 0x1f48
 *  live, at the emitter (0x1f7c, the floor + 0x1f80, 0x1f84) and its spread 0x1f58..0x1f60 (+-0..63 steps), with
 *  its velocity 0x1f4c..0x1f54 (cone directions where 0x1f64..0x1f6c are set) and the particle's own parameters */
function emit(c: Core, n: number, birth: number): void {
  const k = o(0x31474) >> 2;
  let I = c.m.I;
  I[k] = n;
  while (c.m.I[k] > 0 && (gi(c, 0x2e4a0) >>> 0) < (gi(c, 0x1f48) >>> 0)) {
    const q = newParticle(c);
    I = c.m.I;
    const F = c.m.F;
    I[(q + 0x78) >> 2] = gi(c, 0x2e4a4);
    si(c, 0x2e4a4, q);
    si(c, 0x2e4a0, gi(c, 0x2e4a0) + 1);
    I[k]--;
    const a = fr(A.rand() * RAND * TWO_PI);
    const b = A.rand() * RAND * QUARTER_PI;
    I[q >> 2] = 0;
    sincos87(a, SA); sincos87(b, SB);
    // x = sin b cos a * 0x1f4c, z = sin b sin a * 0x1f54, y = cos b * rand * 0x1f50
    if (eq0(gf(c, 0x1f64))) I[(q + 0x28) >> 2] = gi(c, 0x1f4c);
    else F[(q + 0x28) >> 2] = mul2(SB[0], SB[1], SA[2], SA[3]) * gf(c, 0x1f4c);
    if (eq0(gf(c, 0x1f6c))) I[(q + 0x30) >> 2] = gi(c, 0x1f54);
    else F[(q + 0x30) >> 2] = mul2(SB[0], SB[1], SA[0], SA[1]) * gf(c, 0x1f54);
    if (eq0(gf(c, 0x1f68))) I[(q + 0x2c) >> 2] = gi(c, 0x1f50);
    else {
      F[(q + 0x2c) >> 2] = fr64(SB[2], SB[3]);
      F[(q + 0x2c) >> 2] = A.rand() * RAND * gf(c, 0x1f50) * F[(q + 0x2c) >> 2];
    }
    for (let j = 0; j < 3; j++) I[((q + 0x10) >> 2) + j] = I[((q + 0x28) >> 2) + j];
    I[(q + 0x1c) >> 2] = gi(c, 0x1f7c);
    F[(q + 0x20) >> 2] = gf(c, 0x2e490) + gf(c, 0x1f80);
    I[(q + 0x24) >> 2] = gi(c, 0x1f84);
    for (let j = 0; j < 3; j++) {
      const p = (q + 0x1c + 4 * j) >> 2, step = gf(c, 0x1f58 + 4 * j);
      if (eq0(gf(c, 0x1f70 + 4 * j))) F[p] = step + F[p];
      else if (A.rand() & 1) F[p] = (A.rand() & 0x3f) * step + F[p];
      else F[p] = F[p] - (A.rand() & 0x3f) * step;
    }
    for (let j = 0; j < 3; j++) I[((q + 4) >> 2) + j] = I[((q + 0x1c) >> 2) + j];
    for (let j = 0; j < 4; j++) {
      I[((q + 0x38) >> 2) + j] = gi(c, 0x1f9c + 4 * j);
      I[((q + 0x48) >> 2) + j] = gi(c, 0x1fac + 4 * j);
    }
    I[(q + 0x58) >> 2] = gi(c, 0x21c8);
    I[(q + 0x5c) >> 2] = gi(c, 0x21c0);
    I[(q + 0x60) >> 2] = gi(c, 0x21cc);
    I[(q + 0x64) >> 2] = gi(c, 0x21d8);
    I[(q + 0x68) >> 2] = gi(c, 0x21c4);
    I[(q + 0x6c) >> 2] = gi(c, 0x21d0);
    I[(q + 0x70) >> 2] = gi(c, 0x21d4);
    I[(q + 0x74) >> 2] = gi(c, 0x224c);
    F[(q + 0x34) >> 2] = birth;
  }
}

/** 0x10004320: emit 0x1f98 particles now (born at the next update), when the system has room; Grind's scene step
 *  (vt+0x208 0x1003e3a0) calls it once per clock hand and per sounding spectrum bin */
export function f10004320(c: Core): number {
  const n = gi(c, 0x1f98);
  if ((gi(c, 0x2e4a0) >>> 0) < (gi(c, 0x1f48) >>> 0) && n !== 0) emit(c, n, -1);
  return 0;
}

/** 0x10003c00 CParticleSystem::Update(elapsed 0x3c44): ballistic motion under each particle's gravity (sparks:
 *  0x222c), its fade by its fade rate (sparks: 0x2230); kind 0 dies at the floor (bursting into 0x21f0 sparks) or
 *  faded, kind 1 faded; then 0x1f94 new particles a frame */
function update(c: Core): void {
  const s = st(c);
  const el = gf(c, 0x3c44);
  s.ptime = fr(s.ptime + el);
  let pp = o(0x2e4a4);
  for (let p = c.m.I[pp >> 2]; p !== 0; p = c.m.I[pp >> 2]) {
    let I = c.m.I, F = c.m.F;
    if (!(F[(p + 0x34) >> 2] >= 0)) F[(p + 0x34) >> 2] = s.ptime;
    const t = s.ptime - F[(p + 0x34) >> 2];
    const spark = I[p >> 2];
    const g = spark ? gf(c, 0x222c) : F[(p + 0x5c) >> 2], fd = spark ? gf(c, 0x2230) : F[(p + 0x68) >> 2];
    F[(p + 0x58) >> 2] = F[(p + 0x58) >> 2] - fd * el;
    const vy = fr(t * F[(p + 0x2c) >> 2]), vz = fr(t * F[(p + 0x30) >> 2]);
    F[(p + 4) >> 2] = t * F[(p + 0x28) >> 2] + F[(p + 0x1c) >> 2];
    F[(p + 8) >> 2] = vy + F[(p + 0x20) >> 2];
    F[(p + 0xc) >> 2] = vz + F[(p + 0x24) >> 2];
    const y = fr(t * t * (g * 0.5) + F[(p + 8) >> 2]);
    F[(p + 8) >> 2] = y;
    F[(p + 0x14) >> 2] = g * t + F[(p + 0x2c) >> 2];
    if (!(F[(p + 0x58) >> 2] >= 0)) I[(p + 0x58) >> 2] = 0;
    const floor = gf(c, 0x2e490), below = !(y >= floor), faded = !(F[(p + 0x58) >> 2] > 0);
    const kind = I[(p + 0x74) >> 2];
    if (!(kind === 1 && faded) && !(kind === 0 && (below || faded))) { pp = p + 0x78; continue; }
    if (below && kind !== 1 && spark === 0) {
      for (let k = 0; k < gi(c, 0x21f0); k++) {
        const q = newParticle(c);
        I = c.m.I; F = c.m.F;
        I[(q + 0x78) >> 2] = I[(p + 0x78) >> 2];
        I[(p + 0x78) >> 2] = q;
        I[q >> 2] = 1;
        for (let j = 0; j < 3; j++) I[((q + 0x1c) >> 2) + j] = I[((p + 4) >> 2) + j];
        I[(q + 0x20) >> 2] = gi(c, 0x2e490);
        for (let j = 0; j < 3; j++) F[((q + 0x1c) >> 2) + j] = gf(c, 0x2200 + 4 * j) + F[((q + 0x1c) >> 2) + j];
        // x = cos a * 0x21f4 * sin b, z = sin a * 0x21fc * sin b, y = cos b * rand * 0x21f8
        const a = fr(A.rand() * RAND * TWO_PI);
        const b = A.rand() * RAND * QUARTER_PI;
        sincos87(b, SB); sincos87(a, SA);
        F[(q + 0x28) >> 2] = mulExt(mulExt(gf(c, 0x21f4), SA[2], SA[3]), SB[0], SB[1]);
        F[(q + 0x30) >> 2] = mulExt(mulExt(gf(c, 0x21fc), SA[0], SA[1]), SB[0], SB[1]);
        F[(q + 0x2c) >> 2] = fr64(SB[2], SB[3]);
        F[(q + 0x2c) >> 2] = A.rand() * RAND * gf(c, 0x21f8) * F[(q + 0x2c) >> 2];
        for (let j = 0; j < 3; j++) {
          I[((q + 0x10) >> 2) + j] = I[((q + 0x28) >> 2) + j];
          I[((q + 4) >> 2) + j] = I[((q + 0x1c) >> 2) + j];
        }
        for (let j = 0; j < 4; j++) {
          I[((q + 0x38) >> 2) + j] = gi(c, 0x220c + 4 * j);
          I[((q + 0x48) >> 2) + j] = gi(c, 0x221c + 4 * j);
        }
        I[(q + 0x58) >> 2] = gi(c, 0x2234);
        F[(q + 0x34) >> 2] = s.ptime;
        I[(q + 0x74) >> 2] = gi(c, 0x224c);
      }
    }
    I = c.m.I;
    I[pp >> 2] = I[(p + 0x78) >> 2];
    I[(p + 0x78) >> 2] = gi(c, 0x2e4a8);
    si(c, 0x2e4a8, p);
    if (I[p >> 2] === 0) si(c, 0x2e4a0, gi(c, 0x2e4a0) - 1);
  }
  emit(c, gi(c, 0x1f94), s.ptime);
}

/** a colour channel to a byte */
function chan(v: number): number { return v >= 1 ? 0xff : !(v > 0) ? 0 : ftol(v * 255 + 0.5); }
/** 0x10004750 CParticleSystem::Render: point sprites, each particle a trail of points (fewer the faster; its own
 *  length and decay, sparks' 0x2238..0x2244), through the dynamic vertex buffer in chunks of 0x2e498 */
function render(c: Core): void {
  const d = c.d;
  if (gi(c, 0x2e4ac) === 0) {
    const h = c.handle(d.createVertexBuffer(gi(c, 0x2e49c) << 4, Usage.DYNAMIC | Usage.WRITEONLY | Usage.POINTS, 0x42, Pool.DEFAULT));
    si(c, 0x2e4ac, h);
  }
  d.setRenderState(Rs.POINTSPRITEENABLE, 1); d.setRenderState(Rs.POINTSCALEENABLE, 1);
  d.setRenderState(Rs.POINTSIZE, gi(c, 0x21dc)); d.setRenderState(Rs.POINTSIZE_MIN, gi(c, 0x21e0));
  d.setRenderState(Rs.POINT_SCALE_A, gi(c, 0x21e4)); d.setRenderState(Rs.POINT_SCALE_B, gi(c, 0x21e8));
  d.setRenderState(Rs.POINT_SCALE_C, gi(c, 0x21ec));
  const vb = c.obj<Buffer>(o(0x2e4ac));
  d.setStreamSource(0, vb, 0x10);
  setVS(c, 0x42);
  const flush = gi(c, 0x2e498);
  const advance = (): void => {
    si(c, 0x2e494, gi(c, 0x2e494) + flush);
    if ((gi(c, 0x2e494) >>> 0) >= (gi(c, 0x2e49c) >>> 0)) si(c, 0x2e494, 0);
  };
  const lock = (): DataView => {
    const b = gi(c, 0x2e494);
    const u = vb.lock(b * 16, flush * 16, b ? Lock.NOOVERWRITE : Lock.DISCARD);
    return new DataView(u.buffer, u.byteOffset, u.byteLength);
  };
  advance();
  let V = lock(), vo = 0, cnt = 0;
  const k = o(0x31474) >> 2;
  for (let p = gi(c, 0x2e4a4); p !== 0; p = c.m.I[(p + 0x78) >> 2]) {
    const I = c.m.I, F = c.m.F;
    let px = F[(p + 4) >> 2], py = F[(p + 8) >> 2], pz = F[(p + 0xc) >> 2];
    let vx = F[(p + 0x10) >> 2], vy = F[(p + 0x14) >> 2], vz = F[(p + 0x18) >> 2];
    const len2 = (vz * vz + vy * vy) + vx * vx;
    const spark = I[p >> 2] !== 0;
    const mo = spark ? o(0x223c) : p + 0x6c, lo = spark ? o(0x2240) : p + 0x70, ko = spark ? o(0x2238) : p + 0x60;
    if (I[mo >> 2] < I[lo >> 2]) I[mo >> 2] = I[lo >> 2];
    let n = I[lo >> 2] - ftol(len2 * -0.25);
    if (n > I[mo >> 2]) n = I[mo >> 2];
    const sc = -(F[ko >> 2] / n);
    vx = fr(sc * vx); vy = fr(sc * vy); vz = fr(sc * vz);
    const f = F[(p + 0x58) >> 2];
    const ch = (q: number): number => chan(fr((F[(p + q) >> 2] - F[(p + q + 0x10) >> 2]) * f + F[(p + q + 0x10) >> 2]));
    const r = ch(0x38), g = ch(0x3c), b = ch(0x40), a = ch(0x44);
    const col = ((((a << 8 | r) << 8) | g) << 8 | b) >>> 0;
    I[k] = 0;
    for (let i = 0; i < n; i = c.m.I[k]) {
      V.setFloat32(vo, px, true); V.setFloat32(vo + 4, py, true); V.setFloat32(vo + 8, pz, true);
      V.setUint32(vo + 12, col, true);
      vo += 16;
      if (++cnt === flush) {
        vb.unlock();
        d.drawPrimitive(Prim.POINTLIST, gi(c, 0x2e494), cnt);
        cnt = 0;
        advance();
        V = lock(); vo = 0;
      }
      px = fr(px + vx); py = fr(py + vy); pz = fr(pz + vz);
      const dk = spark ? gf(c, 0x2244) : c.m.F[(p + 0x64) >> 2];
      vx = fr(dk * vx); vy = fr(dk * vy); vz = fr(dk * vz);
      c.m.I[k] = i + 1;
    }
  }
  vb.unlock();
  if (cnt) d.drawPrimitive(Prim.POINTLIST, gi(c, 0x2e494), cnt);
  d.setRenderState(Rs.POINTSPRITEENABLE, 0); d.setRenderState(Rs.POINTSCALEENABLE, 0);
}

/** vt+0x188 0x10003a70: the particles: the sprite texture (DATATABLE_Particle_2) the first time, the system's
 *  update (the reference device's fixed 0.05 s step) and its point sprites, added */
function particles(c: Core): number {
  const d = c.d;
  if (gi(c, 0x2e4b0) === 0) {
    const h = c.handle(textureFromPixels(d, c.env.particle(), 128, 128, Fmt.X8R8G8B8));
    si(c, 0x2e4b0, h);
  }
  if (gi(c, 0x3b24) === 2) si(c, 0x3c44, 0x3d4ccccd);
  update(c);
  d.setTransform(Ts.WORLD, mat(c, 0x2e3b4));
  d.beginScene();
  d.setRenderState(Rs.ZWRITEENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1);
  setTex(c, 0, c.obj<Texture>(o(0x2e4b0)));     // (through Picture Viz 3D's record, which the effect's Begin reads)
  d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.ALPHAOP, 4);
  d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 2); d.setRenderState(Rs.SHADEMODE, 1);
  render(c);
  d.setRenderState(Rs.ZWRITEENABLE, 1); d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  d.endScene();
  return 0;
}

/** vt+0x1a4 0x10004d40: every live particle back to the free list (the limit 0x1f48 stays) */
function clearParticles(c: Core): number {
  for (let p = gi(c, 0x2e4a4); p !== 0; p = gi(c, 0x2e4a4)) {
    const I = c.m.I;
    si(c, 0x2e4a4, I[(p + 0x78) >> 2]);
    I[(p + 0x78) >> 2] = gi(c, 0x2e4a8);
    si(c, 0x2e4a8, p);
  }
  si(c, 0x2e4a0, 0);
  return 0;
}

// ------------------------------------------------------------------------------------------------ caustics, water
/** D3DXMatrixPerspectiveFovRH(pi/3, aspect, 0.1, 2000) at Grind offset g; aspect 0/0 is the x87's indefinite */
function projection(c: Core, g: number, aspect: number): void {
  perspectiveFovRH(mat(c, g), 1.0471975803375244, aspect, 0.10000000149011612, 2000);
  if (aspect !== aspect) c.m.U[o(g) >> 2] = 0xffc00000;
}
function rtsBegin(c: Core, surf: Surface): void {
  const d = c.d, s = st(c);
  const vp = new ArrayBuffer(24), vv = new DataView(vp);
  vv.setUint32(8, 128, true); vv.setUint32(12, 128, true); vv.setFloat32(16, 0, true); vv.setFloat32(20, 1, true);
  if (!s.rtsBlock) { d.beginStateBlock(); d.setViewport(vp); s.rtsBlock = d.endStateBlock(); }
  d.captureStateBlock(s.rtsBlock);
  s.rtsOld = d.getRenderTarget(); s.rtsOldDs = d.getDepthStencilSurface();
  d.setRenderTarget(surf, null);
  d.setViewport(vp);
  d.beginScene();
}
function rtsEnd(c: Core): void {
  const d = c.d, s = st(c);
  d.endScene();
  d.setRenderTarget(s.rtsOld, s.rtsOldDs);
  d.applyStateBlock(s.rtsBlock);
}

/** the liquid transitions the caustics run for (0x316a8 while 0x31aa4 is 1) */
const LIQUID = [0x11, 0x18, 0x19, 0x1b, 0x1c, 0x1e];
/** vt+0x184 0x10005460: CWater::Update, with the caustics only while a liquid transition runs or the water is
 *  opaque (0x4e4 = 255) and the effect uses tCAU, before the first photo (0x31418 = 0), or once on request
 *  (0x226c); the water clock; the caustics drawn into the 128 x 128 target through ID3DXRenderToSurface */
function caustics(c: Core): number {
  if (!(gi(c, 0x2e25c) === 1 && gi(c, 0x2e260) === 1)) return 0;
  const used = gi(c, 0x2e260) !== 0;         // ID3DXEffect::IsParameterUsed("tCAU"): T0 uses it
  const liquid = LIQUID.includes(gi(c, 0x316a8)) && gi(c, 0x31aa4) === 1;
  let on = (liquid || gi(c, 0x4e4) === 0x437f0000) && used;
  if (gi(c, 0x31418) === 0) on = true;
  const once = gi(c, 0x226c);
  si(c, 0x226c, 0);
  if (once === 1) on = true;
  f10007480(c, 0, 0, 0, 0, 1, 0, on ? 1 : 0);
  sf(c, 0x3c40, gf(c, 0x2e26c) + gf(c, 0x3c40));
  if (!on) return 0;
  const d = c.d;
  rtsBegin(c, c.obj<Surface>(o(0x2e258)));
  projection(c, 0x2e434, fr(gi(c, 0x3d18) / gi(c, 0x3d1c)));
  for (let k = 0; k < 2; k++) {
    d.setTransform(Ts.PROJECTION, mat(c, 0x2e434));
    d.setTransform(Ts.WORLD, mat(c, 0x2e334));
  }
  d.clear(null, ClearFlag.TARGET, 0xff000000, 0, 0);
  d.setRenderState(Rs.ZENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1);
  d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 1);
  f10007a80(c);                              // 0x10007eb0 CWater::DrawCaustics (Picture Viz 3D's)
  d.setRenderState(Rs.CULLMODE, 2); d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.ZENABLE, 1);
  rtsEnd(c);
  return 0;
}

/** vt+0x15c 0x100057b0: the scene into the back buffer as Picture Viz 3D's (0x100051e0), but the water through the
 *  effect only over a floor texture (0x2e250) */
function renderWater(c: Core): number {
  if (gi(c, 0x2e250) !== 0) return VT[0x148 >> 2]!(c);
  const d = c.d;
  d.beginScene();
  const aspect = fr((gi(c, 0x3c10) >>> 0) / gi(c, 0x3c14));
  sf(c, 0x2e270, aspect);
  projection(c, 0x2e3f4, aspect);
  d.setTransform(Ts.PROJECTION, mat(c, 0x2e3f4));
  d.setTransform(Ts.WORLD, mat(c, 0x2e374));
  si(c, 0x1ca4, 6);
  if (gvt(c, 0x13c) === 0) d.clear(null, ClearFlag.TARGET, gi(c, 0x3131c) >>> 0, 1, 0);
  d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
  d.endScene();
  d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  return 0;
}

// ------------------------------------------------------------------------------------------------ the camera
/** vt+0x11c 0x10001500: the camera and object vectors 0x1ed0..0x1f2c reset (all 0 but the water parent's pitch
 *  1.6; the particles' 0x1f30..0x1f44 are the scene's), then the camera distance (vt+0x120) */
function resetCamera(c: Core): number {
  for (let g = 0x1ed0; g < 0x1f30; g += 4) si(c, g, 0);
  sf(c, 0x1ef8, 1.600000023841858);
  return gvt(c, 0x120);
}

gdef({ 0x11c: resetCamera, 0x15c: renderWater, 0x184: caustics, 0x188: particles, 0x1a4: clearParticles });

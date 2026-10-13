// REF's vertex shader virtual machine (tnl\vshader.cpp: declaration parser 0x422ef6 / 0x422800, ExecuteShader
// 0x425447 interpreting the raw vs.1.1 tokens, per-draw driver 0x4256ce). The register file lives as long as the
// device: only oPos is reset per run, every other register keeps its last value. Arithmetic at the x87's 64 bits,
// each result rounded to float32 per component.
import type { RefShader, State } from '../ref';
import * as E from './ext';
import { CODE, CW, CX, CY, CZ, DIF, FOG, type OutFvf, PSZ, RHW, SPE, ST, SX, SY, SZ, TEX, type TLBuf, type VertexProcessor, K255 } from './vp';

interface Elem { reg: number; type: number; stream: number; offset: number }
/** a parsed shader: declaration elements, constants from the declaration, output flags */
interface Parsed { elems: Elem[]; consts: { start: number; data: Float32Array }[]; fn: Uint32Array; flags: number; texDims: number[] }

const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer), I1 = new Int32Array(F1.buffer);
const NSRC: Record<number, number> = { 1: 1, 2: 2, 4: 3, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 2, 14: 1, 15: 1, 16: 1, 17: 2,
  19: 1, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 0x4e: 1, 0x4f: 1 };

export class VertexShaderVM {
  /** v0..15, r0..11, (c0..95 live in State.vsc), a0, rastout (oPos, oFog, oPts), oD0..1, oT0..7: 4 floats each */
  private reg = new Float32Array((16 + 12 + 96 + 1 + 3 + 2 + 8) * 4);
  private c = new Float32Array(96 * 4);
  private a0 = 0;
  private parsed = new WeakMap<RefShader, Parsed>();
  private src = [new Float32Array(4), new Float32Array(4), new Float32Array(4), new Float32Array(4), new Float32Array(4)];
  private tmp = new Float32Array(4);

  /** reset with the device (the VM is zeroed at device creation) */
  clear(): void { this.reg.fill(0); this.a0 = 0; }
  /** SetVertexShader 0x4089b2: the declaration's constants are copied into c */
  bind(sh: RefShader, c: Float32Array): void { for (const k of this.parse(sh).consts) c.set(k.data, k.start * 4); }

  private parse(sh: RefShader): Parsed {
    let p = this.parsed.get(sh);
    if (p) return p;
    const d = sh.decl, elems: Elem[] = [], consts: Parsed['consts'] = [];
    let stream = 0, offset = 0;
    for (let i = 0; i < d.length; i++) {
      const t = d[i], cls = t >>> 29;
      if (t === 0xffffffff) break;
      if (cls === 1) { stream = t & 0xf; offset = 0; }
      else if (cls === 2) {
        if (t & 0x10000000) offset += ((t >>> 16) & 0xf) * 4;
        else { const type = (t >>> 16) & 0xf; elems.push({ reg: t & 0x1f, type, stream, offset }); offset += [4, 8, 12, 16, 4, 4, 4, 8][type]; }
      } else if (cls === 4) {
        const n = (t >>> 25) & 0xf, start = t & 0x7f;
        consts.push({ start, data: new Float32Array(d.slice(i + 1, i + 1 + n * 4).buffer) }); i += n * 4;
      } else if (cls === 5) i += (t >>> 24) & 0x1f;
    }
    // output flags (0x42422f): written outputs and texcoord dimensions from the write masks
    const fn = sh.fn!;
    let flags = 0; const tmask: number[] = [];
    for (let pc = 1; pc < fn.length && fn[pc] !== 0xffff;) {
      const op = fn[pc] & 0xffff;
      if (op === 0xfffe) { pc += 1 + ((fn[pc] >>> 16) & 0x7fff); continue; }
      const n = NSRC[op] ?? 0;
      if (op !== 0) {
        const dt = fn[pc + 1], type = (dt >>> 28) & 7, idx = dt & 0x1fff, mask = (dt >>> 16) & 0xf;
        if (type === 4) flags |= idx === 0 ? 4 : idx === 2 ? 0x20 : 0;
        if (type === 5) flags |= idx === 0 ? 0x40 : 0x80;
        if (type === 6) tmask[idx] = (tmask[idx] ?? 0) | mask;
        pc += 2 + n;
      } else pc++;
    }
    const texDims = tmask.map((m) => (m === 1 ? 1 : m === 3 ? 2 : m === 7 ? 3 : 4));
    p = { elems, consts, fn, flags, texDims };
    this.parsed.set(sh, p);
    return p;
  }

  /** 0x4256ce: run the shader over stream vertices start..start+n-1 into tl */
  process(st: State, sh: RefShader, vp: VertexProcessor, start: number, n: number, tl: TLBuf): OutFvf {
    const P = this.parse(sh), R = this.reg, clipping = st.rs[136] !== 0;
    this.c = st.vsc;
    vp.viewport(st);
    tl.grow(n);
    const f = tl.f;
    let isect = -1, union = 0;
    // one DataView per stream per draw (not per element and vertex)
    const dvs: DataView[] = [];
    for (const e of P.elems) {
      const d = st.streams[e.stream].vb!.data;
      dvs[e.stream] ??= new DataView(d.buffer, d.byteOffset, d.byteLength);
    }
    for (let v = 0; v < n; v++) {
      for (const e of P.elems) {
        const s = st.streams[e.stream];
        const data = s.vb!.data, b = (start + v) * s.stride + e.offset, o = e.reg * 4;
        const dv = dvs[e.stream];
        switch (e.type) {
          case 0: R[o] = dv.getFloat32(b, true); R[o + 1] = 0; R[o + 2] = 0; R[o + 3] = 1; break;
          case 1: R[o] = dv.getFloat32(b, true); R[o + 1] = dv.getFloat32(b + 4, true); R[o + 2] = 0; R[o + 3] = 1; break;
          case 2: for (let k = 0; k < 3; k++) R[o + k] = dv.getFloat32(b + k * 4, true); R[o + 3] = 1; break;
          case 3: for (let k = 0; k < 4; k++) R[o + k] = dv.getFloat32(b + k * 4, true); break;
          case 4: { const c = dv.getUint32(b, true); R[o + 3] = (c >>> 24) * K255; R[o] = ((c >>> 16) & 0xff) * K255; R[o + 1] = ((c >>> 8) & 0xff) * K255; R[o + 2] = (c & 0xff) * K255; break; }
          case 5: for (let k = 0; k < 4; k++) R[o + k] = data[b + k]; break;
          case 6: R[o] = dv.getInt16(b, true); R[o + 1] = dv.getInt16(b + 2, true); R[o + 2] = 0; R[o + 3] = 1; break;
          case 7: for (let k = 0; k < 4; k++) R[o + k] = dv.getInt16(b + k * 2, true); break;
        }
      }
      this.run(P.fn);
      // outputs -> TL vertex (0x425862)
      const o = v * ST, op = OPOS * 4;
      const x = R[op], y = R[op + 1], z = R[op + 2], w = R[op + 3];
      // f32(E(w + x) * 0.5) = f32(E(w + x)) * 0.5 (the halving is exact)
      const cx = E.add32(w, x) * 0.5, cy = E.add32(w, y) * 0.5;
      f[o + CX] = cx; f[o + CY] = cy; f[o + CZ] = z; f[o + CW] = w;
      let code = 0, screen = true;
      if (clipping) {
        code = vp.clipCode(cx, cy, z, w);
        if (code !== 0) { isect &= code; union |= code; } else isect = 0;
        f[o + CODE] = code;
        if (code !== 0 && (code & 0xfffffff0) !== 0) screen = false;
      } else f[o + CODE] = 0;
      if (screen) {
        F1[0] = w;
        const zw = !clipping && (U1[0] & 0x7fffffff) === 0, iw = zw ? 2097152 : 1 / w;
        // fast path: f32(((c * rhw) * scale) + off) in doubles with a bound (rhw = 1/w at 64 bits in REF)
        const ax = cx * iw * vp.scaleX, ay = cy * iw * vp.scaleY, az = z * iw * vp.scaleZ;
        const rx = ax + vp.offX, ry = ay + vp.offY, rz = az + vp.offZ;
        const ex = (Math.abs(ax) + Math.abs(vp.offX)) * E.EPS, ey = (Math.abs(ay) + Math.abs(vp.offY)) * E.EPS;
        const ez = (Math.abs(az) + Math.abs(vp.offZ)) * E.EPS, ew = Math.abs(iw) * E.EPS;
        const sx = Math.fround(rx - ex), sy = Math.fround(ry - ey), sz = Math.fround(rz - ez), sw = Math.fround(iw - ew);
        if (sx === Math.fround(rx + ex) && sy === Math.fround(ry + ey) && sz === Math.fround(rz + ez) && sw === Math.fround(iw + ew)) {
          f[o + SX] = sx; f[o + SY] = sy; f[o + SZ] = sz; f[o + RHW] = sw;
        } else {
        let ih: number, il: number;
        if (zw) { ih = 2097152; il = 0; } else { E.ld(1); E.fdiv(w); ih = E.A[0]; il = E.A[1]; }
        E.ld(cx); E.fmulE(ih, il); E.fmul(vp.scaleX); E.fadd(vp.offX); f[o + SX] = E.st32();
        E.ld(cy); E.fmulE(ih, il); E.fmul(vp.scaleY); E.fadd(vp.offY); f[o + SY] = E.st32();
        E.ld(z); E.fmulE(ih, il); E.fmul(vp.scaleZ); E.fadd(vp.offZ); f[o + SZ] = E.st32();
        f[o + RHW] = E.toF32(ih, il);
        }
      }
      if (P.flags & 0x40) for (let k = 0; k < 4; k++) f[o + DIF + k] = clampOut(R, OD0 * 4 + k);
      if (P.flags & 0x80) for (let k = 0; k < 4; k++) f[o + SPE + k] = clampOut(R, OD0 * 4 + 4 + k);
      if (P.flags & 0x20) f[o + PSZ] = R[(OPOS + 2) * 4];
      for (let t = 0; t < P.texDims.length; t++) for (let k = 0; k < P.texDims[t]; k++) f[o + TEX + t * 4 + k] = R[(OT0 + t) * 4 + k];
      f[o + FOG] = 0;
    }
    vp.isect = clipping ? isect : 0; vp.union = clipping ? union : 0;
    const texSet: number[] = [], texDims: number[] = [];
    for (let i = 0; i < 8; i++) { const s = st.tss[i * 32 + 11] & 0xffff; texSet.push(s); texDims.push(s < P.texDims.length ? P.texDims[s] : 0); }
    return { diffuse: (P.flags & 0x40) !== 0, specular: (P.flags & 0x80) !== 0, psize: (P.flags & 0x20) !== 0, texSet, texDims, setDims: P.texDims.slice() };
  }

  /** ExecuteShader 0x425447 */
  private run(fn: Uint32Array): void {
    const R = this.reg, T = this.tmp, s = this.src;
    R[OPOS * 4] = 0; R[OPOS * 4 + 1] = 0; R[OPOS * 4 + 2] = 0; R[OPOS * 4 + 3] = 1;
    for (let pc = 1; pc < fn.length && fn[pc] !== 0xffff;) {
      const op = fn[pc] & 0xffff;
      if (op === 0xfffe) { pc += 1 + ((fn[pc] >>> 16) & 0x7fff); continue; }
      if (op === 0) { pc++; continue; }
      const n = NSRC[op];
      if (n === undefined) throw new Error('RefDevice: vertex shader opcode ' + op + ' is not supported');
      const dt = fn[pc + 1];
      for (let i = 0; i < n; i++) this.fetch(fn[pc + 2 + i], s[i]);
      pc += 2 + n;
      const a = s[0], b = s[1], c = s[2];
      let mask = 0xf;
      switch (op) {
        case 1: {
          if (((dt >>> 28) & 7) === 3) { E.ld(Math.floor(a[0])); this.a0 = toInt(E.st32()); continue; }
          T.set(a); break;
        }
        case 2: for (let k = 0; k < 4; k++) T[k] = add32(b[k], a[k]); break;
        case 4: for (let k = 0; k < 4; k++) T[k] = E.add32(b[k] * a[k], c[k]); break;
        case 5: for (let k = 0; k < 4; k++) T[k] = b[k] * a[k]; break;
        case 6: { const w = a[3]; const r = w === 1 ? 1 : w === 0 ? FLT_MAX : (E.ld(1), E.fdiv(w), E.st32()); T.fill(r); break; }
        case 7: { const w = Math.abs(a[3]); const r = w === 1 ? 1 : w === 0 ? FLT_MAX : rsq32(w); T.fill(r); break; }
        case 8: T.fill(dot(b, a, 3)); break;
        case 9: T.fill(dot(b, a, 4)); break;
        case 10: for (let k = 0; k < 4; k++) T[k] = a[k] < b[k] ? a[k] : b[k]; break;
        case 11: for (let k = 0; k < 4; k++) T[k] = a[k] >= b[k] ? a[k] : b[k]; break;
        case 12: for (let k = 0; k < 4; k++) T[k] = a[k] < b[k] ? 1 : 0; break;
        case 13: for (let k = 0; k < 4; k++) T[k] = a[k] >= b[k] ? 1 : 0; break;
        case 19: for (let k = 0; k < 4; k++) { E.ld(a[k]); E.fsub(Math.floor(a[k])); T[k] = E.st32(); } break;
        case 17: T[0] = 1; T[1] = b[1] * a[1]; T[2] = a[2]; T[3] = b[3]; break;
        case 14: T.fill(Math.pow(2, a[3])); break;   // ponytail: msvcrt _CIpow not cloned (unused by the D3D families)
        case 15: { const w = Math.abs(a[3]); T.fill(w === 0 ? -FLT_MAX : Math.log2(w)); break; }
        case 16: {
          T[0] = 1; T[1] = 0; T[2] = 0; T[3] = 1;
          let p = a[3]; if (p < -127.99609375) p = -127.99609375; else if (p > 127.99609375) p = 127.99609375;
          if (a[0] > 0) { T[1] = a[0]; if (a[1] > 0) T[2] = Math.pow(a[1], p); }
          break;
        }
        case 20: case 21: case 22: case 23: case 24: {
          const rows = op === 20 || op === 22 ? 4 : op === 24 ? 2 : 3, len = op === 20 || op === 21 ? 4 : 3;
          mask = op === 21 || op === 23 ? 7 : op === 24 ? 3 : 0xf;
          const rt = fn[pc - 1];
          for (let r = 0; r < rows; r++) { this.fetch(rt + r, s[1 + (r & 3)]); T[r] = dot(s[1 + (r & 3)], a, len); }
          break;
        }
        default: throw new Error('RefDevice: vertex shader opcode ' + op + ' is not supported');
      }
      // write (0x423a71)
      const dm = (dt >>> 16) & 0xf & mask, d = this.dst(dt);
      for (let k = 0; k < 4; k++) if (dm & (1 << k)) R[d + k] = T[k];
    }
  }

  private dst(t: number): number {
    const type = (t >>> 28) & 7, idx = t & 0x1fff;
    switch (type) {
      case 0: return (16 + idx) * 4;
      case 4: return (OPOS + idx) * 4;
      case 5: return (OD0 + idx) * 4;
      case 6: return (OT0 + idx) * 4;
      default: throw new Error('RefDevice: vertex shader destination type ' + type);
    }
  }

  /** source fetch 0x423fd9: register, relative c, swizzle, negate */
  private fetch(t: number, out: Float32Array): void {
    const type = (t >>> 28) & 7;
    let idx = t & 0x1fff;
    let base: number;
    switch (type) {
      case 0: base = 16; break;
      case 1: base = 0; break;
      case 2: {
        if (t & 0x2000) idx += this.a0;
        const C = this.c, sw = (t >>> 16) & 0xff, o = idx * 4;
        for (let k = 0; k < 4; k++) out[k] = C[o + ((sw >>> (2 * k)) & 3)];
        if (((t >>> 24) & 0xf) === 1) for (let k = 0; k < 4; k++) out[k] = -out[k];
        return;
      }
      case 3: base = A0; break;
      case 4: base = OPOS; break;
      case 5: base = OD0; break;
      default: base = OT0;
    }
    const R = this.reg, o = (base + idx) * 4, sw = (t >>> 16) & 0xff;
    for (let k = 0; k < 4; k++) out[k] = R[o + ((sw >>> (2 * k)) & 3)];
    if (((t >>> 24) & 0xf) === 1) for (let k = 0; k < 4; k++) out[k] = -out[k];
  }
}

const A0 = 16 + 12 + 96, OPOS = A0 + 1, OD0 = OPOS + 3, OT0 = OD0 + 2;
const FLT_MAX = 3.4028234663852886e38;
const add32 = E.add32;
/** f32(E(1 / E(sqrt(w)))) */
function rsq32(w: number): number {
  const r = 1 / Math.sqrt(w), e = r * E.EPS, lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  E.ld(w); E.fsqrt(); E.fdivr(1); return E.st32();
}
/** dp3 (z, y, x) / dp4 (w, z, y, x) at 64 bits, one rounding */
function dot(a: Float32Array, b: Float32Array, n: number): number {
  return n === 4 ? E.sum32(a[3] * b[3], a[2] * b[2], a[1] * b[1], a[0] * b[0]) : E.sum32x3(a[2] * b[2], a[1] * b[1], a[0] * b[0]);
}
/** FISTP of an integral float: the low dword of the 64-bit integer */
function toInt(x: number): number {
  if (x > -2147483649 && x < 2147483648) return x | 0;
  return Number.isNaN(x) ? 0 : Number(BigInt.asIntN(32, BigInt(Math.trunc(x))));
}
/** output colour clamp 0x42596a: by the bits (negatives except -0 -> 0, above 1.0 -> 1, -0 kept) */
function clampOut(R: Float32Array, i: number): number {
  F1[0] = R[i];
  if (U1[0] > 0x80000000) R[i] = 0;
  else if (I1[0] > 0x3f800000) R[i] = 1;
  return R[i];
}

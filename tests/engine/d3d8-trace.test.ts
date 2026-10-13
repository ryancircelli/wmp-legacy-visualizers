// TraceDevice (src/engine/d3d8/trace.ts): the D3T1 records the private harness's tools read, laid out as the
// harness writes them for the real DLLs (header, record framing, object pointer first, lock dumps with their
// 32-byte header).
import { describe, expect, it } from 'vitest';
import { TraceDevice } from '../../src/engine/d3d8/trace';
import { Fmt, Lock, Prim, Rs } from '../../src/engine/d3d8/api';

interface Rec { id: number; result: number; args: number[]; blobs: Uint8Array[] }
function read(b: Uint8Array): Rec[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(String.fromCharCode(...b.subarray(0, 4))).toBe('D3T1');
  expect(dv.getUint32(4, true)).toBe(1);
  const out: Rec[] = [];
  let o = 8;
  while (o < b.length) {
    const id = dv.getUint32(o, true), result = dv.getUint32(o + 4, true), n = dv.getUint32(o + 8, true); o += 12;
    const args = Array.from({ length: n }, (_, i) => dv.getUint32(o + i * 4, true)); o += n * 4;
    const nb = dv.getUint32(o, true); o += 4;
    const blobs: Uint8Array[] = [];
    for (let i = 0; i < nb; i++) { const len = dv.getUint32(o, true); o += 4; blobs.push(b.slice(o, o + len)); o += len; }
    out.push({ id, result, args, blobs });
  }
  return out;
}

describe('TraceDevice', () => {
  it('writes the device record, device calls with the object first, and user-pointer vertices', () => {
    const d = new TraceDevice(64, 48);
    d.frameStart(0);
    d.setRenderState(Rs.ZENABLE, 1);
    const v = new Uint8Array(3 * 16).fill(7);
    d.drawPrimitiveUP(Prim.TRIANGLELIST, 1, v, 16);
    d.present();
    d.frameEnd(0);
    const r = read(d.bytes());
    expect(r.map((x) => x.id)).toEqual([0xF200, 0xF000, 50, 72, 15, 0xF100]);
    expect(r[0]!.args.slice(1)).toEqual([0x52, 64, 48]);
    expect(r[2]!.args).toEqual([d.ptr, Rs.ZENABLE, 1]);
    expect(r[3]!.args.slice(1)).toEqual([Prim.TRIANGLELIST, 1, 1, 16]);
    expect(r[3]!.blobs[0]).toEqual(v);
  });

  it('dumps exactly the locked rect of a texture level at unlock, and nothing for a read-only lock', () => {
    const d = new TraceDevice(16, 16);
    const t = d.createTexture(8, 4, 1, 0, Fmt.A8R8G8B8, 1);
    const l = t.lockRect(0, { left: 2, top: 1, right: 4, bottom: 3 }, 0);
    l.data[0] = 0x11; l.data[l.pitch + 7] = 0x22;              // (2,1) blue and (3,2) alpha
    t.unlockRect(0);
    t.lockRect(0, null, Lock.READONLY);
    t.unlockRect(0);
    const r = read(d.bytes()).filter((x) => x.id >> 8 === 1);
    const dump = r[1]!.blobs[0], hv = new DataView(dump!.buffer);
    expect(Array.from({ length: 8 }, (_, i) => hv.getUint32(i * 4, true))).toEqual([Fmt.A8R8G8B8, 8, 4, 2, 1, 4, 3, 32]);
    expect(dump!.length).toBe(32 + 2 * 8);
    expect(dump![32]).toBe(0x11);
    expect(dump![32 + 8 + 7]).toBe(0x22);
    expect(r[3]!.blobs).toEqual([]);
  });

  it('shares a level between the texture and its surface, and hands out odd shader handles', () => {
    const d = new TraceDevice(16, 16);
    const t = d.createTexture(4, 4, 0, 0, Fmt.X8R8G8B8, 1);
    expect(t.levels).toBe(3);
    const s = t.getSurfaceLevel(1);
    s.lockRect(null, 0).data[0] = 9; s.unlockRect();
    expect(t.lockRect(1, null, Lock.READONLY).data[0]).toBe(9);
    const h = d.createVertexShader(new Uint32Array([0xffffffff]), null, 0);
    expect(h & 1).toBe(1);
  });
});

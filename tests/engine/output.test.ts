// The engine's output step (src/engine/index.ts present, blit, blitLuma; gl.ts's shader): 'opaque' is
// the conversion as it always was, byte for byte; 'luma' gives each pixel an alpha from its brightness,
// black clear and a lit pixel opaque, its colour the pixel's own or a tint. The 2D path runs here on
// stand-in canvas contexts; the WebGL2 path's shader is checked as source and through its uniforms
// (tests/gl.smoke.js draws it in Chromium).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blit, blitLuma, createEngine, LUMA_GAIN } from '../../src/engine';
import { glPresenter } from '../../src/engine/gl';
import { level } from './helpers-2';

/** the conversion as it was before the output option (little-endian), frozen here */
function blitBefore(px: Uint32Array, out32: Uint32Array): void {
  for (let i = 0; i < px.length; i++) {
    const p = px[i]!;
    out32[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
  }
}

/** a stand-in 2D context: ImageData as plain bytes, every putImageData's bytes kept */
function fake2d() {
  const puts: Uint8ClampedArray[] = [];
  return {
    puts, imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: vi.fn((img: { data: Uint8ClampedArray }) => { puts.push(img.data.slice()); }),
    drawImage: vi.fn(), clearRect: vi.fn(),
  };
}

/** a Bars frame with sound, each newer than the last (a repeated timestamp is stale audio): the spectrum lit across */
let stamp = 0;
const loud = () => level(2, (l) => { l.timeStamp = ++stamp; for (let i = 0; i < 1024; i++) { l.freq[0][i] = 200 - (i % 50); l.freq[1][i] = 180; } });

afterEach(() => { vi.restoreAllMocks(); });

// first: whether WebGL2 is on a GPU is asked once, and the 2D tests' contexts have no WebGL2
describe('output: the WebGL2 path', () => {
  it('the context has an alpha channel; the shader writes alpha 1 when opaque and the brightness when luma; output() sets its uniforms once per change', () => {
    const sources: string[] = [], uniforms: unknown[][] = [];
    let attrs: WebGLContextAttributes | undefined;
    const real: Record<string, unknown> = {};
    const gl = new Proxy(real, {
      get: (t, k: string) => {
        if (k in t) return t[k];
        if (/^[A-Z0-9_]+$/.test(k)) return 0;
        return () => true;
      },
    });
    Object.assign(gl, {
      shaderSource: (_s: unknown, src: string) => { sources.push(src); },
      getUniformLocation: (_p: unknown, n: string) => n,
      getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
      getParameter: () => 'Apple GPU',
      isContextLost: () => false,
      uniform1i: (l: string, v: number) => { uniforms.push(['1i', l, v]); },
      uniform4f: (l: string, ...v: number[]) => { uniforms.push(['4f', l, ...v]); },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string, a?: unknown) => {
      if (type !== 'webgl2') return null;
      attrs = a as WebGLContextAttributes;
      return gl as never;
    });
    const p = glPresenter(document.createElement('canvas'), true)!;
    expect(p.kind).toBe('webgl2');
    expect(attrs).toMatchObject({ alpha: true, preserveDrawingBuffer: false });
    const fs = sources.find((x) => x.includes('out vec4 o'))!;
    expect(fs).toMatch(/if \(luma == 0\) \{\s*o = vec4\(c, 1\.0\);/);
    expect(fs).toMatch(/float a = min\(1\.0, max\(c\.r, max\(c\.g, c\.b\)\) \* 1\.25\);\s*o = vec4\(tint\.w > 0\.5 \? tint\.rgb \* a : c, a\);/);
    uniforms.length = 0;
    p.output(false, null);                           // opaque, as at the start: nothing to set
    expect(uniforms).toEqual([]);
    p.output(true, [230, 40, 40]);
    p.output(true, [230, 40, 40]);
    expect(uniforms).toEqual([['1i', 'luma', 1], ['4f', 'tint', 230 / 255, 40 / 255, 40 / 255, 1]]);
    p.output(false, null);
    expect(uniforms.slice(2)).toEqual([['1i', 'luma', 0], ['4f', 'tint', 0, 0, 0, 0]]);
  });
});

describe('output: the 2D path', () => {
  function engine(options?: Parameters<typeof createEngine>[2]) {
    const ctxs = new Map<HTMLCanvasElement, ReturnType<typeof fake2d>>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string) {
      if (type !== '2d') return null;                // no WebGL2 here: the 2D path
      if (!ctxs.has(this)) ctxs.set(this, fake2d());
      return ctxs.get(this) as never;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 60;
    const e = createEngine('bars', canvas, { scale: 'original', ...options });
    const view = ctxs.get(canvas)!, buf = [...ctxs.values()].find((c) => c !== view)!;
    return { e, view, buf };
  }

  it("'opaque' (the default): the bytes the conversion always gave, drawn over the last frame", () => {
    const { e, view, buf } = engine();
    expect(e.options.alpha).toBe('opaque');
    for (let k = 0; k < 8; k++) e.render(loud());
    const s = e.render(loud())!;
    e.present();
    const want = new Uint8ClampedArray(s.w * s.h * 4);
    blitBefore(s.px, new Uint32Array(want.buffer));
    expect(buf.puts.at(-1)).toEqual(want);
    expect(new Set(s.px).size).toBeGreaterThan(1);   // bars and black both on the frame
    expect([view.clearRect.mock.calls.length, view.drawImage.mock.calls.length]).toEqual([0, 1]);
    // and blit itself is the old conversion on that frame
    const a = new Uint32Array(s.px.length), b = new Uint32Array(s.px.length);
    blit(s.px, a); blitBefore(s.px, b);
    expect(a).toEqual(b);
  });

  it("'luma': black clear, a lit pixel opaque in its own colour; switched at run time, the canvas cleared under each frame", () => {
    const { e, view, buf } = engine();
    for (let k = 0; k < 8; k++) e.render(loud());
    const s = e.render(loud())!;
    e.options.alpha = 'luma';
    e.present();
    const got = buf.puts.at(-1)!;
    let black = 0, lit = 0;
    for (let i = 0; i < s.px.length; i++) {
      const p = s.px[i]!, a = got[i * 4 + 3];
      if (p === 0) { expect(a).toBe(0); black++; }
      if (p === 0xa4eb0c) { expect([got[i * 4], got[i * 4 + 1], got[i * 4 + 2], a]).toEqual([0xa4, 0xeb, 0x0c, 255]); lit++; }
    }
    expect([black > 0, lit > 0]).toEqual([true, true]);
    expect(view.clearRect).toHaveBeenCalledOnce();
    // with a tint the colour is the tint's, the alpha still the pixel's
    e.options.tint = [230, 40, 40];
    e.present();
    const t = buf.puts.at(-1)!, i = s.px.indexOf(0xa4eb0c), z = s.px.indexOf(0);
    expect([...t.slice(i * 4, i * 4 + 4), ...t.slice(z * 4, z * 4 + 4)]).toEqual([230, 40, 40, 255, 230, 40, 40, 0]);
  });
});

describe('output: blitLuma', () => {
  it('alpha is the brightest channel times the gain, the colour unpremultiplied to it', () => {
    const px = new Uint32Array([0x000000, 0xa4eb0c, 0xffffff, 0x281e0a, 0x0000c8]);
    const out = new Uint8ClampedArray(px.length * 4);
    blitLuma(px, out);
    expect(LUMA_GAIN).toBe(1.25);
    expect([...out]).toEqual([
      0, 0, 0, 0,                                    // black: clear
      164, 235, 12, 255,                             // Bars' green: opaque, as it is
      255, 255, 255, 255,
      204, 153, 51, 50,                              // a dim pixel: brightest 40 -> alpha 50, colour 40/50 of full
      0, 0, 204, 250,                                // 200 blue -> alpha 250
    ]);
    blitLuma(px, out, [10, 20, 30]);
    expect([...out.slice(0, 8)]).toEqual([10, 20, 30, 0, 10, 20, 30, 255]);
  });
});


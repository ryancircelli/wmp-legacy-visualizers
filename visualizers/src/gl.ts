// The visualizer on screen by WebGL2: the engine's 0x00RRGGBB surface is uploaded as it is in
// memory (bytes B,G,R,0) and the shader swaps the channels and scales it to the canvas. That
// replaces the 2D path's per-pixel conversion loop, putImageData into a hidden canvas and a
// window-sized drawImage, which together were most of the visible player's CPU (measured
// 2026-09-28: the page and GPU processes at about a third of a core). The engine is untouched,
// so its output is exactly what it was; only how it reaches the screen changes. Battery's frame
// comes as its own 8-bit indices and 256-entry palette (drawIndexed), looked up here instead of
// expanded to 0x00RRGGBB on the CPU: the same colours, a quarter of the upload.
//
// The output's alpha (output()): 'opaque' writes 1, as it always has; 'luma' writes the colour's
// brightest channel times 1.25 (index.ts LUMA_GAIN), premultiplied, the colour the surface's own or a
// tint, so black is clear over whatever is under the canvas. The context has an alpha channel for
// that, for every canvas: an opaque output's pixels are the same bytes either way, and a canvas can
// then change between the two without a new context (its attributes are fixed at creation).
//
// Sampling keeps each DLL's stretch: Battery's STRETCH_DELETESCANS is nearest neighbour; Alchemy's
// HALFTONE and any other scaled surface are smooth (a cubic filter when enlarging, which is what the
// 2D path's imageSmoothingQuality 'high' does, and mipmaps when shrinking); a surface drawn at the
// canvas's own size (Bars and Waves at 'original') is read texel for texel.

const VS = `#version 300 es
void main() {
  // one triangle over the whole canvas
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform vec2 src;     // surface size
uniform vec2 dst;     // canvas size
uniform int mode;     // 0 texel for texel, 1 nearest, 2 cubic (enlarging), 3 trilinear (shrinking),
                      // 4 nearest from idx through pal
uniform highp usampler2D idx;   // mode 4: 8-bit palette indices, one per pixel
uniform sampler2D pal;          // mode 4: 256 x 1, 0x00RRGGBB uploaded as a surface is
uniform float B;      // cubic family (Mitchell-Netravali B, C)
uniform float C;
uniform int luma;     // 0: opaque, the colour as it is; 1: alpha from brightness, premultiplied
uniform vec4 tint;    // luma: w 1 = the colour is tint.rgb (the surface a mask)
out vec4 o;

float w(float x) {
  x = abs(x);
  if (x < 1.0) return ((12.0 - 9.0 * B - 6.0 * C) * x * x * x + (-18.0 + 12.0 * B + 6.0 * C) * x * x + (6.0 - 2.0 * B)) / 6.0;
  if (x < 2.0) return ((-B - 6.0 * C) * x * x * x + (6.0 * B + 30.0 * C) * x * x + (-12.0 * B - 48.0 * C) * x + (8.0 * B + 24.0 * C)) / 6.0;
  return 0.0;
}

vec3 bgr(vec4 c) { return c.bgr; }

void main() {
  // canvas row 0 is the top; the surface's first row was uploaded first (texture row 0)
  vec2 d = vec2(gl_FragCoord.x, dst.y - gl_FragCoord.y);
  vec3 c;
  if (mode == 0) {
    c = bgr(texelFetch(tex, ivec2(d), 0));
  } else if (mode == 1) {
    c = bgr(texelFetch(tex, ivec2(floor(d * src / dst)), 0));
  } else if (mode == 2) {
    vec2 s = d * src / dst - 0.5, f = fract(s);
    ivec2 b = ivec2(floor(s)), hi = ivec2(src) - 1;
    vec3 acc = vec3(0.0);
    float tw = 0.0;
    for (int j = -1; j <= 2; j++) {
      float wy = w(float(j) - f.y);
      for (int i = -1; i <= 2; i++) {
        float k = w(float(i) - f.x) * wy;
        acc += k * bgr(texelFetch(tex, clamp(b + ivec2(i, j), ivec2(0), hi), 0));
        tw += k;
      }
    }
    c = clamp(acc / tw, 0.0, 1.0);
  } else if (mode == 4) {
    c = bgr(texelFetch(pal, ivec2(texelFetch(idx, ivec2(floor(d * src / dst)), 0).r, 0), 0));
  } else {
    c = bgr(texture(tex, d / dst));
  }
  if (luma == 0) {
    o = vec4(c, 1.0);
  } else {
    float a = min(1.0, max(c.r, max(c.g, c.b)) * 1.25);
    o = vec4(tint.w > 0.5 ? tint.rgb * a : c, a);
  }
}`;

export type Sampling = 'exact' | 'nearest' | 'smooth';

export interface Presenter {
  readonly kind: 'webgl2';
  /** paints `px` (w x h, 0x00RRGGBB) over the whole canvas */
  draw(px: Uint32Array, w: number, h: number, sampling: Sampling): void;
  /** paints `pal[idx]` (w x h indices, a 256-entry 0x00RRGGBB palette) nearest: draw()'s 'nearest' of it */
  drawIndexed(idx: Uint8Array, pal: Uint32Array, w: number, h: number): void;
  /** for the smokes: one canvas pixel as RGBA, read in the same task as a draw */
  pixel(x: number, y: number): [number, number, number, number];
  /** the next draws' alpha: opaque, or from brightness (`luma`), painted in `tint` (0..255 each) if one */
  output(luma: boolean, tint: readonly number[] | null): void;
}

const presenters = new WeakMap<object, Presenter | null>();

/** ?gl=1 forces WebGL2 even when it would be software-rendered (tests), ?gl=0 forces the 2D path
 *  (comparisons). */
const FORCE = typeof location === 'undefined' ? null : /(^|[?&])gl=([01])(&|$)/.exec(location.search)?.[2] ?? null;

/** Whether WebGL2 runs on a real GPU, asked once of a throwaway canvas (a canvas that has had a
 *  WebGL context can never have a 2D one, so the view's own canvas is not asked until the answer is
 *  yes). Software WebGL is declined: measured, Alchemy's cubic filter drops to 11 fps under
 *  SwiftShader where the 2D path holds 60. failIfMajorPerformanceCaveat catches a blocklisted GPU's
 *  fallback; the renderer name catches the rest (headless Chromium runs SwiftShader as its GPU and
 *  sets no caveat; Remote Desktop's Microsoft Basic Render Driver). */
let gpu: boolean | null = null;
function onGpu(): boolean {
  if (gpu !== null) return gpu;
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const g = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    const info = g?.getExtension('WEBGL_debug_renderer_info');
    const name = g && info ? String(g.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gpu = !!g && !/swiftshader|llvmpipe|softpipe|basic render|software/i.test(name);
    g?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    gpu = false;
  }
  return gpu;
}

/** The canvas's WebGL2 presenter, made once per canvas; null where WebGL2 is not available or would
 *  run in software (onGpu), or the platform is big-endian (the upload assumes B,G,R,0 bytes). The
 *  caller keeps the 2D path then. */
export function glPresenter(canvas: HTMLCanvasElement | OffscreenCanvas, littleEndian: boolean): Presenter | null {
  if (presenters.has(canvas)) return presenters.get(canvas)!;
  const p = littleEndian && FORCE !== '0' && (FORCE === '1' || onGpu()) ? make(canvas) : null;
  presenters.set(canvas, p);
  return p;
}

// Mitchell-Netravali (1/3, 1/3), Skia's high-quality upscaling filter: see tests/gl.smoke.js for
// the measured comparison against the 2D path it replaces.
const CUBIC: [number, number] = [1 / 3, 1 / 3];

function make(canvas: HTMLCanvasElement | OffscreenCanvas): Presenter | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: FORCE !== '1',
    });
  } catch { gl = null; }
  if (!gl) return null;
  const g = gl;
  let prog: WebGLProgram | null = null, tw = 0, th = 0, iw = 0, ih = 0, out = '';
  const loc: Record<string, WebGLUniformLocation | null> = {};

  function init(): boolean {
    const sh = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      prog = g.createProgram()!;
      g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
      g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
      g.linkProgram(prog);
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'link');
    } catch {
      prog = null;
      return false;
    }
    g.useProgram(prog);
    for (const n of ['tex', 'idx', 'pal', 'src', 'dst', 'mode', 'B', 'C', 'luma', 'tint']) loc[n] = g.getUniformLocation(prog, n);
    g.uniform1i(loc.tex, 0);
    g.uniform1i(loc.idx, 1);
    g.uniform1i(loc.pal, 2);
    g.uniform1f(loc.B, CUBIC[0]);
    g.uniform1f(loc.C, CUBIC[1]);
    g.bindVertexArray(g.createVertexArray());
    // units 0 tex, 1 idx, 2 pal, each given an image so every sampler is complete from the start;
    // unit 0 is left active. Alignment 1: an index row is w bytes.
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    for (let u = 2; u >= 0; u--) {
      g.activeTexture(g.TEXTURE0 + u);
      g.bindTexture(g.TEXTURE_2D, g.createTexture());
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      if (u === 1) g.texImage2D(g.TEXTURE_2D, 0, g.R8UI, 1, 1, 0, g.RED_INTEGER, g.UNSIGNED_BYTE, new Uint8Array(1));
      else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, u ? 256 : 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(u ? 1024 : 4));
    }
    tw = th = iw = ih = 1;
    out = '';                                    // uniforms start at 0: opaque, no tint
    return true;
  }
  if (!init()) return null;
  if ('addEventListener' in canvas) {
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => { init(); });
  }

  function paint(mode: number, w: number, h: number) {
    const cw = g.drawingBufferWidth, ch = g.drawingBufferHeight;
    g.viewport(0, 0, cw, ch);
    g.uniform2f(loc.src, w, h);
    g.uniform2f(loc.dst, cw, ch);
    g.uniform1i(loc.mode, mode);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  return {
    kind: 'webgl2',
    draw(px, w, h, sampling) {
      if (!prog || g.isContextLost()) return;
      const cw = g.drawingBufferWidth, ch = g.drawingBufferHeight;
      const same = w === cw && h === ch;
      const shrink = w > cw || h > ch;
      const mode = same && sampling !== 'nearest' ? 0 : sampling === 'nearest' ? 1 : shrink ? 3 : 2;
      const bytes = new Uint8Array(px.buffer, px.byteOffset, w * h * 4);
      if (w !== tw || h !== th) {
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, bytes);
        tw = w; th = h;
      } else {
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, bytes);
      }
      if (mode === 3) {
        g.generateMipmap(g.TEXTURE_2D);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      } else {
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      }
      paint(mode, w, h);
    },
    drawIndexed(idx, pal, w, h) {
      if (!prog || g.isContextLost()) return;
      g.activeTexture(g.TEXTURE1);
      if (w !== iw || h !== ih) {
        g.texImage2D(g.TEXTURE_2D, 0, g.R8UI, w, h, 0, g.RED_INTEGER, g.UNSIGNED_BYTE, idx);
        iw = w; ih = h;
      } else {
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g.RED_INTEGER, g.UNSIGNED_BYTE, idx);
      }
      g.activeTexture(g.TEXTURE2);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(pal.buffer, pal.byteOffset, 1024));
      g.activeTexture(g.TEXTURE0);
      paint(4, w, h);
    },
    output(luma, tint) {
      const k = luma ? 'luma:' + (tint ? tint.join() : '') : '';
      if (k === out || !prog || g.isContextLost()) return;
      out = k;
      g.uniform1i(loc.luma, luma ? 1 : 0);
      g.uniform4f(loc.tint, (tint?.[0] ?? 0) / 255, (tint?.[1] ?? 0) / 255, (tint?.[2] ?? 0) / 255, tint ? 1 : 0);
    },
    pixel(x, y) {
      const out = new Uint8Array(4);
      g.readPixels(x, g.drawingBufferHeight - 1 - y, 1, 1, g.RGBA, g.UNSIGNED_BYTE, out);
      return [out[0], out[1], out[2], out[3]];
    },
  };
}

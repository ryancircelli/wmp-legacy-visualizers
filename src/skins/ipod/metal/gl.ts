// The rendered body's one draw (docs/ipod-skin.md §1.7): anodized aluminium, lit by a room (env.ts),
// a pixel a point (index.ts fit). The nano's face is a shallow arc across the width whose long edges round away; the
// metal is brushed along its length, so its reflection is sharp along the brushing (that lobe is baked
// into the room's blur) and spread across it: the shader walks TAPS reflections across the brushing,
// weighted by GGX's distribution of slopes that way. Anodized: the reflection is the metal's, tinted by
// the dye (F0, the body colour). The clear oxide over it would add a dielectric's 4 % of white, which
// washes a dark dye grey (Navy's red is 2.6 % in linear light), so it is left out (§1.7).
import { ENV } from './env';

/** the finish: GGX's perceptual roughness, and how much of it is across the brushing (0: none) */
const ROUGH = .25, ANISO = .6;
/** the light (linear) past which the tone eases toward white */
const KNEE = .6;
/** the face: its arc's half-angle (degrees) at the sides; the outer EDGE of each half rounds off by
 *  EDGE_TURN more, easing in (t²): over 8% with a quarter circle's profile (asin, its slope endless at the
 *  rim) the reflections piled into a hard line down each side (the owner, 2026-10-06: "it's basically a
 *  line"). The arc puts the room's two windows where the classic look has its bands (§1.3) */
const FACE = 18, EDGE = .22, EDGE_TURN = 55;
/** the screen shows this share of the body's width: its rounded edges fall mostly past the screen's sides,
 *  as the owner's crop of the rendered body (2026-10-06: the darkest outer strip cut away) */
const SHOWN = .93;
/** the eye: this many body-heights in front, and EYE_UP of a height above the body's middle, so the
 *  body's foot reflects the room's floor and goes darker toward the bottom, as the classic look does */
const EYE = 3.5, EYE_UP = .3;
/** the room's light at the middle brightness (env.ts is in units of its mean round the horizon): the
 *  body below the wheel as Classic's, measured: Silver's centre within a few levels, Gold's bands the
 *  owner's lit sample (41° 69% 46%) */
const EXPOSURE = .59;
/** reflections across the brushing, spanning ±SPAN of its alpha */
const TAPS = 16, SPAN = 2.5;

export interface Frame {
  /** the body colour as it reads, linear RGB (the shader finds the dye that shows it) */
  f0: readonly [number, number, number];
  /** the room's light, 1 = as baked */
  exposure: number;
  /** the room turned about the body's long axis, radians */
  turn: number;
  /** the room turned about the body's cross axis (the phone tipped toward or away), radians */
  pitch: number;
}
export interface Renderer {
  /** the GPU, as the driver names it */
  name: string;
  size(w: number, h: number): void;
  draw(f: Frame): void;
  /** frees the context (and the canvas's buffer) */
  dispose(): void;
}

const f = (x: number) => x.toFixed(5);
const VS = 'attribute vec2 p; varying vec2 uv; void main() { uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }';
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D env;
uniform vec2 size;
uniform vec3 f0;
uniform float exposure, turn, pitch;
const float PI = 3.14159265, AX = ${f(ROUGH * ROUGH * (1 + ANISO))};
float room(vec3 d) {
  d = vec3(d.x, d.y * cos(pitch) - d.z * sin(pitch), d.y * sin(pitch) + d.z * cos(pitch));
  float az = atan(d.x, d.z) - turn, el = asin(clamp(d.y, -1., 1.));
  return exp2(mix(${f(ENV.stops[0])}, ${f(ENV.stops[1])}, texture2D(env, vec2(az / (2. * PI) + .5, .5 - el / ${f(2 * ENV.band * Math.PI / 180)})).r));
}
vec2 dfg(float nv) {
  vec4 r = ${f(ROUGH)} * vec4(-1., -.0275, -.572, .022) + vec4(1., .0425, 1.04, -.04);
  return vec2(-1.04, 1.04) * (min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y) + r.zw;
}
void main() {
  float u = uv.x * 2. - 1., a = abs(u) * ${f(SHOWN)};
  float phi = asin(a * ${f(Math.sin(FACE * Math.PI / 180))}) + ${f(EDGE_TURN * Math.PI / 180)} * pow(clamp((a - ${f(1 - EDGE)}) / ${f(EDGE)}, 0., 1.), 2.);
  vec3 n = vec3(sign(u) * sin(phi), 0., cos(phi)), across = vec3(n.z, 0., -n.x);
  vec3 v = normalize(vec3((.5 - uv) * size + vec2(0., ${f(EYE_UP)} * size.y), ${f(EYE)} * size.y));
  float e = 0., ws = 0.;
  for (int i = 0; i < ${TAPS}; i++) {
    float s = (float(i) / ${f(TAPS - 1)} * 2. - 1.) * ${f(SPAN)}, w = pow(1. + s * s, -1.5);
    vec3 l = reflect(-v, normalize(n + s * AX * across));
    // a reflection into the metal itself is shadowed by it (the rounded edges' grazing taps)
    e += w * step(0., dot(n, l)) * room(l);
    ws += w;
  }
  // the split sum's scale and bias on F0 (Karis's fit for mobile); the dye is the F0 that shows the
  // colour on a face seen square-on in a light of 1: the bias, white, taken back out of it (it is a
  // fifth of Navy's red)
  vec3 dye = max(f0 - dfg(1.).y, 0.) / dfg(1.).x;
  vec2 ab = dfg(max(dot(n, v), .001));
  vec3 c = e / ws * exposure * ${f(EXPOSURE)} * (dye * ab.x + ab.y);
  // as lit to KNEE, then a soft shoulder for the windows' glare (never clipped flat), then sRGB's own
  // curve (the dye came through it: a plain 2.2 lifts a dark dye's weak channels, greying it)
  c = mix(c, ${f(KNEE)} + ${f(1 - KNEE)} * (1. - exp((${f(KNEE)} - c) / ${f(1 - KNEE)})), step(${f(KNEE)}, c));
  gl_FragColor = vec4(mix(12.92 * c, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)), 1.);
}`;

/** A renderer on `canvas`, or why there is none. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer | string {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return 'no webgl';
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const why = gl.getProgramInfoLog(prog) || 'the shader did not link';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return 'no webgl: ' + why;
  }
  gl.useProgram(prog);
  // one triangle over the whole canvas
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  // the room: wraps round in azimuth, clamps at the band's ends
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, ENV.w, ENV.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, Uint8Array.from(atob(ENV.data), (c) => c.charCodeAt(0)));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const at = (k: string) => gl.getUniformLocation(prog, k);
  const [size, f0, exposure, turn, pitch] = ['size', 'f0', 'exposure', 'turn', 'pitch'].map(at);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    name: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    size(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(size!, w, h);
    },
    draw(fr) {
      gl.uniform3f(f0!, ...fr.f0);
      gl.uniform1f(exposure!, fr.exposure);
      gl.uniform1f(turn!, fr.turn);
      gl.uniform1f(pitch!, fr.pitch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 0;
    },
  };
}

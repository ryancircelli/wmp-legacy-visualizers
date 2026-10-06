// The rendered body's one draw (docs/ipod-skin.md §1.7): the aluminium and the click wheel under one
// room (env.ts), turned by the hand, a pixel a point (index.ts fit).
// - The body: the nano's face is a shallow arc across the width whose long edges round away; the metal
//   is brushed along its length, so its reflection is sharp along the brushing (that lobe is baked into
//   the room's blur) and spread across it: the shader walks TAPS reflections across the brushing,
//   weighted by GGX's distribution of slopes that way. Anodized: the reflection is the metal's, tinted
//   by the dye (F0, the body colour). The clear oxide over it would add a dielectric's 4 % of white,
//   which washes a dark dye grey (Navy's red is 2.6 % in linear light), so it is left out (§1.7).
// - The centre button: the same anodized metal on its own disc, nearly flat, domed a little and rounded
//   at its rim, unbrushed: one reflection, between the sharp map and the rough (HUB_SATIN).
// - The ring: satin plastic, white or black: a dielectric (F0 4 %) over a matte colour, softly domed
//   across its width and rounded at both edges: the rough map for its gloss, the irradiance for its colour.
// - The glass over the screen: its reflection of the same room, a dielectric (F0 4 %, Fresnel's rise
//   toward its curved sides), polished (the sharp map), on the face's arc: the same shader in a second,
//   small context on a canvas over the screen (its pixels placed on the body's by `origin`), drawn as
//   white over alpha (light added: black shows it, white stays white), its light capped (GLASS_MAX) so the
//   screen's text keeps its contrast. A second context and not a copy from the first: drawImage from a
//   WebGL canvas waits for its GPU, every draw.
// Where the wheel and the glass are comes from the page's layout (index.ts), so the DOM's MENU, glyphs,
// touches and screen sit on them.
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
/** the centre button: its dome's slope at the rim (degrees), and its rim rounding off by HUB_ROLL more
 *  over its outer HUB_RIM (rolled 35° it mirrored the room's dark ceiling and floor as a chrome bezel's
 *  black ring); its finish between the two maps, HUB_SATIN of the rough: on the sharp alone it read as a
 *  chrome ball, on the rough alone its light hardly moved with the hand */
const HUB_DOME = 8, HUB_ROLL = 15, HUB_RIM = .08, HUB_ROUGH = .3, HUB_SATIN = .5;
/** the ring: its dome's slope at its edges (degrees), each edge rounding off by RING_ROLL more over its
 *  outer RING_RIM of the width; satin, the rough map's lobe */
const RING_DOME = 10, RING_ROLL = 40, RING_RIM = .06, RING_ROUGH = .5;
/** the ring's matte colour (linear): white plastic (the classic ring's #EEEEEE) and black (#1E1E1E); and
 *  the light on it, as the body's EXPOSURE, set so the white ring reads as Classic's (246 at its top) */
const RING = { white: .86, black: .013 } as const, RING_LIGHT = 1.3;
/** the satin's gloss, of a smooth dielectric's 4 %: at all of it the black ring read mid-grey (60-70
 *  against Classic's 30); this keeps a sheen that moves with the hand on a ring that reads black */
const RING_GLOSS = .35;
/** the glass's light: the room it shows at this share of the body's light (at 4 % the room's dim walls
 *  laid a grey veil over the whole screen; this way they add next to nothing and only the windows show),
 *  and the most it adds (linear), approached softly: black text goes no lighter than #202020 under a
 *  window's streak, white on Now Playing's black keeps a contrast above 15:1 */
const GLASS_GAIN = .35, GLASS_MAX = .015;

export interface Frame {
  /** the body colour as it reads, linear RGB (the shader finds the dye that shows it) */
  f0: readonly [number, number, number];
  /** the click wheel's plastic */
  ring: 'white' | 'black';
  /** the room's light, 1 = as baked */
  exposure: number;
  /** the room turned about the body's long axis, radians */
  turn: number;
  /** the room turned about the body's cross axis (the phone tipped toward or away), radians */
  pitch: number;
}
/** the click wheel on the canvas, in its pixels from the bottom left: its centre, its radius, the centre
 *  button's radius */
export interface Wheel { x: number; y: number; r: number; hub: number }
/** the glass over the screen on the canvas, in its pixels from the top left */
export interface Glass { x: number; y: number; w: number; h: number }
export interface Layout { wheel: Wheel | null; glass: Glass | null }
export interface Renderer {
  /** the GPU, as the driver names it */
  name: string;
  /** whether the glass is drawn (its own context was had) */
  glass: boolean;
  size(w: number, h: number, layout: Layout): void;
  draw(f: Frame): void;
  /** frees the contexts (and the canvases' buffers) */
  dispose(): void;
}

const f = (x: number) => x.toFixed(5);
/** the nine real spherical harmonics, as constant and polynomial (env.ts sh are their coefficients) */
const SH = [[.282095, '1.'], [.488603, 'n.y'], [.488603, 'n.z'], [.488603, 'n.x'], [1.092548, 'n.x * n.y'], [1.092548, 'n.y * n.z'],
            [.315392, '(3. * n.z * n.z - 1.)'], [1.092548, 'n.x * n.z'], [.546274, '(n.x * n.x - n.y * n.y)']] as const;
const rad = (d: number) => f(d * Math.PI / 180);
const VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }';
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D env;
uniform vec2 size, origin;
uniform vec3 f0;
uniform float exposure, ring, glass;
uniform mat3 orient;
uniform vec4 wheel;
const float PI = 3.14159265, AX = ${f(ROUGH * ROUGH * (1 + ANISO))};
// where on the body this pixel is, 0..1 from its bottom left (the glass's canvas is a part of it, at origin)
vec2 uv;
// the room's two maps (sharp, rough) in a direction, as the hand has turned it
vec4 look(vec3 d) {
  d = orient * d;
  return exp2(mix(vec4(${f(ENV.stops[0])}), vec4(${f(ENV.stops[1])}), texture2D(env, vec2(atan(d.x, d.z) / (2. * PI) + .5, .5 - asin(clamp(d.y, -1., 1.)) / ${rad(2 * ENV.band)}))));
}
// the light on a matte surface facing n, over π
float irradiance(vec3 n) {
  n = orient * n;
  return max(0., ${ENV.sh.map((c, i) => f(c * SH[i]![0]) + ' * ' + SH[i]![1]).join(' + ')});
}
// the split sum's scale and bias on F0 at a roughness (Karis's fit for mobile)
vec2 dfg(float rough, float nv) {
  vec4 r = rough * vec4(-1., -.0275, -.572, .022) + vec4(1., .0425, 1.04, -.04);
  return vec2(-1.04, 1.04) * (min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y) + r.zw;
}
// the anodized metal: the dye is the F0 that shows the colour on a face seen square-on in a light of 1:
// the bias, white, taken back out of it (it is a fifth of Navy's red)
vec3 anodized(float light, vec3 n, vec3 v, float rough) {
  vec2 sq = dfg(rough, 1.), ab = dfg(rough, max(dot(n, v), .001));
  return light * (max(f0 - sq.y, 0.) / sq.x * ab.x + ab.y);
}
// a normal tilted by theta away from the centre (dir, in the face's plane)
vec3 tilted(vec2 dir, float theta) { return vec3(dir * sin(theta), cos(theta)); }
vec3 body(vec3 v) {
  float u = uv.x * 2. - 1., a = abs(u) * ${f(SHOWN)};
  float phi = asin(a * ${f(Math.sin(FACE * Math.PI / 180))}) + ${rad(EDGE_TURN)} * pow(clamp((a - ${f(1 - EDGE)}) / ${f(EDGE)}, 0., 1.), 2.);
  vec3 n = vec3(sign(u) * sin(phi), 0., cos(phi)), across = vec3(n.z, 0., -n.x);
  float e = 0., ws = 0.;
  for (int i = 0; i < ${TAPS}; i++) {
    float s = (float(i) / ${f(TAPS - 1)} * 2. - 1.) * ${f(SPAN)}, w = pow(1. + s * s, -1.5);
    vec3 l = reflect(-v, normalize(n + s * AX * across));
    // a reflection into the metal itself is shadowed by it (the rounded edges' grazing taps)
    e += w * step(0., dot(n, l)) * look(l).r;
    ws += w;
  }
  return anodized(e / ws, n, v, ${f(ROUGH)});
}
vec3 hub(vec2 q, float r, vec3 v) {
  vec3 n = tilted(q / max(r, .0001), atan(r * ${f(Math.tan(HUB_DOME * Math.PI / 180))}) + ${rad(HUB_ROLL)} * smoothstep(${f(1 - HUB_RIM)}, 1., r));
  vec4 room = look(reflect(-v, n));
  return anodized(mix(room.r, room.a, ${f(HUB_SATIN)}), n, v, ${f(HUB_ROUGH)});
}
vec3 plastic(vec2 dir, float t, vec3 v) {
  // across the ring's width t (0 at the centre button, 1 at the body): tilted inward, then outward
  float theta = ${rad(RING_DOME)} * (2. * t - 1.) + ${rad(RING_ROLL)} * (smoothstep(${f(1 - RING_RIM)}, 1., t) - smoothstep(${f(RING_RIM)}, 0., t));
  vec3 n = tilted(dir, theta);
  vec2 ab = dfg(${f(RING_ROUGH)}, max(dot(n, v), .001));
  float spec = .04 * ab.x + ab.y;
  return vec3(ring * (1. - spec) * irradiance(n) * ${f(RING_LIGHT)} + ${f(RING_GLOSS)} * spec * look(reflect(-v, n)).a);
}
vec3 encode(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main() {
  uv = (gl_FragCoord.xy + origin) / size;
  vec3 v = normalize(vec3((.5 - uv) * size + vec2(0., ${f(EYE_UP)} * size.y), ${f(EYE)} * size.y));
  if (glass > .5) {
    // the glass follows the face's arc (not its rounded edges, which it stops short of)
    float u = uv.x * 2. - 1., phi = asin(abs(u) * ${f(SHOWN * Math.sin(FACE * Math.PI / 180))});
    vec3 n = vec3(sign(u) * sin(phi), 0., cos(phi));
    float fresnel = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
    float g = fresnel * look(reflect(-v, n)).r * exposure * ${f(EXPOSURE * GLASS_GAIN)};
    float a = encode(vec3(${f(GLASS_MAX)} * (1. - exp(-g / ${f(GLASS_MAX)})))).r;
    gl_FragColor = vec4(a, a, a, a);
    return;
  }
  vec2 q = gl_FragCoord.xy - wheel.xy;
  float d = length(q), onWheel = clamp(wheel.z - d + .5, 0., 1.), onHub = clamp(wheel.w - d + .5, 0., 1.);
  vec3 c = vec3(0.);
  if (onWheel < 1.) c = body(v);
  if (onWheel > 0.) {
    vec2 dir = q / max(d, .0001);
    vec3 w = onHub < 1. ? plastic(dir, clamp((d - wheel.w) / (wheel.z - wheel.w), 0., 1.), v) : vec3(0.);
    if (onHub > 0.) w = mix(w, hub(q / wheel.w, min(d / wheel.w, 1.), v), onHub);
    c = mix(c, w, onWheel);
  }
  c *= exposure * ${f(EXPOSURE)};
  // as lit to KNEE, then a soft shoulder for the windows' glare (never clipped flat), then sRGB's own
  // curve (the dye came through it: a plain 2.2 lifts a dark dye's weak channels, greying it)
  c = mix(c, ${f(KNEE)} + ${f(1 - KNEE)} * (1. - exp((${f(KNEE)} - c) / ${f(1 - KNEE)})), step(${f(KNEE)}, c));
  gl_FragColor = vec4(encode(c), 1.);
}`;

/** The room turned by the hand: about the cross axis by `pitch`, then about the long axis by `turn`
 *  (a reflection's azimuth less the turn), column-major for uniformMatrix3fv. */
export function orientation(turn: number, pitch: number): number[] {
  const ct = Math.cos(turn), st = Math.sin(turn), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [ct, 0, st, -st * sp, cp, ct * sp, -st * cp, -sp, ct * cp];
}

interface Pass { gl: WebGLRenderingContext; u: Record<'size' | 'origin' | 'f0' | 'ring' | 'exposure' | 'orient' | 'wheel' | 'glass', WebGLUniformLocation | null> }
/** The shader and the room on a canvas's own context, or why not. */
function pass(canvas: HTMLCanvasElement, alpha: boolean): Pass | string {
  const gl = canvas.getContext('webgl', { alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
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
  // the room's two maps, the sharp as luminance and the rough as alpha: wrapping round in azimuth,
  // clamped at the band's ends
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, ENV.w, ENV.h, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, Uint8Array.from(atob(ENV.data), (c) => c.charCodeAt(0)));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const u = Object.fromEntries((['size', 'origin', 'f0', 'ring', 'exposure', 'orient', 'wheel', 'glass'] as const).map((k) => [k, gl.getUniformLocation(prog, k)])) as Pass['u'];
  return { gl, u };
}

/** A renderer on `canvas` (and the glass's reflection on `over`, a canvas over the screen, where a
 *  second context can be had), or why there is none. */
export function createRenderer(canvas: HTMLCanvasElement, over: HTMLCanvasElement | null): Renderer | string {
  const body = pass(canvas, false);
  if (typeof body === 'string') return body;
  const pane = over ? pass(over, true) : null, glass = typeof pane === 'object' ? pane : null;
  const all = glass ? [body, glass] : [body];
  let shown = false;   // the glass has a place on the page (its canvas is sized)
  const dbg = body.gl.getExtension('WEBGL_debug_renderer_info');
  return {
    name: String(body.gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : body.gl.RENDERER)),
    glass: !!glass,
    size(w, h, { wheel: wh, glass: g }) {
      canvas.width = w;
      canvas.height = h;
      const { gl, u } = body;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.size, w, h);
      gl.uniform2f(u.origin, 0, 0);
      gl.uniform4f(u.wheel, wh?.x ?? 0, wh?.y ?? 0, wh?.r ?? 0, wh?.hub ?? 0);
      gl.uniform1f(u.glass, 0);
      if (!glass || !over) return;
      shown = !!g && g.w >= 1 && g.h >= 1;
      over.width = shown ? Math.round(g!.w) : 0;
      over.height = shown ? Math.round(g!.h) : 0;
      if (!shown) return;
      glass.gl.viewport(0, 0, over.width, over.height);
      glass.gl.uniform2f(glass.u.size, w, h);
      glass.gl.uniform2f(glass.u.origin, g!.x, h - g!.y - over.height);
      glass.gl.uniform1f(glass.u.glass, 1);
    },
    draw(fr) {
      for (const { gl, u } of all) {
        if (gl !== body.gl && !shown) continue;
        gl.uniform3f(u.f0, ...fr.f0);
        gl.uniform1f(u.ring, RING[fr.ring]);
        gl.uniform1f(u.exposure, fr.exposure);
        gl.uniformMatrix3fv(u.orient, false, orientation(fr.turn, fr.pitch));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      for (const { gl } of all) gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 0;
      if (over) over.width = over.height = 0;
    },
  };
}
